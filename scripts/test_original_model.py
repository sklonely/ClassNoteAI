#!/usr/bin/env python3
"""
測試原始 HuggingFace 模型（不通過 ONNX）
用於對比 ONNX 轉換後的結果
"""

import sys
import os
from pathlib import Path

try:
    from transformers import AutoTokenizer, MarianMTModel
    import torch
except ImportError as e:
    print(f"錯誤：請先安裝依賴: {e}")
    print("pip install transformers torch")
    sys.exit(1)


class OriginalModelTranslator:
    """使用原始 HuggingFace 模型進行翻譯"""
    
    def __init__(self, model_name: str = "Helsinki-NLP/opus-mt-en-zh"):
        self.model_name = model_name
        
        print(f"[OriginalModel] 加載模型: {model_name}")
        print("這可能需要一些時間...")
        
        # 加載 tokenizer 和模型
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = MarianMTModel.from_pretrained(model_name)
        self.model.eval()  # 設置為評估模式
        
        print(f"[OriginalModel] 模型加載成功")
    
    def translate(self, text: str, max_length: int = 150) -> str:
        """翻譯文本"""
        # 預處理
        preprocessed = text.strip()
        preprocessed = ' '.join(preprocessed.split())
        
        if not preprocessed:
            return ""
        
        print(f"\n[OriginalModel] 翻譯文本: '{text}'")
        print(f"[OriginalModel] 預處理後: '{preprocessed}'")
        
        # Tokenize
        inputs = self.tokenizer(preprocessed, return_tensors="pt", padding=True, add_special_tokens=True)
        input_ids = inputs["input_ids"]
        
        print(f"[OriginalModel] Tokenize 結果: {input_ids[0].tolist()[:10]}... (長度: {input_ids.shape[1]})")
        
        # 使用模型的 generate 方法（標準方式）
        with torch.no_grad():
            outputs = self.model.generate(
                input_ids,
                max_length=max_length,
                num_beams=1,  # 使用貪心搜索（與 ONNX 一致）
                do_sample=False,  # 不使用採樣
                early_stopping=True,
                no_repeat_ngram_size=2,  # 防止 2-gram 重複
                repetition_penalty=1.5,  # 與 ONNX 實現一致
            )
        
        # Decode
        translated = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        print(f"[OriginalModel] 生成的 token IDs: {outputs[0].tolist()[:20]}... (總長度: {len(outputs[0])})")
        print(f"[OriginalModel] 翻譯結果: '{translated}'")
        
        return translated


def test_original_model():
    """測試原始模型"""
    print("=" * 80)
    print("測試原始 HuggingFace 模型（不通過 ONNX）")
    print("=" * 80)
    
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
    
    try:
        translator = OriginalModelTranslator()
        
        results = []
        for text in test_texts:
            print("\n" + "=" * 80)
            print(f"測試文本: '{text}'")
            print("=" * 80)
            
            try:
                result = translator.translate(text)
                has_chinese = any('\u4e00' <= c <= '\u9fff' for c in result)
                results.append({
                    "text": text,
                    "result": result,
                    "success": bool(result and result.strip()),
                    "has_chinese": has_chinese,
                })
            except Exception as e:
                print(f"❌ 翻譯失敗: {e}")
                import traceback
                traceback.print_exc()
                results.append({
                    "text": text,
                    "result": None,
                    "success": False,
                    "has_chinese": False,
                })
        
        # 打印總結
        print("\n" + "=" * 80)
        print("測試總結")
        print("=" * 80)
        
        success_count = sum(1 for r in results if r['success'])
        chinese_count = sum(1 for r in results if r['has_chinese'])
        
        print(f"成功翻譯: {success_count}/{len(results)}")
        print(f"含中文: {chinese_count}/{len(results)}")
        
        print("\n詳細結果:")
        for i, r in enumerate(results, 1):
            status = "✓" if r['success'] else "✗"
            chinese_mark = "(含中文)" if r['has_chinese'] else "(無中文)"
            print(f"{i}. '{r['text']}' → '{r['result']}' {status} {chinese_mark}")
        
        return results
        
    except Exception as e:
        print(f"❌ 初始化失敗: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    results = test_original_model()
    
    # 保存結果
    if results:
        import json
        output_file = Path(__file__).parent / "original_model_results.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\n結果已保存到: {output_file}")


