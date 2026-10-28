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
readonly RUNNER_VERSION=2.337.0
readonly RESUME_UID=980
readonly RESUME_GID=971
readonly QUEUE_GROUP_GID=974
readonly UNIT_SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/systemd/baton2-native-homelab-3.service
readonly UNIT_DEST=/etc/systemd/system/baton2-native-homelab-3.service
readonly ARCHIVE=/mnt/nvme4tb/ci-runners/_dist/actions-runner-linux-x64-2.337.0.tar.gz
readonly ARCHIVE_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613
readonly CONFIG_STDOUT=$BASE/.provision-config.stdout
readonly CONFIG_STDERR=$BASE/.provision-config.stderr

fail() {
    printf 'provision-baton2-native-homelab-runner-3: %s\n' "$1" >&2
    exit 1
}

clear_registration_token() {
    unset registration_token ACTIONS_RUNNER_INPUT_TOKEN
}

validate_private_diagnostic_file() {
    local path=$1
    if [[ -e $path || -L $path ]]; then
        [[ -f $path && ! -L $path ]] || fail "diagnostic path is not a regular file: $path"
        [[ $(stat -c '%u:%g:%a' "$path") == 0:0:600 ]] \
            || fail "diagnostic file must remain root-owned with mode 0600: $path"
    fi
}

verify_archive_member() {
    local member=$1
    local staged_file=$2
    local archive_digest
    local staged_digest
    [[ -f $staged_file && ! -L $staged_file ]] \
        || fail "resume requires the staged runner file: $staged_file"
    archive_digest=$(tar -xOzf "$ARCHIVE" "$member" | sha256sum | cut -d' ' -f1) \
        || fail "could not read the pinned runner archive member: $member"
    staged_digest=$(sha256sum "$staged_file" | cut -d' ' -f1) \
        || fail "could not hash the staged runner file: $staged_file"
    [[ $staged_digest == "$archive_digest" ]] \
        || fail "staged runner file does not match the pinned archive: $member"
}

[[ $EUID -eq 0 ]] || fail 'run as root'
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail 'host must be Linux x86_64'
[[ ! -t 0 ]] || fail 'pipe one organization runner registration token on stdin'
mode=fresh
if [[ $# -gt 1 ]]; then
    fail 'usage: provision-baton2-native-homelab-runner-3.sh [--resume]'
elif [[ $# -eq 1 ]]; then
    [[ $1 == --resume ]] || fail 'usage: provision-baton2-native-homelab-runner-3.sh [--resume]'
    mode=resume
fi
[[ -r $ARCHIVE ]] || fail "runner archive is unavailable: $ARCHIVE"
[[ -r $UNIT_SOURCE ]] || fail "service unit is unavailable: $UNIT_SOURCE"
if [[ $mode == fresh ]]; then
    [[ ! -e $BASE && ! -L $BASE && ! -e $UNIT_DEST && ! -L $UNIT_DEST ]] \
        || fail 'runner path or service unit already exists; inspect the existing state'
    ! id "$RUNNER_USER" >/dev/null 2>&1 || fail "service account already exists: $RUNNER_USER"
else
    [[ -d $BASE && ! -L $BASE ]] || fail 'resume requires the existing staged runner directory'
    [[ ! -e $UNIT_DEST && ! -L $UNIT_DEST ]] || fail 'resume requires the runner service to remain uninstalled'
    id "$RUNNER_USER" >/dev/null 2>&1 || fail "resume requires the existing service account: $RUNNER_USER"
    [[ $(id -u "$RUNNER_USER") == "$RESUME_UID" ]] \
        || fail "resume requires staged account UID $RESUME_UID"
    [[ $(id -g "$RUNNER_USER") == "$RESUME_GID" ]] \
        || fail "resume requires staged account GID $RESUME_GID"
    [[ $(getent group "$RUNNER_GROUP" | cut -d: -f3) == "$RESUME_GID" ]] \
        || fail "resume requires staged group $RUNNER_GROUP with GID $RESUME_GID"
    passwd_record=$(getent passwd "$RUNNER_USER") || fail 'staged service account record is unavailable'
    IFS=: read -r _ _ _ _ _ staged_home staged_shell <<< "$passwd_record"
    [[ $staged_home == "$BASE/home" && $staged_shell == /usr/sbin/nologin ]] \
        || fail 'resume requires the staged account home and nologin shell'
    [[ $(stat -c '%u:%g:%a' "$BASE") == "$RESUME_UID:$RESUME_GID:700" ]] \
        || fail 'resume requires the staged runner directory to remain owned by batonci3 with mode 0700'
    [[ -d $BASE/home && ! -L $BASE/home ]] || fail 'resume requires the staged account home directory'
    [[ $(stat -c '%u:%g' "$BASE/home") == "$RESUME_UID:$RESUME_GID" ]] \
        || fail 'resume requires the staged account home to retain its owner'
    for private_dir in "$BASE/temp" "$BASE/tool-cache"; do
        [[ -d $private_dir && ! -L $private_dir ]] \
            || fail "resume requires the staged private directory: $private_dir"
        [[ $(stat -c '%u:%g:%a' "$private_dir") == "$RESUME_UID:$RESUME_GID:700" ]] \
            || fail "resume requires staged private-directory ownership and mode 0700: $private_dir"
    done
    [[ -d $RUNNER_DIR && ! -L $RUNNER_DIR ]] || fail 'resume requires the extracted runner directory'
    [[ $(stat -c '%u:%g:%a' "$RUNNER_DIR") == "$RESUME_UID:$RESUME_GID:700" ]] \
        || fail 'resume requires the runner directory to remain owned by batonci3 with mode 0700'
    [[ -x $RUNNER_DIR/config.sh && -x $RUNNER_DIR/bin/Runner.Listener \
        && -x $RUNNER_DIR/externals/node24/bin/node ]] \
        || fail "resume requires the complete Actions Runner $RUNNER_VERSION tree"
    for state_file in .runner .credentials .credentials_rsaparams .path; do
        [[ ! -e $RUNNER_DIR/$state_file && ! -L $RUNNER_DIR/$state_file ]] \
            || fail "resume requires empty runner registration state: $state_file exists"
    done
    [[ ! -L $RUNNER_DIR/_diag ]] || fail 'resume refuses a symlinked runner diagnostics directory'
    if [[ -d $RUNNER_DIR/_diag ]]; then
        [[ $(stat -c '%u:%g:%a' "$RUNNER_DIR/_diag") == "$RESUME_UID:$RESUME_GID:700" ]] \
            || fail 'resume requires runner registration diagnostics to remain private'
    fi
    validate_private_diagnostic_file "$CONFIG_STDOUT"
    validate_private_diagnostic_file "$CONFIG_STDERR"
fi
getent group baton-compile >/dev/null || fail 'shared compile queue group baton-compile is missing'
[[ $(getent group baton-compile | cut -d: -f3) == "$QUEUE_GROUP_GID" ]] \
    || fail "shared compile queue group baton-compile must have GID $QUEUE_GROUP_GID"
[[ -d /var/tmp/baton2-compile-queue && -x /var/tmp/baton2-compile-queue/compile-queue-runner ]] \
    || fail 'maintained shared compile queue is unavailable'

printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE" | sha256sum --check --status \
    || fail 'runner archive digest does not match the pinned 2.337.0 release'

if [[ $mode == resume ]]; then
    verify_archive_member ./config.sh "$RUNNER_DIR/config.sh"
    verify_archive_member ./bin/Runner.Listener "$RUNNER_DIR/bin/Runner.Listener"
    verify_archive_member ./externals/node24/bin/node "$RUNNER_DIR/externals/node24/bin/node"
fi

if [[ $mode == fresh ]]; then
    useradd --system --create-home --home-dir "$BASE/home" --shell /usr/sbin/nologin \
        --user-group "$RUNNER_USER"
    usermod --append --groups baton-compile "$RUNNER_USER"
    install -d -o "$RUNNER_USER" -g "$RUNNER_GROUP" -m 0700 \
        "$BASE" "$BASE/temp" "$BASE/tool-cache" "$RUNNER_DIR"
    tar -xzf "$ARCHIVE" -C "$RUNNER_DIR"
    chown -R "$RUNNER_USER:$RUNNER_GROUP" "$BASE"
fi

command -v setfacl >/dev/null 2>&1 || fail 'setfacl is required to grant the runner account path traversal'
setfacl -m "u:$RUNNER_USER:--x" /mnt/nvme4tb
runuser --user "$RUNNER_USER" -- /usr/bin/test -x /mnt/nvme4tb \
    || fail 'runner account cannot traverse the homelab mount'

if ! id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -Fxq baton-compile; then
    usermod --append --groups baton-compile "$RUNNER_USER"
fi

registration_token=
trap clear_registration_token EXIT
IFS= read -r registration_token || [[ -n $registration_token ]] \
    || fail 'registration token input is empty'
[[ -n $registration_token ]] || fail 'registration token input is empty'
extra_input=
if IFS= read -r extra_input; then
    fail 'stdin must contain exactly one registration-token line'
fi
if [[ ! -e $CONFIG_STDOUT && ! -L $CONFIG_STDOUT ]]; then
    install -o root -g root -m 0600 /dev/null "$CONFIG_STDOUT"
fi
if [[ ! -e $CONFIG_STDERR && ! -L $CONFIG_STDERR ]]; then
    install -o root -g root -m 0600 /dev/null "$CONFIG_STDERR"
fi
printf 'configuration attempt started at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$CONFIG_STDOUT"
printf 'configuration attempt started at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$CONFIG_STDERR"

if ! HOME="$BASE/home" USER="$RUNNER_USER" LOGNAME="$RUNNER_USER" \
    TMPDIR="$BASE/temp" RUNNER_TOOL_CACHE="$BASE/tool-cache" \
    ACTIONS_RUNNER_INPUT_URL=https://github.com/Flip-Engineering \
    ACTIONS_RUNNER_INPUT_TOKEN="$registration_token" \
    ACTIONS_RUNNER_INPUT_NAME="$RUNNER_NAME" \
    ACTIONS_RUNNER_INPUT_RUNNERGROUP="$RUNNER_GROUP_NAME" \
    ACTIONS_RUNNER_INPUT_LABELS="$RUNNER_LABELS" \
    ACTIONS_RUNNER_INPUT_WORK=_work \
    runuser --preserve-environment -u "$RUNNER_USER" -- /bin/bash -c \
        'cd -- "$1" && umask 077 && exec ./config.sh --disableupdate --unattended' \
        provision-runner "$RUNNER_DIR" >> "$CONFIG_STDOUT" 2>> "$CONFIG_STDERR"; then
    if [[ -d $RUNNER_DIR/_diag && ! -L $RUNNER_DIR/_diag ]]; then
        chmod 0700 "$RUNNER_DIR/_diag"
    fi
    fail "runner registration failed; restricted diagnostics are retained at $CONFIG_STDOUT, $CONFIG_STDERR, and $RUNNER_DIR/_diag"
fi
unset registration_token
for credential in .credentials .credentials_rsaparams .runner; do
    [[ -f $RUNNER_DIR/$credential && ! -L $RUNNER_DIR/$credential ]] \
        || fail "runner registration did not create $credential"
    chmod 0600 "$RUNNER_DIR/$credential"
done
install -o root -g root -m 0644 "$UNIT_SOURCE" "$UNIT_DEST"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || fail 'new runner service is not active'
if [[ -d $RUNNER_DIR/_diag && ! -L $RUNNER_DIR/_diag ]]; then
    rm -rf -- "$RUNNER_DIR/_diag"
fi
rm -f -- "$CONFIG_STDOUT" "$CONFIG_STDERR"
trap - EXIT
printf 'service active: %s; runner: %s; group: %s; labels: %s\n' \
    "$SERVICE_NAME" "$RUNNER_NAME" "$RUNNER_GROUP_NAME" "$RUNNER_LABELS"
