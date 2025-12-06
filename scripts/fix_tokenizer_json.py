#!/usr/bin/env python3
"""
修復 tokenizer.json 文件
從 source.spm 和 vocab.json 創建正確的 tokenizer.json 格式
"""

import json
import os
from pathlib import Path

try:
    import sentencepiece as spm
    from tokenizers import Tokenizer
    from tokenizers.models import BPE
    from tokenizers.pre_tokenizers import ByteLevel
    from tokenizers.processors import BertProcessing
    from tokenizers import normalizers
except ImportError:
    print("錯誤：請先安裝依賴")
    print("pip install sentencepiece tokenizers")
    exit(1)


def fix_tokenizer_json(model_dir: str):
    """修復 tokenizer.json 文件"""
    model_path = Path(model_dir)
    source_spm = model_path / "source.spm"
    vocab_json = model_path / "vocab.json"
    tokenizer_json = model_path / "tokenizer.json"
    tokenizer_config_json = model_path / "tokenizer_config.json"
    
    if not source_spm.exists():
        print(f"錯誤：source.spm 不存在: {source_spm}")
        return False
    
    if not vocab_json.exists():
        print(f"錯誤：vocab.json 不存在: {vocab_json}")
        return False
    
    print(f"修復 tokenizer.json...")
    print(f"  模型目錄: {model_dir}")
    print(f"  source.spm: {source_spm.exists()}")
    print(f"  vocab.json: {vocab_json.exists()}")
    
    # 讀取 vocab.json
    with open(vocab_json, 'r', encoding='utf-8') as f:
        vocab = json.load(f)
    
    print(f"  詞彙表大小: {len(vocab)}")
    
    # 讀取 tokenizer_config.json 獲取特殊 token 信息
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
    
    # 方法：使用 transformers 庫重新生成正確的 tokenizer.json
    try:
        from transformers import AutoTokenizer
        
        print("\n嘗試使用 transformers 重新生成 tokenizer.json...")
        
        # 從 HuggingFace 重新下載 tokenizer（確保是最新的）
        print("從 HuggingFace 下載 tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-en-zh')
        
        # 檢查是否有 fast tokenizer
        if hasattr(tokenizer, 'backend_tokenizer') and tokenizer.backend_tokenizer is not None:
            print("✓ 找到 fast tokenizer (backend_tokenizer)")
            
            # 保存 backend_tokenizer 為 tokenizer.json
            backend_tokenizer = tokenizer.backend_tokenizer
            backend_tokenizer.save(str(tokenizer_json))
            
            print(f"✓ tokenizer.json 已保存: {tokenizer_json}")
            
            # 驗證新的 tokenizer.json
            rust_tokenizer = Tokenizer.from_file(str(tokenizer_json))
            text = "Hello, how are you?"
            encoding = rust_tokenizer.encode(text, add_special_tokens=True)
            
            # 與 Python transformers 對比
            hf_ids = tokenizer.encode(text, add_special_tokens=True)
            
            print(f"\n驗證結果:")
            print(f"  Rust tokenizers 編碼: {encoding.ids}")
            print(f"  Python transformers 編碼: {hf_ids}")
            print(f"  是否一致: {encoding.ids == hf_ids}")
            
            if encoding.ids == hf_ids:
                print("\n✓ tokenizer.json 修復成功！")
                return True
            else:
                print("\n⚠ tokenizer.json 已生成，但編碼結果不一致")
                return False
        else:
            print("✗ 無法獲取 fast tokenizer")
            print("  這可能是因為 MarianTokenizer 不支持 fast tokenizer")
            return False
            
    except Exception as e:
        print(f"✗ 使用 transformers 重新生成失敗: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    import sys
    
    model_dir = sys.argv[1] if len(sys.argv) > 1 else 'models/opus-mt-en-zh-onnx'
    
    if not os.path.exists(model_dir):
        print(f"錯誤：模型目錄不存在: {model_dir}")
        sys.exit(1)
    
    success = fix_tokenizer_json(model_dir)
    sys.exit(0 if success else 1)


