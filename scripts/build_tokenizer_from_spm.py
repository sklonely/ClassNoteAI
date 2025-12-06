
import sentencepiece as spm
from tokenizers import Tokenizer, models, pre_tokenizers, decoders, processors, normalizers
import os
import json

model_dir = "models/opus-mt-en-zh-onnx"
spm_path = os.path.join(model_dir, "source.spm")
vocab_path = os.path.join(model_dir, "vocab.json")
output_path = os.path.join(model_dir, "tokenizer_fixed.json")

print(f"Loading SPM from {spm_path}...")
sp = spm.SentencePieceProcessor()
sp.load(spm_path)

print(f"Loading vocab from {vocab_path}...")
with open(vocab_path, 'r', encoding='utf-8') as f:
    hf_vocab = json.load(f)

print(f"HF Vocab size: {len(hf_vocab)}")

# 构建新的 vocab list (piece, score)
# 按照 ID 排序
new_vocab = [None] * len(hf_vocab)
missing_pieces = []

for piece, id in hf_vocab.items():
    # 尝试在 SPM 中找到 piece 的 score
    # 注意：HF vocab 中的 piece 可能与 SPM 中的略有不同（例如特殊字符）
    # 但通常是一致的
    
    # 特殊 token 处理
    if piece == "</s>":
        score = 0.0 # 或者 sp.get_score(sp.piece_to_id("</s>"))
    elif piece == "<unk>":
        score = 0.0
    elif piece == "<pad>":
        score = 0.0
    else:
        # SPM lookup
        sp_id = sp.piece_to_id(piece)
        if sp_id == sp.unk_id() and piece != "<unk>":
            # 在 SPM 中找不到该 piece (变成了 unk)
            # 尝试处理 Metaspace 前缀
            # HF: " The" vs SPM: " The" (U+2581)
            # 应该是一样的
            missing_pieces.append(piece)
            score = -10.0 # 默认低分
        else:
            score = sp.get_score(sp_id)
            
    if 0 <= id < len(new_vocab):
        new_vocab[id] = (piece, score)

# 检查是否有空位
for i, item in enumerate(new_vocab):
    if item is None:
        print(f"Warning: ID {i} is None in new_vocab")
        new_vocab[i] = ("<unk>", -100.0) # Fallback

print(f"Missing pieces count: {len(missing_pieces)}")
if len(missing_pieces) > 0:
    print(f"First 10 missing: {missing_pieces[:10]}")

# 构件 Unigram 模型
print("Building Unigram model...")
# unk_id 应该是 <unk> 的 ID
unk_id = hf_vocab.get("<unk>", 1)
print(f"Using unk_id: {unk_id}")

tokenizer = Tokenizer(models.Unigram(new_vocab, unk_id=unk_id))

# Normalizer: Marian 不使用预标准化的 NFKC?
# HF 的输出显示它处理了 Metaspace。
tokenizer.normalizer = normalizers.NFKC()

# PreTokenizer: Metaspace
tokenizer.pre_tokenizer = pre_tokenizers.Metaspace() # 使用默认值

# Decoder: Metaspace
tokenizer.decoder = decoders.Metaspace()

# PostProcessor
# HF: [3828, 0] -> "Hello" + EOS
eos_id = hf_vocab.get("</s>", 0)
tokenizer.post_processor = processors.TemplateProcessing(
    single="$A </s>",
    pair="$A </s> $B </s>",
    special_tokens=[
        ("</s>", eos_id),
    ],
)

# Test
text = "Hello"
print(f"Testing text: '{text}'")
encoded = tokenizer.encode(text)
print(f"Encoded IDs: {encoded.ids}")

# Verify with HF
from transformers import MarianTokenizer
hf_tokenizer = MarianTokenizer.from_pretrained(model_dir)
hf_encoded = hf_tokenizer.encode(text, add_special_tokens=True)
print(f"HF encoded: {hf_encoded}")

if encoded.ids == hf_encoded:
    print("✓ Encoding matches HF!")
    print(f"Saving to {output_path}...")
    tokenizer.save(output_path)
else:
    print("✗ Encoding mismatch.")
