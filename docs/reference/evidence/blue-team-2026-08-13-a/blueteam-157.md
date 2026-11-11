# BLUE-TEAM REPORT — row-bt157 (suite attack on the cli-wave-fidelity-red suite)

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt157]

- **Target:** `impl/test/cli-wave-fidelity-red.test.mjs` — the landed #157 red-first suite (16 rows).
- **Authority (the contract this suite exists to enforce):**
  `docs/reference/evidence/cli-wave-fidelity-2026-08-13/contract-fold.md` v1.1 (source of truth,
  red-first acceptance pins A7-1..A7-8) + `contract-redteam.md` (the attack surface),
  `contract-fold-brief.md`, `redteam-157-brief.md`,
  `contract-foundry-2026-08-13/foundry-brief.md` (the suite law). The suite header names these.
- **Attack HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` (this worktree's snapshot; the
  suite was authored against exactly this tree per `suite-draft-notes.md`).
- **Method:** attack the SUITE against the contract's intent, never re-review the contract.
  Per capability row: name the cheapest wrong implementation that turns the row green.
  Per PIN row: name the plausible wrong impl it kills. Split re-run twice from the repo root.
  Law re-check per the frame. Every claim grounded in the source at this HEAD.
- **Deliverable:** this file only (plus the `shared` publish, title "#157", recorded below).

---

## 1. Split re-run (twice, from the repo root)

```
node --test impl/test/cli-wave-fidelity-red.test.mjs
```

| Run | tests | pass | fail | result |
|---|---|---|---|---|
| Run 1 | 16 | 8 | 8 | **matches declared split** (8 RED / 8 PIN) |
| Run 2 | 16 | 8 | 8 | **matches declared split** (8 RED / 8 PIN) |

Stable across both runs — and re-verified on this final pass (fresh runs today, same tree):
16 tests / 8 pass / 8 fail, twice again. The 8 RED rows fail at exactly their named stages
(`cli-wave-verbs-missing` ×4 [A7-1/A7-2/A7-3/A7-7], `cli-wave-whitelist-missing` [A7-4],
`cli-wave-doc-row-missing` [A7-5], `ghost-prevention-pin-missing` [A7-6],
`interpreter-phase-null` [A7-8]) — each stage is the FIRST failing assertion in its row, and the
failure is the contract-mandated HEAD seam. The 8 PIN rows are green. **Instability: none.**

---

## 2. Capability rows (RED) — cheapest wrong impl per row

### A7-1 (parse — `waves send run:foo --message hi`) — **SHALLOW**

Cheapest wrong impl: a special-cased `waves send` branch in `parseBatonCli` that returns the
tested literal shape — `{ kind:'command', command:'waves.send', name:'waves.send', args:
{ runId: <argv[2]>, message: <--message value> }, idempotencyKey }` — without consuming the
registry schema (`application-semantics.mjs:1599-1613`), without the `id()` helper
(`application-cli.mjs:100-103`), and without `--claim-grant`/`--nudge`. The row's positive leg
asserts only the two arg fields + the two name fields; a value-level special case satisfies all
five assertions. The `id()` refusal (`cli_invalid`) and the closed-schema shape are never pinned
here — every id the suite feeds (`run:foo`, the 34-char fixture runIds) is a valid id, so an
under-validating parser is indistinguishable. Caught only in the cluster by A7-4/A7-7 (the wire
forces the parse to route), never by this row alone.

**Empirically confirmed (§2.9 M1):** adding a special-cased `waves send`/`waves stop` parse pair
(no `id()` validation, no `--claim-grant`, no `--nudge` take, no whitelist change) flips this row
green.

### A7-2 (parse — delivery `--now` + two-flag refusal) — **SHALLOW**

Cheapest wrong impl: handle exactly the two delivery modes the test exercises
(`--now` → `'now'`, `--turn` → `'turn'`) with a two-flag refusal, skipping the schema's third
enum member `--nudge` and the `--claim-grant` flag. The row asserts `args.delivery === 'now'`
and that two delivery flags throw `cli_action_inputs_invalid`; it never exercises `--nudge`, so a
mode-subset parser passes. The bounded-modes refusal (mirror of the `run send` idiom at
`application-cli.mjs:1733-1738`) is pinned; the full enum and the id refusal are not.

**Empirically confirmed (§2.9 M1):** the same parse-only pair flips this row green (the `--now`
leg and the two-flag refusal both parse correctly under the special case).

### A7-3 (parse — `waves stop run:foo --reason done` + missing-`--reason` refusal) — **SHALLOW**

Cheapest wrong impl: a special-cased `waves stop` branch returning the literal
`{ runId, reason }` shape with a bare presence-check on `--reason` that throws
`cli_action_inputs_invalid` when absent. Same shape-only character as A7-1 — no `id()`
validation, no schema consumption. The row does not pin the id refusal nor the `--claim-grant`
JSON-refusal family the contract's refusal vocabulary reserves for the new branches.

**Empirically confirmed (§2.9 M1):** the parse-only pair flips this row green.

### A7-4 (admit — `CLI_WEB_COMMANDS` contains waves.send AND waves.stop) — **SOUND**

The row asserts Set membership on the exported `CLI_WEB_COMMANDS`
(`application-cli.mjs:16-32`) directly. The only way to turn it green is to add the two names to
the whitelist — which IS the D1.2(2) admit seam. There is no cheaper wrong shortcut: the whitelist
is the object under test, and `.has()` cannot be faked from inside. The admit seam is the single
correct behavior and the row pins it exactly. **No cheap wrong impl found.**

**Empirically confirmed (§2.9 M2):** admit-only (adding the two names to the Set, no parse, no
doc) flips this row green and nothing else — the minimal pass is the whitelist edit itself, which
is the contract seam. A parse-only change (M1) leaves it red, so the row independently pins the
admit.

### A7-5 (doc — `--check` passes AND the committed CLI.md block contains both rows) — **SHALLOW**

Cheapest wrong impl: hardcode `'waves.send'`/`'waves.stop'` into `servedCliOrdinaryKeys()`
(`render-surface-docs.mjs:34-75`) so `renderCliVerbInventory()` emits the two rows, and
hand-edit the committed CLI.md cli-verb-inventory block to byte-match. `checkSurfaceDocs()`
compares the committed file to the freshly-rendered file byte-for-byte
(`render-surface-docs.mjs:143-149`); a hand-edit that matches the renderer is
indistinguishable from a regeneration, so all four assertions of the row pass without the
D1.2(2) whitelist admission. The row therefore does not pin #142's "regenerate, never
hand-edit" — only the cluster (A7-4, which this impl fails) blocks the whole-suite fake. Note
the `--check` drift gate IS real (green at HEAD, flips red if whitelist admits without doc
regen) — it catches a *divergent* hand-edit, not a *matching* one.

**Empirically confirmed (§2.9 M3):** hardcoding the two ghost rows into `servedCliOrdinaryKeys()`
and regenerating CLI.md (whitelist untouched) flips this row green — the doc row cannot
distinguish a matching hand-edit from a regeneration, and it never forces the whitelist admit.

### A7-6 (D3 closed-set — every cli-claiming `waves.*` op admitted + parsed + documented) — **SOUND** (one law deviation, noted)

The closed set is derived mechanically from `APPLICATION_SEMANTIC_REGISTRY.canonicalOperations`
filtered by `surfaces.includes('cli') && key.startsWith('waves.')` — never a hand list — and the
`closedSet.length >= 7` guard blocks the obvious registry-claim-removal shortcut (dropping
send/stop's `cli` claim would shrink the set to 5 and fail the row). To turn the row green the
impl must admit, parse, and document EVERY cli-claiming wave op, which is exactly the D3.3/D1
work. A per-op whitelist admission + doc regeneration + parse branch is the cheapest path and it
is the contract's own path. **No cheaper wrong impl than the contract-correct closed-set wiring.**

Deviation note (N6): the row's parse leg uses a **hand-arg table** —
`minimalWaveCliInvocation()` is a hand-written per-key `switch` — which is precisely what the
contract's N6 fold forbids ("never a hand-arg table; built mechanically from the registry
schema's required set"). Consequence: the parse leg tests fixed shapes (a new cli-claiming
`waves.*` op throws `no CLI minimal invocation pinned for <key>` instead of deriving its minimal
argv), and a subset parser covering exactly those fixed shapes passes. This is a suite-law
deviation and a scalability gap, not a current ghost: at HEAD the switch covers the full closed
set and the admit/doc legs carry the row's weight.

**Empirically confirmed (§2.9):** admit-only leaves this row red (the parse leg fails for send/stop);
only the full admit+parse+doc change set (M6) flips it green. The row therefore forces all three
legs for every cli-claiming wave op — no cheaper single-leg wrong impl passes it.

### A7-7 (dispatch leg — parsed names map through `replaceAll` into `WAVE_WEB_ENTRIES` and the full round-trip reaches the handlers) — **SHALLOW** (revised on empirical bite test)

The row requires (1) the parse to produce a `waves.send`/`waves.stop` name, (2)
`name.replaceAll('.', '_')` to land in the pre-existing `WAVE_WEB_ENTRIES`
(`web-northbound.mjs:40-41`), and (3) `runBatonCli` to reach the REAL handlers: the send leg must
reject with `application_worker_not_found` (only `sendWaveMember` at `application.mjs:11840-11893`
produces that post-dispatch code), and the stop leg must resolve ok through `stopWaveMember`
(`application.mjs:11895-11902`).

**But the round-trip never crosses the web whitelist gate.** The test's routing client
(`cliRoutingClient`, line 256-258) calls `host.application.command(name, args, principal)`
directly — the BatonApplication command bus — NOT `BatonWebClient.command`, which is where the
`CLI_WEB_COMMANDS` whitelist gate lives (`application-cli.mjs:2013`:
`if (!CLI_WEB_COMMANDS.has(name)) throw cliError(..., 'cli_command_unavailable')`). The row's own
stage note cites that gate as the seam the row is red at, but the fixture never exercises it.

**Empirically confirmed (§2.9 M1):** the parse-only special case (whitelist untouched — the
gate would still refuse `waves.send`/`waves.stop` for a real web client) flips this row GREEN.
The application-side handlers already exist at HEAD; the row is satisfiable by a partial D1 that
omits the admit. The admit seam is pinned only by A7-4's direct Set check; A7-7 cannot
distinguish "parse + admit" from "parse only". This is a **revised verdict: SHALLOW** (the fold
blocker list below names the fix).

### A7-8 (D2 — interpreter member renders phase/progressClass/attentionCount identical to a driver member at the same state) — **SHALLOW** (the suite's deciding finding)

The row pins **equality only, at one phase state**. Both the interpreter member (via the facade
`createWave` string-roster lane, `wave.mjs:180`) and the driver member are driven to
`awaiting_plan_approval` via `approve:false`, and the row asserts
`interpMember.phase === driverMember.phase`,
`interpMember.progressClass?.class ?? null === driverMember.progressClass?.class ?? null`,
`interpMember.attentionCount === driverMember.attentionCount`. The non-vacuity assertions prove
the DRIVER member is phase-bearing and the interpreter member is steering-registered — but
nothing proves the STRING branch READ the run.

Cheapest wrong impl (concretely reproduced at this HEAD, see §4): in the string branch of
`waveList` (`application.mjs:11776-11788`), render constants for any steering-registered member
instead of inspecting the run:

```js
phase: runId === null ? null : 'awaiting_plan_approval',
progressClass: runId === null ? null : { class: 'blocked_interaction:approve_plan' },
attentionCount: runId === null ? null : 0,
```

A live probe of the fixture at this HEAD shows the driver member renders
`phase: 'awaiting_plan_approval'`, `progressClass: { class: 'blocked_interaction:approve_plan',
silenceMs: 5, meaningfulEventAt: … }`, `attentionCount: 0` — so the three constants match the
driver's values exactly and the row goes green, while the branch never inspects the run. B-1 is
preserved (the constants are guarded by `runId !== null`, so run-less legacy members still render
the pinned no-run read). The contract's D2.3 law — "the projection must read them [the member
runs]" — is not enforced: an implementation that renders a stale default phase for every
registered member passes the entire D2 surface. This is the manufactured-confidence case the
blue-team exists to catch. Fix for the fold: drive the two members to **different** phase-bearing
states (e.g., approve the interpreter member's run and assert its rendered phase CHANGES with the
run state) so the read must be live, not a constant.

**Empirically confirmed (§2.9 M5):** an UNGUARDED hardcode in the string branch
(`phase: 'awaiting_plan_approval'`, `progressClass: { class: 'blocked_interaction:approve_plan',
silenceMs: 5, meaningfulEventAt: null }`, `attentionCount: 0`) flips this row green AND flips
**B-1 red** — the D2.4 no-run boundary pin bites the naive hardcode (run-less legacy members must
render nulls). The whole-suite fake therefore needs the `runId !== null` guard, which B-1 tolerates
(§4). The guard is the seam the fold must close: a live-read assertion (phase CHANGES when the run
state changes) cannot be satisfied by any constant, guarded or not.

---

## 2.9 Empirical bite-test record (all sixteen rows, mutations applied to a scratch copy of `impl/`)

Each mutation was applied to a pristine copy of `/tmp/bt157-impl`, run against the target suite,
then the file was restored. `→ GREEN` = the row flipped from RED to green under the mutation;
`→ RED` = the PIN flipped from green to failing.

| # | Mutation (the named wrong impl, minimally) | Row(s) observed | Result | Proves |
|---|---|---|---|---|
| M1 | Special-cased `waves send`/`waves stop` parse branches before the closed-set refusal (no `id()`, no `--claim-grant`, no whitelist change) | A7-1, A7-2, A7-3, A7-7 | **4 × → GREEN** | A7-1/2/3 SHALLOW; A7-7 SHALLOW (dispatch leg needs no admit) |
| M2 | Admit `'waves.send'`/`'waves.stop'` into `CLI_WEB_COMMANDS` only (no parse, no doc) | A7-4 | **→ GREEN** | A7-4 SOUND: the whitelist edit IS the contract seam; nothing cheaper passes |
| M3 | Hardcode the two ghost rows into `servedCliOrdinaryKeys()` + regenerate CLI.md (whitelist untouched) | A7-5 | **→ GREEN** | A7-5 SHALLOW: doc row pins renderer↔doc agreement, never the whitelist |
| M4 | Admit-only (same as M2), full suite | A7-6 | stays RED | A7-6's parse leg is independently required |
| M5 | Unguarded hardcode of the fixture's phase/progressClass/attentionCount in the string branch | A7-8, B-1 | A7-8 **→ GREEN**, **B-1 → RED** | A7-8 SHALLOW (parity-only); B-1 bites the unguarded hardcode |
| M6 | M1 + M2 + doc regeneration (the full D1 change set) | A7-6, A7-5 | **both → GREEN** | A7-6 SOUND: only the full admit+parse+doc set passes; no cheaper wrong impl |
| M7 | Loosened the B2 gate (malformed roster coerced, never refused) | B-2 | **→ RED** | B-2 bites gate-loosening |
| M8 | Broke the `waves list` parse branch | B-3 | **→ RED** | B-3 bites a closed-set rewrite that breaks the plural verb |
| M9 | Broke the `waves progress` parse branch | B-4 | **→ RED** | B-4 bites the same |
| M10 | Dropped `list` from the singular-corrective verb list | B-5 | **→ RED** | B-5 bites any corrective touch |
| M11 | Removed the bare-attach → `waves.list` coercion (`args.length === 0`) | B-6 | **→ RED** | B-6 bites the coercion removal |
| M12 | Broke `runBatonCli`'s command dispatch (returned `null`) | B-7 | **→ RED** | B-7 bites a pipeline break |
| M13 | Dropped `members` from the `waves.start` parse output | B-8 | **→ RED** | B-8 bites a `waves.start` branch break |

All eight PIN rows bite their named wrong impl; no pin is decorative. Two capability rows survive
every cheaper-wrong-impl attempt: A7-4 (the whitelist is the object under test) and A7-6 (the
three-leg closed-set conjunction — its cheapest pass is the contract change set itself).

---

## 3. PIN rows — what each kills (none decorative)

Each verdict is backed by the empirical bite test in §2.9 (the mutation named in parens flipped
the pin from green to failing).

| Row | Plausible wrong impl it kills | Verdict |
|---|---|---|
| **B-1** (A2-4 F6/F13) | An over-aggressive D2.3 that inspects/hydrates run-less string members (no steering record) — rendering non-null phase/progress/attention, a real `route`, or a `wave_not_found` refusal — breaks the pinned no-run read (`route:null, scope:null, liveness:'local', phase:null, progressClass:null, attentionCount:null`, no `error` key). The replay (store close/reopen) also kills an impl whose hydration depends on live-only state. | **bites** (M5) |
| **B-2** (A2-5) | An impl that loosens the B2 gate so a malformed NEW-shape roster (a string, not a string-array) is swept into the lenient legacy lane — the pin demands the store-integrity refusal `coordination_projection_poisoned` with cause `wave_registry_invalid` (`coordination-store.mjs:8099-8123`). | **bites** (M7) |
| **B-3** (A5-1) | A D1.2(3) closed-set rewrite that breaks the existing plural `waves list` parse (wrong name, args not `{}`). | **bites** (M8) |
| **B-4** (A5-2) | The same rewrite breaking `waves progress WAVE_ID` → `{ waveId }`. | **bites** (M9) |
| **B-5** (A5-3) | An impl that touches the singular `wave` corrective (`application-cli.mjs:1314-1322`) — e.g., changing the plural naming so the message no longer matches `/waves list/`, or "helpfully" rewriting it as part of the D1.2(3) message update. | **bites** (M10) |
| **B-6** (A5-4) | An impl that reorders the `waves` branch so a bare `waves attach` is treated as a waveId-taking invocation and refuses, instead of issuing the registry read `waves.list`. | **bites** (M11) |
| **B-7** (A5-5 F11) | An impl that breaks the parse→dispatch→render pipeline for the issued bare-attach `waves.list` shape (the rendered `{ waves: [...] }` must pass through `runBatonCli` unchanged and surface the attachable set). | **bites** (M12) |
| **B-8** (A6-6 F4) | An impl that breaks the `waves.start --members JSON` branch or changes the typed admission refusal — the pin demands the byte-identical message `wave member alpha did not start`, `cap: 1_048_576` (the `spill.body` substrate ceiling, `limits.mjs:85-86`), `role`, and `cause.code: 'spill_body_exceeded'`. | **bites** (M13) |

All eight PIN rows bite a named, plausible wrong impl. **No decorative PIN rows.**

---

## 4. Whole-suite wrong implementation (why the final verdict is NEEDS-FOLD)

The suite is passable by a wrong implementation that is the contract-correct D1 + D3 with a
**faked D2**. Concretely:

1. D1: add the two parse branches, admit `waves.send`/`waves.stop` to `CLI_WEB_COMMANDS`, regenerate
   docs. (D1 is forced, but not by the dispatch row: A7-7 is satisfiable by the parse branches alone
   — the admit is forced only by A7-4's direct Set check and A7-6's three-leg conjunction, and the
   doc regeneration only by A7-5's `--check` gate. See fold blocker 5.)
2. D2: in the string branch, render the three constants from §A7-8 (guarded by `runId !== null`)
   instead of inspecting the run.

Reproduced against this HEAD (probe in §A7-8 / §4 record below): the constants exactly match the
driver member's rendered values at the fixture's single phase state, so A7-8 passes; B-1 stays
green (the no-run branch is preserved — B-1 bites only the UNGUARDED hardcode, §2.9 M5); every
other row is unchanged. The suite therefore manufactures confidence that D2.3 is implemented when
the projection is in fact a stale constant.

**Per-row verdict summary:** A7-1 SHALLOW · A7-2 SHALLOW · A7-3 SHALLOW · A7-4 SOUND ·
A7-5 SHALLOW · A7-6 SOUND (N6 hand-arg-table deviation) · A7-7 SHALLOW (revised on M1) ·
A7-8 SHALLOW · B-1..B-8 all SOUND pins (bites, none decorative).

**Final verdict: NEEDS-FOLD**, named rows below.

### Numbered fold blockers (what · why · concrete fix)

1. **A7-8 does not force a live read (SHALLOW → the whole-suite fake).** The parity pin is
   equality-only at one phase state; a constant for that state passes while the string branch
   never inspects the run. **Fix:** drive the interpreter member and the driver member to
   DIFFERENT phase-bearing states and assert their projections still equal the respective runs —
   or, minimally, approve the interpreter member's run and assert its rendered
   phase/progressClass CHANGE to track the new run state (proving the projection reads the run,
   not a constant).
2. **A7-1/A7-2/A7-3 do not pin the new verbs' refusal vocabulary (SHALLOW).** The parse rows are
   shape-satisfiable by a special-cased branch; the contract's refusal family for the new
   branches (`cli_invalid` on a malformed runId via `id()`, `cli_action_inputs_invalid` on a
   non-JSON `--claim-grant`, the `--nudge` enum member) is never exercised. **Fix:** add one
   negative leg per verb — `waves send nope` → `cli_invalid` (id refusal) and a `--claim-grant`
   non-JSON refusal — so the parse must be schema-shaped, not shape-special-cased.
3. **A7-5 does not pin regeneration-vs-hand-edit (SHALLOW).** A byte-matching hand-edit + renderer
   hardcode passes the doc row without the whitelist admission (caught by A7-4 in the cluster,
   but the row itself is beatable). **Fix:** fold the admit+doc into one row assertion that the
   `--check` gate alone cannot satisfy — e.g., assert `renderCliVerbInventory()` equals the
   committed block slice (independently of the whitelist) so the renderer and the committed doc
   must both move together; the cluster's A7-4 then does the admit duty.
4. **A7-6 parse leg violates N6's "never a hand-arg table" (law deviation).** `minimalWaveCliInvocation()`
   is a hand-written per-key switch. **Fix:** derive each verb's minimal invocation from the
   registry schema's required set (as N6 directs) so a new cli-claiming op derives its argv
   instead of throwing `no CLI minimal invocation pinned for <key>`.
5. **A7-7 never crosses the web whitelist gate (SHALLOW, revised).** The round-trip's client is
   `cliRoutingClient` → `host.application.command(...)`, the BatonApplication command bus — the
   `CLI_WEB_COMMANDS` gate at `application-cli.mjs:2013` lives in `BatonWebClient.command`, which
   the fixture never constructs. A parse-only impl (whitelist untouched — the real web client would
   still refuse `waves.send`/`waves.stop`) flips the row green. **Fix:** route the round-trip
   through the real `BatonWebClient` (or bind its whitelist gate into the dispatch assertion) so
   "parse only" cannot pass — the admit seam would then be pinned twice (here and A7-4).

---

## 5. Law re-check (per the frame)

| Law | Result |
|---|---|
| Named stages on every capability row | ✅ each RED row's FIRST failing assertion names its stage (`cli-wave-verbs-missing`, `cli-wave-whitelist-missing`, `cli-wave-doc-row-missing`, `ghost-prevention-pin-missing`, `interpreter-phase-null`) |
| Hermetic fixtures (mkdtemp + after-cleanup, no network/provider) | ✅ `mkdtempSync` temp git repos + log dirs, `t.after` shutdown + `rmSync`; only local `git init/commit` and the local `render-surface-docs.mjs --check` subprocess; `MockAdapter` (no provider) |
| No clocks as controls | ✅ zero `new Date`/`Date.now`/`performance.now`/`setTimeout` in the suite; every assertion rides run/view shapes and driver events (the driver's `meaningfulEventAt` is compared by `.class` only, never by timestamp) |
| Namespace imports for invented surfaces | ✅ imports are real exports (`application-cli.mjs`, `application-semantics.mjs`, `index.mjs`, `adapter.mjs`, `render-surface-docs.mjs`) |
| Sorted-key literals ACTUAL order; `localeCompare` banned | ✅ no `.sort(`/`localeCompare` in the suite (`localeCompare` appears only in a comment) |
| `watchdog.stallMs` 60_000 + comment | ✅ N/A — the suite constructs no watchdog |
| No absolute line-window anchors | ✅ the only source read is `web-northbound.mjs`, marker-anchored (`indexOf('const WAVE_WEB_ENTRIES')` … `indexOf('const WAVE_ARG_FIELDS')`), never a fixed line window; all `file:line` strings are stage-message citations, not assertion anchors |
| Verbatim `[attempt: …]` line in the suite header | ✅ line 6 `[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]` |
| Split run twice, matches declared notes | ✅ 8 pass / 8 fail, stable ×2 (see §1) |

The suite complies with the frame. **Instability: none.**

---

## 6. Shared publish record (title "#157")

A `SCRATCHPAD_WRITE:` frame (`{ entry: { kind: 'note', text }, expectedFence: 'current',
idempotencyKey: 'bt-157-publish-v2' }`, keys sorted `entry,expectedFence,idempotencyKey`) is
emitted in this row's output stream, targeting the `shared` partition per the foundry frame
(title "#157"). The published note is the condensed faithful record (this report's split,
verdicts — including the revised A7-7 SHALLOW — and fold blockers) sized under the 2,048-byte
unsteered body cap so it lands whether or not this run is steering-registered. The frame is the
canonical emitted form; this durable file is the authoritative full text, and the coordinator's
fallback path reads it where the shared post is condensed. If the store rejects the frame
(envelope, cap, or fencing), that refusal is the coordinator's evidence — recorded here as:
frame emitted (idempotencyKey `bt-157-publish-v2`), direct store-write acknowledgment not
observable from this worktree.

**Deployment verification (this contract's pin):** executable `true`, args `[]`, cwd `.`, expected
exit 0 — exercised below.
