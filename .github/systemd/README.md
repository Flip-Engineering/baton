# Baton2 native runner systemd files

Install `baton2-native-toolchain-acl.service` as
`/etc/systemd/system/baton2-native-toolchain-acl.service`.

Install `baton2-native-toolchain-acl.conf` as
`/etc/systemd/system/baton2-native-homelab.service.d/10-toolchain-acl.conf`,
`/etc/systemd/system/baton2-native-homelab-2.service.d/10-toolchain-acl.conf`,
and `/etc/systemd/system/baton2-native-homelab-3.service.d/10-toolchain-acl.conf`.
The shared drop-in requires the ACL service before each runner starts.

The ACL service grants `batonci2` and `batonci3` traverse access to the
primary runner and toolchain directories. Each runner start reapplies the ACL
entries.

Run `systemctl daemon-reload` after installing these files. Runner services do
not need to restart while the ACL service is installed.
