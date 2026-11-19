#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root on the Linux validation host.' >&2; exit 1; }
readonly source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 0755 /etc/systemd/user/flip-colima.service.d
install -m 0644 "$source_dir/baton-workloads.slice" /etc/systemd/user/baton-workloads.slice
install -m 0644 "$source_dir/flip-colima.conf" /etc/systemd/user/flip-colima.service.d/90-baton-oom.conf
systemctl enable --now systemd-oomd.service
systemctl --global enable baton-workloads.slice
while read -r uid user _; do
    [[ $uid =~ ^[0-9]+$ && -S /run/user/$uid/bus ]] || continue
    manager=(systemctl --user --machine="$user@.host")
    "${manager[@]}" daemon-reload
    if "${manager[@]}" is-active --quiet flip-colima.service; then
        "${manager[@]}" set-property --runtime flip-colima.service ManagedOOMMemoryPressure=auto ManagedOOMPreference=omit
        "${manager[@]}" show flip-colima.service -p ManagedOOMPreference -p ControlGroup
    fi
    "${manager[@]}" start baton-workloads.slice
    "${manager[@]}" set-property --runtime baton-workloads.slice MemoryAccounting=yes ManagedOOMMemoryPressure=kill
    "${manager[@]}" show baton-workloads.slice -p ManagedOOMMemoryPressure -p ControlGroup
done < <(loginctl list-users --no-legend --no-pager)
oomctl --no-pager
