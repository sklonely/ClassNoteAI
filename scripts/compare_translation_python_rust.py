#!/usr/bin/env python3
"""
比較 Python 和 Rust 的 ONNX 翻譯結果
用於驗證 Rust 實現是否正確
"""

import sys
import os
import json
import subprocess
from pathlib import Path
from typing import List, Tuple

# 添加路徑
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    import onnxruntime as ort
    import numpy as np
    from transformers import AutoTokenizer
except ImportError as e:
    print(f"錯誤：請先安裝依賴: {e}")
    print("pip install onnxruntime transformers numpy")
    sys.exit(1)


class PythonONNXTranslator:
    """使用 Python ONNX Runtime 進行翻譯"""
    
    def __init__(self, model_dir: Path):
        self.model_dir = Path(model_dir)
        
        # 加載 tokenizer
        print(f"[Python] 加載 Tokenizer: {self.model_dir}")
        self.tokenizer = AutoTokenizer.from_pretrained(str(self.model_dir))
        
        # 加載 ONNX 模型
        encoder_path = self.model_dir / "encoder_model.onnx"
        decoder_path = self.model_dir / "decoder_model.onnx"
        
        if not encoder_path.exists() or not decoder_path.exists():
            raise FileNotFoundError(f"ONNX 模型文件不存在: {encoder_path} 或 {decoder_path}")
        
        print(f"[Python] 加載 Encoder: {encoder_path}")
        self.encoder_session = ort.InferenceSession(str(encoder_path))
        
        print(f"[Python] 加載 Decoder: {decoder_path}")
        self.decoder_session = ort.InferenceSession(str(decoder_path))
        
        # 讀取配置
        config_path = self.model_dir / "config.json"
        if config_path.exists():
            with open(config_path) as f:
                self.config = json.load(f)
        else:
            # 默認配置（opus-mt-en-zh）
            self.config = {
                "decoder_start_token_id": 65000,
                "eos_token_id": 0,
                "pad_token_id": 65000,
                "vocab_size": 65001,
            }
        
        self.decoder_start_token_id = self.config.get("decoder_start_token_id", 65000)
        self.eos_token_id = self.config.get("eos_token_id", 0)
        self.pad_token_id = self.config.get("pad_token_id", 65000)
        self.vocab_size = self.config.get("vocab_size", 65001)
        self.no_repeat_ngram_size = 2  # 與 Rust 一致
        self.repetition_penalty = 1.5  # 與 Rust 一致
        
        print(f"[Python] 配置: decoder_start_token_id={self.decoder_start_token_id}, "
              f"eos_token_id={self.eos_token_id}, vocab_size={self.vocab_size}")
    
    def preprocess_text(self, text: str) -> str:
        """預處理文本"""
        # 簡單清理
        cleaned = text.strip()
        # 移除多餘空格
        cleaned = ' '.join(cleaned.split())
        return cleaned
    
    def translate(self, text: str, max_length: int = 150) -> str:
        """翻譯文本"""
        # 預處理
        preprocessed = self.preprocess_text(text)
        if not preprocessed:
            return ""
        
        print(f"\n[Python] 翻譯文本: '{text}'")
        print(f"[Python] 預處理後: '{preprocessed}'")
        
        # Tokenize
        encoding = self.tokenizer(preprocessed, return_tensors="np", add_special_tokens=True)
        input_ids = encoding["input_ids"].astype(np.int64)
        attention_mask = encoding["attention_mask"].astype(np.int64)
        
        print(f"[Python] Tokenize 結果: {input_ids[0].tolist()[:10]}... (長度: {len(input_ids[0])})")
        
        # 確保最後一個 token 是 EOS
        if input_ids[0][-1] != self.eos_token_id:
            input_ids = np.append(input_ids[0], self.eos_token_id).reshape(1, -1)
            attention_mask = np.append(attention_mask[0], 1).reshape(1, -1)
        
        # Encoder 推理
        encoder_outputs = self.encoder_session.run(
            None,
            {
                "input_ids": input_ids,
                "attention_mask": attention_mask
            }
        )
        encoder_hidden_states = encoder_outputs[0]  # [batch_size, seq_len, hidden_size]
        
        print(f"[Python] Encoder 輸出 shape: {encoder_hidden_states.shape}")
        
        # Decoder 自回歸生成
        generated_ids = [self.decoder_start_token_id]
        
        for step in range(max_length):
            # 準備 decoder 輸入（整個生成的序列）
            decoder_input_ids = np.array([generated_ids], dtype=np.int64)
            
            # Decoder 推理
            # 注意：opus-mt-en-zh 的 decoder 需要整個序列作為輸入
            decoder_outputs = self.decoder_session.run(
                None,
                {
                    "encoder_attention_mask": attention_mask,
                    "input_ids": decoder_input_ids,
                    "encoder_hidden_states": encoder_hidden_states
                }
            )
            logits = decoder_outputs[0]  # [batch_size, seq_len, vocab_size]
            
            # 提取最後一個位置的 logits
            last_logits = logits[0, -1, :].copy()
            
            # 應用 Repetition Penalty（與 Rust 一致）
            for token_id in generated_ids:
                if 0 <= token_id < len(last_logits):
                    last_logits[token_id] /= self.repetition_penalty
            
            # 檢測 N-gram 重複（與 Rust 一致）
            def has_repeated_ngram(generated_ids, ngram_size, new_token):
                if len(generated_ids) < ngram_size - 1:
                    return False
                check_ngram = generated_ids[-(ngram_size-1):] + [new_token]
                for i in range(len(generated_ids) - ngram_size + 1):
                    if generated_ids[i:i+ngram_size] == check_ngram:
                        return True
                return False
            
            # Token 8 特殊處理（防止空輸出）
            max_idx = int(np.argmax(last_logits))
            next_token_id_candidate = max_idx
            
            if max_idx == 8:
                # 檢查 Token 8 的優勢
                token_8_logit = last_logits[8]
                sorted_indices = np.argsort(last_logits)[::-1]
                if len(sorted_indices) > 1:
                    second_idx = sorted_indices[1]
                    second_logit = last_logits[second_idx]
                    if (token_8_logit - second_logit) > 2.0:
                        next_token_id_candidate = int(second_idx)
                    else:
                        next_token_id_candidate = max_idx
                else:
                    next_token_id_candidate = max_idx
            else:
                # 選擇下一個 token (argmax)
                next_token_id_candidate = max_idx
            
            # 檢查 N-gram 重複
            if has_repeated_ngram(generated_ids, self.no_repeat_ngram_size, next_token_id_candidate):
                # 如果檢測到 N-gram 重複，選擇次優 token
                sorted_indices = np.argsort(last_logits)[::-1]
                found = False
                for idx in sorted_indices[1:]:  # 跳過第一個（已經重複的）
                    candidate_token = int(idx)
                    if not has_repeated_ngram(generated_ids, self.no_repeat_ngram_size, candidate_token):
                        next_token_id_candidate = candidate_token
                        found = True
                        break
                if not found:
                    # 如果所有候選都重複，強制終止
                    print(f"[Python] 警告：所有候選 token 都重複，終止生成")
                    break
            
            next_token_id = next_token_id_candidate
            
            # 檢查是否結束
            if next_token_id == self.eos_token_id:
                break
            
            # 檢查是否生成了 pad_token_id
            if next_token_id == self.decoder_start_token_id:
                if len(generated_ids) > 1 and generated_ids[-1] == self.decoder_start_token_id:
                    break
                continue
            
            generated_ids.append(next_token_id)
        
        print(f"[Python] 生成的 token IDs: {generated_ids[:20]}... (總長度: {len(generated_ids)})")
        
        # Decode
        # 移除 decoder_start_token_id 和 EOS token
        output_ids = []
        for token_id in generated_ids[1:]:  # 跳過 decoder_start_token_id
            if token_id == self.eos_token_id or token_id == 0:
                break
            if token_id != self.decoder_start_token_id:
                output_ids.append(token_id)
        
        if not output_ids:
            return ""
        
        translated = self.tokenizer.decode(output_ids, skip_special_tokens=True)
        
        # 清理 SentencePiece 標記
        translated = translated.replace('▁', ' ').strip()
        
        print(f"[Python] 翻譯結果: '{translated}'")
        return translated


def run_rust_translation(text: str, model_dir: Path) -> str:
    """運行 Rust 翻譯腳本"""
    rust_script = Path(__file__).parent.parent / "scripts" / "test_translation_rust.rs"
    
    if not rust_script.exists():
        print(f"[Rust] 警告：Rust 測試腳本不存在: {rust_script}")
        return None
    
    # 使用 cargo run 運行 Rust 腳本
    # 注意：這需要 Rust 腳本是一個可執行的二進制文件
    # 或者我們可以通過 Tauri 命令來調用
    print(f"[Rust] 注意：需要手動運行 Rust 腳本或通過 Tauri 命令調用")
    return None


def compare_translations(test_texts: List[str], model_dir: Path):
    """比較 Python 和 Rust 的翻譯結果"""
    print("=" * 80)
    print("比較 Python 和 Rust 的 ONNX 翻譯結果")
    print("=" * 80)
    
    # 初始化 Python 翻譯器
    try:
        python_translator = PythonONNXTranslator(model_dir)
    except Exception as e:
        print(f"❌ Python 翻譯器初始化失敗: {e}")
        import traceback
        traceback.print_exc()
        return
    
    results = []
    
    for text in test_texts:
        print("\n" + "=" * 80)
        print(f"測試文本: '{text}'")
        print("=" * 80)
        
        # Python 翻譯
        try:
            python_result = python_translator.translate(text)
            python_success = bool(python_result and python_result.strip())
            python_has_chinese = any('\u4e00' <= c <= '\u9fff' for c in python_result) if python_result else False
        except Exception as e:
            print(f"❌ Python 翻譯失敗: {e}")
            import traceback
            traceback.print_exc()
            python_result = None
            python_success = False
            python_has_chinese = False
        
        # Rust 翻譯（暫時跳過，需要通過 Tauri 命令調用）
        rust_result = None
        rust_success = False
        rust_has_chinese = False
        
        # 記錄結果
        results.append({
            "text": text,
            "python_result": python_result,
            "python_success": python_success,
            "python_has_chinese": python_has_chinese,
            "rust_result": rust_result,
            "rust_success": rust_success,
            "rust_has_chinese": rust_has_chinese,
        })
    
    # 打印總結
    print("\n" + "=" * 80)
    print("比較結果總結")
    print("=" * 80)
    
    for i, result in enumerate(results, 1):
        print(f"\n{i}. 文本: '{result['text']}'")
        print(f"   Python: '{result['python_result']}' "
              f"{'✓' if result['python_success'] else '✗'} "
              f"{'(含中文)' if result['python_has_chinese'] else '(無中文)'}")
        if result['rust_result']:
            print(f"   Rust:   '{result['rust_result']}' "
                  f"{'✓' if result['rust_success'] else '✗'} "
                  f"{'(含中文)' if result['rust_has_chinese'] else '(無中文)'}")
            
            # 比較結果
            if result['python_result'] == result['rust_result']:
                print(f"   ✓ Python 和 Rust 結果一致")
            else:
                print(f"   ⚠ Python 和 Rust 結果不一致")
        else:
            print(f"   Rust:   未測試（需要手動運行 Rust 腳本）")
    
    # 統計
    python_success_count = sum(1 for r in results if r['python_success'])
    python_chinese_count = sum(1 for r in results if r['python_has_chinese'])
    
    print(f"\n統計:")
    print(f"  Python 成功翻譯: {python_success_count}/{len(results)}")
    print(f"  Python 含中文: {python_chinese_count}/{len(results)}")
    
    if any(r['rust_result'] for r in results):
        rust_success_count = sum(1 for r in results if r['rust_success'])
        rust_chinese_count = sum(1 for r in results if r['rust_has_chinese'])
        print(f"  Rust 成功翻譯: {rust_success_count}/{len(results)}")
        print(f"  Rust 含中文: {rust_chinese_count}/{len(results)}")
    
    return results


if __name__ == "__main__":
    # 模型目錄
    model_dir = Path(__file__).parent.parent / "models" / "opus-mt-en-zh-onnx"
    
    if not model_dir.exists():
        print(f"❌ 模型目錄不存在: {model_dir}")
        print("請確保模型已下載並放置在正確的位置")
        sys.exit(1)
    
    # 測試文本
    test_texts = [
        "Hello",
        "Hello world",
        "Hello, how are you?",
        "Good morning",
        "Thank you",
        "I love you",
        "What is your name?",
        "How are you doing today?",
        "The weather is nice today.",
        "This is a test sentence for translation comparison.",
    ]
    
    results = compare_translations(test_texts, model_dir)
    
    # 保存結果到文件
    output_file = Path(__file__).parent / "translation_comparison_results.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"\n結果已保存到: {output_file}")

