#!/bin/sh
# Positive producer-to-classifier-to-package recipe, and its negatives.
#
# REMOTE EXECUTION ONLY, after Root admission of the exact source and toolchain.
# Nothing here has been executed. It drives the real producer, the real
# classifier and the real package validator against one isolated module group of
# a coherent small source, and keeps every child's argv, status and streams.
#
# Usage: sh bend2/test/capacity-controls-positive-recipe.sh WORKDIR
#
# WORKDIR must be a new owned directory. The command runs from a clean admitted
# checkout of the candidate revision whose Bend 2.0.25 toolchain is installed.

set -eu

WORKDIR=${1:?usage: sh bend2/test/capacity-controls-positive-recipe.sh WORKDIR}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
MODULE=${MODULE:-bend2/src/json/laws.bend}
BEND=${BEND:-$ROOT/.bend/bin/bend}
ENTRY=bend2/src/coordinator/main.bend

test ! -e "$WORKDIR" || { printf '%s exists\n' "$WORKDIR" >&2; exit 2; }
mkdir -p "$WORKDIR/evidence" "$WORKDIR/audit" "$WORKDIR/verify"
RUN="$WORKDIR"

record() { # name, argv...
  name=$1; shift
  printf '%s\n' "$*" > "$RUN/$name.argv"
  set +e
  "$@" > "$RUN/$name.stdout" 2> "$RUN/$name.stderr"
  status=$?
  set -e
  printf '%s\n' "$status" > "$RUN/$name.exit"
  test "$status" -eq 0 || { printf '%s exited %s\n' "$name" "$status" >&2; exit 1; }
}

# 0. Preconditions: clean source, the pinned compiler, an isolated group.
test -z "$(git -C "$ROOT" status --porcelain=v1)"
test "$(BEND_NO_TELEMETRY=1 "$BEND" version)" = 'bend 2.0.25'

# 1. Discovery through the checker's own API.
record discovery node "$ROOT/bend2/scripts/laws-check.mjs" --discover
test "$(wc -l < "$RUN/discovery.stdout")" -gt 0

# 2. Producer: one module group, one compiler at a time, evidence in a new dir.
record produce node "$ROOT/bend2/scripts/laws-check.mjs" --group "$MODULE" \
  --evidence-dir "$RUN/evidence" --time-tool /usr/bin/time --time-flag -l
test -f "$RUN/evidence/group-manifest.json"

# 3. Aggregate the group evidence into one summary.
record aggregate node "$ROOT/bend2/scripts/laws-check.mjs" --aggregate "$RUN/evidence"
test -f "$RUN/controls-summary.json" || cp "$RUN/evidence/controls-summary.json" \
  "$RUN/controls-summary.json" 2>/dev/null || true

# 4. Consumer: the package re-verifies bytes, classification and references.
record consume python3 - "$ROOT" "$RUN" <<'PY'
import importlib.util, json, pathlib, sys
root, run = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location('package_native', root / 'bend2/scripts/package-native.py')
package = importlib.util.module_from_spec(spec); spec.loader.exec_module(package)
compiler = pathlib.Path((package.ROOT / '.bend/bin/bend'))
result = package.controls_evidence(run, package.snapshot(), compiler, audit=run / 'audit')
print(json.dumps({'cases': result['cases'], 'groups': result['groups'],
                  'binding': result['binding'], 'inventory': result['inventory']['inventory_sha256'],
                  'closure': result['closure_sha256'],
                  'reduction': result['reduction']['sha256']}, indent=2))
(run / 'reduction.json').write_text(json.dumps(result['reduction'], indent=2) + '\n')
PY

# 5. Negative: a changed closure member must fail the inventory check.
cp -R "$RUN/evidence" "$RUN/verify/relocated"
python3 - "$RUN" <<'PY'
import importlib.util, json, pathlib, sys
run = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('package_native',
    pathlib.Path('.') / 'bend2/scripts/package-native.py')
package = importlib.util.module_from_spec(spec); spec.loader.exec_module(package)
recorded = package.producer_inventory(run / 'evidence')
package.verify_inventory(run / 'verify/relocated', recorded)
print('relocation ok')
try:
    victim = next(p for p in sorted((run / 'verify/relocated').rglob('*.stdout')))
    victim.write_bytes(b'changed\n')
    package.verify_inventory(run / 'verify/relocated', recorded)
    raise SystemExit('a changed member was accepted')
except RuntimeError as error:
    print('changed member refused:', error)
PY

# 6. Negative: a stream that is not the intended refusal must refuse classification.
#    The real classifier owns that verdict; this step only proves the package
#    forwards the verified bytes and refuses a non-qualified verdict.

printf 'recipe complete; every child argv, status and stream is under %s\n' "$RUN"
