#!/bin/sh
# Shared host compilation queue for the native build launchers.
#
# One keyed execution runs at a time per identity. The requester that finds no
# completed result starts a detached supervisor that holds the key lock, so a
# lost requester does not stop shared work. Other requesters block on the same
# lock and read the same result. Heavy C generation (kind cgen) is serialized
# host-wide; C compilation (kind cc) keeps the caller's parallel shard jobs and
# runs concurrently with other cc executions.
#
# The key covers source contents, compiler/toolchain identity, entry, mode and
# the relevant options. Completed C and objects are stored under the state root
# and copied to each requester's declared output paths.
set -u
LC_ALL=C
export LC_ALL

CQ_SCHEMA='baton-compile-queue-v1'
CQ_DEFAULT_TAIL=8192

cq_now_ns() {
  value=$(date +%s%N 2>/dev/null || true)
  case $value in
    *[!0-9]*|'') date +%s000000000 ;;
    *) printf '%s\n' "$value" ;;
  esac
}

cq_sha_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d' ' -f1
  else
    openssl dgst -sha256 | sed 's/^.* //'
  fi
}

cq_sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    openssl dgst -sha256 "$1" | sed 's/^.* //'
  fi
}

cq_size() { wc -c < "$1" | tr -d ' '; }

cq_realpath() {
  if readlink -f / >/dev/null 2>&1; then
    readlink -f "$1"
  else
    ( cd "$(dirname "$1")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$1")" )
  fi
}

cq_is_script() {
  [ "$(dd if="$1" bs=1 count=2 2>/dev/null)" = '#!' ]
}

cq_tail() {
  [ -f "$1" ] || return 0
  tail -c "${CQ_TAIL_BYTES:-$CQ_DEFAULT_TAIL}" "$1" 2>/dev/null || true
}

cq_die() {
  code=$1
  shift
  printf 'compile-queue: %s\n' "$*" >&2
  exit "$code"
}

cq_warn() { printf 'compile-queue: %s\n' "$*" >&2; }

cq_trace() {
  [ -n "${CQ_TRACE:-}" ] || return 0
  printf '%s %s %s\n' "$(cq_now_ns)" "$$" "$*" >> "$CQ_TRACE"
}

cq_starttime() {
  [ -r "/proc/$1/stat" ] || return 1
  sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $20}'
}

cq_alive() {
  pid=$1
  start=$2
  [ -n "$pid" ] || return 1
  current=$(cq_starttime "$pid") || return 1
  [ -n "$current" ] && [ "$current" = "$start" ]
}

cq_resolve_command() {
  case $1 in
    */*) printf '%s\n' "$(cq_realpath "$1")" ;;
    *) command -v "$1" 2>/dev/null || printf '%s\n' "$1" ;;
  esac
}

# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

cq_compiler_identity() {
  compiler=$1
  [ -n "$compiler" ] || { printf 'compiler=none\n'; return 0; }
  resolved=$(cq_resolve_command "$compiler")
  printf 'compiler-entry=%s\n' "$(cq_sha "$resolved")"
  steps=0
  while [ "$steps" -lt 5 ] && [ -f "$resolved" ] && cq_is_script "$resolved"; do
    steps=$((steps + 1))
    next=$(sed -n 's/^exec "\([^"]*\)".*$/\1/p' "$resolved" | head -n 1)
    case $next in
      /*) ;;
      *) break ;;
    esac
    [ -f "$next" ] || break
    resolved=$(cq_realpath "$next")
    [ -n "$resolved" ] || break
    printf 'compiler-wrapper=%s\n' "$(cq_sha "$resolved")"
  done
  root=$(dirname "$(dirname "$resolved")")
  if [ -f "$root/bend2/main.ts" ] && [ -f "$root/bin/bun" ]; then
    printf 'toolchain=release\n'
    (
      cd "$root" || exit 1
      find bend2 bin/bun -type f -print 2>/dev/null | sort
    ) | while IFS= read -r file; do
      [ -f "$root/$file" ] || continue
      printf 'toolchain-file=%s %s %s\n' "$file" "$(cq_sha "$root/$file")" "$(cq_size "$root/$file")"
    done
  else
    printf 'toolchain=executable\n'
  fi
}

cq_source_digest() {
  source_root=$1
  entry=$2
  case $entry in
    /*) entry_rel=${entry#"$source_root"/} ;;
    *) entry_rel=$entry ;;
  esac
  printf 'source-entry=%s\n' "$entry_rel"
  (
    cd "$source_root" || exit 1
    {
      find bend2/src -type f \( -name '*.bend' -o -name '*.c' -o -name '*.h' \) -print 2>/dev/null
      printf '%s\n' "$entry_rel"
      case $entry_rel in
        bend2/src/*) ;;
        *) directory=$(dirname "$entry_rel"); find "$directory" -type f \( -name '*.bend' -o -name '*.c' -o -name '*.h' \) -print 2>/dev/null ;;
      esac
    } | sort -u | while IFS= read -r file; do
      [ -f "$file" ] || continue
      printf 'source-file=%s %s %s\n' "$file" "$(cq_sha "$file")" "$(cq_size "$file")"
    done
  )
}

# cq_material: identity lines for one request.
# Arguments: kind cwd root source_root entry compiler input_map artifacts_file
#            options_file command_file
cq_material() {
  kind=$1
  cwd=$2
  root=$3
  source_root=$4
  entry=$5
  compiler=$6
  input_map=$7
  artifacts_file=$8
  options_file=$9
  command_file=${10}
  printf 'schema=%s\n' "$CQ_SCHEMA"
  printf 'kind=%s\n' "$kind"
  printf 'entry=%s\n' "$entry"
  sort "$options_file" | sed 's/^/option=/'
  cq_compiler_identity "$compiler"
  if [ "$kind" = cgen ]; then
    cq_source_digest "$source_root" "$entry"
  fi
  if [ -f "$input_map" ]; then
    while IFS='	' read -r source destination digest size; do
      [ -n "${destination:-}" ] || continue
      printf 'input=%s %s %s\n' "$destination" "$digest" "$size"
    done < "$input_map"
  fi
  if [ -f "$artifacts_file" ]; then
    while IFS='	' read -r name destination; do
      [ -n "${name:-}" ] || continue
      printf 'artifact-name=%s\n' "$name"
    done < "$artifacts_file"
  fi
  # Normalized command: output destinations, input copies, compiler and root
  # locations are replaced with stable tokens.
  [ -f "$command_file" ] || : > "$command_file"
  while IFS= read -r token; do
    value=$token
    if [ -f "$artifacts_file" ]; then
      while IFS='	' read -r name destination; do
        [ -n "${name:-}" ] || continue
        [ "$value" = "$destination" ] && value="{out:$name}"
      done < "$artifacts_file"
    fi
    if [ -f "$input_map" ]; then
      while IFS='	' read -r source destination digest size; do
        [ -n "${source:-}" ] || continue
        [ "$value" = "$source" ] && value="{in:$destination}"
      done < "$input_map"
    fi
    if [ -n "$compiler" ] && [ "$value" = "$compiler" ]; then
      value='{compiler}'
    fi
    if [ -n "$root" ]; then
      case $value in
        "$root"/*) value="@root/${value#"$root"/}" ;;
      esac
    fi
    if [ -n "$cwd" ]; then
      case $value in
        "$cwd"/*) value="@cwd/${value#"$cwd"/}" ;;
      esac
    fi
    printf 'argv=%s\n' "$value"
  done < "$command_file"
}

# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------

cq_result_get() {
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1
}

cq_result_artifact_rows() {
  grep '^artifact=' "$1" 2>/dev/null || true
}

cq_write_result() {
  # Arguments: path status exit kind key started_ns finished_ns attempt work stdout stderr detail
  path=$1
  status=$2
  exit_code=$3
  kind=$4
  key=$5
  started=$6
  finished=$7
  attempt=$8
  work=$9
  shift 9
  stdout_file=$1
  stderr_file=$2
  detail=$3
  [ -d "$(dirname "$path")" ] || return 1
  temporary="$path.tmp.$$"
  {
    printf 'schema=baton-compile-queue-result-v1\n'
    printf 'status=%s\n' "$status"
    printf 'exit=%s\n' "$exit_code"
    printf 'kind=%s\n' "$kind"
    printf 'key=%s\n' "$key"
    printf 'started_ns=%s\n' "$started"
    printf 'finished_ns=%s\n' "$finished"
    printf 'finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'attempt=%s\n' "$attempt"
    printf 'detail=%s\n' "$detail"
    for file in "$stdout_file" "$stderr_file"; do
      [ -f "$file" ] || continue
      label=$(basename "$file")
      printf 'log-%s-sha=%s\n' "$label" "$(cq_sha "$file")"
      printf 'log-%s-bytes=%s\n' "$label" "$(cq_size "$file")"
    done
    if [ -n "$work" ] && [ -d "$work" ]; then
      for name in $artifact_names; do
        source="$work/$name"
        [ -e "$source" ] || continue
        if [ -d "$source" ]; then
          digest=$( ( cd "$source" && find . -type f -print | sort | while IFS= read -r item; do
            printf '%s %s\n' "$item" "$(cq_sha "$item")"
          done ) | cq_sha_stdin)
          printf 'artifact=%s\tdirectory\t%s\n' "$name" "$digest"
        else
          printf 'artifact=%s\t%s\t%s\n' "$name" "$(cq_size "$source")" "$(cq_sha "$source")"
        fi
      done
    fi
  } > "$temporary"
  mv "$temporary" "$path"
}

cq_verify_completed() {
  # Arguments: keydir
  keydir=$1
  result="$keydir/completed/result"
  [ -f "$result" ] || return 1
  [ "$(cq_result_get "$result" status)" = completed ] || return 1
  rows=$(cq_result_artifact_rows "$result")
  [ -n "$rows" ] || return 1
  printf '%s\n' "$rows" | while IFS='	' read -r name kind digest; do
    name=${name#artifact=}
    [ -n "$name" ] || continue
    source="$keydir/completed/artifacts/$name"
    if [ "$kind" = directory ]; then
      [ -d "$source" ] || exit 1
    else
      [ -f "$source" ] || exit 1
      [ "$(cq_sha "$source")" = "$digest" ] || exit 1
    fi
  done
}

cq_copy_artifacts() {
  # Arguments: keydir artifacts_file
  keydir=$1
  artifacts_file=$2
  while IFS='	' read -r name destination; do
    [ -n "${name:-}" ] || continue
    source="$keydir/completed/artifacts/$name"
    [ -e "$source" ] || cq_die 2 "completed result is missing artifact $name"
    if [ -d "$source" ]; then
      temporary="$destination.queue-tmp.$$"
      rm -rf -- "$temporary"
      mkdir -p "$(dirname "$destination")"
      cp -a "$source" "$temporary" || cq_die 1 "cannot copy artifact $name to $destination"
      rm -rf -- "$destination"
      mv "$temporary" "$destination" || cq_die 1 "cannot install artifact $name at $destination"
    else
      mkdir -p "$(dirname "$destination")"
      temporary="$destination.queue-tmp.$$"
      cp -p "$source" "$temporary" || cq_die 1 "cannot copy artifact $name to $destination"
      mv "$temporary" "$destination" || cq_die 1 "cannot install artifact $name at $destination"
    fi
  done < "$artifacts_file"
}

cq_report_attempt_failure() {
  result=$1
  status=$(cq_result_get "$result" status)
  exit_code=$(cq_result_get "$result" exit)
  detail=$(cq_result_get "$result" detail)
  key=$(cq_result_get "$result" key)
  stderr_log=$(dirname "$result")/stderr
  printf 'compile-queue: %s execution %s key=%s exit=%s\n' \
    "$(cq_result_get "$result" kind)" "$status" "$key" "${exit_code:-unknown}" >&2
  [ -n "$detail" ] && printf 'compile-queue: %s\n' "$detail" >&2
  if [ -f "$stderr_log" ]; then
    cq_tail "$stderr_log" >&2
  fi
  case $status in
    canceled) exit 130 ;;
    completed) exit 0 ;;
    *) exit 1 ;;
  esac
}

cq_clean_stale_active() {
  keydir=$1
  active="$keydir/active"
  [ -f "$active" ] || return 0
  pid=$(sed -n 's/^pid=//p' "$active" | head -n 1)
  start=$(sed -n 's/^starttime=//p' "$active" | head -n 1)
  if ! cq_alive "$pid" "$start"; then
    rm -f -- "$active"
  fi
}

# ---------------------------------------------------------------------------
# Supervisor
# ---------------------------------------------------------------------------

cq_supervise() {
  attempt=$1
  meta="$attempt/meta"
  kind=$(sed -n 's/^kind=//p' "$meta" | head -n 1)
  cwd=$(sed -n 's/^cwd=//p' "$meta" | head -n 1)
  source_root=$(sed -n 's/^source_root=//p' "$meta" | head -n 1)
  entry=$(sed -n 's/^entry=//p' "$meta" | head -n 1)
  key=$(sed -n 's/^key=//p' "$meta" | head -n 1)
  keydir=$(sed -n 's/^keydir=//p' "$meta" | head -n 1)
  work="$attempt/work"
  stdout_log="$attempt/stdout"
  stderr_log="$attempt/stderr"
  started=$(cq_now_ns)
  artifact_names=$(sed -n 's/^artifact_name=//p' "$meta" | tr '\n' ' ')
  setsid_flag=$(sed -n 's/^setsid=//p' "$meta" | head -n 1)
  child=''
  cq_trace "supervise-start kind=$kind attempt=$attempt"
  trap - TERM INT HUP
  trap 'cq_supervisor_term' TERM INT HUP
  printf 'pid=%s\n' "$$" > "$keydir/active"
  printf 'starttime=%s\n' "$(cq_starttime "$$")" >> "$keydir/active"
  printf 'kind=%s\n' "$kind" >> "$keydir/active"
  printf 'setsid=%s\n' "$setsid_flag" >> "$keydir/active"
  printf 'started_ns=%s\n' "$started" >> "$keydir/active"
  if [ "$kind" = cgen ]; then
    cq_trace 'cgen-lock-wait'
    if ! flock -x 8; then
      cq_write_result "$attempt/result" failed 1 "$kind" "$key" "$started" "$(cq_now_ns)" \
        "$attempt" "$work" "$stdout_log" "$stderr_log" "cannot acquire the C-generation lane"
      rm -f -- "$keydir/active"
      exit 1
    fi
    cq_trace 'cgen-lock-acquired'
    before=$(sed -n 's/^digest=//p' "$attempt/source-digest" | head -n 1)
    after=$(cq_source_digest "$source_root" "$entry" | cq_sha_stdin)
    if [ "$before" != "$after" ]; then
      cq_write_result "$attempt/result" failed 1 "$kind" "$key" "$started" "$(cq_now_ns)" \
        "$attempt" "$work" "$stdout_log" "$stderr_log" "source changed before execution"
      rm -f -- "$keydir/active"
      exit 1
    fi
  fi
  (
    cd "$cwd" || exit 127
    set --
    while IFS= read -r line; do
      set -- "$@" "$line"
    done < "$attempt/command"
    exec "$@"
  ) > "$stdout_log" 2> "$stderr_log" &
  child=$!
  cq_trace "command-start pid=$child"
  wait "$child"
  status=$?
  cq_trace "command-end status=$status"
  child=''
  finished=$(cq_now_ns)
  if [ "$status" -eq 0 ] && [ "$kind" = cgen ]; then
    after=$(cq_source_digest "$source_root" "$entry" | cq_sha_stdin)
    before=$(sed -n 's/^digest=//p' "$attempt/source-digest" | head -n 1)
    if [ "$before" != "$after" ]; then
      cq_write_result "$attempt/result" failed 1 "$kind" "$key" "$started" "$finished" \
        "$attempt" "$work" "$stdout_log" "$stderr_log" "source changed during execution"
      rm -f -- "$keydir/active"
      exit 1
    fi
  fi
  if [ "$status" -ne 0 ]; then
    cq_write_result "$attempt/result" failed "$status" "$kind" "$key" "$started" "$finished" \
      "$attempt" "$work" "$stdout_log" "$stderr_log" "command exited $status"
    rm -f -- "$keydir/active"
    exit 1
  fi
  for name in $artifact_names; do
    if [ ! -e "$work/$name" ]; then
      cq_write_result "$attempt/result" failed 1 "$kind" "$key" "$started" "$finished" \
        "$attempt" "$work" "$stdout_log" "$stderr_log" "artifact $name was not written"
      rm -f -- "$keydir/active"
      exit 1
    fi
  done
  cache="$keydir/completed.tmp.$$"
  rm -rf -- "$cache"
  mkdir -p "$cache/artifacts"
  for name in $artifact_names; do
    if [ -d "$work/$name" ]; then
      cp -a "$work/$name" "$cache/artifacts/$name" || {
        cq_write_result "$attempt/result" failed 1 "$kind" "$key" "$started" "$finished" \
          "$attempt" "$work" "$stdout_log" "$stderr_log" "cannot retain artifact $name"
        rm -rf -- "$cache"
        rm -f -- "$keydir/active"
        exit 1
      }
    else
      cp -p "$work/$name" "$cache/artifacts/$name" || {
        cq_write_result "$attempt/result" failed 1 "$kind" "$key" "$started" "$finished" \
          "$attempt" "$work" "$stdout_log" "$stderr_log" "cannot retain artifact $name"
        rm -rf -- "$cache"
        rm -f -- "$keydir/active"
        exit 1
      }
    fi
  done
  cq_write_result "$cache/result" completed 0 "$kind" "$key" "$started" "$finished" \
    "$attempt" "$work" "$stdout_log" "$stderr_log" ""
  cp -p "$stdout_log" "$cache/stdout"
  cp -p "$stderr_log" "$cache/stderr"
  mv "$cache" "$keydir/completed"
  cq_trace 'completed-published'
  cp -p "$keydir/completed/result" "$attempt/result"
  rm -f -- "$keydir/active"
  exit 0
}

cq_supervisor_term() {
  trap - TERM INT HUP
  if [ -n "${child:-}" ]; then
    kill -TERM "$child" 2>/dev/null
    wait "$child" 2>/dev/null
  fi
  finished=$(cq_now_ns)
  cq_write_result "$attempt/result" canceled 130 "$kind" "$key" "${started:-$finished}" "$finished" \
    "$attempt" "$work" "${stdout_log:-/dev/null}" "${stderr_log:-/dev/null}" "execution canceled"
  rm -f -- "${keydir:-}/active"
  exit 130
}

# ---------------------------------------------------------------------------
# External adoption
# ---------------------------------------------------------------------------

cq_guard() {
  keydir=$1
  pid=$2
  start=$3
  artifact_name=$4
  artifact_path=$5
  kind=cgen
  key=$(basename "$keydir")
  artifact_names=$artifact_name
  started=$(cq_now_ns)
  mkdir -p "$keydir/runs/external-$started"
  stdout_log="$keydir/external.stdout"
  stderr_log="$keydir/external.stderr"
  : > "$stdout_log"
  : > "$stderr_log"
  trap - TERM INT HUP
  trap 'cq_guard_term' TERM INT HUP
  printf 'pid=%s\nstarttime=%s\nkind=%s\nsetsid=external\nstarted_ns=%s\n' \
    "$pid" "$start" "$kind" "$started" > "$keydir/active"
  while cq_alive "$pid" "$start"; do
    sleep 5
  done
  finished=$(cq_now_ns)
  if [ -s "$artifact_path" ]; then
    cache="$keydir/completed.tmp.$$"
    rm -rf -- "$cache"
    mkdir -p "$cache/artifacts"
    cp -p "$artifact_path" "$cache/artifacts/$artifact_name" || {
      cq_write_result "$keydir/runs/external-$started/result" failed 1 "$kind" "$key" "$started" "$finished" \
        "$keydir/runs/external-$started" "" "$stdout_log" "$stderr_log" "cannot retain the external artifact"
      rm -rf -- "$cache"
      rm -f -- "$keydir/active"
      exit 1
    }
    cq_write_result "$cache/result" completed 0 "$kind" "$key" "$started" "$finished" \
      "external" "$cache/artifacts" "$stdout_log" "$stderr_log" "external execution observed"
    printf 'external=1\n' >> "$cache/result"
    mv "$cache" "$keydir/completed"
    rm -f -- "$keydir/active"
    exit 0
  fi
  mkdir -p "$keydir/runs/external-$started"
  cq_write_result "$keydir/runs/external-$started/result" failed 1 "$kind" "$key" "$started" "$finished" \
    "external" "" "$stdout_log" "$stderr_log" "external compiler exited without a complete artifact"
  rm -f -- "$keydir/active"
  exit 1
}

cq_guard_term() {
  trap - TERM INT HUP
  finished=$(cq_now_ns)
  mkdir -p "$keydir/runs/external-$started"
  cq_write_result "$keydir/runs/external-$started/result" canceled 130 "$kind" "$key" "$started" "$finished" \
    "external" "" "$stdout_log" "$stderr_log" "external adoption canceled"
  rm -f -- "$keydir/active"
  exit 130
}

# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------

cq_usage() {
  cat >&2 <<'EOF'
usage: compile-queue.sh run --kind cgen|cc --state-root DIR --cwd DIR [options] -- COMMAND...
       compile-queue.sh key --kind cgen|cc [options]
       compile-queue.sh cancel --state-root DIR --key KEY
       compile-queue.sh wait --state-root DIR --key KEY
       compile-queue.sh status --state-root DIR [--key KEY]
       compile-queue.sh adopt --pid PID --state-root DIR --artifact NAME=PATH [options]
options: --compiler PATH --source-root DIR --entry REL --root DIR
         --input PATH --aux PATH --artifact NAME=PATH --option KEY=VALUE
         --receipt PATH
EOF
  exit 2
}

cq_default_state() {
  if [ -n "${BATON_COMPILE_QUEUE_ROOT:-}" ]; then
    printf '%s\n' "$BATON_COMPILE_QUEUE_ROOT"
  elif [ -n "${XDG_CACHE_HOME:-}" ]; then
    printf '%s/baton/compile-queue\n' "$XDG_CACHE_HOME"
  elif [ -n "${HOME:-}" ]; then
    printf '%s/.cache/baton/compile-queue\n' "$HOME"
  else
    printf '/tmp/baton-compile-queue-%s\n' "$(id -u)"
  fi
}

cq_parse_common() {
  # Sets: cq_kind cq_state_root cq_cwd cq_root cq_source_root cq_entry
  #       cq_compiler cq_receipt cq_tmp cq_command_count
  cq_kind=''
  cq_state_root=$(cq_default_state)
  cq_cwd=$(pwd -P)
  cq_root=''
  cq_source_root=''
  cq_entry=''
  cq_compiler=''
  cq_receipt=''
  cq_tmp=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue.XXXXXX") || cq_die 2 'cannot create queue scratch'
  : > "$cq_tmp/inputs"
  : > "$cq_tmp/aux"
  : > "$cq_tmp/artifacts"
  : > "$cq_tmp/options"
  : > "$cq_tmp/command-args"
  while [ $# -gt 0 ]; do
    case $1 in
      --kind) cq_kind=$2; shift 2 ;;
      --state-root) cq_state_root=$2; shift 2 ;;
      --cwd) cq_cwd=$2; shift 2 ;;
      --root) cq_root=$2; shift 2 ;;
      --source-root) cq_source_root=$2; shift 2 ;;
      --entry) cq_entry=$2; shift 2 ;;
      --compiler) cq_compiler=$2; shift 2 ;;
      --input) printf '%s\n' "$2" >> "$cq_tmp/inputs"; shift 2 ;;
      --aux) printf '%s\n' "$2" >> "$cq_tmp/aux"; shift 2 ;;
      --artifact) printf '%s\n' "$2" >> "$cq_tmp/artifacts"; shift 2 ;;
      --option) printf '%s\n' "$2" >> "$cq_tmp/options"; shift 2 ;;
      --receipt) cq_receipt=$2; shift 2 ;;
      --) shift; break ;;
      *) cq_die 2 "unknown option $1" ;;
    esac
  done
  [ "$cq_kind" = cgen ] || [ "$cq_kind" = cc ] || cq_die 2 'kind must be cgen or cc'
  [ -d "$cq_cwd" ] || cq_die 2 "cwd is unavailable: $cq_cwd"
  case $cq_state_root in /*) ;; *) cq_die 2 'state root must be absolute' ;; esac
  cq_command_count=$#
  while [ "$#" -gt 0 ]; do
    printf '%s\n' "$1" >> "$cq_tmp/command-args"
    shift
  done
  return 0
}

cq_validate_artifacts() {
  [ -s "$cq_tmp/artifacts" ] || cq_die 2 'at least one --artifact NAME=PATH is required'
  : > "$cq_tmp/artifact-map"
  while IFS= read -r spec; do
    [ -n "$spec" ] || continue
    case $spec in
      *=*) ;;
      *) cq_die 2 "artifact must be NAME=PATH: $spec" ;;
    esac
    name=${spec%%=*}
    destination=${spec#*=}
    case $name in
      *[!A-Za-z0-9_.-]*|'') cq_die 2 "invalid artifact name: $name" ;;
    esac
    printf '%s\t%s\n' "$name" "$destination" >> "$cq_tmp/artifact-map"
  done < "$cq_tmp/artifacts"
}

cq_prepare_inputs() {
  # Copy --input files and build the source->copy map.
  : > "$cq_tmp/input-map"
  while IFS= read -r source; do
    [ -n "$source" ] || continue
    [ -f "$source" ] || cq_die 2 "input is unavailable: $source"
    base=$(basename "$source")
    destination="inputs/$base"
    if grep -q "	$destination	" "$cq_tmp/input-map" 2>/dev/null; then
      cq_die 2 "two inputs share the basename $base"
    fi
    printf '%s\t%s\t%s\t%s\n' "$source" "$destination" "$(cq_sha "$source")" "$(cq_size "$source")" >> "$cq_tmp/input-map"
  done < "$cq_tmp/inputs"
}

cq_compute_key() {
  cq_material "$cq_kind" "$cq_cwd" "$cq_root" "$cq_source_root" "$cq_entry" \
    "$cq_compiler" "$cq_tmp/input-map" "$cq_tmp/artifact-map" "$cq_tmp/options" \
    "$cq_tmp/command-args" | cq_sha_stdin
}

cq_ensure_flock() {
  command -v flock >/dev/null 2>&1 || return 1
  return 0
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
cq_validate_source() {
  [ "$cq_kind" = cgen ] || return 0
  [ -n "$cq_source_root" ] || cq_die 2 'cgen requires --source-root'
  [ -n "$cq_entry" ] || cq_die 2 'cgen requires --entry'
  case $cq_entry in
    /*) entry_file=$cq_entry ;;
    *) entry_file="$cq_source_root/$cq_entry" ;;
  esac
  [ -f "$entry_file" ] || cq_die 2 "entry is unavailable: $cq_entry"
  [ -d "$cq_source_root/bend2/src" ] || cq_die 2 "source root has no bend2/src: $cq_source_root"
}

cq_cmd_key() {
  cq_parse_common "$@"
  trap 'rm -rf -- "$cq_tmp"' EXIT
  cq_validate_artifacts
  cq_prepare_inputs
  cq_validate_source
  key=$(cq_compute_key)
  printf '%s\n' "$key"
}

cq_cmd_run() {
  cq_parse_common "$@"
  trap 'rm -rf -- "$cq_tmp"' EXIT
  [ "$cq_command_count" -gt 0 ] || cq_die 2 'a command is required after --'
  cq_validate_artifacts
  cq_prepare_inputs
  cq_validate_source
  cq_ensure_flock || cq_die 2 'queue coordination requires flock'
  key=$(cq_compute_key)
  keydir="$cq_state_root/keys/$key"
  mkdir -p "$keydir/runs"
  exec 9>"$keydir/lock"
  wait_start=$(cq_now_ns)
  saw_active=0
  [ -f "$keydir/active" ] && saw_active=1
  flock -x 9 || cq_die 1 'cannot acquire the key lock'
  cq_clean_stale_active "$keydir"
  if cq_verify_completed "$keydir"; then
    cq_copy_artifacts "$keydir" "$cq_tmp/artifact-map"
    cq_receipt_write completed 1
    exit 0
  fi
  latest=$(ls -1t "$keydir"/runs/*/result 2>/dev/null | head -n 1 || true)
  if [ -n "$latest" ]; then
    latest_status=$(cq_result_get "$latest" status)
    latest_finished=$(cq_result_get "$latest" finished_ns)
    case ${latest_finished:-0} in *[!0-9]*|'') latest_finished=0 ;; esac
    if [ "$latest_status" != completed ] &&
       { [ "$saw_active" = 1 ] || [ "$latest_finished" -ge "$wait_start" ]; }; then
      exec 9>&-
      cq_report_attempt_failure "$latest"
    fi
  fi
  attempt="$keydir/runs/$(cq_now_ns)-$$"
  mkdir -p "$attempt/work"
  started=$(cq_now_ns)
  while IFS='	' read -r source destination digest size; do
    [ -n "${source:-}" ] || continue
    mkdir -p "$(dirname "$attempt/work/$destination")"
    cp -p "$source" "$attempt/work/$destination" || cq_die 1 "cannot stage input $source"
    [ "$(cq_sha "$attempt/work/$destination")" = "$digest" ] ||
      cq_die 1 "input changed before execution: $source"
  done < "$cq_tmp/input-map"
  : > "$attempt/command"
  while IFS= read -r token; do
    value=$token
    while IFS='	' read -r name destination; do
      [ -n "${name:-}" ] || continue
      [ "$value" = "$destination" ] && value="$attempt/work/$name"
    done < "$cq_tmp/artifact-map"
    while IFS='	' read -r source destination digest size; do
      [ -n "${source:-}" ] || continue
      [ "$value" = "$source" ] && value="$attempt/work/$destination"
    done < "$cq_tmp/input-map"
    printf '%s\n' "$value" >> "$attempt/command"
  done < "$cq_tmp/command-args"
  {
    printf 'kind=%s\n' "$cq_kind"
    printf 'cwd=%s\n' "$cq_cwd"
    printf 'source_root=%s\n' "$cq_source_root"
    printf 'entry=%s\n' "$cq_entry"
    printf 'key=%s\n' "$key"
    printf 'keydir=%s\n' "$keydir"
    printf 'attempt=%s\n' "$attempt"
    printf 'tail=%s\n' "${CQ_TAIL_BYTES:-$CQ_DEFAULT_TAIL}"
    if command -v setsid >/dev/null 2>&1; then
      printf 'setsid=1\n'
    else
      printf 'setsid=0\n'
    fi
    while IFS='	' read -r name destination; do
      [ -n "${name:-}" ] || continue
      printf 'artifact_name=%s\n' "$name"
    done < "$cq_tmp/artifact-map"
  } > "$attempt/meta"
  if [ "$cq_kind" = cgen ]; then
    cq_source_digest "$cq_source_root" "$cq_entry" | cq_sha_stdin |
      sed 's/^/digest=/' > "$attempt/source-digest"
  fi
  exec 8>"$cq_state_root/cgen.lock"
  if command -v setsid >/dev/null 2>&1; then
    setsid sh "$0" __supervise "$attempt" 8>&8 9>&9 </dev/null >/dev/null 2>&1 &
  else
    sh "$0" __supervise "$attempt" 8>&8 9>&9 </dev/null >/dev/null 2>&1 &
  fi
  supervisor=$!
  started=$(cq_now_ns)
  exec 9>&-
  exec 8>&-
  cq_trace "requester-wait supervisor=$supervisor"
  wait "$supervisor"
  cq_trace 'requester-wait-done'
  if cq_verify_completed "$keydir"; then
    cq_copy_artifacts "$keydir" "$cq_tmp/artifact-map"
    cq_receipt_write completed 0
    exit 0
  fi
  if [ -f "$attempt/result" ]; then
    cq_report_attempt_failure "$attempt/result"
  fi
  printf 'compile-queue: execution ended without a result\n' >&2
  cq_tail "$attempt/stderr" >&2
  exit 1
}

cq_receipt_write() {
  status=$1
  reused=$2
  [ -n "$cq_receipt" ] || return 0
  {
    printf 'status=%s\n' "$status"
    printf 'key=%s\n' "${key:-}"
    printf 'reused=%s\n' "$reused"
    while IFS='	' read -r name destination; do
      [ -n "${name:-}" ] || continue
      printf 'artifact-%s=%s\n' "$name" "$destination"
    done < "$cq_tmp/artifact-map"
  } > "$cq_receipt"
}

cq_cmd_wait() {
  state_root=''
  key=''
  while [ $# -gt 0 ]; do
    case $1 in
      --state-root) state_root=$2; shift 2 ;;
      --key) key=$2; shift 2 ;;
      *) cq_die 2 "unknown option $1" ;;
    esac
  done
  [ -n "$state_root" ] && [ -n "$key" ] || cq_usage
  keydir="$state_root/keys/$key"
  [ -d "$keydir" ] || cq_die 2 "unknown key $key"
  exec 9>"$keydir/lock"
  flock -x 9 || cq_die 1 'cannot acquire the key lock'
  cq_clean_stale_active "$keydir"
  if cq_verify_completed "$keydir"; then
    printf 'status=completed\nkey=%s\n' "$key"
    exit 0
  fi
  latest=$(ls -1t "$keydir"/runs/*/result 2>/dev/null | head -n 1 || true)
  if [ -n "$latest" ]; then
    cq_report_attempt_failure "$latest"
  fi
  printf 'compile-queue: no result for key %s\n' "$key" >&2
  exit 4
}

cq_cmd_cancel() {
  state_root=''
  key=''
  while [ $# -gt 0 ]; do
    case $1 in
      --state-root) state_root=$2; shift 2 ;;
      --key) key=$2; shift 2 ;;
      *) cq_die 2 "unknown option $1" ;;
    esac
  done
  [ -n "$state_root" ] && [ -n "$key" ] || cq_usage
  active="$state_root/keys/$key/active"
  if [ ! -f "$active" ]; then
    printf 'canceled=none\nkey=%s\n' "$key"
    exit 0
  fi
  pid=$(sed -n 's/^pid=//p' "$active" | head -n 1)
  start=$(sed -n 's/^starttime=//p' "$active" | head -n 1)
  mode=$(sed -n 's/^setsid=//p' "$active" | head -n 1)
  if [ "$mode" = external ] || [ "$mode" = starting ]; then
    printf 'canceled=refused\nkey=%s\nreason=external-or-starting\n' "$key"
    exit 0
  fi
  cq_alive "$pid" "$start" || {
    printf 'canceled=stale\nkey=%s\n' "$key"
    exit 0
  }
  if [ "$mode" = 1 ]; then
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  else
    kill -TERM "$pid" 2>/dev/null
  fi
  elapsed=0
  while cq_alive "$pid" "$start" && [ "$elapsed" -lt 30 ]; do
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  if cq_alive "$pid" "$start"; then
    if [ "$mode" = 1 ]; then
      kill -KILL "-$pid" 2>/dev/null || true
    else
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  printf 'canceled=requested\nkey=%s\npid=%s\n' "$key" "$pid"
}

cq_cmd_status() {
  state_root=''
  filter=''
  while [ $# -gt 0 ]; do
    case $1 in
      --state-root) state_root=$2; shift 2 ;;
      --key) filter=$2; shift 2 ;;
      *) cq_die 2 "unknown option $1" ;;
    esac
  done
  [ -n "$state_root" ] || cq_usage
  printf 'state_root=%s\n' "$state_root"
  for keydir in "$state_root"/keys/*; do
    [ -d "$keydir" ] || continue
    key=$(basename "$keydir")
    [ -n "$filter" ] && [ "$key" != "$filter" ] && continue
    active="$keydir/active"
    if [ -f "$active" ]; then
      printf 'active key=%s pid=%s kind=%s setsid=%s started_ns=%s\n' "$key" \
        "$(sed -n 's/^pid=//p' "$active" | head -n 1)" \
        "$(sed -n 's/^kind=//p' "$active" | head -n 1)" \
        "$(sed -n 's/^setsid=//p' "$active" | head -n 1)" \
        "$(sed -n 's/^started_ns=//p' "$active" | head -n 1)"
    fi
    if cq_verify_completed "$keydir"; then
      printf 'completed key=%s\n' "$key"
    fi
  done
}

cq_cmd_adopt() {
  pid=''
  state_root=$(cq_default_state)
  source_root=''
  entry=''
  compiler=''
  artifact_spec=''
  cq_tmp=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue-adopt.XXXXXX") || cq_die 2 'cannot create scratch'
  trap 'rm -rf -- "$cq_tmp"' EXIT
  : > "$cq_tmp/inputs"
  : > "$cq_tmp/aux"
  : > "$cq_tmp/artifacts"
  : > "$cq_tmp/options"
  while [ $# -gt 0 ]; do
    case $1 in
      --pid) pid=$2; shift 2 ;;
      --state-root) state_root=$2; shift 2 ;;
      --source-root) source_root=$2; shift 2 ;;
      --entry) entry=$2; shift 2 ;;
      --compiler) compiler=$2; shift 2 ;;
      --artifact) artifact_spec=$2; shift 2 ;;
      --option) printf '%s\n' "$2" >> "$cq_tmp/options"; shift 2 ;;
      *) cq_die 2 "unknown option $1" ;;
    esac
  done
  [ -n "$pid" ] || cq_usage
  start=$(cq_starttime "$pid") || cq_die 2 "pid $pid is not alive"
  [ -n "$source_root" ] || source_root=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  [ -n "$source_root" ] || cq_die 2 'cannot read the compiler cwd'
  if [ -z "$entry" ]; then
    entry=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null |
      awk 'seen { print; exit } /\/bend2\/main\.ts$/ { seen=1 }')
  fi
  [ -n "$entry" ] || cq_die 2 'cannot read the compiler entry'
  if [ -z "$compiler" ]; then
    compiler=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^BEND=//p' | head -n 1)
  fi
  if [ -z "$compiler" ]; then
    compiler=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | head -n 1)
  fi
  [ -n "$artifact_spec" ] || cq_die 2 'an --artifact NAME=PATH is required for adoption'
  case $artifact_spec in
    *=*) ;;
    *) cq_die 2 'artifact must be NAME=PATH' ;;
  esac
  artifact_name=${artifact_spec%%=*}
  artifact_path=${artifact_spec#*=}
  case $artifact_path in /*) ;; *) cq_die 2 'adopted artifact path must be absolute' ;; esac
  [ -e "$artifact_path" ] && cq_die 2 "the adopted artifact already exists: $artifact_path"
  cq_kind=cgen
  cq_cwd=$source_root
  cq_root=$source_root
  cq_source_root=$source_root
  cq_entry=$entry
  cq_compiler=$compiler
  cq_receipt=''
  : > "$cq_tmp/artifact-map"
  printf '%s\t%s\n' "$artifact_name" "$artifact_path" > "$cq_tmp/artifact-map"
  printf '%s\n%s\n%s\n%s\n' "$compiler" "$entry" "-o" "$artifact_path" > "$cq_tmp/command-args"
  cq_prepare_inputs
  key=$(cq_material cgen "$cq_cwd" "$cq_root" "$cq_source_root" "$cq_entry" "$cq_compiler" \
    "$cq_tmp/input-map" "$cq_tmp/artifact-map" "$cq_tmp/options" "$cq_tmp/command-args" |
    cq_sha_stdin)
  keydir="$state_root/keys/$key"
  mkdir -p "$keydir/runs"
  exec 8>"$state_root/cgen.lock"
  exec 9>"$keydir/lock"
  flock -x 9 || cq_die 1 'cannot acquire the key lock'
  if cq_verify_completed "$keydir"; then
    printf 'adopted=0\nkey=%s\nreason=completed-result-exists\n' "$key"
    exit 0
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid sh "$0" __guard "$keydir" "$pid" "$start" "$artifact_name" "$artifact_path" \
      8>&8 9>&9 </dev/null >/dev/null 2>&1 &
  else
    sh "$0" __guard "$keydir" "$pid" "$start" "$artifact_name" "$artifact_path" \
      8>&8 9>&9 </dev/null >/dev/null 2>&1 &
  fi
  guard=$!
  exec 8>&-
  exec 9>&-
  printf 'adopted=1\nkey=%s\npid=%s\nguard=%s\nartifact=%s\n' \
    "$key" "$pid" "$guard" "$artifact_path"
}

main() {
  command=${1:-}
  [ -n "$command" ] || cq_usage
  shift
  case $command in
    run) cq_cmd_run "$@" ;;
    key) cq_cmd_key "$@" ;;
    wait) cq_cmd_wait "$@" ;;
    cancel) cq_cmd_cancel "$@" ;;
    status) cq_cmd_status "$@" ;;
    adopt) cq_cmd_adopt "$@" ;;
    __supervise) cq_supervise "$@" ;;
    __guard) cq_guard "$@" ;;
    *) cq_usage ;;
  esac
}

main "$@"
