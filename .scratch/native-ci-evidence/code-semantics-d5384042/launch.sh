#!/bin/bash
set -euo pipefail
baton_remote_root=/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/code-semantics-d5384042
baton_evidence=.scratch/native-ci-evidence/code-semantics-d5384042
ssh atari-homelab "sudo test -d '$baton_remote_root/staged'"
tar -C "$baton_evidence" -cf - qualify.py executor.sh provision.sh collect.py source.bundle toolchain.sha256 python-stdlib.sha256 inputs.sha256 | ssh atari-homelab "sudo -u batonci tar -xf - -C '$baton_remote_root'"
ssh atari-homelab "sudo -u batonci /bin/bash '$baton_remote_root/provision.sh'" > "$baton_evidence/provision.stdout" 2> "$baton_evidence/provision.stderr"
ssh atari-homelab "test \"\$(systemctl show baton2-code-semantics-d5384042.service -p LoadState --value)\" = not-found && sudo systemd-run --unit=baton2-code-semantics-d5384042 --property=User=batonci --property=Group=batonci --property=PrivateNetwork=yes --property=NoNewPrivileges=yes --property=RemainAfterExit=yes --property=WorkingDirectory='$baton_remote_root' --property=StandardOutput=append:'$baton_remote_root/service.stdout' --property=StandardError=append:'$baton_remote_root/service.stderr' /bin/bash '$baton_remote_root/executor.sh'" > "$baton_evidence/service-launch.txt" 2>&1
