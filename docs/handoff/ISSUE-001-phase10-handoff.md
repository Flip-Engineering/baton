# ISSUE-001 — Phase-10 handoff (RESERVED for Fable 5 / GPT-5.6 Sol xHigh)

> **Status:** OPEN · **Owner-tier:** high-capability model only (Fable 5, or GPT-5.6 Sol xHigh) ·
> **Opened:** 2026-07-10 by Fable 5 · **Reason for handoff:** Fable 5 hit its usage-credit ceiling
> **mid-review**. This is a local-repo issue (no GitHub remote) committed to version control so the
> entirety of the design intent, current state, and next steps survive the model switch.
>
> **Read this top-to-bottom before touching code.** The phase-10 change is committed and green
> (411/411), but its adversarial review is **incomplete** and surfaced a cluster of **critical,
> unverified** concurrency findings that must be re-verified and fixed **before** the live capstone
> (which spends real quota and, per the findings below, could spawn genuinely unkillable orphan CLI
> processes). Do not run the live capstone until §5 is resolved.

---

## 0. How to use this document

- §1–2 orient you on what baton is and the pinned goal (skip if you already know it).
- §3–4 are the current state: exactly what landed and where the line is.
- **§5 is the load-bearing section** — the incomplete review, with every finding's full body
  (claim / scenario / evidence) preserved, classified by verification status.
- §6 answers the operator's "researched-vs-shipped gap" question (docs/25 sweep).
- §7 is the ordered next-step plan.
- §8 indexes the raw evidence committed alongside this doc.

Everything cited as `file:line` refers to commit **`b85c58d`** unless noted. The raw JSON behind
every claim is in `docs/handoff/evidence/` (§8) — trust it over any paraphrase here.

---

## 1. What baton is (design + intent)

**baton** (`~/Development/Experiments/baton`) is a **deterministic coordinator that drives vendor
CLI coding agents as full-session workers**. The vendor harnesses — Claude Code (stream-json),
Codex (app-server JSON-RPC, no `jsonrpc` member), Grok (ACP JSON-RPC 2.0, with `jsonrpc`), and GLM
(Claude Code pointed at Z.ai's Anthropic-compatible endpoint) — are non-deterministic model agents.
baton itself is deterministic, dependency-free code that:

- **spawns** each worker in an isolated git **worktree**, drives it through a fixed **8-verb
  adapter contract** (spawn/prompt/steer/interrupt/approve/answer/kill/pause), and mediates every
  control op through **fencing tokens** (`fence.mjs`) so a stale command is rejected, never applied;
- treats an **append-only JSONL log as the single source of truth** — all coordinator and story
  state is a pure fold/`_replay()` over that log (event-sourced);
- runs a **trust gate**: when a worker claims completion, baton re-runs the brief's **pinned
  verification command in a fresh throwaway worktree** at the worker's commit — the worker's own
  claim is never trusted (`referee.mjs` verify+accept);
- compiles a **story** (`story.mjs`) — a pure fold producing a human narrative + attention signals
  (stalled / looping / over-budget / out-of-scope);
- routes via an **AdaptiveRouter** (`router.mjs`) that learns only from **verified** outcomes.

**The design thesis (docs/19): the fleet driver IS the product.** A capability that exists only in
an adapter unit test but is unreachable through `createDriver()` is not shipped. The recurring
failure mode the audits named is **built-not-wired**: unit-green modules never plumbed into the
shipped path. Phase 10's entire job was to close those seams.

**Implementation note (important for scoping your effort):** `impl/` is the **reference
implementation / executable spec**, written in dependency-free Node ESM (`.mjs`, `node:test`,
node 25). The user's standing intent is that **"actual baton" be built in Go or Elixir** — so the
durable, portable assets are the **numbered contracts** (D*/R*/X*/CS*/XA*/GA*/SC*), the
**wire-faithful fake binaries** (`impl/test/fixtures/fake-*.mjs`), and the **committed live-evidence
JSONL** (`docs/reference/evidence/`). A production port re-implements the same contracts against the
same fakes/evidence. Prefer strengthening contracts/fakes/evidence over JS-only polish.

### The core methodology (non-negotiable, earned by incident)

1. **No quick wins.** "There is no such thing as a 'quick win' — that's called task avoidance." Every
   change runs the full loop: **spec contract → red test (fails for the stated reason) → implement →
   green → adversarial review → live proof.**
2. **Numbered contracts, spec-first.** Tests cite contract IDs. A claim that cannot be cited is a
   vibe, not a contract. Corrections land as **errata by contract ID — never silent rewrites**.
3. **Live-smoke gate.** Every verb a card declares `native` must be proven against the **real**
   binary; live findings correct the fake; the corrected fake re-locks the adapter. Live facts decay
   as vendor CLIs update → a standing re-smoke cadence is owed (task #24).
4. **Verify before re-work.** Phases 8–9 already closed an unknown subset of the audit; phase B
   re-derived every gap against HEAD before writing spec. **Apply this to §5: re-verify before you
   fix.**
5. **Evidence ledger.** Raw JSONL of every probe/review is committed. Claims decay; captures don't.
6. **Credentials by presence only** — never printed, logged, or committed.
7. **No arbitrary numeric limits** unless derived from a physical resource; failing tests are
   resolved, never waved off as "pre-existing" (CLAUDE.md house rules).

---

## 2. The pinned goal + standing constraints

**Goal (docs/24-goal-system-completion.md), verbatim:**

> Every subsystem baton has built is wired, gated, and live-proven — no built-not-wired gaps —
> culminating in a coordinator-driven fleet of real vendor session workers (Claude, Codex, Grok;
> GLM credentials permitting) that can be spawned, steered mid-turn, interrupted, approved, and
> trust-gated end-to-end through `createDriver()`.

"Completion" is a **wiring property, not a feature count.** Plan: **A** proposal (done) → **B** gap
verification (done) → **C** spec + red (done) → **D** implement to green (done) → **E** adversarial
review (**INCOMPLETE — this handoff**) → **F** live capstone (**BLOCKED on E**).

**Standing constraints (still in force, verbatim where quoted):**

- **Quota posture (2026-07-10):** grok and codex are **cheap for the operator right now** — live
  probing/capstones may lean on those two. **Claude live turns still spend the primary
  subscription — keep claude probes small.** GLM is credential-gated (presence-check only).
- **Recursive dogfooding:** "use the baton system to help you recursively develop and test baton
  through practice." The live capstone briefs should be **real baton-repo micro-tasks**, not toy
  prompts (task #23). *(The operator's last instruction before pausing Fable was "git commit state
  before using baton to reflexively/recursively write baton with baton" — the pre-dogfood baseline
  tag `pre-dogfood-baseline` was created at `b85c58d` for exactly this. Dogfooding has not started;
  it is gated on §5.)*
- **Session-mode is the product posture.** One-shot adapters are an explicitly-labeled
  fire-and-forget tier only.
- **GLM 5.2 (Z.ai) is the capable-non-refuser tier** for ML/AI + cybersecurity; it carries an
  explicit `nonRefuserFor` classifier tag, and the trust gate still verifies its output.
- **Git commit trailers required** on every commit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01VK5a8JNrcGXMhmA4Y1nkLj`.
  *(If you are a different model, add your own Co-Authored-By line; keep the Claude-Session line.)*
- Repo branch is **`master`**. **No git remote** — this is a local repo; "issues" are committed docs
  like this one.

---

## 3. Current state at a glance

| Item | State |
|---|---|
| HEAD | **`b85c58d`** "build phase 10 C+D: SC1-SC10 green …" on `master` |
| Baseline tag | **`pre-dogfood-baseline`** → `b85c58d` (created for the dogfooding step) |
| Prior commits | `d8708ce` (docs/24 goal proposal) · `637f4e4` (phase 9.1 grok live smoke) |
| Test suite | **411/411 green** via bare `node --test` in `impl/` (~10s) |
| Working tree | clean at handoff (the handoff doc + evidence are the only new files) |
| Phase | 10, at plan step **E (review) — incomplete**; F (capstone) blocked |
| Task tracker | #12–15 done · #16 (review) + #18 (capability sweep) in-progress · #17 + #19–24 pending |

**Do not** treat "411/411 green" as "phase 10 is correct." Every §5 finding is, by construction,
something the 411 tests do **not** catch — several were reproduced by mutation (delete the code, all
411 still pass).

---

## 4. What landed this session — phase 10 C+D (commit `b85c58d`)

Spec: **`spec/phase10/system-completion.md`** (contracts SC1–SC11, each citing the phase-B verified
gap evidence). The loop ran red-first: **33 tests failed for their stated reasons** (378/411) before
any implementation; then green to 411/411. New test files:
`impl/test/phase10-completion.test.mjs`, `impl/test/glm-session.test.mjs`,
`impl/test/phase10-driver-e2e.test.mjs`. Amended (by contract ID, per errata discipline):
`coordinator.test.mjs`, `phase8-correctness.test.mjs`, `adapter.test.mjs`, `e2e.test.mjs`. Fixtures
gained free-text markers only (`REPORT_CWD`/`REPORT_ENV`, `FAKE:REPORT_CWD`) — no wire-shape change.

| Contract | What shipped | Key files |
|---|---|---|
| **SC1** | One spawn contract: all three session adapters accept the coordinator's `{worktreeReady}` (await → resolved `.path` as cwd) and `opts.worktree`; **refuse when neither resolves** (never a silent orchestrator-cwd session). Resolution happens **before** the child exists (grok's OS `cwd:`, codex's `thread/start.cwd`, claude's child `cwd`). | claude-session.mjs, codex-appserver.mjs, grok-acp.mjs |
| **SC1d** | Dispatch **consumes** the spawn Ack (was `.catch(noop)` discard): a refused spawn appends `lifecycle.crashed` `phase:'spawn'`, sets task `failed` / handle `exited` via new `_onSpawnRefused`. | coordinator.mjs |
| **SC2** | `ClaudeSessionCli`/`CodexAppServerCli`/`GrokAcpCli`/`GlmSessionCli` **exported** from index.mjs. | index.mjs |
| **SC3/SC10** | Driver-level fake E2E per session vendor through `createDriver()` — spawn, mid-turn steer, interrupt, trust gate; **cwd-echo** proves the worker ran in its task worktree. | phase10-driver-e2e.test.mjs |
| **SC4** | Per-worker **send serialization** (`handle.sendChain`): call order = delivery order; queued sends re-check guards at slot acquisition. C3 + same-tick-interrupt tests amended by SC4. | coordinator.mjs |
| **SC5** | Story folds `kill.confirmed`→`exited`, `turn_completed`→`idle` (from `working` only; the `stopping` race stays warning-free), `verify.reverified`→`lastVerdict`; narrative active/done counts + `done (verified)` phrasing. | story.mjs |
| **SC6** | `GlmSessionCli extends ClaudeSessionCli`: Z.ai env override, token chain `authToken ?? Z_AI_API_KEY ?? ZHIPU_API_KEY` (presence-only), ceiling 1 (derived), `nonRefuserFor` tag. | claude-session.mjs |
| **SC7** | `route()` restricts to `nonRefuserFor`-capable vendors when any is feasible; deterministic, never strands a task. | index.mjs |
| **SC8** | Every exported adapter card speaks the canonical 8-verb vocabulary with values honest to the implemented surface (legacy subprocess tier `ask` key retired; D11 amended by SC8). | adapter.mjs, cli-adapters.mjs |
| **SC9** | e2e `routeFn` stub marked deliberately synthetic. | e2e.test.mjs |
| **SC11** | Live capstone — **not started** (plan F, gated on review). | — |

The full spec text for each contract, including the exact "RED reason today" evidence it was drawn
from, is in `spec/phase10/system-completion.md`. Read it — it is the authority for what each SC
*means* and will tell you whether a §5 finding is a genuine defect or a contract-conformant choice.

---

## 5. ⚠️ The incomplete adversarial review (LOAD-BEARING)

Plan step E ran as a workflow (`phase10-adversarial-review`): 4 dimension find-agents (correctness /
contract-fidelity / concurrency / test-honesty), each finding verified by 3 diverse-lens refuters
(code-reading / reproduction / contract), surviving on ≥2/3 not-refuted.

**It did not finish.** Fable 5 ran out of usage credits during the Verify phase:
**16 of 58 agents completed; 42 verify-agents errored** with "out of usage credits." Consequence:
**the Find phase completed (all 18 raw findings captured with full bodies), but most findings were
never verified.** In the workflow's output JSON, findings whose verifiers all errored were bucketed
into `killed` with an **empty `killedBy`** — that means **"unverified," NOT "refuted."** Do not read
an empty-`killedBy` finding as cleared.

Raw evidence (trust these over the summary below):
- `docs/handoff/evidence/phase10-review-result.json` — the workflow's confirmed/killed buckets.
- `docs/handoff/evidence/phase10-review-raw-findings.json` — **all 18 findings with full
  claim/scenario/evidence bodies** (the find-agents' own text; several say "empirically reproduced
  (scratch repro)").

### 5.1 CONFIRMED — survived adversarial verification (fix or consciously accept)

**C-1 · [major · test-honesty] SC1d test asserts only in-memory status, not the durable
`lifecycle.crashed` event.**
`impl/test/phase10-completion.test.mjs:204` asserts only `r.status === 'failed'` (in-memory
`task.status`), never the `lifecycle.crashed` `phase:'spawn'` event the SC1d design depends on for
replay. Two independent verifiers **reproduced by mutation**: delete the `_log.append` in
`_onSpawnRefused`, keep `task.status='failed'` → **all 411 tests pass**, but a coordinator restart
`_replay()`s the refused-spawn worker back to **`working`** (only `spawned`+`turn_started` in the
log) — the exact zombie SC1d exists to kill, resurrected across every restart. **Fix:** add a
`log.read(h.id)` assertion for the `lifecycle.crashed` `phase:'spawn'` event to the SC1d test. (One
verifier dissented: "hypothetical future regression, not an inputs→wrong-behavior defect" — a fair
point, but the missing assertion is cheap and the contract explicitly rests on the durable event.)

**C-2 · [minor · test-honesty] SC8 session-card rows check shape only; the "values pinned by their
own suites" backstop has holes.**
`phase10-completion.test.mjs:412-414` sets `expected=null` for the three session adapters, so SC8
asserts only the 8-key shape + closed-set membership for them. The justifying comment claims the
*values* are pinned by each adapter's own suite — but `claude-session.test.mjs` never asserts
`verbs.pause`, and `codex-appserver.test.mjs` never asserts `verbs.answer`/`verbs.kill` (only
`grok-acp.test.mjs` pins all 8). Three verifiers **reproduced by mutation**: set claude
`pause:'native'` (no pause method exists) + codex `answer/kill:'emulated'` → **411/411 green**, an
uncaught overclaim of exactly the docs/22 kind SC8 exists to prevent. Shipped values at `b85c58d`
are honest; this is a test-lock gap. **Fix:** give the three session adapters explicit expected verb
maps in the SC8 table (drop `expected=null`).

### 5.2 REFUTED — genuinely cleared (do not spend time here)

- **"GLM env-probe tests can print a REAL `ANTHROPIC_AUTH_TOKEN`"** — refuted 3/3. `GlmSessionCli`
  always sets `ANTHROPIC_AUTH_TOKEN` in cfg.env (`token ?? ''`), spread **last** into the child env,
  so the constructor-set fake value always shadows any inherited real token; the leak path is
  unreachable at `b85c58d`. (Still: credential discipline holds — never widen these tests to echo
  real env.)
- **"Claude driver-e2e tests carry no cwd proof"** — refuted 3/3 on the contract lens: SC3 (claude)
  deliberately assigns driver-level cwd-echo to **SC10 (codex/grok) only**; claude's cwd resolution
  is proven at the adapter level (SC1a). Not a defect.

### 5.3 UNVERIFIED — find-agent claims, NEVER adversarially checked (credits ran out). **RE-VERIFY EACH BEFORE FIXING.**

These are the highest-value, highest-risk items. Multiple were flagged **independently by two or
three different dimension agents** (noted below), which raises prior confidence — but none passed the
adversarial gate. Per methodology practice #4, **re-verify each (reproduce the scenario) before
touching code.** Full bodies are in `phase10-review-raw-findings.json`; condensed here.

They form **one coherent cluster**: phase 10 introduced `await opts.worktreeReady` *inside* each
session adapter's `spawn()` (before the child/session exists) and a new `_onSpawnRefused` +
`sendChain` delivery path. The cluster is the interaction of those with the pre-existing stop/kill
finalization. **Root-cause them together, not one-by-one.**

**U-1 · [CRITICAL] kill()/interrupt() during `spawn`'s `worktreeReady` await → permanently unkillable
orphan.** (concurrency agent)
`await opts.worktreeReady` now precedes child creation and `_sessions.set` in all three adapters
(claude-session.mjs:130→150; codex:382→391; grok:408→417). `adapter.kill()` no-ops when no session
is registered. So a stop issued while worktree creation is slow: `adapter.kill` finds no session →
`{ok:true}`; `kill.confirmed` never comes; stop-deadline fires `_forceStop` → handle `dead`, task
`failed`; **then** `worktreeReady` resolves and `spawn()` launches a **real** vendor CLI
(`--permission-mode acceptEdits`) that runs the full brief unsupervised, spends real quota, edits
disk, and **can never be killed through the API** (`kill()` short-circuits `already_dead`). Invisible
and unkillable. **This is why the live capstone is blocked.**

**U-2 · [CRITICAL] `_onSpawnRefused` clobbers a finalized kill: `cancelled` → `failed` + spurious
`lifecycle.crashed`.** (correctness agent)
`_onSpawnRefused` guards only on `handle.status === 'exited'` — a status **no other coordinator path
ever sets** (kill sets `dead`, crash/exit set `idle`). `'cancelled'` is not in
`TERMINAL_TASK_STATUSES`. So when `kill(w)` races an in-flight grok/codex handshake: the child close
emits `kill.confirmed` (task→`cancelled`) **and** rejects the pending handshake RPC (spawn resolves
`{ok:false}`) → the SC1d `.then` runs `_onSpawnRefused`, which logs a fabricated
`lifecycle.crashed{phase:'spawn'}` **after** `kill.confirmed` and rewrites the user-cancelled task to
`failed`. `result()` reports `failed` for a user cancellation; D10 replay rebuilds `failed`. Claimed
"empirically reproduced (scratch repro1b)."

**U-3 · [CRITICAL] SC4 queued send outlives the stop window → cancelled task resurrected to
`completed`.** (correctness + concurrency agents — flagged twice)
`_deliver`'s slot-acquisition guard checks only `status === 'stopping'`. `interrupt()`/`kill()`
bypass the `sendChain` by design, so a stop that finalizes **after** a send was queued moves the
worker to `idle`/`dead` before the queued slot opens → the send passes the guard, delivers to the
live session (returns `{ok:true}` to the caller, logs `control.send`), starts a **new turn on a
cancelled task**, and since `'cancelled'` isn't terminal, `_runTrustGate` rewrites it `verifying` →
`completed`/`failed`. The operator's interrupt is silently undone. The SC4b test comment itself
admits it only pins the still-`stopping` case. Claimed "empirically reproduced (scratch repro2):
rB={ok:true}, task cancelled→completed." **U-3 and the major "_deliver slot-guard" finding are the
same defect from two angles.**

**U-4 · [major] SC1d half-implemented: a `spawn()` that **rejects** (throws) is still swallowed by
`.catch(noop)`.** (test-honesty agent)
The dispatch handler only acts on a **resolved** `{ok:false}` Ack; a spawn promise that **rejects**
hits `.catch(noop)` → task stuck in `working` forever, the exact zombie SC1d targets. Reachable:
`codex-appserver.mjs` and `grok-acp.mjs` call `this._spawnFn(...)` with no try/catch (node's `spawn`
throws synchronously on invalid cmd), and grok calls `renderBrief` outside any try/catch (throws on a
brief missing `.verification`). Claimed runtime-confirmed. **Fix is one line:** route the `.catch`
into `_onSpawnRefused` with `{ok:false, reason:String(err)}`.

**U-5 · [major] Dup-session guard no longer atomic.** (concurrency agent)
The one-session-per-worker guard reads `_sessions` **before** the new `await opts.worktreeReady`,
while `_sessions.set` is after it — the await opens a window where a second `spawn(worker, …)` also
passes the guard → two OS children, second `set` clobbers the first, first child unreachable by
`kill()`. Claimed reproduced (two pids, one map entry). Reachable because SC2 exports these classes as
direct product surface (a retry double-fires).

**U-6 · [major] `worktreeReady` resolving after a forced stop spawns a live worker for a `dead`
handle.** (concurrency agent) — the "slow worktree" tail of U-1; same root cause, listed separately
because the fix (post-await abort recheck) is testable on its own.

**U-7 · [major] Codex `turn/start` failure refuses the spawn but leaks a live app-server child + a
non-terminal session.** (correctness + contract agents — flagged twice)
`CodexAppServerCli.spawn()`'s `initialize` and `thread/start` failure paths call
`_killChild`+`_sessions.delete`, but the **`turn/start`** failure path (codex-appserver.mjs:441-449)
returns `{ok:false}` **without** killing the child or deleting the session. `_onSpawnRefused` fails
the task but never issues `adapter.kill`, so a codex app-server child that may have actually started
the turn keeps editing files for a task reported `failed`. **Fix:** tear down the child on the
`turn/start` catch too.

**U-8 · [major] SC5d `non-crashed exited` is proxied by unrelated warning signals.** (contract agent)
`doneCount` uses `hasCrashWarning()`, which inspects only stalled/looping/over_budget/out_of_scope
signals and **cannot detect crashes** (the fold collapses `EXITED` and `CRASHED` to the same
`exited` status with no crash marker). Wrong both ways: a **crashed** worker renders `done`; a
**cleanly-exited** worker with a lingering budget warning is dropped from `doneCount` while its own
line says `done`. Claimed runtime-confirmed. **Fix:** carry a real crash marker on the worker story
at the `CRASHED` fold and count on that, not on signal-shape.

**U-9 · [minor] Narrative counts a worker as both active and done; `done (verified)` persists from a
stale verdict.** (contract agent) `lastVerdict` is never cleared on `TURN_STARTED`, so a worker on a
second turn is both `active` (working) and `done` (stale `lastVerdict.accept`); and a turn whose
trust gate **throws** logs kind `error` (a no-op fold), leaving the story permanently reading
`done (verified)` for a `failed` task. **Becomes reachable exactly when session reuse (task #19)
lands** — fix alongside it, or clear `lastVerdict` on `TURN_STARTED` now.

**U-10 · [minor] Session adapters ignore `opts.timeoutMs`.** (correctness agent) `_dispatch` passes
`timeoutMs: wallMin*60000`; the subprocess tier arms a SIGKILL timer, but **none of the three session
adapters read it**, and the coordinator has no other wall-clock sweep for working tasks. The product
tier lost its only wall-clock budget bound. (Related: budget **enforcement** is a top capability-gap,
§6.) **Fix:** arm a wall-clock kill in the session adapters, or a coordinator-level working-task
deadline sweep.

**U-11 · [minor] `_onSpawnRefused` dedup guard checks a status (`exited`) nothing else sets, and
overwrites terminal state unconditionally.** (correctness agent) — the mechanism behind U-2; the guard
can never fire its intended crash-vs-refusal dedup, and it regresses `dead`→`exited`, breaking
`kill()`'s `already_dead` idempotency. Fix as part of U-2 (guard on `TERMINAL_TASK_STATUSES` +
`dead`, and add `cancelled` to terminal statuses or check it explicitly).

> **Suspected real-defect core (Fable's assessment, unverified):** U-1/U-2/U-3/U-4/U-5/U-6/U-7/U-11
> are almost certainly genuine — they trace cleanly and several were reproduced by the find-agents.
> The common cause is that phase 10 made `spawn()` **async before the child/session exists** and
> added a refusal/`sendChain` path **without** reconciling it against the pre-existing kill/stop
> finalization state machine. **U-8/U-9** are pre-existing story imprecision that SC5's "narrative
> truth" goal newly makes fair game. Recommend a single **phase-10.1 "spawn/stop reconciliation"**
> spec that treats the whole cluster as one contract set (SC12+), red-tests each scenario, then
> fixes — do **not** patch them piecemeal.

---

## 6. The researched-vs-shipped capability gap (docs/25 sweep — task #18)

The operator's live question — *"a huge gap between what we researched/engineered vs what actually
ships?"* — was answered by a completed 11-agent workflow (`capability-coverage-sweep`). Full matrix:
**`docs/handoff/evidence/capability-matrix.json`** (107 classified rows). Headline:

| Status | Count | Meaning |
|---|---|---|
| **SHIPPED** | 41 | reachable through `createDriver()` (a few adapter-only) |
| **DELIBERATELY-FENCED** | 22 | consciously excluded by the narrow-waist D1 design or an explicit docs/24 non-goal (MCP northbound, A2A federation, multi-machine, new vendor adapters, harness-as-MCP-tool) |
| **UNSHIPPED-DEBT** | 44 | researched, valuable, absent, **not** fenced anywhere |

**So: the gap is real and roughly half the researched surface — but ~⅓ of the "missing" is
deliberate scope discipline, not oversight.** The genuine debt clusters around **session lifecycle
depth** and **enforcement** — precisely because phase 10 wired the *control* plane but not the
*governance* plane. High-priority UNSHIPPED-DEBT rows:

1. **Worker session resume/fork through the driver** — claude `--resume`/`--fork-session`, codex
   `thread/resume`/`thread/fork`, grok `session/load` + `x.ai/session/fork`. All three vendors
   support it; **baton uses none of it.** Every task pays a fresh spawn; a crashed worker's durable
   session is unrecoverable. *(Coordinator-restart persistence is fenced by docs/24; mid-run
   worker-session resume is **not** fenced — this is real debt. Directly enables task #19.)*
2. **Budget enforcement end-to-end** — telemetry (`budgetUsed`, thresholds) exists, but nothing
   **acts**: no `resource.budget_threshold` emission, no hard-stop, no session wall-clock bound. (See
   U-10 — the session tier has *zero* wall-clock bound today.)
3. **Hub watchdog: stall/loop/budget signals wired to action** — the story *computes* attention
   signals; nothing consumes them to auto-interrupt a looping worker. Signals without a control loop.
4. **Red→green acceptance gate** — verify that the brief's check **fails at base sha** and **passes
   after** the change (true TDD-of-the-worker), not just "passes after." `requireRedGreen` is plumbed
   through `accept()` but the base-sha red run isn't wired.
5. **Merge/integration + git-push approval gate** — lifecycle currently ends at a verified branch; no
   integration step.
6. **ACP `session/load` / codex `thread/resume` / rejoin-running-thread** semantics (the protocol
   substrate for #1).

**Deliverable owed:** write these up as `docs/25-capability-gap.md` (the sweep did the analysis;
someone must commit the doc) and fold #1–3 into the phase-11 backlog. Tasks #19 (session reuse) and a
new "governance plane" task (budget enforcement + watchdog action) are the natural homes.

---

## 7. Ordered next steps (do these, in this order)

1. **Re-verify the §5.3 cluster.** For each of U-1…U-11, reproduce the failure scenario (the
   find-agents claim scratch repros — redo them). Confirm which are genuine. *Verify before rework.*
2. **Write `spec/phase10.1/spawn-stop-reconciliation.md`** (contracts SC12+) covering the confirmed
   cluster as one coherent set: async-spawn abort semantics (a stop during `worktreeReady` must
   prevent or reap the child), `_onSpawnRefused` must not clobber a finalized kill/cancel
   (`cancelled` into `TERMINAL_TASK_STATUSES` or explicit checks; guard on the right statuses),
   `_deliver` must re-check `dead`/`idle`/terminal-task at slot time (not just `stopping`) and
   consult the adapter ack, the rejected-spawn path must route into `_onSpawnRefused`, codex
   `turn/start` failure must tear down its child, dup-session guard must be atomic across the await.
   **Red-test every scenario first** (these are the tests the 411 are missing).
3. **Fix the two CONFIRMED test-honesty gaps** (C-1: assert the `lifecycle.crashed` event in SC1d;
   C-2: explicit expected verb maps for the three session adapters in SC8).
4. **Fix U-8/U-9** (story crash marker; clear `lastVerdict` on `TURN_STARTED`) — cheap, closes SC5's
   "narrative truth" honestly.
5. **Green + re-run the adversarial review workflow** (it's saved; resume with the scriptPath in §8,
   or re-run fresh) to confirm the cluster is closed and nothing new was introduced.
6. **Only then: the live capstone (task #17 / plan F).** Real claude + codex + grok through
   `createDriver()`, briefs = **real baton-repo micro-tasks** (dogfooding, task #23), ≥1 mid-task
   steer, ≥1 interrupt, every result trust-gated. codex/grok liberal, claude small, GLM live iff
   credentials present (presence-only) else PENDING-LIVE. Commit evidence JSONL under
   `docs/reference/evidence/`; **rewrite** (not append) `impl/VALIDATION.md`.
7. **Commit `docs/25-capability-gap.md`** and scope phase 11 (§6 + tasks #19–24).

**Guardrail:** do not start step 6 until steps 1–5 are done. U-1 can spawn a real, unkillable,
budget-burning CLI process on the operator's machine.

---

## 8. Evidence index (committed alongside this doc)

- `docs/handoff/evidence/phase10-review-raw-findings.json` — all **18** review findings, full bodies.
- `docs/handoff/evidence/phase10-review-result.json` — the workflow's confirmed/killed buckets +
  per-vote reasoning (note empty `killedBy` = unverified, not refuted).
- `docs/handoff/evidence/capability-matrix.json` — the **107-row** researched-vs-shipped matrix
  (counts, per-row status/rationale/priority/source).
- Resumable review workflow (same session only):
  `Workflow({scriptPath: ".../workflows/scripts/phase10-adversarial-review-wf_842e000d-f15.js", resumeFromRunId: "wf_842e000d-f15"})`
  — completed find-agents replay from cache; only the failed verify-agents re-run. In a fresh
  session, re-author from this doc + the raw-findings JSON.
- Authority docs: `spec/phase10/system-completion.md` (SC1–SC11), `docs/24-goal-system-completion.md`
  (goal + non-goals + methodology), `docs/22-completeness-audit.md` (the built-not-wired audit),
  `docs/reference/*.md` (per-harness dossiers), `docs/reference/evidence/` (live probe JSONL).
- Task tracker: #12–15 done; #16 (review) reflects §5's incomplete state; #17 blocked on §5; #18
  (capability sweep) done pending the docs/25 write-up; #19–24 phase-11 backlog.

---

*Handoff authored by Fable 5 at the credit boundary, 2026-07-10. The suite is green but the phase is
not done: the review is incomplete and its critical findings are unverified. Re-verify, reconcile the
spawn/stop cluster, then — and only then — dogfood and capstone. Everything you need is in this file
and the three evidence JSONs beside it.*
