# Phase 10 — whole-system completion (SC contracts)

*Executes docs/24 plan step C. Every contract below is drawn ONLY from the verified-open backlog
(docs/24 §subsystem-map, phase-B verdicts of 2026-07-10): G1 (correctness-critical), G5, G7+G12
(story lifecycle cluster), G11 (+ capability field), G10/G-legacy (card-shape honesty), G9 (drift
note). Five other believed gaps were retired with evidence and get no contract. Contracts are
implementation-language-agnostic on purpose: `impl/` is the reference implementation; the durable
assets a future Go/Elixir port inherits are these contracts, the fake binaries, and the evidence
ledger.*

Red tests land first in `impl/test/phase10-completion.test.mjs`, `impl/test/glm-session.test.mjs`,
and `impl/test/phase10-driver-e2e.test.mjs`, each failing for its stated reason before any
implementation lands.

---

## SC1 — one spawn contract (closes G1, correctness-critical)

**Evidence.** The coordinator dispatches with `spawn(workerId, task.brief, { worktreeReady,
timeoutMs })` (coordinator.mjs:223–226) where `worktreeReady` is a Promise resolving
`{path, branch, baseSha}` (coordinator.mjs:210–215). The one-shot base adapter and MockAdapter
implement exactly this contract (cli-adapters.mjs:126–128, adapter.mjs:457–462). The three session
adapters do not:

- claude-session.mjs:126 — `if (!opts.worktree) return { ok:false, ... }`: **loud fail**, session
  adapters unreachable through the driver.
- codex-appserver.mjs:411–416 — `thread/start { cwd: opts.worktree }` with `opts.worktree`
  undefined: JSON.stringify drops the key, the thread runs in the app-server's own cwd —
  **silent wrong-cwd**.
- grok-acp.mjs:406–411 — child spawned with `cwd: opts.worktree` undefined: inherits the
  orchestrator's cwd — **silent wrong-cwd**.

A silent wrong-cwd worker "completes" turns while never touching the task's worktree; the trust
gate then verifies an empty worktree. This is the built-not-wired failure mode at its worst.

**Contract.**

- **SC1a** Every session adapter's `spawn(worker, brief, opts)` resolves its working directory as:
  `opts.worktree` if provided; else `await opts.worktreeReady` and use the resolved `.path`.
  Resolution happens **before any child process is created** (grok's OS-level `cwd:` at
  grok-acp.mjs:408 makes this ordering mandatory; uniform rule for all three).
- **SC1b** If neither source yields a path (both absent, promise rejects, or resolves without
  `.path`), spawn returns `{ ok:false, reason }` **without creating a child or issuing any wire
  request**. No session ever starts with an unspecified cwd.
- **SC1c** The resolved path is threaded to the harness's own workspace pin: claude child `cwd`
  (claude-session.mjs:141), codex `thread/start.cwd` (codex-appserver.mjs:412), grok child `cwd`
  AND `session/new.cwd` (grok-acp.mjs:408, 444).
- **SC1d** The coordinator consumes the spawn Ack it currently discards
  (coordinator.mjs:226 `.catch(noop)`): on `{ok:false}`, it appends `lifecycle.crashed` with
  `payload:{ error: reason, phase:'spawn' }`, sets the task `failed` and the handle `exited`.
  Rationale: replay already maps `lifecycle.crashed` → `failed` (coordinator.mjs:918–920) and the
  story already terminal-transitions on CRASHED (story.mjs:329–332) — reusing the kind keeps
  log-is-truth consistent. Today a refused spawn leaves a zombie task in `working` forever.

**Red tests.** Claude spawn with `worktreeReady`-only succeeds (today: `ok:false`); codex/grok
spawn with neither source refuse (today: `ok:true`, silent wrong cwd); cwd-echo through each fake
binary proves the resolved path reached the harness's workspace pin (fixture markers, see §Fakes);
coordinator zombie test (stub adapter returns `ok:false` → task must become `failed`).

## SC2 — session classes are product surface (closes G1-assembly)

**Evidence.** index.mjs:19–23 exports the phase-1 adapters and never the session classes; a
driver caller cannot construct the product tier (docs/23 re-steer item 2).

**Contract.** `index.mjs` exports `ClaudeSessionCli`, `CodexAppServerCli`, `GrokAcpCli`, and
`GlmSessionCli` (SC6). Each is constructible with `{cmd, args}` test doubles and yields a card
satisfying SC8.

**Red test.** Dynamic `import('../src/index.mjs')` asserts each named export is a constructor
(today: `undefined`).

## SC3 / SC10 — driver-level fake E2E, per session vendor (closes G1 end-to-end)

**Evidence.** No test drives a session adapter through `createDriver()`; the only driver-level
E2E uses MockAdapter (e2e.test.mjs). The audit's core lesson (docs/24 methodology §5): overclaims
live in the seams; completion must be proven with driver-level E2E.

**Contract.** Through the real `createDriver()` against a real temp git repo, with each session
adapter backed by its wire-faithful fake binary (zero quota):

- **SC3** (claude, full loop): spawn → stream → **mid-turn steer** (fake `HOLD_UNTIL_INTERRUPT`
  absorbs a `send(..., 'steer')` into the running turn, per erratum E2) → turn completion →
  trust-gate re-verification in a fresh worktree → task `completed`; plus an interrupt path
  ending `cancelled`.
- **SC10** (codex, grok): spawn → stream → turn completion → trust gate → `completed`. The turn's
  reported text must echo the worktree path the fake actually received (cwd-echo marker),
  proving SC1c at driver level, not just adapter level.

**Red reason today.** Dispatch passes `{worktreeReady}`; claude-session refuses, codex/grok run
in the wrong cwd — tasks never reach `completed` (bounded waits fail fast; no hanging suite).

## SC4 — ordered, revalidated delivery (closes G5)

**Evidence.** send() issues a stamp (coordinator.mjs:370), awaits the adapter
(coordinator.mjs:372), then re-checks (coordinator.mjs:373). Two defects follow:
(1) two concurrent send()s to one worker can deliver **out of call order** — the coordinator does
not await the in-flight delivery before issuing the next (a slow steer emulation, e.g. grok's
cancel-then-reprompt, is overtaken by a fast nudge); (2) a send whose guards passed at entry can
deliver even though the world changed while it waited on nothing but the adapter — the fence bump
from an interrupt (`bumpHuman`, coordinator.mjs:444) is only discovered post-delivery, and
un-delivery is impossible (grok queues prompts in-CLI, live-proven).

**Contract.**

- **SC4a** Deliveries to one worker are **serialized in send()-call order**: the coordinator does
  not invoke `adapter.prompt()` for a later send until the earlier send's Ack has resolved.
  Cross-worker sends stay concurrent. (Ack boundedness is already owed by X3/requestTimeoutMs —
  no new timeout constants.)
- **SC4b** Entry guards are re-evaluated **at delivery-slot acquisition**, in the same order as
  entry (stopping check coordinator.mjs:351, then `opts.expectedFence` pre-check
  coordinator.mjs:354–368). A send that queued valid but stale-ified while waiting is rejected
  `pre_delivery` — with **no** wire delivery and **no** `control.delivery_amended`.
- **SC4c** The post-delivery amendment (coordinator.mjs:376–394) **remains**, narrowed to the one
  irreducible race: a fence bump landing while the delivery itself is on the wire. The existing
  C3 test (phase8-correctness.test.mjs:435 region) documents delivered-despite-stale as generic
  known behavior; it is **amended by SC4** to cover only that irreducible window. Per errata
  discipline, the amendment cites SC4 in the test — never a silent rewrite.

**Red tests.** (a) slow-A/fast-B concurrent sends: B's `adapter.prompt` must not be invoked until
A's Ack resolves (today it is); (b) A in flight, interrupt bumps the fence, queued B carrying the
pre-bump `expectedFence`: B must resolve `ok:false` with exactly one total delivery (today: two
deliveries + an amended event for B).

## SC5 — the story reaches terminal states (closes G7 + G12)

**Evidence.** story.mjs:322–324 — TURN_COMPLETED only records `turnEpoch`; only EXITED/CRASHED
leave `working` (story.mjs:329–332). `kill.confirmed` is absent from KIND (story.mjs:75–95), so a
killed worker's narrative never terminates — while the coordinator both folds it live
(coordinator.mjs:801–803) and replays it to `cancelled` (coordinator.mjs:922–924).
`verify.reverified` (coordinator.mjs:844) is likewise unknown to the story, which therefore
cannot distinguish a verified-done worker from an idle one. renderNarrative counts every
non-exited worker "active" (story.mjs:593).

**Contract.**

- **SC5a** `KIND.KILL_CONFIRMED = 'kill.confirmed'` joins the vocabulary and folds to terminal
  `exited` (mirrors the coordinator's replay semantics).
- **SC5b** TURN_COMPLETED transitions `working → idle` (LEGAL_TRANSITIONS entry
  `{from:['working'], to:'idle'}`). Any other current status is left unchanged **without** an
  `illegal_transition` warning: turn-completed-while-`stopping` is a legal race whose terminal
  state is owned by the stop confirmation. (The stall detector already fires only for `working`
  — story.mjs:438 — so idle workers need no NEVER_STALLED change.)
- **SC5c** `KIND.REVERIFIED = 'verify.reverified'` joins the vocabulary and records
  `w.lastVerdict = { accept: payload.accept === true }`; no status change (the worker is already
  idle; the coordinator may redispatch it). This closes DoD item 7's "no kind that silently
  no-ops where a state transition is owed" for the one kind the coordinator itself emits.
- **SC5d** Narrative truth: `activeCount` counts statuses in
  `{working, stopping, blocked, input_required}`; `doneCount` counts non-crashed `exited` workers
  plus workers whose `lastVerdict.accept === true`; an idle worker with an accepted verdict
  renders `done (verified)`, with a failed verdict `idle (verification failed)`.

**Red tests.** kill.confirmed → status `exited` (today: stays `working`); turn_completed →
`idle` (today: `working`); turn_completed while `stopping` stays `stopping` with no warning
(lock-in); reverified fold records lastVerdict (today: undefined); narrative counts/phrases as
above (today: completed workers still "active").

## SC6 — GlmSessionCli to the credential boundary (closes G11)

**Evidence.** No session-mode GLM exists anywhere in impl; the proven env-override pattern lives
only on the one-shot tier (ZCodeCli, cli-adapters.mjs:251–264). Session-mode is the product
posture (docs/24 constraints).

**Contract.** `GlmSessionCli extends ClaudeSessionCli` (claude-session.mjs), because GLM's
official harness path IS Claude Code pointed at Z.ai's Anthropic-compatible endpoint:

- env: `ANTHROPIC_BASE_URL` (default `https://api.z.ai/api/anthropic`, overridable via
  `opts.baseUrl`), `ANTHROPIC_AUTH_TOKEN` from `opts.authToken ?? Z_AI_API_KEY ?? ZHIPU_API_KEY`
  (empty string when absent — construction never throws, the credential boundary is live-smoke's
  gate, not the constructor's), and when `opts.model` is given the model-map pair
  `ANTHROPIC_DEFAULT_OPUS_MODEL`/`ANTHROPIC_DEFAULT_SONNET_MODEL` (ZCodeCli parity,
  cli-adapters.mjs:256–260). Caller `opts.env` merges last.
- identity: harness `glm-via-claude-session`, version identifies the Claude Code plus Z.ai
  Anthropic transport (not a model slug), ceiling default **1**
  (derived limit: Z.ai Pro ≈ one in-flight session, same derivation as cli-adapters.mjs:255 —
  configurable, documented, not arbitrary).
- card: inherits the 8-verb Claude-session card and adds
  `nonRefuserFor: ['ml-ai-inference-training', 'cybersecurity']` (SC7's field).
- Credentials are checked by **presence only**, never printed/logged/committed. Live smoke is
  PENDING-LIVE in the capstone ledger when absent.

**Red tests** (glm-session.test.mjs): export exists; card identity/ceiling/verbs/nonRefuserFor;
env threading proven at effect level through the fake binary (`REPORT_ENV` marker) using
test-fake token values only; model-map envs appear only when `opts.model` given; spawn inherits
SC1 (worktreeReady-only works against fake-claude).

## SC7 — deterministic capability routing (closes G11's routing half)

**Evidence.** `nonRefuserFor` exists in no card; route() (index.mjs:69–84) selects on
ceiling-feasibility + router.pick only. Domain-sensitive work routes by operator folklore.

**Contract.** `card()` MAY carry `nonRefuserFor: string[]` (domain tags). In `createDriver`'s
route(): given the feasible set, if **any** feasible vendor's card lists `task.taskType` in
`nonRefuserFor`, the candidate pool is restricted to those vendors; otherwise the pool is
unchanged. Deterministic, and never strands a task (no capable vendor ⇒ unrestricted pool;
capable-but-at-ceiling vendors don't restrict — feasibility is computed first). `taskType` is
already the routing/learning dimension (coordinator.mjs:259, :861) — no new task field.

**Red tests.** Two stub adapters, capable one listed second (fresh adaptive router scores tie and
first-listed wins today — router.mjs `score > bestScore` keeps the first maximum):
`spawn('auto', brief, {taskType:'cybersecurity'})` must land on the capable vendor (today: the
first). Lock-ins: unlisted taskType → first vendor; no card lists the tag → first vendor.

## SC8 — one card shape, honest values (closes G10, extended to every exported adapter)

**Evidence.** Session cards already speak the canonical 8-verb vocabulary
(claude-session.mjs:81–90, codex-appserver.mjs:105–123, grok-acp.mjs:112–130). Everything else
drifts or lies:

- one-shot cards expose 4 keys (cli-adapters.mjs:229, :242, :279); `kill` is implemented
  (cli-adapters.mjs:204–208) yet undeclared; ClaudeCli claims `steer:'emulated'`/`pause:'emulated'`
  while `steer()` returns `ok:false` (cli-adapters.mjs:211) and no pause method exists.
- legacy adapter.mjs cards still use the pre-D1 `ask` key (adapter.mjs:155, :566, :584) — and the
  subprocess trio claims `interrupt:'native'`/`steer:'native'` while SubprocessAdapterBase stubs
  prompt/interrupt/approve/answer/kill as not-implemented (adapter.mjs:550–554).

**Contract.** Every exported adapter class's `card().verbs` has **exactly** the canonical 8 keys
`{spawn, prompt, steer, interrupt, approve, answer, kill, pause}`, values from the closed set
`{'native','emulated','unsupported'}`, and each value is honest to the implemented surface:

| class | spawn | prompt | steer | interrupt | approve | answer | kill | pause |
|---|---|---|---|---|---|---|---|---|
| MockAdapter | native | native | native | native | native | native | native | unsupported |
| CodexAdapter / ClaudeAdapter / GlmAdapter (legacy) | native | unsupported ×6 (only spawn is implemented) | | | | | | |
| CodexCli / ClaudeCli / ZCodeCli (one-shot) | native | unsupported | unsupported | emulated | unsupported | unsupported | native | unsupported |
| PiCli | unsupported until configured, else native | unsupported | unsupported | emulated | unsupported | unsupported | native | unsupported |
| ClaudeSessionCli / CodexAppServerCli / GrokAcpCli / GlmSessionCli | (already canonical — locked as-is) | | | | | | | |

Existing tests that pin the old shapes are updated citing SC8 (documented contract evolution,
not test-weakening).

**Red test.** Table-driven card-shape + honesty assertion over every exported class.

## SC9 — e2e routeFn drift note (closes G9)

**Evidence.** e2e.test.mjs:228's `routeFn` stub returns `adapterVendor` unconditionally and will
never mirror the real route(); real-entrypoint coverage lives in C7
(phase8-correctness.test.mjs:633–701). Benign, but a silent divergence trap.

**Contract.** A comment at the stub points to C7 as the real-route coverage and marks the stub as
deliberately synthetic. (Comment-only; no test.)

## SC11 — live capstone gate (docs/24 DoD items 4, 6, 8)

Phase F, unchanged from docs/24, sharpened by the user's 2026-07-10 directives: real claude +
codex + grok driven concurrently through `createDriver()` — **the briefs are real baton-repo
micro-tasks (recursive dogfooding), not toy prompts**; ≥1 mid-task steer; ≥1 interrupt; every
result trust-gated in a fresh worktree; codex/grok may run liberally (currently cheap for the
operator), claude probes stay small; GLM live iff credentials present (presence-only check), else
PENDING-LIVE. Evidence JSONL committed under `docs/reference/evidence/`; `impl/VALIDATION.md`
rewritten (not appended).

---

## Fixture extensions (test infrastructure, shaped-by-live rule intact)

The fakes gain **free-text content markers only** — no wire-shape changes, same mechanism family
as the existing `HOLD_UNTIL_INTERRUPT`:

- fake-claude: `REPORT_CWD` → completes with summary text `cwd:<process.cwd()>`;
  `REPORT_ENV:<VAR>` → summary `env:<value>` (tests pass fake token values only — the
  never-print-credentials rule applies to real values, and no test reads real env).
- fake-codex-appserver / fake-grok-acp: stash the `cwd` received in `thread/start` /
  `session/new`; a prompt containing `REPORT_CWD` completes the turn with text `cwd:<stashed>`.

## Execution notes

- Red first: the three new test files fail for the stated reasons; the existing 372 stay green.
- Green (plan D) keeps the contended files single-writer; SC4's C3 amendment lands with the SC4
  implementation, cited by ID.
- Adversarial review (plan E) fans correctness / contract fidelity / concurrency / test honesty
  over the phase-10 diff before the capstone.
