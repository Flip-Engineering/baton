#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly RUNNER_USER=batonci3
readonly RUNNER_GROUP=batonci3
readonly RUNNER_NAME=atari-homelab-baton2-native-3
readonly RUNNER_GROUP_NAME=baton2-native-homelab
readonly RUNNER_LABELS=self-hosted,Linux,X64,baton2-native-linux-x64
readonly BASE=/mnt/nvme4tb/ci-runners/baton2-native-homelab-3
readonly RUNNER_DIR=$BASE/runner
readonly SERVICE_NAME=baton2-native-homelab-3.service
readonly QUEUE_GROUP_GID=974
readonly UNIT_SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/systemd/baton2-native-homelab-3.service
readonly UNIT_DEST=/etc/systemd/system/baton2-native-homelab-3.service
readonly ARCHIVE=/mnt/nvme4tb/ci-runners/_dist/actions-runner-linux-x64-2.337.0.tar.gz
readonly ARCHIVE_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613

fail() {
    printf 'provision-baton2-native-homelab-runner-3: %s\n' "$1" >&2
    exit 1
}

cleanup_registration_data() {
    unset registration_token ACTIONS_RUNNER_INPUT_TOKEN
    if [[ -d $RUNNER_DIR/_diag && ! -L $RUNNER_DIR/_diag ]]; then
        rm -rf -- "$RUNNER_DIR/_diag"
    fi
}

[[ $EUID -eq 0 ]] || fail 'run as root'
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail 'host must be Linux x86_64'
[[ ! -t 0 ]] || fail 'pipe one organization runner registration token on stdin'
[[ -r $ARCHIVE ]] || fail "runner archive is unavailable: $ARCHIVE"
[[ -r $UNIT_SOURCE ]] || fail "service unit is unavailable: $UNIT_SOURCE"
[[ ! -e $BASE && ! -e $UNIT_DEST ]] || fail 'runner path or service unit already exists; inspect the existing state'
! id "$RUNNER_USER" >/dev/null 2>&1 || fail "service account already exists: $RUNNER_USER"
getent group baton-compile >/dev/null || fail 'shared compile queue group baton-compile is missing'
[[ $(getent group baton-compile | cut -d: -f3) == "$QUEUE_GROUP_GID" ]] \
    || fail "shared compile queue group baton-compile must have GID $QUEUE_GROUP_GID"
[[ -d /var/tmp/baton2-compile-queue && -x /var/tmp/baton2-compile-queue/compile-queue-runner ]] \
    || fail 'maintained shared compile queue is unavailable'

printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE" | sha256sum --check --status \
    || fail 'runner archive digest does not match the pinned 2.337.0 release'

registration_token=
IFS= read -r registration_token || [[ -n $registration_token ]] \
    || fail 'registration token input is empty'
[[ -n $registration_token ]] || fail 'registration token input is empty'
extra_input=
if IFS= read -r extra_input; then
    fail 'stdin must contain exactly one registration-token line'
fi
trap cleanup_registration_data EXIT

useradd --system --create-home --home-dir "$BASE/home" --shell /usr/sbin/nologin \
    --user-group "$RUNNER_USER"
usermod --append --groups baton-compile "$RUNNER_USER"
install -d -o "$RUNNER_USER" -g "$RUNNER_GROUP" -m 0700 \
    "$BASE" "$BASE/temp" "$BASE/tool-cache" "$RUNNER_DIR"
tar -xzf "$ARCHIVE" -C "$RUNNER_DIR"
chown -R "$RUNNER_USER:$RUNNER_GROUP" "$BASE"

if ! ACTIONS_RUNNER_INPUT_URL=https://github.com/Flip-Engineering \
    ACTIONS_RUNNER_INPUT_TOKEN="$registration_token" \
    ACTIONS_RUNNER_INPUT_NAME="$RUNNER_NAME" \
    ACTIONS_RUNNER_INPUT_RUNNERGROUP="$RUNNER_GROUP_NAME" \
    ACTIONS_RUNNER_INPUT_LABELS="$RUNNER_LABELS" \
    ACTIONS_RUNNER_INPUT_WORK=_work \
    runuser --preserve-environment -u "$RUNNER_USER" -- "$RUNNER_DIR/config.sh" \
        --disableupdate --unattended >/dev/null 2>&1; then
    fail 'runner registration failed; preserve the staged directory for review'
fi
unset registration_token
for credential in .credentials .credentials_rsaparams .runner; do
    [[ -f $RUNNER_DIR/$credential && ! -L $RUNNER_DIR/$credential ]] \
        || fail "runner registration did not create $credential"
    chmod 0600 "$RUNNER_DIR/$credential"
done
rm -rf -- "$RUNNER_DIR/_diag"
trap - EXIT

install -o root -g root -m 0644 "$UNIT_SOURCE" "$UNIT_DEST"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || fail 'new runner service is not active'
printf 'service active: %s; runner: %s; group: %s; labels: %s\n' \
    "$SERVICE_NAME" "$RUNNER_NAME" "$RUNNER_GROUP_NAME" "$RUNNER_LABELS"
