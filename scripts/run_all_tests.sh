#!/bin/bash
# 運行所有翻譯測試並進行對比

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================================"
echo "運行所有翻譯測試並進行對比"
echo "============================================================"

cd "$PROJECT_DIR"

# 1. 測試原始模型（不通過 ONNX）
echo ""
echo "步驟 1: 測試原始 HuggingFace 模型..."
echo "============================================================"
if uv run python scripts/test_original_model.py; then
    echo "✓ 原始模型測試完成"
else
    echo "✗ 原始模型測試失敗"
    exit 1
fi

# 2. 測試 ONNX Python 實現
echo ""
echo "步驟 2: 測試 ONNX Python 實現..."
echo "============================================================"
if uv run python scripts/compare_translation_python_rust.py; then
    echo "✓ ONNX Python 測試完成"
else
    echo "✗ ONNX Python 測試失敗"
    exit 1
fi

# 3. 測試 ONNX Rust 實現
echo ""
echo "步驟 3: 測試 ONNX Rust 實現..."
echo "============================================================"
cd "$PROJECT_DIR/ClassNoteAI/src-tauri"
if cargo run --example test_translation 2>&1 | tee /tmp/rust_test.log; then
    echo "✓ ONNX Rust 測試完成"
else
    echo "✗ ONNX Rust 測試失敗"
    echo "查看日誌: /tmp/rust_test.log"
    exit 1
fi

# 4. 對比所有實現
echo ""
echo "步驟 4: 對比所有實現..."
echo "============================================================"
cd "$PROJECT_DIR"
if uv run python scripts/compare_all_implementations.py; then
    echo "✓ 對比完成"
else
    echo "✗ 對比失敗"
    exit 1
fi

echo ""
echo "============================================================"
echo "所有測試完成！"
echo "============================================================"
echo ""
echo "結果文件："
echo "  1. 原始模型: scripts/original_model_results.json"
echo "  2. ONNX Python: scripts/translation_comparison_results.json"
echo "  3. ONNX Rust: scripts/rust_translation_results.json"
echo "  4. 對比結果: scripts/comparison_all_results.json"
echo ""


