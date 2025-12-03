#!/usr/bin/env python3
"""
創建正確的 tokenizer.json 文件
使用 vocab.json 和 source.spm 創建與 Python transformers 兼容的 tokenizer.json
"""

import json
import os
from pathlib import Path

try:
    import sentencepiece as spm
    from transformers import AutoTokenizer
    from tokenizers import Tokenizer
    from tokenizers.models import BPE
    from tokenizers.pre_tokenizers import ByteLevel
    from tokenizers.processors import BertProcessing
except ImportError:
    print("錯誤：請先安裝依賴")
    print("pip install sentencepiece transformers tokenizers")
    exit(1)


def create_correct_tokenizer_json(model_dir: str):
    """創建正確的 tokenizer.json"""
    model_path = Path(model_dir)
    source_spm = model_path / "source.spm"
    vocab_json = model_path / "vocab.json"
    tokenizer_json = model_path / "tokenizer.json"
    
    if not source_spm.exists():
        print(f"錯誤：source.spm 不存在: {source_spm}")
        return False
    
    if not vocab_json.exists():
        print(f"錯誤：vocab.json 不存在: {vocab_json}")
        return False
    
    print(f"創建正確的 tokenizer.json...")
    print(f"  模型目錄: {model_dir}")
    
    # 讀取 vocab.json
    with open(vocab_json, 'r', encoding='utf-8') as f:
        vocab = json.load(f)
    
    print(f"  詞彙表大小: {len(vocab)}")
    
    # 方法：使用 Python transformers 的 backend_tokenizer（如果可用）
    try:
        from transformers import AutoTokenizer
        
        print("\n嘗試從 HuggingFace 獲取正確的 tokenizer...")
        
        # 從 HuggingFace 下載 tokenizer
        tokenizer = AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-en-zh')
        
        # 檢查是否有 backend_tokenizer
        if hasattr(tokenizer, 'backend_tokenizer') and tokenizer.backend_tokenizer is not None:
            print("✓ 找到 backend_tokenizer")
            
            # 保存為 tokenizer.json
            backend_tokenizer = tokenizer.backend_tokenizer
            backend_tokenizer.save(str(tokenizer_json))
            
            print(f"✓ tokenizer.json 已保存: {tokenizer_json}")
            
            # 驗證
            rust_tokenizer = Tokenizer.from_file(str(tokenizer_json))
            text = "Hello, how are you?"
            encoding = rust_tokenizer.encode(text, add_special_tokens=True)
            hf_ids = tokenizer.encode(text, add_special_tokens=True)
            
            print(f"\n驗證結果:")
            print(f"  Rust tokenizers 編碼: {encoding.ids}")
            print(f"  Python transformers 編碼: {hf_ids}")
            print(f"  是否一致: {encoding.ids == hf_ids}")
            
            if encoding.ids == hf_ids:
                print("\n✓ tokenizer.json 創建成功！")
                return True
            else:
                print("\n⚠ tokenizer.json 已生成，但編碼結果不一致")
                return False
        else:
            print("✗ 無法獲取 backend_tokenizer")
            print("  MarianTokenizer 可能不支持 fast tokenizer")
            
            # 備用方案：手動創建 tokenizer.json
            print("\n嘗試手動創建 tokenizer.json...")
            return create_tokenizer_json_manually(model_path, vocab, source_spm)
            
    except Exception as e:
        print(f"✗ 使用 transformers 失敗: {e}")
        import traceback
        traceback.print_exc()
        
        # 備用方案：手動創建
        print("\n嘗試手動創建 tokenizer.json...")
        return create_tokenizer_json_manually(model_path, vocab, source_spm)


def create_tokenizer_json_manually(model_path: Path, vocab: dict, source_spm: Path) -> bool:
    """手動創建 tokenizer.json"""
    print("\n手動創建 tokenizer.json（這可能不完美）...")
    
    # 讀取 tokenizer_config.json 獲取特殊 token 信息
    tokenizer_config_json = model_path / "tokenizer_config.json"
    special_tokens = {}
    if tokenizer_config_json.exists():
        with open(tokenizer_config_json, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        if 'added_tokens_decoder' in config:
            for token_id_str, token_info in config['added_tokens_decoder'].items():
                token_id = int(token_id_str)
                token_content = token_info.get('content', '')
                special_tokens[token_content] = token_id
    
    print(f"  特殊 tokens: {special_tokens}")
    
    # 創建 BPE 模型
    # 注意：這需要從 vocab.json 和 source.spm 構建
    # 但 tokenizers crate 的 BPE 模型格式與 SentencePiece 不同
    
    print("\n⚠ 無法自動創建正確的 tokenizer.json")
    print("建議：")
    print("  1. 使用 Python transformers 的 tokenizer 進行 tokenization")
    print("  2. 或者實現一個手動的 tokenization 方法，使用 vocab.json 映射")
    
    return False


if __name__ == '__main__':
    import sys
    
    model_dir = sys.argv[1] if len(sys.argv) > 1 else 'models/opus-mt-en-zh-onnx'
    
    if not os.path.exists(model_dir):
        print(f"錯誤：模型目錄不存在: {model_dir}")
        sys.exit(1)
    
    success = create_correct_tokenizer_json(model_dir)
    sys.exit(0 if success else 1)

