# Grok SC12 Audit — spawn/stop reconciliation (phase 10.1)

**Scope pinned to**: `spec/phase10.1/spawn-stop-reconciliation.md` and `impl/test/phase10.1-reconciliation.test.mjs` plus supporting evidence and implementation in this checkout only (no external sources).

**Goal**: Map SC12–SC20 to concrete tests, distinguish session product tier from legacy one-shot adapters, call out remaining coverage concerns.

## Session product tier vs legacy one-shot adapters (distinction)

The product surface is the **session tier**:
- `ClaudeSessionCli`, `CodexAppServerCli`, `GrokAcpCli` (and `GlmSessionCli` subclass of Claude).
- Exported from `impl/src/index.mjs:22-24` with explicit comment "SC2: the session tier IS the product surface".
- Full persistent session semantics: native `spawn`/`prompt`/`steer`/`interrupt`/`approve`/`kill` where supported; `onEvent` streaming over lifetime; one child process per worker that survives across turns (same PID across `turn_started`/`turn_completed` observed in claude-session.test.mjs, codex-appserver.test.mjs, grok-acp.test.mjs).
- Used by `Coordinator` for phase-10/10.1 capstone paths. Implements SC12 pending-spawn reservation + `signal` abort, wall timers (SC18), child reaping on setup failure (SC16), etc.
- Cards (pinned by SC8/SC19 in phase10-completion.test.mjs:413-415) declare 8 verbs with honest values (e.g. Grok steer='emulated', Codex approve/answer='native').

Legacy/one-shot adapters (explicitly not the product tier for phase-10 capstone):
- `CodexCli`, `ClaudeCli`, `ZCodeCli` (and older `CodexAdapter`/`ClaudeAdapter`/`GlmAdapter`/`MockAdapter` from adapter.mjs).
- Defined in `impl/src/cli-adapters.mjs` and `adapter.mjs`.
- One-shot `run(brief)` (or equivalent) model: fire-and-forget per turn; many verbs return `{ok:false, emulated:true}` or unsupported (see CARD_CASES in phase10-completion.test.mjs:409-412 defining ONE_SHOT_VERBS and LEGACY_VERBS with 4-8 keys but limited surface).
- No mid-flight steer/answer channel; `prompt` emulates as unsupported; interrupt/kill reduce to process signal (no confirmed two-phase for graceful case on pure one-shot).
- From `docs/handoff/evidence/phase10.1-adversarial-review.md:73-74`: "The legacy one-shot CLI tier is still explicitly fire-and-forget and is not used by the phase-10 capstone. SC12 applies to the full-session product adapters named by the goal."
- From `spec/phase10/system-completion.md` and `spec/RECONCILIATION.md`: one-shot kept for compatibility/tests; MockAdapter provides `run()` convenience only so Cluster-B tests continue; coordinator path uses session contract exclusively.
- Cards normalized under G10/SC8 but values correctly declare reduced capability (e.g. prompt='unsupported').

SC12–SC20 contracts and tests target the session product tier (the three CLIs looped in reconciliation tests and pinned in card assertions).

## SC12–SC20 mapping to concrete tests

All mappings grounded in file contents read from this checkout.

### SC12 — spawn is a reserved, cancellable lifecycle
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:14-36` (synchronous reservation before first await; duplicate spawn refuses; kill/interrupt during `worktreeReady` cancels without child; re-check after async boundaries; reaps late worktree).

Concrete tests in `impl/test/phase10.1-reconciliation.test.mjs`:
- Line 80: `test('SC12: kill while each session adapter awaits worktree readiness prevents child creation')` — loops over all three (Claude/Codex/Grok via makeAdapters); asserts ack.ok=false, no 'lifecycle.spawned', exactly one kill.confirmed.
- Line 98: `test('SC12: interrupt while each session adapter awaits worktree readiness prevents child creation')` — identical loop for interrupt; asserts control.interrupt_confirmed.
- Line 116: `test('SC12: same-worker spawn reservation is atomic across worktreeReady for every session adapter')` — duplicate spawns; exactly one ack.ok and one spawned event.
- Line 137: `test('SC12: stop before worktree readiness reaps the worktree after late creation')` — uses stubAdapter + custom worktrees; proves late-created worktree is removed and status='cancelled'.

Implementation sites (for traceability): `claude-session.mjs:71`, `codex-appserver.mjs:98`, `grok-acp.mjs:105` (all declare `_pendingSpawns`); `coordinator.mjs:232-236` (passes signal + worktreeReady); `coordinator.mjs:214-221` (late reap on stopping/dead/terminal).

### SC13 — terminal task state is monotonic across spawn refusal
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:38-52` (`cancelled` is terminal; `_onSpawnRefused` is no-op on stop/dead/terminal; no fabricated crashed after confirmed stop; genuine refusal appends exactly one `lifecycle.crashed{phase:'spawn'}` and replays to failed).

Concrete tests:
- `impl/test/phase10.1-reconciliation.test.mjs:160`: `test('SC13: spawn refusal racing a confirmed kill preserves cancelled and appends no crash')` — stubAdapter + kill first; status remains 'cancelled', zero crashes, replay also 'cancelled'.
- `impl/test/phase10.1-reconciliation.test.mjs:177`: `test('SC13: terminal state is monotonic at runtime and replay under late worker events')` — completes task, emits late crashed/turn/ask/approval/kill; both live and replay stay 'completed'.
- Supporting: `impl/test/phase10-completion.test.mjs:206` (SC1d test asserts durable crash on refusal).

Coordinator: `coordinator.mjs:43` (TERMINAL_TASK_STATUSES includes 'cancelled'), `coordinator.mjs:263-266` (_onSpawnRefused early returns), `coordinator.mjs:893-894` (late terminal events ignored).

### SC14 — queued delivery cannot cross a stop boundary
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:54-67` (deliver rejects unless worker+task live; stopping/idle/dead/terminal reject; adapter {ok:false} not logged success; queued loses to stop).

Concrete tests in phase10.1-reconciliation:
- Line 198: `test('SC14: queued send cannot cross a finalized interrupt and revive the task')` — A holds slot, B queues, interrupt, B gets ok:false, only A delivered, status=cancelled.
- Line 219: `test('SC14: queued send cannot cross a finalized kill and revive the task')` — identical for kill.
- Line 240: `test('SC14: adapter refusal is not logged as successful delivery')` — prompt returns {ok:false}; no 'control.send' in log.

Coordinator: `coordinator.mjs:412-418` (_deliver guards), `coordinator.mjs:440` (prompt after guards).

### SC15 — rejected spawn and refused spawn are one failure channel
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:69-74` (normalize throw + {ok:false} through `_onSpawnRefused`; produces durable crash unless stop owns terminal).

Concrete test:
- `impl/test/phase10.1-reconciliation.test.mjs:249`: `test('SC15: rejecting spawn becomes a durable failed task')` — stub throws; result='failed', exactly one `lifecycle.crashed{phase:'spawn'}`.

Coordinator: `coordinator.mjs:248-249` (catch path calls _onSpawnRefused), `coordinator.mjs:262` (shared handler).

### SC16 — failed setup owns child teardown
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:76-80` (Codex init/thread/turn/start fail must kill+remove before {ok:false}; Claude/Grok same for post-child setup).

Concrete test:
- `impl/test/phase10.1-reconciliation.test.mjs:258`: `test('SC16: Codex turn/start failure reaps the child before refusing spawn')` — uses FAKE_CODEX with FAKE_CODEX_TURN_START_FAIL; asserts spawned event has pid, then child gone (process.kill throws), ack.ok=false.

Related (setup refusal but without PID-reap assert): grok-acp.test.mjs:489 (GA3 hang on initialize), codex-appserver.test.mjs:428 (XA3).

Implementation: `codex-appserver.mjs` (turn/start error path), claude-session/grok use transport close + kill timers on failure.

### SC17 — story completion is derived from lifecycle facts
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:82-88` (crashed not rendered as done; clean exited counts as done; lastVerdict cleared on next turn_started; no active+done double-count).

Concrete tests (pure story folds):
- `impl/test/phase10.1-reconciliation.test.mjs:275`: `test('SC17: crash is not done; warning-bearing clean exit is done')` — crashed narrative has no "1 done"; clean exit with warning file_edit outside scope still "1 done".
- Line 289: `test('SC17: a new turn clears its predecessor verdict')` — turn_started after turn_completed+reverified clears lastVerdict and removes done count.
- Line 300: `test('SC17: a later process crash cannot inherit done from an earlier accepted verdict')`.

Source: `impl/src/story.mjs:127` (crashed flag), `story.mjs:329` (clear on turn_started), `renderNarrative` used in assertions.

### SC18 — session wall-time budgets are enforced
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:90-98` (positive timeoutMs arms timer on every session adapter; expiry emits one lifecycle.crashed{phase:'timeout'} and reaps; interrupt/kill/natural/refusal clears; no timer if absent).

Concrete tests:
- `impl/test/phase10.1-reconciliation.test.mjs:311`: `test('SC18: timeoutMs is enforced by every session adapter')` — loop over three adapters; spawn with 150ms; asserts exactly one timeout crash.
- Line 328: `test('SC18: confirmed interrupt clears each session wall timer')` — spawn with 180ms, interrupt, wait past deadline, no timeout event.

Implementation: claude-session.mjs:201 (setTimeout on >0), :405 (clear on interrupt), :502 (clear on close), :520 (_onWallTimeout emits phase:'timeout'); symmetric in codex-appserver.mjs and grok-acp.mjs (via shared patterns).

### SC19 — phase-10 claims are mutation-locked
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:100-104` (SC1d test must assert durable spawn crash event not only in-memory; SC8 must pin exact 8-verb maps for the three session adapters — value assertions).

Concrete coverage:
- `impl/test/phase10-completion.test.mjs:198` (`test('SC1d: a refused adapter spawn fails the task...')`): line 206 asserts `log.read(...).filter(... 'lifecycle.crashed' ... phase==='spawn').length === 1` ("SC19/C-1").
- `impl/test/phase10-completion.test.mjs:418-432` (SC8 loop): for 'ClaudeSessionCli (session)', 'CodexAppServerCli (session)', 'GrokAcpCli (session)' does `assert.deepEqual(card.verbs, expected, ...)` with exact maps (lines 413-415 define the pinned values).
- Adversarial review (`docs/handoff/evidence/phase10.1-adversarial-review.md:36-37`) records C-1 and C-2 closure via these.

Also: phase10-completion.test.mjs:423 comment and CARD_CASES distinguish the tiers while locking session values.

### SC20 — safety gate before recursive dogfooding
Spec: `spec/phase10.1/spawn-stop-reconciliation.md:106-110` (full zero-quota suite + fresh adversarial review MUST close SC12–SC19 with no unresolved critical/major before real-vendor capstone via createDriver()).

Evidence of closure (all in checkout):
- `docs/handoff/evidence/phase10.1-adversarial-review.md:82-85`: "Bare `node --test` is **427/427 passing**. SC12–SC19 have direct effect-level coverage, including PID reaping and restart replay. SC20's zero-quota safety gate is therefore **PASS**".
- `docs/handoff/evidence/phase10.1-reverification.md:47-49`: pre/post implementation counts; 16 tests in phase10.1 file after additions; full suite green.
- `impl/test/phase10.1-reconciliation.test.mjs:1-2` header ties directly to zero-quota diagnostic reproductions.
- No real-vendor spend before gate (capstone run.mjs:2 comments "must run only after SC20 passes").

## Remaining coverage concerns

1. **SC16 child-reap proof is Codex-only at PID level**. The explicit "spawned pid exists then process.kill(pid,0) throws after refusal" assertion (`phase10.1-reconciliation.test.mjs:267-270`) is present only for `FAKE_CODEX_TURN_START_FAIL`. ClaudeSessionCli and GrokAcpCli have initialize-hang refusal tests (claude-session.test / grok-acp.test GA3/XA3) that prove {ok:false} within timeout, and all three adapters emit 'lifecycle.spawned' before failure paths, but no equivalent post-child PID-reap assertion exists for Claude/Grok setup failures (e.g. after session/new or first prompt dispatch) inside the reconciliation suite. Spec claims "Claude and Grok carry the same invariant". Covered at effect level (refusal) but not the precise reaping effect for all three.

2. **SC12–SC18 coordinator-level races use stubs; adapter-level uses fakes**. The late-worktree-reap (SC12), queued-delivery (SC14), and monotonicity (SC13) coordinator behaviors are proven with `stubAdapter`; the three real session adapters are exercised only for the spawn-reservation + timeout paths. No integration test in this file drives the full Coordinator + real Claude/Codex/Grok CLI fakes through a kill-during-worktreeReady + queued-send race. (Other tests like coordinator.test.mjs use stubs.)

3. **SC18 timer only tested on positive timeout and interrupt clear; natural exit / spawn refusal / replacement paths asserted only by spec prose and clear logic in sources, not by a dedicated regression asserting "no timer invented when absent" or "timer cleared on refusal".** The "no timer when absent" is implicitly true in the spawn-without-timeoutMs paths of the existing tests, but no explicit "timer count remains zero" observation.

4. **Replay coverage for SC13/SC17 is strong in phase10.1 but coordinator restart re-attach to live vendor sessions is explicitly out of scope** (phase10.1-adversarial-review.md:77-78 and spec boundaries).

All other SC12–SC19 obligations have direct, named, passing assertions. Full suite was green at gate (427/427). No critical/major findings listed as open after adversarial review.

## Verification basis
- Every claim above cites exact test names, line ranges, or doc paragraphs from files present in the checkout.
- Commands used: only local `read_file` + `grep` (no network).
- Edits limited to the target path per constraints.

SC20 gate is satisfied for the purposes of the pinned verification; real-vendor dogfooding is fenced behind this artifact.