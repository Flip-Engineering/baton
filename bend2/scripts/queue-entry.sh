# Shared compilation-queue selection for the native build and check entry
# points. Source this file after `root` and `compiler` are set.
#
# An explicit BATON2_NATIVE_QUEUE_DRIVER wins: when it is non-empty the
# helper returns before the supplied queue is validated. A non-empty
# BATON2_NATIVE_QUEUE must name a readable regular file holding a queue
# configuration with non-empty run, bend, cc, client and state strings. That
# file is used unchanged; a directory, device, unreadable file, invalid JSON
# or missing key is refused with exit 2. Otherwise an installed adapter,
# client and shared state root synthesize the queue configuration and route
# every compilation through it. A host without an installed queue is refused
# with the one-time bootstrap command.
if [ -n "${BATON2_NATIVE_QUEUE_DRIVER:-}" ]; then
  return 0
fi
if [ -n "${BATON2_NATIVE_QUEUE:-}" ]; then
  if ! "${PYTHON3:-python3}" - "$BATON2_NATIVE_QUEUE" <<'PY'
import json, os, sys
path = sys.argv[1]
if not os.path.isfile(path):
    raise SystemExit(1)
try:
    with open(path, encoding='utf-8') as stream:
        config = json.load(stream)
except (OSError, ValueError):
    raise SystemExit(1)
if not isinstance(config, dict):
    raise SystemExit(1)
for key in ('run', 'bend', 'cc', 'client', 'state'):
    value = config.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit(1)
PY
  then
    printf '%s\n' \
      "queue-entry: BATON2_NATIVE_QUEUE must name a readable regular file with a queue configuration containing non-empty run, bend, cc, client and state strings: $BATON2_NATIVE_QUEUE" \
      "Correct the path, unset it, or set BATON2_NATIVE_QUEUE_DRIVER explicitly to use a different route." >&2
    exit 2
  fi
  return 0
fi
queue_adapter="$root/.github/scripts/queue-native-checks.py"
queue_state=${BATON_COMPILE_QUEUE_ROOT:-/var/tmp/baton2-compile-queue}
case "$queue_state" in
  /*) ;;
  *)
    printf 'queue-entry: BATON_COMPILE_QUEUE_ROOT must be an absolute path: %s\n' "$queue_state" >&2
    exit 2
    ;;
esac
queue_client=${BATON2_COMPILE_QUEUE_BIN:-}
if [ -z "$queue_client" ] && [ -x "$queue_state/compile-queue-runner" ]; then
  queue_client="$queue_state/compile-queue-runner"
fi
if [ -z "$queue_client" ] && [ -n "${BATON2_PREFIX:-}" ] && [ -x "$BATON2_PREFIX/bin/baton-compile-queue" ]; then
  queue_client="$BATON2_PREFIX/bin/baton-compile-queue"
fi
if [ ! -f "$queue_adapter" ] || [ -z "$queue_client" ] || [ ! -x "$queue_client" ] || [ ! -d "$queue_state" ]; then
  printf '%s\n' \
    "queue-entry: the shared compilation queue is not installed at $queue_state." \
    "Install it once per host:" \
    "  install -d -m 2775 $queue_state" \
    "  BATON_COMPILE_QUEUE_ROOT=$queue_state sh $root/bend2/scripts/bootstrap-compile-queue.sh $queue_state/compile-queue-runner" \
    "Then rerun this command. An explicit BATON2_NATIVE_QUEUE or BATON2_NATIVE_QUEUE_DRIVER overrides this selection." >&2
  exit 2
fi
# Each invocation owns an immutable configuration. Concurrent builds in one
# checkout must not change each other's compiler, client or state path while
# their queue request still refers to it. The invocation directory is kept
# with its request evidence; prune old invocation.* directories under this
# root when their queue results are no longer needed.
queue_root=${BATON2_QUEUE_RUN_ROOT:-"$root/.scratch/bend2/queue-run"}
case "$queue_root" in
  /*) ;;
  *) queue_root="$root/$queue_root" ;;
esac
if ! mkdir -p "$queue_root"; then
  printf 'queue-entry: could not create the queue run root %s\n' "$queue_root" >&2
  exit 2
fi
if ! queue_run=$(mktemp -d "$queue_root/invocation.XXXXXXXX"); then
  printf 'queue-entry: could not create an owned queue run directory under %s\n' "$queue_root" >&2
  exit 2
fi
queue_priority=${BATON2_COMPILE_QUEUE_PRIORITY:-0}
case "$queue_priority" in
  *[!0-9]*)
    printf 'queue-entry: BATON2_COMPILE_QUEUE_PRIORITY must be a non-negative integer: %s\n' \
      "$queue_priority" >&2
    exit 2
    ;;
esac
if ! "${PYTHON3:-python3}" - "$queue_run" "$compiler" "${CC:-clang}" "$queue_client" "$queue_state" "$queue_priority" <<'PY'
import json, pathlib, shutil, sys
run, bend, cc, client, state, priority = sys.argv[1:7]
config = {"run": str(pathlib.Path(run).resolve()),
          "bend": str(pathlib.Path(bend).resolve()),
          "cc": shutil.which(cc) or cc,
          "client": client, "state": state, "priority": priority}
pathlib.Path(run, "queue-config.json").write_text(json.dumps(config, indent=2) + "\n")
PY
then
  printf 'queue-entry: could not write the queue configuration under %s\n' "$queue_run" >&2
  exit 2
fi
BATON2_NATIVE_QUEUE="$queue_run/queue-config.json"
BATON2_NATIVE_QUEUE_DRIVER="$queue_adapter"
export BATON2_NATIVE_QUEUE BATON2_NATIVE_QUEUE_DRIVER
