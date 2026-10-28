# Provision the additional Linux runner

The native workflow's `darwin-arm64` job runs its cross-build on a Linux x64 self-hosted runner. It requests runner group `baton2-native-homelab` and labels `self-hosted`, `Linux`, `X64`, and `baton2-native-linux-x64`. The group restricts repository and workflow access. The runner service binds `/var/tmp/baton2-compile-queue` and runs as a dedicated account with the existing systemd isolation profile.

`deploy/provision-baton2-native-homelab-runner-3.sh` provisions one additional runner on the homelab host. Before running it, confirm host capacity, verify the group policy for the exact workflow ref with `bend2/scripts/check-runner-group-readiness.py`, and confirm the target runner name is absent from the organization. For the current release workflow, run:

```sh
python3 bend2/scripts/check-runner-group-readiness.py \
  --workflow-branch release/main-cgen-reuse-20261028
```

The script verifies the pinned Actions Runner 2.337.0 archive, creates account `batonci3`, registers runner `atari-homelab-baton2-native-3` in the existing group with the workflow labels, installs the dedicated service unit, and starts only that new service. It verifies the shared compile queue group name and GID before adding the runner account to that group. The service binds the maintained compile queue. Build invocations continue through `.github/scripts/queue-native-checks.py`.

Run from a trusted checkout with the organization's authenticated GitHub CLI context:

```sh
gh api --method POST orgs/Flip-Engineering/actions/runners/registration-token --jq .token \
  | sudo ./deploy/provision-baton2-native-homelab-runner-3.sh
```

The registration token is sent through the pipe to the provisioning process. Do not print it or store it in a file. GitHub expires the registration token after one hour. The script passes it to `config.sh` through the runner's input environment, suppresses configuration output, removes configuration diagnostics, and clears the token from its process environment before starting the service. See [GitHub's runner registration instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners), [runner group instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access), and [label instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels).

After startup, use the organization runner inventory to verify the registered runner ID, runner group, labels, online state, and idle state. Then confirm job `darwin-arm64` in the existing release run receives a runner and continue through artifact upload. Preserve the workflow's queue configuration and all active runner jobs. If registration or startup fails, retain the staged directory and inspect runner and service state before retrying.
