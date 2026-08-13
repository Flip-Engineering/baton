# Issue #61 — the worker-visible gate verdict + objectives generated from live truth (v1.0 DRAFT)

The implementation contract for issue #61 (two AX clarity items): the worker-facing VERDICT
SURFACE (GLM P1-3) and objectives composed from LIVE TRUTH rather than static boilerplate (Opus
P0-2). It specifies behavior; it does not amend implementation in this artifact. It is a Ring-2
contract (ground truths → decisions → refusal/observability vocabulary → red-first acceptance →
open questions). It cross-references — it does not re-specify — #64 (TG4 verdict channeling), DG-1
(the `run.debug`/`run.feedback` gate-cause surface), #79 (the verdict push DELIVERY mechanics),
#73 (the forge-hardening — verdicts hub-minted), and #141 (the boundary-commit workstyle law).

Verification HEAD: `974ed580d5c12e7d0736c564a517c0faf99d2698` ("Baton private effective-tree
snapshot"), the tree this v1.0 draft was verified against. Date: 2026-08-12.

**v1.0 draft note.** This is a first-pass DRAFT, not a fold: it has not yet been red-teamed.
The two decisions are pinned so a red-team can attack the seams, not the shape. Issue body
availability: `gh` is not authenticated in this worktree (the same constraint the #73 and #59
contracts record), so the issue requirements are carried by the brief
(`contract-61-brief.md`), the two AX receipts (`reviews/ax-report-2026-07-31/ax-glm.md` P1-3 and
`ax-opus.md` P0-2), and the sibling contracts. The read-order the brief mandates was executed in
full: (1) the issue (unavailable — requirements carried by the brief + AX receipts); (2) the
sibling lanes that must compose, not duplicate — the #79 worker-delivery-push contract v1.1 (the
sanitized `{gate, detail}` push; the DELIVERY half), #73 (verdicts hub-minted), and DG-1
(`run.debug`/`run.feedback` — the operator/revision-channel side); (3) the boilerplate problem —
the objective composition in `impl/src/adapter.mjs` (the dispatch/constraints rendering), the
receipts/state that contradict it (the worker's own snapshot commits, worktree.mjs:1225; the #141
boundary-commit norm), and the IMPLEMENT_CONSTRAINTS precedent (`recipes.mjs:529-538`).

**Deployment verification run.** The dispatch-mandated command `npm test --prefix impl` was run on
the verification HEAD with only this file added to the tree. It exits **1** (not the expected 0):
3776 tests, 3565 pass, 211 fail. None of the 211 failures is attributable to this docs-only change —
the `collectSurfaceInventory()` pre-run gate (`impl/scripts/run-suite.mjs:35-43`,
`impl/scripts/surface-audit.mjs`) scans only `impl/src/*.mjs`, never `docs/`, and this file is not a
test. Of the 211: 202 are red-by-design failures in `*-red.test.mjs` suites (the intended
pre-implementation state for the sibling lanes — #73 tight-cell, #79 worker-delivery-push, and the
other RED suites); the remaining 9 are in four non-red, timing/lifecycle-sensitive integration files
(`phase8-correctness.test.mjs` ×5, `phase56-drain-and-close.test.mjs` ×2, `kimi-acp.test.mjs` ×1,
`issue5-cross-controller-lifecycle-recovery.test.mjs` ×1), all of which **pass in isolation**
(80/80, exit 0) — parallel-load flakiness, not regressions. This tree therefore does not satisfy the
"exit 0" acceptance pin; the exit-1 baseline is the deployment's pre-existing state and cannot be
moved by a docs-only contract. The prior session's "baseline exit 0" recording was inaccurate (its
own output shows a failing RED test); the exit 1 is the deterministic outcome of the tree as
committed.

Every `file:line` citation below was verified in this worktree with NUL-safe `grep -an` searches
and targeted `sed -n` reads. `impl/src/application.mjs` and `impl/src/coordination-store.mjs` are
NUL-bearing files (3 NUL bytes each — verified `tr -cd '\000' < file | wc -c`); their anchors are
grep/sed-verified, never whole-file reads. Sorted-key literals are quoted in their ACTUAL source
order (none are sorted claims); no `localeCompare` ordering is used anywhere in this contract.

Scope of the issue, in one sentence: **the judged worker sees WHICH gate, what it checked, and why
it failed, in a hub-minted, sanitized, closed-shape verdict it can act on — and the objective
boilerplate it receives names only the deployment's ACTUAL laws, never a constraint the deployment
does not enforce.**

---

## Ground truths (code-verified)

**GT1 — The sanitized verdict shape is a pure projection over durable events.** `debugGateRefusal`
(application.mjs:993-1015) projects the LATEST trust-gate/verifier refusal from the durable per-
worker log: source events are `error` with `payload.phase === 'trust_gate'` or `verify.reverified`
with `accept === false`; the projection picks `.at(-1)` (:999), maps the live code through
`debugGateFromLiveCode` (application.mjs:949-956), and derives the closed detail through
`debugGateDetail` (application.mjs:958-988). The shape is `{kind, code, message, gate, detail}`:
`gate` ∈ {scope, forbidden_effect, red_green, coverage, route_mismatch, unknown} (the live-code
map), `message` is `boundedAttentionText`-bounded (application.mjs:334; a `null` when the event
carries none), and `detail` is NEVER raw — scope carries `{digests, counts}` (digests :964-970,
counts :971-977), red_green/coverage carry `{tail: sanitizeVerifierDiagnosticText(raw).text}`
(:985; the sanitizer at verifier-diagnostics.mjs:26), everything else `{}`. The whole thing is
a pure function of the event log — two replays over the same events derive the same projection.

**GT2 — The projection is the shared source for both worker-facing verdict surfaces.**
(a) `run.debug`'s failure leg — `debug()` (application.mjs:11279-11298), authorized exactly like
`run.inspect` (`await this._authorize('run.inspect', principal, rawArgs.runId, {})`, :11284), builds
a per-worker member view via `_debugMember` (application.mjs:11300-11333) whose `failure` is
`debugGateRefusal(events)` when a gate refusal exists, else the crash event (:11321-11328). (b) The
#79 `gate_verdict` push — the worker-scoped projection
`debugGateRefusal(events.filter((event) => event.worker === workerId))`, keyed `gate:${event.seq}`
from the worker-scoped latest source event, framed `wrapHubDerived` inside the `[attention/untrusted]`
block (cross-ref #79 D6 and #64 TG4 verdict channeling; do not re-spec). Both surfaces read the SAME projection function — a
structural extension to `debugGateRefusal` propagates to both without a second redaction path.

**GT3 — Verdicts are hub-minted, never caller-authored (#73).** The forge-hardening contract
REFUSES a caller-authored `{gate, detail}` with no ledger referent
(`application_workflow_feedback_gate_unbound`) and validates-or-replaces when a referent exists —
the stored `feedback` is the DERIVED `{gate, detail}`, never the caller's bytes, with `derived:
true` and `gateEventSeq` bound to the source gate event. A caller-supplied `derived` key refuses
`application_workflow_feedback_invalid` (closed-schema rejection). The #79 push carries NO
`derived` — the `wrapHubDerived.provenance === 'hub-derived'` marker discriminates (cross-ref #73
D3/B6). The admission path is `sendWorkflowFeedback` (application.mjs:6717-6787) after
`normalizeWorkflowFeedback` (application.mjs:1645-1681) and `normalizeGateCauseFeedback`
(application.mjs:1594-1643).

**GT4 — The structural fields are derivable from the source event's own code/phase.** The trust-gate
refusal codes the live-code map already names are `worker_path_scope_violation` (→ scope,
coordinator.mjs:12978), `forbidden_effect_observed` (→ forbidden_effect, coordinator.mjs:12970),
`verification_red_green_failed` / `verification_coverage_failed` (→ red_green/coverage), and
`plan_route_mismatch` / `recovery_route_mismatch` (→ route_mismatch) — plus the
`required_effect_absent` refusal (coordinator.mjs:12999, `requiredEffectEvidence` minted at
:13000-13006) which the live-code map does NOT yet name (it falls through to `unknown` today).
The `_runTrustGate` phases are `capture`, `forbidden_effect`, `path_scope`, `required_effect`,
`evidence_mapping`, `terminal_batch`, `promotion`, `complete` (coordinator.mjs:12956, :12967,
:12976, :12995, :13153, :13207, :13228, :13236). Every refusal's `checked`/`failingClass`/
`correctiveClass` value is therefore a pure function of the source event's `code`/`phase`/
`trustPhase` — no new durable mint is required.

**GT5 — The HARD CONSTRAINT block is a static frozen literal, not live-derived.** The
`implementContract` preset spreads `[...IMPLEMENT_CONSTRAINTS]` verbatim into every member's
`objectiveTemplate.constraints` (recipes.mjs:550-557; the spread at :557). The literal is frozen
(recipes.mjs:529-538):
- `'Work red-first: write the failing test first, then implement until green.'` (:530)
- `'HARD CONSTRAINT (wire_frame_oversize, issue #28): never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges.'` (:531)
- `'Do NOT git commit — the orchestrator harvests your worktree.'` (:532)
- `'Match existing code style; minimal diffs; no new application commands, registry entries, or MCP/CLI/web surfaces.'` (:533)
- `'SCRATCHPAD_WRITE is printed TEXT, never a tool; entries are EXACTLY note{text} | plan{objective,steps[{text,state}],supersedes} | doubt{question,context} | link{label,relation,target} (+ expectedFence:"current", unique idempotencyKey).'` (:536)
The constraints render into the worker's objective via `renderObjective` (recipes.mjs:296-315,
join at :309) and into the brief's `## Constraints` block (adapter.mjs:129-131). They are identical
for every lane, every deployment, every route — the exact boilerplate Opus P0-2 calls out.

**GT6 — The dispatch blanket ban contradicts objectives that name explicit receipts.** The
dispatch guidance emitted by BOTH provider-facing renderers is the static sentence
"…do not inspect repository files, prior Run artifacts, receipts, or ledgers to reconstruct or
broaden it. Writing a named output path does not authorize reading its preexisting contents."
(adapter.mjs:107, :108; the same sentence in cli-adapters.mjs:93, :94). An objective that names
three receipts to cite (the ax-opus P0-2 case) is contradicted by its own brief: the more-specific
objective wins, but the worker has to adjudicate a contradiction the Brief should have resolved.

**GT7 — The deployment makes worker-worktree snapshot commits and enforces the #141 boundary-commit
law.** At trust-gate capture the orchestrator itself commits the worker's worktree:
`captureCommit` (worktree.mjs:1191-1240) stages and commits `baton snapshot: ${taskId}` with a
`Baton-Task` trailer when the tree is dirty (the git commit at worktree.mjs:1225). The #141
workstyle law is the campaign norm: commit at NATURAL SUBSYSTEM BOUNDARIES so a drained wave never
loses the work — the impl-114 loss (a deepseek seat drained 2.5h with zero commits; only the
boundary commits saved the code) is the recorded cost of the "no commits" boilerplate
(workflow-as-data-2026-08-06/impl-114-brief.md; redrive-continuity-contract.md GT1). The
"`Do NOT git commit`" line is therefore FALSE where the #141 norm is in force: the worker's own
snapshot/boundary commits exist and are the health of the deployment.

**GT8 — The wire-frame law is byte-measured, never line-counted, and lane-conditional.** The real
kill is a single tool-result frame over the configured byte ceiling (`wire_frame_oversize`, #28):
the substrate row is `'wire.frame': { lane: 'wire.frame', class: 'substrate', value: 1048576, unit:
'bytes', graceful: null }` (limits.mjs:81), and the deployment resolves the per-session ceiling via
`resolveSessionWireCeiling` (application-deployment.mjs:739-746; the governance `maxWireFrameBytes`
field validated at :724-733, bounded 64 KiB–16 MiB at :727-731). The "~1500 lines" proxy is the WRONG UNIT (ax-opus
P0-1) and is emitted unconditionally today even for lanes whose provider surface carries no such
ceiling (recipes.mjs:531).

---

## Decisions

### D1 — The worker-facing verdict surface: additive structural fields on the hub projection

**The verdict the judged worker receives gains a STRUCTURE it can act on, beyond the {gate, detail}
delivery #79 already performs.** #79 owns the delivery mechanics (the sanitized `{gate, detail}`
push to the judged worker's next-turn block). #61 owns the verdict's STRUCTURE: the fields the
worker needs to correct — WHICH gate, WHAT was checked, the FAILING evidence class, and the
CORRECTIVE class. The structure is an ADDITIVE extension of the shared hub projection
`debugGateRefusal` (GT1): the existing `{kind, code, message, gate, detail}` field VALUES are
unchanged; three new closed fields are appended as top-level siblings:

| field | value class | closed enum |
|-------|------------|-------------|
| `checked` | what the gate evaluated | `path_scope` \| `required_effect` \| `forbidden_effect` \| `verification` \| `route` \| `unknown` |
| `failingClass` | the failing evidence class | `out_of_scope_edit` \| `required_effect_absent` \| `forbidden_effect_observed` \| `verification_red_green_failed` \| `verification_coverage_failed` \| `route_mismatch` \| `unknown` |
| `correctiveClass` | the corrective class | `restrict_edits_to_scope` \| `produce_required_edit` \| `align_to_approved_effects` \| `fix_verification_failure` \| `align_route_to_plan` \| `read_failure_evidence` \| `unknown` |

**Derivation is a pure function of the source event** (GT4), mapped through the LIVE code set — never
a parallel table, never caller-authored:

| source code / phase | `checked` | `failingClass` | `correctiveClass` |
|--------------------|-----------|----------------|-------------------|
| `worker_path_scope_violation` (phase `path_scope`) | `path_scope` | `out_of_scope_edit` | `restrict_edits_to_scope` |
| `required_effect_absent` (phase `required_effect`) | `required_effect` | `required_effect_absent` | `produce_required_edit` |
| `forbidden_effect_observed` (phase `forbidden_effect`) | `forbidden_effect` | `forbidden_effect_observed` | `align_to_approved_effects` |
| `verification_red_green_failed` (referee/accept phase) | `verification` | `verification_red_green_failed` | `fix_verification_failure` |
| `verification_coverage_failed` (referee/accept phase) | `verification` | `verification_coverage_failed` | `fix_verification_failure` |
| `plan_route_mismatch` \| `recovery_route_mismatch` | `route` | `route_mismatch` | `align_route_to_plan` |
| anything else (`unknown` gate fallback) | `unknown` | `unknown` | `read_failure_evidence` |

**The `required_effect_absent` row is a two-sided live-code amendment, not a new mint.**
`debugGateFromLiveCode` (application.mjs:949-956) does not yet map `required_effect_absent` (it
falls through to `unknown` today, GT4), and `debugGateDetail` (:958-988) has no `required_effect`
branch — a `required_effect` gate falls to `{}` at :988. The amendment is therefore two-sided: the
live-code map gains the `required_effect_absent` → `required_effect` row, AND `debugGateDetail`
gains a `required_effect` branch that mints the closed digests+counts SUBSET from the mint's own
evidence (`requiredEffectEvidence`, coordinator.mjs:13000-13006): `{digests: {changedPathsDigest,
inScopeChangedPathsDigest}, counts: {changedPathCount, inScopeChangedPathCount}}`. The evidence is
already digest/count form — no path string, no SHA, no tail enters the detail (the out-of-scope
keys are ABSENT by construction: a required-effect refusal is defined by the ABSENT in-scope edit,
not by an out-of-scope set). The live-code map stays the single code→gate source; the shape stays
the closed digests+counts law.

**The structural fields are sibling fields, never inside `detail`.** `detail` is pinned closed by
DG-1/#79 (scope → `{digests, counts}`; required_effect → the `{digests, counts}` subset, D1;
red_green/coverage → `{tail}` sanitized). The three new
fields ride at the top level of the projection, so the existing `detail` bytes are untouched. The
sanitization law is unchanged: the new fields are closed-enum strings by construction — no path
string, no tail, no secret can enter them; the verifier-diagnostics law applies to prose
(`message`, `detail.tail`) exactly as today.

**#73 constancy amendment (explicit).** #73's GREEN-5 pins the #79 `gate_verdict` push wire bytes
unchanged and "the item carries no `derived`". This contract amends that pin additively: the push
item gains the three structural fields as top-level siblings; `kind`, `code`, `message`, `gate`,
`detail`, the `gate:${event.seq}` idempotency key, and the `wrapHubDerived.provenance` marker are
byte-stable. The `derived`-absent ruling stands — the worker discriminates hub-derived from
authored coaching by the provenance wrapper, never by a `derived` field.

**The corrective class is contract, never coaching (TG6).** The `correctiveClass` names the class
of the gate's own demand (restrict edits to scope; produce the required edit; align to the approved
effects; make the deliverable pass the verifier). It is derived from the closed code, not a prose
suggestion, and never references gate mechanics, window timings, or steering — the TG6 source-scan
(forbidden "beating the gate" coaching) covers it as shipped text.

**Honesty rule for the structure:** every value is derived or the honest `unknown` fallback. A
source code the map does not recognize yields `checked: 'unknown'`, `failingClass: 'unknown'`,
`correctiveClass: 'read_failure_evidence'` — never a fabricated class. `read_failure_evidence` is
the fallback corrective: it tells the worker to read the failure evidence (the digests+counts /
sanitized tail) the push already carries — the honest instruction when the class is unknown.

### D2 — Objectives generated from live truth at compose time

**The HARD CONSTRAINT block and the dispatch guidance are generated from the deployment's ACTUAL
laws at compose time — never a frozen literal spread into every lane (GT5).** The `implementContract`
preset's constraint set is replaced by a composer that reads live policy for the specific
deployment, route, and objective. Two rules pin the behavior:

**The generation rule — each constraint line derives from a live policy read, and the source is
named per line:**

| constraint line (category) | live policy source | emitted when | phrased as |
|---------------------------|--------------------|--------------|------------|
| red-first | the lane's contract rung pins red-first acceptance (the campaign norm) | the lane is red-first | the existing red-first line |
| wire frame | the lane's configured wire-frame byte ceiling — `'wire.frame'` substrate row (limits.mjs:81) and the deployment `resolveSessionWireCeiling` value (application-deployment.mjs:739-746) | the lane's provider surface carries a wire-frame ceiling | "no single tool-result frame over N bytes" (N = the live ceiling), NEVER the ~1500-line proxy |
| commit | the deployment's commit/harvest policy + the #141 boundary-commit law (GT7) | the #141 norm is in force and the worker's worktree receives snapshot commits | the boundary-commit law (commit at natural subsystem boundaries), NEVER "Do NOT git commit" |
| style / minimal-diff | the repo's contribution norms (a live-readable source, e.g. the project's CONTRIBUTING/CLAUDE.md) | the source resolves | the existing style line |
| scratchpad | the live scratchpad entry kinds (the four closed kinds) | the lane carries a scratchpad | the existing scratchpad line |
| in-scope-reading whitelist (Opus P0-2) | the objective's own named paths + the brief's `pathScope` | the objective names explicit paths to read/cite | the dispatch text carries "These paths are authorized inputs: …" instead of the blanket ban |

**The commit line is the #141 flip.** Where the deployment harvests worktrees and the worker's own
snapshot/boundary commits exist (GT7), the constraint is the boundary-commit law — the norm that
saved the impl-114 work. The "`Do NOT git commit`" line is emitted ONLY when a lane's policy
genuinely forbids worker commits (a lane with no harvest, no snapshot, no re-drive) — and that
policy, like every line, must be a live read, never a default.

**The in-scope-reading whitelist resolves the Opus P0-2 contradiction at the seam.** When the
objective names explicit paths (the ax-opus P0-2 case: "cite these three receipts"), the dispatch
guidance (adapter.mjs:107-108; cli-adapters.mjs:93-94) emits a named-path whitelist — "These paths
are authorized inputs: …" — in place of the blanket "do not inspect repository files, prior Run
artifacts, receipts, or ledgers" ban. The worker never adjudicates a contradiction between its
objective and its brief. When the objective names NO paths, the blanket default stays (the honest
default for a context-free objective — no whitelist to mint).

**The honesty rule — a constraint that cannot be derived from a live policy read is NOT printed.**
Boilerplate a worker learns to discount is worse than none (the brief's own ruling). A category
whose live source does not resolve emits nothing: a lane without a wire-frame ceiling gets no wire
line; a lane whose commit policy is unobservable gets no commit line; a style line with no readable
contribution norm is dropped. The drop is never silent — it is an observability event (below).

**Compose-time seam.** The composer replaces the static spread `[...IMPLEMENT_CONSTRAINTS]`
(recipes.mjs:557) — the constraints are composed at objective-mint time, once, per
deployment+route+objective, and flow through the existing `renderObjective` (recipes.mjs:296-315)
and `## Constraints` (adapter.mjs:129-131) seams unchanged. The compose-time value is frozen into
the rendered objective/manifest exactly as today's literal is — the difference is WHAT gets
frozen: the deployment's laws, not a copy of a template.

---

## Refusal / observability vocabulary

**D1 refusals** (fire on the admission/read path when the structure cannot be derived lawfully):

- **`verdict_surface_enum_unmapped`** — a source event's code maps to no closed enum member and
  the honest `unknown` fallback is not taken (an implementation that fabricates a class, or a
  mapping table that diverges from the LIVE code set). The healthy path is the `unknown` fallback
  (D1 honesty rule); this code is the RED guard against a parallel table.
- **`application_workflow_feedback_invalid`** — reused verbatim from #73: a caller-supplied
  `checked`/`failingClass`/`correctiveClass` on `run.feedback` (the fields are outside the
  gate-cause closed schema `['gate', 'detail']`, application.mjs:1597) refuses at the closed-schema
  check (cross-ref #73 D2; do not re-spec). Provenance is hub-set only.

**D2 refusals + observability** (fire on the compose path):

- **`objective_constraint_underivable`** — a caller EXPLICITLY requires a constraint line and no
  live policy source resolves. A hard refusal, never a silent default: the composer refuses to
  mint the objective rather than print an unverified line.
- **`constraint.derivation`** — the composer's observability event, recorded per category: the
  resolved source and the emitted line, or the category + the missing source when the honesty rule
  drops the line. The drops are visible to the operator and the orchestrator, never silent.

**Surface constancy:** the three structural fields are the ONLY additions to the verdict shape; the
`run.debug` failure leg and #79 push keep their existing field bytes, keys, and provenance wrappers
(D1). The refusal codes `application_*` pass through the MCP/web facades unchanged
(`mcp-northbound.mjs:206` `application_*` passthrough; `web-northbound.mjs:201-204` fallthrough —
cross-ref #73 D4).

---

## Red-first acceptance

Each pin is RED today — the behavior is absent from this tree — and the implementation makes it
GREEN. The red suite is a new `impl/test/issue61-verdict-surface-red.test.mjs`, mirroring the
`issue62-write-failure-red.test.mjs` / `issue79-delivery-push-red.test.mjs` harness shape.

**D1 pins:**

- **R-D1-1** — A scope refusal (a real `error` with `payload.phase === 'trust_gate'` and
  `code === 'worker_path_scope_violation'` on the worker's stream) yields a verdict whose
  structural fields are `checked: 'path_scope'`, `failingClass: 'out_of_scope_edit'`,
  `correctiveClass: 'restrict_edits_to_scope'` — on BOTH `run.debug`'s failure leg and the #79
  push to THAT worker. RED: no structural fields exist anywhere today.
- **R-D1-2** — A `required_effect_absent` refusal yields `checked: 'required_effect'`,
  `failingClass: 'required_effect_absent'`, `correctiveClass: 'produce_required_edit'`, and a
  closed `{digests, counts}` `detail` subset minted from `requiredEffectEvidence` (the two-sided
  amendment, D1). RED: `required_effect_absent` maps to `unknown` and the detail is `{}` today.
- **R-D1-3** — A red_green/coverage refusal yields `checked: 'verification'`, the matching
  `failingClass`, `correctiveClass: 'fix_verification_failure'`; the `detail.tail` is still
  `sanitizeVerifierDiagnosticText` output, never the raw capsule.
- **R-D1-4** — The structural fields are hub-derived: a caller submits `{gate: 'scope', detail:
  {...}, checked: 'path_scope'}` through `run.feedback` → `application_workflow_feedback_invalid`
  (closed-schema rejection; the fields are outside the gate-cause schema). A caller can never
  author the structure.
- **R-D1-5** — The #79 push wire constancy amendment: the push item's `kind`/`code`/`message`/
  `gate`/`detail` field VALUES, the `gate:${event.seq}` key, and the `wrapHubDerived` provenance
  marker are byte-stable; the item gains ONLY the three structural fields.
- **R-D1-6** — The honesty fallback: a gate code the map does not recognize yields
  `checked: 'unknown'`, `failingClass: 'unknown'`, `correctiveClass: 'read_failure_evidence'` —
  never a fabricated class; the fallback corrective points at the failure evidence, not a strategy.

**D2 pins:**

- **R-D2-1** — The `implementContract` recipe's constraint set is no longer the frozen
  `IMPLEMENT_CONSTRAINTS` literal spread verbatim (recipes.mjs:557): each line is composed from a
  live policy read. RED: the literal is spread unchanged today.
- **R-D2-2** — A deployment with the #141 boundary-commit law in force and snapshot commits
  present yields the boundary-commit constraint, NEVER "Do NOT git commit". RED: "Do NOT git
  commit" is shipped unconditionally today (recipes.mjs:532).
- **R-D2-3** — A lane with a wire-frame ceiling yields a byte-named frame constraint ("no single
  tool-result frame over N bytes", N = the live ceiling), never the "~1500 lines" proxy. RED: the
  line proxy is shipped unconditionally today (recipes.mjs:531).
- **R-D2-4** — A lane with no wire-frame ceiling gets NO wire-frame constraint line. RED: the line
  is unconditional today.
- **R-D2-5** — When the objective names explicit paths to read/cite, the dispatch guidance carries
  "These paths are authorized inputs: …" instead of the blanket ban; when the objective names no
  paths, the blanket default stays. RED: the blanket ban is unconditional today (adapter.mjs:107-108;
  cli-adapters.mjs:93-94).
- **R-D2-6** — The honesty rule: a constraint category whose live policy source does not resolve
  emits NO line and records a `constraint.derivation` observability event naming the missing source.
  A caller-explicit required line with no source refuses `objective_constraint_underivable`. RED:
  every line is printed unconditionally today, with no derivation record.
- **R-D2-7** — The compose-time value is frozen into the rendered objective/manifest exactly as
  today's literal is — the objective still passes `renderObjective`'s byte ceiling (recipes.mjs:309)
  and the `## Constraints` render seam (adapter.mjs:129-131) is unchanged.

---

## Open questions

- **OQ1 — where the structural fields ride in the push.** D1 pins the fields as top-level siblings
  of `{kind, code, message, gate, detail}` on the shared projection, and amends #73's GREEN-5
  additively (the push gains the fields; existing bytes stable). The red-team should attack whether
  the amendment is the honest read of the constancy pin, or whether the structure should instead be
  read-side-only (`run.debug`) with the push carrying a digest citation. The brief's "delivered
  through the #79 push lane" is read here as the fields riding the push — a read-side-only reading
  would leave the worker's next-turn context without the corrective class, defeating the issue.
- **OQ2 — the `correctiveClass` enum's coaching boundary.** The five corrective values name the
  class of the gate's demand. The red-team should verify each against the TG6 source-scan (no
  "beating the gate" coaching) and whether any value reads as a strategy suggestion rather than a
  contract naming.
- **OQ3 — the whitelist's phrasing and surface.** D2 pins the whitelist as "These paths are
  authorized inputs: …" replacing the blanket ban when the objective names paths. Whether the
  whitelist should ALSO list the named output paths (for the "writing a named output path does not
  authorize reading" clause) is deferred to the red-team.
- **OQ4 — the `unknown` corrective.** `read_failure_evidence` names the fallback. Whether a richer
  honest fallback is warranted (e.g. deriving from the terminal-cause narrative,
  `projectTypedTerminalCause`, application-semantics.mjs:2134) is deferred — the D1 pin is that the
  fallback is honest, never fabricated.
