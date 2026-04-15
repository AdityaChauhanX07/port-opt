#!/usr/bin/env bash
# Build the engine-wasm crate to WebAssembly and bundle it for the web app.
#
# Prerequisites:
#   cargo install wasm-pack      (or: cargo install wasm-bindgen-cli)
#   rustup target add wasm32-unknown-unknown
#
# Output:
#   packages/engine-wasm/pkg/   — wasm-pack output (ESM + .d.ts)
#
# Usage:
#   bash scripts/build-wasm.sh            # release build (default)
#   WASM_DEV=1 bash scripts/build-wasm.sh # dev build (faster, larger)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRATE_DIR="$REPO_ROOT/packages/engine-wasm"
PKG_DIR="$CRATE_DIR/pkg"

echo "==> Building engine-wasm..."

# Check wasm-pack is available
if ! command -v wasm-pack &>/dev/null; then
  echo "Error: wasm-pack not found. Install it with: cargo install wasm-pack" >&2
  exit 1
fi

cd "$CRATE_DIR"

if [[ "${WASM_DEV:-0}" == "1" ]]; then
  echo "    Mode: development (unoptimised)"
  wasm-pack build --dev --target web --out-dir "$PKG_DIR"
else
  echo "    Mode: release (optimised)"
  wasm-pack build --release --target web --out-dir "$PKG_DIR"
fi

echo "==> Done.  Output in: $PKG_DIR"
