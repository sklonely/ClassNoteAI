#!/usr/bin/env python3
"""
調試空輸出問題
深入分析為什麼某些句子會產生空輸出
"""

import sys
import os
import numpy as np
from pathlib import Path

try:
    import onnxruntime as ort
    from transformers import AutoTokenizer
except ImportError:
    print("錯誤：請先安裝依賴")
    print("pip install onnxruntime transformers sentencepiece")
    sys.exit(1)

def debug_translation(model_dir, test_text):
    """詳細調試翻譯過程"""
    print("=" * 80)
    print(f"調試文本: \"{test_text}\"")
    print(f"文本長度: {len(test_text)} 字符")
    print("=" * 80)
    
    encoder_path = model_dir / "encoder_model.onnx"
    decoder_path = model_dir / "decoder_model.onnx"
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
    
    encoder_session = ort.InferenceSession(str(encoder_path))
    decoder_session = ort.InferenceSession(str(decoder_path))
    
    import json
    with open(model_dir / "config.json") as f:
        config = json.load(f)
    
    decoder_start_token_id = config.get("decoder_start_token_id", 65000)
    eos_token_id = config.get("eos_token_id", 0)
    
    print(f"\n配置:")
    print(f"  decoder_start_token_id: {decoder_start_token_id}")
    print(f"  eos_token_id: {eos_token_id}")
    
    # Tokenize 輸入
    print(f"\n1. Tokenization:")
    input_ids = tokenizer.encode(test_text, return_tensors="np").astype(np.int64)
    print(f"   輸入 token IDs: {input_ids[0].tolist()}")
    print(f"   Token 數量: {len(input_ids[0])}")
    
    # 檢查特殊 tokens
    print(f"\n   特殊 tokens 檢查:")
    print(f"   第一個 token: {input_ids[0][0]} (EOS={eos_token_id})")
    print(f"   最後一個 token: {input_ids[0][-1]} (EOS={eos_token_id})")
    
    attention_mask = np.ones_like(input_ids, dtype=np.int64)
    
    # Encoder
    print(f"\n2. Encoder 推理:")
    encoder_outputs = encoder_session.run(None, {
        "input_ids": input_ids,
        "attention_mask": attention_mask
    })
    encoder_hidden_states = encoder_outputs[0]
    print(f"   Encoder hidden states shape: {encoder_hidden_states.shape}")
    print(f"   前5個值: {encoder_hidden_states[0, 0, :5].tolist()}")
    
    # 檢查 encoder 輸出是否為零
    if np.allclose(encoder_hidden_states, 0):
        print("   ⚠ 警告：Encoder 輸出全為零！")
    else:
        print(f"   非零值數量: {np.count_nonzero(encoder_hidden_states)}")
        print(f"   平均值: {np.mean(encoder_hidden_states):.6f}")
        print(f"   標準差: {np.std(encoder_hidden_states):.6f}")
    
    # Decoder (詳細步驟)
    print(f"\n3. Decoder 推理（詳細步驟）:")
    generated_ids = [decoder_start_token_id]
    max_length = 20  # 只檢查前20步
    
    for step in range(max_length):
        decoder_input_ids = np.array([[generated_ids[-1]]], dtype=np.int64)
        
        decoder_outputs = decoder_session.run(None, {
            "input_ids": decoder_input_ids,
            "encoder_hidden_states": encoder_hidden_states,
            "encoder_attention_mask": attention_mask
        })
        logits = decoder_outputs[0][0, -1, :]
        
        # 分析 logits
        max_logit_idx = int(np.argmax(logits))
        max_logit_value = float(logits[max_logit_idx])
        
        # 檢查 EOS token 的 logit
        eos_logit = float(logits[eos_token_id])
        
        # Top 5 logits
        top_5_indices = np.argsort(logits)[-5:][::-1]
        top_5_logits = [(int(idx), float(logits[idx])) for idx in top_5_indices]
        
        print(f"\n   步驟 {step}:")
        print(f"     輸入 token ID: {generated_ids[-1]}")
        print(f"     最大 logit: token_id={max_logit_idx}, value={max_logit_value:.4f}")
        print(f"     EOS token ({eos_token_id}) logit: {eos_logit:.4f}")
        print(f"     前5個最高 logits: {top_5_logits}")
        
        # 檢查是否選擇了 EOS
        if max_logit_idx == eos_token_id:
            print(f"     ⚠ 選擇了 EOS token，停止生成")
            break
        
        generated_ids.append(max_logit_idx)
        
        # 檢查是否陷入循環
        if len(generated_ids) > 3:
            last_3 = generated_ids[-3:]
            if len(set(last_3)) == 1:
                print(f"     ⚠ 檢測到重複循環: {last_3}")
    
    # 結果分析
    print(f"\n4. 生成結果分析:")
    print(f"   生成的 token IDs: {generated_ids}")
    print(f"   Token 數量: {len(generated_ids) - 1}")
    
    # Decode
    output_ids = generated_ids[1:]  # 移除 start token
    
    # 檢查是否只有 EOS
    if len(output_ids) == 0 or (len(output_ids) == 1 and output_ids[0] == eos_token_id):
        print(f"   ❌ 輸出為空：只有 EOS token 或沒有 token")
    else:
        # 過濾 EOS token
        filtered_ids = [id for id in output_ids if id != eos_token_id]
        if len(filtered_ids) == 0:
            print(f"   ❌ 輸出為空：所有 token 都是 EOS")
        else:
            translated = tokenizer.decode(filtered_ids, skip_special_tokens=True)
            print(f"   翻譯結果: \"{translated}\"")
            print(f"   結果長度: {len(translated)} 字符")
            
            # 檢查是否包含中文
            has_chinese = any('\u4e00' <= c <= '\u9fff' for c in translated)
            print(f"   包含中文: {has_chinese}")

# 測試空輸出的案例
EMPTY_OUTPUT_CASES = [
    "The quick brown fox jumps over the lazy dog",
    "Machine learning is a subset of artificial intelligence",
    "The assignment is due next Friday at midnight",
]

if __name__ == "__main__":
    model_dir = Path(__file__).parent.parent / "models" / "opus-mt-en-zh-onnx"
    
    if not model_dir.exists():
        print(f"❌ 模型目錄不存在: {model_dir}")
        sys.exit(1)
    
    for test_text in EMPTY_OUTPUT_CASES:
        debug_translation(model_dir, test_text)
        print("\n" + "=" * 80 + "\n")


