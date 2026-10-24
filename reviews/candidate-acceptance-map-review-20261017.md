# Candidate and acceptance-map review for #793/#702

Status: independent review record, 2026-10-17, seat accounts-glm, for the interim ensemble
`accounts-credits-793-702-20261017`, answering the conductor's instruction
`message:accounts-wonder:b07dd26c197951ab8adb17191b0d64ed`. Scope: the current candidate — the
implementation-owner's work as integrated on `account-credit-base` HEAD `1658d45` — and the
acceptance map: which #793 acceptance criteria have which evidence today. This review duplicates
no implementation and triggers no build.

## 1. Candidate state

The worker branch `accounts-deepseek-793-702` stands at the `393cf9d` checkpoint and is
superseded by the integration branch; the worker owns any amendment and must read
`account-credit-base` first (recorded in the flash review and still true). The candidate that
matters is HEAD `1658d45`: the checkpoint plus the ensemble repairs `637f6b6` (D1-D5, pool
wiring), `06c67c1` (conflict cycle scoping), the #792 reads `44db78d`/`a0b4943`/`895f995`
(models-all, Muse partition, enumeration basis), and the G2 repair `1658d45`.

Consolidated correctness status on HEAD, from this seat's reviews:

- Closed and verified in source: D1-D5, D-K1, D-M1 (Muse partition now scopes by model),
  R1's cycle scoping, G2 (bound-account advance with regression test), and the #792 critique
  items C2 and C3. C1 is now implemented: `enumerationBasis` carries recordedSessions,
  queriedSources, recordedAccounts and the explicit `routesListIncluded:false` limit.
- Open, previously adjudicated: G3 both guards (typed JSON refusal; organization/verified_at
  gated on a nonempty id), G4 (spec and funding document state different contracts),
  G5/C12 (status-first 402/400/429 classification), R-G2a (route trigger does not fire for
  account-bound exhaustion), R1's residual (readings omit cycle and observing account),
  #792's C6 (shared-execution marking). Conductor dispositions are recorded: G3 and G6-style
  small fixes land after the remote run, G4 proceeds in parallel, G5/C12 and R-G2a are
  post-acceptance.

No new correctness defect was found on HEAD beyond the adjudicated list.

## 2. Acceptance map: #793 acceptance criteria to evidence

The issue's acceptance sentence is the map's ruler. Evidence classes: **fixture** (a
committed test drives the behavior), **trace** (this seat's code-path prediction, no
execution), **absent**.

| Criterion | Evidence today | Gap |
| --- | --- | --- |
| Two accounts, independent funding routes | fixture (record/read/select, api_key+subscription) | remote run pending |
| Multiple credentials, one organization pool | fixture (pool count, conflict, unknown) | remote run pending |
| Monthly expiry and refresh | partial: expires/cycle stored on one import | **absent**: no multi-observation test proving the newer reading supersedes and the older stays queryable (C5) |
| Fresh, stale, unavailable observations | partial: unavailable tested with previous-on-unavailable; selection carries observationState and creditCycle | stale-as-reported-older-cycle has no dedicated assertion |
| External spend reconciliation | partial: cost operation records `external_spend` with state/balance separated from credit facts | **absent**: no test asserts a spend observation leaves balances untouched end to end (C4's second half) |
| Supported API-key headless execution | **absent**: zero tests execute `api-key-exec.mjs` | the confinement probe this seat specified as C8 — a stub secret file plus a stub command that prints its environment and argv — was never written; the wrapper's value-only-in-child-env invariant has trace evidence only (C8) |
| Concurrent account isolation | **absent**: no two-session advance test (C9) |
| Fixture exhaustion drives fallback | fixture (G2 regression: bound account advances, attempts sequence, same native, handoff report) | remote run pending |
| Preserved conversation and inbox through fallback | partial: same native asserted; **absent**: no owed-input-across-exhaustion test (C11 — guidance suppression and single-read of owed input) |
| All-routes-unavailable notification | **absent**: no last-account-exhaustion test asserting `account-exhausted` and the conductor wake (C7, account layer) |
| Remote compiler/build/test evidence | pending | the named bundle at `1658d45` (G1) |

## 3. The concrete remote-validation gaps

Ranked by acceptance weight:

1. **C8 probe (API-key execution).** The only criterion that exercises the feature's newest
   mechanical boundary has no test at any layer. A node-level fixture (not requiring the
   coordinator binary) can run `api-key-exec.mjs` against a 0600 stub secret and a stub
   command that prints `process.env.ANTHROPIC_API_KEY` presence and its own argv, asserting
   value-in-env-only and reference-only argv; a wider fixture can bind an `api_key` claude-code
   account through a stub provider command that records the same facts. Without one, the
   acceptance row rests entirely on trace.
2. **C7 account-layer exhaustion of the last account.** The G2 regression covers advance;
   the last-account branch (`account-exhausted` report, conductor wake, task retained) is
   unreached by any test.
3. **C11 owed input across exhaustion.** The G2 regression runs with an empty inbox; the
   guidance-suppression and single-read guarantees are unpinned on the account path.
4. **C9 concurrent isolation.** Two sessions on two accounts of one organization, one
   exhausting while the other continues — untested.
5. **C5 refresh ordering and C4 spend isolation.** Small assertions on existing mechanisms,
   currently unasserted.

All five are Python fixtures in the existing harness (the C8 probe additionally a small node
fixture) and none requires implementation changes. Adding them before the remote run converts
five acceptance rows from trace-only to fixture-tested for the cost of one build; adding them
after requires a second build to validate them. This is the map's single largest scheduling
lever, and it is the conductor's call.

## 4. Boundary

The worker branch remains superseded at `393cf9d`; its seat retains ownership and must resync
before amending. No source was edited, no build triggered, and no execution claimed. Every
green/red statement above is a trace against the named commits; the remote bundle owns the
first real verdict.
