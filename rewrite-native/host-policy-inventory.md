# Host policy inventory: policy-shaped statements in C and their Bend2 destinations

Author: rewrite-native (GLM 5.3 Flash, omp). Baseline: snapshot `81880bc`
plus this branch's commits. Review criteria: B2 (effects stay in the
effect system; host stays thin), C1 (admission parity), E1-E6.
Method: complete reads of all 15 audited files; the two largest
(`process-spawn.c` 5212 lines, `sqlite.c` 1082 + `codex-proxy.c` 526)
scanned exhaustively with every load-bearing claim spot-verified against
the source before inclusion (checks cited by line; claims marked).
Excluded per B2: thin syscall wrappers, EINTR-resume loops, errno
propagation, allocation hygiene.

Totals: process-spawn.c 105 (retry 7, timeout 1, filter 26, summary 18,
admission 12, env 1, identity 14, state 26); sqlite.c 51; codex-proxy.c
24; small files 19. Roughly 10 of 199 are exposed to Bend2 today; the
rest is hidden policy.

## A. Coordinator vocabulary in C (B2: moves to coordinator modules)

A1. `sqlite.c:13-83` - the entire `native_changes` projection in
`baton_change_schema[]`: summary literals (`'finding recorded'` L19,
`'knowledge item updated'` L21, `'finding removed'` L22, `'acknowledged'`
L45, `'turn report recorded/updated/removed'` L47-49,
`'session inserted/updated/deleted'` L32-34, `NEW.source || ' to ' ||
NEW.destination` L24-28, `phase || ' ' || status` L38-43), every trigger
WHEN-filter (L21,24,26,28,30,33,36,39,42,45,48,52,56,59), the CHECK
constraint and defaults (L14,16-18), the retention removal note (L15),
and the ALTER TABLE migrations (L68-76). Destination:
`bend2/src/coordinator/log-schema.bend` and a projection module beside
it compose the DDL text; `Sql.ensure_projection` already takes a
Bend-supplied schema string executed first, so the move is: delete
`baton_change_schema[]`, pass the whole text from Bend2. Byte-identical
text per A1/D3 of the adversarial review; the frozen-trigger comparison
(U2) pins it.

A2. `sqlite.c:340-397` `baton_json_pretty` and `:286-337`
`baton_ref_entry` - whitespace-only JSON pretty-printing and retained-JSON
ref handling as custom SQL functions, producing user-visible text.
Destination: `bend2/src/json/` (pure Bend2 on decoded rows). Keep SQL
functions only if a measured need survives the move.

A3. `process-spawn.c:866-908` checkpoint/wait failure summaries
("unusable observation checkpoint; replaying from the beginning", "exit
%d", "signal %d", "unavailable: native exit status was not retained");
`:1026-1027,1535-1536` observer-error notes; `:2774-2822` thirteen
admission refusal literals; `:2894-2897` lifecycle literals; `:4991`,
`:5044` observer-recovery details; `:4508-4518` begin-call detail with
owner-socket path interpolation. Destination: the wire codes stay host;
the sentences compose in the owning Bend2 wrapper
(`bend2/src/host/process.bend` mappers and `coordinator/` callers), as
the C `io_fail` falls back to `strerror(code)` when the text is NULL.

A4. `codex-proxy.c:419-423` "exit %d"/"signal %d" status composition;
`:315-385` refusal details ("Codex proxy closed during frame; incomplete
bytes: <hex>" and siblings). Destination: `bend2/src/harness/codex-player.bend`;
C returns numeric codes + hex bytes.

A5. `control.c:226` `{"deliveryPid":%ld,"state":"launched"}` JSON built
in C; `:230` the canned refusal "Native control setup failed; inspect
the registered session and retained input." replacing strerror. Destination:
`bend2/src/coordinator/control.bend` wrappers: C returns the pid number
and errno; Bend2 composes the JSON and the guidance text.

## B. Admission and command policy in C (B2/C1: moves to coordinator command modules)

B1. `native-entry.c:47-118` - the dispatch frontend: verb recognition
(`dispatch_verb`, `:80-82`), the 15-flag `contextual_dispatch_args`
allowlist (`:64-76`), project-argument position forms (`:83-87`), and
the two Node exec ladders (`settings_entry`, `dispatch_entry`). This is
command admission living in C1 territory. Destination: the coordinator
owns the `dispatch` verb like every other verb
(`bend2/src/coordinator/commands.bend`); the C entry reduces to
"find the installed helper, exec it". Lands with U6 (harness admission
move); the task-start.mjs strict reader and #716 database writes are the
parity surface.

B2. `control.c:64-76` `contextual_dispatch_args`-equivalent PATH search
with the `/usr/bin:/bin` default literal (`:170`); `:189` regular-file +
X_OK filter; `:193-199` output-name shaping (reject `.`/`..`/empty,
realpath directory, join base). Destination: PATH search and name shaping
are admission decisions -> `coordinator/control.bend` (Bend2 receives
`Files.kind`/`Files.executable` primitives added this branch); the
`/usr/bin:/bin` default is a Bend2 constant.

B3. `control.c:39-44` identity registry selection:
`BATON2_GIT_REGISTRY` override, else `$HOME/.config/baton/github-apps/
series.json`, existence-filtered. Destination: `harness/` identity module
reads environment through the standard get_env effect and `Files.exists`,
passing the resolved path to `Control.identity`.

B4. `process-spawn.c:1950-1957` admission reuses an attempt only on
field-by-field manifest equality; `:2533-2537` artifact-name grammar;
`:2813-2821` session-guard presentation matrix; `:2922-2957` lifecycle
start/cancel latch rules; `:3630-3637` fresh-attempt discard rule.
These encode the custody protocol. Destination: the rules become
`bend2/src/coordinator/custody` policy evaluated over records Bend2 can
read; C keeps socket/lock/file mechanics and returns structured refusals
(errno + record name). Phased with the host-protocol slice (E below);
until then each rule is named here as C-owned policy, not mechanism.

## C. Retry and waiting policy (B2: cadence moves to Bend2)

C1. `sqlite.c:111-115` `baton_sql_busy`: unbounded retry, fixed 10 ms
sleep, no cap, installed on every connection kind (`:126,:783,:1038`).
Destination: C drops the busy handler; `Sql.query` surfaces the busy
error and a Bend2 wrapper (`bend2/src/host/sqlite.bend`) reimplements
the exact observable behavior - retry without bound at the same cadence
- so coordinator-visible semantics are unchanged. Any change to the
unbounded character needs trio agreement (behavioral meaning).

C2. `process-spawn.c:3341-3384` owner connect loop (spawn-owner-once,
20 ms nanosleep re-reads); `:3437-3482,:3994-4011,:4067-4087` unbounded
ESTALE re-read loops; `:766-783` orphan/error cond wait remapping;
`:4250-4259` read_awake re-wait invariant; `:2359-2362` 100 ms recovery
reap cadence. Destination: C returns EAGAIN/ESTALE/EINTR-shaped
conditions; the owner-protocol module (`coordinator/custody`, slice E)
owns the loops and cadences. Phased; the numeric cadences are pinned
here so the Bend2 port preserves them.

## D. Identity and environment policy (B2 + E2 exceptions)

D1. `role-digest.c:1-107` - a full SHA-256 written in C for the role
identity digest; the effect carries zero IO. Destination: pure Bend2
SHA-256 module (`bend2/src/context/sha256.bend`); the CID_ROLE_GUARD_KEY
effect is deleted and `Sql.role_guard` callers compute the hex digest in
Bend2. First identity slice (small, law-friendly: test vectors).

D2. `process-spawn.c:1773-1779` FNV-1a attempt identity; `:1878-1889`
manifest digest field selection (skips the control-socket field);
`:1654-1658` /dev/urandom incarnation token; `:1663-1680` persisted
custody epoch with wrap-at-1. Destination: FNV-1a and the field
selection are pure Bend2; entropy moves to the standard random_u32
effect (paired C/JS in `compiler/upstream/effs/`); the epoch becomes a
one-row durable counter read/written through existing text/Sql effects.

D3. `control.c:28` dispatch log name `<database>.dispatch-<hex(id)>.out`;
`process-spawn.c:5097-5102` session lock path `.lock-` + hex session;
`:1614-1615` `owner-%llx-%llx` device/inode key. Destination: hex and
key composition in Bend2 (`coordinator/naming-laws.bend` territory);
C receives assembled paths.

D4. `sqlite.c:813-832` role-lock directory: `XDG_RUNTIME_DIR` ->
`/tmp/baton2-<euid>` fallback with owner/mode tightening;
`process-spawn.c:1584-1606` the same chain plus `$HOME/.local/state/
baton2` for IPC state. Destination: one Bend2 runtime-directory policy
(`bend2/src/host/runtime-dir.bend`) reading XDG_RUNTIME_DIR/HOME via the
standard get_env effect and passing the chosen directory into the
effects; C keeps the mkdir/lstat/chmod mechanics.

D5. Process environment inheritance: `process-spawn.c:161,:633`
`posix_spawnp(...,environ)`; `codex-proxy.c:272` same. Named gap by
rewrite-deepseek (drivers cannot set one child's env) and
rewrite-tooling (check-install must run children without BUN_OPTIONS).
Design agreed in the Orchestra: an env argument on the spawn family,
NUL-separated entries; `NAME=VALUE` sets/overrides, bare `NAME` removes,
empty inherits all. ABI addition owned here; lands next.

## E. Protocol state machines (largest slice; phased)

E1. `process-spawn.c` keeper/owner protocol: BR_*/BI_* frames, hello
classification (`:696-718`), readiness latch (`:1083-1086`), lifecycle
records BATONLC1/BATONAD1/BATONRP1/2/BATONC03/BATONIN1/BATONCUR1,
cursor/subscription policy (`:2227-2246`), custody-transition JSON
(`:3717-3745`), input-witness JSON (`:3905-3931`), notice JSON
(`:4301-4340`), host-ready state JSON (`:4423-4427`). The wire vocabulary
and record formats are coordinator policy in C. Destination:
`bend2/src/coordinator/custody` codecs (pattern: `context/codec-wire.bend`);
C keeps byte IO, locks, and process mechanics. This is the
smallest-justified-host-ABI end state for my role and is sequenced after
the entries/kind, env, digest, and runtime-dir slices above.

E2. `codex-proxy.c` RFC 6455 mechanics - SHA-1 Accept digest, /dev/
urandom masks and keys, frame masking, auto-pong (`:147-152,213-377`) -
remain host with a named platform requirement: they are wire-protocol
byte mechanics with no product decision inside (E2 exception). The
child selection argv `{"codex","app-server","proxy"}` (`:255-272`) and
the close->EPIPE mapping (`:124,396-417`) move: argv composition to
`harness/codex-player.bend` (`CodexProxy.open(argv)`), EPIPE surfaced as
a code Bend2 wraps.

E3. `raw.c` byte-offset read with BOM -> RFC 3629 -> NUL decision order
(header, `:1-9`) stays host: the runtime's `io_str` replacement makes
byte-exact validation and offset reporting unexpressible in Bend2 (named
E2 exception, fixtures pin the order). The validation order itself can
later compose from the standard file_read_bytes effect plus a pure Bend2
validator if the fixtures move with it; not scheduled.

## F. Small-file residuals

F1. `log-checkpoint.c:9-10` empty-text deletes the checkpoint.
Destination: `log-checkpoint.bend` caller decides (`Files.remove`
exists); C keeps mkstemp/fsync/rename only.

F2. `repl.c:13-15` `stdout`/`stdout.saved` layout names; `:48` "Retaining
the complete REPL stdout failed." Destination: paths passed from
`host/repl.bend`; sentence to the Bend2 caller (B3 pattern).

F3. `files.c:346` `qsort` of log segments. Destination: sort in Bend2;
`Files.segments` returns discovery order. Trivial, bundled with any
files.c touch.

F4. `text.c` NUL/EINVAL argument validation - canonical totals, stays.

## Ordering and gates

Dependency order: D1 (digest) and A1 (schema text from Bend2) are
independent first slices; D5 (env) unblocks the two tooling peers; B1
lands with U6 under C1 parity evidence; C1/E1 are the phased host-ABI
end state. Every landing needs the review gates: capacity evidence for
remote builds/tests, no coordinator law edits (C-law), byte-level
comparisons where a D3 frozen artifact exists (A1/D3 of the adversarial
review), and contract checks at each changed boundary (E3).
