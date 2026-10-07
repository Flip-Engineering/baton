#!/bin/bash
set -euo pipefail
baton_qualification=/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/controls-4e0dc88a
cd "$baton_qualification"
export PATH=/usr/bin:/bin
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
sha256sum -c inputs.sha256
cp /mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/baseline-0822-attempt2-ci165/artifact/toolchain/bend-2.0.25-linux-x64.tar.gz compiler.tar.gz
printf '%s\n' '91c0e2640f8d2e3e73fd3dd62ed4d178ce9a6f7ce8f8980b4dc4abf7a6f9ccd4  compiler.tar.gz' | sha256sum -c -
mkdir toolchain-home
tar -xzf compiler.tar.gz --strip-components=1 -C toolchain-home
sha256sum -c compiler.sha256
sha256sum -c toolchain.sha256 > provision-toolchain.txt
sha256sum -c python-stdlib.sha256 > provision-stdlib.txt
sha256sum /home/atari2036/baton-logging-686/toolchain-home/bin/bend
sha256sum /home/atari2036/baton-integrate-recovered-20261006/node22
sha256sum /home/atari2036/baton-sqlite-3460100/libsqlite3.so
git -c core.hooksPath=/dev/null clone --no-checkout source.bundle target
git -C target -c core.hooksPath=/dev/null checkout --detach d688c80f405abb626687a6cd3dd0b459230a76cc
git -c core.hooksPath=/dev/null clone --no-checkout source.bundle candidate
git -C candidate -c core.hooksPath=/dev/null checkout --detach 4e0dc88abc8538252b650113010f2b1de16336f9
git -C target rev-parse HEAD HEAD^{tree}
git -C candidate rev-parse HEAD HEAD^{tree}
test -z "$(git -C target status --porcelain=v1)"
test -z "$(git -C candidate status --porcelain=v1)"
