#!/bin/sh
# Remote qualification driver for issue #686 candidate 5c12fe65.
# Records exact source, toolchain, full output and completed-process evidence.
R=/home/atari2036/issue686-validation
SRC=$R/src
cd "$SRC" || exit 1
set -u
echo "=== run start $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "=== platform ==="
uname -srm
python3 --version
clang-19 --version | head -1
echo "=== candidate source identity ==="
sha256sum bend2/src/coordinator/logs.bend bend2/src/coordinator/turn.bend \
  bend2/src/host/files.c bend2/src/host/files.bend bend2/test/logs.py bend2/test/turn.py
echo "=== executable identity ==="
sha256sum .scratch/bend2/baton2

for t in logs turn; do
  echo "=== bend2/test/$t.py start $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  start=$(date +%s)
  python3 "bend2/test/$t.py" -v > "$R/test-$t.log" 2>&1
  rc=$?
  echo "$t exit=$rc elapsed=$(( $(date +%s) - start ))s"
  tail -6 "$R/test-$t.log"
done

echo "=== independent acceptance start $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
rm -rf "$R/acceptance-root"
/usr/bin/time -v python3 "$R/issue686_acceptance.py" --exe .scratch/bend2/baton2 \
  --keep --root "$R/acceptance-root" > "$R/acceptance.log" 2> "$R/acceptance.time"
rc=$?
echo "acceptance exit=$rc"
cat "$R/acceptance.log"
echo "=== resource use ==="
grep -E 'Elapsed \(wall|Maximum resident' "$R/acceptance.time"
echo "=== run end $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
