# Issue #114 — workflow-as-data rung: red-first suite draft notes

- **Suite:** `impl/test/workflow-as-data-red.test.mjs`
- **Contract:** `workflow-as-data-contract.md` v1.1 — red-team #114 FOLDED (B1-B6, OQ2 verb, §0
  citation corrections) — same dir. The blocker → change map for BOTH phases is `contract-fold.md`.
- **Date:** 2026-08-06
- **Split (verified):** `node --test impl/test/workflow-as-data-red.test.mjs` from the repo root,
  run twice — **tests 25 · pass 4 · fail 21**, stable across both runs. Every red row fails at its
  NAMED stage (assert message `stage[...]`); the four green rows are the substrate guards P1-P4.

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
| Steering triggers | `approveOnAdvertisedPlan` · `nudgeOnCheckpoint` · `claimOnStall` · `messageOnSpawn` · `elevateWhenNotes` · `answerDecisions` · `signalOnMembersDone` — surfaced to `receipt.steering[]` (sorted) | W3 rows (nine, incl. the v1.1 bounds rows) |
| Named evidence lines | `steering_message_undelivered` (receipt.steering) · `harvest_miss` (receipt.harvest) — v1.1 D3/D4, never silent | W3-message-bounds / W4-01, W4-02 |
| Harvest per-path receipt | `{ path, ok/missed/matched, code?, waveId, resultSha?, expected?, actual?, pin?, bytes? }` — `code: 'harvest_miss'` names a miss, `waveId` binds the wave (B2), `resultSha` attributes the run's authoritative sha (B1/#99) | W4-01 / W4-02 |

## Row map (red rows → stage → green condition)

| Row | Stage | Green when |
|---|---|---|
| W1-01 top-level closure | `spec-validation-missing` | every malformed top-level field refuses `workflow_spec_invalid` naming the field — `bogusField`, `schemaVersion` (enum: `999`/absent refuses naming the field), `idempotencyKey`, `members`, `steering`, `harvest`, and `verification` (REMOVED — B4: carrying it at all refuses), plus a function smuggled into any known slot (e.g. `steering.messageOnSpawn.body`) refuses as data-not-code (B6) |
| W1-02 member closure | `member-validation-missing` | member-level violations refuse `workflow_member_invalid` naming the member/field (role, dup, inline objective, objectiveRef, scope glob, exact-route closed shape, reserved `work`); a scope entry with a `..` segment / absolute path / backslash / NUL refuses at ADMISSION mirroring path-scope.mjs (B6 — never a late `path_scope_invalid` crash) |
| W1-03 objectiveRef | `objective-ref-invalid` | missing / escapes-repo / oversize objectiveRef refuse `workflow_objective_ref_invalid` naming the ref (the 64 KiB byte bound is contract-pinned in D5) |
| W1-04 steering closure | `steering-unknown` | unknown or mistyped steering keys refuse `workflow_steering_unknown` naming the key — RECURSIVE closure at every nesting level (a nested unknown field in `messageOnSpawn`/`elevateWhenNotes`/`answerDecisions`), and the steering enums are closed: message kinds `inform\|query\|steer`, scratchpad kinds `doubt\|link\|note\|plan` (B6) |
| W1-05 harvest closure | `harvest-invalid` | malformed harvest (paths type, element type, mustContain type, unknown key) refuses `workflow_harvest_invalid` naming the field; a harvest path escaping the repo (lexical `..` or `/etc/...` absolute) refuses `workflow_harvest_invalid` (D4 containment) |
| W1-06 valid spec | `lane-missing` | a valid spec validates and returns the D6 receipt shape `{ basis, harvest, manifestDigest, outcomes, steering, verdict, waveId }` (sorted receipt keys) |
| W2-01 suite re-drive | `lane-missing` | 4-member suite-drafting wave runs from a spec alone: 4 result_ready outcomes each with a 40-hex resultSha + drafted file on disk, basis `completed`, zero driver script (static self-check bans the driver-loop verbs in the suite's own source) |
| W3-approve | `policy-missing:approve-on-advertised-plan` | a member parked `awaiting_plan_approval` is approved ONCE with the advertised 64-hex plan digest; the approved member actually dispatches (adapter spawn) and settles |
| W3-checkpoint | `policy-missing:nudge-on-checkpoint+claim-on-stall` | a pausable checkpoint is nudged and the stalled member claimed — both receipted as steering triggers, member settles |
| W3-message | `policy-missing:message-on-spawn` | a spawn-window message is sent on first-live and receipts with a durable `message:<sha256>` id (the #97 spawn-window retry is exercised, never fatal); member still settles |
| W3-message-bounds | `policy-missing:message-on-spawn` | a non-delivering member draws **≤3** `messageOnSpawn` attempts (a fourth retry does NOT fire) then a NAMED `steering_message_undelivered` evidence line — keyed to a DELIVERED `messageId`, never fatal, never forever (B5) |
| W3-elevate | `policy-missing:elevate-when-notes` | a noted member's scratchpad note is elevated exactly once (kinds/maxEntries bounded) |
| W3-elevate-bounds | `policy-missing:elevate-when-notes` | a member writing notes on successive edits is elevated exactly **once per wave** — refires deduped by `(runId, role)` across the loop, ≤2 retries on typed refusal (B5) |
| W3-answer | `policy-missing:answer-decisions` | a pending decision is answered per the closed policy map (question-text → optionId), the adapter's `answer` receives `optionId: 'opt-a'`, and the member settles |
| W3-answer-bounds | `policy-missing:answer-decisions` | a non-matching pattern DEFERS (no auto-commit, the human stays in the loop); an invalid `optionId` refuses — never a wrong auto-commit, `(runId, requestId)` dedup, first-match-wins insertion order (B5) |
| W3-signal | `policy-missing:signal-on-members-done` | when the named role reaches terminal the remaining member is signaled — the trigger receipts naming the done role, both members settle |
| W4-01 mustContain miss | `harvest-missing` | a `mustContain` mismatch is a NAMED `harvest_miss` (`code: 'harvest_miss'`) — the POST-materialization integrity check, never the selection mechanism (B1); the miss is waveId-bound (B2) and attributed to the run's authoritative result sha (#99 accessor) |
| W4-02 mixed harvest | `harvest-missing` | a harvest over a present + an absent path recovers the present path from the run's authoritative result sha and receipts the absent path as a NAMED `harvest_miss` — both waveId-bound, resultSha attributed (B1/B2) |
| W5-01 import law | `lane-missing` | importing the lane module starts nothing: the module imports cleanly, exports `runWorkflow`, has no top-level await and no network constructors, and re-import is idempotent |
| W6-01 refusal constancy | `lane-missing` | the same malformed spec refuses with an identical `{code, message}` payload on the embedded facade (throw), the CLI (`waves.run` → `body.error`), and the MCP tool (`baton_waves_run` → `structuredContent.error`) — the pinned-accessor payload comparison |
| W6-02 stateFailureCode | `state-failure-allowlist-missing` | the five `workflow_*` codes ride the MCP `stateFailureCode` allowlist (B3) — a `workflow_*` refusal surfaces typed on the wire, never degrading to `command_outcome_unknown` (static source check of the allowlist region, the W2-01/W5-01 pattern) |

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
   a member with `report` + scope yields a 40-hex `resultSha` via `resolveResultPin`).
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
6. **W3 bounds rows use two new adapters.** `MessageDeafAdapter` (overrides `prompt` to refuse
   `[MESSAGE` frames — a genuinely undelivering member) drives W3-message-bounds; a
   `RepeatedNoteWritingAdapter` (writes a note after EVERY `_applyEdit`) drives W3-elevate-bounds'
   refire-dedup assertion.
7. **W6-02 tests the allowlist, not a live wire call.** `stateFailureCode` (mcp-northbound.mjs) is
   not exported, and `baton_waves_run` is absent at HEAD, so no live wire call can raise a
   `workflow_*` code yet (the tool name itself refuses `-32602` before dispatch). The observable
   proxy is the allowlist REGION of `stateFailureCode` — a static source read requiring each code
   as a quoted literal inside the function (the W2-01/W5-01 static-check pattern). Red today; green
   the moment B3 lands.

## Hermeticity & hygiene

- Real `createDriver` stack over `MockAdapter` subclasses (marker-routed scenarios + a calls
  ledger; the pausable adapter; the note-writing adapter; the message-deaf adapter), mkdtemp repos
  + log dirs, git init/commit/rm inside `t.after`. No network, no real provider.
- NUL-byte discipline: the suite contains **0 NUL bytes**; its whole-file source reads are
  `workflow-as-data-red.test.mjs` (itself), the invented `workflow-lane.mjs`, and
  `mcp-northbound.mjs` (NUL-free) — never the NUL-carrying `application.mjs` /
  `coordination-store.mjs` (imports only).
- The W2 zero-driver-script static self-check scans the suite's own source for the driver-loop
  verbs (`nudge_turn`, `claim_turn`, `approve_plan`), wave-handle readers (`.status()`,
  `.progress()`), and pump/timer loops (`setInterval`, `while (`) — none appear anywhere in the
  file, so the row greens only when the spec IS the driver.

## Deployment verification

The execution contract (direct executable `"true"`, empty args, cwd `.`, expected exit 0) passes
trivially and is unchanged by this fold — this suite is the red-first acceptance for the rung's
implementation, not the deployment gate. Run it with:

```sh
node --test impl/test/workflow-as-data-red.test.mjs
```

Expected at this draft: **25 tests, 4 pass (P1-P4), 21 fail at their named stages.**
