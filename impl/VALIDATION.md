# Phase 6 — Qualitative Validation & Judgment

*The methodology's final phase: not "do the tests pass" (they do — 259/259) but "does the thing actually work, and is it what it claims to be." Judged by driving the real assembled system and observing behavior (`node demo.mjs`), then assessing honestly.*

## What was built

A runnable fleet-driver coordinator in ~3,500 lines of dependency-free ESM JavaScript, across 9 modules, assembled by `createDriver()` (`src/index.mjs`) and exercised by 259 tests plus a narrated demo. It runs with `node` — no build step, no external packages, no model quota (workers are a deterministic `MockAdapter`; real Codex/Claude/GLM adapters implement the same interface as the next increment).

## The four claims, judged against observed behavior

1. **"The driver directs workers and the reliability holds."** — **TRUE.** `spawn/send/wait/respond/interrupt/result/list/kill` all work; version-stamps reject stale commands; the append-only log is the sole source of truth and the coordinator rebuilds its state from it on restart. Verified by 48 coordinator tests including the adversarial ones (stale-fence race, double-interrupt resolves, construction replay from log alone).

2. **"'Done' is hard to fool."** — **TRUE, and this is the strongest result.** The demo's scenario 2 shows a worker that *claims* `completed` with `claimedExit=0` while its committed code never creates `done.txt`. The driver re-runs the pinned check itself in a fresh git worktree the worker never touched, observes the failure, and marks the task **`failed`** — and the router records a **loss**, not the worker's claimed win. The referee test proves *freshness* is the mechanism (a `.gitignore`'d `done.txt`, real in the worker's own dir but absent from the fresh checkout, is caught). This is the durable core, working.

3. **"Interruption is dependable, not hopeful."** — **TRUE.** The demo's scenario 3 shows the status flip to `stopping` synchronously, the promise resolving only on the worker's `confirmed` stop, and the slow second edit (scheduled after the interrupt) never reaching disk. Two-phase stop is real.

4. **"Routing learns, from verified outcomes only."** — **TRUE.** The router recorded the honest run as a win (weight 1) and the forged run as a loss (weight 0), keyed by `harness@version` and task type — never from worker self-report.

## Real vendor spin-up — now proven live (phase 7)

The MVP drove only a deterministic `MockAdapter`. That gap is now closed for two vendors. `src/cli-adapters.mjs` adds real subprocess adapters (`CodexCli`, `ClaudeCli`, `ZCodeCli`, `PiCli`) that spin up full vendor harnesses as workers on the same session Adapter contract, and both a **real Codex CLI worker** and a **real Claude Code CLI worker** have been driven end-to-end through `createDriver`:

- Each spun up headless in its own isolated `.baton/wt/<taskId>` git worktree, created `done.txt`, and streamed real events (`turn_started` → `content.tool_call` (Write/Bash) → `turn_completed`) parsed from `codex exec --json` / `claude -p --output-format stream-json`.
- The task reached `completed` **only because the hub independently re-ran the pinned check in a fresh sandbox** (`verify.reverified`, `observedExit:0`, `locus:"fresh_sandbox"`) — never on the worker's word. The trust gate is real against real workers.
- A quota-exhausted Codex run surfaced correctly as `lifecycle.crashed` → task `failed`, with **no false completion** — the driver handles a real vendor error cleanly.
- Two correctness fixes fell out of the live runs: the referee no longer flags a no-claim worker (`claimedExit=null`) as "Diverged," and the adapter's stdout path no longer double-emits terminal events. Both are locked in by tests (273/273 green).

## Honest limitations (what a green suite does NOT prove)

- **GLM/Z-Code and Pi not yet driven live.** `ZCodeCli` is structurally identical to `ClaudeCli` plus the Z.ai endpoint env (unit-tested), but needs a Z.ai key to run; `PiCli` is a configurable placeholder (Pi not installed). Codex + Claude Code are the two proven-live vendors.
- **One-shot mode only.** These adapters use `codex exec` / `claude -p` (headless one-shot). Mid-run steering/answers/approvals return "unsupported" — live steering needs the codex app-server / Claude Agent SDK session mode, a later increment. Interrupt/kill work (process-group signal, confirmed-stop on close).
- **`.baton/` exclusion is a setup requirement.** The driver keeps worktrees under `<repo>/.baton/`; a repo must exclude it (the demo/e2e do) or `pinBaseSha` sees the repo as dirty. A production driver should add this to `.git/info/exclude` on first touch — a small gap to close.
- **One cosmetic gap:** the story narrative still shows a completed worker as "active" (the completion is a trust-gate event, not a lifecycle one the story counts). Correctness is unaffected; the narrative fold needs a `verify.reverified`→done transition.
- **Not yet built (by design):** the hardened trust-gate rungs above basic re-verify (red→green/coverage/mutation are specced in `docs/21` and partly in the referee, but not wired into the demo path), live steering, the capability/knowledge planes, the MCP northbound surface, and the Elixir/OTP production port (`docs/17`). These are earned-by-demand, gated on the eval.
- **The eval itself is not run.** The whole design (doc 18/kill-case) says the *decisive* next experiment is E2 — does cross-vendor verification catch defects same-vendor misses? That needs real vendors, which this MVP doesn't yet drive.

## Judgment

**The MVP does what it set out to do, and its center of gravity is in the right place.** The single most valuable, most-tested, most-demonstrated property is the one that matters most and is hardest to fake: *the driver does not trust a worker's "done" — it re-derives the truth itself, in isolation, and a lie is caught.* Everything else (dispatch, messaging, two-phase interrupt, recency-biased routing, the story) is real and tested, but that trust gate is the thing that makes an autonomous fleet safe to run at all, and it works as observed.

The build followed the methodology honestly: spec → tests-first → red-team (which found the real cross-module seams before a line of implementation) → blue-hardening → implementation → this validation. The seams the red team predicted (divergent adapter/Brief/event contracts, the trust-gate-not-wired-to-the-referee, the router-not-wired) were exactly the integration bugs that surfaced and were fixed. That is the methodology earning its keep.

**Recommended next step:** driving a real vendor pair through the harness is now *done* (phase 7 — Codex + Claude Code, live, verified). The decisive experiment that remains is **E2** — does independent *cross-vendor* verification catch material defects a strong same-vendor baseline misses, at a decorrelation rate that justifies a second vendor's cost? That needs ~50 real diffs graded against a human-pinned spec in a sandbox no worker controls; the scaffolding to run it (real workers, isolated worktrees, fresh-sandbox re-verify, verified-only routing) is now real, tested, and runnable. Everything above the control/verification plane stays gated on E2's number surviving its own adversarial review.

---

## Addendum — completeness audit corrections (2026-07-10)

A 24-agent adversarial completeness audit (see `docs/22-completeness-audit.md`) re-tested this document's "TRUE" claims and **downgraded six**. This addendum records the corrections so VALIDATION.md stops overclaiming; the audit doc is the authoritative gap list.

- **"'Done' is hard to fool" — still TRUE, but the wording "re-runs the pinned check itself" is the real mechanism, NOT `accept()`.** The coordinator gates on an *inline* re-implementation (`coordinator.mjs`), and `index.mjs:50` **discards `accept()`'s return value**. So `accept()`'s `requireRedGreen`/`requireCoverage` hardening is built and tested but **never actually gates "done."** The freshness/forge-catch safety property holds; the "accept() is the gate" framing does not.
- **"Interruption is dependable" — PARTIAL.** `_forceStop` fires only inside `tick()`; with no background timer, if the adapter never confirms and the caller stops issuing commands, `interrupt()`/`kill()` can hang. The real-CLI stop path has **zero automated coverage** (on one-shot CLIs interrupt≈kill — a process death, not a graceful cancel).
- **"Reliability holds / fencing rejects stale commands" — PARTIAL.** `send()` delivers to the worker and *then* rechecks the fence; human>orchestrator ordering holds over the **log**, not over actual **delivery** (the message already reached the worker before `stale_fence` is returned).
- **"Routing learns from verified outcomes only" — TRUE that it LEARNS, but it never ROUTES.** `router.pick()` is never called in `src/` (dispatch is first-fit `route()` → `candidates[0]`). Verified win/loss buckets accumulate but do not influence selection.
- **Vendor attribution — BROKEN in the shipped path.** `index.mjs:33` calls `captureCommit(repoRoot, taskId, {})` with no vendor, so the `Baton-Vendor` commit trailer is never written and the author is `baton-snapshot`, not `baton-worker-<vendor>`. Attribution is only asserted in a unit test that passes `{vendor}` explicitly.
- **Real CLI adapters — proven live by hand (phase 7), but zero automated runtime coverage.** Only argv-builders and parsers are tested; the spawn/stream/interrupt/kill runtime path runs only under `live:true` (never in CI).
- **`createDriver()` has no direct tests.** `e2e.test.mjs` hand-wires the modules and its inline `routeFn` has already drifted from the shipped `route()`.

**Bottom line:** the deterministic trust spine is real and well-tested; the overclaims are all in the *wiring* (built-and-tested modules — `accept()` hardening, `router.pick()` — not plumbed into the live path) and in the *real-vendor control surface* (one-shot adapters under-implement 4 of 8 Adapter verbs). See `docs/22` §6 for the ranked fix list.

---

## Addendum — phase-8 live re-evaluation (2026-07-10)

Phase 8's session adapters shipped green against fake binaries (336/336) but had never touched a
real vendor. A skeptical live re-evaluation (docs/23) re-derived every protocol claim from
independent ground truth and drove both adapters against the real CLIs. Result:

- **The codex app-server adapter survived contact with reality almost untouched** — methods,
  shapes, enums, steer/interrupt/thread-survival all reproduced live. Two error-code details in
  the FAKE were fiction (`-32010`; "id-less -32600") and were corrected to the live-observed
  id-matched `-32600`s; unmapped server→client requests are now answered (anti-wedge) and
  pending approvals are keyed, not single-slotted.
- **The claude session adapter had three live-breaking defects the fake could not see**: no
  permission mode at all (worker couldn't edit files — E1), a steer emulation built on a false
  premise (mid-turn injection is native on this wire — E2), and an approve() shape the CLI
  silently re-asks forever (missing `updatedInput`/`toolUseID` — E3). All three are fixed,
  test-locked against a live-faithful fake, and **re-proven live**: `probe.txt` written under
  `acceptEdits`; a running turn absorbed `prompt(...,'steer')` and answered `REDIRECTED` as its
  single terminal with zero interrupt events; approve-allow ran the tool on the first ask and
  approve-deny blocked it gracefully.

Suite: **340/340**. All eight session verbs are now live-proven on Claude except `answer()`
(elicitation — statically derived) and `pause` (unsupported by design); codex live-proven for
spawn/prompt/steer/interrupt/kill with approvals statically exact against the schema bundle.
The standing rule this earned: **fake-binary green is not "done" — every verb an adapter
declares `native` gets a live smoke, and the fake is corrected to what the live run shows.**
