
import os
import time
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import json
from tabulate import tabulate

# 測試數據集
TEST_SENTENCES = [
    # 1. 基礎短句（Opus 容易重複的地方）
    ("Hello", "問候"),
    ("Good morning", "問候"),
    ("Thank you", "日常"),
    ("I love you", "日常"),
    
    # 2. 課堂常用語
    ("Let's look at this equation.", "教學"),
    ("Can everyone see the screen?", "教學"),
    ("Today we are going to discuss neural networks.", "教學"),
    ("Please turn to page 42.", "教學"),
    
    # 3. 計算機科學術語
    ("The function returns a promise that resolves to an object.", "技術"),
    ("We need to install the dependencies using npm.", "技術"),
    ("Rust guarantees memory safety without a garbage collector.", "技術"),
    ("The latency is too high for real-time applications.", "技術"),
    
    # 4. 複雜長句
    ("Although the model is small, it performs surprisingly well on specific tasks if fine-tuned correctly.", "長句"),
    ("In this lecture, we will explore how transformers revolutionized natural language processing by using attention mechanisms.", "長句"),
    
    # 5. 口語與不完整句子
    ("So, um, basically...", "口語"),
    ("If we... you know, try to run this...", "口語"),
]

# 候選模型列表
MODELS_TO_TEST = [
    {
        "name": "Helsinki-NLP/opus-mt-en-zh",
        "desc": "當前模型 (77M)",
        "src_lang": None,
        "tgt_lang": None
    },
    {
        "name": "facebook/nllb-200-distilled-600M",
        "desc": "Meta NLLB (600M)",
        "src_lang": "eng_Latn",
        "tgt_lang": "zho_Hans" 
    }
    # 如果顯存/內存允許，可以取消註釋
    # {
    #     "name": "facebook/mbart-large-50-many-to-many-mmt",
    #     "desc": "MBart Large (600M+)",
    #     "src_lang": "en_XX",
    #     "tgt_lang": "zh_CN"
    # }
]

def evaluate_model(model_info):
    model_name = model_info["name"]
    print(f"\n{'='*60}")
    print(f"正在評估模型: {model_name} ({model_info['desc']})")
    print(f"{'='*60}")
    
    try:
        print("正在加載模型 (這可能需要幾分鐘)...")
        start_load = time.time()
        
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
        
        # 設置設備 (優先使用 MPS (Mac) 或 CUDA)
        device = "cpu"
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        
        print(f"使用設備: {device}")
        model.to(device)
        model.eval()
        
        load_time = time.time() - start_load
        print(f"加載完成，耗時: {load_time:.2f}秒")
        
        results = []
        
        print("\n開始翻譯測試...")
        for text, category in TEST_SENTENCES:
            start_trans = time.time()
            
            # 構建輸入參數
            if model_info["src_lang"]:
                tokenizer.src_lang = model_info["src_lang"]
                
            inputs = tokenizer(text, return_tensors="pt", padding=True)
            inputs = {k: v.to(device) for k, v in inputs.items()}
            
            # 生成參數
            gen_kwargs = {
                "max_length": 200,
                "num_beams": 3, # 稍微好一點的搜索
                "no_repeat_ngram_size": 2, # 防止重複
                "repetition_penalty": 1.2
            }
            
            # NLLB 需要指定目標語言
            if "nllb" in model_name.lower():
                # NLLB 使用 tokenizer.lang_code_to_id 的替代方法
                # 或者直接在 generate 中使用 forced_bos_token_id
                # 對於 NLLB，我們需要使用 tokenizer.convert_tokens_to_ids
                forced_bos_token_id = tokenizer.convert_tokens_to_ids(model_info["tgt_lang"])
                gen_kwargs["forced_bos_token_id"] = forced_bos_token_id
            elif "mbart" in model_name.lower():
                gen_kwargs["forced_bos_token_id"] = tokenizer.lang_code_to_id[model_info["tgt_lang"]]

            with torch.no_grad():
                outputs = model.generate(**inputs, **gen_kwargs)
                
            trans_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
            trans_time = (time.time() - start_trans) * 1000 # ms
            
            print(f"原文: {text[:30]}... -> 譯文: {trans_text}")
            
            results.append({
                "text": text,
                "category": category,
                "translation": trans_text,
                "time_ms": trans_time
            })
            
        return results

    except Exception as e:
        print(f"模型 {model_name} 評估失敗: {e}")
        return None

def main():
    all_results = {}
    
    for model_info in MODELS_TO_TEST:
        results = evaluate_model(model_info)
        if results:
            all_results[model_info["name"]] = results
    
    # 生成對比報告
    print("\n\n")
    print("="*80)
    print("模型對比報告")
    print("="*80)
    
    headers = ["原文 (類別)", "Opus-MT (當前)", "NLLB-200 (推薦)"]
    table_data = []
    
    opus_res = all_results.get("Helsinki-NLP/opus-mt-en-zh", [])
    nllb_res = all_results.get("facebook/nllb-200-distilled-600M", [])
    
    for i in range(len(TEST_SENTENCES)):
        text = TEST_SENTENCES[i][0]
        category = TEST_SENTENCES[i][1]
        
        opus_trans = "N/A"
        if i < len(opus_res):
            opus_trans = opus_res[i]["translation"]
            
        nllb_trans = "N/A"
        if i < len(nllb_res):
            nllb_trans = nllb_res[i]["translation"]
            
        # 截斷過長的文本以適應顯示
        display_text = (text[:20] + '..') if len(text) > 20 else text
        table_data.append([f"{display_text}\n({category})", opus_trans, nllb_trans])
        
    print(tabulate(table_data, headers=headers, tablefmt="grid", maxcolwidths=[20, 30, 30]))
    
    # 保存詳細結果
    with open("scripts/model_eval_results.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n詳細結果已保存至 scripts/model_eval_results.json")

if __name__ == "__main__":
    main()

