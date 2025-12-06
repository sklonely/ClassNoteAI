#!/usr/bin/env python3
"""
比較三種實現的翻譯結果：
1. 原始 HuggingFace 模型（不通過 ONNX）
2. ONNX Python 實現
3. ONNX Rust 實現
"""

import sys
import json
from pathlib import Path
from typing import Dict, List, Optional

def load_json_results(file_path: Path) -> Optional[List[Dict]]:
    """加載 JSON 結果文件"""
    if not file_path.exists():
        return None
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠ 加載 {file_path} 失敗: {e}")
        return None

def compare_results():
    """比較三種實現的結果"""
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent
    
    print("=" * 80)
    print("比較三種實現的翻譯結果")
    print("=" * 80)
    
    # 加載結果
    original_results = load_json_results(script_dir / "original_model_results.json")
    onnx_python_results = load_json_results(script_dir / "translation_comparison_results.json")
    rust_results = load_json_results(script_dir / "rust_translation_results.json")
    
    # 檢查哪些結果可用
    available = []
    if original_results:
        available.append(("原始模型", original_results))
    if onnx_python_results:
        available.append(("ONNX Python", onnx_python_results))
    if rust_results:
        available.append(("ONNX Rust", rust_results))
    
    if len(available) < 2:
        print("\n⚠ 需要至少兩種實現的結果才能進行比較")
        print("\n可用的結果:")
        if original_results:
            print("  ✓ 原始模型結果")
        if onnx_python_results:
            print("  ✓ ONNX Python 結果")
        if rust_results:
            print("  ✓ ONNX Rust 結果")
        print("\n請先運行對應的測試腳本:")
        print("  1. 原始模型: python scripts/test_original_model.py")
        print("  2. ONNX Python: python scripts/compare_translation_python_rust.py")
        print("  3. ONNX Rust: cd ClassNoteAI/src-tauri && cargo run --example test_translation")
        return
    
    # 統一結果格式
    def normalize_result(r, source_name):
        if source_name == "原始模型":
            return {
                "text": r.get("text", ""),
                "result": r.get("result", ""),
                "success": r.get("success", False),
                "has_chinese": r.get("has_chinese", False),
            }
        elif source_name == "ONNX Python":
            return {
                "text": r.get("text", ""),
                "result": r.get("python_result", ""),
                "success": r.get("python_success", False),
                "has_chinese": r.get("python_has_chinese", False),
            }
        elif source_name == "ONNX Rust":
            return {
                "text": r.get("text", ""),
                "result": r.get("result", ""),
                "success": r.get("success", False),
                "has_chinese": r.get("has_chinese", False),
            }
        return None
    
    # 比較結果
    print("\n" + "=" * 80)
    print("詳細對比")
    print("=" * 80)
    
    # 獲取所有測試文本
    all_texts = set()
    for name, results in available:
        for r in results:
            text = normalize_result(r, name)["text"]
            all_texts.add(text)
    
    all_texts = sorted(list(all_texts))
    
    comparison_results = []
    
    for text in all_texts:
        print(f"\n文本: '{text}'")
        print("-" * 80)
        
        results_by_source = {}
        for name, results in available:
            for r in results:
                normalized = normalize_result(r, name)
                if normalized["text"] == text:
                    results_by_source[name] = normalized
                    break
        
        # 打印每個實現的結果
        for name in ["原始模型", "ONNX Python", "ONNX Rust"]:
            if name in results_by_source:
                r = results_by_source[name]
                status = "✓" if r["success"] else "✗"
                chinese = "(含中文)" if r["has_chinese"] else "(無中文)"
                print(f"  {name:15} → '{r['result']}' {status} {chinese}")
            else:
                print(f"  {name:15} → (未測試)")
        
        # 比較結果是否一致
        if len(results_by_source) >= 2:
            results_list = list(results_by_source.values())
            first_result = results_list[0]["result"]
            all_same = all(r["result"] == first_result for r in results_list[1:])
            
            if all_same:
                print(f"  {'比較':15} → ✓ 所有實現結果一致")
            else:
                print(f"  {'比較':15} → ⚠ 結果不一致")
                for name, r in results_by_source.items():
                    print(f"    {name}: '{r['result']}'")
        
        comparison_results.append({
            "text": text,
            "results": results_by_source,
        })
    
    # 統計
    print("\n" + "=" * 80)
    print("統計總結")
    print("=" * 80)
    
    for name, results in available:
        success_count = sum(1 for r in results if normalize_result(r, name)["success"])
        chinese_count = sum(1 for r in results if normalize_result(r, name)["has_chinese"])
        print(f"\n{name}:")
        print(f"  成功翻譯: {success_count}/{len(results)}")
        print(f"  含中文: {chinese_count}/{len(results)}")
    
    # 一致性統計
    if len(available) >= 2:
        print("\n一致性:")
        same_count = 0
        total_count = 0
        
        for text in all_texts:
            results_by_source = {}
            for name, results in available:
                for r in results:
                    normalized = normalize_result(r, name)
                    if normalized["text"] == text:
                        results_by_source[name] = normalized
                        break
            
            if len(results_by_source) >= 2:
                results_list = list(results_by_source.values())
                first_result = results_list[0]["result"]
                all_same = all(r["result"] == first_result for r in results_list[1:])
                if all_same:
                    same_count += 1
                total_count += 1
        
        if total_count > 0:
            consistency = (same_count / total_count) * 100
            print(f"  一致結果: {same_count}/{total_count} ({consistency:.1f}%)")
    
    # 保存對比結果
    output_file = script_dir / "comparison_all_results.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(comparison_results, f, ensure_ascii=False, indent=2)
    print(f"\n對比結果已保存到: {output_file}")

if __name__ == "__main__":
    compare_results()


