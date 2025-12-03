#!/usr/bin/env python3
"""
將 facebook/m2m100_418M 模型轉換為 ONNX 格式
這是一個專門設計用於翻譯的模型，可能比 MBart-Large-50 效果更好
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
            use_cache=False
        )
        
        # 保存模型
        model.save_pretrained(str(output_dir))
        print(f"✓ 模型已保存到 {output_dir}")
        
        # 保存 tokenizer
        print("\n步驟 2/2: 下載並保存 tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        tokenizer.save_pretrained(str(output_dir), legacy_format=False)
        
        # 驗證 tokenizer.json 是否存在
        tokenizer_json_path = output_dir / "tokenizer.json"
        if tokenizer_json_path.exists():
            print(f"✓ tokenizer.json 已保存: {tokenizer_json_path}")
            
            # 檢查文件大小
            file_size_mb = tokenizer_json_path.stat().st_size / (1024 * 1024)
            print(f"  tokenizer.json 大小: {file_size_mb:.2f} MB")
            
            if file_size_mb > 30:
                print("  ⚠ 警告：tokenizer.json 較大，可能無法在 Rust 中載入")
            else:
                # 驗證 tokenizer.json 格式
                try:
                    from tokenizers import Tokenizer as RustTokenizer
                    rust_tokenizer = RustTokenizer.from_file(str(tokenizer_json_path))
                    text = "Hello, how are you?"
                    encoding = rust_tokenizer.encode(text, add_special_tokens=True)
                    hf_ids = tokenizer.encode(text, add_special_tokens=True)
                    
                    print(f"\n驗證 tokenizer.json:")
                    print(f"  Rust tokenizers 編碼: {encoding.ids[:10]}... (長度: {len(encoding.ids)})")
                    print(f"  Python transformers 編碼: {hf_ids[:10]}... (長度: {len(hf_ids)})")
                    print(f"  是否一致: {encoding.ids == hf_ids}")
                    
                    if encoding.ids == hf_ids:
                        print("\n✓ tokenizer.json 格式正確！")
                    else:
                        print("\n⚠ tokenizer.json 格式可能仍有問題")
                except Exception as e:
                    print(f"  ⚠ 無法驗證 tokenizer.json: {e}")
        else:
            print("⚠ tokenizer.json 未生成")
        
        print(f"\n✓ 轉換完成！模型已保存到: {output_dir}")
        
        # 檢查生成的文件
        print("\n生成的文件:")
        for file in sorted(output_dir.iterdir()):
            size = file.stat().st_size
            size_mb = size / (1024 * 1024)
            print(f"  - {file.name}: {size_mb:.2f} MB")
        
    except Exception as e:
        print(f"\n✗ 轉換失敗: {e}")
        import traceback
        traceback.print_exc()
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='將 m2m100_418M 模型轉換為 ONNX 格式')
    parser.add_argument('--output-dir', type=str, default='models/m2m100_418M-onnx',
                        help='輸出目錄（默認: models/m2m100_418M-onnx）')
    
    args = parser.parse_args()
    
    model_name = "facebook/m2m100_418M"
    output_dir = Path(args.output_dir)
    
    print("=" * 60)
    print("M2M100-418M 模型轉換工具")
    print("=" * 60)
    print(f"模型: {model_name}")
    print(f"輸出: {output_dir}")
    print("=" * 60)
    
    convert_model(model_name, output_dir)


