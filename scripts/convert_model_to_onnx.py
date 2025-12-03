#!/usr/bin/env python3
"""
將 Helsinki-NLP/opus-mt-en-zh 模型轉換為 ONNX 格式

使用方法:
    python convert_model_to_onnx.py [--output-dir OUTPUT_DIR]

依賴:
    pip install optimum[onnxruntime] transformers torch
"""

import argparse
import os
from pathlib import Path

try:
    from optimum.onnxruntime import ORTModelForSeq2SeqLM
    from transformers import AutoTokenizer
except ImportError:
    print("錯誤：請先安裝依賴")
    print("pip install optimum[onnxruntime] transformers torch")
    exit(1)


def convert_model(model_name: str, output_dir: Path):
    """轉換模型為 ONNX 格式"""
    print(f"正在轉換模型: {model_name}")
    print(f"輸出目錄: {output_dir}")
    
    # 確保輸出目錄存在
    output_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # 轉換模型
        print("\n步驟 1/2: 轉換模型為 ONNX 格式...")
        model = ORTModelForSeq2SeqLM.from_pretrained(
            model_name,
            export=True,
            use_cache=False  # 翻譯模型通常不需要 cache
        )
        
        # 保存模型
        model.save_pretrained(str(output_dir))
        print(f"✓ 模型已保存到 {output_dir}")
        
        # 保存 tokenizer
        print("\n步驟 2/2: 下載並保存 tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        tokenizer.save_pretrained(str(output_dir))
        
        # 嘗試保存為 tokenizer.json 格式（用於 Rust tokenizers crate）
        try:
            # 嘗試使用 fast tokenizer
            from transformers import AutoTokenizer
            try:
                # 重新加載為 fast tokenizer（如果可用）
                fast_tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True)
                tokenizer_path = output_dir / "tokenizer.json"
                fast_tokenizer.save_pretrained(str(output_dir), legacy_format=False)
                if (output_dir / "tokenizer.json").exists():
                    print(f"✓ Tokenizer JSON 已保存: {tokenizer_path}")
                else:
                    raise Exception("Fast tokenizer 不可用")
            except:
                # 如果 fast tokenizer 不可用，嘗試從 backend_tokenizer 獲取
                if hasattr(tokenizer, 'backend_tokenizer') and tokenizer.backend_tokenizer is not None:
                    tokenizer_path = output_dir / "tokenizer.json"
                    tokenizer.backend_tokenizer.save(str(tokenizer_path))
                    print(f"✓ Tokenizer JSON 已保存: {tokenizer_path}")
                else:
                    raise Exception("無法獲取 backend_tokenizer")
        except Exception as e:
            print(f"⚠ 無法保存 tokenizer.json: {e}")
            print("   將使用 vocab.json 和 SentencePiece 文件")
            print("   注意：Rust tokenizers crate 需要 tokenizer.json，請手動創建")
        
        print(f"✓ Tokenizer 已保存到 {output_dir}")
        
        # 檢查生成的文件
        print("\n生成的文件:")
        for file in sorted(output_dir.iterdir()):
            size = file.stat().st_size
            size_mb = size / (1024 * 1024)
            print(f"  - {file.name}: {size_mb:.2f} MB")
        
        print(f"\n✓ 轉換完成！模型已保存到: {output_dir}")
        print(f"\n下一步:")
        print(f"1. 將模型文件上傳到可訪問的位置（如 GitHub Releases、雲存儲等）")
        print(f"2. 更新 src-tauri/src/translation/download.rs 中的模型 URL")
        print(f"3. 更新 expected_size 為實際模型大小")
        
    except Exception as e:
        print(f"\n✗ 轉換失敗: {e}")
        print("\n可能的解決方案:")
        print("1. 檢查網絡連接（需要下載模型）")
        print("2. 確保有足夠的磁盤空間")
        print("3. 檢查 Python 依賴是否正確安裝")
        raise


def main():
    parser = argparse.ArgumentParser(
        description="將翻譯模型轉換為 ONNX 格式"
    )
    parser.add_argument(
        "--model",
        default="Helsinki-NLP/opus-mt-en-zh",
        help="要轉換的模型名稱（默認: Helsinki-NLP/opus-mt-en-zh）"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent.parent / "models" / "opus-mt-en-zh-onnx",
        help="輸出目錄（默認: models/opus-mt-en-zh-onnx）"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("ONNX 模型轉換工具")
    print("=" * 60)
    print(f"模型: {args.model}")
    print(f"輸出: {args.output_dir}")
    print("=" * 60)
    
    convert_model(args.model, args.output_dir)


if __name__ == "__main__":
    main()

