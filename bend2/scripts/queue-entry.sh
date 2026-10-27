# Shared compilation-queue selection for the native build and check entry
# points. Source this file after `root` and `compiler` are set.
#
# An explicit BATON2_NATIVE_QUEUE_DRIVER always wins. A caller that already
# supplies BATON2_NATIVE_QUEUE owns that route too: the CI target comparison
# supplies its own queue wrappers with the driver deliberately empty, and
# synthesizing another driver around those wrappers would recurse through the
# adapter. Otherwise an installed adapter, client and shared state root
# synthesize the queue configuration and route every compilation through it.
# A host without an installed queue is refused with the one-time bootstrap
# command, so an ordinary build cannot compile outside the queue.
if [ -n "${BATON2_NATIVE_QUEUE_DRIVER:-}" ] || [ -n "${BATON2_NATIVE_QUEUE:-}" ]; then
  return 0
fi
queue_adapter="$root/.github/scripts/queue-native-checks.py"
queue_state=${BATON_COMPILE_QUEUE_ROOT:-/var/tmp/baton2-compile-queue}
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
queue_run="$root/.scratch/bend2/queue-run"
mkdir -p "$queue_run"
if ! "${PYTHON3:-python3}" - "$queue_run" "$compiler" "${CC:-clang}" "$queue_client" "$queue_state" <<'PY'
import json, pathlib, shutil, sys
run, bend, cc, client, state = sys.argv[1:6]
config = {"run": str(pathlib.Path(run).resolve()),
          "bend": str(pathlib.Path(bend).resolve()),
          "cc": shutil.which(cc) or cc,
          "client": client, "state": state}
pathlib.Path(run, "queue-config.json").write_text(json.dumps(config, indent=2) + "\n")
PY
then
  printf 'queue-entry: could not write the queue configuration under %s\n' "$queue_run" >&2
  exit 2
fi
BATON2_NATIVE_QUEUE="$queue_run/queue-config.json"
BATON2_NATIVE_QUEUE_DRIVER="$queue_adapter"
export BATON2_NATIVE_QUEUE BATON2_NATIVE_QUEUE_DRIVER
