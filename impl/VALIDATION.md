# Phase 6 — Qualitative Validation & Judgment

*The methodology's final phase: not "do the tests pass" (they do — 259/259) but "does the thing actually work, and is it what it claims to be." Judged by driving the real assembled system and observing behavior (`node demo.mjs`), then assessing honestly.*

## What was built

A runnable fleet-driver coordinator in ~3,500 lines of dependency-free ESM JavaScript, across 9 modules, assembled by `createDriver()` (`src/index.mjs`) and exercised by 259 tests plus a narrated demo. It runs with `node` — no build step, no external packages, no model quota (workers are a deterministic `MockAdapter`; real Codex/Claude/GLM adapters implement the same interface as the next increment).

## The four claims, judged against observed behavior

1. **"The driver directs workers and the reliability holds."** — **TRUE.** `spawn/send/wait/respond/interrupt/result/list/kill` all work; version-stamps reject stale commands; the append-only log is the sole source of truth and the coordinator rebuilds its state from it on restart. Verified by 48 coordinator tests including the adversarial ones (stale-fence race, double-interrupt resolves, construction replay from log alone).

2. **"'Done' is hard to fool."** — **TRUE, and this is the strongest result.** The demo's scenario 2 shows a worker that *claims* `completed` with `claimedExit=0` while its committed code never creates `done.txt`. The driver re-runs the pinned check itself in a fresh git worktree the worker never touched, observes the failure, and marks the task **`failed`** — and the router records a **loss**, not the worker's claimed win. The referee test proves *freshness* is the mechanism (a `.gitignore`'d `done.txt`, real in the worker's own dir but absent from the fresh checkout, is caught). This is the durable core, working.

3. **"Interruption is dependable, not hopeful."** — **TRUE.** The demo's scenario 3 shows the status flip to `stopping` synchronously, the promise resolving only on the worker's `confirmed` stop, and the slow second edit (scheduled after the interrupt) never reaching disk. Two-phase stop is real.

4. **"Routing learns, from verified outcomes only."** — **TRUE.** The router recorded the honest run as a win (weight 1) and the forged run as a loss (weight 0), keyed by `harness@version` and task type — never from worker self-report.

## Honest limitations (what a green suite does NOT prove)

- **Workers are mocked.** No real Codex/Claude/GLM has been driven yet. The `SubprocessAdapter` stubs are guarded off. The *interface* is proven; the *live vendor integration* (real `codex exec --json` / `claude -p`, real streaming events, real interrupt semantics) is the next increment and will surface real-world friction the mock can't.
- **`.baton/` exclusion is a setup requirement.** The driver keeps worktrees under `<repo>/.baton/`; a repo must exclude it (the demo/e2e do) or `pinBaseSha` sees the repo as dirty. A production driver should add this to `.git/info/exclude` on first touch — a small gap to close.
- **One cosmetic gap:** the story narrative still shows a completed worker as "active" (the completion is a trust-gate event, not a lifecycle one the story counts). Correctness is unaffected; the narrative fold needs a `verify.reverified`→done transition.
- **Not yet built (by design):** the hardened trust-gate rungs above basic re-verify (red→green/coverage/mutation are specced in `docs/21` and partly in the referee, but not wired into the demo path), live steering, the capability/knowledge planes, the MCP northbound surface, and the Elixir/OTP production port (`docs/17`). These are earned-by-demand, gated on the eval.
- **The eval itself is not run.** The whole design (doc 18/kill-case) says the *decisive* next experiment is E2 — does cross-vendor verification catch defects same-vendor misses? That needs real vendors, which this MVP doesn't yet drive.

## Judgment

**The MVP does what it set out to do, and its center of gravity is in the right place.** The single most valuable, most-tested, most-demonstrated property is the one that matters most and is hardest to fake: *the driver does not trust a worker's "done" — it re-derives the truth itself, in isolation, and a lie is caught.* Everything else (dispatch, messaging, two-phase interrupt, recency-biased routing, the story) is real and tested, but that trust gate is the thing that makes an autonomous fleet safe to run at all, and it works as observed.

The build followed the methodology honestly: spec → tests-first → red-team (which found the real cross-module seams before a line of implementation) → blue-hardening → implementation → this validation. The seams the red team predicted (divergent adapter/Brief/event contracts, the trust-gate-not-wired-to-the-referee, the router-not-wired) were exactly the integration bugs that surfaced and were fixed. That is the methodology earning its keep.

**Recommended next step (unchanged from the design):** drive *one real vendor pair* through this same harness and run E2 — the cheap cross-vendor decorrelation test — before building anything above the control/verification plane. The scaffolding to do that is now real, tested, and runnable.
