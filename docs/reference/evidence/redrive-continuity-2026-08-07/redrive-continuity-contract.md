# Issue #59 — re-drive continuity contract (v1.0 DRAFT)

The implementation contract for issue #59: re-drive continuity — a dead attempt's context
(scratchpad projection, checkpoint-pin digests, terminal cause, refusal/failure evidence) is
carried into the fresh attempt's provider-facing brief when a wave member is re-driven after the
predecessor's death. It specifies behavior; it does not amend implementation in this artifact. It
is a Ring-2 contract (ground truths → decisions → refusal vocabulary → red-first acceptance →
open questions). It cross-references — it does not re-specify — #33 (the scratchpad projection /
closed entry grammar), #69 (cited REPL objects), #79 (pending attention), #89 (frame economics),
#93B (wave durability / re-drive-the-failed), #141 (boundary-commit workstyle law), #142
(evidence/context deliverable scope), and the #105 reply-chain composition that #69 D7 folds in.

Verification HEAD: `3ab39706839a805c2e3403e99e6bb36d8456c31b` ("Baton private effective-tree
snapshot"), the tree this v1.0 DRAFT was verified against. Every code anchor below was re-verified
against that tree with NUL-safe `grep -an` and targeted `sed -n` reads. **v1.0 DRAFT status:** no
red-team fold has run yet; the acceptance pins are written red-first (RED at the fold = the
behavior is absent, which is the current state) and the fold will re-verify every anchor at its
own HEAD.

**Issue body availability.** `gh` is not authenticated in this worktree (the same constraint the
#69 and #105 contracts record); the issue body could not be fetched. The requirements are carried
by this brief (`contract-59-brief.md`) and the campaign's own evidence this week (below, GT1).
`redriveMembers` is specified in `composition-decisions.md` but NOT shipped (RC-B, "intentionally
absent" — confirmed against the shipped red suite); the admission surface this contract pins is
therefore NEW code, and the pins are written against the fold's delivery of that surface.

**Read-order executed.** (1) this brief; (2) the campaign's own losses — the impl-114 first
attempt (`docs/reference/evidence/workflow-as-data-2026-08-06/impl-114-brief.md`: deepseek drained
2.5h with zero commits; the scratchpad/findings died with the worker, only the boundary commits
saved the code) and the #71 attempt (`docs/reference/evidence/orchestrator-wake-2026-08-07/contract-71-brief.md`:
died on a transient provider error, re-drove COLD); (3) the machinery — `impl/src/wave.mjs`
(`resolveResultPin` / `createWave` / `attachWave` / `progress`), `impl/src/recipes.mjs`
(`renderObjective` / `attachRun` / `runRecipe` / `RUN_OPTION_FIELDS`), `impl/src/adapter.mjs`
(`renderBrief`), `impl/src/cli-adapters.mjs` (`renderPrompt`), `impl/src/coordinator.mjs`
(`_providerBrief`, the CONTEXT_READ lane, `_steeringEvidenceQualifies`,
`scratchpadSnapshotBatch`), `impl/src/limits.mjs` (`FRAME_LIMITS`), `impl/src/application.mjs`
(`debugGateRefusal`, `terminalCauseNarrative`), `impl/src/application-semantics.mjs`
(`projectTypedTerminalCause`); (4) the composition contracts #93B
(`wave-durability-decisions.md`), #33 (`scratchpad-decisions.md`), #79
(`worker-delivery-push-contract.md`), #69 (`repl-realization-contract.md` v1.1),
`composition-decisions.md` v2 rule 4 + `redteam-v1.md` R-DC-2, and the #142 lesson
(`docs/reference/evidence/briefing-pack-2026-08-06/impl-103-brief.md`).

Every `file:line` citation below was verified in this worktree with NUL-safe `grep -an` searches
and targeted `sed -n` reads. `impl/src/application.mjs` and `impl/src/coordination-store.mjs`
are NUL-bearing files; their anchors are grep/sed-verified, never whole-file reads. Sorted-key
literals are quoted in their ACTUAL source order (none are sorted claims); no `localeCompare`
ordering is used anywhere in this contract.

Scope of the continuity rung, in one sentence: **when a wave member is re-driven after its
predecessor's death, a closed, byte-bounded, digest-cited carry-forward of the dead attempt's
state is composed into the fresh attempt's provider-facing brief as a named, UNTRUSTED-framed
`## Re-drive continuity` section — evidence for the fresh attempt to verify, never authority that
can re-arm gates, satisfy verifications, or answer steering cycles on its behalf.**

---

## Ground truths (code-verified)

**GT1 — The campaign's own two losses are the evidence for #59.** (a) The impl-114 first attempt
(`impl-114-brief.md`): a deepseek attempt drained ~2.5h with zero commits; its scratchpad/findings
died with the worker, and only the #141 boundary commits saved the code. (b) The #71 attempt
(`contract-71-brief.md`): died on a transient provider error and re-drove COLD — the fresh attempt
re-read everything from scratch. Both are the failure mode #59 addresses: the dead attempt's
in-flight state (notes, plans, doubts, what it already established) does not cross the death
boundary into the fresh attempt, so either the work dies (impl-114) or the fresh attempt pays the
full cold-start re-read cost (#71). The checkpoint pins preserve completed work (GT2); the
in-flight context does not.

**GT2 — Checkpoint pins persist at death and carry completed work.** `resolveResultPin`
(wave.mjs:134) enumerates `refs/baton/results/*` pins via `git for-each-ref`
(wave.mjs:140), filters by `startedAtMs`, and resolves one preserved result pin per member. 93B
rule 5 (wave-durability-decisions.md:69-72): "members that recovery terminalized at predecessor
death are re-driven by starting a fresh wave for those members (salted objectives; checkpoint
pins carry their completed work — the established salvage path)". `progress()` exposes the wave's
`scratchpad` outline (wave.mjs:306, `scratchpad: outline.scratchpad ?? null` at :322). A re-drive
therefore has: salted fresh objectives (the #141 workstyle law), persistent checkpoint pins, and
a dead attempt whose scratchpad and terminal state are in the store — the inputs this contract
bounds and carries.

**GT3 — The scratchpad projection survives worker death but is run-scoped; the continuity block
is the crossing seam.** #33 pins the continuous ledger-backed candidacy: writes "remain candidates
across worker death" (scratchpad-decisions.md:22-24, rule 18), and the projection is a
`run.scratchpad` / RunView / task-workflow horizon (scratchpad-decisions.md:49) with
`run.scratchpad({workerId})` resolving "only an owned attempt; missing/cross-Run" reads refusing
(scratchpad-decisions.md:1258). A fresh run therefore CANNOT read the dead run's scratchpad
through the run-scoped API — the store keeps the dead attempt's records (until settle-time reap),
but no legal facade path crosses the run boundary. #59 is that crossing: the dead attempt's
projection is captured into the fresh attempt's brief at re-drive time, explicitly framed as
carried evidence, never as the fresh attempt's own state.

**GT4 — The brief-assembly seam is the provider-facing augmentation, and it never mutates
`task.brief`.** `_providerBrief(brief)` (coordinator.mjs:3790) materializes cited context packs
(`UNTRUSTED_CONTEXT_PACK` frame at :3816), injects the orientation L0 map, and augments the
provider-facing value with a separate `briefing` block (:3829-3838) — `briefDigest` hashes only
`task.brief`, so a briefing that changes between spawn and recovery cannot move the digest. #69 D2
pins the `## Cited REPL objects` section at this seam (repl-realization-contract.md:232, :496);
#79 D1 pins the `## Pending attention` block at this seam (worker-delivery-push-contract.md:133).
#69 D7 pins the composed rendering order `## Ambient knowledge` → `## Cited REPL objects` →
`## Pending attention` (repl-realization-contract.md:413-415, R7 at :524). `renderBrief`
(adapter.mjs:96-163) renders `## Ambient knowledge` last (:147-161); `renderPrompt`
(cli-adapters.mjs:78-109) is the CLI dialect of the same served brief.

**GT5 — The redrive helper is specified but NOT shipped.** composition-decisions.md v2 rule 4
(:60-65): `redriveMembers(manifest, roles, {newIdempotencyKey})` → "validates the role subset,
renders from the manifest's preserved task inputs with ONE new salt, starts a fresh wave (new
manifest)". RC-B (:67) defers "attach/redrive helpers — only after the manifest round-trip rows
pass". R-DC-2 (redteam-v1.md:30-54) pins the manifest-based signature and the `newIdempotencyKey`
shape. The shipped red suite (`impl/test/recipes-red.test.mjs`) confirms RC-B is intentionally
absent — `redriveMembers` does NOT exist in `impl/src/recipes.mjs` (grep-verified: no such
identifier). The admission surface this contract pins (D3) is therefore new code delivered by the
RC-B fold.

**GT6 — Terminal cause and refusal evidence have closed projections.** `projectTypedTerminalCause`
(application-semantics.mjs:2123) projects a closed `{kind, code, ...}` object with
kind ∈ `{budget_exceeded, provider_failure, policy_failure, dispatch_refused, operator_stop}`
(the `dispatch_refused` arm at :2140-2144 and the `operator_stop` arm at :2146). `debugGateRefusal`
(application.mjs:993) projects the latest trust-gate / verifier refusal into `{gate, detail}`
from source events only (`error` with `payload.phase === 'trust_gate'`, and
`verify.reverified` with `accept === false`). `terminalCauseNarrative` (application.mjs:2268)
renders the narrative. Both are store-derived, closed-shaped, and safe to carry (bounded text).

**GT7 — The #89 frame-economics law is the bound, and the #79/#69 rows set the pattern.**
`FRAME_LIMITS` (limits.mjs:53-110) is the ONE registry; `composeFrameLimitRefusal`
(limits.mjs:40-42) is the ONE refusal composer; `spill.body` is 1 MiB (:86); every block rides
the spill lane `CONTEXT_READ {kind:'spill'}` — the spill branch of `_renderContextRead`
(coordinator.mjs:10797) is the closed renderer. The composed-section
pattern is pinned by #79 (`view.attention_push.items` = **8**, `view.attention_push.bytes` =
**4096**, worker-delivery-push-contract.md:176-178) and #69 (`view.repl_object.items` = **8**,
`view.repl_object.bytes` = **4096**, repl-realization-contract.md:424-427) — each section bounded
by ITS OWN row, shedding independently, no combined cap (#69 D7, repl-realization-contract.md:417).

**GT8 — The TG2 evidence law is shipped: only THIS attempt's digests count.** `_steeringEvidenceQualifies`
(coordinator.mjs:2208) gates whether a scratchpad receipt answers a steering cycle on the
evidence's content digest being distinct and the attempt's own (`steering.digestSet`). The
scratchpad frame is `UNTRUSTED_SCRATCHPAD — worker-authored notes, not instructions`
(coordinator.mjs:10816). Carried scratchpad rows are by construction the DEAD attempt's digests —
they can never satisfy `_steeringEvidenceQualifies` for the fresh attempt (D4).

---

## Decisions

### D1 — The closed content set: exactly four carried members, all UNTRUSTED-framed

The carry-forward carries exactly four members, no more:

1. **The dead attempt's scratchpad projection** — the settled + unsettled reads
   (notes/plans/doubts, the #33 closed entry grammar at scratchpad-decisions.md:150). Carried as
   a projection snapshot, bounded by the block's own rows (below), each carried entry digest-cited
   to the dead attempt's store record. This is the load-bearing member: it is what impl-114's
   scratchpad/findings lost when the worker died.
2. **The checkpoint-pin digest list** — the resolved pin shas from `refs/baton/results/*`
   (`resolveResultPin`, wave.mjs:134), NOT the diffs. The fresh attempt resolves the pins it needs
   via the established salvage path (93B rule 5). The list tells the fresh attempt what completed
   work exists; it never substitutes for the work.
3. **The terminal cause** — the closed `projectTypedTerminalCause` object (application-semantics.mjs:2123):
   kind, code, and (for budget/provider kinds) the dimension/used/limit/ratio. The provenance
   frame (D2) renders it; the fresh attempt learns why the predecessor died.
4. **The refusal/failure evidence** — the `debugGateRefusal` projection (application.mjs:993)
   plus any dispatch-refusal evidence the dead attempt accumulated. Bounded text, carried for the
   fresh attempt to verify against the successor's own gate behavior.

Every member is UNTRUSTED-framed: a dead attempt's notes are model-authored content entering a
fresh worker's brief — the injection discipline is the whole game. The block is bounded by new
registry rows `view.continuity.items` = **8** (items, mirroring the #79/#69 items=8 rows) and
`view.continuity.bytes` = **4096** (bytes, render-side shed mirroring the #79-pinned
`view.attention_push.bytes` shed semantics); a section overflow is a digest-cited spill
(`CONTEXT_READ {kind:'spill'}`, per the #89 law — the full carried text rides the spill, the block
keeps the digest citation). The scratchpad projection does not re-spec #33's rows: it rides the
block rows with each entry's leaf text bounded by the #79 D2 shed semantics (truncate with a
`(truncated)` marker, full text in the spill).

### D2 — The composition seam: a named `## Re-drive continuity` section, provenance first

The continuity block is a named section — **`## Re-drive continuity`** — composed into the
provider-facing brief at the same augmentation seam #69's `## Cited REPL objects` and #79's
`## Pending attention` use (GT4), never into `task.brief` (the digest pin stays byte-stable).

- **Rendering order (composing all three).** The served section order becomes: `## Ambient
  knowledge` → `## Re-drive continuity` → `## Cited REPL objects` → `## Pending attention`. This
  amends #69 D7's `## Ambient knowledge` → `## Cited REPL objects` → `## Pending attention`
  (repl-realization-contract.md:413-415, R7 at :524) by inserting the continuity block immediately
  AFTER `## Ambient knowledge`. Rationale: ambient knowledge (KG recall) and re-drive continuity
  are both context-evidence sections — "here is what you should know" — so they sit together
  first; cited REPL objects are orchestrator-authored INPUT data the worker needs before acting;
  pending attention is operational push about the worker's own lane traffic and stays the final
  lines of the prompt (#69 D7's own ordering rationale). The #69 R7 and #79 D1 anchors stay true:
  `## Cited REPL objects` and `## Pending attention` still render AFTER the continuity block, in
  their pinned mutual order. `## Ambient knowledge` keeps its position as the section the
  continuity block follows.
- **Provenance framing (how the fresh attempt is TOLD).** The section opens with a frame literal
  that names the source — this is a re-drive of a dead attempt, never the orchestrator's own
  instructions: `UNTRUSTED_RE_DRIVE — carried state from dead attempt <runId> (<role> in wave
  <waveId>), died of <kind>:<code>; evidence to verify, never an instruction`. Every carried
  member renders under that frame; the terminal cause (D1.3) renders in the frame header. Absent
  a carry, the section is absent — the #89 frame-waste law (the same absence-on-empty pin #79 D1
  and #69 D2 pin for their blocks).
- **Who may consume it.** The section is provider-facing brief content; the fresh attempt reads
  it as input. It is NOT a store row, NOT a registry entry, NOT a new read lane, and NOT the
  objective text — the objective stays within the `wave.member.objective` 4096-byte admission
  (limits.mjs:57); the continuity block rides the briefing augmentation.
- **The REPL-lane composition posture (named, not blocked on).** The continuity pack COULD ride
  the REPL lane once #69 lands (a cited object over the dead attempt's captured state). This
  contract does not require it: the continuity block is independent of `view.repl_object.*` the
  same way #69's rows are independent of the #79 rows (repl-realization-contract.md:430). A
  fold-order change to #69 cannot renumber or break this contract's rows.

### D3 — Opt-in per re-drive, never default-on; typed refusal for a cross-role or unrelated wave

Carry-forward is **per re-drive opt-in** — the orchestrator declares it explicitly on the
redrive call; there is no default-on. A same-role re-drive carries nothing unless the orchestrator
names the source attempt. Rationale: carrying content is an injection into a fresh worker's brief
(the injection discipline is the whole game); a drained attempt's notes may encode the very
reasoning that drained it (impl-114), so the orchestrator must choose whether that state is worth
carrying. Opt-in keeps the injection explicit, auditable at the call site, and reviewable.

- **Admission surface.** `redriveMembers(manifest, roles, {newIdempotencyKey, carryForward})`
  (extending composition-decisions.md v2 rule 4's signature, :60-65, and R-DC-2's manifest-based
  shape, redteam-v1.md:40-54) where `carryForward` is a CLOSED option:
  `{sourceRunId, scopes}` with `scopes` a subset of the closed set
  `['scratchpad', 'pins', 'terminal', 'refusals']` (D1's four members). The wave member descriptor
  of the fresh wave carries the admission result (a closed `continuity` field) so the briefing
  augmentation can compose D2's section.
- **Role and wave validation.** The helper validates, BEFORE any side effect, that the carried
  source attempt is (a) the SAME role as the re-driven member and (b) a member of the same wave or
  a direct predecessor wave in the same wave chain. A carry-forward from a DIFFERENT role or an
  UNRELATED wave is refused with a typed error — never silently accepted, never silently dropped.
- **Default-on is the named successor.** A "default-on for same-role re-drives" affordance is
  listed as a successor, gated on the opt-in surface proving the evidence law (D4) in the fold
  first.

### D4 — The trust posture: carried content is evidence, never authority

The carried block (D1) is input to the fresh attempt's plan and gate evaluation, never a
substitute for them. The fresh attempt's plan + gate evaluate carried content as UNTRUSTED input —
it can inform the fresh attempt's reasoning, and nothing more. Concretely:

- A carried scratchpad row can **never re-arm a trust gate** — gates evaluate the fresh attempt's
  own artifacts and digests only.
- A carried checkpoint pin **never satisfies a verification** — the fresh attempt's deliverable
  must pass verification on its own; pins only tell it where completed work lives.
- A carried scratchpad row can **never answer a steering cycle** on the new attempt's behalf — the
  TG2 evidence law (`_steeringEvidenceQualifies`, coordinator.mjs:2208) is shipped and unchanged:
  a steering-cycle answer requires the evidence's content digest to be THIS attempt's distinct
  digest in `steering.digestSet`. Carried rows carry the DEAD attempt's digests, so they are
  structurally ineligible. The fresh attempt must write its OWN notes to earn steering-cycle
  answers (GT8).

---

## Refusal vocabulary (per decision)

| Code | Decision | When | Message |
|---|---|---|---|
| `redrive_carry_unknown_source` | D3 | `carryForward.sourceRunId` cannot be resolved to a terminalized attempt | "carryForward sourceRunId <id> is not a resolvable dead attempt; nothing was carried" |
| `redrive_carry_not_terminal` | D3 | the source attempt is still live / not terminalized | "carryForward requires a dead (terminalized) source attempt; <id> is not terminal" |
| `redrive_carry_role_mismatch` | D3 | the source attempt's role ≠ the re-driven member's role | "carryForward from role <a> cannot feed a re-drive of role <b>; nothing was carried" |
| `redrive_carry_wave_unrelated` | D3 | the source attempt's wave is unrelated to this wave chain | "carryForward source wave <a> is unrelated to wave <b>; nothing was carried" |
| `redrive_carry_scope_invalid` | D3 | `scopes` contains a value outside `['scratchpad','pins','terminal','refusals']` | "carryForward scopes must be a subset of {scratchpad, pins, terminal, refusals}; got <x>" |
| `redrive_carry_oversized` | D1 | the composed block exceeds `view.continuity.items` / `view.continuity.bytes` AND the spill lane is unavailable | "re-drive continuity block exceeds the carry bound; no spill artifact could be minted" |
| `redrive_carry_spill_unavailable` | D1 | the block overflow needs a digest-cited spill but the spill lane refuses | "carried content exceeds the block bound and the spill lane is unavailable" |
| `redrive_carry_no_evidence` | D1 | a named scope is empty on the source attempt (e.g. no scratchpad entries, no pins) | "carryForward scope <x> has no carried content; the section renders its absence-on-empty" |

Every refusal is a typed error (never a silent drop, never a silent accept), carries the closed
`code`, and renders `composeFrameLimitRefusal` coaching text where the bound is a frame-economics
row (the #89 ONE-composer law, limits.mjs:40-42). Cross-role and unrelated-wave carry-forwards are
refused BEFORE any side effect on the fresh wave (the R-DC-2 / composition v2 rule 4 validation
posture).

---

## Red-first acceptance

Each pin is RED at the fold HEAD (the behavior is absent) and flips GREEN when the fold delivers
it. **RED = the current state.**

- **R1 (D1) — RED:** No `## Re-drive continuity` section exists; no `view.continuity.items` /
  `view.continuity.bytes` registry rows exist; the four-member carried set has no admission
  surface.
- **R2 (D2) — RED:** No `## Re-drive continuity` section renders in the provider-facing brief; the
  #69 D7 order (`## Ambient knowledge` → `## Cited REPL objects` → `## Pending attention`) is
  unchanged; the continuity block has no name.
- **R3 (D2) — RED:** No `UNTRUSTED_RE_DRIVE — …` frame literal exists; no provenance header names
  a source attempt, role, wave, or terminal cause; carried content, when carried, would render
  without the evidence-not-instruction frame.
- **R4 (D3) — RED:** `carryForward` does not exist on any redrive signature; `redriveMembers`
  itself is absent (RC-B, the shipped state); no typed refusal exists for cross-role or
  unrelated-wave carry-forward.
- **R5 (D3) — RED:** No closed `{sourceRunId, scopes}` shape is validated; `scopes` is not bounded
  to the closed `['scratchpad','pins','terminal','refusals']` set.
- **R6 (D4) — RED:** No carried content can re-arm a gate, satisfy a verification, or answer a
  steering cycle — enforced by the SHIPPED TG2 law (`_steeringEvidenceQualifies`,
  coordinator.mjs:2208); the acceptance is that a carried row's digest never appears in the fresh
  attempt's `steering.digestSet`. (This pin is GREEN-by-construction at the fold; the red-first
  test is that the continuity block never routes carried rows into the steering-evidence seam.)
- **R7 (bounds) — RED:** The block is not byte/item-bounded by `view.continuity.*`; an overflow
  does not degrade to a digest-cited spill (`CONTEXT_READ {kind:'spill'}`) with the full text in
  the spill and a `(truncated)` marker on the in-block leaves.
- **R8 (byte stability) — RED:** No fold code may mutate `task.brief` (the `briefDigest` pin); the
  continuity block rides the `{brief, briefing}` augmentation (GT4), verified by a red test that a
  carry changes the served brief but NOT `task.brief`.

---

## Open questions

- **The carry window.** This contract assumes the source attempt's scratchpad records are still in
  the store at re-drive time (GT3 — survival until settle-time reap). Where does the capture
  happen — at death detection (93B attach-time), or at re-drive composition? The fold should pin
  one; the contract presumes capture at re-drive composition with a digest-cited snapshot.
- **The pin list's freshness.** `resolveResultPin` filters pins by `startedAtMs - 60_000`
  (wave.mjs:143) — a re-drive hours later may not resolve the dead attempt's pins under the
  current window. Whether the carry-forward should widen the window (a `startedAtMs` override on
  the source attempt) is a successor question, not decided here.
- **Default-on for same-role re-drives.** D3 names it a successor; whether the campaign wants it
  after the opt-in surface proves the evidence law is a product decision for the #93B/#59 follow-on.
- **The REPL-lane composition.** Once #69 lands, the continuity pack could ride the REPL lane as a
  cited object. This contract deliberately does not block on it (D2); the fold should re-evaluate
  after #69's fold lands.
