#!/bin/bash
set -euo pipefail
baton_qualification=/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/code-semantics-d5384042
cd "$baton_qualification"
export PATH=/usr/bin:/bin
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
sha256sum -c inputs.sha256
sha256sum -c toolchain.sha256 > provision-toolchain.txt
sha256sum -c python-stdlib.sha256 > provision-stdlib.txt
# Staged toolchain extraction (archives hash-verified by inputs.sha256)
mkdir -p staged/node staged/typescript staged/llvm
tar -xJf staged/node-v22.15.0-linux-x64.tar.xz --strip-components=1 -C staged/node
tar -xzf staged/typescript-5.9.3.tgz -C staged/typescript
tar -xJf staged/LLVM-20.1.8-Linux-X64.tar.xz --strip-components=1 -C staged/llvm
staged/node/bin/node --version
staged/node/bin/node -e "console.log(require('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/code-semantics-d5384042/staged/typescript/package/lib/typescript.js').version)"
staged/llvm/bin/clang --version
staged/llvm/bin/clangd --version
git -c core.hooksPath=/dev/null clone --no-checkout source.bundle candidate
git -C candidate -c core.hooksPath=/dev/null checkout --detach d5384042dff2d108496b25e2422220fc2a701556
git -C candidate rev-parse HEAD HEAD^{tree}
test -z "$(git -C candidate status --porcelain=v1)"
