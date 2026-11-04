# Baton2 native runner systemd files

Install `baton2-native-toolchain-acl.service` as
`/etc/systemd/system/baton2-native-toolchain-acl.service`.

Install `baton2-native-toolchain-acl.conf` as
`/etc/systemd/system/baton2-native-homelab.service.d/10-toolchain-acl.conf`,
`/etc/systemd/system/baton2-native-homelab-2.service.d/10-toolchain-acl.conf`,
and `/etc/systemd/system/baton2-native-homelab-3.service.d/10-toolchain-acl.conf`.
The shared drop-in requires the ACL service before each runner starts.

The ACL service adds execute-only access for `batonci2` and `batonci3` to the
restricted toolchain directories and read-only access to the SDK transfer
manifest. It changes filesystem ACL metadata and does not modify toolchain
files. The service uses the default `RemainAfterExit=no`, so each runner start
reapplies the ACL entries.

Run `systemctl daemon-reload` after installing these files. Runner services do
not need to restart while the ACL service is installed.
