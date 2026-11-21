#!/usr/bin/env bash
set -euo pipefail

[[ $EUID == 0 ]] || { echo 'Run as root on the Linux validation host.' >&2; exit 1; }
readonly source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly history_dir=/mnt/nvme4tb/host-history/atop
mountpoint -q /mnt/nvme4tb

apt-get install -y atop
install -d -m 0700 "$history_dir"
if [[ -f /etc/default/atop && ! -e /etc/default/atop.before-baton-1503 ]]; then
    cp -p /etc/default/atop /etc/default/atop.before-baton-1503
fi
install -m 0644 "$source_dir/atop.default" /etc/default/atop
install -d -m 0755 /etc/systemd/system/atop.service.d
install -m 0644 "$source_dir/atop.service.conf" /etc/systemd/system/atop.service.d/baton-history.conf
systemctl daemon-reload
systemctl enable atop.service atop-rotate.timer
systemctl restart atop.service
systemctl start atop-rotate.timer
systemctl --no-pager status atop.service atop-rotate.timer
