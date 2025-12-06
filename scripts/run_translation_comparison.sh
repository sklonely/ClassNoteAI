#!/bin/bash
# 運行完整的翻譯比較測試

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODEL_DIR="$PROJECT_DIR/models/opus-mt-en-zh-onnx"

echo "============================================================"
echo "翻譯比較測試"
echo "============================================================"

# 檢查模型目錄
if [ ! -d "$MODEL_DIR" ]; then
    echo "❌ 模型目錄不存在: $MODEL_DIR"
    echo "請先下載模型到: $MODEL_DIR"
    exit 1
fi

# 檢查 Python 依賴
echo ""
echo "檢查 Python 依賴..."
python3 -c "import onnxruntime, transformers, numpy" 2>/dev/null || {
    echo "❌ Python 依賴缺失，請安裝："
    echo "pip install onnxruntime transformers numpy"
    exit 1
}
echo "✓ Python 依賴已安裝"

# 運行 Python 翻譯測試
echo ""
echo "============================================================"
echo "運行 Python ONNX 翻譯測試"
echo "============================================================"
cd "$PROJECT_DIR"
python3 "$SCRIPT_DIR/compare_translation_python_rust.py"

echo ""
echo "============================================================"
echo "測試完成"
echo "============================================================"
echo ""
echo "結果已保存到: $SCRIPT_DIR/translation_comparison_results.json"
echo ""
echo "要測試 Rust 實現，請："
echo "1. 啟動 Tauri 應用程序"
echo "2. 在設置頁面加載翻譯模型"
echo "3. 使用前端界面測試翻譯功能"
echo "4. 查看控制台日誌比較結果"


