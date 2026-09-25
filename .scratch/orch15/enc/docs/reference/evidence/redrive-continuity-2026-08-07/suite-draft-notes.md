# #59 Suite Draft Notes — `redrive-continuity-red.test.mjs`

Date: 2026-08-07 · Contract: **re-drive continuity v1.1** (folded) · Suite: 28 rows (23 RED / 5 PIN)
Deliverable: `impl/test/redrive-continuity-red.test.mjs` (this draft's only other deliverable).
Authority: `redrive-continuity-contract.md` (v1.1 source of truth), `contract-fold.md` (the seven
blocker resolutions: per-item `[carried/untrusted]` frames, body neutralization at the render seam,
both renderers pinned, the ONE total render order across the #59/#69/#79 carried-content sections,
the `view.continuity.*` registry rows + the digest-cited spill, the no-store-write invariant, the
`redrive_carry_*` refusal family), `contract-redteam.md` (attack surface — the poisoned-successor
axis, every pin confirmed RED at HEAD, §1.3), `suite-59-brief.md` (this suite's brief),
`suite-blueteam.md` (blue-team verdict — NEEDS-FOLD, 12 findings), `suite-fold-2.md` (finding →
resolution map).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/redrive-continuity-red.test.mjs   # run from repo root
ℹ tests 28
ℹ pass 5
ℹ fail 23
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the fold-2 was finalized. Two consecutive runs of the finished suite both produced
**pass 5 · fail 23** (run 1 ≈ 233 ms, run 2 ≈ 208 ms) — the split is deterministic. The 5 passes
are exactly the five PIN rows (A3, B3, E1, F4, G2); the 23 failures are the red rows, each
confirmed to fail at its NAMED stage (the per-row stage is in the header and in each row's
first-failing assertion message).

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY. Stages
in **bold** are the current HEAD failure seam. All RED rows' first assertion is an `assert.ok(...)`
(or an `assert.equal(typeof …,'function', …)` for the invented methods) so the row fails at the
stage — never on a vacuous shape assertion.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | D1/D2 | | **renderBrief-continuity-missing** | `renderBrief` (adapter.mjs:96-163) ends at `## Ambient knowledge` (:147-161); a brief carrying `continuity` renders NO `## Re-drive continuity` section — the carried block is never served. The row now asserts the provenance frame renders BEFORE the first `[carried/untrusted]` item and immediately after the header (finding 8), and accepts the per-item frame's `${entryId\|digest}` EITHER form — `terminal (terminal:run:dead:1\|[a-f0-9]{64})` (finding 9) |
| A2 | D1/D2 | | **renderPrompt-continuity-missing** | `renderPrompt` (cli-adapters.mjs:78-109) ends at the verification execution contract; a brief carrying `continuity` renders NO `## Re-drive continuity` tail. The position pin is the `A reviewer` contract marker (:106) — a section BEFORE the contract would violate D2. Same provenance-first + entryId\|digest-form assertions as A1 (findings 8, 9) |
| A3 | D2 | PIN | absence-on-empty | green today — an empty/absent `continuity` emits no section from either renderer; stays live (the empty-block pin, fold) |
| A4 | D3/GT5 | | **admission-surface-missing** | `recipes.mjs` exports NO `redriveMembers(manifest, roles, {newIdempotencyKey, carryForward})`; the coordinator namespace exports NO `REDRIVE_SCOPES`; the `carryForward` option name appears nowhere in recipes.mjs — the D3 opt-in has no constructor |
| A5 | D1 | | **carried-per-item-frame-missing** | no renderer emits per-item `- [carried/untrusted] ${scope} ${entryId|digest}: …` lines (D1), so the within-block order (terminal → refusals → scratchpad → pins, blocker 7) is unenforceable. The fixture is now ROTATED (`rotateItems(…, 1)`, deterministic left-rotation — finding 4): an input-order-preserving render must fail |
| A6 | D1.2 | | **pin-digest-list-missing** | the carried pin list is not bound to the dead member's `resolveResultPin`-derived history (`{report, startedAtMs, excludeShas}`, wave.mjs:134-143); a caller-asserted pin in `carryForward` has no refusal path. A FOREIGN member's same-window pin is staged (run `run:foreign-a6`, same report, overlapping startedAtMs) and asserted ABSENT from the carried list — never a raw ref scan (finding 3) |
| B1 | R3 | | **carried-body-neutralize-missing** | a carried note containing `## Pending attention` reaches the renderer whole — no single-line-leaf neutralization exists, so the poisoned-successor section mint is still possible (redteam §1.3 kill) |
| B2 | R3 | | **fake-frame-neutralize-missing** | a fake `UNTRUSTED_…` header in carried text could re-frame its own body — exactly one legitimate frame line (`UNTRUSTED_RE_DRIVE`) is not enforced. Now also asserts the single-line leaf (`!leaf.includes('\n')`, mirroring B1) and counts exactly one `UNTRUSTED_`-prefixed line in the rendered SECTION, not the whole output (finding 10) |
| B3 | R3 | PIN | neutralization-substrate | green today — `wrapProse` (messages.mjs:463, model-authored/untrusted) + `sanitizeWebContent`/`stripControlCharacters` (:569/:560) are the sanitize substrate; `wrapFact` (:459) stays `untrusted:false` forever |
| C1 | D2/R9 | | **renderBrief-total-order-missing** | `renderBrief` has no continuity slot, so the ONE order `## Ambient knowledge` → `## Re-drive continuity` → `## Cited REPL objects` → `## Pending attention` cannot hold when the carried-content sections co-occur |
| C2 | D2/R9 | | **renderPrompt-total-order-missing** | `renderPrompt` has no continuity slot after the verification contract (:106), so the same total order cannot hold in the CLI prompt (the #59/#69/#79 seam) |
| D1 | D3 | | **redrive-carry-missing** | `coordinator._redriveContinuity(memberId, carryForward)` does not exist — default-off is unenforceable (a plain re-drive must be byte-identical to today). The fixture now terminalizes a SAME-ROLE same-wave dead source with a real scratchpad write, so `null`/`undefined` carryForward carrying nothing AND the composed brief having no continuity block are proven against something a default-on fold would carry (finding 2) |
| D2 | D3 | | **redrive-carry-refusal-missing** | `_redriveContinuity` absent — a cross-role carry has no `redrive_carry_role_mismatch` typed refusal BEFORE any side effect |
| D3 | D3 | | **redrive-carry-refusal-missing** | `_redriveContinuity` absent — an unrelated-wave source has no `redrive_carry_wave_unrelated` typed refusal (the recorded wave chain, never caller-asserted) |
| D4 | D3 | | **redrive-carry-refusal-missing** | `_redriveContinuity` absent — malformed/empty options, an unknown source, and a still-live source have no typed refusals (`option_invalid`/`unknown_source`/`not_terminal`) |
| D5 | refusals | | **redrive-refusal-codes-missing** | the coordinator namespace exports NO `REDRIVE_REFUSAL_CODES` — the frozen 10-code `redrive_carry_*` family is not a typed surface constant |
| D6 | D1 | | **redrive-carry-no-evidence-missing** | no behavior row fires `redrive_carry_no_evidence` — an empty named scope (e.g. `scopes:['scratchpad']` on a source with no scratchpad) has no typed refusal (finding 7). The row terminalizes a source with NO scratchpad entries and asserts the typed no-evidence refusal fires — never a silent empty section |
| D7 | D1 | | **redrive-carry-unframable-missing** | no behavior row fires `redrive_carry_unframable` — a body that IS the `UNTRUSTED_RE_DRIVE` frame literal cannot be framed/neutralized without minting a second frame line; B2's exactly-one-frame pin forces a REFUSAL at the render seam, never a duplicate frame (finding 7) |
| D8 | D1 | | **redrive-carry-oversized-missing** | no behavior row fires `redrive_carry_oversized` — a 50-item block over BOTH bounds with the spill lane stubbed unavailable (`mintSpill` → throw) must refuse, never silently truncate (finding 7) |
| D9 | D1 | | **redrive-carry-spill-unavailable-missing** | no behavior row fires `redrive_carry_spill_unavailable` — a 9-item overflow (needs the spill lane) with the lane stubbed unavailable must refuse, never silently drop (finding 7) |
| E1 | D4/GT8 | PIN | TG2-evidence-law | green today — `_steeringEvidenceQualifies` (coordinator.mjs:2208) + `_observeSteeringCycle` (:2241) ship; a distinct content digest answers ONLY this attempt's cycle, and a carried dead-attempt digest never enters the fresh digestSet |
| E2 | D4/R6 | | **no-store-write-missing** | the carry has no surface, so the no-store-write invariant cannot be proven — a fresh run's store must have NO dead-attempt rows after a carry, and a carried digest must never land in the fresh steering digestSet (D4/blocker 6). The invariant now reads the REAL store surface (`(freshScratch?.slices ?? []).flatMap((s) => s.entries)` — the store returns `{runId, observedSeq, fenceTuple, slices}`, there is NO top-level `entries` field, coordination-store.mjs:13985-14003; blue-team finding 1, the R6 fix) and ARMS a steering cycle on the fresh attempt (mirroring E1) so the carry-path digestSet negative is LIVE — a "restore"-implementation that writes dead rows sails through no longer |
| F1 | D1/R7 | | **continuity-registry-rows-missing** | `FRAME_LIMITS` (limits.mjs) has no `view.continuity.items` row — the 8-item bound with `spill-digest-citation` graceful does not exist |
| F2 | D1/R7 | | **continuity-bytes-row-missing** | no `view.continuity.bytes` row — the 4096-byte RENDER-side shed flag (`shed-flagged`) does not exist |
| F3 | D1/R7 | | **continuity-overflow-spill-missing** | `coordinator._composeContinuity(memberId, continuity)` absent (2-arg — the block IS the admission result, the folded signature, finding 5) — 9 carried items serving 8 in-block + a `spill:sha256:<digest>` closing citation (never a truncation) is unenforceable. The fixture is ROTATED (`rotateItems(nineItems, 3)` — finding 4); the spill RESOLVES via `materializeSpill` and BOTH overflow notes (6 AND 7) must ride it, rendered `UNTRUSTED_READ_CONTENT` (finding 6) |
| F4 | GT7 | PIN | coaching-refusal-shape | green today — `composeFrameLimitRefusal` (limits.mjs:40-42) names cap/actual/unit and the spill graceful path; stays live (a silent truncation would evade the D1 spill) |
| G1 | R8 | | **brief-purity-violation** | `_redriveContinuity` absent — the byte-stability law (a carry changes the SERVED brief, never the admitted `task.brief`; the `briefDigest`/recovery-refinement pin never moves) is unprovable |
| G2 | R8 | PIN | provider-brief-purity | green today — `_providerBrief` (coordinator.mjs:3790-3839) is a pure compose (never mutates `task.brief`, mints no adapter call); stays live (the recovery-refinement digest pin, store :3009) |

## Invented surfaces

Every invented member is absent at HEAD (the seam the red row holds). The first assertion on every
invented export is an `assert.ok(...)` / `assert.equal(typeof …,'function',…)`, so the row fails at
the named stage — never on a shape assertion that `Object.isFrozen(undefined) === true` could
spuriously satisfy. The D3 role/wave relationship is read from the STORE's driver records
(`recordDriver('wave.member.admission', {runId, role, waveId, predecessorWaveId})`) — the surface
never trusts a caller-asserted relation, so model-authored content cannot spoof it.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `coordinator._redriveContinuity(memberId, carryForward)` — the D3 admission + D2 composition seam (`{sourceRunId, scopes}`; null/undefined carryForward = default-off) | the coordinator instance | undefined (D1-D4, D6, E2, G1) |
| `coordinator._composeContinuity(memberId, continuity)` — the D2 projection the briefing augmentation consumes (2-arg: the block IS the admission result — the folded signature per blue-team finding 5; the 8-item / 4096-byte bounds + the digest-cited spill) | the coordinator instance | undefined (F3, D7-D9) |
| `coordinator._coordination.materializeSpill(spillId)` / `mintSpill(...)` — the closed spill lane the digest-cited overflow resolves through (the real store surface, stubbed only by the D8/D9 `spillLaneUnavailable()` helper) | the real store | the lane exists; the carry surface that would use it does not (F3, D8, D9) |
| `recipes.redriveMembers(manifest, roles, {newIdempotencyKey, carryForward})` — the RC-B manifest-based redrive surface (GT5) | namespace import `* as recipes` | no such export (A4) |
| `coordinatorNs.REDRIVE_SCOPES` — frozen `['scratchpad','pins','terminal','refusals']` (D3 closed set, ACTUAL order) | namespace import `* as coordinatorNs` | no such export (A4) |
| `coordinatorNs.REDRIVE_REFUSAL_CODES` — frozen ACTUAL-sorted `{redrive_carry_no_evidence, redrive_carry_not_terminal, redrive_carry_option_invalid, redrive_carry_oversized, redrive_carry_role_mismatch, redrive_carry_scope_invalid, redrive_carry_spill_unavailable, redrive_carry_unframable, redrive_carry_unknown_source, redrive_carry_wave_unrelated}` | namespace import `* as coordinatorNs` | no such export (D5) |
| `FRAME_LIMITS['view.continuity.items']` — `{lane, class:'view', value: 8, unit:'items', graceful:'spill-digest-citation'}` (the `view.knowledge_slice.items`=8 precedent, limits.mjs:100) | real `FRAME_LIMITS` | row absent (F1) |
| `FRAME_LIMITS['view.continuity.bytes']` — `{lane, class:'view', value: 4096, unit:'bytes', graceful:'shed-flagged'}` (a RENDER-side shed flag, never a wire cap) | real `FRAME_LIMITS` | row absent (F2) |
| the brief `continuity` field — `{source: {runId, role, waveId, terminalCause}, items: [{scope, entryId, digest, text}]}` attached by `_providerBrief` | `coordinator._providerBrief(task.brief, handle.id)` | `composed.continuity` undefined (A1/A2/D1/G1) |
| the `## Re-drive continuity` render section — `UNTRUSTED_RE_DRIVE` provenance frame + `- [carried/untrusted] ${scope} ${entryId|digest}: ${text}` lines | `renderBrief` / `renderPrompt` | no section (A1/A2) |
| the carry option's closed shape — a caller-asserted pin list in `carryForward` refuses `redrive_carry_option_invalid` | `_redriveContinuity` | no surface, no refusal (A6/D4) |

The E1 PIN drives the real steering cycle through the production event path: the ScriptableAdapter
carries `turnCompletion: 'pausable'`, so a completed turn parks at the pause-admission seam
(coordinator.mjs:2076) and arms exactly one bounded steering cycle (:2134). The fresh attempt
answers with its OWN scratchpad write (the coordinator's `writeScratchpad` wrapper :10545 →
`_observeSteeringCycle` :12454); the answered record's `steering.digestSet` then contains the fresh
content digest and NOT the dead attempt's digest — the D4/GT8 negative, staged against a real
sha256 that would qualify if a carried surface ever fed it in. The D2-D4 refusal rows and the
terminalize-then-admit rows drive the store's real `transitionTask`/`recordDriver` so the D3
validation runs against the durable wave records, never an in-memory assertion.

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **A3** absence-on-empty | an impl that renders a stale `## Re-drive continuity` header over an empty carried set (the D2 empty-block pin) |
| **B3** neutralization-substrate | an impl that maps a carried leaf onto `wrapFact` (ships `untrusted:false` across the provider seam — the R3 kill), or stops neutralizing `\n` as a C0 control (`stripControlCharacters`), or filters adversarial text instead of keeping it INSIDE the leaf |
| **E1** TG2-evidence-law | an impl whose carried dead-attempt digest answers a steering cycle, mints fresh `steering.digestSet` membership, or counts toward the fresh attempt's distinct-digest class (D4/GT8 — carried content is evidence, never authority) |
| **F4** coaching-refusal-shape | an impl that silently truncates the block instead of naming cap/actual/unit + the spill graceful path (a silent truncation would evade the D1 spill) |
| **G2** provider-brief-purity | an impl that mutates the admitted `task.brief` while composing the carried block (the `briefDigest = canonicalDigest(activeTask.brief)` pin moves, and store-side recovery-refinement lineage (:3009) refuses) |

## What makes each stage go green (implementer's checklist)

- **renderBrief-continuity-missing / renderPrompt-continuity-missing** → D1/D2: after `## Ambient
  knowledge` in renderBrief (adapter.mjs:147-161) and after the verification execution contract
  (past the `A reviewer` marker, cli-adapters.mjs:106) in renderPrompt, both renderers emit
  `## Re-drive continuity` when `brief.continuity?.items?.length > 0` — opened by the closed
  `UNTRUSTED_RE_DRIVE` provenance frame (composed from the dead attempt's identity + terminal
  cause), one `- [carried/untrusted] ${scope} ${entryId|digest}: ${text}` line per item, each line
  a single sanitized leaf (no `\n` can mint a section). Absent/empty continuity → no section (A3).
- **admission-surface-missing** → D3/GT5: `recipes.redriveMembers(manifest, roles,
  {newIdempotencyKey, carryForward})` validates roles + the closed option shape BEFORE any side
  effect; `coordinatorNs.REDRIVE_SCOPES` exports the frozen `['scratchpad','pins','terminal',
  'refusals']` set (ACTUAL order); the four members of the closed content set are the ONLY scopes a
  carry may name (A4).
- **carried-per-item-frame-missing** → D1: every carried member renders under its own
  `[carried/untrusted]` frame; the within-block allocation order is terminal → refusals →
  scratchpad → pins (blocker 7) — the terminal cause and refusal evidence are always served
  in-block first, then the projection shares the remaining budget. The fixtures feed ROTATED input
  (`rotateItems` — deterministic left-rotation, no `Math.random`), so an input-order-preserving
  composition/render must fail (A5, F3; finding 4).
- **pin-digest-list-missing** → D1.2: the carried pin list is derived from the dead member's
  `resolveResultPin`-disambiguated checkpoint history (`{report, startedAtMs, excludeShas}`, the
  wave.mjs:134-143 window); the re-resolution inputs ride the list so the fresh attempt re-runs the
  salvage path identically; a caller-asserted pin list in `carryForward` refuses
  `redrive_carry_option_invalid` — never a raw ref scan. A FOREIGN member's same-window pin is
  staged and asserted ABSENT from the carried list, so a raw-window-scan implementation with no
  disambiguation fails (A6; finding 3).
- **carried-body-neutralize-missing / fake-frame-neutralize-missing** → R3: carried bodies go
  through the single-line-leaf discipline (`stripControlCharacters` + the `wrapProse` untrusted
  leaf) — `## Pending attention` and fake `UNTRUSTED_…` lines render INSIDE the bullet (preserved,
  never filtered), never as a new section, never as a new frame line; exactly ONE
  `UNTRUSTED_`-prefixed line — the legitimate section-opening frame — may exist. B2 now asserts the
  single-line leaf AND counts the frame lines SECTION-scoped (finding 10). Note (finding 12): B1
  pins preserve-inside-bullet — a strip-based neutralization would fail it; the suite implements
  the amended R3 acceptance, and the D1 mechanism-list tension is a deliberate contract fix (v1.2),
  not a suite fix (B1/B2).
- **renderBrief-total-order-missing / renderPrompt-total-order-missing** → D2/R9: BOTH renderers
  hold the one total order `## Ambient knowledge` → `## Re-drive continuity` → `## Cited REPL
  objects` → `## Pending attention` (the #59/#69/#79 seam); the `## Verification` contract keeps
  its position; continuity lands after the verification contract in the prompt (C1/C2).
- **redrive-carry-missing / redrive-carry-refusal-missing / redrive-carry-no-evidence-missing /
  redrive-carry-unframable-missing / redrive-carry-oversized-missing /
  redrive-carry-spill-unavailable-missing** → D3/D1: `_redriveContinuity(memberId,
  carryForward)` returns null on an absent carryForward (default-off — a plain re-drive is
  byte-identical, proven even with a same-role same-wave dead source staged, finding 2); otherwise
  it validates source role (same role), the wave chain (same wave or a recorded predecessor), and
  the closed option shape against the STORE's `wave.member.admission` driver records, refusing with
  the typed codes BEFORE composing anything: `role_mismatch`, `wave_unrelated`, `scope_invalid`,
  `option_invalid`, `unknown_source`, `not_terminal` (D1-D4). The four previously surface-only
  codes now have behavior rows: an empty named scope → `redrive_carry_no_evidence` (D6); a body
  that IS the `UNTRUSTED_RE_DRIVE` frame literal → `redrive_carry_unframable` at the render seam
  (D7); an over-bound block with the spill lane unavailable → `redrive_carry_oversized` (D8); an
  overflow whose spill lane refuses → `redrive_carry_spill_unavailable` (D9) — never a silent
  truncation, never a silent empty section, never a duplicate frame.
- **redrive-refusal-codes-missing** → refusals: the coordinator exports the frozen
  `REDRIVE_REFUSAL_CODES` family in ACTUAL sorted order (no_evidence, not_terminal, option_invalid,
  oversized, role_mismatch, scope_invalid, spill_unavailable, unframable, unknown_source,
  wave_unrelated), reusing the snake_case `CoordinationRefusal` machinery (D5).
- **no-store-write-missing** → D4/R6: composing the carried block writes NOTHING to the fresh
  run's store — the fresh `scratchpadSnapshotBatch` has no dead-attempt rows, and the carried
  digests never enter the fresh attempt's `steering.digestSet` (the D4/GT8 negative; E2 stages a
  carried digest that would qualify if counted and proves it isn't). The invariant reads the REAL
  store surface — `slices.flatMap((s) => s.entries)`, the store returns `{runId, observedSeq,
  fenceTuple, slices}` with NO top-level `entries` field (coordination-store.mjs:13985-14003,
  blue-team finding 1) — and E2 arms a steering cycle on the fresh attempt so the carry-path
  digestSet negative is LIVE, not an empty loop.
- **continuity-registry-rows-missing / continuity-bytes-row-missing / continuity-overflow-spill-missing**
  → D1/R7: the two `view.continuity.*` rows land in the VIEW registry — items 8 /
  `spill-digest-citation` (overflow is a digest-cited spill, never a truncation) and bytes 4096 /
  `shed-flagged` (a RENDER-side shed flag). `_composeContinuity(memberId, continuity)` (2-arg —
  the block IS the admission result, the folded signature per finding 5) serves the head 8
  in-block (terminal + refusals always first, re-ordered from the rotated fixture — finding 4),
  closes with `spill:sha256:<digest>` carrying the overflow ids, and the worker RESOLVES the
  citation through the closed spill lane — `materializeSpill` returns the full body carrying BOTH
  overflow notes (6 AND 7 — finding 6) and renders `UNTRUSTED_READ_CONTENT` (F1-F3). C1/C2: when
  the #69/#79 folds land, the total-order rows MUST be re-verified against the actual brief field
  shapes (`replObjects`, `attention`); a field-name mismatch is a fold-coordination note (blue-team
  finding 11), not a #59 suite defect.
- **brief-purity-violation** → R8: the carry changes the SERVED provider brief
  (`_providerBrief` augmentation) but NEVER the admitted `task.brief` — the byte-stability law is
  proven by a deep snapshot before/after (G1; the G2 pin keeps the base seam pure).

## Suite-law hygiene (verified)

- **Hermetic**: ScriptableAdapter (no harness, no network) + mock worktrees/capture; `mkdtempSync`
  logs; global `test.after` cleanup; the deployment-verification stub is the brief's `true` command.
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (an
  `assert.ok`/`typeof` for invented surfaces, a behavior assertion for the renderer/registry/seam
  rows); the stage names live in the header row inventory AND in each row's assertion message.
  23 RED rows / 5 PINs, stable across consecutive runs. The fold's deterministic shuffle
  (`rotateItems`) uses no `Math.random` — the suite stays hermetic and reproducible.
- **NUL discipline**: `coordination-store.mjs` (3 NUL bytes) is never read whole — only its exports
  are imported (`coordinationForLog`). `recipes.mjs` is read for the `carryForward` option-name
  anchor (A4) and is NUL-free (verified byte-count 0). `adapter.mjs`, `cli-adapters.mjs`,
  `messages.mjs`, `limits.mjs`, `coordinator.mjs` are NUL-free and read for the anchors. The suite
  file itself is NUL-free.
- **No clocks as controls / no wall-clock assertion**: every row drives the real coordinator event
  path with a fixed microtask drain (`flush(n)`); the E1 PIN arms the steering cycle at the pause
  seam and answers it on a microtask-only flush (the 25 ms `progressNudgeWindowMs` never fires).
  No row asserts a wall-clock behavior; `Date.now()` never appears.
- **No `localeCompare`**; the `REDRIVE_SCOPES` literal, the `REDRIVE_REFUSAL_CODES` key set, and the
  within-block order are asserted in ACTUAL sorted/contracted order against frozen constants.
