#!/bin/bash
# 更新下載 URL 配置
# 使用方法: ./scripts/update_download_urls.sh GITHUB_USERNAME REPO_NAME RELEASE_VERSION
# 例如: ./scripts/update_download_urls.sh your-username classnote-ai-models v1.0

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
DOWNLOAD_RS="$PROJECT_ROOT/ClassNoteAI/src-tauri/src/translation/download.rs"

echo "=========================================="
echo "更新下載 URL 配置"
echo "=========================================="
echo "GitHub 用戶名: $GITHUB_USERNAME"
echo "倉庫名稱: $REPO_NAME"
echo "Release 版本: $RELEASE_VERSION"
echo ""

# 檢查文件是否存在
if [ ! -f "$DOWNLOAD_RS" ]; then
    echo "錯誤: 找不到文件 $DOWNLOAD_RS"
    exit 1
fi

# 備份原文件
cp "$DOWNLOAD_RS" "${DOWNLOAD_RS}.backup"
echo "✓ 已備份原文件: ${DOWNLOAD_RS}.backup"

# 構建基礎 URL
BASE_URL="https://github.com/${GITHUB_USERNAME}/${REPO_NAME}/releases/download/${RELEASE_VERSION}"

# 更新 URL（使用 sed）
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|https://github.com/your-username/classnote-ai-models/releases/download/v1.0/opus-mt-en-zh-onnx.zip|${BASE_URL}/opus-mt-en-zh-onnx.zip|g" "$DOWNLOAD_RS"
    sed -i '' "s|https://github.com/your-username/classnote-ai-models/releases/download/v1.0/nllb-200-distilled-600M-onnx.zip|${BASE_URL}/nllb-200-distilled-600M-onnx.zip|g" "$DOWNLOAD_RS"
    sed -i '' "s|https://github.com/your-username/classnote-ai-models/releases/download/v1.0/mbart-large-50-onnx.zip|${BASE_URL}/mbart-large-50-onnx.zip|g" "$DOWNLOAD_RS"
else
    # Linux
    sed -i "s|https://github.com/your-username/classnote-ai-models/releases/download/v1.0/opus-mt-en-zh-onnx.zip|${BASE_URL}/opus-mt-en-zh-onnx.zip|g" "$DOWNLOAD_RS"
    sed -i "s|https://github.com/your-username/classnote-ai-models/releases/download/v1.0/nllb-200-distilled-600M-onnx.zip|${BASE_URL}/nllb-200-distilled-600M-onnx.zip|g" "$DOWNLOAD_RS"
    sed -i "s|https://github.com/your-username/classnote-ai-models/releases/download/v1.0/mbart-large-50-onnx.zip|${BASE_URL}/mbart-large-50-onnx.zip|g" "$DOWNLOAD_RS"
fi

echo "✓ 已更新下載 URL"
echo ""
echo "更新後的 URL:"
echo "  - opus-mt-en-zh-onnx: ${BASE_URL}/opus-mt-en-zh-onnx.zip"
echo "  - nllb-200-distilled-600M-onnx: ${BASE_URL}/nllb-200-distilled-600M-onnx.zip"
echo "  - mbart-large-50-onnx: ${BASE_URL}/mbart-large-50-onnx.zip"
echo ""
echo "請確認 URL 是否正確，然後重新編譯應用程序。"


