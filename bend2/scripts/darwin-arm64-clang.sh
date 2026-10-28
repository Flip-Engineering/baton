#!/bin/sh
set -eu

: "${BATON2_DARWIN_LLVM_ROOT:?set the staged LLVM toolchain directory}"
: "${BATON2_DARWIN_SDKROOT:?set the staged macOS SDK directory}"
clang="$BATON2_DARWIN_LLVM_ROOT/bin/clang"
linker="$BATON2_DARWIN_LLVM_ROOT/bin/ld64.lld"

test -x "$clang"
test -x "$linker"
test -d "$BATON2_DARWIN_SDKROOT/usr/include"

exec "$clang" \
  --target=arm64-apple-macosx11.0 \
  -isysroot "$BATON2_DARWIN_SDKROOT" \
  -B "$BATON2_DARWIN_LLVM_ROOT/bin" \
  -fuse-ld=lld \
  "$@"
