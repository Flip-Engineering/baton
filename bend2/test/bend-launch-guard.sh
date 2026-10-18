#!/bin/sh
# Focused fixture for bend2/scripts/bend-launch-guard.sh.
# The compiler is a stub. Focused and Main C generation must both refuse when
# no bounded cgroup is supplied. Cgroup-dependent cases run only when a host
# bounded cgroup is readable; no Main generation or real compiler runs.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
guard="$here/../scripts/bend-launch-guard.sh"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT HUP INT TERM

mkdir -p "$temp/bin" "$temp/bend2"
cp "$guard" "$temp/bin/bend"
chmod 0755 "$temp/bin/bend"
cat > "$temp/bin/bun" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$BUN_STUB_LOG"
for arg in "$@"; do
  if [ "$arg" = version ]; then printf 'bend 2.0.25\n'; fi
done
exit 0
STUB
chmod 0755 "$temp/bin/bun"
printf '// stub compiler entry\n' > "$temp/bend2/main.ts"
export BUN_STUB_LOG="$temp/calls.log"

probe=
for candidate in /sys/fs/cgroup/*; do
  [ -r "$candidate/memory.max" ] || continue
  maximum=$(cat "$candidate/memory.max" 2>/dev/null || true)
  case "$maximum" in
    ''|max|*[!0-9]*) continue ;;
  esac
  if [ "$maximum" -gt 0 ]; then
    probe=$candidate
    break
  fi
done
if [ -n "$probe" ]; then
  echo "bounded_probe=$probe memory.max=$(cat "$probe/memory.max")"
else
  echo "bounded_probe=none; cgroup-dependent cases skipped"
fi

calls() { if [ -f "$BUN_STUB_LOG" ]; then wc -l < "$BUN_STUB_LOG"; else echo 0; fi; }

"$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/refused.out" 2>"$temp/refused.err" && status=0 || status=$?
[ "$status" = 78 ] || { echo "FAIL unadmitted status=$status"; cat "$temp/refused.err"; exit 1; }
grep -q 'build-admission-required' "$temp/refused.err" || { echo "FAIL refusal body"; exit 1; }
[ "$(calls)" = 0 ] || { echo "FAIL stub ran on refusal"; exit 1; }
echo "PASS unadmitted_full_refused=78 stub_calls=0"

BATON2_ADMISSION_OPT_OUT=1 "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/opt.out" 2>"$temp/opt.err" && status=0 || status=$?
[ "$status" = 78 ] || { echo "FAIL opt-out accepted status=$status"; exit 1; }
[ "$(calls)" = 0 ] || { echo "FAIL opt-out reached stub"; exit 1; }
echo "PASS unknown_opt_out_ignored"

unbounded=/sys/fs/cgroup/system.slice/baton2-native-homelab.service
if [ -n "$probe" ] && [ -r "$unbounded/memory.max" ] && [ "$(cat "$unbounded/memory.max")" = max ]; then
  cat > "$temp/unbounded.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "bend2/src/coordinator/main.bend", "output": "out.c"}
RECEIPT
  status=0
  BATON2_ADMISSION_CGROUP="$unbounded" BATON2_ADMISSION_RECEIPT="$temp/unbounded.json" \
    "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/unbounded.out" 2>"$temp/unbounded.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL unbounded accepted status=$status"; exit 1; }
  grep -q 'unbounded-cgroup' "$temp/unbounded.err" || { echo "FAIL unbounded cause"; exit 1; }
  [ "$(calls)" = 0 ] || { echo "FAIL unbounded reached stub"; exit 1; }
  echo "PASS unbounded_cgroup_refused"

status=0
"$temp/bin/bend" bend2/src/coordinator/./main.bend -o out.c >"$temp/alias.out" 2>"$temp/alias.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL canonical alias status=$status"; cat "$temp/alias.err"; exit 1; }
echo "PASS canonical_entry_alias_refused"
fi

status=0; "$temp/bin/bend" bend2/test/tiny.bend -o out.c >"$temp/focused.out" 2>"$temp/focused.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL focused accepted status=$status"; cat "$temp/focused.err"; exit 1; }
grep -q 'missing-cgroup' "$temp/focused.err" || { echo "FAIL focused refusal cause"; exit 1; }
[ "$(calls)" = 0 ] || { echo "FAIL focused stub_calls=$(calls)"; exit 1; }
echo "PASS focused_entry_refused_without_cgroup"

status=0; "$temp/bin/bend" --check-only bend2/src/coordinator/main.bend >"$temp/check.out" 2>"$temp/check.err" || status=$?
[ "${status:-0}" = 0 ] || { echo "FAIL check-only status=$status"; cat "$temp/check.err"; exit 1; }
[ "$(calls)" = 1 ] || { echo "FAIL check-only stub_calls=$(calls)"; exit 1; }
echo "PASS check_only_allowed"

status=0; BATON2_ADMISSION_CGROUP="$temp/not-a-cgroup" "$temp/bin/bend" bend2/test/tiny.bend -o out.c >"$temp/badcgroup.out" 2>"$temp/badcgroup.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL bad cgroup status=$status"; cat "$temp/badcgroup.err"; exit 1; }
grep -q 'missing-cgroup-directory' "$temp/badcgroup.err" || { echo "FAIL bad cgroup cause"; exit 1; }
[ "$(calls)" = 1 ] || { echo "FAIL bad cgroup stub_calls=$(calls)"; exit 1; }
echo "PASS focused_missing_cgroup_directory_refused"

if [ -n "$probe" ]; then
cat > "$temp/receipt.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "bend2/src/coordinator/main.bend", "output": "out.c", "cgroup": "$probe"}
RECEIPT
status=0
(
  ulimit -v 262144
  BATON2_ADMISSION_CGROUP="$probe" BATON2_ADMISSION_RECEIPT="$temp/receipt.json" \
    "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/capped.out" 2>"$temp/capped.err"
) || status=$?
[ "$status" = 78 ] || { echo "FAIL capped rlimit status=$status"; cat "$temp/capped.err"; exit 1; }
grep -q 'rlimit-as-capped' "$temp/capped.err" || { echo "FAIL capped cause"; exit 1; }
[ "$(calls)" = 1 ] || { echo "FAIL capped stub_calls=$(calls)"; exit 1; }
echo "PASS capped_rlimit_refused"

status=0
BATON2_ADMISSION_CGROUP="$probe" BATON2_ADMISSION_RECEIPT="$temp/receipt.json" \
  "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/member.out" 2>"$temp/member.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL membership status=$status"; cat "$temp/member.err"; exit 1; }
grep -q 'cgroup-membership-mismatch' "$temp/member.err" || { echo "FAIL membership cause"; exit 1; }
[ "$(calls)" = 1 ] || { echo "FAIL membership stub_calls=$(calls)"; exit 1; }
echo "PASS cgroup_membership_mismatch_refused"
fi

echo "PASS all launch-guard fixtures"

cat > "$temp/fake-bend" <<'BEND'
#!/bin/sh
if [ "$1" = version ]; then printf 'bend 2.0.25\n'; exit 0; fi
out=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; *) shift;; esac; done
[ -n "$out" ] || exit 2
printf '/* stub */\n' > "$out"
BEND
cat > "$temp/fake-cc" <<'CC'
#!/bin/sh
out=
prev=
for a in "$@"; do if [ "$prev" = -o ]; then out=$a; fi; prev=$a; done
[ -n "$out" ] || exit 2
: > "$out"
CC
chmod 0755 "$temp/fake-bend" "$temp/fake-cc"
status=0
BEND="$temp/fake-bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" >"$temp/default.out" 2>"$temp/default.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL default build status=$status"; cat "$temp/default.err"; exit 1; }
grep -q 'default-full-main-without-admission' "$temp/default.err" || { echo "FAIL default refusal cause"; exit 1; }
echo "PASS default_build_full_main_refused"
status=0
BEND="$temp/bin/bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/focused-build" >"$temp/default-focused.out" 2>"$temp/default-focused.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL default focused status=$status"; cat "$temp/default-focused.err"; exit 1; }
grep -q 'missing-cgroup' "$temp/default-focused.err" || { echo "FAIL default focused cause"; exit 1; }
[ ! -f "$temp/focused-build" ] || { echo "FAIL default focused wrote output"; exit 1; }
echo "PASS default_build_focused_refused_without_cgroup"

status=0
BATON2_ADMISSION_CGROUP="$probe" BATON2_ADMISSION_RECEIPT="$temp/receipt.json" \
  BEND="$temp/fake-bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" >"$temp/default-unbound.out" 2>"$temp/default-unbound.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL unguarded compiler status=$status"; cat "$temp/default-unbound.err"; exit 1; }
grep -q 'compiler-not-guarded' "$temp/default-unbound.err" || { echo "FAIL unguarded compiler cause"; exit 1; }
echo "PASS default_build_unguarded_compiler_refused"
