
from transformers import AutoTokenizer
from tokenizers import Tokenizer
import os

model_dir = "models/opus-mt-en-zh-onnx"
text = "Hello"

print(f"Testing tokenizer in: {model_dir}")

# 1. Transformers AutoTokenizer
try:
    auto_tokenizer = AutoTokenizer.from_pretrained(model_dir)
    encoded_auto = auto_tokenizer(text, add_special_tokens=False)["input_ids"]
    print(f"Transformers AutoTokenizer: {encoded_auto}")
except Exception as e:
    print(f"Transformers error: {e}")

# 2. Tokenizers library (Rust binding) loading tokenizer.json
json_path = os.path.join(model_dir, "tokenizer.json")
if os.path.exists(json_path):
    try:
        rust_tokenizer = Tokenizer.from_file(json_path)
        encoded_rust = rust_tokenizer.encode(text, add_special_tokens=False).ids
        print(f"Tokenizers (JSON): {encoded_rust}")
    except Exception as e:
        print(f"Tokenizers error: {e}")
else:
    print("tokenizer.json not found")


