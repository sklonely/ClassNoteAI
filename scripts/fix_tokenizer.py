
from tokenizers import Tokenizer
import os

model_dir = "models/opus-mt-en-zh-onnx"
spm_path = os.path.join(model_dir, "source.spm")
text = "Hello"

print(f"Loading SPM from {spm_path}...")

try:
    # 嘗試從 SPM 文件直接創建 Tokenizer
    # 這應該會自動識別並轉換
    # 注意：某些版本的 tokenizers 可能需要特定的調用方式
    
    # 嘗試 1: 直接 from_file (可能不支持 .spm)
    try:
        print("Trying Tokenizer.from_file(spm_path)...")
        tokenizer = Tokenizer.from_file(spm_path)
        encoded = tokenizer.encode(text, add_special_tokens=False).ids
        print(f"Result: {encoded}")
    except Exception as e:
        print(f"from_file failed: {e}")

    # 嘗試 2: 使用 models.Unigram 或 BPE
    # 這通常比較複雜，因為需要詞表
    
    # 嘗試 3: 使用 transformers 的 convert_slow_tokenizer
    print("\nTrying convert_slow_tokenizer...")
    from transformers import MarianTokenizer
    from transformers.convert_slow_tokenizer import convert_slow_tokenizer
    
    slow_tokenizer = MarianTokenizer.from_pretrained(model_dir)
    print(f"Slow tokenizer encode: {slow_tokenizer.encode(text, add_special_tokens=False)}")
    
    fast_tokenizer_obj = convert_slow_tokenizer(slow_tokenizer)
    # fast_tokenizer_obj 是一個 tokenizers.Tokenizer 對象
    
    encoded_fast = fast_tokenizer_obj.encode(text, add_special_tokens=False).ids
    print(f"Fast tokenizer encode: {encoded_fast}")
    
    if encoded_fast == [3828]:
        print("Conversion successful! Saving to tokenizer_fixed.json")
        fast_tokenizer_obj.save(os.path.join(model_dir, "tokenizer_fixed.json"))
        print("Saved.")
    else:
        print("Conversion produced incorrect result.")

except Exception as e:
    print(f"Error: {e}")
