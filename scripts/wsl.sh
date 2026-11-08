#!/usr/bin/env bash
# Local helper for building on a Windows machine through WSL. Toolchain lives on D:, while the
# crate registry and build output stay on the Linux disk because /mnt/d is too slow for them.
# Usage: scripts/wsl.sh <command...>
export RUSTUP_HOME=/mnt/d/.tenor-rust/rustup
export CARGO_HOME="$HOME/.tenor-cargo"
export CARGO_TARGET_DIR="$HOME/.tenor-target"
export PATH="/mnt/d/.tenor-rust/cargo/bin:$PATH"
cd "$(dirname "$0")/.."
exec "$@"
