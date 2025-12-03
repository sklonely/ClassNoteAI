#!/usr/bin/env python3
"""
opus-mt-en-zh 模型全面測試
包含各種類型的測試案例：短句、長句、計算機科學相關、課堂常見句子
並測試不同的生成參數以修復潛在問題
"""

import sys
import os
import numpy as np
from pathlib import Path

try:
    import onnxruntime as ort
    from transformers import AutoTokenizer
except ImportError:
    print("錯誤：請先安裝依賴")
    print("pip install onnxruntime transformers sentencepiece")
    sys.exit(1)

# 測試案例分類
TEST_CASES = {
    "基本問候": [
        "Hello",
        "Hello world",
        "Hello, how are you?",
        "Good morning",
        "Thank you",
    ],
    "短句": [
        "I am a student",
        "This is a test",
        "Can you help me?",
        "What time is it?",
        "How are you doing today?",
    ],
    "中等長度句子": [
        "The weather is nice today",
        "I love programming",
        "The quick brown fox jumps over the lazy dog",
        "Machine learning is a subset of artificial intelligence",
        "Python is a popular programming language",
    ],
    "長句（計算機科學）": [
        "Object-oriented programming is a programming paradigm based on the concept of objects, which can contain data and code",
        "A neural network is a series of algorithms that endeavors to recognize underlying relationships in a set of data through a process that mimics how the human brain operates",
        "The time complexity of this algorithm is O(n log n), which makes it efficient for large datasets",
        "RESTful API design follows a set of architectural principles that make web services more scalable and maintainable",
        "Docker containers provide a lightweight, portable way to package and deploy applications across different environments",
    ],
    "課堂常見句子": [
        "Let's start today's lecture on data structures",
        "Does anyone have any questions about the previous topic?",
        "Please submit your homework before the deadline",
        "The exam will cover chapters one through five",
        "We'll be discussing algorithms and their complexity analysis",
        "Make sure to review the reading materials before next class",
        "The assignment is due next Friday at midnight",
        "I'll post the lecture slides on the course website",
        "Let's break into groups for the group project discussion",
        "The midterm exam will be held in the main auditorium",
    ],
    "計算機科學術語": [
        "A binary search tree is a data structure that allows efficient searching, insertion, and deletion",
        "The TCP/IP protocol suite is the foundation of modern internet communication",
        "Git is a distributed version control system used for tracking changes in source code",
        "A hash table provides average O(1) time complexity for insertion and lookup operations",
        "The MVC pattern separates an application into three interconnected components: Model, View, and Controller",
    ],
    "複雜技術句子": [
        "The implementation uses a combination of depth-first search and dynamic programming to solve the optimization problem",
        "We need to optimize the database queries to reduce the response time from 500ms to under 100ms",
        "The microservices architecture allows each service to be developed, deployed, and scaled independently",
        "The compiler performs several optimization passes including dead code elimination and constant folding",
        "This distributed system uses consensus algorithms like Raft to ensure consistency across multiple nodes",
    ],
}

def test_translation_with_params(model_dir, test_text, decoder_start_token_id, eos_token_id, 
                                 max_length=100, temperature=None, top_k=None, top_p=None):
    """使用不同參數測試翻譯"""
    try:
        encoder_path = model_dir / "encoder_model.onnx"
        decoder_path = model_dir / "decoder_model.onnx"
        tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
        
        encoder_session = ort.InferenceSession(str(encoder_path))
        decoder_session = ort.InferenceSession(str(decoder_path))
        
        # Tokenize 輸入
        input_ids = tokenizer.encode(test_text, return_tensors="np").astype(np.int64)
        attention_mask = np.ones_like(input_ids, dtype=np.int64)
        
        # Encoder
        encoder_outputs = encoder_session.run(None, {
            "input_ids": input_ids,
            "attention_mask": attention_mask
        })
        encoder_hidden_states = encoder_outputs[0]
        
        # Decoder (自回歸生成)
        generated_ids = [decoder_start_token_id]
        
        for step in range(max_length):
            decoder_input_ids = np.array([[generated_ids[-1]]], dtype=np.int64)
            
            decoder_outputs = decoder_session.run(None, {
                "input_ids": decoder_input_ids,
                "encoder_hidden_states": encoder_hidden_states,
                "encoder_attention_mask": attention_mask
            })
            logits = decoder_outputs[0][0, -1, :]
            
            # 應用採樣策略
            if temperature is not None:
                logits = logits / temperature
                
                if top_k is not None:
                    # Top-k 採樣
                    top_k_indices = np.argsort(logits)[-top_k:]
                    top_k_logits = logits[top_k_indices]
                    probs = np.exp(top_k_logits - np.max(top_k_logits))
                    probs = probs / probs.sum()
                    next_token_id = int(np.random.choice(top_k_indices, p=probs))
                elif top_p is not None:
                    # Top-p (nucleus) 採樣
                    sorted_indices = np.argsort(logits)[::-1]
                    sorted_logits = logits[sorted_indices]
                    probs = np.exp(sorted_logits - np.max(sorted_logits))
                    probs = probs / probs.sum()
                    cumsum_probs = np.cumsum(probs)
                    top_p_indices = sorted_indices[cumsum_probs <= top_p]
                    if len(top_p_indices) == 0:
                        top_p_indices = sorted_indices[:1]
                    probs_p = probs[:len(top_p_indices)]
                    probs_p = probs_p / probs_p.sum()
                    next_token_id = int(np.random.choice(top_p_indices, p=probs_p))
                else:
                    # 僅 temperature
                    probs = np.exp(logits - np.max(logits))
                    probs = probs / probs.sum()
                    next_token_id = int(np.random.choice(len(logits), p=probs))
            else:
                # Greedy decoding (argmax)
                next_token_id = int(np.argmax(logits))
            
            if next_token_id == eos_token_id:
                break
            
            generated_ids.append(next_token_id)
        
        # Decode
        output_ids = generated_ids[1:]  # 移除 start token
        translated = tokenizer.decode(output_ids, skip_special_tokens=True)
        
        return translated, generated_ids
        
    except Exception as e:
        return None, str(e)

def test_all_cases():
    """測試所有案例"""
    model_dir = Path(__file__).parent.parent / "models" / "opus-mt-en-zh-onnx"
    
    if not model_dir.exists():
        print(f"❌ 模型目錄不存在: {model_dir}")
        return
    
    # 讀取配置
    import json
    with open(model_dir / "config.json") as f:
        config = json.load(f)
    
    decoder_start_token_id = config.get("decoder_start_token_id", 65000)
    eos_token_id = config.get("eos_token_id", 0)
    
    print("=" * 80)
    print("opus-mt-en-zh 全面測試")
    print("=" * 80)
    print(f"模型目錄: {model_dir}")
    print(f"配置: decoder_start_token_id={decoder_start_token_id}, eos_token_id={eos_token_id}")
    print("=" * 80)
    
    # 測試不同的生成策略
    strategies = [
        {"name": "標準生成（Greedy）", "temperature": None, "top_k": None, "top_p": None},
        {"name": "Temperature=0.7", "temperature": 0.7, "top_k": None, "top_p": None},
        {"name": "Temperature=0.8", "temperature": 0.8, "top_k": None, "top_p": None},
        {"name": "Top-k=50", "temperature": 0.7, "top_k": 50, "top_p": None},
        {"name": "Top-p=0.9", "temperature": 0.7, "top_k": None, "top_p": 0.9},
    ]
    
    results_summary = {}
    
    for category, test_cases in TEST_CASES.items():
        print(f"\n{'=' * 80}")
        print(f"測試類別: {category}")
        print(f"{'=' * 80}")
        
        category_results = []
        
        for test_text in test_cases:
            print(f"\n測試文本 ({len(test_text)} 字符):")
            print(f"  \"{test_text}\"")
            print("-" * 80)
            
            best_result = None
            best_strategy = None
            
            for strategy in strategies:
                translated, generated_ids = test_translation_with_params(
                    model_dir, test_text, decoder_start_token_id, eos_token_id,
                    max_length=150,
                    temperature=strategy["temperature"],
                    top_k=strategy["top_k"],
                    top_p=strategy["top_p"]
                )
                
                if translated is None:
                    print(f"  ❌ {strategy['name']}: 錯誤 - {generated_ids}")
                    continue
                
                has_chinese = any('\u4e00' <= c <= '\u9fff' for c in translated)
                is_empty = len(translated.strip()) == 0
                is_repetitive = len(set(translated.split())) < len(translated.split()) * 0.3 if translated.split() else False
                
                status = "✓" if has_chinese and not is_empty and not is_repetitive else "⚠"
                
                print(f"  {status} {strategy['name']}:")
                print(f"    結果: \"{translated}\"")
                print(f"    長度: {len(translated)} 字符")
                print(f"    包含中文: {has_chinese}")
                print(f"    是否為空: {is_empty}")
                print(f"    是否重複: {is_repetitive}")
                print(f"    Token 數量: {len(generated_ids) - 1}")
                
                # 記錄最佳結果
                if has_chinese and not is_empty and not is_repetitive:
                    if best_result is None or len(translated) > len(best_result):
                        best_result = translated
                        best_strategy = strategy['name']
            
            # 記錄結果
            if best_result:
                category_results.append({
                    "input": test_text,
                    "output": best_result,
                    "strategy": best_strategy,
                    "success": True
                })
                print(f"\n  ✅ 最佳結果: \"{best_result}\" (策略: {best_strategy})")
            else:
                category_results.append({
                    "input": test_text,
                    "output": None,
                    "strategy": None,
                    "success": False
                })
                print(f"\n  ❌ 所有策略都失敗")
        
        results_summary[category] = category_results
    
    # 統計結果
    print("\n" + "=" * 80)
    print("測試結果統計")
    print("=" * 80)
    
    total_tests = 0
    total_success = 0
    
    for category, results in results_summary.items():
        success_count = sum(1 for r in results if r["success"])
        total_count = len(results)
        total_tests += total_count
        total_success += success_count
        
        print(f"\n{category}:")
        print(f"  成功: {success_count}/{total_count} ({success_count/total_count*100:.1f}%)")
        
        # 顯示失敗的案例
        failed = [r for r in results if not r["success"]]
        if failed:
            print(f"  失敗案例:")
            for r in failed:
                print(f"    - \"{r['input']}\"")
    
    print(f"\n總體成功率: {total_success}/{total_tests} ({total_success/total_tests*100:.1f}%)")
    
    # 分析問題
    print("\n" + "=" * 80)
    print("問題分析")
    print("=" * 80)
    
    # 找出常見問題
    empty_cases = []
    repetitive_cases = []
    no_chinese_cases = []
    
    for category, results in results_summary.items():
        for r in results:
            if not r["success"]:
                if r["output"] is None or len(r["output"].strip()) == 0:
                    empty_cases.append((category, r["input"]))
                elif r["output"] and not any('\u4e00' <= c <= '\u9fff' for c in r["output"]):
                    no_chinese_cases.append((category, r["input"]))
    
    if empty_cases:
        print("\n空輸出問題:")
        for category, text in empty_cases[:5]:
            print(f"  - [{category}] \"{text}\"")
    
    if no_chinese_cases:
        print("\n無中文輸出問題:")
        for category, text in no_chinese_cases[:5]:
            print(f"  - [{category}] \"{text}\"")
    
    print("\n" + "=" * 80)
    print("測試完成")
    print("=" * 80)

if __name__ == "__main__":
    test_all_cases()


