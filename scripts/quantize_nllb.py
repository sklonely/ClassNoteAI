
import os
from pathlib import Path
from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig

MODEL_DIR = Path("models/nllb-200-distilled-600M-onnx")
OUTPUT_DIR = Path("models/nllb-200-distilled-600M-onnx-quantized")

def quantize_model():
    print(f"開始量化模型: {MODEL_DIR}")
    print(f"輸出目錄: {OUTPUT_DIR}")
    
    # Encoder
    print("量化 Encoder...")
    encoder_quantizer = ORTQuantizer.from_pretrained(MODEL_DIR, file_name="encoder_model.onnx")
    dqconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)
    
    encoder_quantizer.quantize(
        save_dir=OUTPUT_DIR,
        quantization_config=dqconfig,
    )
    
    # Decoder
    print("量化 Decoder...")
    decoder_quantizer = ORTQuantizer.from_pretrained(MODEL_DIR, file_name="decoder_model.onnx")
    decoder_quantizer.quantize(
        save_dir=OUTPUT_DIR,
        quantization_config=dqconfig,
    )
    
    # Decoder with past (如果不使用緩存可以跳過，但為了完整性建議保留)
    print("量化 Decoder with past...")
    decoder_past_quantizer = ORTQuantizer.from_pretrained(MODEL_DIR, file_name="decoder_with_past_model.onnx")
    decoder_past_quantizer.quantize(
        save_dir=OUTPUT_DIR,
        quantization_config=dqconfig,
    )
    
    # 複製其他必要文件
    print("複製配置文件...")
    import shutil
    for file in ["config.json", "generation_config.json", "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json"]:
        src = MODEL_DIR / file
        dst = OUTPUT_DIR / file
        if src.exists():
            shutil.copy(src, dst)
            
    print("量化完成！")
    # 檢查文件大小
    total_size = sum(f.stat().st_size for f in OUTPUT_DIR.glob('**/*') if f.is_file())
    print(f"量化後總大小: {total_size / (1024*1024):.2f} MB")

if __name__ == "__main__":
    quantize_model()


