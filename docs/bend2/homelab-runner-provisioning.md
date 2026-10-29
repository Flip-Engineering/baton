# Provision the additional Linux runner

The native workflow's `darwin-arm64` job runs its cross-build on a Linux x64 self-hosted runner. It requests runner group `baton2-native-homelab` and labels `self-hosted`, `Linux`, `X64`, `baton2-native-linux-x64`, and `baton2-native-darwin-cross`. The capability label is for runner accounts with verified read and execute access to the pinned Darwin LLVM tree and read access to the pinned SDK tree and transfer manifest. The primary runner and runner3 passed those checks; runner2 did not. Linux jobs continue to request only the Linux runner labels. The group restricts repository and workflow access. The runner service binds `/var/tmp/baton2-compile-queue` and runs as a dedicated account with the existing systemd isolation profile.

`deploy/provision-baton2-native-homelab-runner-3.sh` provisions one additional runner on the homelab host. Before running it, confirm host capacity, verify the group policy for the exact workflow ref with `bend2/scripts/check-runner-group-readiness.py`, and confirm the target runner name is absent from the organization. For the current release workflow, run:

```sh
python3 bend2/scripts/check-runner-group-readiness.py \
  --workflow-branch release/main-cgen-reuse-20261028
```

The script verifies the pinned Actions Runner 2.337.0 archive, creates account `batonci3`, registers runner `atari-homelab-baton2-native-3` in the existing group with the workflow labels, installs the dedicated service unit, and starts only that new service. It copies the pinned `bin/runsvc.sh` to the runner root as `runsvc.sh`, as required by the SDK service-install procedure. It verifies the shared compile queue group name and GID before adding the runner account to that group. The service binds the maintained compile queue. Build invocations continue through `.github/scripts/queue-native-checks.py`.

The Darwin package job reads the pinned LLVM tree at `/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/code-semantics-d5384042/staged/llvm` and the `MacOSX15.5.sdk` tree and transfer manifest from the adjacent `toolchains/apple` directory. The service unit masks `/mnt/nvme4tb/ci-runners/baton2-native-homelab` with a private temporary filesystem, then binds those three exact assets read-only at their pinned paths. The provisioner verifies the transfer-manifest SHA256 before granting `batonci3` read access on that file only. The runner service sees the assets with the absolute paths required by the SDK transfer manifest, while files such as the private qualification credentials remain hidden. The workflow uses `BATON2_DARWIN_LLVM_ROOT` and `BATON2_DARWIN_SDKROOT` for compiler hashing and packaging.

Run from a trusted checkout with the organization's authenticated GitHub CLI context:

```sh
gh api --method POST orgs/Flip-Engineering/actions/runners/registration-token --jq .token \
  | sudo ./deploy/provision-baton2-native-homelab-runner-3.sh
```

Use `--resume` when a registration attempt has left the staged account and extracted runner tree in place. Resume verifies account UID 980 and GID 971, the home and runner tree ownership, the pinned archive digest, and the staged configuration script, listener, and bundled Node hashes against that archive. It also verifies the absence of runner registration files and the service unit. If `.path` exists, resume verifies it is a mode 0600 regular file owned by UID 980 and GID 971 and preserves it as runner environment metadata. Fresh extraction restores mode 0700 on the runner directory after ownership changes. Resume preserves the existing account and runner tree. Confirm the staged state before requesting a fresh token, then run:

```sh
gh api --method POST orgs/Flip-Engineering/actions/runners/registration-token --jq .token \
  | sudo ./deploy/provision-baton2-native-homelab-runner-3.sh --resume
```

The registration token is sent through the pipe to the provisioning process. Do not print it or store it in a file. GitHub expires the registration token after one hour. The script passes it to `config.sh` through the runner's input environment and clears it from its process environment after configuration. See [GitHub's runner registration instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners), [runner group instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access), and [label instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels).

The configuration process uses the runner home and working directory. On registration failure, configuration stdout and stderr remain root-owned with mode 0600, and the runner's restricted `_diag` directory remains available for inspection. After startup, the script verifies that the service remains active with the same main PID and restart count for five seconds, then removes registration diagnostics. Verify that the runner is online in the organization inventory before relying on it for job admission.

After startup, use the organization runner inventory to verify the registered runner ID, runner group, labels, online state, and idle state. Then confirm job `darwin-arm64` in the existing release run receives a runner and continue through artifact upload. Preserve the workflow's queue configuration and all active runner jobs. If registration or startup fails, retain the staged directory and inspect runner and service state before retrying.

To retry Darwin packaging after a package-only failure when the original Linux producer succeeded, dispatch the workflow at the corrected workflow ref with the exact source commit and the producer run ID and attempt. For the retained producer run, use source commit `87ab1cf124e62a5ada61a688ba90f8d55d423431` and set `reuse_generated_c_producer` to `40753657208/1`; leave `target_commit` blank. The workflow downloads the existing `baton2-generated-c-<source-commit>-<attempt>` artifact from that run and verifies its source, compiler selection, C digest, producer checks, and embedded run identity before packaging. The dispatch omits the Linux candidate and Linux native qualification jobs. It packages the verified C artifact without running the Main C producer again.
