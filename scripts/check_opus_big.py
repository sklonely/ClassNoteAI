
from transformers import AutoTokenizer
import json

model_name = "Helsinki-NLP/opus-mt-tc-big-en-zh"
print(f"Downloading tokenizer for {model_name}...")
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.save_pretrained("models/opus-mt-tc-big-en-zh-tokenizer")

with open("models/opus-mt-tc-big-en-zh-tokenizer/tokenizer.json", "r") as f:
    data = json.load(f)
    print(f"Model Type: {data['model']['type']}")


