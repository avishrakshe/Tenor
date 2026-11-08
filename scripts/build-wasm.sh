#!/usr/bin/env bash
# Builds every contract into wasm/. Equivalent to `cargo near build non-reproducible-wasm`:
# near-sdk 5.30 needs `--cfg near` to use the host functions.
set -euo pipefail
cd "$(dirname "$0")/.."
RUSTFLAGS='--cfg near -C link-arg=-s' cargo build --release --target wasm32-unknown-unknown \
  -p mock-ft -p tenor-oracle -p mock-swap -p tenor-guard -p tenor
mkdir -p wasm
cp "${CARGO_TARGET_DIR:-target}"/wasm32-unknown-unknown/release/*.wasm wasm/
ls -l wasm
