# Issue #114 — workflow-as-data rung: red-first suite draft notes

- **Suite:** `impl/test/workflow-as-data-red.test.mjs`
- **Contract:** `workflow-as-data-contract.md` v1.0 (same dir)
- **Date:** 2026-08-06
- **Split (verified):** `node --test impl/test/workflow-as-data-red.test.mjs` from the repo root,
  run twice — **tests 21 · pass 4 · fail 17**, stable across both runs. Every red row fails at its
  NAMED stage (assert message `stage[...]`); the four green rows are the substrate guards P1-P4.

## Invented surfaces (all absent at HEAD 3953f81)

Every invented surface is accessed absence-proof (property access, dynamic import, or namespace
import) so a missing export/module never kills the suite file at LOAD.

| Surface | Exact signature | Where pinned |
|---|---|---|
| `baton.recipes.runWorkflow` | `runWorkflow(spec \| specPath, options?) → Promise<receipt>` | the ONE interpreter lane (D2); every red row reaches it via `laneOf` |
| `impl/src/workflow-lane.mjs` | `{ runWorkflow }` — the importable lane module | W5 (dynamic `import()`, never a top-level static import) |
| CLI verb | `baton wave run <spec.json>` → command `"waves.run"`, args `{ specPath }` | W6-CLI (`parseBatonCli(['wave','run', specPath])`) |
| MCP tool | `baton_wave_run` with args `{ repoId, spec: <object> }` | W6-MCP (`mcpApplicationToolNames` + `wireCall` over a real facade server) |
| Refusal codes | `workflow_spec_invalid` (field-named) · `workflow_member_invalid` (role-named) · `workflow_objective_ref_invalid` (missing/oversize/escapes-repo) · `workflow_steering_unknown` · `workflow_harvest_invalid` | W1-01…W1-05 |
| Steering triggers | `approveOnAdvertisedPlan` · `nudgeOnCheckpoint` · `claimOnStall` · `messageOnSpawn` · `elevateWhenNotes` · `answerDecisions` · `signalOnMembersDone` — surfaced to `receipt.steering[]` | W3 rows (six) |
| Harvest per-path receipt | `{ path, ok/missed/matched, expected?, actual?, pin?, bytes? }` | W4-01 / W4-02 |

## Row map (red rows → stage → green condition)

| Row | Stage | Green when |
|---|---|---|
| W1-01 top-level closure | `spec-validation-missing` | every malformed top-level field refuses `workflow_spec_invalid` naming the field (bogusField, schemaVersion, idempotencyKey, members, steering, harvest, verification) |
| W1-02 member closure | `member-validation-missing` | member-level violations refuse `workflow_member_invalid` naming the member/field (role, dup, inline objective, objectiveRef, scope glob, exact-route closed shape, reserved `work`) |
| W1-03 objectiveRef | `objective-ref-invalid` | missing / escapes-repo / 512 KiB oversize objectiveRef refuse `workflow_objective_ref_invalid` naming the ref |
| W1-04 steering closure | `steering-unknown` | unknown or mistyped steering keys refuse `workflow_steering_unknown` naming the key |
| W1-05 harvest closure | `harvest-invalid` | malformed harvest (paths type, element type, mustContain type, unknown key) refuses `workflow_harvest_invalid` naming the field |
| W1-06 valid spec | `lane-missing` | a valid spec validates and returns the D6 receipt shape `{ outcomes, steering, harvest, verdict, basis, waveId, manifestDigest }` |
| W2-01 suite re-drive | `lane-missing` | 4-member suite-drafting wave runs from a spec alone: 4 result_ready outcomes each with a 40-hex resultSha + drafted file on disk, basis `completed`, zero driver script (static self-check bans the driver-loop verbs in the suite's own source) |
| W3-approve | `policy-missing:approve-on-advertised-plan` | a member parked `awaiting_plan_approval` is approved ONCE with the advertised 64-hex plan digest; the approved member actually dispatches (adapter spawn) and settles |
| W3-checkpoint | `policy-missing:nudge-on-checkpoint+claim-on-stall` | a pausable checkpoint is nudged and the stalled member claimed — both receipted as steering triggers, member settles |
| W3-message | `policy-missing:message-on-spawn` | a spawn-window message is sent on first-live and receipts with a durable `message:<sha256>` id (the #97 spawn-window retry is exercised, never fatal); member still settles |
| W3-elevate | `policy-missing:elevate-when-notes` | a noted member's scratchpad note is elevated exactly once (kinds/maxEntries bounded) |
| W3-answer | `policy-missing:answer-decisions` | a pending decision is answered per the closed policy map (question-text → optionId), the adapter's `answer` receives `optionId: 'opt-a'`, and the member settles |
| W3-signal | `policy-missing:signal-on-members-done` | when the named role reaches terminal the remaining member is signaled — the trigger receipts naming the done role, both members settle |
| W4-01 mustContain miss | `harvest-missing` | a `mustContain` mismatch is a NAMED per-path miss (`missed`/`ok:false`/`match:false`) carrying `expected` + `actual`, never silent |
| W4-02 mixed harvest | `harvest-missing` | a harvest over a present + an absent path receipts BOTH per-path receipts distinctly (found vs miss) |
| W5-01 import law | `lane-missing` | importing the lane module starts nothing: the module imports cleanly, exports `runWorkflow`, has no top-level await and no network constructors, and re-import is idempotent |
| W6-01 refusal constancy | `lane-missing` | the same malformed spec refuses byte-identically (code AND message) on the embedded facade, the CLI (`waves.run`), and the MCP tool (`baton_wave_run`) |

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
2. **OQ2 — CLI spelling pinned to the D2 literal `baton wave run <spec.json>` → `waves.run`.**
   The contract's decision D2 names the verb `baton wave run`; the open question 2 leans
   `waves run` for family consistency. This suite pins D2's literal. If the family spelling wins,
   the W6-CLI row (`parsed.command === 'waves.run'`) is the single place to re-pin.
3. **objectiveRef oversize bound left open (contract OQ-free), exercised at 512 KiB.** The
   contract refuses oversize refs but pins no byte bound. The suite writes a 512 KiB objective
   file (beyond any plausible render/read cap) and asserts the refusal names the ref. Recommended
   bound for the implementation: 64 KiB (documented here, not pinned).
4. **W3-approve proves dispatch via the adapter, not an approve call.** Plan approval is the
   `run.approve` lane (the semantic `approve_plan` action), which is NOT the adapter's worker-side
   `approve()` wait-item — so the row asserts the steering receipt carries the advertised digest
   AND that the parked member was actually dispatched to the adapter (spawn observed).
5. **W3-checkpoint rides the wave-driver-policy pausable machinery verbatim** (turnCompletion
   `'pausable'` + the +1-turnEpoch lockstep), so a checkpoint is genuinely nudged and then
   claimed on the unproductive re-park.

## Hermeticity & hygiene

- Real `createDriver` stack over `MockAdapter` subclasses (marker-routed scenarios + a calls
  ledger; the pausable adapter; the note-writing adapter), mkdtemp repos + log dirs, git
  init/commit/rm inside `t.after`. No network, no real provider.
- NUL-byte discipline: the suite contains **0 NUL bytes**; its only whole-file source reads are
  `workflow-as-data-red.test.mjs` (itself) and the invented `workflow-lane.mjs` — never the
  NUL-carrying `application.mjs` / `coordination-store.mjs` (imports only).
- The W2 zero-driver-script static self-check scans the suite's own source for the driver-loop
  verbs (`nudge_turn`, `claim_turn`, `approve_plan`), wave-handle readers (`.status()`,
  `.progress()`), and pump/timer loops (`setInterval`, `while (`) — none appear anywhere in the
  file, so the row greens only when the spec IS the driver.

## Deployment verification

The execution contract (direct executable `"true"`, empty args, cwd `.`, expected exit 0) passes
trivially and is unchanged by this draft — this suite is the red-first acceptance for the rung's
implementation, not the deployment gate. Run it with:

```sh
node --test impl/test/workflow-as-data-red.test.mjs
```

Expected at this draft: **21 tests, 4 pass (P1-P4), 17 fail at their named stages.**
