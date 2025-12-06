#!/bin/bash
# 通過 Tauri 命令比較 Python 和 Rust 的翻譯結果

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODEL_DIR="$PROJECT_DIR/models/opus-mt-en-zh-onnx"

echo "============================================================"
echo "通過 Tauri 命令比較 Python 和 Rust 的翻譯結果"
echo "============================================================"

# 檢查模型目錄
if [ ! -d "$MODEL_DIR" ]; then
    echo "❌ 模型目錄不存在: $MODEL_DIR"
    exit 1
fi

# 測試文本（JSON 格式）
TEST_TEXTS='[
    "Hello",
    "Hello world",
    "Hello, how are you?",
    "Good morning",
    "Thank you",
    "I love you",
    "What is your name?",
    "How are you doing today?",
    "The weather is nice today.",
    "This is a test sentence for translation comparison."
]'

echo ""
echo "測試文本:"
echo "$TEST_TEXTS" | python3 -m json.tool

echo ""
echo "============================================================"
echo "步驟 1: 運行 Python 腳本"
echo "============================================================"

cd "$PROJECT_DIR"
python3 "$SCRIPT_DIR/compare_translation_python_rust.py"

echo ""
echo "============================================================"
echo "步驟 2: 運行 Rust 翻譯（通過 Tauri 命令）"
echo "============================================================"

echo "注意：需要先啟動 Tauri 應用，然後通過前端調用翻譯命令"
echo "或者使用以下命令手動測試："
echo ""
echo "cd $PROJECT_DIR/ClassNoteAI"
echo "cargo run --bin test_translation -- --model-dir \"$MODEL_DIR\" --text \"Hello world\""
echo ""
echo "或者在前端開發模式下測試翻譯功能"


