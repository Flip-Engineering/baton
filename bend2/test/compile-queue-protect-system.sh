#!/bin/sh
# Run with a disposable queue root bind-mounted at /var/tmp/baton2-compile-queue
# and ProtectSystem=strict. This covers the deployed service mount layout.
set -eu

if [ -z "${BATON2_COMPILE_QUEUE_BIN:-}" ] || [ ! -x "$BATON2_COMPILE_QUEUE_BIN" ]; then
  printf 'Set BATON2_COMPILE_QUEUE_BIN to the candidate queue executable\n' >&2
  exit 2
fi
case "${BATON_COMPILE_QUEUE_ROOT:-}" in
  /var/tmp/baton2-compile-queue) ;;
  *) printf 'Set BATON_COMPILE_QUEUE_ROOT to the disposable bound queue root\n' >&2; exit 2 ;;
esac
[ -d "$BATON_COMPILE_QUEUE_ROOT" ] && [ -w "$BATON_COMPILE_QUEUE_ROOT" ] || {
  printf 'The disposable queue root must exist and be writable\n' >&2
  exit 2
}
for part in admission/running admission/waiting admission/usage peaks keys; do
  [ -d "$BATON_COMPILE_QUEUE_ROOT/$part" ] || {
    printf 'Preinitialize the disposable queue directory: %s\n' "$part" >&2
    exit 2
  }
done
python3 - <<'PY_CHECK'
import os
if not os.statvfs('/var').f_flag & getattr(os, 'ST_RDONLY', 1):
    raise SystemExit('/var is not read-only; run this test with ProtectSystem=strict')
PY_CHECK

T=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue-protect-system.XXXXXX")
trap 'rm -rf -- "$T"' EXIT HUP INT TERM
printf 'int main(void){return 0;}\n' > "$T/input.c"
printf 'read-only ancestor probe\n' > "$T/source"

# The test state root is writable through the bind mount. Its /var ancestor
# remains read-only in this service context.
BATON2_COMPILE_QUEUE_BIN="$BATON2_COMPILE_QUEUE_BIN" \
BATON_COMPILE_QUEUE_ROOT="$BATON_COMPILE_QUEUE_ROOT" \
"$BATON2_COMPILE_QUEUE_BIN" run --kind cc --state-root "$BATON_COMPILE_QUEUE_ROOT" \
  --cwd "$T" --source-root "$T" --linker /usr/bin/ld \
  --version protect-system-prefix \
  --artifact result="$T/result" --option test=protect-system-prefix \
  --token "protect-system-prefix-$$" \
  -- -- /bin/sh -c 'cat "$1" > "$2"' sh "$T/source" "$T/result" \
  > "$T/stdout" 2> "$T/stderr" || {
    cat "$T/stderr" >&2
    exit 1
  }
cmp -s "$T/source" "$T/result"
printf 'PASS existing read-only /var ancestor with writable bind-mounted queue root\n'
