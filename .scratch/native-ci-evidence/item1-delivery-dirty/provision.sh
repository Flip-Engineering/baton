#!/bin/bash
set -euo pipefail
baton_qualification=/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/delivery-dirty-3d164b96-item1
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
git -c core.hooksPath=/dev/null clone --no-checkout source.bundle candidate
git -C candidate -c core.hooksPath=/dev/null checkout --detach 3d164b96cd03d495d5b13f850c709edc616bfe10
git -C candidate rev-parse HEAD HEAD^{tree}
test -z "$(git -C candidate status --porcelain=v1)"
cp delivery.bend.dirty candidate/bend2/src/coordinator/delivery.bend
printf '%s\n' 'cb183f7438e246e5d82ce626a86b0a50d1d72d94dd5249b89e63bcc04883aaa6  candidate/bend2/src/coordinator/delivery.bend' | sha256sum -c -
test "$(git -C candidate status --porcelain=v1)" = ' M bend2/src/coordinator/delivery.bend'
test "$(git -C candidate diff --shortstat)" = ' 1 file changed, 140 insertions(+), 36 deletions(-)'
git -C candidate diff > candidate-dirty.patch
printf '%s\n' 'c293f5ea6caf44eeab7ff923a8a66f9fb92c65c0dbdec70b3e205d3c67ea0ec5  candidate-dirty.patch' | sha256sum -c -
