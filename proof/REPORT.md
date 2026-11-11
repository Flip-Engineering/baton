# First-class frontend check kind: caller branch and core patch

Worktree: `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-consolidation-review-20261017/worktrees/frontend-check-custody-20261021`.

Caller branch: `codex/frontend-check-custody-20261021`, parent `b9b00c4c7f`, head `f6dd066762`.
Descendant commits: `77089f6aac` (check-kind launcher), `de9eafb4f3` (module routing and native build path), `f6dd066762` (entry resolution from the source root).
Core branch: `codex/compile-queue-check-kind-20261021`, base `05ab70e2c5d8d3cb7bf504d34b245960968e954a`, head `f956fb83fb`.
Author: `Flip Baton - DeepSeek <337142705+flip-baton-deepseek[bot]@users.noreply.github.com>`.
Caller bundles: `proof/caller-descendant.bundle` (`b9b00c4c7f..HEAD`) and `proof/caller-branch.bundle` (`b4274718cc..HEAD`).
Core bundle: `proof/core-check-kind.bundle` (`05ab70e2..f956fb83fb`).
Diffs: `proof/caller-descendant.diff`, `proof/caller-branch.diff`, `proof/core-check-kind.patch`.
No push, no force-push, no history rewrite. The queue-core change is a separate patch for the #1001/#1002 owner.

## Per-property disposition

1. **First-class check kind/path: done.** The core patch adds `kind=check` with the source closure and source digest, the compiler identity, declared inputs, the same host heavy lock, generic result handling, and artifact validation by existence. Every declared check artifact is published, including an empty stderr. Identical requests coalesce on the key. `bend2/scripts/check-bend.sh` submits `kind=check` with `stdout` and `stderr` artifacts and the child helper as `--input`; the helper writes both artifacts and the launcher prints them. The proof covers serialization, coalescing, empty stderr, and clear failure when a declared artifact is absent.
2. **Source-bound identity: done.** The check kind uses the entry source closure and digest (core patch: `request_key` and `digest_lines` treat `check` like `cgen`; `write_attempt_digest` and `supervise_kind` recheck the source). The launcher declares the helper with `--input`, so the helper bytes enter `input_rows` and the key. The proof shows helper-byte change, support-input-byte change, entry change, and compiler-stub change each produce a different key; the same helper bytes declared with `--aux` leave the key unchanged. The native cgen key probe shows the same input-versus-aux split in the installed queue identity.
3. **Queue-core ownership: done.** The core change is one commit (`f956fb83fb`) on a branch based exactly on `05ab70e2`, with a patch and bundle. It touches:
   - `bend2/src/host/compile-queue.bend`: `validate_config` kind and source checks (final lines 355-361), source and kind error messages (386, 391), `write_attempt_files` digest condition (587-589), `supervise_kind` digest condition (813-815), usage (1579-1580).
   - `bend2/src/host/compile-queue-identity.bend`: material comments (49-53, 68), `digest_lines` (166-169), `request_key` source-kind branch (714-715, 722-723).
   - `docs/bend2/compile-queue-20261019.md`: check-kind section; kind list (51); source closure lines (58-59).
   No result, lifecycle, artifact or C file changes. The patch is handed to the owner for adoption; no competing merge was created.
4. **Native-build routing: done.** `bend2/scripts/run-checks.mjs` routes `bend MOD -o OUT` through `bend2/scripts/build-native.sh` exactly as the `b4274718cc` hunk, with `CUSTODY_ENV` carrying the resolved `BEND`. The check-only call uses the check-kind launcher; it contains no cgen stdout/stderr artifacts.
5. **Fake-command coverage: done.** The transcript covers custody serialization on one lock inode, the child's lifetime through error and SIGTERM exit, coalescing of identical checks (one child start for two requesters), empty-stderr success with a zero-byte published stderr artifact, the identity cases in property 2, and a check that writes no declared artifact failing with `artifact stdout was not written`. No real compiler, Cgen, clang, bootstrap or build ran.

Bare frontend coverage remains open: a bare `bend FILE` run's frontend phase executes directly, and `cli_build` submits its own `cc` request. The check kind covers `--check-only`; the caller document states the bare gap.

## Coordination with the #1001/#1002 owner

The core patch is based on `05ab70e2c5d8d3cb7bf504d34b245960968e954a` and is not merged into the caller branch. The owner can apply `proof/core-check-kind.patch` or fetch `proof/core-check-kind.bundle`. The caller branch can land independently once the check kind is present; until then, `run-checks.mjs` check-only and `check-bend.sh` receive the queue's kind rejection. The caller branch's queue source is from its own base; the owner integrates the core patch and the caller branch in either order that keeps the check kind ahead of the check-only caller.

## Final caller coverage

| Site | Invocation | Route | Status |
| --- | --- | --- | --- |
| `bend2/scripts/run-checks.mjs:97` | `--check-only MOD` | `check-bend.sh` (`kind=check`) | check kind required |
| `bend2/scripts/run-checks.mjs:110` | bare `bend MOD` run | direct frontend; `cli_build` queues cc | frontend gap |
| `bend2/scripts/run-checks.mjs:135` | `bend MOD -o OUT` | `build-native.sh` (cgen and cc) | restored b427 hunk |
| `bend2/test/compiler-arm-sharing.py:240` | `--check-only` fixture | direct `run_bun` | compiler test |
| `bend2/test/compiler-arm-sharing.py:109,127` | cgen and cc fixture work | queue | unchanged |
| `bend2/scripts/build-native.sh:167,214,245` | cgen and cc | queue | unchanged |
| `bend2/scripts/bootstrap-compile-queue.sh:54` | one-time queue binary build | pre-queue bootstrap | unchanged |
| `bend2/scripts/check-native.sh:10-74` | `build-native.sh` | queue | unchanged |
| `bend2/scripts/check-unittest.sh:80` | `build-native.sh` | queue | unchanged |
| `.github/workflows/bend2-native.yml:212,389` | `check-native.sh`, `build-native.sh` | queue | unchanged |
| `bend2/scripts/accept-git.py:114` | `build-native.sh` | queue | unchanged |
| `bend2/scripts/accept-native-receive.py:199` | `build-native.sh` | queue | unchanged |
| `bend2/scripts/package-native.py:68`, `stage-logs-clean-all.py:90`, `trial-start.sh:52` | `build-native.sh` | queue | unchanged |
| `bend2/test/*.py` build sites | `build-native.sh` | queue | unchanged |
| `bend2/test/bend-launch-guard.sh:50` | `--check-only` against a stub compiler | direct fixture | excluded |
| `bundle/account-credit-currentmain-2.0.25-check.sh:59` | `--check-only` | frozen retained qualification script | excluded |
| `bundle/account-credit-native-qualification-20261018.sh` | `build-native.sh` builds | frozen retained qualification script | excluded |
| `bend2/scripts/bend-launch-guard.sh:6` | packaged compiler entry | direct | unchanged |
| `bend2/test/compile-queue.sh`, `test_compile_queue_command.py` | fake compilers | queue tests | excluded |
| `bend2/scripts/bend-lineage-guard.sh` | lineage preflight | no compiler execution | unchanged |
| `docs/bend2/examples/*` | documented commands | documentation | n/a |

## Proof transcript

`proof/check-kind-transcript.txt`; the disposable queue is `proof/fake-check-queue.sh` (the retained reference shell queue at `97a95949` with `check` added to the kind validation, source digest and heavy-lock conditions; patch at `proof/fake-check-queue.patch`), driven through `proof/fake-check-adapter.sh`. Its heavy lock is `$state/cgen.lock`; the permanent core uses `$state/heavy.lock`.

The proof ran on a fresh temporary state root with stub compiler commands. It used no live queue state, no real compiler, no Cgen and no clang. The native identity probe used the installed queue runner's `key` subcommand with the cgen lane and a release compiler path; it hashed the compiler without executing it.

## Limits

The core patch is source-reviewed only; the task forbids a heavy compile or bootstrap, so the native check-kind executable was not built. The runtime proof uses the disposable reference-shell queue as the check-kind contract twin, and the native `key` probe demonstrates the installed queue's input-versus-aux identity behavior. The check kind's native validation, digest and lock wiring are visible in `proof/core-check-kind.patch`. Bare-run frontend custody remains open as stated.

## Caller descendant diff

```diff
diff --git a/bend2/scripts/check-bend-child.sh b/bend2/scripts/check-bend-child.sh
new file mode 100755
index 0000000000..d515f18c95
--- /dev/null
+++ b/bend2/scripts/check-bend-child.sh
@@ -0,0 +1,13 @@
+#!/bin/sh
+# Child half of check-bend.sh. The queue substitutes the artifact paths for
+# the declared stdout and stderr destinations and stages this helper as an
+# input.
+set -u
+compiler=$1
+entry=$2
+out=$3
+err=$4
+"$compiler" "$entry" --check-only >"$out" 2>"$err"
+status=$?
+cat "$err" >&2
+exit "$status"
diff --git a/bend2/scripts/check-bend.sh b/bend2/scripts/check-bend.sh
new file mode 100755
index 0000000000..69534195c5
--- /dev/null
+++ b/bend2/scripts/check-bend.sh
@@ -0,0 +1,104 @@
+#!/bin/sh
+# Run one Bend2 frontend check through the compile queue check kind.
+#
+# The check kind holds the host heavy lock for the child's lifetime and
+# computes the source closure for the entry. The launcher declares stdout and
+# stderr as check artifacts; the queue publishes both, including empty stderr.
+# The child helper is declared as an input, so its bytes enter the request key.
+set -eu
+here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
+root=$(CDPATH= cd -- "$here/../.." && pwd -P)
+cd "$root"
+
+if [ "${1:-}" = --check-only ]; then
+  shift
+fi
+if [ "$#" -ne 1 ]; then
+  echo "usage: check-bend.sh [--check-only] FILE" >&2
+  exit 2
+fi
+entry=$1
+
+compiler=${BEND:-"$root/.bend/bin/bend"}
+if [ ! -x "$compiler" ]; then
+  compiler="$root/node_modules/.bend/bin/bend"
+fi
+if [ ! -x "$compiler" ]; then
+  echo 'Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.' >&2
+  exit 1
+fi
+
+queue="$root/bend2/scripts/compile-queue.sh"
+[ -f "$queue" ] || {
+  echo "The host compile queue entry is unavailable: $queue" >&2
+  exit 1
+}
+if [ -n "${BATON2_COMPILE_QUEUE_BIN:-}" ] && { [ ! -f "${BATON2_COMPILE_QUEUE_BIN}" ] || [ ! -x "${BATON2_COMPILE_QUEUE_BIN}" ]; }; then
+  echo "The selected compile queue executable is missing or not executable: $BATON2_COMPILE_QUEUE_BIN" >&2
+  exit 1
+fi
+state=${BATON_COMPILE_QUEUE_ROOT:-}
+case "$state" in
+  /*) ;;
+  *)
+    echo 'Set BATON_COMPILE_QUEUE_ROOT to the shared absolute compile-queue state directory.' >&2
+    exit 1
+    ;;
+esac
+if [ ! -d "$state" ]; then
+  if ! mkdir -p "$state"; then
+    echo "The compile-queue state root is missing and cannot be created: $state" >&2
+    exit 1
+  fi
+fi
+if [ ! -w "$state" ] || [ ! -x "$state" ]; then
+  echo "The compile-queue state root is not writable: $state" >&2
+  exit 1
+fi
+export BATON_COMPILE_QUEUE_ROOT="$state"
+export BEND_NO_TELEMETRY=1
+
+entry_path=$(readlink -f -- "$entry" 2>/dev/null || printf '%s' "$entry")
+case "$entry_path" in
+  "$root"/*) ;;
+  *)
+    echo "check-bend.sh: the entry is outside the source root: $entry" >&2
+    exit 2
+    ;;
+esac
+entry=${entry_path#"$root"/}
+
+helper="$here/check-bend-child.sh"
+[ -x "$helper" ] || {
+  echo "check-bend.sh: the check helper is unavailable: $helper" >&2
+  exit 1
+}
+
+scratch=$(mktemp -d "${TMPDIR:-/tmp}/bend-check.XXXXXXXX")
+cleanup() {
+  status=$?
+  trap - EXIT
+  rm -rf -- "$scratch" || {
+    printf 'check-bend scratch cleanup failed; retained %s\n' "$scratch" >&2 || true
+  }
+  exit "$status"
+}
+trap cleanup EXIT
+trap 'exit 129' HUP
+trap 'exit 130' INT
+trap 'exit 143' TERM
+out=$scratch/stdout
+err=$scratch/stderr
+
+status=0
+sh "$queue" run --kind check --state-root "$state" --cwd "$root" --root "$root" \
+  --source-root "$root" --entry "$entry" --compiler "$compiler" \
+  --input "$helper" \
+  --artifact "stdout=$out" --artifact "stderr=$err" \
+  --option frontend=check -- \
+  sh "$helper" "$compiler" "$entry" "$out" "$err" || status=$?
+if [ "$status" -eq 0 ]; then
+  cat "$out"
+  cat "$err" >&2
+fi
+exit "$status"
diff --git a/bend2/scripts/run-checks.mjs b/bend2/scripts/run-checks.mjs
index 682ed1aa02..e6d3d49fb6 100644
--- a/bend2/scripts/run-checks.mjs
+++ b/bend2/scripts/run-checks.mjs
@@ -33,6 +33,7 @@ function resolveBend() {
 }
 
 const BEND = resolveBend();
+const CUSTODY_ENV = { ...ENV, BEND };
 
 const version = execFileSync(BEND, ['version'], { env: ENV, cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity }).trim();
 if (version !== 'bend 2.0.25') {
@@ -61,6 +62,16 @@ function run(args, opts = {}) {
   return execFileSync(BEND, args, { env: ENV, cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity, ...opts });
 }
 
+function runCustody(args) {
+  return execFileSync('sh', [join(ROOT, 'bend2', 'scripts', 'check-bend.sh'), ...args],
+    { env: CUSTODY_ENV, cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity });
+}
+
+function buildNative(mod, output) {
+  return execFileSync('sh', [join(ROOT, 'bend2', 'scripts', 'build-native.sh'), mod, output],
+    { env: CUSTODY_ENV, cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity });
+}
+
 const modules = discoverModules(SRC);
 let totalModules = 0;
 let totalRuns = 0;
@@ -83,7 +94,7 @@ for (const mod of modules) {
   const expected = readFileSync(expectedPath, 'utf8');
 
   try {
-    run(['--check-only', mod]);
+    runCustody(['--check-only', mod]);
     result.checkOnly = 'pass';
   } catch (err) {
     result.checkOnly = 'fail';
@@ -121,7 +132,7 @@ for (const mod of modules) {
   const binaryPath = join(SCRATCH, name.replace(/\//g, '-'));
   let nativeOut;
   try {
-    run([mod, '-o', binaryPath]);
+    buildNative(mod, binaryPath);
     nativeOut = execFileSync(binaryPath, [], { env: ENV, cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity });
     totalRuns++;
     if (nativeOut === expected) {
diff --git a/docs/bend2/compile-queue-20261019.md b/docs/bend2/compile-queue-20261019.md
index 85d31ae6a7..3d5d01b9fb 100644
--- a/docs/bend2/compile-queue-20261019.md
+++ b/docs/bend2/compile-queue-20261019.md
@@ -42,13 +42,19 @@ A bare `bend FILE` run performs the frontend phase and then calls
 request. An outer queue request around the run holds the heavy lock while the
 compiler waits for the nested `cc` request.
 
-Frontend checks run directly through the compiler. The maintained callers
-`bend2/scripts/run-checks.mjs` and `bend2/test/compiler-arm-sharing.py` do not
-declare queue artifacts for the check. A first-class frontend kind is
-deferred. It would take the heavy lock, compute the source closure, and accept
-a text result without a C artifact. A queued request that uses a helper file
-declares that file with `--input`; `--aux` records the path and not the file
-bytes, so the request key does not change when the helper bytes change.
+The check kind is prepared as a queue-core patch against
+`05ab70e2c5d8d3cb7bf504d34b245960968e954a` and is pending adoption by the
+#1001/#1002 owner. It takes the heavy lock, computes the source closure for the
+entry, and accepts stdout and stderr as check artifacts, including empty
+stderr. `bend2/scripts/check-bend.sh` submits `kind=check` and declares the
+child helper as an input, so the helper bytes enter the request key. The
+caller requires the check kind; a tree without the core patch rejects the
+request.
+
+`bend2/scripts/run-checks.mjs` uses the launcher for `--check-only` and
+`build-native.sh` for `-o` builds. `bend2/test/compiler-arm-sharing.py` runs
+its fixture check directly. Bare `bend FILE` runs stay direct; their frontend
+phase has no queue entry point, as described above.
 
 ## Identity
 
```

## Core patch against 05ab70e2

```diff
diff --git a/bend2/src/host/compile-queue-identity.bend b/bend2/src/host/compile-queue-identity.bend
index 53032bf71b..1166bcfeb9 100644
--- a/bend2/src/host/compile-queue-identity.bend
+++ b/bend2/src/host/compile-queue-identity.bend
@@ -46,11 +46,11 @@ type CompileQueueWalk is Data:
 # record.
 #
 # Material encoding for `material` and `material_key`:
-#   kind                "cgen" or "cc"
+#   kind                "cgen", "cc" or "check"
 #   entry               worktree-relative Bend entry, empty for cc
 #   options             one KEY=VALUE per line; sorted bytewise here
-#   source_digest       64-hex digest of the cgen source closure, empty for cc
-#   file_closure_digest 64-hex digest of the cc file closure, empty for cgen
+#   source_digest       64-hex digest of the cgen or check source closure, empty for cc
+#   file_closure_digest 64-hex digest of the cc file closure, empty for cgen and check
 #   compiler_digest     64-hex digest of the compiler/linker/version closure
 #   input_rows          one `destination<TAB>sha256<TAB>bytes` per line; the
 #                       destination is the work-relative staged name
@@ -65,7 +65,7 @@ type CompileQueueWalk is Data:
 #   kind=KIND
 #   entry=ENTRY
 #   option=VALUE            (sorted, one per line)
-#   source-digest=HEX       (cgen) or file-digest=HEX (cc)
+#   source-digest=HEX       (cgen or check) or file-digest=HEX (cc)
 #   toolchain-digest=HEX
 #   input=DEST<TAB>SHA<TAB>BYTES
 #   artifact-name=NAME
@@ -164,7 +164,9 @@ def CompileQueueIdentity.argv_lines(+tokens: String) -> String:
       CompileQueueIdentity.argv_plain(String.lines(tokens))))
 
 def CompileQueueIdentity.digest_lines(kind: String, source_digest: String, file_closure_digest: String) -> String:
-  Bool.pick(String, String.eq(kind, "cgen"), "source-digest=" ++ source_digest ++ "\n", "file-digest=" ++ file_closure_digest ++ "\n")
+  Bool.pick(String,
+    Bool.or(String.eq(kind, "cgen"), String.eq(kind, "check")),
+    "source-digest=" ++ source_digest ++ "\n", "file-digest=" ++ file_closure_digest ++ "\n")
 
 def CompileQueueIdentity.path_absolute(+path: String) -> Bool:
   String.starts_with(path, "/")
@@ -709,14 +711,15 @@ def CompileQueueIdentity.closure_files(+sources: String, +aux: String) -> String
 # already normalized to @root/@cwd, {in:...}, {out:...} and {compiler}.
 def CompileQueueIdentity.request_key(+kind: String, +cwd: String, +root: String, +source_root: String, +entry: String, +compiler: String, +linker: String, +version: String, +inputs: String, +aux: String, +artifacts: String, +options: String, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
   do IO<Result<&1,&1,U32 & String,String>>:
-    +closure : String <- Bool.pick(IO(String), String.eq(kind, "cgen"),
+    +source_kind = Bool.or(String.eq(kind, "cgen"), String.eq(kind, "check"))
+    +closure : String <- Bool.pick(IO(String), source_kind,
       IO.try(String, CompileQueueIdentity.source_digest(source_root, entry)),
       IO.try(String, CompileQueueIdentity.file_closure_digest(source_root, CompileQueueIdentity.closure_files(CompileQueueIdentity.input_sources(String.lines(inputs)), aux))))
     +ccache : String <- IO.pure(String, CompileQueueIdentity.ccache_expand(CompileQueueIdentity.ccache_path(String.lines(command)), cwd, root, compiler))
     toolchain : String <- IO.try(String, CompileQueueIdentity.compiler_closure_digest(compiler, linker, version, ccache))
     rows : String <- IO.try(String, CompileQueueIdentity.input_rows(String.lines(inputs)))
     CompileQueueIdentity.material_key(kind, entry, options,
-      Bool.pick(String, String.eq(kind, "cgen"), closure, ""),
-      Bool.pick(String, String.eq(kind, "cgen"), "", closure),
+      Bool.pick(String, source_kind, closure, ""),
+      Bool.pick(String, source_kind, "", closure),
       toolchain, rows,
       CompileQueueIdentity.artifact_names(String.lines(artifacts)), command)
diff --git a/bend2/src/host/compile-queue.bend b/bend2/src/host/compile-queue.bend
index 5b8ed9d4b9..56f42b776a 100644
--- a/bend2/src/host/compile-queue.bend
+++ b/bend2/src/host/compile-queue.bend
@@ -352,10 +352,12 @@ def validate_config(config: Config, need_command: Bool) -> String:
       artifacts = artifact_rows(text)
       inputs = input_rows(text)
       +token = field(text, "token")
-      +kind_ok = Bool.or(Tx.str_eq(kind, "cgen"), Tx.str_eq(kind, "cc"))
+      +kind_ok = Bool.or(Tx.str_eq(kind, "cgen"),
+        Bool.or(Tx.str_eq(kind, "cc"), Tx.str_eq(kind, "check")))
       +command_ok = Bool.pick(Bool, need_command, non_empty_list(command), True{})
       +artifact_ok = artifact_set_valid(artifacts)
-      +source_ok = Bool.pick(Bool, Tx.str_eq(kind, "cgen"),
+      +source_ok = Bool.pick(Bool,
+        Bool.or(Tx.str_eq(kind, "cgen"), Tx.str_eq(kind, "check")),
         Bool.and(non_empty(source), non_empty(entry)), True{})
       +cc_source_ok = Bool.pick(Bool, Tx.str_eq(kind, "cc"), valid_state_root(source), True{})
       +linker = field(text, "linker")
@@ -381,12 +383,12 @@ def validate_config(config: Config, need_command: Bool) -> String:
                         "compile-queue: token must contain only letters, digits, dot, underscore or hyphen"),
                       "compile-queue: cc requires --linker and --version"),
                     "compile-queue: cc requires an absolute --source-root"),
-                  "compile-queue: cgen requires --source-root and --entry"),
+                  "compile-queue: cgen or check requires --source-root and --entry"),
                 "compile-queue: artifact names must be safe relative paths"),
               "compile-queue: a command is required after --"),
             "compile-queue: cwd is unavailable"),
           "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"),
-        "compile-queue: kind must be cgen or cc")
+        "compile-queue: kind must be cgen, cc or check")
 
 def input_pairs_text(inputs: List<&2,Input>) -> String:
   match inputs:
@@ -582,7 +584,8 @@ def write_attempt_files(+config: Config, +key: String, keydir: String, +attempt:
           IO.die(Unit, 1, "compile-queue: inputs changed before execution"))
         wrote_command : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(attempt ++ "/command", command_text(command, work, inputs, artifacts)))
         wrote_meta : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(attempt ++ "/meta", meta_text(config, key, keydir, attempt, artifacts)))
-        digest_written : Unit <- Bool.pick(IO(Unit), Tx.str_eq(field(text, "kind"), "cgen"),
+        digest_written : Unit <- Bool.pick(IO(Unit),
+          Bool.or(Tx.str_eq(field(text, "kind"), "cgen"), Tx.str_eq(field(text, "kind"), "check")),
           write_attempt_digest(attempt, text), IO.pure(Unit, Unit{}))
         IO.pure(Unit, Unit{})
 
@@ -807,7 +810,8 @@ def run_supervised(+attempt: String, +keydir: String, +kind: String, +key: Strin
 
 def supervise_kind(+kind: String, source_root: String, entry: String, +attempt: String,
                     +keydir: String, +key: String, +started: String, +names: List<&2,String>, +cwd: String) -> IO(Unit):
-  Bool.pick(IO(Unit), Tx.str_eq(kind, "cgen"),
+  Bool.pick(IO(Unit),
+    Bool.or(Tx.str_eq(kind, "cgen"), Tx.str_eq(kind, "check")),
     do IO<Unit>:
       before : String <- IO.try(String, L.CompileQueueLifecycle.read_text(attempt ++ "/source-digest"))
       before_digest : String <- IO.pure(String, field(before, "digest"))
@@ -1572,8 +1576,8 @@ def adopt_command(args: List<&2,String>) -> IO(Unit):
     adopt_parsed_config(parsed)
 
 def usage() -> String:
-  "usage: compile-queue.sh run --kind cgen|cc --state-root DIR --cwd DIR [options] -- COMMAND...\n"
-  ++ "       compile-queue.sh key --kind cgen|cc [options]\n"
+  "usage: compile-queue.sh run --kind cgen|cc|check --state-root DIR --cwd DIR [options] -- COMMAND...\n"
+  ++ "       compile-queue.sh key --kind cgen|cc|check [options]\n"
   ++ "       compile-queue.sh cancel --state-root DIR --key KEY --token TOKEN\n"
   ++ "       compile-queue.sh wait --state-root DIR --key KEY\n"
   ++ "       compile-queue.sh status --state-root DIR [--key KEY]\n"
diff --git a/docs/bend2/compile-queue-20261019.md b/docs/bend2/compile-queue-20261019.md
index 64829bee2f..959ff08ba2 100644
--- a/docs/bend2/compile-queue-20261019.md
+++ b/docs/bend2/compile-queue-20261019.md
@@ -28,21 +28,35 @@ live requesters, and cancellation stops the execution only when no live owner
 remains. The fake-command suite covers distinct cgen serialization, concurrent
 cc overlap, identical coalescing, requester loss, and one-owner withdrawal.
 
+## Check kind
+
+The `check` kind admits a Bend frontend check. It takes the same host heavy
+lock as `cgen` and `cc`. A check request requires `--source-root` and
+`--entry`; the source closure covers the entry and its imports, and the
+request identity uses that source digest. The compiler identity, declared
+inputs and options enter the key, so a helper file declared with `--input` is
+bound by its bytes.
+
+A check declares its stdout and stderr as artifacts. The queue verifies that
+each declared artifact exists and publishes its bytes; an empty artifact is
+valid. The result records the exit status. Identical check requests coalesce
+on the key and share the completed result.
+
 ## Identity
 
 The material for one request is a line-oriented text record. The identity schema is versioned independently of the bootstrap shell; a shell key is never reused as a permanent cache key because it omits imported C and header inputs.
 
 ```
 schema=baton-compile-queue-v1
-kind=<cgen|cc>
+kind=<cgen|cc|check>
 entry=<entry argument>
 option=<KEY=VALUE>                      sorted
 compiler-entry=<sha256 of the resolved compiler or wrapper>
 compiler-wrapper=<sha256>               one per followed absolute exec wrapper
 toolchain=release|executable
 toolchain-file=<relative path> <sha256> <bytes>   sorted, release layout only
-source-entry=<relative entry path>      cgen only
-source-file=<relative path> <sha256> <bytes>      sorted, cgen only
+source-entry=<relative entry path>      cgen and check only
+source-file=<relative path> <sha256> <bytes>      sorted, cgen and check only
 input=<destination> <sha256> <bytes>    copied inputs
 artifact-name=<name>                    requested artifact names
 argv=<normalized token>                 command order
```

## Raw proof transcript

```text
== environment ==
worktree=/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-consolidation-review-20261017/worktrees/frontend-check-custody-20261021
check_queue=/tmp/check-queue.sh (disposable reference-shell queue with the check kind contract)
state_root=/tmp/check-kind.0UpFJ1/state
stub=/tmp/check-kind.0UpFJ1/stub

== 1. serialization of two checks (distinct entries) ==
during A: probe=held
A status=0 B status=0
after A and B: probe=free

== 2. coalescing of identical checks ==
C1 status=0 C2 status=0 child_starts=1
C1 stdout=stdout .scratch/check-proof/c.bend --check-only 
C2 stdout=stdout .scratch/check-proof/c.bend --check-only 

== 3. error path and lock release ==
error status=1 probe=free
error stderr tail=stderr .scratch/check-proof/d.bend --check-only

== 4. terminal path and lock release ==
during TERM: probe=held child=1935649
terminal status=1 probe_after_release=free waited_ms=0

== 5. empty stderr success ==
empty status=0 stderr_bytes=0 stdout=stdout .scratch/check-proof/f.bend --check-only 
published_stderr_bytes=0

== 6. request identity binding ==
helper-one      3b4da036cded48302a8bbcff7eb203267544c40dfea427d593ab7213d05a33a9
helper-two      cf990c98a6dc13f14cb046ea7f618c1f7106f32a934be20171526e3947ada993
support-two     ee2d73d6d26a04f4cd70b1fd65389d6b671cb634cc13665f5891b11724f3f11f
entry-a         a975b9e25dc2b2f6a3fd792ef5353d9831a40841752ad5dc9419d9d32691e18f
helper_bytes_change_same_key=no
support_bytes_change_same_key=no
entry_change_same_key=no
compiler_change_same_key=no
aux_bytes_change_same_key=yes

== 7. a check that writes no declared artifact ==
no_result_status=1
compile-queue: check execution failed key=a9092e3ccd60f03327f9b81dd1d9ac9e1ed0329b4139ddf6abc0238e3614a6fb exit=1
compile-queue: artifact stdout was not written

== 8. native identity mechanism (installed queue runner, cgen lane, key only) ==
native_input_one  fbfb61afc3877d73746f9a9833eee7b3b920062c575444805838d961d10a0d8d
native_input_two  70fb60481918a500eb918be0357550ee6c72ccc382bf5f6de7a8532f66e37506
native_aux_one    fbfb61afc3877d73746f9a9833eee7b3b920062c575444805838d961d10a0d8d
native_aux_two    fbfb61afc3877d73746f9a9833eee7b3b920062c575444805838d961d10a0d8d
native_input_bytes_change_same_key=no
native_aux_bytes_change_same_key=yes

== intervals ==
start 1792620385788338037 1914368 2050:34612307 .scratch/check-proof/a.bend --check-only
end 1792620387792838401 1914368
start 1792620390661247621 1919739 2050:34612307 .scratch/check-proof/b.bend --check-only
end 1792620392666846699 1919739
start 1792620398566957309 1925976 2050:34612307 .scratch/check-proof/c.bend --check-only
end 1792620399572839780 1925976
start 1792620405445351117 1931755 2050:34612307 .scratch/check-proof/d.bend --check-only
end 1792620405449711674 1931755
start 1792620409836459910 1935649 2050:34612307 .scratch/check-proof/e.bend --check-only
start 1792620414139395720 1939360 2050:34612307 .scratch/check-proof/f.bend --check-only
end 1792620414142994178 1939360
== interval check ==
intervals=6 same_lock=yes no_overlap=yes
```
