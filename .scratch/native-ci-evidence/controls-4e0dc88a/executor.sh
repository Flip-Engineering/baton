#!/bin/bash
set -uo pipefail
baton_qualification=/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/controls-4e0dc88a
cd "$baton_qualification" || exit
printf '%s\n' "$$" > executor.pid
printf '%s\n' "$HOME" > service-home-before.txt
date -u +%FT%TZ > executor-started.txt
baton_status=0
/usr/bin/env -i HOME="$HOME" USER=batonci LOGNAME=batonci PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 /usr/bin/python3.12 "$baton_qualification/qualify.py" || baton_status=$?
printf '{"exit_code":%s}\n' "$baton_status" > executor-exit.json
printf '%s\n' "$HOME" > service-home-after.txt
date -u +%FT%TZ > executor-ended.txt
exit "$baton_status"
