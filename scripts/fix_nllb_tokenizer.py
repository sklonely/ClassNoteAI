
import sentencepiece as spm
from tokenizers import Tokenizer, models, pre_tokenizers, decoders, processors, normalizers
import os
import json

model_dir = "models/nllb-200-distilled-600M-onnx-quantized"
spm_path = os.path.join(model_dir, "sentencepiece.bpe.model")
output_path = os.path.join(model_dir, "tokenizer_fixed.json")

print(f"Loading SPM from {spm_path}...")
sp = spm.SentencePieceProcessor()
sp.load(spm_path)

vocab_size = sp.get_piece_size()
print(f"Vocab size (SPM): {vocab_size}")

# 1. 提取詞表
vocab = []
for i in range(vocab_size):
    piece = sp.id_to_piece(i)
    score = sp.get_score(i) # NLLB SPM 可能使用 BPE，score 可能不重要？
    # 對於 BPE，score 通常是 dummy
    vocab.append((piece, score))

# 2. 構建 Tokenizer
# NLLB 使用 SentencePiece BPE 嗎？
# "sentencepiece.bpe.model" 暗示是 BPE
print("Building BPE model...")
# NLLB 的特殊 token 映射
# config.json: bos=0, pad=1, eos=2, unk=3
unk_id = 3
tokenizer = Tokenizer(models.Unigram(vocab, unk_id=unk_id)) # 嘗試 Unigram，雖然名字叫 bpe.model，但 SPM 默認通常是 Unigram。如果是 BPE，這裡應該用 models.BPE

# 檢查一下是否真的是 BPE
# 如果是 BPE，我們需要 merges。SPM BPE 通常不顯式存儲 merges，而是隱含在 vocab 中？
# 不，SPM BPE 也是基於 score 的。models.Unigram 可以模擬 SPM BPE 嗎？
# 事實上，tokenizers 的 Unigram 可以加載 SPM 模型。

# 嘗試直接從 SPM 文件加載
# 如果 Rust 加載 tokenizer.json 失敗，我們可以嘗試用 Python tokenizers 庫加載 SPM 並保存
from tokenizers import SentencePieceBPETokenizer

# 3. 設置 Pre/Post Processor
# NLLB 不需要特殊的 normalization? 
# 讓我們看看 HF tokenizer 的配置
with open(os.path.join(model_dir, "tokenizer.json"), 'r') as f:
    orig_tokenizer_json = json.load(f)

print(f"Original model type: {orig_tokenizer_json['model']['type']}")
# 這裡可能會顯示 "Unigram" 或 "BPE"

if orig_tokenizer_json['model']['type'] == 'Unigram':
    print("Confirmed Unigram model.")
    # 直接使用 vocab 構建 Unigram
    tokenizer = Tokenizer(models.Unigram(vocab, unk_id=unk_id))
else:
    print("Original is BPE? fallback to Unigram logic as SPM usually works well with it")
    tokenizer = Tokenizer(models.Unigram(vocab, unk_id=unk_id))

# Normalizer: NLLB 使用 NFKC
tokenizer.normalizer = normalizers.NFKC()

# PreTokenizer: Metaspace
tokenizer.pre_tokenizer = pre_tokenizers.Metaspace() # 使用默認參數

# Decoder: Metaspace
tokenizer.decoder = decoders.Metaspace()

# PostProcessor: NLLB 不需要自動添加 EOS? 
# generate() 會處理 forced_bos_token_id。
# 但輸入通常不需要 EOS。

# 3. 設置 Pre/Post Processor
# ... (省略)

# 4. 添加 Added Tokens (關鍵步驟)
# 從原 tokenizer.json 讀取 added_tokens
added_tokens_list = orig_tokenizer_json.get("added_tokens", [])
# Tokenizers 庫的 add_tokens 方法需要 Token 對象或字符串
# 我們直接操作 tokenizer 對象
from tokenizers import AddedToken

# 將 added_tokens 轉換為 AddedToken 對象列表
new_added_tokens = []
for t in added_tokens_list:
    # 這裡 t 是一個字典，如 {"id": 0, "content": "<s>", ...}
    # 我們需要保持 ID 不變嗎？
    # Unigram 模型會佔用 0..vocab_size-1 的 ID。
    # NLLB 的 added tokens ID 通常在 vocab_size 之後，或者是特定的 ID。
    # 讓我們檢查一下 vocab_size 和 added tokens 的 ID。
    content = t["content"]
    tid = t["id"]
    special = t["special"]
    
    # 注意：Tokenizer.add_tokens 會自動分配 ID，可能與原 ID 不同。
    # 如果我們需要保持 ID 一致，這比較麻煩。
    # 但 NLLB 的 added tokens 似乎是追加在 vocab 之後的？
    # SPM vocab size: 256000
    # eng_Latn ID: 256047
    # 這說明 added tokens 確實是在 vocab 之後。
    
    token = AddedToken(content, single_word=t["single_word"], lstrip=t["lstrip"], rstrip=t["rstrip"], normalized=t["normalized"], special=special)
    new_added_tokens.append(token)

# 批量添加
# 注意：這可能會重新分配 ID。我們需要確認 ID 是否正確。
# 如果 ID 不正確，模型推理會失敗。
tokenizer.add_tokens(new_added_tokens)

# 檢查 ID 是否正確
eng_id_check = tokenizer.token_to_id("eng_Latn")
print(f"eng_Latn ID (Auto): {eng_id_check}")

# 如果 ID 不對，我們可能需要手動構造 JSON
# 因為 Tokenizers API 不支持指定 ID 添加 token

# 保存
print(f"Saving to {output_path}...")
tokenizer.save(output_path)

# 如果 ID 不對，我們需要後處理 JSON
if eng_id_check != 256047:
    print("ID mismatch, patching JSON manually...")
    with open(output_path, 'r') as f:
        data = json.load(f)
    
    # 替換 added_tokens 為原版的
    data["added_tokens"] = added_tokens_list
    
    # 這裡有個風險：model.vocab 和 added_tokens 的 ID 是否衝突？
    # Unigram model vocab ID: 0..255999
    # Added tokens ID: 0..3 (覆蓋了？) 和 256001...
    
    # NLLB 的 vocab 結構很複雜：
    # 0: <s>
    # 1: <pad>
    # 2: </s>
    # 3: <unk>
    # 4...: 詞表單詞
    
    # 而 SPM 的 vocab 可能是從 0 開始的單詞。
    # 我們構建 Unigram 時，如果傳入的 vocab 包含這些特殊 token 嗎？
    # 讓我們檢查 SPM 的前幾個詞。
    pass # 邏輯在下面處理

# 測試
text = "Hello world"
# ...
print(f"Encoded IDs: {encoded.ids}")
print(f"Encoded tokens: {encoded.tokens}")

# 驗證 'eng_Latn'
eng_id = tokenizer.token_to_id("eng_Latn")
print(f"eng_Latn ID: {eng_id}")

zh_id = tokenizer.token_to_id("zho_Hans")
print(f"zho_Hans ID: {zh_id}")

