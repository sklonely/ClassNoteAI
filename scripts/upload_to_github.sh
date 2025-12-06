#!/bin/bash
# 使用 GitHub CLI 上傳模型到 GitHub Releases
# 需要先安裝 GitHub CLI: brew install gh (macOS) 或從 https://cli.github.com 安裝
# 使用方法: ./scripts/upload_to_github.sh GITHUB_USERNAME REPO_NAME RELEASE_VERSION

set -e

if [ $# -lt 3 ]; then
    echo "錯誤: 參數不足"
    echo "使用方法: $0 GITHUB_USERNAME REPO_NAME RELEASE_VERSION"
    echo "例如: $0 your-username classnote-ai-models v1.0"
    exit 1
fi

GITHUB_USERNAME="$1"
REPO_NAME="$2"
RELEASE_VERSION="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="$PROJECT_ROOT/model_packages"

echo "=========================================="
echo "上傳模型到 GitHub Releases"
echo "=========================================="
echo "GitHub 用戶名: $GITHUB_USERNAME"
echo "倉庫名稱: $REPO_NAME"
echo "Release 版本: $RELEASE_VERSION"
echo ""

# 檢查 GitHub CLI 是否安裝
if ! command -v gh &> /dev/null; then
    echo "錯誤: GitHub CLI (gh) 未安裝"
    echo ""
    echo "安裝方法:"
    echo "  macOS: brew install gh"
    echo "  Linux: 從 https://cli.github.com 下載"
    echo "  Windows: 從 https://cli.github.com 下載"
    echo ""
    echo "安裝後，請運行: gh auth login"
    exit 1
fi

# 檢查是否已登錄
if ! gh auth status &> /dev/null; then
    echo "錯誤: 未登錄 GitHub CLI"
    echo "請運行: gh auth login"
    exit 1
fi

# 檢查打包目錄
if [ ! -d "$PACKAGE_DIR" ]; then
    echo "錯誤: 打包目錄不存在: $PACKAGE_DIR"
    echo "請先運行: ./scripts/package_models_for_github.sh"
    exit 1
fi

# 檢查 ZIP 文件是否存在
ZIP_FILES=(
    "opus-mt-en-zh-onnx.zip"
    "nllb-200-distilled-600M-onnx.zip"
    "mbart-large-50-onnx.zip"
)

for ZIP_FILE in "${ZIP_FILES[@]}"; do
    ZIP_PATH="$PACKAGE_DIR/$ZIP_FILE"
    if [ ! -f "$ZIP_PATH" ]; then
        echo "⚠️  警告: ZIP 文件不存在: $ZIP_FILE"
        echo "請先運行: ./scripts/package_models_for_github.sh"
    fi
done

# 檢查倉庫是否存在
REPO_FULL_NAME="${GITHUB_USERNAME}/${REPO_NAME}"
if ! gh repo view "$REPO_FULL_NAME" &> /dev/null; then
    echo "倉庫不存在，正在創建..."
    gh repo create "$REPO_NAME" --public --description "ONNX translation models for ClassNote AI"
    echo "✓ 倉庫已創建"
fi

# 檢查 Release 是否存在
if gh release view "$RELEASE_VERSION" --repo "$REPO_FULL_NAME" &> /dev/null; then
    echo "Release $RELEASE_VERSION 已存在，將添加文件..."
else
    echo "創建新的 Release: $RELEASE_VERSION"
    gh release create "$RELEASE_VERSION" \
        --repo "$REPO_FULL_NAME" \
        --title "Translation Models v1.0" \
        --notes "ONNX translation models for ClassNote AI application" \
        --draft
    echo "✓ Release 已創建（草稿模式）"
fi

# 上傳每個 ZIP 文件
echo ""
echo "開始上傳文件..."
for ZIP_FILE in "${ZIP_FILES[@]}"; do
    ZIP_PATH="$PACKAGE_DIR/$ZIP_FILE"
    if [ -f "$ZIP_PATH" ]; then
        echo "上傳: $ZIP_FILE"
        gh release upload "$RELEASE_VERSION" "$ZIP_PATH" --repo "$REPO_FULL_NAME" --clobber
        echo "✓ $ZIP_FILE 上傳完成"
    fi
done

echo ""
echo "=========================================="
echo "上傳完成！"
echo "=========================================="
echo ""
echo "Release URL: https://github.com/${REPO_FULL_NAME}/releases/tag/${RELEASE_VERSION}"
echo ""
echo "下一步："
echo "1. 檢查 Release 頁面確認文件已上傳"
echo "2. 如果一切正常，發布 Release（取消草稿模式）"
echo "3. 運行以下命令更新配置："
echo "   ./scripts/update_download_urls.sh $GITHUB_USERNAME $REPO_NAME $RELEASE_VERSION"
echo ""


