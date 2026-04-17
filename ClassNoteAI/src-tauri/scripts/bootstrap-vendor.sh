#!/usr/bin/env bash
# Re-creates src-tauri/vendor/ from crates.io + applies Windows-build patches.
# Idempotent: skips crates that already exist.
#
# Why: on Windows we need two tiny source patches to make ct2rs (/MT->/MD)
# and esaxx-rs (drop static_crt) link cleanly with the rest of the /MD world.
# We keep only the .patch files in git; this script hydrates vendor/ on demand.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$TAURI_DIR/vendor"
PATCH_DIR="$TAURI_DIR/vendor-patches"

mkdir -p "$VENDOR_DIR"

fetch_and_patch() {
    local name="$1"
    local version="$2"
    shift 2
    local target="$VENDOR_DIR/$name"

    if [ -d "$target" ]; then
        echo "[skip] $name already vendored at $target"
        return
    fi

    local url="https://static.crates.io/crates/$name/$name-$version.crate"
    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN

    echo "[fetch] $name-$version from crates.io"
    curl -sSfL -o "$tmp/crate.tar.gz" "$url"
    tar -xzf "$tmp/crate.tar.gz" -C "$tmp"
    mv "$tmp/$name-$version" "$target"

    for patch in "$@"; do
        echo "[patch] $name <- $patch"
        ( cd "$target" && patch -p1 < "$PATCH_DIR/$patch" )
    done
}

fetch_and_patch ct2rs    0.9.13  ct2rs-build.patch ct2rs-cmakelists.patch
fetch_and_patch esaxx-rs 0.1.10  esaxx-rs-build.patch

echo "[done] vendor/ is ready"
