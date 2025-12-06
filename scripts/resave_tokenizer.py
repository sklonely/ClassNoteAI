
from tokenizers import Tokenizer
import os

model_dir = "models/nllb-200-distilled-600M-onnx-quantized"
spm_path = os.path.join(model_dir, "sentencepiece.bpe.model")
output_path = os.path.join(model_dir, "tokenizer_from_spm_patched.json")
orig_tokenizer_path = os.path.join(model_dir, "tokenizer.json.orig") # 原版

print(f"Loading tokenizer from {spm_path}...")
from tokenizers import SentencePieceBPETokenizer, AddedToken
tokenizer = SentencePieceBPETokenizer(spm_path)

# 加載原版以獲取 added_tokens
print(f"Loading original added_tokens from {orig_tokenizer_path}...")
import json
with open(orig_tokenizer_path, 'r') as f:
    orig_data = json.load(f)
    added_tokens_list = orig_data.get("added_tokens", [])

# 添加 added_tokens
# 注意：這裡我們使用 add_tokens，它會自動分配 ID。
# 我們需要確保分配的 ID 與原版一致（原版通常是在 vocab 之後）
# SPM vocab size: 256000
# 第一個 added token (eng_Latn) ID 應該是 ?
# 原版: 256047. 
# 0-3 是特殊 token。
# 256001 是 ace_Arab。

# 我們可以直接將 added_tokens 注入到 JSON 中，而不通過 Tokenizer API，
# 因為 Tokenizer API 可能會重新分配 ID。

print(f"Saving tokenizer to {output_path}...")
tokenizer.save(output_path)

# 讀取剛保存的 JSON 並修補
with open(output_path, 'r') as f:
    new_data = json.load(f)

# 注入 added_tokens
new_data["added_tokens"] = added_tokens_list

# 還需要確保 model.vocab 包含這些 token 嗎？
# 對於 BPE，vocab 通常只包含 SPM 的詞。added_tokens 是獨立的。

# 保存修補後的 JSON
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(new_data, f, indent=2, ensure_ascii=False)

print("Done.")

print("Done.")

