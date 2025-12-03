#!/usr/bin/env python3
"""
修復 MBart-Large-50 的生成參數問題
嘗試不同的生成策略來改善翻譯質量
"""

import sys
import os
import numpy as np
from pathlib import Path

try:
    import onnxruntime as ort
    from transformers import AutoTokenizer, MBartForConditionalGeneration
except ImportError:
    print("錯誤：請先安裝依賴")
    print("pip install onnxruntime transformers torch")
    sys.exit(1)

def test_mbart_with_different_params():
    """測試不同的生成參數"""
    model_dir = Path(__file__).parent.parent / "models" / "mbart-large-50-onnx"
    
    print("=" * 60)
    print("MBart-Large-50 生成參數調試")
    print("=" * 60)
    
    # 加載模型
    encoder_path = model_dir / "encoder_model.onnx"
    decoder_path = model_dir / "decoder_model.onnx"
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
    
    encoder_session = ort.InferenceSession(str(encoder_path))
    decoder_session = ort.InferenceSession(str(decoder_path))
    
    # 讀取配置
    import json
    with open(model_dir / "config.json") as f:
        config = json.load(f)
    
    # 測試文本
    test_text = "Hello, how are you?"
    
    print(f"\n測試文本: \"{test_text}\"")
    print(f"源語言: en_XX (250004)")
    print(f"目標語言: zh_CN (250025)")
    
    # Tokenize 輸入
    input_ids = tokenizer.encode(test_text, return_tensors="np").astype(np.int64)
    attention_mask = np.ones_like(input_ids, dtype=np.int64)
    
    print(f"\n輸入 token IDs: {input_ids[0].tolist()}")
    
    # Encoder
    encoder_outputs = encoder_session.run(None, {
        "input_ids": input_ids,
        "attention_mask": attention_mask
    })
    encoder_hidden_states = encoder_outputs[0]
    
    print(f"Encoder hidden states shape: {encoder_hidden_states.shape}")
    
    # 測試不同的生成策略
    strategies = [
        {
            "name": "策略 1: 標準生成（當前）",
            "decoder_start": [2, 250025],  # EOS + zh_CN
            "temperature": None,
            "top_k": None,
            "top_p": None,
        },
        {
            "name": "策略 2: 僅目標語言代碼",
            "decoder_start": [250025],  # 僅 zh_CN
            "temperature": None,
            "top_k": None,
            "top_p": None,
        },
        {
            "name": "策略 3: 使用 BOS token",
            "decoder_start": [0, 250025],  # BOS + zh_CN
            "temperature": None,
            "top_k": None,
            "top_p": None,
        },
        {
            "name": "策略 4: Temperature 採樣",
            "decoder_start": [2, 250025],
            "temperature": 0.7,
            "top_k": None,
            "top_p": None,
        },
        {
            "name": "策略 5: Top-k 採樣",
            "decoder_start": [2, 250025],
            "temperature": 0.7,
            "top_k": 50,
            "top_p": None,
        },
        {
            "name": "策略 6: Top-p 採樣",
            "decoder_start": [2, 250025],
            "temperature": 0.7,
            "top_k": None,
            "top_p": 0.9,
        },
    ]
    
    eos_token_id = config.get("eos_token_id", 2)
    max_length = 50
    
    for strategy in strategies:
        print(f"\n{strategy['name']}:")
        print("-" * 60)
        
        generated_ids = strategy["decoder_start"].copy()
        
        try:
            for step in range(max_length):
                decoder_input_ids = np.array([generated_ids], dtype=np.int64)
                
                decoder_outputs = decoder_session.run(None, {
                    "encoder_attention_mask": attention_mask,
                    "input_ids": decoder_input_ids,
                    "encoder_hidden_states": encoder_hidden_states
                })
                logits = decoder_outputs[0]
                
                # 獲取最後一個位置的 logits
                last_logits = logits[0, -1, :]
                
                # 應用採樣策略
                if strategy["temperature"] is not None:
                    # Temperature 採樣
                    logits = last_logits / strategy["temperature"]
                    
                    if strategy["top_k"] is not None:
                        # Top-k 採樣
                        top_k = min(strategy["top_k"], len(logits))
                        top_k_indices = np.argsort(logits)[-top_k:]
                        top_k_logits = logits[top_k_indices]
                        probs = np.exp(top_k_logits - np.max(top_k_logits))
                        probs = probs / probs.sum()
                        next_token_idx = np.random.choice(len(top_k_indices), p=probs)
                        next_token_id = int(top_k_indices[next_token_idx])
                    elif strategy["top_p"] is not None:
                        # Top-p (nucleus) 採樣
                        sorted_indices = np.argsort(logits)[::-1]
                        sorted_logits = logits[sorted_indices]
                        probs = np.exp(sorted_logits - np.max(sorted_logits))
                        probs = probs / probs.sum()
                        cumsum_probs = np.cumsum(probs)
                        top_p_indices = sorted_indices[cumsum_probs <= strategy["top_p"]]
                        if len(top_p_indices) == 0:
                            top_p_indices = sorted_indices[:1]
                        probs_p = probs[:len(top_p_indices)]
                        probs_p = probs_p / probs_p.sum()
                        next_token_idx = np.random.choice(len(top_p_indices), p=probs_p)
                        next_token_id = int(top_p_indices[next_token_idx])
                    else:
                        # 僅 temperature
                        probs = np.exp(logits - np.max(logits))
                        probs = probs / probs.sum()
                        next_token_id = int(np.random.choice(len(logits), p=probs))
                else:
                    # Greedy decoding (argmax)
                    next_token_id = int(np.argmax(last_logits))
                
                if next_token_id == eos_token_id:
                    break
                
                generated_ids.append(next_token_id)
                
                if step < 3:
                    print(f"  步驟 {step}: token_id={next_token_id}, logit={last_logits[next_token_id]:.4f}")
            
            # Decode
            output_ids = generated_ids[len(strategy["decoder_start"]):]
            translated = tokenizer.decode(output_ids, skip_special_tokens=True)
            has_chinese = any('\u4e00' <= c <= '\u9fff' for c in translated)
            
            status = "✓" if has_chinese else "⚠"
            print(f"  結果: \"{translated}\"")
            print(f"  包含中文: {has_chinese}")
            print(f"  生成的 token IDs: {output_ids[:10]}...")
            
        except Exception as e:
            print(f"  ❌ 錯誤: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    test_mbart_with_different_params()


