# Issue #114 — workflow-as-data rung: red-first suite draft notes

- **Suite:** `impl/test/workflow-as-data-red.test.mjs`
- **Contract:** `workflow-as-data-contract.md` v1.2 — red-team #114 FOLDED (B1-B6, OQ2 verb, §0
  citation corrections) **+ blue-team suite-fold-2** (D1 `report` field F2, D1 admission union F12,
  D3 delivered-keying F1). The blocker → change map for BOTH phases is `contract-fold.md`; the
  finding → resolution map for the suite fold is `suite-fold-2.md` (same dir).
- **Date:** 2026-08-06
- **Split (verified):** `node --test impl/test/workflow-as-data-red.test.mjs` from the repo root,
  run twice — **tests 29 · pass 4 · fail 25**, stable across both runs (see the measured-split
  table in `suite-fold-2.md`). Every red row fails at its NAMED stage (assert message `stage[...]`);
  the four green rows are the substrate guards P1-P4.

## Invented surfaces (all absent at HEAD 3953f81)

Every invented surface is accessed absence-proof (property access, dynamic import, or namespace
import) so a missing export/module never kills the suite file at LOAD.

| Surface | Exact signature | Where pinned |
|---|---|---|
| `baton.recipes.runWorkflow` | `runWorkflow(spec \| specPath, options?) → Promise<receipt>` | the ONE interpreter lane (D2); every red row reaches it via `laneOf` |
| `impl/src/workflow-lane.mjs` | `{ runWorkflow }` — the importable lane module | W5 (dynamic `import()`, never a top-level static import) |
| CLI verb | `baton waves run <spec.json>` → command `"waves.run"`, args `{ specPath }` | W6-CLI (`parseBatonCli(['waves','run', specPath])`) — the family PLURAL, OQ2 folded NOW |
| MCP tool | `baton_waves_run` with args `{ repoId, spec: <object> }` | W6-MCP (`mcpApplicationToolNames` + `wireCall` over a real facade server) — family plural |
| Refusal codes (the five `workflow_*`) | `workflow_spec_invalid` (field-named) · `workflow_member_invalid` (role-named, scope admission) · `workflow_objective_ref_invalid` (missing/oversize/escapes-repo) · `workflow_steering_unknown` (key/enum-named) · `workflow_harvest_invalid` (containment/paths) | W1-01…W1-05; W6-02 pins all five on the MCP `stateFailureCode` allowlist (B3) |
| Steering triggers | `approveOnAdvertisedPlan` · `nudgeOnCheckpoint` · `claimOnStall` · `messageOnSpawn` · `elevateWhenNotes` · `answerDecisions` · `signalOnMembersDone` — surfaced to `receipt.steering[]` (sorted) | W3 rows (eleven, incl. the v1.1 bounds rows and the suite-fold-2 rows W3-answer-first-match / W3-answer-free) |
| Named evidence lines | `steering_message_undelivered` (receipt.steering) · `harvest_miss` (receipt.harvest) — v1.1 D3/D4, never silent | W3-message-bounds / W4-01, W4-02 |
| Harvest per-path receipt | `{ path, ok/missed/matched, code?, waveId, resultSha?, expected?, actual?, pin?, bytes? }` — `code: 'harvest_miss'` names a miss, `waveId` binds the wave (B2), `resultSha` attributes the run's authoritative sha (B1/#99) | W4-01 / W4-02 |

## Row map (red rows → stage → green condition)

| Row | Stage | Green when |
|---|---|---|
| W1-01 top-level closure | `spec-validation-missing` | every malformed top-level field refuses `workflow_spec_invalid` naming the field — `bogusField`, `schemaVersion` (enum: `999`/absent refuses naming the field), `idempotencyKey`, `members`, `steering`, `harvest`, and `verification` (REMOVED — B4: carrying it at all refuses), plus a function smuggled into any known slot (e.g. `steering.messageOnSpawn.body`) refuses as data-not-code (B6) |
| W1-02 member closure | `member-validation-missing` | member-level violations refuse `workflow_member_invalid` naming the member/field (role, dup, inline objective, objectiveRef, scope glob, exact-route closed shape, reserved `work`); a scope entry with a `..` segment / absolute path / backslash / NUL refuses at ADMISSION — the wave.mjs member laws PLUS the path-scope class (F12), never a late `path_scope_invalid` crash |
| W1-03 objectiveRef | `objective-ref-invalid` | missing / escapes-repo / oversize objectiveRef refuse `workflow_objective_ref_invalid` naming the ref — the oversize case is EXACTLY 64 KiB + 1 (D5's bound pinned at its value, F8b), and a symlink-escape objectiveRef (`repo/notes` → outside dir) refuses via the lexical + realpath double check (F8c) |
| W1-04 steering closure | `steering-unknown` | unknown or mistyped steering keys refuse `workflow_steering_unknown` naming the key — RECURSIVE closure at every nesting level (a nested unknown field in `messageOnSpawn`/`elevateWhenNotes`/`answerDecisions`), and the steering enums are closed: message kinds `inform\|query\|steer`, scratchpad kinds `doubt\|link\|note\|plan` (B6) |
| W1-05 harvest closure | `harvest-invalid` | malformed harvest (paths type, element type, mustContain type, unknown key) refuses `workflow_harvest_invalid` naming the field; a harvest path escaping the repo (lexical `..`, `/etc/...` absolute, or a symlink-escape realpath — F8c) refuses `workflow_harvest_invalid` (D4 containment) |
| W1-06 valid spec | `lane-missing` | a valid spec validates and returns the D6 receipt with EXACTLY the seven sorted keys `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']` (F14 — no extra keys, actual sorted order), `verdict === 'WAVE-OK'` and `basis === 'completed'` (F9) |
| W2-01 suite re-drive | `lane-missing` | 4-member suite-drafting wave runs from a spec alone: 4 result_ready outcomes each with a 40-hex resultSha + drafted file on disk, `verdict === 'WAVE-OK'` (F9), basis `completed`; zero per-wave driver script — the F15 self-check is DROPPED, the F10b transitive walk carries the no-bespoke-driver law onto the implementation's module graph |
| W3-approve | `policy-missing:approve-on-advertised-plan` | a member parked `awaiting_plan_approval` is approved ONCE with the advertised 64-hex plan digest — the adapter spawn brief carries `goalPlan.planDigest` and the approval used THAT digest (F3, never a self-authored receipt event); the approved member dispatches (adapter spawn) and settles |
| W3-checkpoint | `policy-missing:nudge-on-checkpoint+claim-on-stall` | a pausable checkpoint is nudged and the stalled member claimed — both receipted as steering triggers AND the nudged member actually RESUMED (a real `mode:'turn'` prompt follows the checkpoint, F3); member settles |
| W3-message | `policy-missing:message-on-spawn` | a spawn-window message is sent on first-live and receipts with a durable `message:<sha256>` id — the adapter received the coordinator's `[MESSAGE` delivery frame carrying the receipted messageId (F3); member still settles |
| W3-message-bounds | `policy-missing:message-on-spawn` | a non-delivering member draws **≤3** `messageOnSpawn` attempts (a fourth retry does NOT fire) then a NAMED `steering_message_undelivered` evidence line — every attempt receipts `delivered: 0` AND the adapter was hit with EXACTLY 3 `[MESSAGE` frames (F1: the deaf adapter THROWS; only a rejection yields `delivered: 0`); never fatal, never forever (B5) |
| W3-elevate | `policy-missing:elevate-when-notes` | a noted member's scratchpad note is elevated exactly once (kinds/maxEntries bounded) — the coordination store snapshot carries the elevation record with `sourceEntryId` (F3) |
| W3-elevate-bounds | `policy-missing:elevate-when-notes` | a member writing notes on successive edits is elevated exactly **once per wave** — refires deduped by `(runId, role)` across the loop, ≤2 retries on typed refusal (B5); the store's elevation records are `sourceEntryId`-carrying (F3) |
| W3-answer | `policy-missing:answer-decisions` | a pending decision is answered per the closed policy map (question-text → optionId), the adapter's `answer` ledger received `{ optionId: 'opt-a' }` (F3), and the member settles |
| W3-answer-bounds | `policy-missing:answer-decisions` | a non-matching pattern DEFERS (no auto-commit, the human stays in the loop); an invalid `optionId` refuses — never a wrong auto-commit (B5). Insertion-order first-match-wins is its own row (W3-answer-first-match, F7b); the free-response path is its own row (W3-answer-free, F7d) |
| W3-answer-first-match | `policy-missing:answer-decisions` | two policy patterns match one question — the insertion-order FIRST match wins (F7b): the exact literal beats the anchored pattern; the adapter's `answer` carries the first match's `optionId` |
| W3-answer-free | `policy-missing:answer-decisions` | an `allowFreeResponse: true` decision is answered with the mapped TEXT, never an `optionId` (F7d) — the adapter's `answer` carries `{ text }` |
| W3-signal | `policy-missing:signal-on-members-done` | when the named role reaches terminal the remaining member is signaled — the trigger receipts naming the done role AND the remaining member received the `[MESSAGE` signal frame (F3); both members settle |
| W4-01 mustContain miss | `harvest-missing` | a `mustContain` mismatch is a NAMED `harvest_miss` (`code: 'harvest_miss'`) — the POST-materialization integrity check, never the selection mechanism (B1); the miss is waveId-bound (B2), attributed to the run's authoritative result sha (`entry.bytes` is the git blob at `resultSha`, F5), and the recovered content carries the wave's `[attempt: <salt>]` marker (F4) |
| W4-02 mixed harvest | `harvest-missing` | a harvest over a present + an absent path recovers the present path from the run's authoritative result sha (F5: the working-tree file is DELETED after settle and `entry.bytes` still equals the blob at `resultSha`) and receipts the absent path as a NAMED `harvest_miss` — both waveId-bound, resultSha attributed (B1/B2), content carries the attempt marker (F4); `verdict === 'WAVE-INCOMPLETE'` with `basis === manifestDigest` (F9) |
| W4-03 markerless miss | `harvest-missing` | a byte-similar artifact WITHOUT the wave's `[attempt: <salt>]` marker receipts a NAMED `harvest_miss` — the D4 marker check is the attribution discriminator (F4) |
| W4-04 mustContain PASS | `harvest-missing` | a `mustContain` that MATCHES passes the post-check (F8d) with `expected`/`actual` receipted — never a `harvest_miss`, and the content still carries the attempt marker |
| W5-01 import law | `lane-missing` | importing the lane module starts nothing: the module imports cleanly, exports `runWorkflow`, has no top-level await and no network constructors, re-import is idempotent, AND the transitive module graph contains no top-level `await openBaton(` / `waves.start(` call site (F10b — the vacuous recording facade is gone, F10a) |
| W6-01 refusal constancy | `lane-missing` | the same malformed spec refuses with an identical `{code, message}` payload on the embedded facade (throw — driven with the fast driver policy, F11), the CLI (`waves.run` → `body.error`), and the MCP tool (`baton_waves_run` → `structuredContent.error`); the singular `wave run` / `baton_wave_run` spellings are refused (F6) — the pinned-accessor payload comparison |
| W6-02 stateFailureCode | `state-failure-allowlist-missing` | the five `workflow_*` codes ride the MCP `stateFailureCode` allowlist (B3) — EITHER as five quoted literals OR as a `startsWith('workflow_')` prefix-preservation branch (F13); a `workflow_*` refusal surfaces typed on the wire, never degrading to `command_outcome_unknown` (static source check of the allowlist region, the W2-01/W5-01 pattern) |

### Green guards (must stay green)

| Row | Pin |
|---|---|
| P1 | `createWave` / `resolveResultPin` / `MAX_WAVE_PROGRESS_BYTES` (wave.mjs), `createWaveDriver` (index re-export), `createRecipes` (recipes.mjs) all resolve |
| P2 | `baton.recipes` is a frozen object exposing `run` and `implementContract` |
| P3 | `createWaveDriver(baton, { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall', … })` constructs without throwing |
| P4 | `MAX_WAVE_PROGRESS_BYTES === 7 * 1024 * 1024`; `createWave` refuses a 65-member array |

## Design decisions made in the draft (beyond the contract's text)

1. **The member `report` field is declared.** The D1 JSON's member shape (`role / exact / scope /
   objectiveRef`) is the minimal illustration; the suite pins `report` (the member's report path)
   as a declared member field because the bespoke drivers' members carry it and the D6 outcomes'
   `resultSha` must materialize exactly as the bespoke waves' outcomes did (verified empirically:
   a member with `report` + scope yields a 40-hex `resultSha` via `resolveResultPin`). Suite-fold-2
   closes the F2 contract gap: the v1.2 contract D1 now declares `report` as an allowed member
   field (containment class like `objectiveRef`, never executed).
2. **OQ2 is FOLDED NOW — the verb is the family plural `baton waves run` / `baton_waves_run`.**
   The v1.0 draft leaned D2's literal (`baton wave run`); the fold resolves the open question to
   `waves run` for family consistency (the existing family is plural on both surfaces). W6-01 is
   the single place that pins the spelling.
3. **objectiveRef oversize bound is contract-pinned at 64 KiB (D5).** The v1.0 draft left the bound
   open and exercised 512 KiB; v1.1 folds the 64 KiB byte bound into the contract, and W1-03 keeps
   an oversize case.
4. **W3-approve proves dispatch via the adapter, not an approve call.** Plan approval is the
   `run.approve` lane (the semantic `approve_plan` action), which is NOT the adapter's worker-side
   `approve()` wait-item — so the row asserts the steering receipt carries the advertised digest
   AND that the parked member was actually dispatched to the adapter (spawn observed).
5. **W3-checkpoint rides the wave-driver-policy pausable machinery verbatim** (turnCompletion
   `'pausable'` + the +1-turnEpoch lockstep), so a checkpoint is genuinely nudged and then
   claimed on the unproductive re-park.
6. **W3 bounds rows use two new adapters.** `MessageDeafAdapter` (overrides `prompt` to THROW on
   `[MESSAGE` frames — a genuinely undelivering member; a resolve-with-`{ok:false}` is counted as
   delivered by `sendMessage`'s chain, so the throw is the only way to produce `delivered: 0`,
   F1) drives W3-message-bounds; a `RepeatedNoteWritingAdapter` (writes a note after EVERY
   `_applyEdit`) drives W3-elevate-bounds' refire-dedup assertion.
7. **W6-02 tests the allowlist, not a live wire call.** `stateFailureCode` (mcp-northbound.mjs) is
   not exported, and `baton_waves_run` is absent at HEAD, so no live wire call can raise a
   `workflow_*` code yet (the tool name itself refuses `-32602` before dispatch). The observable
   proxy is the allowlist REGION of `stateFailureCode` — a static source read requiring EACH code
   as a quoted literal OR a `startsWith('workflow_')` prefix-preservation branch (F13; the
   W2-01/W5-01 static-check pattern). Red today; green the moment B3 lands.
8. **F11 — every happy-path row threads the fast driver policy.** `LANE_DRIVER =
   { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }` (the exact P3 vocabulary) rides
   `driveLane` on every W1-W4/W6 happy-path row — a faithful implementation never runs the 20 s
   default poll, so the W3/W4 timing budgets stay bounded and load-insensitive. Scenario `delayMs`
   budgets are re-derived to 100 ms (F16) — well under `stallTimeoutMs: 400`, so a deliberate
   mid-turn pause never trips the wave-level stall clock.
9. **F4 — `carryAttemptMarker` scenario option.** A `TrackingMarkerAdapter` scenario flagged
   `carryAttemptMarker` extracts the wave's real salt line from the spawn brief
   (`/^\[attempt: [^\]]+\] /u` on `brief.goal` — `createWaveDriver` salts the member objective,
   `wave-driver.mjs:312-316`) and prepends it to every edit, so the committed report carries the
   wave's actual attempt marker and the D4 verification can accept it. W4-01/W4-02 use it; W4-03
   deliberately does NOT (the markerless-miss row).
10. **F7a / F7c are DEFERRED** (documented in `suite-fold-2.md`): the elevation typed-refusal
    retry row needs a 512-entry scratchpad partition (`scratchpad_partition_exhausted`) or fence
    timing (`stale_scratchpad_fence`) — neither reachable deterministically in the hermetic mock;
    the `(runId, requestId)` replay-dedup row needs a same-requestId replay the single-ask mock
    cannot produce. Both stay contract text (D3) with depending-on-real-coordinator rows.
11. **F16 — fixed far-future clock.** `mockPrincipal` uses a fixed far-future `expiresAt` and
    `realServer` injects a fixed far-future `now` — no wall-clock TTL can lapse mid-test on a slow
    green-state MCP leg, and the server's TTL checks are deterministic.

## Hermeticity & hygiene

- Real `createDriver` stack over `MockAdapter` subclasses (marker-routed scenarios + a calls
  ledger; the pausable adapter; the note-writing adapter; the message-deaf adapter), mkdtemp repos
  + log dirs, git init/commit/rm inside `t.after`. No network, no real provider.
- NUL-byte discipline: the suite contains **0 NUL bytes**; its whole-file source reads are
  `workflow-as-data-red.test.mjs` (itself), the invented `workflow-lane.mjs`, and
  `mcp-northbound.mjs` (NUL-free) — never the NUL-carrying `application.mjs` /
  `coordination-store.mjs` (imports only).
- The "no bespoke per-wave driver" law is carried by W5-01's F10b transitive module-graph walk
  (col-0-anchored `await openBaton(` / `waves.start(` scan over the lane's static import graph) —
  the F15 self-check that scanned the suite's own source was DROPPED (it could only catch the
  test author, never an implementation shipping a bespoke driver).

## Deployment verification

The execution contract (direct executable `"true"`, empty args, cwd `.`, expected exit 0) passes
trivially and is unchanged by this fold — this suite is the red-first acceptance for the rung's
implementation, not the deployment gate. Run it with:

```sh
node --test impl/test/workflow-as-data-red.test.mjs
```

Expected at this draft: **29 tests, 4 pass (P1-P4), 25 fail at their named stages** (measured
twice, stable — the fold split table is in `suite-fold-2.md`).
