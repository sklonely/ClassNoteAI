
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoTokenizer
import time

MODEL_DIR = "models/nllb-200-distilled-600M-onnx-quantized"

print(f"正在加載 ONNX 模型: {MODEL_DIR}")
tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
model = ORTModelForSeq2SeqLM.from_pretrained(
    MODEL_DIR,
    encoder_file_name="encoder_model_quantized.onnx",
    decoder_file_name="decoder_model_quantized.onnx",
    decoder_with_past_file_name="decoder_with_past_model_quantized.onnx"
)

text = "Hello world"
src_lang = "eng_Latn"
tgt_lang = "zho_Hans"

tokenizer.src_lang = src_lang

# 測試 1: 標準調用
inputs = tokenizer(text, return_tensors="pt")
print(f"Input IDs (Standard): {inputs['input_ids'][0].tolist()}")

forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_lang)
outputs = model.generate(**inputs, forced_bos_token_id=forced_bos_token_id, max_length=200)
print(f"Result (Standard): {tokenizer.decode(outputs[0], skip_special_tokens=True)}")

# 測試 2: 手動添加源語言標記
src_id = tokenizer.convert_tokens_to_ids(src_lang)
input_ids = inputs['input_ids'][0].tolist()
# 移除 EOS (2)
if input_ids[-1] == 2:
    input_ids.pop()
# 添加 SRC + input + EOS
input_ids_with_src = [src_id] + input_ids + [2]

import torch
inputs_manual = {"input_ids": torch.tensor([input_ids_with_src]), "attention_mask": torch.tensor([[1]*len(input_ids_with_src)])}
print(f"Input IDs (Manual with SRC): {input_ids_with_src}")

outputs_manual = model.generate(**inputs_manual, forced_bos_token_id=forced_bos_token_id, max_length=200)
print(f"Result (Manual with SRC): {tokenizer.decode(outputs_manual[0], skip_special_tokens=True)}")


