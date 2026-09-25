# #59 RED-TEAM VERDICT — adversarial attack on `redrive-continuity-contract.md` v1.0

Verifier: red-team pass r9-2026-08-07. Verification HEAD: **`2c4018ffd27b30cf2129a5de02c2bd8cfb53393b`**
(current worktree HEAD — the contract's stated HEAD `3ab39706839a805c2e3403e99e6bb36d8456c31b`
is the tree the v1.0 DRAFT was verified against; every citation below was re-grepped at THIS HEAD).
NUL files (`application.mjs`, `coordination-store.mjs`) were touched only via `grep -an` / `sed -n`
with NUL stripping, never whole-file reads.

Laws applied: no clocks (none introduced); every citation re-verified at the current HEAD;
sorted-key literals in ACTUAL source order (none contested); `localeCompare` banned (grep confirms
none in the cited source files).

---

## 1. Citation re-verification — PASS (no wrong citations; three loose-range notes)

Every `file:line` anchor in the contract was re-verified at HEAD `2c4018f`. All are correct in
substance and anchor. The three notes below are range-loose, not wrong — they do not block.

### 1.1 Verified-correct anchors (substance confirmed)

| Contract claim | Anchor | Verified at HEAD |
|---|---|---|
| GT2 `resolveResultPin` export | wave.mjs:134 | ✓ |
| GT2 git `for-each-ref` over `refs/baton/results/*` | wave.mjs:140 | ✓ |
| GT2 `startedAtMs` window filter | wave.mjs:143 (`pin.at * 1000 >= startedAtMs - 60_000`) | ✓ |
| GT2 `progress()` exposes `scratchpad: outline.scratchpad ?? null` | wave.mjs:322 (fn body :306-336) | ✓ |
| GT3 rule 18 "remain candidates across worker death" | scratchpad-decisions.md:22-24 | ✓ |
| GT3 `run.scratchpad`/RunView/task-workflow horizon row | scratchpad-decisions.md:49 | ✓ |
| GT3 Part B closed entry grammar | scratchpad-decisions.md:150 | ✓ |
| GT3 run-scoped refusal `scratchpad_not_available` | scratchpad-decisions.md:1258; coordinator.mjs:11702 | ✓ (workflowHorizon viewer gate) |
| GT4 `_providerBrief(brief)` | coordinator.mjs:3790 | ✓ |
| GT4 `UNTRUSTED_CONTEXT_PACK` frame | coordinator.mjs:3816 | ✓ |
| GT4 `briefing` augmentation `{...inner, briefing}` | coordinator.mjs:3829-3838 | ✓ (`briefing` returned :3838) |
| GT4 `briefDigest` hashes only `task.brief` | coordinator.mjs:3831-3833 comment, :4506 | ✓ |
| GT4 `renderBrief` renders `## Ambient knowledge` last | adapter.mjs:96-163, header :148, section :147-161 | ✓ |
| GT4 `renderPrompt` CLI dialect bounds | cli-adapters.mjs:78-109 | ✓ (bounds; **see §1.2 note C**) |
| GT6 `projectTypedTerminalCause` | application-semantics.mjs:2123 | ✓ |
| GT6 `dispatch_refused` arm | application-semantics.mjs:2144 (block :2137-2144) | ✓ (cited :2140-2144, loose-tail) |
| GT6 `operator_stop` arm | application-semantics.mjs:2146 | ✓ |
| GT6 `debugGateRefusal` | application.mjs:993 (`grep -an`) | ✓ — projects `{gate, detail}` from `error … phase==='trust_gate'` + `verify.reverified{accept:false}` only |
| GT6 `terminalCauseNarrative` | application.mjs:2268 (`grep -an`) | ✓ |
| GT7 `composeFrameLimitRefusal` | limits.mjs:40 | ✓ |
| GT7 `FRAME_LIMITS` registry rows | limits.mjs:51-109 (declaration :110) | ✓ (cited :53-110, loose-open) |
| GT7 `spill.body` 1 MiB | limits.mjs:86 (`value: 1048576`) | ✓ |
| GT7 `wave.member.objective` 4096 admission | limits.mjs:57 | ✓ |
| GT7 `_renderContextRead` spill branch | coordinator.mjs:10798 (fn :10796) | ✓ (cited :10797) |
| GT7 `UNTRUSTED_SCRATCHPAD` frame | coordinator.mjs:10816 | ✓ |
| GT7 #79 items/bytes rows | worker-delivery-push-contract.md:176-178 | ✓ (`view.attention_push.items`=8, `.bytes`=4096) |
| GT7 #69 items/bytes rows | repl-realization-contract.md:424-427 | ✓ (`view.repl_object.items`=8, `.bytes`=4096) |
| GT7 #69 D7 independent rows | repl-realization-contract.md:430 | ✓ |
| GT8 `_steeringEvidenceQualifies` | coordinator.mjs:2208 | ✓ — scratchpad/`capability_op` dedup by `steering.digestSet`; `turn_started` always-qualifies; reads mint no evidence |
| GT8 scratchpad evidence route (distinct digest) | coordinator.mjs:12443-12454 | ✓ — `_observeSteeringCycle({kind:'scratchpad', digest: receipt.contentDigest})` only after a real store write |
| GT8 `context.read` is NOT TG2 progress | coordinator.mjs:12462-12463 | ✓ |
| 93B rule 5 salvage path | wave-durability-decisions.md:69-72 | ✓ |
| #69 D2 at the `_providerBrief` seam | repl-realization-contract.md:232, :496 | ✓ |
| #79 D1 at the `_providerBrief` seam | worker-delivery-push-contract.md:133 | ✓ |
| #69 D7 rendering order | repl-realization-contract.md:413-415, R7 :524 | ✓ |
| composition-decisions.md v2 rule 4 `redriveMembers(manifest, roles, {newIdempotencyKey})` | composition-decisions.md:60-65 | ✓ |
| RC-B deferral | composition-decisions.md:66-67 | ✓ |
| R-DC-2 manifest-based signature | redteam-v1.md:30-54 | ✓ (**see §1.2 note B**) |
| `redriveMembers` absent from recipes.mjs | grep `impl/src/recipes.mjs` | ✓ no such identifier |
| RC-B intentionally absent | impl/test/recipes-red.test.mjs:7, :10-11 | ✓ ("Rungs RC-B (attach/redrive helpers) … intentionally absent") |
| R1-R8 RED status | grep across `impl/` | ✓ no `view.continuity.*` rows; no `## Re-drive continuity`; no `UNTRUSTED_RE_DRIVE`; no `carryForward`; no `redriveMembers` |

### 1.2 Loose-range notes (not blockers)

- **A.** GT7 "`FRAME_LIMITS` (limits.mjs:53-110)" — the ADMISSION/SUBSTRATE/VIEW row objects span
  :51-109 and the exported declaration sits at :110. The cited range opens one line late and closes
  on the declaration line; substance right.
- **B.** D3 "R-DC-2's manifest-based shape, redteam-v1.md:40-54" — line 40 states the OLD defective
  `redriveMembers(waveId, roles, recipe)` signature (the failure being repaired); the manifest-based
  repair is at :52-54. The range covers both, so the citation is defensible, but the new shape is at
  :54, not :40.
- **C.** GT4 "`renderPrompt` (cli-adapters.mjs:78-109) is the CLI dialect of the same served brief" —
  the function bounds are right, but `renderPrompt` does NOT currently render the `## Ambient
  knowledge` block or any `briefing`/knowledge field; it renders `Task`/dispatch/context/constraints/
  path-scope/`Done when:`/verification only. It is a flat CLI prompt, not a rendering of the same
  served brief. This matters for D2 (§3): the continuity section must be added to BOTH renderers,
  and renderPrompt has no "after `## Ambient knowledge`" slot — #79 D1 already pins a DIFFERENT
  renderPrompt position (after the verification contract line). The contract does not address this.

### 1.3 RED-state confirmation

`grep` across `impl/` at HEAD confirms the behavior is genuinely absent today: no `view.continuity.*`
registry rows, no `## Re-drive continuity` section in either renderer, no `UNTRUSTED_RE_DRIVE` frame
literal, no `carryForward` on any signature, no `redriveMembers` in `impl/src/recipes.mjs`, and the
#79/#69 sections the continuity block must compose beside are likewise RED (no `## Pending attention`,
no `## Cited REPL objects` rendered today). **All pins R1-R8 are red-first.** The red-suite harness
shape (`impl/test/recipes-red.test.mjs` — `BatonApplication` + `MockAdapter` + `createDriver`) is the
workable template for the #59 red suite.

---

## 2. D1 — The closed content set: exactly four carried members, all UNTRUSTED-framed — **HOLE**

**Verdict: HOLE.** The four-member set is right-sized and the UNTRUSTED frame concept is right, but
the contract does not pin the RENDER-seam discipline that makes the frame actually stop injection —
and the injection discipline is the whole game (the poisoned-successor axis).

### 2.1 The frame is a header, not a per-item seam — the poison passes through the body

D2 pins the section-opening frame literal and R3 pins that a provenance header exists, but NEITHER
pins what happens to the carried BODY. The four members are model-authored content (a dead attempt's
scratchpad notes, its refusal/failure evidence) rendered into a fresh worker's brief. The contract
binds leaf text by the #79 D2 shed semantics (truncate + spill) but never pins:

- **Per-item framing.** #79 D1 (worker-delivery-push-contract.md:155-163) pins a closed frame literal
  **plus** `- [attention/untrusted] ${kind} ${requestId}: …` on EVERY item, plus
  `wrapHubDerived`/`wrapProse` wrapping of every hub- and model-authored leaf, plus the explicit
  warning that mapping the push onto the trusted `wrapFact` wrapper would ship `untrusted: false`
  hub content across the provider seam — "the exact injection the frame exists to stop". #79 R8
  (:409) pins "every item renders as `[attention/untrusted]`; no unframed hub-derived content crosses
  the provider seam." #59 has NO per-item frame, NO wrap requirement, NO "no unframed carried content
  crosses the seam" pin. A single header literal above an 8-item body of raw dead-attempt text is
  not the discipline #79 already set.
- **Section-breakout neutralization.** A carried scratchpad note can contain `## Verification (the
  ONLY definition of done …)`, `## Cited REPL objects`, `## Pending attention`, or a second fake
  `UNTRUSTED_RE_DRIVE` header claiming a different (more trusted) source. Rendered raw, the injected
  `## `-prefixed line reads as an orchestration section to the fresh model — the exact "note reading
  'the orchestrator approved skipping verification'" attack the brief names. The contract never pins
  that carried bodies are rendered so they cannot emit an orchestration-reserved heading (prefix/
  indent/quote every carried line; strip or escape `## `-prefixed lines; or refuse to render a body
  that contains the reserved names).
- **Byte-checked frame.** The brief asks "is the UNTRUSTED frame applied at the RENDER seam
  (byte-checked)?" The contract pins the literal but not a render-time invariant that the frame
  actually opens the served section (e.g. the renderer composes the frame + digest + bodies in one
  closed serializer and any body that cannot be framed is refused, never appended unframed). #79
  pins the analogous invariant via `wrapHubDerived` provenance; #59 pins none.

**Fix (fold pins):** (a) every carried member renders under a per-item frame literal
(`- [carried/untrusted] ${scope} ${entryId|digest}: …`), mirroring #79 D1/R8; (b) carried leaf text
is `wrapProse`-wrapped (`provenance: 'model-authored', untrusted: true`) and any line beginning
`## ` (or equal to an orchestration-reserved section name) is neutralized before render — never
passed through as markdown structure; (c) the renderer composes the section in one closed serializer
— a body that cannot be framed is refused with a typed code, never appended unframed. Amend R3 to
pin per-item framing + body neutralization, not just the header literal.

### 2.2 Within-block starvation: the 8-item budget has no per-member allocation

`view.continuity.items` = 8 bounds the ENTIRE block across all four members, but the allocation
between scratchpad / pins / terminal / refusals is un-pinned. The scratchpad projection is the
load-bearing member; if it renders first and takes all 8 items, the pin list and refusal evidence
spill — the fresh attempt must then fetch nearly the whole carry from the spill lane, defeating the
"evidence in the brief" purpose. The terminal cause and refusal evidence are small and closed; a
reservation order (terminal + refusals always in-block; scratchpad + pins share the remainder) would
make the block stable.

**Fix:** pin a per-member reservation or a fixed render order inside the block (terminal, refusals,
then scratchpad, then pins), with spill only for the remainder. Also pin the new rows' `graceful`
fields to mirror #79 (`view.continuity.items`: `'spill-digest-citation'`; `view.continuity.bytes`:
`'shed-flagged'`) — the contract leaves the graceful values unspecified.

---

## 3. D2 — The composition seam — **HOLE**

**Verdict: HOLE.** The named-section shape and the "never `task.brief`" pin are right, but the
renderer coverage is under-specified and the ordering amendment conflicts with the already-pinned
#69/#79 render order.

### 3.1 Renderer coverage: one order is pinned, two renderers exist

D2 pins a single served order (`## Ambient knowledge` → `## Re-drive continuity` → `## Cited REPL
objects` → `## Pending attention`) — that is a `renderBrief` order. #79 D1 pins BOTH renderers and
DIFFERENT positions: in `renderBrief` after `## Ambient knowledge`, in `renderPrompt` **after the
verification execution contract line — the last lines of the prompt** (worker-delivery-push-contract.md
:150-153). `renderPrompt` today renders no `## Ambient knowledge` block (§1.2 note C), so the
continuity section has no "after Ambient knowledge" slot there. R2 ("No `## Re-drive continuity`
section renders in the provider-facing brief") does not require both renderers. A fold that adds the
section to `renderBrief` only would leave every `renderPrompt`-dialect provider without the carry.

**Fix:** pin the section in BOTH renderers and pin `renderPrompt`'s position explicitly (mirror #79:
after the verification contract line), OR pin that the continuity block rides the structured
`briefing` augmentation only and is served as brief data — but then say so and define how
`renderPrompt` surfaces it. Ambiguity here is the fold's.

### 3.2 The ordering amendment collides with #69 R7 and #79 D1

D2 amends #69 D7's order by inserting continuity immediately after `## Ambient knowledge`, and claims
"the #69 R7 and #79 D1 anchors stay true: `## Cited REPL objects` and `## Pending attention` still
render AFTER the continuity block." But #69 R7 (repl-realization-contract.md:524) pins
`## Ambient knowledge` → `## Cited REPL objects` → `## Pending attention` **with no continuity
member**, and #79 D1 pins pending attention in renderPrompt as the LAST lines. If #69 or #79 folds
AFTER #59, its red suite's render-order pin (R7 / D1) is violated by the #59 insertion; if #59 folds
after them, its own D2 must insert into an order #69/#79 already pinned. The contract's
fold-order-independence claim (repl-realization-contract.md:430) covers the REGISTRY ROWS only — the
render seam is shared mutable state that both contracts pin. Nothing resolves which fold lands first
or who amends whom.

**Fix:** pin the fold-order resolution explicitly — either (a) #59's fold lands before #69/#79 and
the #69/#79 folds must insert their sections after the continuity block, or (b) #59 amends #69 R7 /
#79 D1 in the same fold and the red suites of the earlier contracts are re-run/amended. Leaving the
order pinned in two contracts without a resolution is how a later fold silently breaks an earlier
fold's acceptance.

---

## 4. D3 — Opt-in per re-drive; typed refusal for cross-role / unrelated wave — **SOUND with minor gaps**

**Verdict: SOUND** on the core: opt-in, never default-on; closed `{sourceRunId, scopes}` shape;
role/wave validation BEFORE any side effect; typed, surface-constant refusals (closed `code`, never
a silent drop or silent accept). The role check reads store records (the run's member descriptor),
which model-authored content cannot mutate, so a dead attempt cannot spoof the source's role. Two
under-specifications remain:

- **Wave-chain definition.** "a member of the same wave or a direct predecessor wave in the same
  wave chain" — "same wave chain" is not defined. If the caller may assert the chain, an unrelated
  wave that merely shares a role could be named. **Fix:** pin the chain relation concretely — the
  source attempt must be a member of (i) the same waveId as the re-driven member, or (ii) the wave
  recorded as this wave's direct predecessor in the fresh wave's manifest / idempotency-key chain —
  never a caller-asserted relation.
- **Option-shape validation.** The contract pins the closed `carryForward` SHAPE but not the
  admission of the option itself: a `carryForward` that is not an object, is missing `sourceRunId`,
  or carries an empty `scopes` array is not assigned a typed refusal. **Fix:** add a
  `redrive_carry_option_invalid` refusal for a malformed/empty `carryForward` option (the refusal
  table's "never silent" law should cover the option's own admission).

---

## 5. D4 — Carried content is evidence, never authority — **SOUND**

**Verdict: SOUND.** The TG2 law is shipped and verified (§1.1): `_steeringEvidenceQualifies`
(coordinator.mjs:2208) admits scratchpad evidence only when its content digest is distinct in
`steering.digestSet`, and digests enter the set ONLY from a real store write receipt
(coordinator.mjs:12454). Carried rows are read-only brief text — they never pass through
`writeScratchpad`, never mint a `contentDigest`, and `context.read` is explicitly NOT TG2 progress
(coordinator.mjs:12462-12463). No fold/read path surfaces the carried state to an authority decision:
gates evaluate the fresh attempt's own artifacts; a pin's content still must pass the fresh
attempt's verification; a carried row cannot answer a steering cycle.

One strengthening pin the fold should add: **the capture is a projection into the brief, never a
store write into the fresh run.** If the fold implemented the carry as a "restore" of the dead
attempt's scratchpad into the fresh run's store, dead-attempt rows would become readable as the fresh
run's OWN scratchpad through the run-scoped API, weakening the GT3 boundary and blurring "this
attempt's digests". R6 covers the digest-routing test but should be amended to pin the no-store-write
invariant explicitly.

---

## 6. The pin digest list (D1.2) — **HOLE (under-specification)**

**Verdict: HOLE.** D1.2 says "the resolved pin shas from `refs/baton/results/*`" without pinning the
disambiguation. `resolveResultPin` (wave.mjs:134) returns ONE newest pin per
`{report, startedAtMs, excludeShas}`; its window (wave.mjs:143) is a LOWER bound only
(`>= startedAtMs - 60_000`, no upper bound). A naive enumeration of every `refs/baton/results/*` ref
inside the window — with no report-path disambiguation — can include pins minted by OTHER members or
OTHER attempts that ran in the same span; the fresh attempt would be told "these are the dead
attempt's completed work" and could resolve a pin pointing at content the dead attempt never produced.
The contract's own GT2 says `resolveResultPin` "resolves one preserved result pin per member" — the
LIST must be bound the same way: the dead member's `{report, startedAtMs, excludeShas}`-derived pins,
never a raw ref scan.

**Fix:** pin the list = the dead member's checkpoint history as `resolveResultPin` would disambiguate
it (per report path, per the member's start window, excluding shas attributed to other members), and
carry the dead attempt's `startedAtMs` + `report` path alongside so the fresh attempt can re-run the
salvage path (the open-question framing treats this as unresolved; the list is only self-sufficient
if the carried shas are directly citable — pin that too).

---

## 7. Refusal vocabulary — **SOUND with minor gaps**

**Verdict: SOUND.** Eight typed codes, each mapping to a closed `code`, never a silent drop/accept;
cross-role and unrelated-wave refusals happen BEFORE any side effect; the frame-economics bound
refusals (`redrive_carry_oversized`, `redrive_carry_spill_unavailable`) route through the
#89 ONE-composer (`composeFrameLimitRefusal`, limits.mjs:40). Missing only the malformed-option
refusal from §4. `redrive_carry_no_evidence`'s "renders its absence-on-empty" is consistent with the
#89 absence-on-empty law #79 D1 and #69 D2 pin.

---

## 8. Acceptance pins (red-first) — **SOUND with amendments**

All eight pins are genuinely RED at HEAD (§1.3). Amendments needed so the fold's green test actually
proves the injection discipline:

- **R3** — strengthen to include per-item framing + body neutralization (§2.1): the frame literal
  alone does not prove the poison is stopped.
- **R2** — require BOTH renderers (§3.1), or explicitly scope to the structured brief and define the
  CLI surface.
- **R6** — add the no-store-write invariant (§5): a red test that the carry writes nothing to the
  fresh run's store.
- **R7** — pin the new rows' `graceful` values (§2.2).

---

## 9. Open questions — verdicts

- **The carry window.** Honest and correctly framed; the fold must pin capture-at-re-drive with a
  digest-cited snapshot, and `redrive_carry_unknown_source` / `redrive_carry_no_evidence` cover the
  records-reaped degradation. No blocker.
- **The pin list's freshness.** Correct concern — but note the window is a lower bound only, so the
  dead attempt's own pins are resolvable after death; the real gap is the `startedAtMs`/`report`
  inputs for re-resolution, which §6 makes part of the carried set. Fold with §6.
- **Default-on for same-role re-drives.** Sound as a successor; keep it gated on D4 proving out.
- **The REPL-lane composition.** Sound as a successor; D2's non-blocking posture is consistent with
  #69's own independent-rows pin.

---

## 10. Final verdict — **NOT FOLD-READY**

The architecture is sound where it counts: opt-in carry, a closed four-member set, the TG2
evidence-law (D4) holding by construction, typed refusals, and genuinely red acceptance pins. But the
poisoned-successor axis — the attack this brief exists to test — is exactly where the contract is
thinnest: it pins the frame HEADER but not the per-item framing and body neutralization that #79
already pins for its own carried content, and it pins a render order that collides with the already
pinned #69/#79 render order without resolving the fold sequence.

Numbered blockers (what + why + concrete fix):

1. **Per-item framing and body neutralization are unpinned (D1/D2).** A carried scratchpad note can
   inject `## `-prefixed orchestration-reserved sections or a fake frame header; a single
   section-opening frame literal does not stop it. Fix: per-item `[carried/untrusted]` frames +
   `wrapProse` wrapping + neutralization of `## `-prefixed/reserved lines at the render seam, and
   amend R3 to test exactly that.
2. **Renderer coverage under-specified (D2).** One render order is pinned; two renderers exist, and
   `renderPrompt` has no `## Ambient knowledge` slot. Fix: pin the section in BOTH renderers with
   renderPrompt's position (mirror #79 D1: after the verification contract line), or scope it
   explicitly to the structured brief and define the CLI surface.
3. **Fold-order collision with #69 R7 / #79 D1 (D2).** The amended order invalidates whichever of
   #69/#79 folds second. Fix: pin the fold-order resolution (who lands first, who amends whom) in the
   contract, not just the registry-row independence.
4. **Pin digest list disambiguation un-pinned (D1.2).** A raw window scan can include other
   members'/attempts' pins. Fix: pin the list to the dead member's
   `{report, startedAtMs, excludeShas}`-derived checkpoint history and carry `startedAtMs` + `report`.
5. **Wave-chain and carryForward-option validation un-pinned (D3).** "Same wave chain" is
   caller-assertable; a malformed/empty `carryForward` option has no typed refusal. Fix: pin the chain
   relation to the fresh wave's recorded predecessor / idempotency-key chain, and add
   `redrive_carry_option_invalid`.
6. **No-store-write invariant un-pinned (D4/R6).** A restore-implementation would leak dead-attempt
   rows into the fresh run's own scratchpad horizon. Fix: amend R6 with a red test that the carry
   writes nothing to the fresh run's store.
7. **Within-block allocation un-pinned (D1).** A large scratchpad can consume all 8 items and push
   the pin list/refusal evidence to the spill. Fix: pin per-member reservation or a fixed render
   order inside the block, plus the rows' `graceful` values.

With blockers 1-7 resolved (1-3 are design pins, 4-6 are admission/validation pins, 7 is a budget
pin), the contract is fold-ready. The D4 evidence-law (blocker-free) and the opt-in/refusal posture
(blocker-free) should not change.
