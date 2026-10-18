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
out=
prev=
for arg in "$@"; do
  if [ "$arg" = version ]; then printf 'bend 2.0.25\n'; exit 0; fi
  if [ "$prev" = -o ]; then out=$arg; fi
  prev=$arg
done
if [ -n "$out" ]; then
  printf '%s\n' "$*" >> "$CGEN_STUB_LOG"
  printf '/* stub */\n' > "$out"
fi
exit 0
STUB
chmod 0755 "$temp/bin/bun"
printf '// stub compiler entry\n' > "$temp/bend2/main.ts"
export BUN_STUB_LOG="$temp/calls.log"
export CGEN_STUB_LOG="$temp/cgen.log"

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
[ "$status" = 78 ] || { echo "FAIL check-only status=$status"; cat "$temp/check.err"; exit 1; }
grep -q 'missing-cgroup' "$temp/check.err" || { echo "FAIL check-only refusal cause"; exit 1; }
[ "$(calls)" = 0 ] || { echo "FAIL check-only stub_calls=$(calls)"; exit 1; }
echo "PASS check_only_refused_without_admission"

status=0; BATON2_ADMISSION_CGROUP="$temp/not-a-cgroup" "$temp/bin/bend" bend2/test/tiny.bend -o out.c >"$temp/badcgroup.out" 2>"$temp/badcgroup.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL bad cgroup status=$status"; cat "$temp/badcgroup.err"; exit 1; }
grep -q 'missing-cgroup-directory' "$temp/badcgroup.err" || { echo "FAIL bad cgroup cause"; exit 1; }
[ "$(calls)" = 0 ] || { echo "FAIL bad cgroup stub_calls=$(calls)"; exit 1; }
echo "PASS focused_missing_cgroup_directory_refused"

mkdir -p "$temp/outside-cgroup"
status=0
BATON2_ADMISSION_CGROUP="$temp/outside-cgroup" "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/outside.out" 2>"$temp/outside.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL outside cgroup status=$status"; cat "$temp/outside.err"; exit 1; }
grep -q 'cgroup-outside-canonical-root' "$temp/outside.err" || { echo "FAIL outside cgroup cause"; exit 1; }
echo "PASS cgroup_outside_root_refused"

missing_max=
for candidate in /sys/fs/cgroup/*; do
  [ -d "$candidate" ] || continue
  if [ ! -e "$candidate/memory.max" ]; then missing_max=$candidate; break; fi
done
if [ -n "$missing_max" ]; then
  status=0
  BATON2_ADMISSION_CGROUP="$missing_max" "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/missing-max.out" 2>"$temp/missing-max.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL missing memory.max status=$status"; cat "$temp/missing-max.err"; exit 1; }
  grep -q 'missing-memory-max' "$temp/missing-max.err" || { echo "FAIL missing memory.max cause"; exit 1; }
  echo "PASS missing_memory_max_refused"
else
  echo "SKIP missing memory.max fixture requires a cgroup directory without memory.max"
fi

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
[ "$(calls)" = 0 ] || { echo "FAIL capped stub_calls=$(calls)"; exit 1; }
echo "PASS capped_rlimit_refused"

status=0
BATON2_ADMISSION_CGROUP="$probe" BATON2_ADMISSION_RECEIPT="$temp/receipt.json" \
  "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/member.out" 2>"$temp/member.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL membership status=$status"; cat "$temp/member.err"; exit 1; }
grep -q 'cgroup-membership-mismatch' "$temp/member.err" || { echo "FAIL membership cause"; exit 1; }
[ "$(calls)" = 0 ] || { echo "FAIL membership stub_calls=$(calls)"; exit 1; }
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
BEND="$temp/bin/bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" >"$temp/default.out" 2>"$temp/default.err" || status=$?
[ "$status" = 78 ] || { echo "FAIL default build status=$status"; cat "$temp/default.err"; exit 1; }
grep -q 'missing-cgroup' "$temp/default.err" || { echo "FAIL default refusal cause"; exit 1; }
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

swap_probe=
for candidate in /sys/fs/cgroup/* /sys/fs/cgroup/*/*; do
  [ -r "$candidate/memory.max" ] || continue
  swap_maximum=$(cat "$candidate/memory.swap.max" 2>/dev/null || true)
  maximum=$(cat "$candidate/memory.max" 2>/dev/null || true)
  case "$maximum" in ''|max|*[!0-9]*) continue;; esac
  [ "$maximum" -gt 0 ] || continue
  if [ -n "$swap_maximum" ] && [ "$swap_maximum" != 0 ]; then swap_probe=$candidate; break; fi
done
if [ -n "$swap_probe" ]; then
  cat > "$temp/swap-receipt.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "bend2/src/coordinator/main.bend", "output": "out.c", "cgroup": "$swap_probe"}
RECEIPT
  status=0
  BATON2_ADMISSION_CGROUP="$swap_probe" BATON2_ADMISSION_RECEIPT="$temp/swap-receipt.json" \
    "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/swap.out" 2>"$temp/swap.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL nonzero swap status=$status"; cat "$temp/swap.err"; exit 1; }
  grep -q 'swap-not-disabled' "$temp/swap.err" || { echo "FAIL nonzero swap cause"; cat "$temp/swap.err"; exit 1; }
  echo "PASS nonzero_swap_refused"
else
  echo "SKIP nonzero swap fixture requires a finite nonzero-swap cgroup"
fi

current_relative=$(sed -n 's/^0:://p' /proc/self/cgroup)
current=/sys/fs/cgroup$current_relative
current_max=$(cat "$current/memory.max" 2>/dev/null || true)
current_swap=$(cat "$current/memory.swap.max" 2>/dev/null || true)
case "$current_max" in
  ''|max|*[!0-9]*) current= ;;
esac
if [ -n "$current" ] && [ "$current_swap" = 0 ]; then
  before=$(calls)
  BATON2_ADMISSION_CGROUP="$current" "$temp/bin/bend" bend2/test/tiny.bend -o out.c
  [ "$(calls)" = "$((before + 1))" ] || { echo "FAIL admitted focused compiler call"; exit 1; }
  echo "PASS focused_entry_allowed_in_own_bounded_cgroup"
  cat > "$temp/current-receipt.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "bend2/src/coordinator/main.bend", "output": "out.c", "cgroup": "$current"}
RECEIPT
  BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/current-receipt.json" \
    "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c
  [ "$(calls)" = "$((before + 2))" ] || { echo "FAIL admitted Main compiler call"; exit 1; }
  echo "PASS Main_entry_allowed_with_matching_receipt"
  before_receipt=$(calls)
  status=0
  BATON2_ADMISSION_CGROUP="$current" "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/no-receipt.out" 2>"$temp/no-receipt.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL missing receipt status=$status"; cat "$temp/no-receipt.err"; exit 1; }
  grep -q 'missing-receipt' "$temp/no-receipt.err" || { echo "FAIL missing receipt cause"; exit 1; }
  [ "$(calls)" = "$before_receipt" ] || { echo "FAIL missing receipt reached compiler"; exit 1; }
  echo "PASS missing_receipt_refused"
  for decision_case in denied focused; do
    if [ "$decision_case" = denied ]; then
      receipt_decision=denied; receipt_class=full
    else
      receipt_decision=admitted; receipt_class=focused
    fi
    cat > "$temp/$decision_case.json" <<RECEIPT
{"decision": "$receipt_decision", "class": "$receipt_class", "entry": "bend2/src/coordinator/main.bend", "output": "out.c", "cgroup": "$current"}
RECEIPT
    status=0
    BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/$decision_case.json" \
      "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/$decision_case.out" 2>"$temp/$decision_case.err" || status=$?
    [ "$status" = 78 ] || { echo "FAIL $decision_case receipt status=$status"; cat "$temp/$decision_case.err"; exit 1; }
    grep -q 'receipt-mismatch' "$temp/$decision_case.err" || { echo "FAIL $decision_case receipt cause"; exit 1; }
    [ "$(calls)" = "$before_receipt" ] || { echo "FAIL $decision_case receipt reached compiler"; exit 1; }
    echo "PASS $decision_case_receipt_refused"
  done
  before_preflight=$(calls)
  before_preflight_cgen=$(wc -l < "$CGEN_STUB_LOG")
  BATON2_ADMISSION_CHECK_ONLY=1 BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/current-receipt.json" \
    "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c
  [ "$(calls)" = "$before_preflight" ] || { echo "FAIL check-only preflight invoked compiler"; exit 1; }
  [ "$(wc -l < "$CGEN_STUB_LOG")" = "$before_preflight_cgen" ] || { echo "FAIL preflight generated C"; exit 1; }
  echo "PASS check_only_preflight_does_not_invoke_compiler"
  before_check=$(calls)
  BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/current-receipt.json" \
    "$temp/bin/bend" --check-only bend2/src/coordinator/main.bend
  [ "$(calls)" = "$((before_check + 1))" ] || { echo "FAIL admitted check-only compiler call"; exit 1; }
  echo "PASS check_only_allowed_in_own_bounded_cgroup"
  baseline=$(calls)
  cat > "$temp/malformed.json" <<'RECEIPT'
{
RECEIPT
  status=0
  BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/malformed.json" \
    "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/malformed.out" 2>"$temp/malformed.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL malformed receipt status=$status"; cat "$temp/malformed.err"; exit 1; }
  grep -q 'receipt-mismatch' "$temp/malformed.err" || { echo "FAIL malformed receipt cause"; exit 1; }
  [ "$(calls)" = "$baseline" ] || { echo "FAIL malformed receipt reached compiler"; exit 1; }
  echo "PASS malformed_receipt_refused"
  for case_name in entry output cgroup; do
    case "$case_name" in
      entry) receipt_entry=bend2/test/tiny.bend; receipt_output=out.c; receipt_cgroup="$current" ;;
      output) receipt_entry=bend2/src/coordinator/main.bend; receipt_output=other.c; receipt_cgroup="$current" ;;
      cgroup) receipt_entry=bend2/src/coordinator/main.bend; receipt_output=out.c; receipt_cgroup=/sys/fs/cgroup/other ;;
    esac
    cat > "$temp/mismatch-$case_name.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "$receipt_entry", "output": "$receipt_output", "cgroup": "$receipt_cgroup"}
RECEIPT
    status=0
    BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/mismatch-$case_name.json" \
      "$temp/bin/bend" bend2/src/coordinator/main.bend -o out.c >"$temp/mismatch-$case_name.out" 2>"$temp/mismatch-$case_name.err" || status=$?
    [ "$status" = 78 ] || { echo "FAIL $case_name mismatch status=$status"; cat "$temp/mismatch-$case_name.err"; exit 1; }
    grep -q 'receipt-mismatch' "$temp/mismatch-$case_name.err" || { echo "FAIL $case_name mismatch cause"; exit 1; }
    [ "$(calls)" = "$baseline" ] || { echo "FAIL $case_name mismatch reached compiler"; exit 1; }
    echo "PASS ${case_name}_mismatch_refused"
  done
  status=0
  BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/malformed.json" \
    BEND="$temp/bin/bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" bend2/src/coordinator/main.bend "$temp/build-refused" >"$temp/build-malformed.out" 2>"$temp/build-malformed.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL build malformed receipt status=$status"; cat "$temp/build-malformed.err"; exit 1; }
  grep -q 'receipt-mismatch' "$temp/build-malformed.err" || { echo "FAIL build malformed receipt cause"; exit 1; }
  [ ! -f "$temp/build-refused" ] || { echo "FAIL build malformed receipt wrote output"; exit 1; }
  echo "PASS build_native_reuses_admission_validator"
  cat > "$temp/build-accepted.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "bend2/src/coordinator/main.bend", "output": "$temp/build-accepted.c", "cgroup": "$current"}
RECEIPT
  before_accept=$(calls)
  before_accept_cgen=$(wc -l < "$CGEN_STUB_LOG")
  status=0
  BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/build-accepted.json" \
    BEND="$temp/bin/bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" \
    bend2/src/coordinator/main.bend "$temp/build-accepted" >"$temp/build-accepted.out" 2>"$temp/build-accepted.err" || status=$?
  [ "$status" = 0 ] || { echo "FAIL accepted build status=$status"; cat "$temp/build-accepted.err"; exit 1; }
  [ "$(calls)" = "$((before_accept + 2))" ] || { echo "FAIL accepted build wrapper calls=$(calls)"; exit 1; }
  [ "$(wc -l < "$CGEN_STUB_LOG")" = "$((before_accept_cgen + 1))" ] || { echo "FAIL accepted build Cgen calls"; exit 1; }
  tail -1 "$CGEN_STUB_LOG" | grep -F -- "-o $temp/build-accepted.c" >/dev/null || { echo "FAIL accepted build output path"; exit 1; }
  [ -f "$temp/build-accepted.c" ] || { echo "FAIL accepted build missing C output"; exit 1; }
  [ -f "$temp/build-accepted" ] || { echo "FAIL accepted build missing binary"; exit 1; }
  echo "PASS build_native_one_cgen_same_output_path"
  cat > "$temp/build-wrong.json" <<RECEIPT
{"decision": "admitted", "class": "full", "entry": "bend2/src/coordinator/main.bend", "output": "$temp/wrong.c", "cgroup": "$current"}
RECEIPT
  before_wrong=$(calls)
  status=0
  BATON2_ADMISSION_CGROUP="$current" BATON2_ADMISSION_RECEIPT="$temp/build-wrong.json" \
    BEND="$temp/bin/bend" CC="$temp/fake-cc" sh "$here/../scripts/build-native.sh" \
    bend2/src/coordinator/main.bend "$temp/build-wrong" >"$temp/build-wrong.out" 2>"$temp/build-wrong.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL wrong build output status=$status"; cat "$temp/build-wrong.err"; exit 1; }
  grep -q 'receipt-mismatch' "$temp/build-wrong.err" || { echo "FAIL wrong build output cause"; exit 1; }
  [ "$(calls)" = "$before_wrong" ] || { echo "FAIL wrong build output reached compiler"; exit 1; }
  [ ! -f "$temp/build-wrong" ] || { echo "FAIL wrong build output wrote binary"; exit 1; }
  echo "PASS build_native_rejects_receipt_path_mismatch"
  before_capped=$(calls)
  status=0
  (
    ulimit -v 262144
    BATON2_ADMISSION_CGROUP="$current" "$temp/bin/bend" bend2/test/tiny.bend -o out.c
  ) >"$temp/current-capped.out" 2>"$temp/current-capped.err" || status=$?
  [ "$status" = 78 ] || { echo "FAIL focused capped rlimit status=$status"; exit 1; }
  grep -q 'rlimit-as-capped' "$temp/current-capped.err" || { echo "FAIL focused capped rlimit cause"; exit 1; }
  [ "$(calls)" = "$before_capped" ] || { echo "FAIL compiler ran with capped rlimit"; exit 1; }
  echo "PASS focused_capped_rlimit_refused"
else
  echo "SKIP admitted cases require a bounded zero-swap test scope"
fi

before=$(calls)
"$temp/bin/bend" version >"$temp/version.out"
grep -q '^bend 2.0.25$' "$temp/version.out" || { echo "FAIL version output"; exit 1; }
[ "$(calls)" = "$((before + 1))" ] || { echo "FAIL version compiler call"; exit 1; }
echo "PASS version_query_allowed"
