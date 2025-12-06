
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoTokenizer
import time

MODEL_DIR = "models/nllb-200-distilled-600M-onnx-quantized"
# MODEL_DIR = "models/nllb-200-distilled-600M-onnx" # 測試未量化版本

print(f"正在加載 ONNX 模型: {MODEL_DIR}")
start = time.time()

tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
# 指定量化後的文件名
model = ORTModelForSeq2SeqLM.from_pretrained(
    MODEL_DIR,
    encoder_file_name="encoder_model_quantized.onnx",
    decoder_file_name="decoder_model_quantized.onnx",
    decoder_with_past_file_name="decoder_with_past_model_quantized.onnx"
)

print(f"加載耗時: {time.time() - start:.2f}s")

# 測試句子
texts = [
    "Hello world",
    "Rust guarantees memory safety without a garbage collector.",
    "The latency is too high for real-time applications."
]

print("\n開始翻譯測試...")
src_lang = "eng_Latn"
tgt_lang = "zho_Hans"

tokenizer.src_lang = src_lang

for text in texts:
    start_trans = time.time()
    
    inputs = tokenizer(text, return_tensors="pt")
    
    # NLLB 關鍵：forced_bos_token_id
    # NllbTokenizerFast 沒有 lang_code_to_id 屬性，需要使用 convert_tokens_to_ids
    forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_lang)
    
    outputs = model.generate(
        **inputs, 
        forced_bos_token_id=forced_bos_token_id,
        max_length=200
    )
    
    result = tokenizer.decode(outputs[0], skip_special_tokens=True)
    print(f"原文: {text}")
    print(f"譯文: {result}")
    print(f"耗時: {(time.time() - start_trans)*1000:.2f} ms")
    print("-" * 30)

