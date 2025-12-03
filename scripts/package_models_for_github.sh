#!/bin/bash
# 打包翻譯模型用於上傳到 GitHub Releases
# 使用方法: ./scripts/package_models_for_github.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELS_DIR="$PROJECT_ROOT/models"
PACKAGE_DIR="$PROJECT_ROOT/model_packages"

echo "=========================================="
echo "打包翻譯模型用於 GitHub Releases"
echo "=========================================="

# 創建打包目錄
mkdir -p "$PACKAGE_DIR"
cd "$PACKAGE_DIR"

# 要打包的模型列表（只包含快速響應的小模型）
MODELS=(
    "opus-mt-en-zh-onnx"
    # 排除大模型以確保快速響應：
    # "nllb-200-distilled-600M-onnx"  # ~4.3GB，太大
    # "mbart-large-50-onnx"            # ~4.2GB，太大
)

# 打包每個模型
for MODEL in "${MODELS[@]}"; do
    MODEL_PATH="$MODELS_DIR/$MODEL"
    
    if [ ! -d "$MODEL_PATH" ]; then
        echo "⚠️  警告: 模型目錄不存在: $MODEL_PATH"
        continue
    fi
    
    echo ""
    echo "正在打包: $MODEL"
    echo "----------------------------------------"
    
    # 檢查必要的文件
    if [ ! -f "$MODEL_PATH/encoder_model.onnx" ] || [ ! -f "$MODEL_PATH/decoder_model.onnx" ]; then
        echo "⚠️  警告: $MODEL 缺少必要的模型文件，跳過"
        continue
    fi
    
    # 創建 ZIP 文件
    ZIP_NAME="${MODEL}.zip"
    ZIP_PATH="$PACKAGE_DIR/$ZIP_NAME"
    
    echo "創建 ZIP 文件: $ZIP_NAME"
    
    # 計算源目錄大小（用於進度估算）
    SOURCE_SIZE=$(du -sk "$MODEL_PATH" 2>/dev/null | cut -f1)
    SOURCE_SIZE_MB=$((SOURCE_SIZE / 1024))
    echo "  源目錄大小: ${SOURCE_SIZE_MB} MB"
    echo "  正在壓縮（這可能需要幾分鐘）..."
    
    cd "$MODELS_DIR"
    # 使用 -v 選項顯示進度，但限制輸出頻率
    zip -r "$ZIP_PATH" "$MODEL" -x "*.backup" -x "*test*" 2>&1 | \
        grep -E "(adding|updating|%)" | \
        while IFS= read -r line; do
            # 每處理 100 個文件顯示一次進度
            echo "  $line"
        done
    
    # 計算文件大小
    SIZE=$(du -h "$ZIP_PATH" | cut -f1)
    echo "✓ 打包完成: $ZIP_NAME ($SIZE)"
    
    # 計算文件大小（字節）用於配置
    SIZE_BYTES=$(stat -f%z "$ZIP_PATH" 2>/dev/null || stat -c%s "$ZIP_PATH" 2>/dev/null)
    SIZE_MB=$((SIZE_BYTES / 1024 / 1024))
    echo "  文件大小: ${SIZE_MB} MB (${SIZE_BYTES} 字節)"
done

echo ""
echo "=========================================="
echo "打包完成！"
echo "=========================================="
echo ""
echo "打包的文件位於: $PACKAGE_DIR"
echo ""
echo "下一步："
echo "1. 在 GitHub 上創建一個新的倉庫（例如: classnote-ai-models）"
echo "2. 創建一個新的 Release（例如: v1.0）"
echo "3. 將 ZIP 文件上傳到 Release"
echo "4. 運行以下命令更新配置："
echo "   ./scripts/update_download_urls.sh YOUR_GITHUB_USERNAME YOUR_REPO_NAME v1.0"
echo ""

