# Issue #74 — suite fold 2 (blue-team → v1.2 suite): finding → resolution map

Fold of the blue-team report (`suite-blueteam.md`, NEEDS-FOLD — three blockers + two mechanism
errors + the static-anchor churn ruling) into the #74 red-first suite. The v1.2 suite is
`impl/test/worker-orchestrated-swarm-red.test.mjs` — **16 rows: 8 RED at named stages / 8 GREEN
pins** (was 15: 7 RED / 8 GREEN). The fold's contract-side consequences (the D1.2 fixture seam,
the D1.3 denied-record shape + permanence + re-attempt policy, the A2 wave-scoped grant path, the
A8 message-delivery pin, the D4 file-not-directory mechanism) landed in `contract-fold.md` v1.2.
This map routes every blue-team finding to its suite resolution.

- **Fold HEAD (verified):** `3dd41439225267843597ef7ad8820f9b39b74d61` ("Baton private effective-tree
  snapshot"). The blue-team reviewed against `20f68fa`; the v1.1 fold verified against
  `7e68187`; the snapshot history is rewritten and landing re-based every cited line — every
  suite/contract anchor below is re-verified at the v1.2 HEAD, not inherited.
- **Split (measured twice from the repo root):** `node --test
  impl/test/worker-orchestrated-swarm-red.test.mjs` — **16 rows · 8 pass · 8 fail**, identical
  across both runs. Each RED row fails at its NAMED stage:
  `coordinator-read-law-missing` / `read-law-missing` / `steering-trail-falsified` /
  `coordinator-authority-forbidden-missing` / `seat-route-hidden` / `composition-example-refused` /
  `file-not-directory-law-missing`.
- **Deployment verification:** the execution contract (`true`, empty argv, cwd `.`, exit 0) passes
  and is unchanged by this fold — red-first acceptance for the rung's implementation, enforced
  separately.

---

## Fold map (blue-team → v1.2 suite)

| Finding (from `suite-blueteam.md`) | v1.1 verdict | Resolution — where in the v1.2 suite |
|---|---|---|
| **§1.1 (blocker) — A1/A2 fixtures install the permissive authorize, so the D1.2 sibling-refusal legs can never go green.** The deployment seam (`application-deployment.mjs:2012` at the current HEAD) is bypassed by the fixture, which defaults to `authorize = async () => true` (`fixture()`, test `:268`). | blocker → folded | **A1 and A2 now install the restricting authorize in their fixtures** (`restrictingReadAuthorize()`, test `:249-258` — the D1.2 law: `shared` always; a `worker:*` read by the top orchestrator `s74-owner` (review authority, FP-18) always; a swarm-row read only through an explicit wave-scoped grant or `shared`; any other sibling `worker:<role>` read returns `false` → `application_unauthorized` at `application.mjs:3215`). The behavioral GREEN legs (own-scope + shared + owner read) now pass hermetically, and the RED moves to the REAL seam: both rows assert the permissive `authorize: async () => true` literal is ABSENT from `application-deployment.mjs` (the `^[[:space:]]*authorize: async () => true,$` sed pin matches only the seam literal, never the `:2044` comment that quotes it). A correct impl that installs the restrictor at the seam turns both REDs green. |
| **§1.2(a) — A3 requires `denied.optionId === 'opt-a'`, but §D1.3's denied-record shape has no `optionId`/`text`.** A faithful-to-contract impl that drops the attempted option FAILS A3. | amendment → folded | **`optionId?` (and `text?` for the free-text path) folded into §D1.3's record shape and the refusal-vocabulary row** in `contract-fold.md` v1.2. A3 asserts the attempted option: `denied.optionId === 'opt-a'` (test `:798`) — the audit genuinely needs to know which option was attempted. A3b (asserting only `outcome`/`refusal`/`requestId`) is consistent with the shape. |
| **§1.2(b) / §2.1 (blocker) — the permanence half is unpinned.** An impl can record `{outcome:'denied', refusal}` while STILL marking the key handled, and both rows pass. | blocker → folded | **Structural permanence pin** in A3 (test `:802-812`): the pre-answer `s.answeredKeys.add(key)` (`workflow-interpreter.mjs:698`) must be GONE from the `driveLane` body — within the body, any `answeredKeys.add` must come AFTER the `answerDecision` attempt, never before (`preAdd > answerCall`). A denied key stays NOT-handled so the ask stays pending; the D1.3 permanence consequences (ask stays pending, a later human answer settles) are recorded in the draft-notes (§design decision 3 — the settlement leg is the documented non-hermetic successor). |
| **§1.2(c) — the re-attempt policy is undefined.** Remove the pre-answer add and the loop re-attempts a denied ask EVERY poll (~200 at the driver's hardCap), accumulating a `denied` record per poll; the suite's `.find()` masks the spam. | amendment → folded | **Single-denied-record trail shape pinned in A3/A3b** (test `:794-801`, `:842-848`): EXACTLY ONE `denied` record per requestId, and NO later `answered` record for the same requestId (the `answeredSameRequest` filter asserts the absence). The re-attempt policy — "a denied decision is recorded once and never re-auto-answered; the ask is left pending for the human; the interpreter skips `answerDecisions` for a requestId it has already denied" — is stated in §D1.3 pt 4 (contract v1.2). |
| **§1.3 (minor) — A5's GREEN leg could be a hardcoded allowlist of fixture principals; add a second top-orchestrator principal to pin seat-CLASS, not identity.** | SOUND, minor → folded | **A5 adds a second top-orchestrator principal** (test `:877-881`): the fixture's `s74-observer` also starts a wave successfully — the boundary narrows the WORKER seat, never a hardcoded identity list. The worker-seat RED (test `:883-893`) stays: `principalId: 'worker:w-1'` reaching `waves.start` must draw `coordinator_authority_forbidden {attempted:'waves.start', gracefulPath}`. |
| **§1.4 — A6 SOUND** (the registry-view change is already the documented D3 fix; the test drives exposure through `waves.list`, which exists). | SOUND | Carried unchanged (test `:896-948`). The RED asserts `coordinatorRow.route` equals `HEAVY_ROUTE` — the registry view must carry the seat map. |
| **§1.5 — A8's DELIVERY is unpinned.** The interpreter's closed `MESSAGE_KINDS` (`workflow-interpreter.mjs:44`) refuses `kind:'brief'` at admission (the measured RED), but the UNDERLYING boundary (`coordinator.mjs:6864`) still refuses `brief`/`result`, and both delivery paths swallow (`pumpMessageOnSpawn`'s `catch { return; }` `:760`, the `signalOnMembersDone` loop's `catch { /* best-effort */ }` `:730`). An impl widening only the interpreter's admission set passes A8 while the messages are silently dropped. | NEEDS-FOLD → folded | **A8 asserts the DELIVERY end-to-end** (test `:1002-1028`): a `messageOnSpawn` steering entry must carry a DELIVERED durable `messageId` (`^message:[a-f0-9]{64}$`, `delivered > 0`), and the adapter must have RECEIVED the `[MESSAGE brief … — UNTRUSTED]` wire frame carrying that messageId (F3-style — a self-authored receipt without the send fails); `signalOnMembersDone` must name the swarm-row `recipients`, and the adapter must have received the `[MESSAGE result …]` frame. The delayMs-bearing scenarios (coordinator ~120 ms, rows ~240 ms) keep members live across the steering polls so delivery is reachable, not swallowed by instant completion. Forces the coordinator boundary (`coordinator.mjs:6864`) to accept `brief`/`result` end-to-end, not just the interpreter's closed set. |
| **§2.2 (blocker) — A2 over-refusal: the wave-scoped grant path is unasserted.** A restrictor that refuses ALL sibling `worker:<role>` reads — never implementing the grant — passes A2 (own-scope + shared GREEN, sibling RED are both satisfied). | blocker → folded | **A2 asserts the grant path REACHABLE** (test `:712-750`): the fixture-level `restrictingReadAuthorize({ grantedScopes })` mints an explicit wave-scoped grant (`grantedScopes = new Map([['s74-sibling', new Set(['worker:coordinator'])]])`), and the granted swarm-row read of the coordinator's `worker:coordinator` partition SUCCEEDS (test `:747-750`). A refuse-everything restrictor with no grant surface FAILS this leg. The un-granted sibling refusal (test `:753-757`) and the real-seam RED (test `:761-763`) complete the row. |
| **§3.2 — static-anchor ruling: keep ORDER/EXISTENCE/byte-string; drop the tight absolute line windows.** The `+4`/`+14` drift above the dispatch region re-bases the numeric windows on every landing and the comments then lie. | SOUND alarm, churn → folded | **P-A5-static drops the absolute windows** (test `:408-431`): the load-bearing alarms are the ORDER (`start < list < run < gate`, `notInDefinitions.line < start.line`) and the EXISTENCE/byte-string pins (`srcAnchor` throws if a port becomes a definitions entry or the gate-throw marker disappears; the marker carries `run_orchestrator_command_forbidden`). **P-A10 drops the tight windows** (test `:555-586`): the byte-string assertions (`'application_unauthorized'`, `'message_depth_exceeded'`, `'body,inReplyTo'`, the closed five, the D6 return-literal scan) stay; no line-range assertions remain. A normal landing (≤15 lines) never re-bases them. |
| **§4.1 — P-D1.4's loop-shape scan runs on the matched loop line only.** A counter inside the loop body — `processMember`/`answerDecision`/a per-key retry cap — escapes the scan, and the "sequentially uncapped after human answers" half of D1.4 is unguarded. | NEEDS-FOLD (cheap) → folded | **P-D1.4 scans the WHOLE `driveLane` body** via the `driveLaneBody()` awk helper (test `:355-360`): the region between `async function driveLane` and the next TOP-LEVEL `function` (`^(async )?function `; nested `processMember` stays inside), drift-immune — no absolute line windows. The counter regex (`attempts\s*<\s*[0-9]+|counter|iteration`) runs on the whole body (test `:601`), and the wall-clock/hardCap bounds (`pending.size > 0`, `Date.now() - startedAt < driver.hardCapMs`) are asserted as the ONLY loop bounds (test `:599-600`). |
| **§4.3 — P-A8-dir / D4 file-not-directory law: mechanism error + enforcement gap.** `git show <sha>:<dir>` does NOT fail (it returns the tree listing, exit 0); a directory path WITHOUT `mustContain` harvests `ok:true` → the law is not structurally enforced. | NEEDS-FOLD → folded | **(a) Mechanism corrected** in `contract-fold.md` §D4 and the suite comments (`git show` on a tree returns the listing; a directory only refuses via a `mustContain` mismatch today). **(b) NEW RED row A8-dir** (test `:1031-1063`): a directory harvest path WITHOUT `mustContain` must NOT settle the wave — `assert.notEqual(receipt.verdict, 'WAVE-OK')` → `WAVE-INCOMPLETE` with typed `harvest_miss` entries. At HEAD the structural check does not exist and the directory harvest returns `WAVE-OK` → RED at `file-not-directory-law-missing`. **(c) P-A8-dir stays GREEN** (test `:472-500`) as the refusal-shape/basis pin (`basis === manifestDigest` on the incomplete wave) — the internal-consistency relation, acceptable once (b) lands. |

---

## Row-count reconciliation

| Axis | v1.1 suite (15) | v1.2 suite (16) | Δ |
|---|---|---|---|
| RED capability rows | 7 — A1, A2, A3, A3b, A5, A6, A8 | 8 — A1, A2, A3, A3b, A5, A6, A8, **A8-dir** | **+1** (the §4.3(b) structural file-not-directory RED) |
| GREEN pins | 8 — P-A4, P-A5-static, P-A7, P-A8-dir, P-A9, P-A10, P-D1.4, P-A3g | 8 — P-A4, P-A5-static, P-A7, P-A8-dir, P-A9, P-A10, P-D1.4, P-A3g | 0 (all carried; P-A5-static/P-A10 re-based to the §3.2 drift-tolerant pins, P-D1.4 widened per §4.1) |

## What the implementation must land for the REDs to go green (the seam closures)

Five law-closures covering the seven named RED stages (A3/A3b share `steering-trail-falsified`;
A8 and A8-dir are the two D4 closures):

1. **D1.2 at the deployment seam** — `application-deployment.mjs` replaces the permissive
   `authorize: async () => true` with a restrictor honoring the read law (own scope + `shared` +
   the review authority + explicit wave-scoped grants) — turns A1 and A2 green.
2. **D1.3 in the interpreter** — the pre-answer `s.answeredKeys.add(key)` moves after a successful
   `handle.answer` or is removed; the denied/raced path records `{outcome:'denied', refusal:<code>,
   optionId?}` once per requestId and never re-auto-answers — turns A3 and A3b green.
3. **D2 at the waves.\* boundary** — `coordinator_authority_forbidden {attempted, gracefulPath}` for
   the worker seat, the review-authority seat preserved — turns A5 green.
4. **D3 in the registry view** — `waves.list` carries each member's `route` — turns A6 green.
5. **D4 in the message-kind closure AND the harvest admission** — the coordinator boundary
   (`coordinator.mjs:6864`) accepts `brief`/`result` end-to-end with delivery frames (A8), and the
   harvest admission refuses a directory path `harvest_miss` regardless of `mustContain` (A8-dir) —
   turns A8 and A8-dir green.

## Measured drift (fold HEAD `7e68187` → v1.2 HEAD `3dd4143`)

The blue-team's §3.1 measured `fold 7e68187 → current 20f68fa`; landing re-based further. The v1.2
fold re-measured every anchor directly from the trees at `3dd4143`:

| Anchor | fold `7e68187` | v1.2 `3dd4143` | Δ |
|---|---|---|---|
| `name === 'waves.start'` | `application.mjs:12502` | `:12506` | +4 |
| `name === 'waves.run'` | `application.mjs:12512` | `:12516` | +4 |
| recursive gate throw | `application.mjs:12531` | `:12535` | +4 |
| `authorize: async () => true` (deployment seam) | `application-deployment.mjs:1998` | `:2012` | +14 |
| DECISION_REQUEST admission (`case 'decision.requested'`) | `coordinator.mjs:12769` | `:12998` | +229 |
| reconstruction pass (`case 'decision.requested'`) | `coordinator.mjs:13934` | `:14163` | +229 |
| `question.asked` admission seam | `coordinator.mjs:12675-12710` | `:12899-12938` | +224-228 |
| board worker-half (`requestBoardClaim`/`submitBoardReport`) | `coordinator.mjs:11234-11256` | `:11453-11475` | +219 |
| `acquireBoardLease` envelope | `coordinator.mjs:11208-11225` | `:11427-11444` | +219 |
| `_isReviewAuthority` | `coordinator.mjs:7096-7110` | `:7120-7129` | +24-19 |
| `waves.list` read side | `application.mjs:11705-11747` | `:11715-11751` | +10-4 |
| `run.scratchpad.read` dispatch | `application.mjs:12470` | `:12474` | +4 |
| unchanged anchors (verified at `3dd4143`) | `coordination-store.mjs` (1231, 8099-8120, 8793-8803, 1931, 1960, 1990, 2025, 2069, 12556, 13255, 13292, 13533, 14806), `claude-session.mjs` (27, 161, 1132-1141), `workflow-interpreter.mjs` (44, 48-54, 137, 209-214, 260-270, 454-466, 589-602, 615, 693-699, 698, 741-746, 760, 789-809), `application.mjs` (180, 3215, 3304-3312, 4642-4661, 699-701, 1172-1174, 7326, 13040-13041), `application-cli.mjs` (126, 149, 257), `coordinator.mjs` (6864) | same | 0 |

The v1.2 contract (`contract-fold.md`) carries these re-verified anchors; the suite asserts the
drift-tolerant ORDER/EXISTENCE/byte-string pins, never the absolute line windows (the §3.2 ruling).
