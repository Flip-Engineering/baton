# Fold — nested-orchestration red suite (suite-fold.md)

*Blue-team report `suite-blueteam.md` (verdict NOT-READY, five blockers) folded into
`impl/test/nested-orchestration-red.test.mjs` against `nested-orchestration-contract.md` (now
v1.2). Run from the repo root: `node --test impl/test/nested-orchestration-red.test.mjs`. Folded
2026-08-06 at HEAD `0d80f08`. NUL discipline honored throughout: `application.mjs` /
`coordination-store.mjs` inspected via `grep -an`/`sed -n` only; `web-auth.mjs` /
`runtime-isolation.mjs` / `web-northbound.mjs` are plain text.*

---

## 1. Blocker → change map

| # | Blocker (blue-team verdict) | Fold change | Evidence |
| --- | --- | --- | --- |
| 1 | **R6 un-greenable as written** — fixture principal `'child'` never fires the contract's `worker:`-prefix binding; a contract-faithful rung cannot refuse it, so R6 stays red forever. | Re-keyed R6's fixture (and its lease) to `principalId: 'worker:child'` (`test.mjs:938`) so the actual security predicate fires; the foreign-run rows are now greenable by the contract's law and still fail today (the vacuous injected `authorize` serves every lane). **Contract edit:** Decision 6 now pins the enforcement INSIDE the facade `_authorize` (`application.mjs:3088`), because the suite's fixture replaces the deployment-injected `authorize` with `async () => true` — the v1.1 "deployment `authorize`" wording was untestable under the suite (drift finding 6). | `grep -an`/`sed -n`: `_authorize` (`application.mjs:3088`) delegates to injected `authorize` (`:2368`); no `worker:`-prefix check anywhere in `application.mjs`/`coordinator.mjs` except the deployment's `goalPlanAuthority` (`application-deployment.mjs:2007`), which the fixture does not use. |
| 2 | **R2 contradicts Decision 3's posture law** — asserted `profile`/`tokenFile`/`url`/`origin` (credential-inventory NAMES) on the public posture; a faithful implementation cannot green it. | Reconciled R2 to the contract's pinned envelope: `{state: 'materialized', profileDigest, tokenDigest, sessionId, orchestratorLeaseId, expiresAt}` — digests/ids only (`test.mjs:808-840`). Added the cut-both-ways teeth: `profile`/`tokenFile`/`token` must be ABSENT (a wrong rung embedding material names on the posture fails). The row still fails today at `connection-projection-missing` (the third options arg is ignored — `runtime-isolation.mjs:59,150-172`). Chose the blue team's option 1 (suite asserts the envelope); no contract edit needed (Decision 3 already carried it). | `sed -n 59,90p` / `sed -n 150,172p` `runtime-isolation.mjs`: `create(workerId, selection)` takes no third arg; posture has no `connectionProjection`. |
| 3 | **P6 false-green child-lane pin** — non-`worker:` principal passed regardless of whether the rung breaks the real child's lane reach; the admit arm had zero coverage. | Re-keyed P6 to `principalId: 'worker:child'` (`test.mjs:644`) and added a sibling-in-subtree admit row (`run:own-sibling` admitted under the SAME lease; board post/read asserted, `test.mjs:646,689-693`) — an over-restrictive binding that only admits the first-admitted child dies here. P6 stays green today and after a correct rung. | Suite run (3× stable): P6 green with the sibling rows. |
| 4 | **R1 never verifies the token FILE's content** — a wrong mint can register a fresh session while writing the PARENT's token (or garbage) to the projected file; the file is the child's real authentication surface. | R1 now reads the projected token file and asserts its bytes `=== minted.session.token + '\n'` (the `tokenBytes` shape), never `=== parentConnection.token + '\n'`; the projected profile is parsed and asserted to carry the parent's url/origin and name its token sibling by basename (the closed discovery shape) (`test.mjs:782-806`). | `sed -n 80,84p` `web-auth.mjs` (`issue` mints a fresh `randomUUID` session + random bearer); contract Decision 3 names the `tokenBytes` shape. |
| 5 | **R4 carve-out scope unpinned** — an over-broad carve-out admitting ANY `run.stop` from any lease holder passed R4+P4 and defeated the no-existence-leak law. | R4 now adds the foreign and unknown `run.stop` rows: a lease-bound child stopping a run whose first-hop lineage carries a DIFFERENT lease id → byte-identical 403 `forbidden`; an unknown runId → the same 403; and `assert.deepEqual(unknownResponse.body, foreignResponse.body)` (unknown ≡ foreign, no existence leak) (`test.mjs:886-906`). These are constancy teeth inside the red row — they pass today (no carve-out = everything 403) and flip red on an over-broad carve-out after the rung. | `sed -n 614,631p` `web-northbound.mjs`: the unconditional capability gate at `:625-629`; contract Decision 6 / NP-02 foreign/unknown rows. |

Non-blocking items (folded alongside):

| Item | Fold change |
| --- | --- |
| R8 session-revocation half unpinned (session already expired when asserted — `authenticate === null` was trivially true). | R8 now issues the child session with a LONG TTL, binds the lease to THAT session's id (`workingParent(..., childSession.sessionId)`), and asserts the session is LIVE at sweep time (`authenticate` returns a principal) before the sweep; after the sweep asserts `isPrincipalActive(live) === false` AND `authenticate === null` — a sweep that only revokes leases (or only counts orphans) fails (`test.mjs:1036-1059`). This models Decision 5's durable-records rule: the sweep re-derives the orphaned session from the lease payload, never from a volatile ledger. |
| R7's session proof indirect (`isPrincipalActive(null)` is trivially false). | R7 now captures the live principal BEFORE the revoke and asserts `sessions.authenticate(...) === null` DIRECTLY (the stronger proof), keeping the `isPrincipalActive` check (`test.mjs:987-1017`). |
| Invented `mintChildAuthority`/`revokeChildAuthority`/`sweepChildOrphans` signatures (drift findings 3-5) drifted from the contract's `workerId`/`leaseDigest` surfaces. | Locked: the mint call now passes `workerId: 'child-r1'` and R1 asserts the minted session carries the contract's `userId: 'worker:child-r1'` (`test.mjs:758,777-779`); the revoke call now passes `leaseDigest: parent.lease.leaseDigest` (the store's `revokeRunOrchestratorLease` exact-key-set requirement, `coordination-store.mjs:1926-1937`) (`test.mjs:1008`). The suite header documents the driveable-surface lock: the exported seams take the stores/runtimeRoot explicitly (a superset of the contract's closure signatures); `workerId`/`leaseDigest` named exactly as Decision 4a. Contract Decision 4a now records the driveable acceptance surface. |

---

## 2. Before/after splits

| | Before (baseline) | After (folded) |
| --- | --- | --- |
| Tests | 15 (7 pins + 8 reds) | 15 (7 pins + 8 reds) — no row added or removed |
| Pins green | P1-P7 | P1-P7 (P6 re-keyed to `worker:child` + sibling row; still green) |
| Reds failing | R1-R8 | R1-R8, each at its SAME named stage |
| Split | 7 pass / 8 fail | 7 pass / 8 fail (stable, 4 consecutive runs) |

Per-red stage attribution after the fold (all fail at their first assertion, no earlier fixture
crash):

| Row | Named stage | Failing assertion |
| --- | --- | --- |
| R1 | connection-mint-missing | `typeof connectionAuthority.mintChildAuthority === 'function'` (absent export) |
| R2 | connection-projection-missing | `assert.ok(created.posture.connectionProjection)` (third arg ignored) |
| R3 | xdg-delete-missing | `created.env.XDG_CONFIG_HOME === undefined` → `'/home/orchestrator/.config'` |
| R4 | runstop-carveout-missing | `response.status === 200` (own-subtree admit arm) → `403` |
| R5 | legacy-refusal-missing | `response.status === 403` (spawn family) → `200` |
| R6 | lane-scope-binding-missing | `refusal?.code === 'application_unauthorized'` (first lane, `run.message.send`) → `undefined` |
| R7 | terminal-revoke-missing | `typeof connectionAuthority.revokeChildAuthority === 'function'` (absent export) |
| R8 | orphan-sweep-missing | `typeof connectionAuthority.sweepChildOrphans === 'function'` (absent export) |

Run record (repo root, `node --test impl/test/nested-orchestration-red.test.mjs`):

| Run | tests | pass | fail | duration |
| --- | --- | --- | --- | --- |
| 1 | 15 | 7 | 8 | 4.62 s |
| 2 | 15 | 7 | 8 | 4.59 s |
| 3 | 15 | 7 | 8 | 4.61 s |
| 4 (final confirm) | 15 | 7 | 8 | 4.64 s |

---

## 3. Contract edits (all v1.2, header bumped)

1. **Decision 6 — lane-scope binding seam pinned.** The v1.1 wording ("the deployment `authorize`
   admits… or the pre-gate dispatch passes the sessionAuthority through — the plumbing is the
   implementer's call") was unsatisfiable under the suite, whose fixture replaces the
   deployment-injected `authorize` with `async () => true`. Amended: the enforcement lives INSIDE
   the facade `_authorize` (`application.mjs:3088`), before/independent of its delegation to the
   injected function. This is the fold's Blocker-1 resolution: with the fixture's vacuous injected
   authorize, a law placed only in the deployment-injected function can never fire R6's foreign
   refusal or P6's admit arm.
2. **Decision 4a — driveable acceptance surface recorded.** The suite drives the mint/revoke/sweep
   as exported `index.mjs` seams with the stores/runtimeRoot explicit; `workerId`/`leaseDigest`
   named exactly as the closure signatures; a closure-based deployment wrap honors them or is a
   thin wrapper over the exported functions. This locks drift findings 3-5.

No other contract text changed: the blue team's other blockers were resolved by suite changes to
match the contract (R2 → Decision 3 envelope; R4 → NP-02 rows; R1 → Decision 3 tokenBytes; R8 →
Decision 5 durable-records rule), not by amending the contract's laws.

---

## 4. Rejected / deferred items with reasons

1. **Rejected — "key the binding on live-lease-holders, rejecting owner byte-stability" (Blocker
   1's alternative contract change).** Not taken: it would break NP-07 (the owner's omnipotent
   posture byte-identical). The suite-side fix (worker-prefixed fixture) keeps the contract's
   scoping law intact. The blue team's primary fix was adopted.
2. **Rejected — R2 option 2 (contract amends the no-inventory law to admit material on the
   posture).** Not taken: Decision 3/7 and NP-01 pin the digest-only posture as a deliberate law
   ("the posture's no-paths/no-inventory law"); amending it would weaken the contract's honesty
   posture and NP-01's receipt shape. The suite now asserts the contract's envelope (option 1).
3. **Deferred — R4's rows exercise the refusal at the TRANSPORT carve-out's scope check (the
   store's first-hop law), not the application `_stop` command-path re-check
   (`application.mjs:12877`).** The transport fixture's `applicationRecorder` stands in for the
   application, so `_stop`'s second-layer re-check is not reached. The rows still pin the
   end-to-end law (an over-broad carve-out that admits any target flips them red regardless of
   which layer enforces scope), so Blocker 5's teeth requirement is met; a dedicated
   facade-`_stop` row is a candidate for the implementation wave, not this fold.
4. **Deferred — R7/R8 fixtures keep non-`worker:` principals (`'child-r7'`/`'child-r8'`).** These
   rows test the revocation/sweep MECHANICS (sessionId/leaseId/leaseDigest surfaces), where the
   prefix predicate is irrelevant; re-keying them would churn the fixtures for no teeth. The
   `worker:`-prefix predicate is now exercised by R5 (legacy refusal), R6 (foreign refusal), P6
   (admit arm), and R1 (minted `userId: 'worker:child-r1'`). The blue team's drift finding 1 is
   thereby addressed at every seam that keys on the prefix.
5. **Deferred — P3/P4/P7 constancy pins still use owner-like principals.** These pin the gate /
   transport / resolve-then-authorize constancy that the rung must NOT change; they are
   deliberately owner-shaped (the byte-stability base). The blue team's blocker 3 fix re-keyed P6
   only, which this fold does.
6. **Deferred — `sweepChildOrphans` `deadlineMs`/`runtime` args remain unasserted.** They are the
   sweep's driveable environment (the deadline bound and the runtime-scope reconciler handle),
   documented in the suite header; the sweep's BEHAVIOR (count + lease revoke + live-session
   revoke) is pinned by R8. Asserting `deadlineMs` semantics would over-constrain the sweep's
   implementation shape (the contract's Open Question 2 leaves the sweep's fold to the
   implementer).
7. **Rejected — no blue-team claim was wrong on the code.** Every blocker and drift finding
   verified against the sources (the `_authorize` delegation, the absent `connectionAuthority`
   exports, `issue`'s fresh `randomUUID` session, the `revokeRunOrchestratorLease` exact key set,
   the ignored third `create` arg, the capability gate at `web-northbound.mjs:625-629`). No
   finding required rejection with counter-evidence.

---

## 5. Verification notes

- The suite never reads `application.mjs`/`coordination-store.mjs`/`coordinator.mjs` wholesale;
  `connectionAuthority.*` remains absent from `index.mjs` (grep-verified), so every exported-surface
  red fails at its named stage without a load-time crash.
- P6 stays green with the `worker:child` principal AND the sibling-in-subtree row — the lanes'
  `_authorize` is the vacuous injected function today, and `_isReviewAuthority` /
  `activeRunOrchestratorLeaseForSession` match the lease purely by principalId/sessionId/parent-run
  (no prefix denial), verified via `sed -n` before re-keying.
- The split is exact and stable across four consecutive runs (7 pins green / 8 reds at named
  stages, ~4.6 s each), matching the blue team's baseline record while every blocker is closed.
