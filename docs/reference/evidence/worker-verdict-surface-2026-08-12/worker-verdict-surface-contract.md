# Issue #61 — Worker-visible verdict surface + objectives generated from live truth (v1.0 DRAFT)

The implementation contract for issue #61 (the two AX clarity items): (a) the worker-facing
VERDICT STRUCTURE the judged worker corrects against, and (b) the objective's HARD CONSTRAINT
block generated from the deployment's ACTUAL laws at compose time. It specifies behavior; it does
not amend implementation in this artifact. It is a Ring-2 contract (ground truths → decisions →
refusal vocabulary → red-first acceptance → open questions). It cross-references — it does not
re-specify — #64 (the TG4 verdict-shape epic), DG-1 (`run.debug`/`run.feedback` — the
operator/revision-channel side), #79 (the worker-delivery push — the DELIVERY half), #73 (the
forge-hardening — worker-bound verdicts hub-minted), and #141 (the boundary-commit workstyle law).

Verification HEAD: `974ed580d5c12e7d0736c564a517c0faf99d2698` ("Baton private effective-tree
snapshot"), the tree this v1.0 DRAFT was verified against. Date: 2026-08-11.

**v1.0 DRAFT note.** This is the initial draft; no red-team fold has run against it. Every
`file:line` citation below was verified in THIS worktree with NUL-safe `grep -an` searches and
targeted `sed -n` reads. `impl/src/application.mjs` and `impl/src/coordinator.mjs` are
NUL-bearing files; their anchors are grep/sed-verified, never whole-file reads. Sorted-key
literals are quoted in their ACTUAL source order (none are sorted claims); no `localeCompare`
ordering is used anywhere in this contract.

Scope of the two items, in one sentence: **a refused worker's next-turn context carries the closed,
hub-minted verdict structure `{gate, checked, detail, corrective}` — WHICH gate, WHAT it checked,
the sanitized failing-evidence class, and the corrective class — and the objective's HARD
CONSTRAINT block is generated per-line from live policy reads, silent when a line cannot be
derived.**

---

## Ground truths (code-verified)

**GT1 — The DG-1 verdict projection is the already-sanitized `{kind, code, message, gate, detail}`.**
`debugGateRefusal(events)` projects the LATEST trust-gate/verifier refusal
(`error` with `payload.phase === 'trust_gate'`, or `verify.reverified` with `payload.accept ===
false`) via `.at(-1)`, and returns `{kind, code, message, gate, detail}` (application.mjs:993-1014;
the run.debug caller is application.mjs:11321). `debugGateFromLiveCode` maps the live code to the
gate: `worker_path_scope_violation → scope`, `forbidden_effect_observed → forbidden_effect`,
`verification_red_green_failed → red_green`, `verification_coverage_failed → coverage`,
`plan_route_mismatch`/`recovery_route_mismatch → route_mismatch`, else `unknown`
(application.mjs:949-956). `debugGateDetail` shapes the evidence: `scope → {digests, counts}`
(NEVER path strings — the digests-only design), `red_green`/`coverage → {tail:
sanitizeVerifierDiagnosticText(raw).text}` (the sanitizer at verifier-diagnostics.mjs:26, reused
verbatim), else `{}` (application.mjs:958-992). `DEBUG_GATE_CODES` is the closed gate enum, in
ACTUAL insertion order: `['scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect',
'unknown']` (application.mjs:945-947).

**GT2 — `required_effect_absent` degrades to `gate:'unknown'` today — the TG4 gap #61 fixes.**
`debugGateFromLiveCode` has no `required_effect_absent` branch, so the code falls through to
`'unknown'` (application.mjs:956). The mint fires `required_effect_absent` when an
`repository_edit`-requiring plan captures no in-scope diff from its base
(coordinator.mjs:12995-13010, with `requiredEffectEvidence`). TG4 pins the fix:
"`required_effect_absent` names itself in the worker-visible verdict — today's degradation to
`'unknown'` is fixed" (trust-gate-steering-decisions.md:123-124). The terminal-cause projection
already names the exact code (`policy_failure` + `required_effect_absent`,
coordinator.mjs:13869-13873); the worker-visible GATE does not.

**GT3 — The #79 push is the verdict's delivery lane, and it is RED in this tree.** #79 D6 pins
the pushed `gate_verdict` item as the worker-scoped projection
`debugGateRefusal(events.filter((event) => event.worker === workerId))`, keyed `gate:${event.seq}`,
framed `wrapHubDerived` (`provenance: 'hub-derived'`) inside the `[attention/untrusted]` frame
(worker-delivery-push-contract.md:317-323, :294). No `## Pending attention` block exists in any
provider-facing brief in this tree — the delivery lane is absent, so #61 composes ON the #79 lane
and never re-specifies its mechanics.

**GT4 — The #73 forge-hardening pins the hub-minting law.** Worker-bound verdicts must be
HUB-MINTED — derived from the durable event log, never caller-authored. `run.feedback` is NOT the
verdict lane (caller-authored forgery surface; TG4 at trust-gate-steering-decisions.md:121-123 and
the #73 contract at feedback-forge-hardening-contract.md:97-100). The #79 push item's
machine-readable discriminator is `wrapHubDerived.provenance === 'hub-derived'`; the item carries
NO `derived` field (feedback-forge-hardening-contract.md:27, :55-61). `debugGateRefusal` is the
hub-minted precedent to reuse — the ledger projection, not a parallel redaction path
(feedback-forge-hardening-contract.md:57).

**GT5 — The gate mints are the live "what was checked" evidence.** Each trust-gate error mint is a
static, hub-authored message plus a closed evidence payload:
- `forbidden_effect_observed` — 'captured worker result observed an effect forbidden by its
  approved Plan' (coordinator.mjs:12967-12971).
- `worker_path_scope_violation` — 'captured worker result changed paths outside approved Plan
  scope', with `pathScopeEvidence` (changedPathsDigest / inScopeChangedPathsDigest /
  outOfScopeChangedPathsDigest + counts; coordinator.mjs:12976-12991).
- `required_effect_absent` — 'approved Plan required a repository edit but capture proved no
  in-scope diff from its base', with `requiredEffectEvidence`
  (baseSha, sha, changedPathsDigest, inScopeChangedPathsDigest + counts;
  coordinator.mjs:12995-13010).
`verify.reverified` (coordinator.mjs:13094) carries the verdict with a `diagnosticCode`
(`verification_red_green_failed` / `verification_coverage_failed`, coordinator.mjs:419) and the
top-level `worker` field the worker-scoped projection filters on (coordinator.mjs:6459, :13094).

**GT6 — The objective's HARD CONSTRAINT block is a static preset today.** The implement-contract
preset ships `IMPLEMENT_CONSTRAINTS` verbatim — including the wire_frame line, the `Do NOT git
commit` line, the no-new-surfaces line, and the SCRATCHPAD_WRITE shape line
(recipes.mjs:529-537; the preset copies them at recipes.mjs:557). The block renders as
`brief.constraints` → `## Constraints` (`- ${c}` per line, adapter.mjs:128-131) and
`Constraints:` (cli-adapters.mjs:100). The live-policy constraint precedent ALREADY exists: the
goal's constraints array is composed from the deployment profile (`[...profile.constraints,
constraint, workflowConstraint, resultConstraint]`, application.mjs:4566-4572), where `constraint`
is `profileConstraint(name, profile)` → `Baton deployment profile ${name}@${profile.digest}`
(application.mjs:2207-2209) and the result-policy marker is
`RESULT_POLICY_CONSTRAINT_PREFIX` → `Baton objective/result policy ${kind}`
(application.mjs:112, :116-119). The goal's constraints reach the worker's `## Constraints` block
directly: `buildAuthoritativeBrief` sets `brief.constraints = clone(goal.constraints)`
(goal-plan.mjs:415-419), so the profile/result-policy lines already render in the block today.

**GT7 — The deployment READS the worker's commits; the #141 norm made `Do NOT git commit` false.**
The trust-gate capture resolves the worktree `HEAD` (`git rev-parse HEAD`,
worktree.mjs:1232) and diffs it against the base (`changedPathsFromBase`,
worktree.mjs:1233); when the worktree is dirty the capture self-snapshots with a
`baton snapshot: ${taskId}` commit (worktree.mjs:1219-1230). Result and checkpoint pins preserve
commits: `retainResult` → `refs/baton/results/${sha}` (index.mjs:837-838),
`retainCheckpoint` → `refs/baton/checkpoints/${sha}` (index.mjs:849-850), enumerated by
`resolveResultPin` via `git for-each-ref refs/baton/results/` (wave.mjs:134-140). The #141 law is
explicit: "commit your worktree at NATURAL SUBSYSTEM BOUNDARIES … a checkpoint pin per boundary, so
a drained wave never loses the work" (impl-114-brief.md:45). The evidence is the impl-114 first
attempt — 2.5h with zero commits; the scratchpad/findings died with the worker, only the boundary
commits saved the code (redrive-continuity-contract.md:55, :85-95). A worker's own snapshot and
boundary commits are the deployment's preservation substrate — the `Do NOT git commit` line is
false boilerplate in this deployment.

**GT8 — The wire frame is a per-lane, card-pinned bound.** The provider-governance card carries
`maxWireFrameBytes` (provider-governance.mjs:10, validated :108-111); the coordinator projects the
card's ceiling (coordinator.mjs:3367) and refuses `wire_frame_bound_unavailable` when the value is
absent or above the card ceiling (coordinator.mjs:3345-3347). The substrate `wire.frame` row is
1 MiB (limits.mjs:81); the deployment defaults to 8 MiB with a 64 KiB–16 MiB clamp
(application-deployment.mjs:718-720). Whether a lane "carries" a wire frame is therefore a LIVE
read of the provider-governance card — not a constant.

**GT9 — The frame budgets bound the generated block.** The recipe caps are derived so a
fully-maxed card stays under the objective ceiling: `CONSTRAINT_MAX_BYTES = 240`,
`MAX_CONSTRAINTS = 8`, `RENDERED_OBJECTIVE_MAX_BYTES = 4096` (recipes.mjs:26-36); the run and
wave-member objective admission rows are both 4096 bytes (limits.mjs:56-57). `renderObjective`
joins `[task, ...constraints, '[attempt: ${salt} ${role}]']` and refuses `recipe_oversize` past the
ceiling (recipes.mjs:296-314). Any generated constraint block must fit these — the per-line table
in D4 stays under 240B/line by construction (GT6's longest line, the SCRATCHPAD_WRITE shape, is
~230B).

**GT10 — The DG-1 feedback admission is the same closed shape.** `run.feedback`'s gate-cause form
validates EXACTLY `{gate, detail}` against `DEBUG_GATE_CODES` and the per-gate detail closure —
`exactObject(value, ['gate', 'detail'])`, scope digests keys in ACTUAL order
`['changedPathsDigest', 'inScopeChangedPathsDigest', 'outOfScopeChangedPathsDigest']`, counts
`['changedPathCount', 'inScopeChangedPathCount', 'outOfScopeChangedPathCount']`, red_green/coverage
`{tail}` re-sanitized, others `{}` (application.mjs:1595-1644). This is the operator/revision
side (DG-1b) — #61's structure shares the SAME closed-shape vocabulary but is hub-minted for the
worker lane (#73), never the caller-authored feedback path.

---

## Decisions

### D1 — The verdict structure #61 owns: the closed field set `{gate, checked, detail, corrective}`

#79 owns the DELIVERY mechanics (the push lane, the per-worker projection, `gate:${event.seq}`
keying, `wrapHubDerived` framing, the item-count/byte bounds — cross-reference, do not re-spec).
#61 owns the STRUCTURE of the worker-facing verdict — the closed field set the judged worker
corrects against. The pushed `gate_verdict` item carries, in addition to #79's
`{kind, code, message, gate, detail}`, two hub-computed structural fields:

- **`gate` — WHICH gate refused.** The `DEBUG_GATE_CODES` member, amended by D3. Today: `scope`,
  `red_green`, `coverage`, `route_mismatch`, `forbidden_effect`, `unknown` — plus `required_effect`
  once the D3 amendment lands.
- **`checked` — WHAT was checked.** A closed, static string naming the check the gate ran,
  hub-computed from a per-gate table over GT5's mint evidence — never the event's raw message
  (the message field stays #79's static-or-sanitized field) and never model-authored prose (TG4:
  "never orchestrator prose", trust-gate-steering-decisions.md:299-300). The closed table:
  - `scope` → `'the captured worker diff against the approved Path scope'`
  - `forbidden_effect` → `'the captured worker result for an effect the approved Plan forbade'`
  - `red_green` → `'the red/green verification of the captured result'`
  - `coverage` → `'the coverage verification of the captured result'`
  - `route_mismatch` → `'the plan-gated dispatch route against the actual harness'`
  - `required_effect` → `'whether the captured result produced an in-scope repository edit'`
  - `unknown` → `null` — the honest fallback; a check that cannot be named projects `null`, never a
    guessed name (`verdict_checked_unmapped`, refusal vocabulary).
- **`detail` — the failing evidence class.** The already-sanitized DG-1 shape (GT1), extended per
  D3 for `required_effect`. Digests+counts for `scope`; sanitized tail for `red_green`/`coverage`;
  the closed `{baseSha, sha, digests, counts}` evidence-shape for `required_effect` (TG4's
  "baseSha/sha digests hub-side" amendment, trust-gate-steering-decisions.md:119-120); `{}` for
  `route_mismatch`/`forbidden_effect`/`unknown`. NEVER raw paths or raw tails — the
  verifier-diagnostics law (GT1) governs every leaf.
- **`corrective` — the corrective class.** A closed enumeration naming the class of action that
  would un-refuse the gate, hub-computed from a static per-gate table — never model-authored
  prose, never a guessed action. The closed table:
  - `scope` → `'restrict_diff_to_path_scope'` — the out-of-scope paths must leave the diff or be
    re-planned.
  - `forbidden_effect` → `'refrain_from_forbidden_effect'` — do not perform the effect the Plan
    forbade.
  - `red_green` → `'make_red_green_pass'` — the sanitized tail names the failing test class; pass
    it.
  - `coverage` → `'extend_coverage_to_required_paths'`.
  - `route_mismatch` → `'dispatch_through_the_exact_harness'`.
  - `required_effect` → `'produce_in_scope_repository_edit'` — a genuine in-scope diff from the
    base is the acceptance requirement.
  - `unknown` → `'none'` — no corrective class can be named; the honest fallback.

The field-set law: the corrective-relevant verdict is EXACTLY these four classes — no raw
evidence, no rationale prose, no lane/event internals, no corrective the hub did not compute.
This is TG4's worker-learning statement operationalized: "The worker learns WHICH gate, WHAT it
checked, and the sanitized evidence class" (trust-gate-steering-decisions.md:292-300) — now plus
the corrective class, still never orchestrator prose.

### D2 — The ownership boundary: #61 (structure) vs #79 (delivery) vs #73 (minting) vs DG-1 (operator surface)

- **DG-1** owns the `run.debug` / `run.feedback` operator/revision-channel `{gate, detail}`
  projection (diagnostics-decisions.md:33-43, :76-78; the closed admission shape at GT10). It is
  the operator's and revision channel's side — caller-authored feedback is admitted by shape but
  is NOT verdict evidence (#73).
- **#73** owns the provenance law: `run.feedback` is a forged-verdict surface; worker-bound
  verdicts must be hub-minted, and the discriminator is `wrapHubDerived.provenance ===
  'hub-derived'` (GT4).
- **#79** owns the delivery mechanics: the `## Pending attention` block, the per-worker
  projection, the `gate:${event.seq}` key, the `wrapHubDerived` frame, the item-count/byte bounds
  (GT3).
- **#61** owns the STRUCTURE: the closed field set `{gate, checked, detail, corrective}` (D1), the
  gate-enum amendment (D3), and the objective-generation law (D4/D5). It amends the pushed item's
  field set and the gate enum — nothing else. No re-specification of #79's lane, #73's provenance
  law, or DG-1's operator projection.

### D3 — The gate-enum amendment: `required_effect` names itself

`required_effect_absent` gains a named gate. `DEBUG_GATE_CODES` (application.mjs:945-947) is
amended to include `required_effect` (the member serializes as `required_effect`; the live code
`required_effect_absent` maps to it in `debugGateFromLiveCode`, application.mjs:949-956). The
worker-visible verdict for a `required_effect_absent` refusal is `gate: 'required_effect'` with
`detail` = the closed evidence-shape `{baseSha, sha, changedPathsDigest,
inScopeChangedPathsDigest, counts}` — the hub-side digests only, per the TG4 evidence-shape
amendment (GT2, trust-gate-steering-decisions.md:119-120). This closes GT2's gap: the gate the
worker sees is the gate that actually refused, never the `'unknown'` fallback. Genuinely unmapped
codes still serialize `unknown` (the DG-1b pin, diagnostics-decisions.md:78).

**The `run.feedback` admission (GT10) needs no amendment.** The gate-cause fallback of
`normalizeGateCauseFeedback` accepts any `DEBUG_GATE_CODES` member with `detail: {}`
(application.mjs:1641-1642), so `required_effect` is admitted on the caller-authored operator
channel with the closed-empty detail — which is exactly right: caller-authored feedback is NOT
verdict evidence (#73), and the full `required_effect` evidence shape rides the hub-minted worker
lane only, never a caller-authored submission. The enum gains a member; the admission keeps its
closed-empty posture for the non-verdict channel.

### D4 — Objective constraints generated from live truth (the generation rule)

The HARD CONSTRAINT block (`brief.constraints`, rendered as `## Constraints` in renderBrief
adapter.mjs:128-131 and `Constraints:` in renderPrompt cli-adapters.mjs:100) is composed at
brief-construction time by a pure generator over LIVE deployment state — the
`profileConstraint`/result-policy precedent (GT6) generalized to the whole block. Each printed
line derives from a live policy read; the source is NAMED per line. The per-line table:

| Constraint line (rendered) | Live-policy source | Printed IFF |
|---|---|---|
| `Baton deployment profile ${name}@${digest}` | `profileConstraint(name, profile)` (application.mjs:2207-2209) — the profile registry's live digest | the deployment profile resolves at compose time (already shipped today, GT6) |
| `Baton objective/result policy ${kind}` | `RESULT_POLICY_CONSTRAINT_PREFIX` + `objectiveResultPolicy(effectiveResultIntent)` (application.mjs:112, :116-119) | a result intent is resolved (already shipped today, GT6) |
| `Work red-first: write the failing test first, then implement until green.` | the implement-contract preset's recorded red-first discipline (recipes.mjs:530) — a campaign workstyle law, not a machine read | the preset is an implement contract (see OQ5 for the honesty-rule interaction) |
| `HARD CONSTRAINT (wire_frame_oversize, issue #28): never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges.` | the receiving lane's provider-governance card `maxWireFrameBytes` (provider-governance.mjs:10, :108-111) + the `wire.frame` substrate row (limits.mjs:81) | the receiving lane's card carries a live `maxWireFrameBytes` — NEVER on a lane that doesn't carry it (GT8) |
| `Do NOT git commit — the orchestrator harvests your worktree.` | **NEVER** — the deployment reads the worker's commits (capture: `git rev-parse HEAD` + `changedPathsFromBase`, worktree.mjs:1232-1233; the pins `refs/baton/results`/`refs/baton/checkpoints`, index.mjs:837-838/:849-850) and the #141 norm mandates boundary commits (impl-114-brief.md:45) | NEVER printed when the deployment preserves worker commits — the line is false boilerplate (GT7) |
| `commit your worktree at NATURAL SUBSYSTEM BOUNDARIES — a checkpoint pin per boundary, so a drained wave never loses the work.` | the #141 boundary-commit law (impl-114-brief.md:45; redrive-continuity-contract.md:85-95) | the deployment preserves worker commits (the capture + pins live, GT7) |
| `Match existing code style; minimal diffs; no new application commands, registry entries, or MCP/CLI/web surfaces.` | (a) the deployment's surface-audit enforcement for the "no new surfaces" clause (the registry/command-surface authorities, application.mjs:224, :12406, :12481); (b) a campaign style norm for the "code style / minimal diffs" clause | the surface-audit enforces the "no new surfaces" clause (the "never a bound the deployment doesn't enforce" law); the style clause is workstyle — see OQ5's class split |
| `SCRATCHPAD_WRITE is printed TEXT, never a tool; entries are EXACTLY note{text} \| plan{objective,steps[{text,state}],supersedes} \| doubt{question,context} \| link{label,relation,target} (+ expectedFence:"current", unique idempotencyKey).` | the scratchpad write admission — the closed entry shape that refuses `scratchpad_entry_invalid` | always (machine-enforced) |

The generation rule's three "never" consequences, pinned:
- **Never `Do NOT git commit`** where the worker's own snapshot/boundary commits exist (GT7) — the
  false line is replaced by the #141 boundary-commit line, never printed alongside it.
- **Never a wire_frame constraint on a lane that doesn't carry it** (GT8) — the line is absent
  when the receiving lane's provider-governance card has no `maxWireFrameBytes`.
- **Never a bound the deployment doesn't enforce** — a bound line whose enforcement read is absent
  is not printed.

The block must fit the frame budget: ≤ `MAX_CONSTRAINTS` lines (8), each ≤
`CONSTRAINT_MAX_BYTES` (240B), rendered objective ≤ `RENDERED_OBJECTIVE_MAX_BYTES` (4096)
(GT9). The per-line table's lines are all short; the generated block is budget-checked at compose
time the same way the recipe admission checks the preset (recipes.mjs:191-208).

### D5 — The honesty rule: underivable → not printed; compose-fail only for required-but-underivable

A constraint line that cannot be derived from a live policy read at compose time is NOT printed —
silent omission is the default. Boilerplate a worker learns to discount is worse than none (the
`Do NOT git commit` line is the standing counterexample: the worker that discounts it discounts
the whole block, including the enforced lines). The compose refuses closed —
`objective_constraint_underivable` — ONLY when a DEPLOYMENT-PINNED line (a profile or
result-policy line that the deployment's own profile requires, GT6) cannot be resolved; workstyle
coaching lines are never required and their absence is always silent.

---

## Refusal vocabulary

The hub composes the verdict structure and the generated constraint block (the worker never
requests either); refusals fire on the serving paths when composition cannot proceed lawfully.
Codes follow the registry's snake_case family (`recovery_refinement_conflict`,
`spill_body_exceeded`, `wire_frame_bound_unavailable`).

These codes ARE the observability surface: they are what the operator sees when a verdict or a
constraint line cannot be composed lawfully, and — like every other refusal on the serving paths —
they ride the existing diagnostic surfaces (`run.debug`'s failure leg, the run record) rather than
opening a new seam. The worker's observability is the closed verdict structure itself (D1): a
worker that reads `{gate, checked, detail, corrective}` observes exactly the gate, the check, the
sanitized evidence class, and the corrective class — nothing more, nothing raw.

**Verdict structure (D1/D3):**
- **`verdict_corrective_unmapped`** — a live gate code has no corrective class in the closed
  table; the verdict refuses to fabricate corrective prose. The corrective class is a closed enum,
  never model-authored and never a guessed action.
- **`verdict_checked_unmapped`** — a live gate code has no checked name in the closed table; the
  verdict projects `checked: null` (the honest fallback), never a guessed check name.
- **`verdict_evidence_unsanitized`** — a detail leaf would carry raw paths/tails outside
  `sanitizeVerifierDiagnosticText` (verifier-diagnostics.mjs:26); the projection refuses. The
  sanitizer is reused verbatim — never a parallel redaction path (GT1, the verifier-diagnostics
  law).

**Objective generation (D4/D5):**
- **`objective_constraint_underivable`** — a deployment-pinned constraint line cannot be derived
  from a live policy read at compose time; the brief compose refuses closed rather than printing a
  guessed line (D5).
- **`objective_no_commit_conflict`** — a `Do NOT git commit` line is refused when the deployment
  preserves worker commits (GT7); the #141 boundary-commit line replaces it (D4).
- **`objective_wire_frame_unavailable`** — the wire_frame line's live read (the receiving lane's
  provider-governance card `maxWireFrameBytes`) is absent; the line is refused (never printed) —
  never a wire_frame constraint on a lane that doesn't carry it (GT8).
- **`objective_unenforced_bound`** — a bound line whose enforcement read is absent is refused
  (never printed) — the "never a bound the deployment doesn't enforce" law (D4).

---

## Red-first acceptance

Each pin is RED today — the behavior is absent from this tree — and the implementation makes it
GREEN. The red suite is a new `impl/test/issue61-verdict-surface-red.test.mjs`, mirroring the
`issue62-write-failure-red.test.mjs` harness shape (the sibling red-first norm).

- **R1** — A `worker_path_scope_violation` refusal reaches ONLY the judged worker's next-turn
  block as the #61 structure: `{gate: 'scope', checked: <the path_scope check name>, detail:
  {digests, counts}, corrective: 'restrict_diff_to_path_scope'}` — `detail` carries digests+counts
  and NEVER a path string. RED: no checked/corrective fields exist in the DG-1 projection
  (application.mjs:993-1014), and the verdict reaches no worker context (the #79 lane is absent).
- **R2** — A `required_effect_absent` refusal reaches the judged worker with `gate:
  'required_effect'` (never `'unknown'`) and the closed `{baseSha, sha, digests, counts}` evidence
  shape — the TG4 fix. RED: `DEBUG_GATE_CODES` has no `required_effect` member
  (application.mjs:945-947) and `debugGateFromLiveCode` maps `required_effect_absent` to `'unknown'`
  (application.mjs:956).
- **R3** — The verdict's `checked` and `corrective` fields are closed, hub-computed (the D1 static
  tables), never model-authored prose and never the event's raw message/tail. RED: no such fields
  exist anywhere in the projection.
- **R4** — The verdict is hub-minted: derived from the worker-scoped durable event via
  `debugGateRefusal` and delivered with the `wrapHubDerived.provenance === 'hub-derived'`
  discriminator (the #73 law); a caller-authored `{gate, detail}` on `run.feedback` NEVER reaches a
  worker's verdict. RED: the only hub-minted worker lane (#79) is absent in this tree.
- **R5** — The verdict's `detail` reuses `sanitizeVerifierDiagnosticText` VERBATIM
  (verifier-diagnostics.mjs:26) — no parallel redaction path; a planted secret-shaped line never
  appears in the worker-facing verdict. RED: no worker-facing verdict exists to test, but the
  reuse law is asserted so the #61 fold cannot introduce a second sanitizer.
- **R6** — At compose time, the `Do NOT git commit` line is NEVER printed when the deployment
  preserves worker commits (GT7: the capture resolves `HEAD`/`changedPathsFromBase`; the pins
  `refs/baton/results`/`refs/baton/checkpoints`); the #141 boundary-commit line is printed instead.
  RED: `IMPLEMENT_CONSTRAINTS` (recipes.mjs:532) ships `Do NOT git commit` verbatim today.
- **R7** — The wire_frame line is printed IFF the receiving lane's provider-governance card carries
  a live `maxWireFrameBytes` (provider-governance.mjs:10, :108-111); on a lane without it the line
  is absent. RED: `IMPLEMENT_CONSTRAINTS` (recipes.mjs:531) ships it unconditionally.
- **R8** — Every printed constraint line names its live-policy source (the D4 per-line table); a
  line with no derivable source is not printed (the honesty rule, D5). RED: the static preset
  (recipes.mjs:529-537) carries no per-line provenance.
- **R9** — A bound the deployment does not enforce is never printed; the generated block fits the
  frame budget (≤8 lines, ≤240B each, rendered objective ≤4096B). RED: generation is not
  budget-checked today and the preset's bounds are static.

---

## Open questions (adjudicated at the v1.0 DRAFT fold)

- **OQ1 — The `checked` field's vocabulary: static string vs closed code.** **ADJUDICATED.** `checked`
  is a static string from a closed per-gate table derived from GT5's mint evidence — not the
  `trustPhase` enum (the phase is the hub's internal vocabulary) and not the event's raw `message`
  (the message stays #79's static-or-sanitized field). A static string the worker can read as
  "what was checked" is the TG4 intent (trust-gate-steering-decisions.md:292-300).
- **OQ2 — Where `corrective` is computed.** **ADJUDICATED.** `corrective` rides the pushed verdict
  as a hub-computed field (D1). A worker-side gate→corrective mapping would duplicate the hub's
  table, diverge from the single source of truth, and run the exact multi-implementation risk the
  verbatim-sanitizer law bans for redaction — the hub is the only place corrective is composed.
- **OQ3 — The gate-enum member's serialization.** **ADJUDICATED.** The member serializes as
  `required_effect` (the gate class); the live code `required_effect_absent` maps to it. The DG-1b
  pin that an unrecognized code serializes `unknown` (diagnostics-decisions.md:78) stays for
  genuinely unmapped codes only — `required_effect` is a named gate, not an unrecognized one.
- **OQ4 — The #141 line's text.** **ADJUDICATED.** Verbatim from impl-114-brief.md:45. A
  normalized paraphrase risks the boilerplate-discount failure the honesty rule bans: the worker
  that has internalized the campaign law's exact words should recognize the line, and a rewritten
  version would read as new boilerplate.
- **OQ5 — Does the honesty rule govern the red-first line?** **OPEN.** `Work red-first` is a
  recorded campaign workstyle norm (recipes.mjs:530), not a machine-enforced read — under the
  strictest honesty-rule reading it has no live-policy source and would not print. The D4 table
  currently keeps it (its source is the implement-contract preset's recorded discipline). Whether
  it survives the strict honesty rule is a genuine fold decision for the #61 red-team pass; the
  table marks its source class explicitly so the fold can adjudicate it without re-deriving the
  evidence.
