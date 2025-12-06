#!/bin/bash
# 檢查並設置 Rust/Cargo 環境

# 加載 Cargo 環境
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

# 確保 Cargo 在 PATH 中
export PATH="$HOME/.cargo/bin:$PATH"

# 檢查 Cargo 是否可用
if command -v cargo &> /dev/null; then
    echo "✓ Cargo 已找到: $(which cargo)"
    echo "✓ Cargo 版本: $(cargo --version)"
    exit 0
else
    echo "✗ Cargo 未找到"
    echo ""
    echo "請安裝 Rust:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi


