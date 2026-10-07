IMPL_LSP_POOL-VERIFY v1

[attempt: 47283a09-65e8-4c71-95f3-4a689b8bbb56 coordinator]

# VERIFY NOTES — impl-lsp-pool (coordinator)

Verified-on-disk per the #174 law: the row's worktree (`../../wt/ws-5cfb7ec2dea4e951ec25cf6484a2f07f`,
PID 67539, session 842cd09c) settled; its notes file read in full
(`redrive2/notes-row-lsp-pool.md`, path the wavefile/harvest binds — see DR-A). The row's
deliverable is exactly one new source file (`impl/src/lsp-pool.mjs`); `git status` in the row
worktree shows nothing else changed and the acceptance suite is byte-unchanged.

## What I ran (myself, from the repo root = the row worktree root, the suite's own discipline)

Acceptance suite `impl/test/issue144-lsp-pool-red.test.mjs` — run twice, both stable:

| Run | tests | pass | fail |
|---|---|---|---|
| my run 1 | 23 | 19 | 4 |
| my run 2 | 23 | 19 | 4 |

Per-test mapping (matches the row's own measurement exactly):

- **All 13 RED rows R1–R13: GREEN.** Contract satisfied.
- Guards: **6 of 10 green** — GP-A, GP-D, GP-E, GP-G, GP-I, GP-L pass.
- **GP-B, GP-C, GP-F, GP-H fail — pre-existing fixed-line `sed`-anchor drift**, identical to the
  row's documented baseline, unrelated to the impl (see Not green, below).

## VERDICT: needs-fold with blockers

The **impl is sound**: all 13 contract rows (R1–R13) are green at their named stages, earned by
genuine implementation (spot-audited, below) and not by any suite edit (suites immutable;
`git status` confirms the suite is unedited). All 8 named adjacents are green-unchanged vs the
row's documented baseline (7 clean + 1 flaky-but-independently-so, below).

The **suite is not fully green (19/23)** and therefore needs a fold: the 4 remaining red tests are
guard pins (GP-B/GP-C/GP-F/GP-H) whose pinned line anchors in `coordinator.mjs` /
`verifier-diagnostics.mjs` / `limits.mjs` drifted after the suite was last anchored at commit
`8abe85e` (machinery commits a3e96e8, 49b42d3, d8282d0, 1519102 moved lines between then and the
wave base `09200e9`). Content behind the anchors is intact; only line numbers moved. This is the
F5/F6 failure class the suite's own FIX RECORD (suite-fold-2) documents. Fixing the pins is a
**suite edit** (re-anchor to the grep-based, drift-proof style the suite already adopted for
F4/F5/F6) — outside this coordinator's authority and outside the row's partition. Blocked on
suite-owner authority → **DR-1**.

## Measured counts

Acceptance suite `issue144-lsp-pool-red.test.mjs`: 23 tests → **19 pass / 4 fail**, stable ×2.

Adjacents (the suites the row's notes name as its reused substrate, plus the brief's `adapter`):

| Suite | Row-documented baseline | My run | Verdict |
|---|---|---|---|
| `adapter.test.mjs` | 42/42 | **42/42** | green-unchanged |
| `phase63-canonical-order-authority.test.mjs` | 11/11 | **11/11** | green-unchanged |
| `referee.test.mjs` | 21/21 | **21/21** | green-unchanged |
| `phase13-atlas-index.test.mjs` | 9/9 | **9/9** | green-unchanged |
| `diagnostics-red.test.mjs` | 8/8 | **8/8** | green-unchanged |
| `orientation-red.test.mjs` | 38/38 | **38/38** | green-unchanged |
| `atlas-orientation-red.test.mjs` | 4/4 | **4/4** | green-unchanged |
| `phase51-process-lifecycle.test.mjs` | 75/75 baseline, flaky | 75/75 → 73/2 → 75/75 | **flaky** (DR-2) |

## Not green, and why

1. **GP-B / GP-C / GP-F / GP-H (4 guard pins)** — fixed-line `sed`-window pins over machinery
   files that drifted since the suite was anchored. GP-B pins `coordinator.mjs:11189-11194`
   (`_orientationFreshness` now opens at `:11488`); GP-C pins `coordinator.mjs:11108-11112`
   (prose-leaf rule now at `:11409-11410`); GP-F pins `verifier-diagnostics.mjs:71` (honest-empty
   now at `:76`); GP-H pins `limits.mjs:103-104` (`view.context_read.*` rows now at `:107-108`).
   These fail identically BEFORE and AFTER the impl (the row verified this on its pre-implementation
   baseline; I verified the post-impl failure set is exactly these four and nothing else). They are
   not caused by the impl, and the content the pins guard is intact. Blocked on authority → DR-1.
2. **`phase51-process-lifecycle.test.mjs` (flaky, not a regression)** — non-deterministic at this
   HEAD: I measured 75/75 → 73/2 → 75/75 across three back-to-back runs (the row saw the same
   spread). The failing subtest is the racy `kimi` leg of "PL7/PL9: every native harness retains a
   natural-close terminal across an unconfirmed first reap" (`process_reap_unconfirmed >
   process_closed > kill.confirmed` ordering). It imports no `lsp-pool.mjs` (verified: zero
   references) — independent of this row. `gh` is unauthenticated in my worktree, so I could not
   complete the flaky-issue check myself → DR-2.

## Spot-audit (two stages against the code)

- **R3 (lifecycle seam, wedged trigger).** Suite asserts `acquire` is non-blocking, `ready(language)`
  is what the leg awaits, `process_started` precedes provider I/O and `process_ready` follows the
  handshake, outstanding-past-ceiling refuses `lsp_server_unavailable {reason:'wedged'}` then
  reaps+restarts as a NEW generation, a handshake failure publishes `lsp_startup_failed` AFTER
  clearing the single-flight slot, and `lsp_reap_unconfirmed` is in the family. Audited in
  `impl/src/lsp-pool.mjs`: `acquire` (line 636) is synchronous/join-or-start; `ready` (line 778)
  awaits `server.readyPromise` (a real event-derived seam); the wedged trigger (lines 647–654) is
  `existing.outstanding >= bounds.perServerOutstandingRequests` → `teardownServer(existing,
  'wedged')` + throw `lsp_server_unavailable {reason:'wedged'}`; slot-clear precedes
  `lsp_startup_failed` (lines 612–614); `LSP_REFUSAL_FAMILY` includes `lsp_reap_unconfirmed`.
  The ceiling is the count-derived `lsp.pool.outstanding_requests` registry row declared in the
  pool's home (`lspPoolRegistryRows`) — no clock. **Genuine.**
- **R11 (closed sanitizer mapping).** Suite asserts the closed `LSP_SANITIZER_MAPPING`,
  `repository_prose → sanitizeVerifierDiagnosticText`, hover prose rides the closed UNTRUSTED frame
  with secret-shaped content stripped, and an unmapped class refuses `lsp_evidence_unsanitized`.
  Audited: `sanitizeLspOutput` (line 164) dispatches on the closed mapping; an unmapped class
  throws `lsp_evidence_unsanitized` (lines 167–168); `repository_prose`/`attention_class` route
  through the sanctioned `sanitizeVerifierDiagnosticText` (line 181) and return the
  `UNTRUSTED_ORIENTATION_FRAME` capsule (lines 182–186) — the strip is done by the sanctioned
  sanitizer whose behavior GP-F exercises green. **Genuine.**

Both stages are earned by the implementation, not by suite edits.

## DECISION_REQUEST

- **DR-A (authority-class ambiguity — the reason for this block).** The row's binding brief names
  the notes path `docs/reference/evidence/impl-lsp-pool-2026-08-14/notes-row-lsp-pool.md`
  (top-level); the wavefile/harvest binds `redrive2/notes-row-lsp-pool.md`. The row wrote to the
  **wavefile/harvest path** (`redrive2/`), which is the higher-authority binding document, and I
  read from there. Resolution request: confirm the wavefile path governs member deliverables for
  this wave (as implemented), and reconcile the row brief's stale path. No member content was
  lost either way.
- **DR-1 (the four red guard pins).** GP-B/GP-C/GP-F/GP-H need a suite-fold-3 re-anchor to
  `grepFirstLineNum`-based (drift-proof) pins, or an accepted 19/23 with the drift documented.
  The suite is immutable to row/coordinator; **suite-owner authority required.** Recommendation:
  re-anchor (option (a) of the row's DR-1) — cosmetic-only alternatives churn NUL-bearing
  machinery and buy nothing.
- **DR-2 (flaky adjacent).** `phase51-process-lifecycle.test.mjs` is non-deterministic at this
  HEAD (75/75 → 73/2 → 75/75), independent of this row. `gh` is unauthenticated in this worktree;
  the flaky-issue (tag `bug`) needs filing from an authenticated runner.

## Execution contract

Reviewer executable `true`, argv `[]`, cwd `.`, expected exit 0 — unchanged, passes.
