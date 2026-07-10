# Phase 8 — Cross-Cluster Reconciliation (binding)

*Reconciles the three phase-8 spec+test clusters — `gate-and-control-correctness.md` (C1–C7),
`claude-session-adapter.md` (CS1–CS19), `codex-appserver-adapter.md` (XA1–XA20) — against each
other and against the standing contracts (`spec/RECONCILIATION.md` D1–D11, `spec/adapter-contract.md`,
`src/adapter.mjs`, `src/coordinator.mjs`, `src/index.mjs`). Same authority rule as the root doc:
where this doc and a cluster spec disagree, **this doc wins**. Resolutions are numbered R1–R12.
Where a test/fixture file had to be edited to conform, the edit was made as part of this
reconciliation pass and is noted inline.*

Verified suite state after this pass (bare `node --test` from `impl/`, node 25):
**294 test entries, 275 pass, 19 fail.** The 275 = the 273 pre-existing tests (all still green,
zero supersessions needed) + the 2 fixture files now reported as inert passes (see R1). The 19
RED = the 17 `phase8-correctness.test.mjs` tests (each failing on its intended missing-feature
assertion, verified individually) + the 2 session-adapter test files (both
`ERR_MODULE_NOT_FOUND` on `src/claude-session.mjs` / `src/codex-appserver.mjs` — the correct
TDD-red reason).

---

## R1 — Bare `node --test` hung on the session clusters' fixtures (EDITED)

**Conflict.** Both session clusters ship executable fixtures under `test/fixtures/`
(`fake-claude.mjs`, `fake-codex-appserver.mjs`). Node 25's recursive discovery executes **every**
`.mjs` under `test/` as a test file; both fixtures immediately open a `readline` on stdin and
block forever, so a bare `node --test` — which all three specs require to be runnable — never
terminated (empirically confirmed: the run had to be killed; the correctness cluster's own open
question flagged the symptom but misattributed it to the missing `src/` modules; a missing import
is a fast RED, the hang was the fixtures themselves being *run*).

**Resolution.** Fixtures carry an argv sentinel guard and exit `0` inert when not spawned by
their adapter:
- `test/fixtures/fake-claude.mjs` (**edited**): serves only when argv contains `--input-format`
  (which CS1 obliges the real `ClaudeSessionCli` to always pass) or the manual escape hatch
  `--serve`. Side benefit: the fixture now *enforces* CS1's argv contract over the real spawn
  path — an implementation that forgets the flag gets a dead child and failing tests.
- `test/fixtures/fake-codex-appserver.mjs` (**edited**): serves only when argv contains
  `--serve` or `app-server` (mirroring the real default args `['app-server']`).
- `test/codex-appserver.test.mjs` (**edited**, one line): `makeAdapter` now passes
  `args: [FIXTURE, '--serve']` — the codex argv, unlike Claude's, otherwise carries no
  distinguishing flag. This is a one-word amendment to XA4's "tests point `args` at the fixture"
  sentence; the future adapter passes constructor `args` verbatim, so no implementation impact.

Under discovery, both fixtures now report as trivially-passing empty test files (hence 275, not
273, passes).

## R2 — fake-codex threadId collision would falsely fail XA1 (EDITED)

**Conflict.** XA1 pins one child process per worker, and its test asserts two workers' threadIds
are **unequal** — but the fixture minted `thread-${threadSeq}` from a per-process counter, so
both children would mint `thread-1` and the assertion would fail *against a fully correct
implementation*. A fixture bug, not an adapter contract issue.

**Resolution.** `test/fixtures/fake-codex-appserver.mjs` (**edited**): threadIds are now
pid-namespaced (`thread-${process.pid}-${threadSeq}`). Turn ids stay per-process (`turn-N`) —
they are only ever compared within one worker's stream, and the adapter demuxes on
`(threadId, turnId)` per §3 anyway.

## R3 — `card().verbs` key vocabulary diverges across the two session adapters

**Conflict.** Claude's card (§5) declares `{spawn, prompt, steer, interrupt, approve, answer,
kill}` — no `pause`. Codex's card (XA14) declares `{spawn, prompt, steer, interrupt, approve,
answer, pause}` — no `kill`. The legacy adapters (`MockAdapter`, `cli-adapters.mjs`,
`adapter.mjs` stubs) use a third vocabulary (`ask`, no `prompt`/`approve`/`answer`/`kill`).
Nothing in the coordinator consumes `verbs` yet, so nothing breaks — but capability negotiation
is the whole point of the card, and three vocabularies make it unreadable.

**Resolution.** The canonical card verb-key set is pinned to the D1 verb surface plus the D11
pause pin: **`{spawn, prompt, steer, interrupt, approve, answer, kill, pause}`** — all eight
keys, always present, each `native|emulated|unsupported`. Implementation phase:
- `src/claude-session.mjs` adds `pause: 'unsupported'` (no Claude test asserts pause; additive).
- `src/codex-appserver.mjs` adds `kill: 'native'` and `answer: 'native'` explicitly (no codex
  test asserts kill; XA14's listing simply gains the key; additive).
- Legacy adapters' `ask` key is **deprecated**, migrated in a later cleanup (NOT this phase —
  `adapter.test.mjs`/`cli-adapters.test.mjs` pin the current shapes and must not be churned by
  phase 8). No test edits required.

## R4 — requestId scoping: Claude's raw wire ids collide across workers; Codex mints opaque ids

**Conflict.** Codex (XA9/XA13) deliberately mints an **adapter-opaque requestId** per
approval/question, precisely because the coordinator's single-consumer `_pending` map is keyed
globally by requestId. Claude (CS12/CS13) pins `requestId` = the raw wire `request_id` /
`elicitation_id`. The fake claude mints deterministic per-process ids (`freq_1`, `freq_2` …), so
**two Claude workers under one coordinator produce colliding `approval.requested` requestIds**,
and `coordinator._pending.set(requestId, …)` silently overwrites one worker's pending approval
with another's. (The real CLI's random base36 ids make collision unlikely, not impossible; the
fake makes it certain.)

**Resolution.** Amends CS12/CS13: `requestId` on `approval.requested`/`question.asked` payloads
must be **unique across workers within one adapter instance** — mint or namespace (e.g.
`${worker}:${wireRequestId}`), keeping the raw wire id internal for constructing the
`control_response`. This matches Codex's (correct) design; the Claude tests treat requestId as
an opaque round-trip token and never assert its value equals the wire id, so **no test edits are
required**. The coordinator's global keying is unchanged.

## R5 — Post-stop resurrection: steer emulation (CS8) and `interrupt(then)` (XA8) vs D9 finalize

**Conflict.** Both adapters can autonomously start a **new turn after a confirmed stop**:
Claude's steer = interrupt → await confirm → reprompt; Codex's `interrupt(worker, then)` =
interrupt → await confirm → auto `turn/start` with `then`. Under the coordinator, D9's
`_finalizeStop` marks the task `cancelled` and the worker `idle` the moment the confirm arrives;
an adapter-initiated follow-up turn then emits `lifecycle.turn_completed` on an `idle` worker,
which **re-enters the trust gate and can flip a cancelled task to `completed`**. Worse for
Claude: the steer emulation emits `control.interrupt_requested`/`control.interrupt_confirmed`
onto the shared event stream (CS8's test asserts exactly this), and a coordinator-level
`interrupt()` racing an in-flight steer could be **falsely confirmed** by the steer's internal
confirm — after which the steer's reprompt resurrects the worker the coordinator just stopped.

**Resolution** (binding on the green implementations; no test conflicts):
1. Both adapters must **abandon any pending auto-follow-up** (steer reprompt, `then` turn) if a
   subsequent `interrupt()` or `kill()` verb call for that worker arrives before the follow-up
   is issued. Adapter-internal guard; CS8/XA8's tests never interleave a competing stop, so they
   stay green.
2. The coordinator's existing behavior — an unmatched `control.interrupt_confirmed` (no stop
   waiter) is **swallowed and not logged** (`_onStopConfirmed` early-return; the `case` never
   falls through to the default append) — is **pinned as correct**, not a gap: logging it would
   make D10 replay derive `cancelled` for a worker that was merely steered. Do not "fix" this
   into a passthrough.
3. When a steer's internal confirm *does* match a genuinely pending coordinator stop waiter,
   treating it as that stop's confirmation is correct (the turn genuinely stopped); with (1) in
   place no resurrection follows.

## R6 — `lifecycle.spawned` asymmetry and adapter/coordinator event duplication

**Conflict.** Claude emits `lifecycle.spawned` (wire `session_id`, pid — CS3); Codex's event
table (§3) emits none. Separately, both adapters self-emit kinds the coordinator *also* logs on
its own authority (`kill.requested`, `approval.resolved`, `question.answered`, and for Claude
`lifecycle.spawned` duplicating the coordinator's dispatch-time `lifecycle.spawned`), so those
kinds appear twice in the log with different actors.

**Resolution.**
1. Codex must gain parity: emit `lifecycle.spawned` with `{threadId, pid}` once `thread/start`
   resolves (log-is-truth for the wire's own session identifier, matching CS3's rationale).
   Additive — no codex test asserts its absence, and all `until()` predicates tolerate extra
   events.
2. The duplication is **pinned acceptable**: the orchestrator-actor copy is the coordinator's
   command record; the worker-actor copy is the wire's own testimony. Verified harmless against
   `coordinator._replay()`'s switch (a second `lifecycle.spawned` without `taskId` leaves state
   unchanged; `approval.resolved`/`question.answered` duplicates are idempotent on the
   `input_required → working` transition). This is the same pattern `MockAdapter` already
   exhibits today under `coordinator.test.mjs`.

## R7 — C3's new EventKind `control.delivery_amended`: where it must land

**Conflict.** C3 amends D3's closed vocabulary (the only new kind string in phase 8). Three
consumers of that vocabulary exist; only one was named by the cluster.

**Resolution.** The amendment is accepted; on implementation it must touch, in order:
1. `spec/RECONCILIATION.md` D3 table — add `control.delivery_amended` to the `control.*` lane
   (the cluster already flags this).
2. `src/story.mjs` `KIND` map — add `DELIVERY_AMENDED: 'control.delivery_amended'`. Without it
   the story fold demotes the event to `unknown.passthrough` (non-crashing per D3, but the whole
   point of the kind is to be loudly visible; passthrough is the opposite of loud).
3. `src/coordinator.mjs` `_replay()` — **no change**: verified the switch's `default` ignores the
   kind, which is correct (an amended delivery has no bearing on rebuilt task state).
Also verified: `send()`'s new optional 4th parameter lives entirely on the **coordinator**
surface; neither session adapter's `prompt()` signature is affected, and no session-cluster test
calls `coordinator.send()` at all. No cross-cluster edits.

## R8 — `verify.reverified` payload growth (C1 `acceptOpts`, C5 `capture`) composes cleanly

**Checked, no conflict — pinned so it stays that way.** The coordinator-logged payload becomes
`{verdict, accept, acceptOpts, capture}`. Verified: (a) `_replay()` reads only `payload.accept`
and `payload.verdict`; (b) no existing test deep-equals the coordinator's `verify.reverified`
payload (grep-verified across `coordinator.test.mjs`/`e2e.test.mjs`/`story.test.mjs` — they
assert kind presence and `payload.accept`/index ordering only); (c) `referee.mjs`'s own optional
`opts.log` emission logs the **bare verdict** as payload — a pre-existing, different shape that
the live driver path never exercises (`index.mjs`'s `refereeFn` passes no `log`). Pinned: the
coordinator's `{verdict, accept, acceptOpts, capture}` shape is the canonical one for
coordinator-logged `verify.reverified`; the referee's direct-log shape remains unit-test-only
and must not be conflated with it.

## R9 — Two brief renderers across the two session adapters

**Checked, tolerated.** Claude (CS2) reuses `renderPrompt()` from `cli-adapters.mjs`; Codex
(XA6) reuses `renderBrief(brief, 'codex-v2')` from `adapter.mjs`. Both are pre-existing exports,
both embed the pinned verification command (the D2 property that matters), and D2 explicitly
allows per-harness `briefTemplate` dialects. Pinned acceptable for phase 8; converging on one
renderer with a dialect parameter is a later cleanup, not a phase-8 requirement. (The claude
test asserts the brief's *goal* is echoed off the wire, which both renderers satisfy.)

## R10 — Timeout/gate knobs across cluster boundaries (three wiring obligations for `index.mjs`)

**Conflict (latent).** C4 injects `setTimeout`/`clearTimeout` into the **Coordinator**; XA3
gives the codex adapter its own required `requestTimeoutMs | stopDeadlineMs`; C1 plumbs the real
`referee.accept` into the coordinator while `index.mjs`'s `refereeFn` *also* calls
`accept(verdict)` (discarding the result). Three knobs, three owners, one assembly point.

**Resolution** (binding on the green/assembly phase):
1. Coordinator-injected timers do **not** propagate into adapters. Adapters own their own real
   timers (XA3's per-request deadline, CS14's `killGraceMs`); C4's injection is for the
   coordinator's stop-deadline only. No shared fake-clock across the boundary.
2. When `index.mjs`/`createDriver` eventually constructs a `CodexAppServerCli`, it **must** pass
   its own `stopDeadlineMs` through (resolving the codex cluster's open question 5: yes — the
   two deadlines are provably the same knob).
3. Once C1 lands, `refereeFn` in `index.mjs` must **drop** its side-effect-free
   `.then((verdict) => { accept(verdict); return verdict; })` call — otherwise `accept` runs
   twice per gate with *different* opts (bare vs `acceptOpts`), and the single-authority story
   D4/C1 exists to tell gets muddied. Not test-visible; correctness-of-narrative.

## R11 — `lifecycle.turn_completed` payload variance vs the coordinator's unwrap

**Checked, pinned.** Claude wraps `{result, pid}` (CS5/§4b); Codex wraps
`{result, threadId, turnId}` (§3). `coordinator._handleEvent`'s normalization
(`payload.result !== undefined && payload.status === undefined → unwrap`) handles both, and the
referee tolerates `makeResult()`'s `verification.claimedExit: null` (`hadClaim:false`, no
divergence flag). Pinned as a rule so future adapters can't drift: session adapters MUST emit
turn-completed payloads as `{result, ...metadata}` and MUST NOT place a top-level `status` key
on the payload (that key is the wrapper/naked discriminator). The metadata fields (`pid`,
`threadId`, `turnId`) are intentionally dropped from the logged *claim* (the coordinator logs
the unwrapped WorkerResult); they remain visible on the live event stream, which is where the
session tests assert them.

## R12 — Existing-test maintenance queue (adopted, deliberately NOT edited now)

The correctness cluster flagged three existing tests its contracts put pressure on. Adopted as
**binding green-phase edits**, and deliberately not made now because all three tests pass today
and pre-editing them would create false REDs (violating the "273 still pass" bar):
1. `coordinator.test.mjs` `core#7` (line ~387): assertions survive C4; its title/comment
   ("no background timer thread") becomes false prose once the real timer lands — reword to
   "the sweep path works redundantly alongside the real timer".
2. `coordinator.test.mjs` "same-tick interrupt racing an in-flight send()" (line ~490): after
   C3, additionally assert `kinds.includes('control.delivery_amended')`.
3. `e2e.test.mjs` `makeRealRepo()` (line ~73): the manual `.git/info/exclude` write becomes
   redundant after C6 — remove as cleanup (harmless if left; `ensureBatonExcluded` is
   idempotent against it).
Plus the C7 note: when `setupSystem()` is retired for `createDriver()`, the 8 e2e assertions
enumerated in `gate-and-control-correctness.md` §C7 are the acceptance bar. Note the e2e
hand-wired `capture(worktreePath)` wrapper drops C5's new `opts` argument — fine until
retirement (e2e asserts no attribution), and one more reason to retire it.

---

## Suite status (verified this pass)

| Bucket | Result |
|---|---|
| Pre-existing 273 tests | **all pass** — no phase-8 contract supersedes any existing test's assertions (C1/C3/C4/C5/C6 defaults are behavior-preserving by construction; verified empirically) |
| `test/fixtures/*` under discovery | 2 inert passes (R1 guard) — total reported passes 275 |
| `test/phase8-correctness.test.mjs` | 17/17 RED, each on its intended missing-feature assertion (injected `accept` ignored; `acceptOpts`/`capture` payload fields absent; `router.pick` never called; `expectedFence`/`control.delivery_amended` absent; no deadline timer armed/cleared; vendor never threaded to `captureCommit`; `ensureBatonExcluded` missing export → `TypeError` inside the calling tests only; C7.a times out because `pinBaseSha` throws `DirtyRepoError` on the un-excluded `.baton/` seed — the C6 axis, live end-to-end) |
| `test/claude-session.test.mjs` | RED: `ERR_MODULE_NOT_FOUND src/claude-session.mjs` (correct TDD-red reason) |
| `test/codex-appserver.test.mjs` | RED: `ERR_MODULE_NOT_FOUND src/codex-appserver.mjs` (correct TDD-red reason) |

## Ordered implementation plan (dependency direction: leaves → assembly)

1. **Docs**: apply R7.1 (`spec/RECONCILIATION.md` D3 gains `control.delivery_amended`) and the
   C6 D7 addendum (`ensureBatonExcluded` in the export list). Doc-only, unblocks review.
2. **`src/worktree.mjs`** (leaf, no deps): `ensureBatonExcluded()` export + `pinBaseSha` calls it
   before `isClean` (C6). Greens C6.a–c; unblocks C7.a's dispatch path.
3. **`src/coordinator.mjs`**: C1 (`opts.accept`/`opts.acceptOpts`, default-accept function,
   `verify.reverified` payload `accept`+`acceptOpts`), C5 (`capture(path, {vendor})` +
   `capture` payload field), C3 (`send(…, opts.expectedFence)` pre-check +
   `control.delivery_amended` post-check event), C4 (`opts.setTimeout`/`opts.clearTimeout`,
   armed/unref'd/cleared per-waiter timer; keep `_sweepDeadlines`). Greens C1.a–c, C3.a–b,
   C4.a–b and the coordinator half of C5.
4. **`src/index.mjs`**: C2 (`route` = ceiling filter → real `router.pick` over
   `family:'default'` candidates → modelVersion→vendor map, no first-fit fallback), C1 plumbing
   (`requireRedGreen`/`requireCoverage` → `accept`/`acceptOpts`), C5 capture-wrapper threading,
   R10.3 (`refereeFn` drops its bare `accept()` call). Greens C2.a–b, C5.a–b, C7.a–c.
5. **`src/story.mjs`**: R7.2 KIND map addition (small; anytime after step 3).
6. **`src/claude-session.mjs`** against `claude-session.test.mjs` + the edited `fake-claude.mjs`,
   honoring R3 (add `pause:'unsupported'`), R4 (adapter-unique requestIds), R5.1 (abandon steer
   reprompt on subsequent stop), R11 (payload wrapping). Greens 20 tests.
7. **`src/codex-appserver.mjs`** against `codex-appserver.test.mjs` + the edited fixture,
   honoring R3 (add `kill:'native'`), R5.1 (abandon `then` follow-up on subsequent stop), R6.1
   (emit `lifecycle.spawned`), R11. Greens 24 tests. (Steps 6 and 7 are independent of each
   other and of steps 2–5; they touch no shared file.)
8. **Test maintenance** (R12): core#7 reword, same-tick test's `control.delivery_amended`
   assertion, e2e exclude-line cleanup. Then, in a later phase, retire `setupSystem()` for
   `createDriver()` (C7's 8-assertion acceptance bar) and wire the session adapters + R10.2
   `stopDeadlineMs` pass-through into `createDriver`/`CLI_ADAPTERS`.
