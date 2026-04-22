#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  else
    shasum -a 256
  fi
}

normalize_cargo_toml() {
  awk '
    /^\[/ { in_package = ($0 == "[package]") }
    in_package && /^version = / { next }
    { print }
  ' "$1"
}

normalize_cargo_lock() {
  awk '
    /^\[\[package\]\]$/ { root_pkg = 0; print; next }
    /^name = "classnoteai"$/ { root_pkg = 1; print; next }
    root_pkg && /^version = / { next }
    { print }
  ' "$1"
}

normalize_cargo_toml "$TAURI_DIR/Cargo.toml" > "$TMP_DIR/Cargo.toml.normalized"
normalize_cargo_lock "$TAURI_DIR/Cargo.lock" > "$TMP_DIR/Cargo.lock.normalized"

{
  hash_file "$TMP_DIR/Cargo.toml.normalized"
  hash_file "$TMP_DIR/Cargo.lock.normalized"

  git -C "$ROOT_DIR" ls-files \
    src-tauri/vendor-patches \
    src-tauri/scripts/bootstrap-vendor.sh \
    src-tauri/scripts/win-toolchain.cmake \
    | LC_ALL=C sort \
    | while IFS= read -r file; do
        hash_file "$ROOT_DIR/$file"
      done
} | hash_stream | cut -d' ' -f1
