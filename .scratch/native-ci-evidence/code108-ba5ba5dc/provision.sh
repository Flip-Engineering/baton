#!/bin/bash
set -euo pipefail
baton_qualification=/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/frontend-code108-ba5ba5dc
cd "$baton_qualification"
export PATH=/usr/bin:/bin
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
sha256sum -c inputs.sha256
sha256sum -c toolchain.sha256 > provision-toolchain.txt
sha256sum -c python-stdlib.sha256 > provision-stdlib.txt
git -c core.hooksPath=/dev/null clone --no-checkout source.bundle candidate
git -C candidate -c core.hooksPath=/dev/null checkout --detach ba5ba5dc7cf6f68caa288023b4c3a2625365d1dd
git -C candidate rev-parse HEAD HEAD^{tree}
test -z "$(git -C candidate status --porcelain=v1)"
cd candidate/bend2/context/bend2
sha256sum -c "$baton_qualification/candidate-files.sha256"
cd "$baton_qualification"
