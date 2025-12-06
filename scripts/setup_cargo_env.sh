#!/bin/bash
# 設置 Cargo 環境變量
# 在構建腳本中使用此腳本來確保 Cargo 可用

# 加載 Cargo 環境
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

# 確保 Cargo 在 PATH 中
export PATH="$HOME/.cargo/bin:$PATH"

# 驗證 Cargo 是否可用
if ! command -v cargo &> /dev/null; then
    echo "錯誤: Cargo 未找到"
    echo "請安裝 Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# 執行傳入的命令
exec "$@"


