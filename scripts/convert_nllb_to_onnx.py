
import os
import shutil
from pathlib import Path
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoTokenizer

# 配置
MODEL_ID = "facebook/nllb-200-distilled-600M"
OUTPUT_DIR = Path("models/nllb-200-distilled-600M-onnx")

def convert_model():
    print(f"開始轉換模型: {MODEL_ID}")
    print(f"輸出目錄: {OUTPUT_DIR}")
    
    if OUTPUT_DIR.exists():
        print("輸出目錄已存在，正在清理...")
        shutil.rmtree(OUTPUT_DIR)
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    print("正在加載並轉換模型 (這可能需要幾分鐘)...")
    
    # 使用 Optimum 進行轉換
    # 這會自動處理 Encoder/Decoder 的導出
    model = ORTModelForSeq2SeqLM.from_pretrained(MODEL_ID, export=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    
    print("正在保存 ONNX 模型...")
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    
    print("轉換完成！")
    print(f"模型文件位於: {OUTPUT_DIR}")
    
    # 檢查文件大小
    total_size = sum(f.stat().st_size for f in OUTPUT_DIR.glob('**/*') if f.is_file())
    print(f"總大小: {total_size / (1024*1024):.2f} MB")

if __name__ == "__main__":
    convert_model()
