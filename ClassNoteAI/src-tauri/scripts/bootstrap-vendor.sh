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
CHECKSUM_FILE="${BOOTSTRAP_VENDOR_CHECKSUM_FILE:-$PATCH_DIR/crate-checksums.txt}"
CRATES_BASE_URL="${BOOTSTRAP_VENDOR_BASE_URL:-https://static.crates.io/crates}"

mkdir -p "$VENDOR_DIR"

sha256_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
        return
    fi
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
        return
    fi
    if command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$file" | awk '{print $NF}'
        return
    fi

    echo "[error] No SHA256 tool found (need sha256sum, shasum, or openssl)." >&2
    return 1
}

lookup_checksum() {
    local name="$1"
    local version="$2"
    awk -v name="$name" -v version="$version" '
        $1 == name && $2 == version { print $3; found = 1; exit }
        END {
            if (!found) exit 1
        }
    ' "$CHECKSUM_FILE"
}

fetch_and_patch() {
    local name="$1"
    local version="$2"
    shift 2
    local target="$VENDOR_DIR/$name"

    if [ -d "$target" ]; then
        echo "[skip] $name already vendored at $target"
        return
    fi

    local url="$CRATES_BASE_URL/$name/$name-$version.crate"
    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    local archive="$tmp/crate.tar.gz"
    local expected_checksum

    expected_checksum="$(lookup_checksum "$name" "$version")" || {
        echo "[error] Missing checksum for $name $version in $CHECKSUM_FILE" >&2
        return 1
    }

    echo "[fetch] $name-$version from crates.io"
    curl -sSfL -o "$archive" "$url"

    local actual_checksum
    actual_checksum="$(sha256_file "$archive")"
    if [ "$actual_checksum" != "$expected_checksum" ]; then
        echo "[error] SHA256 mismatch for $name-$version" >&2
        echo "        expected: $expected_checksum" >&2
        echo "          actual: $actual_checksum" >&2
        return 1
    fi
    echo "[verify] $name-$version sha256 OK"

    tar -xzf "$archive" -C "$tmp"
    mv "$tmp/$name-$version" "$target"

    for patch in "$@"; do
        echo "[patch] $name <- $patch"
        ( cd "$target" && patch -p1 < "$PATCH_DIR/$patch" )
    done
}

fetch_and_patch ct2rs    0.9.13  ct2rs-build.patch ct2rs-cmakelists.patch
fetch_and_patch esaxx-rs 0.1.10  esaxx-rs-build.patch

echo "[done] vendor/ is ready"
