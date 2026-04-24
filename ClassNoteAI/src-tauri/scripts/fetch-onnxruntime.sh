#!/usr/bin/env bash
# Fetch the pinned ONNX Runtime binary for the Phase 2 Silero VAD v5
# integration. Runs in two contexts:
#
#   1. Release CI workflow — before `cargo tauri build` so the
#      bundled .dll / .dylib / .so lands in the installer next to the
#      Silero ONNX model in resources/silero/.
#
#   2. Local dev — run once after cloning if you want Silero to
#      actually initialise in a `cargo tauri dev` / `cargo run` build.
#      Without it, the adaptive VAD dispatcher falls back to the
#      energy VAD (which works fine for day-to-day dev but you won't
#      see Phase 2's quality improvements).
#
# Version is pinned to 1.23.0 because `ort = "2.0.0-rc.9"` rejects
# older binaries. Bumping ort → bump this URL to match the supported
# range (see the ort release notes).
#
# Usage (from repo root or src-tauri):
#     bash src-tauri/scripts/fetch-onnxruntime.sh

set -euo pipefail

ORT_VERSION="1.23.0"

# Resolve paths relative to this script so it works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SRC_TAURI_DIR/resources/ort"
mkdir -p "$OUT_DIR"

# Detect platform. The triples match what Microsoft publishes on the
# onnxruntime release page. ARM macs ship a universal dylib under the
# `osx-universal2` asset; we prefer it for a single shipping artifact
# across Intel + Apple Silicon.
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) PLATFORM="win-x64"; ARCHIVE_EXT="zip"; LIB_NAME="onnxruntime.dll" ;;
    Linux)                PLATFORM="linux-x64"; ARCHIVE_EXT="tgz"; LIB_NAME="libonnxruntime.so.${ORT_VERSION}" ;;
    Darwin)               PLATFORM="osx-universal2"; ARCHIVE_EXT="tgz"; LIB_NAME="libonnxruntime.${ORT_VERSION}.dylib" ;;
    *) echo "Unsupported OS: $(uname -s)"; exit 1 ;;
esac

ASSET="onnxruntime-${PLATFORM}-${ORT_VERSION}.${ARCHIVE_EXT}"
URL="https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/${ASSET}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[onnxruntime] Fetching $URL"
curl -sSfL -o "$TMP/$ASSET" "$URL"

echo "[onnxruntime] Extracting $ASSET"
if [ "$ARCHIVE_EXT" = "zip" ]; then
    unzip -q "$TMP/$ASSET" -d "$TMP"
else
    tar -xzf "$TMP/$ASSET" -C "$TMP"
fi

# Microsoft's archive layout: onnxruntime-<platform>-<ver>/lib/<libfile>.
EXTRACTED_LIB="$(find "$TMP" -type f -name "$LIB_NAME" | head -n1)"
if [ -z "$EXTRACTED_LIB" ]; then
    echo "Could not find $LIB_NAME inside the archive — layout may have changed"
    exit 1
fi

cp -f "$EXTRACTED_LIB" "$OUT_DIR/$(basename "$EXTRACTED_LIB")"
# On Linux the file is named libonnxruntime.so.1.23.0 but the `ort`
# crate's load-dynamic looks for `libonnxruntime.so`. Create a
# stable symlink alongside so either name resolves.
if [ "$(uname -s)" = "Linux" ]; then
    ln -sf "libonnxruntime.so.${ORT_VERSION}" "$OUT_DIR/libonnxruntime.so"
fi

echo "[onnxruntime] Installed to $OUT_DIR/"
ls -l "$OUT_DIR/"
