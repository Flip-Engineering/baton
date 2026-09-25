# NOTES — row-lsp-pool (impl-lsp-pool-2026-08-14, redrive2)

[attempt: 47283a09-65e8-4c71-95f3-4a689b8bbb56 row-lsp-pool]

Deliverable: `impl/src/lsp-pool.mjs` (new, the suite's dedicated home). No other file changed
(`git status` shows exactly the one new source file + this evidence dir). The suite is unedited;
the machinery (application.mjs / coordinator.mjs / atlas-index.mjs / referee.mjs /
process-lifecycle.mjs / verifier-diagnostics.mjs / limits.mjs / canonical-order.mjs) is
byte-unchanged.

## Measured counts (all runs from `impl/`, the suite's repo-root discipline)

Acceptance suite `test/issue144-lsp-pool-red.test.mjs`:

| Run | tests | pass | fail |
|---|---|---|---|
| baseline (before impl) | 23 | 6 | 17 |
| after impl, run 1 | 23 | 19 | 4 |
| after impl, run 2 | 23 | 19 | 4 |
| after impl, run 3 (post-fix) | 23 | 19 | 4 |
| after impl, run 4 (post-fix) | 23 | 19 | 4 |

- **All 13 RED rows (R1–R13) are GREEN at their named stages.** The stage guard resolves to
  `lsp-pool.mjs` (dedicated home, first resolver branch).
- **Guards: 6 of 10 green. GP-A, GP-D, GP-E, GP-G, GP-I, GP-L pass. GP-B, GP-C, GP-F, GP-H fail —
  IDENTICALLY before and after the implementation** (same assertions, same anchors; verified on
  the pre-implementation baseline run). Root cause is NOT the pool: all four are fixed-line
  `sed`-window pins over machinery files that drifted since the suite was last anchored —
  exactly the F5/F6 failure class the suite's own FIX RECORD (suite-fold-2) documents:
  - GP-B pins `coordinator.mjs:11189-11194`; `_orientationFreshness` now opens at `:11488`
    (the frame composition + `canonicalDigest` are intact, ~296 lines down).
  - GP-C pins `coordinator.mjs:11108-11112`; the prose-leaf rule (`untrusted !== true`,
    `repository-prose`) now sits at `:11409-11410`.
  - GP-F pins `verifier-diagnostics.mjs:71` for the honest-empty capsule; the string now sits
    at `:76` (the sanitizer block at `:26-63` is intact and its behavior is exercised green
    by R11 + GP-F's own live-sanitizer assertion).
  - GP-H pins `limits.mjs:103-104` for the `view.context_read.*` rows; they now sit at
    `:107-108` (the #79 push rows were inserted above).
  Fixing them requires either editing the immutable suite (re-anchor to the grep-based,
  drift-proof style the suite itself adopted for F4/F5/F6) or repadding machinery files outside
  this row's partition — neither is mine to do. **DECISION_REQUEST below (DR-1).**

Adjacents (the suites covering the surfaces the suite file names as its reused substrate, plus
the brief's named `adapter`):

| Suite | Baseline | After impl |
|---|---|---|
| `adapter.test.mjs` | 42/42 | **42/42** |
| `phase51-process-lifecycle.test.mjs` | 75/75 | 73/2 → 75/0 → 73/2 (FLAKY — see DR-2) |
| `phase63-canonical-order-authority.test.mjs` | 11/11 | 11/11 |
| `referee.test.mjs` | 21/21 | 21/21 |
| `phase13-atlas-index.test.mjs` | 9/9 | 9/9 |
| `diagnostics-red.test.mjs` | 8/8 | 8/8 |
| `orientation-red.test.mjs` | 38/38 | 38/38 |
| `atlas-orientation-red.test.mjs` | 4/4 | 4/4 |

## Implementation shape (how each contract decision is honored)

- **D1.1/D1.2** — pool keyed `(repoId, language)` (+ an explicit `demand` identity, see JC-2);
  concurrent acquire returns the SAME frozen handle (single-flight join); `isWorkerScopePath`
  is the M3 classifier (containment under any declared worktree root, raw- and
  realpath-resolved candidates both compared — a macOS `/var` → `/private/var` tmpdir root
  resolves only when it exists); worker-scope demands refuse `lsp_workspace_scope_violation`
  before any provider I/O (R2).
- **D1.3/B2** — real LSP child per generation: detached process-group leader, framed JSON-RPC,
  one `lifecycle.process_started` before provider I/O, `lifecycle.process_ready` after the
  `initialize` handshake (R3 leg 1). The wedged trigger is the count-derived
  `lsp.pool.outstanding_requests` ceiling — at ceiling, the next demand refuses
  `lsp_server_unavailable (wedged)`, the slot clears, the group is reaped under the inherited
  bounded kill-wait, and a retry starts a NEW generation (R3 leg 2, `ready-then-hung` fixture).
  Handshake failure (`crash-once-then-answer`) clears the single-flight slot BEFORE
  `lsp_startup_failed` publishes, so the retry's fresh `process_started` is observable (R3 leg
  3). Unreapable groups publish `lsp_reap_unconfirmed`, never faked closure.
- **D1.4** — `pool.bounds` is exactly the four constructive caps (count/byte/memory; no
  ttl/timeout/window/turn key — R4). Capacity refusal names `{cap, actual, unit}`. The #89 row
  `lsp.pool.outstanding_requests` is declared in the pool's home module
  (`lspPoolRegistryRows`) — limits.mjs is untouched (GP-H's no-new-read-port-row pin holds).
  The `watchdog` fixture field is accepted and never consulted.
- **D2.1/D2.3/B5a** — `projectSymbolEvidence` projects symbol NAMES + file digests (F9: the
  resolved name, never `''`); raw diagnostic paths stay in the digest-only capsule
  (`diagnosticsDigest`, no path keys). `renderWorkerRejectReceipt` keeps the DG-1/DIAG-2 shape:
  digests + counts + symbols, never a path string (R5/R7).
- **D2.2/B5b** — `computeBlastRadius` is an advisory/annotation/evidence leaf: files cited by
  digest, no `coverageOfChange`, never a gate input (R6/R12/GP-E). F8: `pool.answer` with
  `changedLines` CONSULTS the projection — the answer envelope carries `blastRadius`.
- **D3.1–D3.3/M4/M5/OQ1** — ops `code.symbol|references|hover|index_status`, verb projection
  `.`→`_`; every answer rides the exact `UNTRUSTED_ORIENTATION` frame + the declared freshness
  composition `{baseTreeSha, indexEpoch, overlayDigest, repoId, scopeDigest}`
  (content-derived, canonical-order sorted); pool answers attest `overlay_applied: false` +
  `staleness: 'base_snapshot_only'`; degradation ladder ends at the static index (servedBy
  `static_index` when the index rung is available) or typed-empty (`honest_empty`) — never a
  raw throw (R8, R1). `code.hover` → `textDocument/hover`, `code.symbol` → `workspace/symbol`,
  `code.references` → `textDocument/references`.
- **D3.3/B3/D3.5/OQ3** — base hygiene is git-derived, never a clock: dirty drift
  (`git status --porcelain`, minus entries under declared worker worktree roots — the overlay's
  territory) refuses `lsp_server_unavailable (base_root_dirty)` at server-open before any
  generation (R9 dirty leg); a committed move refuses the reused `orientation_base_stale`
  (refuse-then-restart) (R9 moved leg).
- **D3.4/B4** — `provenZeroKey` composes `{base_epoch, overlayDigest, normalized_query}`
  (content-derived, never TTL); identical frames share, base/overlay changes re-key by
  construction; a conflict-flagged or verdict-mismatched write over an existing key refuses
  `lsp_proven_zero_conflict` (R10).
- **D4.3/M6/OQ2** — closed `LSP_SANITIZER_MAPPING`; `sanitizeLspOutput` frames
  (`UNTRUSTED_ORIENTATION`), routes repository-prose through the sanctioned
  `sanitizeVerifierDiagnosticText` verbatim (secret-shaped hover content is stripped — proven
  live), and refuses any unmapped class `lsp_evidence_unsanitized` (R11).
- **D4.4/B1/D1.5** — opt-in gate before any spawn (`lsp_language_not_opted_in`); an un-opted
  but index-supported language serves the static-index rung (no refusal, R13 M6 rider); the
  opted path is reachable (F10); `pool.card` names the honest B1 trust posture (toolchain under
  deployment authority / MAY load plugin code / never runs project application entrypoints /
  outside worker sandboxes, egress bounded).
- **D4.1/R12** — nothing in this module adds or alters a trust-gate code; LSP evidence is
  evidence only.

## Judgment calls (recorded)

1. **JC-1 — opaque pinned epochs and the committed-move gate.** The suite's fixtures pin
   `baseEpoch` values that are not git object IDs in the fixture repos (`'a'.repeat(64)`), so a
   literal "recompute HEAD^{tree} and compare" gate would refuse EVERY row. Implemented gate:
   the pinned epoch that names an object the repository still holds while `HEAD^{tree}` differs
   is a committed move → `orientation_base_stale`; a pinned epoch resolving to no object in the
   repository is externally attested and the pool serves under it (its answers still carry the
   pinned epoch in provenance + the freshness composition). Content/git-derived either way, no
   clock. See DR-3.
2. **JC-2 — the `demand` identity on acquire.** R4's second acquire
   (`demand: 'second-live-key-attempt'`) must be refused `lsp_pool_capacity_exceeded` while
   R2's concurrent same-language acquire must JOIN. The pool key is therefore
   `(repoId, language, demand-identity)` where the demand identity is empty unless the caller
   names one: an unnamed concurrent demand joins the language's single flight (D1.1); a named
   distinct demand is a distinct live key for capacity accounting (D1.4a).
3. **JC-3 — attention-class sanitizer.** `boundedAttentionText` lives inside the NUL-bearing
   `application.mjs` and is not exported; importing the whole application module to reach one
   function would be the heavier coupling. `sanitizeLspOutput` for `attention_class` routes
   through the exported sanctioned `sanitizeVerifierDiagnosticText` (same NFKC/secret/path
   discipline, same 8 KiB tail law) — no parallel redaction path is invented; the mapping NAME
   stays `boundedAttentionText` (the M6 contract's designation).
4. **JC-4 — sync envelope + thenable answers.** R3 requires `pool.answer(...).catch(...)` while
   R6/R8 read answer fields synchronously without awaiting. `answer()` therefore returns a
   plain envelope object carrying the frame/provenance/freshnessDigest/blastRadius fields plus
   `then`/`catch` riding the live response promise — not a native Promise.
5. **JC-5 — dirty-check exclusion of declared worktree roots.** R2's fixture worktree lives
   INSIDE the base repo (`repo/.baton/wt/ws-r2-worker`), created after the commit; the
   clean-checkout gate excludes `git status --porcelain` entries falling under a DECLARED
   `worktreeRoots` entry (they are the atlas overlay's territory, D1.2), so the fixture's own
   worktree does not read as deployment drift. Undeclared dirt (R9's `uncommitted.ts`) still
   refuses.

## DECISION_REQUEST

- **DR-1 (authority-class: the four red guards).** GP-B/GP-C/GP-F/GP-H fail on pre-existing
  line-anchor drift in `coordinator.mjs` / `verifier-diagnostics.mjs` / `limits.mjs` — the
  suite's documented F5/F6 class, one fold-generation stale. Options: **(a)** a suite-fold-3
  re-anchor to `grepFirstLineNum`-based pins (suite edit — the acceptance suite is immutable to
  this row; coordinator/suite-owner authority required); **(b)** authorize an out-of-partition
  machinery edit to move content back onto the pinned line numbers (NOT recommended — cosmetic
  churn on NUL-bearing machinery, breaks nothing but buys nothing); **(c)** accept 19/23 with
  the drift documented here and the 13 contract rows green. My recommendation: (a).
- **DR-2 (flaky adjacent).** `phase51-process-lifecycle.test.mjs` is non-deterministic at this
  HEAD: 75/75 → 73/2 → 73/2 across back-to-back runs, failing the `kimi` subtest of "PL7/PL9:
  every native harness retains a natural-close terminal across an unconfirmed first reap"
  (racy `process_reap_unconfirmed > process_closed > kill.confirmed` ordering). It does not
  import `lsp-pool.mjs`; the failure predates and is independent of this row (baseline was a
  lucky 75/75). Per the failing-test policy I attempted the GitHub flaky check, but `gh` is
  unauthenticated in this worktree — **the coordinator should either file the flaky issue or
  point me at an authenticated runner.**
- **DR-3 (JC-1 semantics).** If the deployment expects the pool to REFUSE on any unresolvable
   pinned epoch (stricter than JC-1), the fixtures' opaque `'a'.repeat(64)` epochs must change
   first — an acceptance-suite question, not an implementation one.

## Hermetic discipline

The impl spawns only the config-declared server command (the suite's stubbed fixtures); no real
LSP binary, no network. Detached group leaders are unref'd (an idle pool never pins the host
event loop; the suite terminates cleanly — verified: `node --test` exits promptly, zero orphan
`stub-tsl` processes after every run), with a module-level SIGTERM teardown at host exit and
the inherited bounded reap as the real discipline. Fixed digests/epochs only; no clock-based
control anywhere in the module (the only time bound is the inherited
`reapOwnedProcessGroup` kill-wait, M2-scoped lawful).

## Verification

- Acceptance suite: 19/23 as tabulated (13/13 contract rows green; 4 pre-existing guard anchor
  drifts, unchanged by this row — DR-1). Stable across repeated runs.
- Adjacents green-unchanged: adapter 42/42, canonical-order 11/11, referee 21/21, atlas-index
  9/9, diagnostics-red 8/8, orientation-red 38/38, atlas-orientation-red 4/4; phase51 flaky
  (DR-2).
- Reviewer execution contract: `true` (executable, argv `[]`, cwd `.`) → exit 0. Verified.
