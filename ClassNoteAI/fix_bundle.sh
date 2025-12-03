#!/bin/bash
# 修復打包後的前端資源文件
# 在打包完成後運行此腳本，確保前端文件被正確複製

cd "$(dirname "$0")"

# 檢查 dist 目錄是否存在
if [ ! -d "dist" ]; then
    echo "錯誤: dist 目錄不存在，請先運行 npm run build"
    exit 1
fi

# 查找所有打包的應用
BUNDLE_DIR="src-tauri/target/release/bundle"

# 修復 release 版本
if [ -d "$BUNDLE_DIR/macos" ]; then
    echo "修復 macOS Release 應用..."
    APP_PATH="$BUNDLE_DIR/macos/classnoteai.app"
    RESOURCES_PATH="$APP_PATH/Contents/Resources"
    if [ -d "$RESOURCES_PATH" ]; then
        cp -r dist/* "$RESOURCES_PATH/"
        # 重新簽名應用（adhoc 簽名）
        codesign --force --deep --sign - "$APP_PATH" 2>/dev/null || true
        echo "✓ macOS Release 應用已修復並重新簽名"
    fi
fi

# 修復 debug 版本
DEBUG_BUNDLE_DIR="src-tauri/target/debug/bundle"
if [ -d "$DEBUG_BUNDLE_DIR/macos" ]; then
    echo "修復 macOS Debug 應用..."
    DEBUG_APP_PATH="$DEBUG_BUNDLE_DIR/macos/classnoteai.app"
    DEBUG_RESOURCES_PATH="$DEBUG_APP_PATH/Contents/Resources"
    if [ -d "$DEBUG_RESOURCES_PATH" ]; then
        cp -r dist/* "$DEBUG_RESOURCES_PATH/"
        # 重新簽名應用（adhoc 簽名）
        codesign --force --deep --sign - "$DEBUG_APP_PATH" 2>/dev/null || true
        echo "✓ macOS Debug 應用已修復並重新簽名"
    fi
fi

if [ -d "$BUNDLE_DIR/appimage" ]; then
    echo "修復 Linux AppImage..."
    # AppImage 需要特殊處理
    echo "注意: AppImage 需要重新打包才能包含前端文件"
fi

echo "完成！"

