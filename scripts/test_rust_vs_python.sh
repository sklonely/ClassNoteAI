#!/bin/bash
# 測試 Rust 和 Python 的翻譯結果一致性

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================================"
echo "Rust vs Python 翻譯結果一致性測試"
echo "============================================================"

# 1. 運行 Python 測試
echo ""
echo "步驟 1: 運行 Python 測試..."
cd "$PROJECT_DIR"
uv run python scripts/compare_translation_python_rust.py > /tmp/python_results.txt 2>&1
echo "✓ Python 測試完成"

# 2. 提取 Python 結果
echo ""
echo "步驟 2: 提取 Python 結果..."
python3 << 'EOF'
import json
with open('scripts/translation_comparison_results.json', 'r', encoding='utf-8') as f:
    results = json.load(f)
    
print("\nPython 翻譯結果:")
print("=" * 80)
for i, r in enumerate(results, 1):
    print(f"{i}. '{r['text']}'")
    print(f"   → '{r['python_result']}'")
    if r['python_has_chinese']:
        print(f"   ✓ 含中文")
    else:
        print(f"   ✗ 無中文")
    print()
EOF

# 3. 提示如何測試 Rust
echo ""
echo "步驟 3: 測試 Rust 實現"
echo "============================================================"
echo "要測試 Rust 實現，請："
echo ""
echo "1. 啟動 Tauri 應用程序："
echo "   cd $PROJECT_DIR/ClassNoteAI"
echo "   npm run tauri:dev"
echo ""
echo "2. 在設置頁面加載翻譯模型"
echo ""
echo "3. 使用前端界面測試相同的文本"
echo ""
echo "4. 查看控制台日誌，比較 Rust 和 Python 的結果"
echo ""
echo "預期的 Python 結果已保存在："
echo "  scripts/translation_comparison_results.json"
echo ""


