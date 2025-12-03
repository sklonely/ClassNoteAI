#!/bin/bash
# 快速打包腳本 - 使用 tar.gz（更快）或只打包小模型
# 使用方法: ./scripts/package_models_fast.sh [--small-only]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELS_DIR="$PROJECT_ROOT/models"
PACKAGE_DIR="$PROJECT_ROOT/model_packages"

# 檢查參數
SMALL_ONLY=false
if [ "$1" == "--small-only" ]; then
    SMALL_ONLY=true
fi

echo "=========================================="
echo "快速打包翻譯模型"
echo "=========================================="

# 創建打包目錄
mkdir -p "$PACKAGE_DIR"
cd "$MODELS_DIR"

# 只打包 opus-mt-en-zh-onnx（較小，約500MB）
if [ -d "opus-mt-en-zh-onnx" ]; then
    echo ""
    echo "正在打包: opus-mt-en-zh-onnx"
    echo "----------------------------------------"
    
    ZIP_NAME="opus-mt-en-zh-onnx.zip"
    ZIP_PATH="$PACKAGE_DIR/$ZIP_NAME"
    
    # 如果已存在，跳過
    if [ -f "$ZIP_PATH" ]; then
        echo "✓ 文件已存在: $ZIP_NAME"
    else
        echo "創建 ZIP 文件..."
        zip -r "$ZIP_PATH" "opus-mt-en-zh-onnx" -x "*.backup" -x "*test*" > /dev/null
        
        SIZE=$(du -h "$ZIP_PATH" | cut -f1)
        echo "✓ 打包完成: $ZIP_NAME ($SIZE)"
    fi
fi

if [ "$SMALL_ONLY" = false ]; then
    echo ""
    echo "提示：大模型（nllb, mbart）文件很大（4GB+），"
    echo "壓縮需要很長時間。建議："
    echo "1. 只上傳 opus-mt-en-zh-onnx（已打包）"
    echo "2. 或等待當前壓縮完成"
    echo "3. 或使用雲存儲服務上傳大模型"
fi

echo ""
echo "=========================================="
echo "完成！"
echo "=========================================="
echo ""
echo "已打包的文件位於: $PACKAGE_DIR"
echo ""

