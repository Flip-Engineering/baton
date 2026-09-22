# Baton laws design notes — the home of everything not in the minimal prohibition set

Provenance: work-bend2-laws, pillar 3 of issue #539. Created on the orchestrator's instruction
(2026-09-22) when the operator confirmed that `laws.bend` is a minimal contract of inviolables:
a row that is Policy, Implementation, or the non-inviolable part of a Split is still real design
material — it lives here rather than in `laws.bend`, with its reasons, its traces and the
reviewer's classes intact. Nothing was discarded in the reduction; this document is where the
demoted material went.

Contents, carried from revision 4 (the consolidated register, landed as `a1e2b240`):

- **Part B — Split rows (46)**: the retained guarantee and the mechanism or policy that must not
  be frozen, per row, with traces.
- **Part C — Policy rows (29)**: the decision the operator owes, with justification material.
  The owner of the policy decisions' absorption is `docs/bend2/rewrite-plan.md`
  (bend2-plan-lead).
- **Part D — Implementation rows (20)**: the behavior Baton2 must preserve and the mechanism it
  is free to choose. The owner of the architecture absorption is
  `docs/bend2/target-architecture.md` (bend2-arch-lead).
- **Part E — Retired (1)**: WAKE-5, with the #541 precision and the retained guarantee.
- **Part F — Evidence tasks (4)**: work items, not laws.
- **The six CX contract families' full propositions** (from the independent proposals, as
  carried in revision 4's Part A headers): they remain the proof-obligation templates for
  whichever minimal-set entries absorb them — CX-1 feeds the receipt/intent entry, CX-2 the
  uncertainty entry, CX-3 the publication-evidence entry, CX-4 the interface-agreement question,
  CX-5 the history-preservation entry, CX-6 the continuation question.
- **The development-governance requirement** (a proof gate must not weaken an approved law) is
  recorded as owed design work for `docs/bend2/rewrite-plan.md`.

The extraction base for every trace is `bc2e4fcd`; all anchors were verified. The class marks
(38 Candidate, 46 Split, 29 Policy, 20 Implementation, 1 Retire, 4 Evidence task) are Codex's
first-pass assessment from the independent review. The prohibition set that superseded this
register's law labels lives in `laws-proposed.md` revision 5; the per-row disposition map at its
end names, for each of the 138 rows, which entry absorbed it or where it was demoted.

---
# Baton's laws proposed for the operator's approval — revision 4 (consolidated)

Provenance: work-bend2-laws, pillar 3 of issue #539. Revision 4 consolidates the candidate
register after independent review by the operator's reviewer (Codex, outside this swarm; reports
of 2026-09-21: context-and-review, law-suitability, own-law-proposals). It supersedes revisions 1
to 3 (revision 3 landed as `23d3b857`). What changed and why:

- **Definition corrected.** A Bend law is a quantified behavioral theorem over the actual
  implementation, checked through the dependent type system. It need not make a malformed value
  unconstructible, and a deliberate product policy may be made a law when the operator chooses
  that permanent commitment. Revision 3's narrower test — and its 99 `law` labels — are
  withdrawn.
- **Carriers corrected against compiled probes.** Codex's probe set is eight mechanisms: five
  findings of an insufficient carrier and three controls that behaved as expected (a duplicate
  affine use correctly rejected, a deliberately broken history-equality check correctly rejected,
  and the corresponding correct appending implementation correctly accepted — the controls
  validate the probe method; they are not additional disproofs). The five findings: an exported
  affine constructor is forgeable from an importing module; an affine value can be dropped
  without its release path, so affinity gives at-most-once use and not mandatory cleanup; a pure
  fold with a fixed-shape result does not prove history is preserved; a receipt-shaped return
  does not establish durable write before acknowledgment; a common return type does not force one
  shared predicate. Every carrier below is corrected accordingly or cited as a named
  prerequisite.
- **Two scope limits on those findings, carried forward.** (1) The probes tested the ordinary,
  naive affine encoding only. They do not exclude a proof-indexed or other more sophisticated
  encoding establishing the same guarantee: "insufficient as currently encoded" is not
  "impossible in Bend2". (2) The history-preservation check Codex ran is a concrete worked
  instance — one input, one broken and one correct implementation — not yet the universal
  quantified theorem the actual law needs; writing that theorem is open work for the owning lane.
- **WAKE-5 retired.** As a target rule it conflicts with the landed no-cutoff ruling (#541): a
  slow reader is served the remaining recorded history from its cursor, so no recorded event is
  lost to a slow reader. The row's extraction (the code really drops; a test pins it) remains
  accurate as history; its status as a proposed law is withdrawn.
- **Restructured so the operator reads guarantees, not mechanisms**: Candidate guarantees first
  (grouped under the six proposed contract families plus two supplementary groups the review's
  strongest-themes list names), then Split rows with their retained guarantee and the mechanism
  that must not be frozen, then Policy and Implementation rows marked not-law-candidates with
  reasons, then the retired row and the four evidence tasks.

## Classes and counts (Codex first-pass assessment; not an approval tally)

| Class | Meaning | Rows |
|---|---|---|
| Candidate | the underlying guarantee appears suitable for a durable contract | 38 |
| Split | combines a useful guarantee with policy, mechanism, or missing scope; components assessed separately | 46 |
| Policy | a product, deployment or development choice needing independent justification before being made inviolable | 29 |
| Implementation | a representation, algorithm, storage or code-organization choice | 20 |
| Retire | conflicts with a later explicit operator ruling | 1 |
| Evidence task | missing tests or validation work; the rule those tests support is assessed separately | 4 |

A policy can still be chosen as a permanent law by the operator — the upstream game example makes
losing impossible on purpose — and a behavioral contract can be proved as a quantified theorem
even where an ordinary data type permits irrelevant malformed values. Class marks here address
the justification supplied, not approval.

## The admission test (applied per row; from the suitability report)

1. What user-visible or authority-preserving guarantee does the rule establish, and which
   concrete failure does it prevent?
2. Why should it remain true across valid changes to storage, protocols, scheduling, provider
   adapters and deployment topology?
3. Does it state only the necessary restriction? A useful alternative design that violates the
   wording while meeting the guarantee proves the wording too restrictive.
4. Are scope, premises and authorized exceptional transitions explicit (cancellation, recovery,
   operator-directed changes)?
5. Can it be satisfied trivially while the intended guarantee fails (never landing anything,
   refusing all work)?
6. Is it consistent with the other accepted contracts and later operator rulings?
7. Can the approved guarantee be connected to the implementation, proof command and external
   effect assumptions without silently weakening it?

## What each Candidate row carries (the reviewer's seven requirements)

1. The plain behavioral requirement and the violating example it rules out.
2. Why it deserves to be inviolable, the useful alternatives it permits, and its status
   (currently enforced, superseded, or proposed).
3. The exact Bend type or proposition, with premises, identities and versions explicit. All
   propositions in this revision are sketches: they are written to be checked against the
   Baton2 functions when those exist, and none is checked today.
4. The function or transition it applies to, and the checked proof or construction that will
   enforce it.
5. The passing example and the violating implementation the checker must reject, including the
   challenge to vacuous implementations (refusing everything, deleting history, constant
   success).
6. External assumptions: authentication, host effects, storage, process lifetime, clocks,
   restart — as relevant.
7. The source and test trace, and what the law lets Baton2 simplify.

## Carrier honesty, and the provenance/codomain labeling (applies to every row below)

The disproved patterns: an exported affine record is forgeable — an importing module constructed
a `Lease{999}` directly and passed it to release (probe forge-lease); an affine value can be
dropped without its release path, so affinity is at-most-once use and not mandatory cleanup
(probes drop-lease, duplicate-lease); a pure fold with a fixed-shape result does not prove
history preservation (probe erase-history, with the positive and negative equality controls); a
receipt-shaped return does not establish durable write before acknowledgment (probe
delayed-receipt); a shared return type does not force one shared predicate (probe
second-predicate).

The audit lanes' labeling, adopted here: the probes refute **provenance** claims — a value's
origin cannot be established by naming a type — and do not refute **codomain** claims — a
function can only return values of its declared result type, so a closed variant with no such
arm genuinely bounds what the function returns. Every carrier below is labeled `provenance`,
`codomain`, or `theorem` (a quantified proposition over the Baton2 transition functions). Where
a provenance claim survives at all, its honest form at this pin is: (i) a **named language
prerequisite** — a Base-level opaque or proof-indexed type, since WONTFIX reserves new opaque
handle types to Base; (ii) a **proof-carrying construction** demonstrated and tested; or (iii)
reclassification of the row's content as a theorem about agreement or identity rather than about
origin. No row relies on an exported affine record.

Boundary decoders remain necessary: closed enums and exact records govern values inside the
system, while external agents, network frames and old journal bytes still supply malformed data,
so boundary decoding validates and returns the structured refusal. Dependent-proof candidates
(PM-08 subset witness, PM-10 inequality, CL-08 accepted-state index, CL-14 determinism equality)
are proof-carrying candidates, not unavailable.

Input provenance for this revision: the suitability classes and the seven requirements are
Codex's; the ledger-domain decomposition (48 keep/stop-freezing pairs, 15 carrier
confirmations/corrections, the WAKE-5 precision, and six stated disagreements) is
bend2-laws-ledger's; the validator-domain decomposition (carrier confirmations, corrections and
scope notes, and the split/policy/implementation pairs) is bend2-laws-validators'. Stated
disagreements are recorded in the entries, not silently resolved.

Extraction base: `bc2e4fcd` (impl frozen for this issue). Design snapshot: `bend2-rewrite` at
`23d3b857`. All traces were anchor-verified at the extraction base; the verification record is
unchanged since revision 1.

---

## Part A — Candidate guarantees (38 rows)

Grouped under the six proposed contract families (CX-1 to CX-6, from the independent proposals)
plus two supplementary groups the review's strongest-themes list names: workspace preservation
with custody (G-7), and truthful authority with provenance (G-8). CX-2 has no first-pass
Candidate rows; its guarantee is carried by Split rows CAP-6 and CL-14 and by the family text
itself.

### CX-1 — An acknowledgment refers to recoverable work (2 candidates)

**LEDG-3 · Candidate.**
1. Guarantee: a retry under the same operation identity preserves and returns the original
   disposition and does not duplicate the effect. Ruled out: a retried submission appending a
   second event, or a retry answering something other than the first admitted outcome.
2. Inviolable because callers cannot distinguish a retry from a first submission; permits any
   storage that keeps one disposition per identity; status: enforced today (keyed replay),
   carrier corrected by the probes.
3. Proposition (sketch): for admitted row `r = admit(key, payload)` and any later
   `admit(key, payload2)`, the result is `Replayed{r}` and the log contains exactly one row for
   `key`; a duplicate key found at replay is a decode-time refusal, not a second row. Codomain
   claim on the store; at-most-one-per-key alone is insufficient (finding 7) without the
   preservation proposition.
4. Applies to: the ledger append/replay pair in Baton2's journal; proof: non-overwriting
   insertion plus the equality of the returned row to the first admitted row, checked over the
   journal functions.
5. Pass: a retry returns the original event; violate: an implementation returning a fresh row or
   overwriting; vacuity challenge: a store admitting nothing satisfies uniqueness — admission is
   CX-6's obligation.
6. External: durable storage semantics; crash windows belong to CX-1/CX-2 family text.
7. Trace: `impl/src/coordination-ledger.mjs:1192-1199`;
   `impl/src/coordination-replay.mjs:525-527`; tests
   `impl/test/phase11-coordination-store.test.mjs:36`, `:204`. Simplifies: idempotency
   bookkeeping repeated in each caller.

**CAP-14 · Candidate.**
1. Guarantee: a stale reservation token never releases a newer reservation that reused the same
   resource identifier. Ruled out: an old cancellation removing a live reservation.
2. Inviolable because substrates recycle identifiers; permits any reservation substrate binding
   dispositions to exact instances; status: enforced today.
3. Proposition (sketch): `release(tok, reservation)` changes `reservation` only when
   `tok.identity == reservation.identity` at release time — an equality theorem at the release
   function; the naive affine unforgeability claim is withdrawn (forge-lease probe), corrected
   upward by the ledger lane to a checked identity equality.
4. Applies to: Baton2's reservation release transition; proof: checked equality with
   identity/version binding.
5. Pass: matching identity releases; violate: a stale token releasing a newer same-id
   reservation is rejected by the checker.
6. External: the identity minter must be unique per live reservation.
7. Trace: `impl/src/worktree-capacity.mjs:854-871`; tests
   `impl/test/phase59-worktree-capacity-authority.test.mjs:695` "WC12", `:654`, `:507`.
   Simplifies: per-caller nonce bookkeeping.

### CX-2 — Recovery preserves uncertainty about an external effect (0 first-pass candidates)

No row is classed Candidate here. The family's guarantee is carried by Split rows CAP-6 (reclaim
only after ownership provably ended) and CL-14 (at-most-once integration, truthful attribution,
replay agreement as three separate obligations) — see Part B — and by the family's two
propositions in the independent proposals. The lanes' corrections apply: process liveness and
mutable claim state are runtime measurements until capability threading or durable fencing is
demonstrated.

### CX-3 — Published work is the work the evidence authorizes (9 candidates)

**CL-08 · Candidate.**
1. Guarantee: landing requires the applicable accepted review state for the exact contribution
   and version at the decision boundary. Ruled out: merging while a rejection is the latest
   decision, or an acceptance earned by a different version.
2. Inviolable because review has no value if its outcome can be bypassed at the merge; permits
   any upstream resolution policy and any merge strategy; status: enforced today (pre-effect
   gate).
3. Proposition (sketch): `Landed(trace, c) -> AcceptedState(Reviews(trace), c.version)`, with
   the CL-06 reduction as the only producer of the accepted index. Carrier corrected: an
   accepted-state-indexed contribution type is a dependent-proof candidate (finding 9), not
   unavailable; a checked example is owed before adoption.
4. Applies to: the Baton2 landing transition; proof: quantified implication over admissible
   traces, checked against the landing function.
5. Pass: accept-last lands; violate: reject-last or wrong-version landing is refused; vacuity:
   the CX-6 obligation prevents satisfying this by never landing.
6. External: the review store is authoritative; no other write path into the target exists
   (deployment assertion, tied to CL-15).
7. Trace: `impl/src/swarm-runtime.mjs:7360-7370`; test
   `impl/test/issue296-swarm-integrate.test.mjs:295`. Simplifies: the pre-effect refusal ladder.

**CL-13 · Candidate.**
1. Guarantee: publication moves the target only to the exact verified result under a valid
   target-version transition; an ordinary integration and an authorized rollback are distinct
   transitions. Ruled out: landing computed against a stale head, or a red result publishing.
2. Inviolable because verification applies to an exact version; permits squash, merge, rebase
   and other reviewed transports; status: enforced today (gates, CAS), split carried honestly —
   the race half stays runtime-detected.
3. Proposition (sketch): the landing transition consumes a `GateVerdict` sum (green case only)
   and a linear head-before token consumed by an atomic compare-and-swap whose result forces the
   moved case to be handled; the race detection itself is an effect obligation.
4. Applies to: the target-update transition; proof: the verdict and swap results are affine
   values whose handling is exhaustive.
5. Pass: green plus unchanged head lands; violate: red payload reaching the update, or an
   unhandled moved case, is rejected.
6. External: the atomicity of the target update is a git/host effect obligation.
7. Trace: `impl/src/worktree.mjs:2340-2348`; `impl/src/swarm-runtime.mjs:7299-7306`; tests
   `impl/test/issue296-swarm-integrate.test.mjs:279`, `impl/test/issue463-integrate-gate-paths.test.mjs:352`.
   Simplifies: the verdict-ladder and manual head re-checks.

**CL-03 · Candidate.**
1. Guarantee: a claimed delivered revision resolves to the actual, attributable artifact in the
   repository the report names. Ruled out: a report whose commit does not exist being admitted.
2. Inviolable because downstream review and landing consume the artifact; permits any
   repository layout; status: enforced today, runtime by nature.
3. Proposition (sketch): admission consumes a `Resolved{commit}` produced by a resolution effect
   bound to the named repository and authority; the law states which repository — the assumption
   is explicit, not silent.
4. Applies to: contribution admission; proof: the resolution effect's result type forces the
   unresolved case; the repository identity is carried in the report record.
5. Pass: a real sha admits; violate: a fabricated sha yields the typed refusal record
   {field, rule, sha, branch}.
6. External: repository access; the git query is a host effect.
7. Trace: `impl/src/swarm-runtime.mjs:2327-2343`; test
   `impl/test/issue310-contribution-contract.test.mjs:130`. Simplifies: ad hoc sha checks.

**CL-02 · Candidate.**
1. Guarantee: a report does not assert authorship the submitting authority does not support.
   Ruled out: filing work under another seat's name.
2. Inviolable because review and credit consume authorship; permits any identity substrate;
   status: enforced today.
3. Proposition (sketch): the publish record has no author field; authorship is a function of the
   authenticated principal: `author(publish) == principal(request)`.
4. Applies to: the publish transition; proof: equality by construction — the value is derived,
   not supplied.
5. Pass: honest publish attributes the caller; violate: a caller-named author is unwritable.
6. External: the principal substrate's authentication (AB-13/AB-14 assumptions).
7. Trace: `impl/src/swarm-runtime.mjs:7862-7864`; test
   `impl/test/swarm-runtime.test.mjs:97`. Simplifies: author checks at every reader.

**CL-05 · Candidate.**
1. Guarantee: a stable contribution identity is not reused to overwrite a different contribution
   or its history; reuse may only extend the same content's record. Ruled out: a duplicate
   record replacing or doubling an existing one.
2. Inviolable because identities are cited by successors and reviews; permits any identity
   scheme; status: enforced today; carrier route: linear-ledger threading (runtime until then).
3. Proposition (sketch): `record(id, body2)` after `record(id, body1)` is `Duplicate` unless the
   ledger threads ownership linearly; the disposition of `id` never changes to a different
   content.
4. Applies to: the recording fold; proof: insertion preserves the existing disposition.
5. Pass: duplicate refused with the original retained; violate: overwrite or second row.
6. External: durable ledger.
7. Trace: `impl/src/swarm-state.mjs:2210-2212`; tests
   `impl/test/swarm-state.test.mjs:674`, `impl/test/issue441b-seat-read-verbs.test.mjs:373`.
   Simplifies: uniqueness checks at readers.

**CL-15 · Candidate.**
1. Guarantee: repository mutation requires valid repository authority and the applicable
   operation permission. Ruled out: an ordinary contributor rewriting the shared branch, or a
   deployment without git access attempting a merge.
2. Inviolable because the target is the shared record; permits any authority substrate; status:
   enforced today.
3. Carrier corrected (forge-lease probe): an opaque `GitAuthority` with an exported constructor
   is forgeable at this pin. Honest forms: hold the authority constructor in Base (named
   language prerequisite), or proof-index the wiring to the deployment record. Provenance label;
   the permission half is a codomain/theorem check over the PM tables.
4. Applies to: the integrate transition's parameter type.
5. Pass: authorized integration typechecks; violate: a call without the authority value does not
   typecheck.
6. External: deployment wiring actually holds git access — stated, runtime.
7. Trace: `impl/src/swarm-runtime.mjs:7378-7383`; test
   `impl/test/swarm-native-bridge.test.mjs:312`. Simplifies: runtime authority ladders.

**CL-17 · Candidate.**
1. Guarantee: caller commands cannot forge internal execution, verification or landing facts.
   Ruled out: a submitted event claiming "your work was merged".
2. Inviolable because the log is evidence; permits any event vocabulary; status: enforced
   today; the review names the pattern a strong candidate.
3. Carrier confirmed (codomain): two disjoint enums — submit events and driver rows — with the
   update operation taking only the submit enum.
4. Applies to: the update entry point; proof: exhaustiveness of the accepted type.
5. Pass: honest events record; violate: a driver kind in an update is unwritable.
6. External: none beyond the durable log.
7. Trace: `impl/src/swarm-event-schemas.mjs:201-207`, `impl/src/swarm-contract.mjs:55-57`; test
   `impl/test/swarm-refusals.test.mjs:188`. Simplifies: runtime kind filtering.

**CS-17 · Candidate.**
1. Guarantee: a claimed contribution satisfies the agreed versioned contract. Ruled out: reports
   with missing or extra fields being processed.
2. Inviolable because readers program against the shape; permits versioned contract evolution;
   status: enforced today.
3. Carrier confirmed with the boundary note: nested exact record types govern internal values;
   the boundary decoder for external bodies still returns the structured {field, rule,
   expectation} failure — that refusal lives at the decoder, not inside the typed domain.
4. Applies to: the decode-then-admit path; proof: the record types plus a total decoder.
5. Pass: a well-formed report decodes; violate: an extra field is rejected at the boundary.
6. External: request bodies arrive from outside the system.
7. Trace: `impl/src/contribution-contract.mjs:162-241`; tests
   `impl/test/issue310-contribution-contract.test.mjs:164`,
   `impl/test/issue371-contract-example.test.mjs`. Simplifies: per-reader validation.

**PM-11 · Candidate.**
1. Guarantee: review attribution comes from the actual authenticated actor and binds the reviewed
   artifact version — attribution is to (actor, contribution, revision), not the id alone.
   Ruled out: a review filed under another's name, or an approval detached from the version it
   examined.
2. Inviolable because approvals gate landing; permits any identity substrate; status: enforced
   today, extended per the review.
3. Carrier confirmed and extended (codomain + derivation): the caller-facing review record omits
   the reviewer field; attribution derives from the acting principal; the record carries the
   reviewed revision.
4. Applies to: the review recording transition; proof: derivation by construction plus the
   version field's presence.
5. Pass: honest review attributes actor and version; violate: a caller-named reviewer or a
   version-less approval is unwritable.
6. External: the principal substrate.
7. Trace: `impl/src/swarm-runtime.mjs:7880-7884`; `impl/src/swarm-state.mjs:1017-1024`; test
   `impl/test/issue292-coupling-truth.test.mjs:263`. Simplifies: post-hoc attribution audits.

### CX-4 — Equivalent requests have equivalent authority and effects across interfaces (4 candidates)

**LEDG-17 · Candidate.**
1. Guarantee: live admission and replay accept the same transitions at the same schema and state.
   Ruled out: an entry the writer accepts failing at replay.
2. Inviolable because the system must start up on what it recorded; permits two independently
   written functions that provably agree — function identity is optional (corrected by the
   ledger lane and Codex finding 6); status: enforced today.
3. Proposition (sketch): `accepted(live, kind, payload, schema_version) ==
   accepted(replay, kind, payload, schema_version)` for all recorded kinds at a declared schema
   version — a theorem about two functions agreeing.
4. Applies to: the admission predicate and the replay fold; proof: quantified equality over the
   closed kind set.
5. Pass: agreement holds for every kind; violate: a kind admitted live but refused at replay
   fails the equality; vacuity: refusing everything live satisfies agreement — CX-6 covers
   admission.
6. External: the durable log records what live admitted.
7. Trace: `impl/src/coordination-ledger.mjs:80, 1195-1198`;
   `impl/src/coordination-admission.mjs:233`; tests
   `impl/test/issue290-prospective-fold.test.mjs:20`, `impl/test/issue304-fold-admission-gate.test.mjs:16`.
   Simplifies: dual validation tables.

**CS-03 · Candidate.**
1. Guarantee: a decoded command satisfies its declared versioned argument contract before any
   authority-bearing effect. Ruled out: an effect running on arguments that were never checked
   against the version they claim.
2. Inviolable because effects are authority-bearing; permits per-version contract evolution;
   status: enforced today.
3. Carrier confirmed (codomain, versioned): an exact argument record declared per schema
   version, checked at the boundary decoder; the record is versioned, not eternally frozen.
4. Applies to: the decode step preceding dispatch; proof: the decoder is total and its result
   type is the contract.
5. Pass: a valid command decodes; violate: an unknown field or wrong-typed argument is refused
   with the admitted fields.
6. External: commands arrive from outside the system.
7. Trace: `impl/src/swarm-contract.mjs:869-875`; test
   `impl/test/issue372-closed-sets-taught.test.mjs:49`. Simplifies: per-effect argument checks.

**CS-06 · Candidate.**
1. Guarantee: unvalidated payload fields acquire no meaning or authority during a state
   transition. Ruled out: extra fields riding into the fold inside a payload.
2. Inviolable for the same reason as CS-03, one level deeper; status: enforced today.
3. Carrier confirmed (codomain): a per-event payload record type; once decoding succeeded, the
   typed value excludes the malformed state.
4. Applies to: payload decode; proof: exact record types per event kind and version.
5. Pass: known fields decode; violate: an undeclared field is refused, naming the event's
   fields.
6. External: payloads come from callers.
7. Trace: `impl/src/swarm-contract.mjs:923-935`; test
   `impl/test/swarm-refusals.test.mjs:131`. Simplifies: defensive copies at readers.

**CS-07 · Candidate.**
1. Guarantee: required caller data is established, and server-owned fields derive from server
   authority. Ruled out: a caller omitting a required field, or supplying a server-assigned one.
2. Inviolable because authority-owned values must not be caller-chosen; status: enforced today.
3. Carrier confirmed (codomain): `CallerPayload` (required fields total, server-owned absent)
   versus `StoredPayload` (all fields), plus a total caller-to-stored derivation.
4. Applies to: admission; proof: the derivation is the only producer of `StoredPayload`.
5. Pass: a complete caller payload maps to a stored payload; violate: a caller-supplied
   server-owned field is unwritable.
6. External: none beyond CS-03's boundary.
7. Trace: `impl/src/swarm-contract.mjs:911-946`; `impl/src/swarm-event-schemas.mjs:447-449`;
   test `impl/test/swarm-event-schemas.test.mjs:65`. Simplifies: optionality ladders.

### CX-5 — Recovery and storage changes preserve the agreed logical history (5 candidates)

**CL-07 · Candidate.**
1. Guarantee: adding a review preserves the previous review facts and their order in the
   authoritative history — the old history is a prefix of the result and the new review occupies
   the appended position. Ruled out: a fold returning only the newest review.
2. Inviolable because supersession without retention erases the record; status: enforced today.
3. Proposition (sketch, quantified form): for every review list `xs` and review `r`,
   `add_review(xs, r) == xs ++ [r]` — the universal theorem; Codex's checked concrete equality
   (`[1,2]` plus `3` is `[1,2,3]`; the discarding implementation returning `[3]` is rejected) is
   the PROOF.bend model. Writing the quantified theorem is open work for the owning lane.
4. Applies to: the review-append transition; proof: checked equality, universal form.
5. Pass: the appending implementation checks; violate: the erasing implementation is rejected
   for the stated reason.
6. External: the durable review record.
7. Trace: `impl/src/swarm-state.mjs:2258-2267`; test
   `impl/test/issue296-swarm-integrate.test.mjs:308`. Simplifies: retention arguments at every
   reader.

**WAKE-3 · Candidate.**
1. Guarantee: resuming from cursor N reads from N+1, preserves order and completeness, and
   returns the correct next cursor. Ruled out: a reconnect with a gap or a duplicate.
2. Inviolable because agents act on what they have seen; status: enforced today.
3. Proposition (sketch): for history `h` and cursor `N` valid in `h`:
   `pull(h, Since(N)) == frames(h, N+1, head(h)) ++ [next = head(h)]` — a checked refinement
   over the pull function; the distinct-Seq-type carrier alone is forgeable and insufficient
   (corrected by the ledger lane; finding 7 names exactly this gap).
4. Applies to: the pull transition; proof: quantified equality over histories and cursors.
5. Pass: the resume property holds; violate: an off-by-one or skipping pull fails the equality.
6. External: the log's order and durability (LEDG-1).
7. Trace: `impl/src/wake-stream.mjs:619, 759-787`; tests
   `impl/test/wake-stream.test.mjs:207`, `impl/test/wake-mcp-consumers.test.mjs:181`.
   Simplifies: per-transport replay logic.

**PROP-2 · Candidate (proposed improvement).**
1. Guarantee: every history admitted under a declared schema version has a defined replay result
   under that contract. Ruled out: writing an entry the system cannot replay.
2. Inviolable because startup consumes history; status: proposed — defended piecewise today
   (pre-write checks, quarantine), not stated as one rule.
3. Proposition (sketch): `admitted(h) -> exs p: Projection such that replay(h) == Ready(p)` — a
   total-function proposition over the admitted row type; the smart constructor alone is only as
   private as its export (corrected by the ledger lane), so the carrier needs a constructor
   unreachable from outside or a proof indexed by the admission predicate.
4. Applies to: the admitted-row type and the replay function; proof: totality theorem.
5. Pass: every admitted history replays; violate: an admitted-but-unreplayable entry fails the
   theorem.
6. External: storage returns what was written.
7. Trace: `impl/test/issue290-prospective-fold.test.mjs`; `impl/test/issue304-fold-admission-gate.test.mjs`.
   Simplifies: startup triage paths.

**LEDG-15 · Candidate.**
1. Guarantee: a pre-write validation gate reports a judgment and leaves the state it judged
   exactly as it was. Ruled out: a gate appending or mutating as a side effect of judging.
2. Inviolable because a check that changes state alters what it certified; status: enforced
   today, unpinned.
3. Proposition (sketch, corrected by the ledger lane against its own earlier claim): purity
   alone is insufficient — a pure `state -> state` can return a different state. The law is the
   checked equality `gate(state) == state`, a dependent proposition available at this pin.
4. Applies to: the gate function's type and body; proof: the equality theorem.
5. Pass: the identity gate checks; violate: a state-changing gate fails the equality.
6. External: none.
7. Trace: `impl/src/coordination-ledger.mjs:1200-1204`. Test: none (unpinned) — the checked
   theorem becomes the pin.

**LEDG-16 · Candidate.**
1. Guarantee: writes are authorized only against state whose required recovery has established
   validity. Ruled out: an append landing while a deferred open is still replaying.
2. Inviolable because new history on unread history orders wrongly; status: enforced today.
3. Proposition (sketch, corrected by the ledger lane): a `Ready`-typed store is forgeable if its
   constructor is exported (provenance); the guarantee is a proposition binding the write to a
   completed recovery — `append(store, e)` requires `Recovered(store)` produced by the replay
   transition.
4. Applies to: the open/append pair; proof: the recovery transition is the only producer of the
   recovered witness.
5. Pass: post-recovery appends; violate: a pre-recovery append lacks the witness.
6. External: the store file.
7. Trace: `impl/src/coordination-ledger.mjs:1187-1189`; tests
   `impl/test/issue434-deferred-open-reconstruction.test.mjs:75, 43`. Simplifies: loading flags.

### CX-6 — Pending work has a justified continuation, and ready work can advance (1 candidate)

**CAP-2 · Candidate.**
1. Guarantee: agent work is not refused for an arbitrary worker-slot or load threshold; actual
   resource conditions are stated separately from the admission decision. Ruled out: "the
   machine is busy" as a worker refusal.
2. Inviolable per the no-cutoff ruling; permits resource-based evidence and operator-stated
   ceilings with justification; status: enforced today (#541).
3. Carrier confirmed (codomain, by the ledger lane): the worker arm of the lease variant carries
   no weight field, so a worker cannot be charged one; the admission function has no worker
   refusal arm to return.
4. Applies to: the admission transition; proof: exhaustiveness of the variant plus the proven
   law `worker_admitted_at_any_load` in the draft `laws.bend`.
5. Pass: workers admit at any observed load; violate: a load-threshold refusal has no
   constructible result.
6. External: the host scheduler throttles actual execution.
7. Trace: `impl/src/host-capacity.mjs:274, 249`; tests
   `impl/test/issue297-issue307-host-capacity.test.mjs:77`, `:444`. Simplifies: the removed
   admission-gate machinery.

### G-7 — Workspace preservation and custody (5 candidates)

**CUST-1 · Candidate.**
1. Guarantee: assigned work is not discarded until custody is explicitly settled — including the
   shutdown path. Ruled out: a cleanup deleting files while a worker's final write is in flight.
2. Inviolable because work is the product; permits any custody substrate; status: enforced
   today.
3. Proposition (sketch, corrected against probe drop-lease): the affine capability alone gives
   at-most-once use; the carrier needs the settled state reachable only from the release call
   plus a checked proposition relating that call to the observed workspace state (deletion
   accepts only `Settled`). Provenance claim; named language prerequisite or proof-carrying
   transition.
4. Applies to: the removal transition of Baton2's workspace service.
5. Pass: removal after settle; violate: removal without the settled witness is unwritable; the
   drop-a-lease probe result cannot be repeated for the removal call.
6. External: filesystem effects; process liveness is CUST-3/CX-2 territory.
7. Trace: `impl/src/shared-workspace-custody.mjs:38`; tests
   `impl/test/shared-workspace-custody.test.mjs:318`, `:268`. Simplifies: status-string ladders.

**CUST-2 · Candidate.**
1. Guarantee: a workspace generation that is closing admits no new user of that same generation.
   Ruled out: a fresh session starting in a folder being dismantled.
2. Inviolable because placement must precede teardown; status: enforced today.
3. Carrier confirmed with scope (codomain; ledger lane): the attach function's result type has
   no arm admitting a closing checkout — `Attachable = Pending | Working | Blocked | Idle` as a
   type distinct from the full holder state; bind the check to the workspace generation, since a
   new generation is a new question.
4. Applies to: the attach transition; proof: exhaustiveness — no case maps closing to attachable.
5. Pass: active generations attach; violate: a closing generation has no attachable case.
6. External: none beyond the generation record.
7. Trace: `impl/src/shared-workspace-custody.mjs:25, 70-76`; tests
   `impl/test/shared-workspace-custody.test.mjs:489`, `:425`. Simplifies: status-string checks.

**CUST-4 · Candidate.**
1. Guarantee: destruction preserves un-captured work and live holders; a stale observation
   cannot authorize deletion. Ruled out: cleanup erasing unsaved work, or removing a folder
   under a live holder.
2. Inviolable because work is the product; status: enforced today with distinct typed refusals.
3. Proposition (sketch, corrected by the ledger lane): an observation token proves only that the
   destruction call received an observation; the carrier needs generation-identity binding plus
   a proposition that the token's observation and the destruction target are the same workspace
   generation. The observation scan itself stays a runtime effect.
4. Applies to: the destruction transition; proof: the token's type binds (workspace, generation)
   and the destroy call consumes it.
5. Pass: a fresh observation of the same generation authorizes; violate: an observation of a
   prior generation is rejected by the type.
6. External: the observation walk; new writes after the observation are the generation-binding's
   subject.
7. Trace: `impl/src/worktree.mjs:1312-1326, 1254-1300`; tests
   `impl/test/workspace-preservation.test.mjs:164`, `:501`, `:557`, `:587`. Simplifies: reason-code ladders.

**CUST-5 · Candidate.**
1. Guarantee: an ordinary caller flag cannot bypass preservation; any separately authorized
   disposal action is explicit and named. Ruled out: `force` destroying unsaved content.
2. Inviolable because preservation is the backstop; status: enforced today.
3. Carrier confirmed with scope (structural; codomain): the destroy argument record has no
   authority-carrying field, so a caller flag has nowhere to be passed; what must be added, per
   the review, is an explicit separately authorized disposal action as its own transition.
4. Applies to: the destroy transition's parameter type.
5. Pass: honest removal calls typecheck; violate: a bypass flag is unwritable.
6. External: an operator-authorized disposal path, if adopted, carries its own authority.
7. Trace: `impl/src/worktree.mjs:1170-1183`; tests
   `impl/test/workspace-preservation.test.mjs:234`, `:217`. Simplifies: flag audits.

**CUST-8 · Candidate.**
1. Guarantee: a custody or status observation does not manufacture authorship or approval
   evidence. Ruled out: a status record read as a credit or ownership claim.
2. Inviolable because readers act on records; status: enforced today.
3. Carrier confirmed (structural; the probes do not reach it): the record type carries exactly
   checkout, observed head and holder count — a record cannot assert what its type has no field
   for.
4. Applies to: the record constructor.
5. Pass: honest records; violate: an authorship claim has no field.
6. External: none.
7. Trace: `impl/src/shared-workspace-custody.mjs:97`; test
   `impl/test/shared-workspace-custody.test.mjs:392`. Simplifies: reader-side caveats.

### G-8 — Truthful authority and provenance (12 candidates)

**CAP-7 · Candidate.**
1. Guarantee: a release affects only the exact authority and resource instance it was issued
   for. Ruled out: a release altering another resident's lease.
2. Inviolable because reservations gate real work; status: enforced today.
3. Proposition (sketch, corrected upward by the ledger lane): the released identity equals the
   issued identity at the release function — a checked equality; the affine token alone is a
   provenance claim the forge-lease probe refutes.
4. Applies to: the release transition; proof: identity equality, checked.
5. Pass: exact identity releases; violate: a mismatched release returns the typed not-ours
   verdict and changes nothing.
6. External: the issuer's identity records.
7. Trace: `impl/src/host-capacity.mjs:773-786`; tests
   `impl/test/issue297-issue307-host-capacity.test.mjs:129`,
   `impl/test/issue333-suite-verify-lease.test.mjs:96`. Simplifies: identity ladders.

**LEDG-4 · Candidate.**
1. Guarantee: an obsolete writer authority cannot append after its generation loses ownership.
   Ruled out: a replaced writer interleaving entries into history.
2. Inviolable because interleaved history breaks replay identity; status: enforced today.
3. Proposition (sketch, corrected by the ledger lane): append carries a durable generation or
   fencing check — the appended row is accepted only when the writer's generation is current at
   append time; the affine lease value only types the allowed transition (it can be dropped, and
   its constructor is forgeable).
4. Applies to: the append transition; proof: the fencing proposition over the generation
   records, with the replacement detection as runtime evidence.
5. Pass: a current generation appends; violate: a superseded generation's append is refused by
   the fencing check.
6. External: process identity marks (token, pid, pidStart) as runtime evidence of replacement.
7. Trace: `impl/src/coordination-ledger.mjs:1184`; `impl/src/coordination-admission.mjs:201-231`;
   tests `impl/test/phase42-policy-invalidation.test.mjs:137`,
   `impl/test/phase56-drain-and-close.test.mjs:499`. Simplifies: lease bookkeeping.

**AB-04 · Candidate.**
1. Guarantee: conflicting concurrent mutation of an exclusively claimed resource requires an
   explicit coordination rule; absent one, the second claim refuses before any write. Ruled
   out: two workers editing the same files in one copy.
2. Inviolable because silent overlap loses work; permits the writer lease, transactional
   storage, or any coordination rule that is stated; status: enforced today.
3. Law form (validators lane, sharpened): the refusal is the no-coordination-present case of
   the rule; the row stays state-led — the affine path-range token route is the optional proof
   route, not a promise.
4. Applies to: the claim-admission transition over the mutable claim records.
5. Pass: non-overlapping claims admit; violate: an overlapping claim without a coordination rule
   is refused with the typed conflict record.
6. External: the claim store is durable state.
7. Trace: `impl/src/swarm-state.mjs:1072-1083, 1889-1899`; tests
   `impl/test/issue423-claims-proposals-state.test.mjs:74`,
   `impl/test/issue441d-claims-instead-of-handovers.test.mjs:117`. Simplifies: overlap heuristics.

**AB-05 · Candidate.**
1. Guarantee: a claim remains bound to the resource instance and the authority under which it
   was established. Ruled out: a claim floating between copies or authorities.
2. Inviolable because the conflict rule consumes the binding; status: enforced today, scope
   extended per the review.
3. Carrier confirmed (codomain): the caller-facing claim record omits the workspace field; the
   fold derives the binding and must consume both the resource instance and the establishing
   authority.
4. Applies to: the claim-recording fold; proof: derivation by construction.
5. Pass: honest claims carry derived bindings; violate: a caller-supplied binding is unwritable.
6. External: the participant records.
7. Trace: `impl/src/swarm-state.mjs:1883-1888`; tests
   `impl/test/issue423-claims-proposals-state.test.mjs:51, 67`. Simplifies: binding audits.

**AB-09 · Candidate.**
1. Guarantee: a caller cannot fabricate another participant's system-issued scope authority. 
   Ruled out: a hand-written claim id in the reserved namespace.
2. Inviolable because the scope record is the permission boundary's provenance; status:
   enforced today.
3. Carrier corrected (provenance): the abstract newtype with a private constructor is refuted at
   this pin (forge-lease probe; opaque handles are WONTFIX-reserved to Base). Routes that must be
   demonstrated before adoption: a Base-reserved opaque handle, or a proof-indexed encoding where
   the scope-claim id carries a checked proof of the holder's join event.
4. Applies to: the claim-id construction.
5. Pass: system-minted ids; violate: a hand-written reserved id fails the proof check.
6. External: the join-event record the proof indexes.
7. Trace: `impl/src/swarm-state.mjs:651-658`; tests
   `impl/test/issue441d-claims-instead-of-handovers.test.mjs:220, 250-253`. Simplifies: prefix checks.

**AB-10 · Candidate.**
1. Guarantee: nested options never enlarge the authority a read-only request admits. Ruled out:
   a buried option turning a read-only recruit into a changing one.
2. Inviolable because the read-only promise must hold at every depth; status: enforced today.
3. Carrier confirmed (codomain): a total function from the mode enum to the intent enum with
   exhaustive cases; the intent has no other producer.
4. Applies to: the recruit-admission transition; proof: exhaustiveness.
5. Pass: read_only yields read-only evidence; violate: no constructible route to the change
   intent from a read-only mode.
6. External: none.
7. Trace: `impl/src/swarm-runtime.mjs:8083-8087`; test
   `impl/test/issue373-read-only-recruit.test.mjs:85`. Simplifies: option-merging audits.

**AB-11 · Candidate.**
1. Guarantee: a read-only result does not claim an authorized change; ordinary references to
   existing commits stay representable as evidence. Ruled out: a read-only body asserting a new
   authorized commit.
2. Inviolable because evidence must be expressible while claims are not; status: enforced today
   with a scope correction by the validators lane — today's refusal of any commit object is
   narrower than the guarantee.
3. Carrier confirmed, corrected in scope (codomain): a two-constructor report sum — the
   read-only body admits `Reference(existing commit)` and refuses authorship-claiming commit
   references; the change body carries the optional commit of its own.
4. Applies to: the publish record type per mode.
5. Pass: an evidence reference in a read-only body typechecks; violate: a claiming reference is
   unwritable.
6. External: commit identity resolution (CL-03's assumption).
7. Trace: `impl/src/contribution-contract.mjs:386-391`; test
   `impl/test/issue373-read-only-recruit.test.mjs:171`. Simplifies: mode ladders at readers.

**AB-14 · Candidate.**
1. Guarantee: principal, scope and provenance derive from authenticated authority; caller data
   cannot impersonate them. Ruled out: a request field choosing the acting identity or group.
2. Inviolable because authority follows authentication; status: enforced today.
3. Carrier confirmed with the forgeability caveat (validators lane): the wire records omit
   principal and context fields — that half is codomain; the scoped-group value minted at issue
   needs its mint in Base or a proof-indexed construction, since an exported affine constructor
   is forgeable at this pin.
4. Applies to: the request decode and dispatch types.
5. Pass: honest requests decode with derived identity; violate: an identity-bearing field is
   unwritable, and a cross-group call fails the scoped type.
6. External: the token table and transport (AB-13's runtime boundary).
7. Trace: `impl/src/swarm-native-bridge.mjs:491-501, 599-603`; tests
   `impl/test/swarm-native-bridge.test.mjs:347, 436, 215, 635`. Simplifies: per-command identity
   checks.

**PM-07 · Candidate.**
1. Guarantee: participant actions require currently valid membership and the named authority at
   action time; operator authority is modeled separately. Ruled out: a removed participant
   exercising detailed rights, or refusal messages disclosing the authority ladder.
2. Inviolable because membership is the entry condition; status: enforced today; runtime until
   capability threading exists (validators lane: carrier unchanged, state-held).
3. Proposition (sketch): every command's parameter type consumes a membership witness minted at
   join and invalidated on leave; until the mint is demonstrable, the check stays runtime and
   the refusal stays typed.
4. Applies to: every dispatch path; proof: capability threading, when demonstrated.
5. Pass: members act; violate: a non-member's request lacks the witness.
6. External: the membership store.
7. Trace: `impl/src/swarm-runtime.mjs:1947-1961, 5151-5156, 5229-5231`; test
   `impl/test/swarm-native-bridge.test.mjs:336`. Simplifies: per-verb gates.

**PM-08 · Candidate.**
1. Guarantee: delegation cannot manufacture authority the delegator is unable to grant. Ruled
   out: an ordinary worker admitting organizers.
2. Inviolable because the permission structure must be real; status: enforced today, unpinned.
3. Carrier corrected (validators lane, per finding 9): the grant argument carries a subset
   witness over the declared, versioned permission universe — a dependent proposition the pin
   supports; subject to a checked example and identity binding.
4. Applies to: the recruit/grant transition; proof: the subset witness checked at grant time.
5. Pass: grants within the holder's set; violate: a superset grant lacks the witness.
6. External: the holder's own grant record.
7. Trace: `impl/src/swarm-runtime.mjs:7930-7932`. Test: none (unpinned) — the checked witness
   becomes the pin.

**PR-01 · Candidate (proposed improvement).**
1. Guarantee: scope semantics are established before use, so malformed scope cannot become
   unrestricted access. Ruled out: an unreadable pattern matching everything downstream.
2. Inviolable because scope bounds authority; status: proposed — workflow member scopes already
   do this, recruit scopes do not.
3. Carrier confirmed (validators lane): parse scope strings into the glob and path types at the
   recruit boundary; per AB-02's decomposition, the parse establishes scope semantics while OS
   containment is a separate contract.
4. Applies to: recruit admission; proof: the parser's result type.
5. Pass: well-formed scopes parse; violate: a malformed pattern is refused at admission.
6. External: none.
7. Trace: `impl/src/swarm-runtime.mjs:696-711, 991-999`; `impl/src/context-runtime.mjs:632`;
   precedent `impl/src/workflow-interpreter.mjs:206-210`. Simplifies: fail-open view logic.

**DEV-4 · Candidate (development law).**
1. Guarantee: a refusal truthfully identifies the failed rule, the relevant input or state, and
   an actionable remedy, without inventing one. Ruled out: refusals that force blind retries.
2. Inviolable because agents act on refusals; status: enforced as a project rule (mandate §3)
   and partially by the typed-refusal machinery.
3. Proposition (sketch): the refusal record's three fields are mandatory and their values are
   derived from the check that failed — the remedy field is produced by the rule table, never
   free text. Dependent shape; the honest form is a proof-carrying construction over the refusal
   vocabulary.
4. Applies to: every refusal site; proof: construction through the typed refusal constructor.
5. Pass: every refusal carries derived triple; violate: a refusal with an invented remedy has no
   constructor.
6. External: none.
7. Trace: `docs/bend2/MANDATE.md` §3; enforcement halves CS-05, CS-16, CS-17 and their tests.
   Simplifies: retry logic in every caller.

---

## Part B — Split rows (46): the retained guarantee, and what must not be frozen

Each entry names the guarantee that must remain true in Baton2 and the mechanism or policy the
draft must not enshrine. Traces are the historical extraction, unchanged.

**CUST-3.** Keep: custody has one authoritative determination, and it includes unfinished
cleanup. Stop freezing: a particular live-handle registry as that authority.
Trace: `impl/src/shared-workspace-custody.mjs:1-13, 53`; consumers
`impl/src/runtime-api.mjs:583`, `impl/src/coordinator.mjs:4216`.

**CUST-6.** Keep: disposal requires evidence the content is safe to destroy. Stop freezing: the
owner-metadata fields, the root-path literal rules, and Git-untracked status as the evidence
form.
Trace: `impl/src/worktree.mjs:1187-1199, 1282-1284`; tests
`impl/test/workspace-preservation.test.mjs:311, 418, 396`.

**CUST-7.** Keep: an unowned or foreign user workspace is never captured or destroyed;
protection follows ownership, not path spelling. Stop freezing: one Git folder name being
permanently special.
Trace: `impl/src/worktree.mjs:1334-1349`; test
`impl/test/workspace-preservation.test.mjs:438`.
**CUST-11.** Keep: no branch or worktree effect without established custody. Stop freezing:
atomic receipt-file publication and the reconciliation algorithm as the means.
Trace: `impl/src/worktree.mjs:439-447, 598-614, 740-824`; tests
`impl/test/phase92.2-physical-workspace-owner-red.test.mjs:96, 139, 245, 433`.

**CAP-1.** Keep: an admission decision states the physical condition it rests on, with the
numbers observed. Stop freezing: a particular threshold formula or an opaque wrapper around it.
Trace: `impl/src/host-capacity.mjs:185, 230-245`; test
`impl/test/issue297-issue307-host-capacity.test.mjs:48`.

**CAP-3.** Keep: work that cannot proceed now is held durably and is admitted when capacity
returns; the queue is visible and ordered. Stop freezing: strict FIFO — a feasibility- or
priority-aware order that still admits every waiting request serves the guarantee; the missing
timeout constructor alone does not prove FIFO progress (Codex finding 5).
Trace: `impl/src/host-capacity.mjs:704-768`; tests
`impl/test/issue512-suite-admission-refusal.test.mjs:150`,
`impl/test/issue333-suite-verify-lease.test.mjs:191`.

**CAP-6.** Keep: reclaim only after ownership has provably ended. Stop freezing: PID liveness as
that proof; the process-to-resource relationship must be established.
Trace: `impl/src/host-capacity.mjs:117, 714`; test
`impl/test/issue297-issue307-host-capacity.test.mjs:129`.

**CAP-8.** Keep: a capacity record is a valid closed shape before it is believed — a record type
with no authority-carrying field cannot carry one (ledger lane, keeping the behavioral half).
Stop freezing: the serialized byte cutoff as a domain law; any bound needs a physical derivation
and must not truncate a logical input (cutoff-audit row).
Trace: `impl/src/host-capacity.mjs:53-55, 365-386`; test
`impl/test/issue500-worktree-capacity.test.mjs:129, 151`.

**CAP-12.** Keep: a child cannot forge delegated resource authority. Stop freezing: the
parent-token digest as the representation and the environment as the transfer topology.
Trace: `impl/scripts/suite-host-lease.mjs:38, 50`; tests
`impl/test/issue424-seat-suite-lease.test.mjs:65, 84`.

**CAP-13.** Keep: exclusive accounting with valid ownership. Stop freezing: HMAC-sealed files,
private roots and lock publication; another substrate that keeps the accounting exclusive serves
it.
Trace: `impl/src/worktree-capacity.mjs:158-170, 324-405`; tests
`impl/test/issue297-issue307-host-capacity.test.mjs:257`,
`impl/test/phase59-worktree-capacity-authority.test.mjs:348, 404, 740`.

**CAP-15.** Keep: no terminal refusal at a deadline — a requester that cannot take the worktree
capacity reservation lock queues and is admitted in order when the holder releases, an
ambiguous or live owner's state is preserved and never displaced, and the bounded-wait property
is preserved by the queue rather than by a refusal. This is the same resolution #541 applied to
host admission. Precise mechanism note, adjudicated: the deadline here is the worktree
reservation lock's (`impl/src/worktree-capacity.mjs:41-43`, `DEFAULT_LOCK_WAIT_MS = 5000`, with
the acquisition loop refusing pre-effect once the monotonic deadline passes at `:521-535` and
`:586-587`) — a different mechanism from the host-capacity queue deadline #541 removed in
`impl/src/host-capacity.mjs`; the ruling is applied to this lock by analogy, and the lock
deadline is not attributed to #541 itself.
Trace: `impl/src/worktree-capacity.mjs:41-45, 520-591`; tests
`impl/test/worktree-capacity-contention.test.mjs:314, 421, 368, 455, 597`.

**WAKE-1.** Keep: every event a consumer is entitled to has a defined delivery meaning, and none
is silently undeliverable. Stop freezing: exactly one class per row as the classification
design, and the table's current membership.
Trace: `impl/src/wake-stream.mjs:120, 374-398`; tests
`impl/test/wake-stream.test.mjs:100, 291`.

**WAKE-8.** Keep: every subscribed, authorized event is delivered, including for groups created
after the subscription. Stop freezing: one deployment-wide feed as the topology.
Trace: `impl/src/wake-stream.mjs:697-717`; test `impl/test/wake-stream.test.mjs:145`.

**WAKE-12.** Keep: a paged read leaves the remainder available and processing continues; a bound
needs a physical derivation and must not truncate history (cutoff-audit row). Stop freezing: a
particular page ceiling.
Trace: `impl/src/wake-stream.mjs:617, 803-806`; tests
`impl/test/wake-mcp-consumers.test.mjs:232`, `impl/test/issue507-wakes-since-cli.test.mjs:117, 168`.

**PROP-1.** Keep: processing the whole history stays within bounded working memory. Stop
freezing: a read-window interface as the design.
Trace: `impl/src/application-observation.mjs:402`; `impl/src/limits.mjs:375-377`; tests
`impl/test/issue140-waiting-on-tail-read.test.mjs` (6 passing).

**PROP-3.** Keep: one coherent ordering authority per ledger. Stop freezing: an OS-writer count
of one; a serializable multi-writer implementation that keeps one order serves it.
Trace: `impl/test/phase42-policy-invalidation.test.mjs:137`;
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55, 89, 123`.

**LEDG-1.** Keep: accepted event history and its order survive. Stop freezing: one-based
contiguous indices as the storage representation.
Trace: `impl/src/coordination-ledger.mjs:1199`; `impl/src/coordination-replay.mjs:524`; test
`impl/test/phase11-coordination-store.test.mjs:204`.

**LEDG-2.** Keep: corrupted durable input is detected and reported truthfully. Stop freezing:
UTF-8 and the trailing newline as the detection form.
Trace: `impl/src/coordination-replay.mjs:464-466, 493-499`; test
`impl/test/phase11-coordination-store.test.mjs:204`.

**LEDG-6.** Keep: no durability claim after a failed persistence. Stop freezing:
flush-before-release as the implementation of safe completion.
Trace: `impl/src/coordination-ledger-writes.mjs:560-565`;
`impl/src/coordination-admission.mjs:208-216`; tests `impl/test/issue290-ledger-sync.test.mjs:22, 38, 47`.

**LEDG-7.** Keep: a failed projection never becomes trusted state and never destroys source
history; recovery must be established, not assumed from restart. Stop freezing: the poison flag,
and the claim that restart alone repairs.
Trace: `impl/src/coordination-ledger.mjs:1166-1167`;
`impl/src/coordination-admission.mjs:202-207`; tests
`impl/test/issue290-quarantine.test.mjs:30`, `impl/test/issue290-prospective-fold.test.mjs:63`.

**LEDG-8.** Keep: a replay failure is exposed with actionable provenance. Stop freezing: the
exact startup codes and record fields as versioned protocol.
Trace: `impl/src/coordination-ledger.mjs:151-169`; `impl/src/coordination-replay.mjs:537-548`;
test `impl/test/issue304-fold-admission-gate.test.mjs:16`.

**LEDG-10.** Keep: compaction preserves the accepted logical history. Stop freezing:
content-addressed segments and the particular rewrite order.
Trace: `impl/src/coordination-ledger-writes.mjs:600-689`; tests
`impl/test/ledger-compaction-223-red.test.mjs:71, 143`.

**LEDG-12.** Keep: no partially established authority is ever exposed. Stop freezing: one shared
sync/async open path as the code organization.
Trace: `impl/src/coordination-replay.mjs:501-515`; `impl/src/coordination-ledger.mjs:2314`;
tests `impl/test/phase11-coordination-store.test.mjs:220, 243`.

**LEDG-13.** Keep: a reference resolves consistently within an identified history, and an
unresolvable one is not silently invented. Stop freezing: the grammar table and the
null-on-failure convention as the interface.
Trace: `impl/src/coordination-ledger.mjs:52, 739-746`; tests
`impl/test/issue465-second-copies.test.mjs:221, 262, 166`.

**LEDG-19.** Keep: a cursor is validated against the relevant history's identity and range.
Stop freezing: head-only waiting as the subscription implementation.
Trace: `impl/src/coordination-ledger.mjs:3567, 5580`;
`impl/src/coordination-ledger-writes.mjs:761-769`; tests
`impl/test/evidence-search-deployment.test.mjs:89`,
`impl/test/coordination-ledger-writes.test.mjs:226`,
`impl/test/phase66-run-continuation-export.test.mjs:205`.

**CS-02.** Keep: every event kind admitted under a version has a defined payload schema, and
schema and event semantics cannot disagree within that version. Stop freezing: deriving both
from one declaration — a useful mechanism, not the law itself.
Trace: `impl/src/swarm-contract.mjs:51-57`; tests
`impl/test/swarm-event-schemas.test.mjs:32`, `impl/test/swarm-refusals.test.mjs:188`.

**CS-05.** Keep: malformed input crossing a boundary receives a structured refusal naming field,
rule and admitted values — and the refusal arm remains necessary at decoders even after internal
values are typed. Stop freezing: the exact message template and the table-derived list as
presentation, not law.
Trace: `impl/src/swarm-contract.mjs:886-894, 138-144`; tests
`impl/test/issue372-closed-sets-taught.test.mjs:33`,
`impl/test/issue373-read-only-recruit.test.mjs:151`.

**CS-16.** Keep: every refusal has one defined meaning with a consistent HTTP class and raiser,
so callers can program against refusals. Stop freezing: the single registry file and today's
exact code inventory as a frozen list; the vocabulary is versioned, the meaning-per-code property
is the law.
Trace: `impl/src/swarm-refusals.mjs:35-186, 203-207`; tests
`impl/test/issue430-swarm-refusal-set.test.mjs:215, 258, 267`.

**CS-19.** Keep: a landing receipt identifies the actual inputs, verdicts and effects it records
(exact base, target and squash ids, the real gate verdict, the target transition). Stop
freezing: the specific nullable fields and hash representation.
Trace: `impl/src/swarm-state.mjs:951-996`; fixtures
`impl/test/issue296-swarm-integrate.test.mjs:254`,
`impl/test/issue441c-situation-one-derivation.test.mjs:215`.

**AB-02.** Keep: a declared scope grants no authority beyond its admitted paths — no traversal,
no escape, and no fail-open on unreadable patterns; lexical rules are necessary and do not by
themselves establish filesystem confinement, which is a separate contract. Stop freezing: the
specific lexical shape list as the whole claim.
Trace: `impl/src/path-scope.mjs:5-8, 33-36`; mirror `impl/src/workflow-interpreter.mjs:206-210`;
tests `impl/test/workflow-as-data-red.test.mjs:596-599`,
`impl/test/phase83-context-runtime-red.test.mjs:24`.

**AB-03.** Keep: a claim names an unambiguous target. Stop freezing: list representation and
path-spelling details as subordinate design.
Trace: `impl/src/swarm-state.mjs:210-220`; test
`impl/test/issue423-claims-proposals-state.test.mjs:128, 131`.

**AB-06.** Keep: a hold moves only with valid authority and the move is one recorded transition
with no free window; authorized revocation and dead-holder recovery must be defined, not
inherited silently. Stop freezing: today's release and handoff shapes while those scopes are
missing.
Trace: `impl/src/swarm-state.mjs:1851-1876`; tests
`impl/test/issue423-claims-proposals-state.test.mjs:100`,
`impl/test/issue423-claims-and-peers.test.mjs:146-149, 161-163`.

**AB-08.** Keep: a declared scope is a visibility record and an exclusive hold is the only
conflict-bearing row; the two notions stay distinct. Stop freezing: the exact scan exemptions
and the variant encoding as mechanism.
Trace: `impl/src/swarm-state.mjs:1074, 1077`; test
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:117`.

**AB-12.** Keep: a mutating recruit carries its intended scope contract; a read-only recruit
claims nothing and nothing enlarges. Stop freezing: the 64-entry cap — it is in the
superseded-cutoff family and must go; duplicate rejection needs its own product justification,
not inheritance (cutoff-audit row).
Trace: `impl/src/swarm-runtime.mjs:691-711`; tests
`impl/test/issue474-recruit-preconditions-typed.test.mjs:215, 248, 273`.

**AB-13.** Keep: authority is authenticated and rechecked valid at the action boundary —
issue-time validity is not enough. Stop freezing: loopback-only transport as a deployment
policy, not a law.
Trace: `impl/src/swarm-native-bridge.mjs:357-358, 444-449`; tests
`impl/test/swarm-native-bridge.test.mjs:403, 520, 250`.

**PM-03.** Keep: every action has a defined authority requirement checked before any effect.
Stop freezing: exactly-one-permission-per-event — valid conjunctions of permissions may exist in
Baton2, so the mapping form is "defined requirement", not "single value".
Trace: `impl/src/swarm-runtime.mjs:1034-1056`. Test: none (load-time assert).

**PM-10.** Keep: review of a contribution is performed by an authority independent of the author
— independence of authority and execution, which unequal participant labels alone do not prove.
Stop freezing: the label-inequality check as sufficient; per finding 9 the inequality
proposition makes reviewer-distinct-from-author a proof-carrying candidate, with identity and
version binding still owed.
Trace: `impl/src/swarm-runtime.mjs:8648-8650`; tests
`impl/test/swarm-check-admission.test.mjs:76`, `impl/test/swarm-application.test.mjs:218`.

**CL-01.** Keep: a publish states explicitly which form it records — a contribution report is
machine-processable, a note is visible text, and no publish is ambiguous about which it is. Stop
freezing: the six-key heuristic as the definition of claiming.
Trace: `impl/src/contribution-contract.mjs:122-130, 33`; test
`impl/test/issue310-contribution-contract.test.mjs:110`.

**CL-04.** Keep: a publish reports uncaptured work truthfully — the receipt's status reflects
the checkout state at publish. Stop freezing: the particular commit-null stamp and receipt
vocabulary as frozen.
Trace: `impl/src/swarm-runtime.mjs:2318-2324`; test
`impl/test/issue310-contribution-contract.test.mjs:146`.

**CL-06.** Keep: the landing decision is a total function of the recorded review history — no
hidden state, comments never settle. Stop freezing: last-accept-wins as THE resolution — that is
a policy the operator chooses with a named consequence: the alternative (landing blocked while
any reject is unsettled) changes revision-and-re-review flows. The class is agreed; the decision
is flagged, not disputed.
Trace: `impl/src/swarm-runtime.mjs:1359-1364`; test
`impl/test/issue433-contributions-projection.test.mjs:92`.

**CL-10.** Keep: nothing records a landing when no change occurred — a truthful no-op. Stop
freezing: the bundling — the empty-arm refusal and the scratch-checkout cleanup are separate
lifecycle contracts, and the diff carrier establishes only the empty/changed distinction, not
the cleanup (finding 7).
Trace: `impl/src/worktree.mjs:2294-2297`; related pin
`impl/test/issue451-integrate-dependency-link.test.mjs:232-236`.

**CL-14.** Keep: three separate properties, each with its own obligation — at-most-once
landing; truthful attribution; replay agreement. Stop freezing: the single-row bundling.
Correction recorded: byte-identical replay over a specified pure codec admits an equality
theorem (finding 9); actual filesystem bytes and host effects remain boundary obligations.
Trace: `impl/src/swarm-state.mjs:2270-2304`; tests
`impl/test/issue296-swarm-integrate.test.mjs:367, 349`.

**DEV-1.** Keep: valid work is preserved across arbitrary elapsed time or input volume;
legitimate refusal, explicit cancellation and physical exhaustion are distinguished and each
stated. Stop freezing: conflating those with arbitrary cutoffs — and reconciling with the rows
that propose retaining bounds (cutoff audit).
Trace: ruling commit `bc2e4fcd`; `docs/bend2/MANDATE.md` §3; enforcement CAP-2, CAP-3, CAP-5.

**DEV-2.** Keep: the command records its durable intent before the acknowledgment, and
execution happens after the receipt without holding the request — literal instantaneous response
is not the contract (finding 5). Stop freezing: the receipt-record shape as the proof; the
obligation is expressed through a transition/effect model with the executor's contract
demonstrated, and physical persistence stays a host-effect assumption with failure-injection
evidence.
Trace: rulings #529 (`30cdb282`, `84357e4b`) and #543 (`25856479`); `docs/54-native-wake.md:1-27`;
enforcement WAKE-10.

**DEV-3.** Keep: agent progress never depends on invoking or re-arming a watcher; optional
history inspection remains a valid feature. Stop freezing: the missing-fetch-verb argument —
absence of a verb does not prove delivery (finding 5); the obligation is delivery at the
boundary.
Trace: `docs/54-native-wake.md:1-7`; rulings #529, #543; `docs/bend2/MANDATE.md` §3.

**DEV-5.** Keep: accepted changes are gated on required evidence and independent review. Stop
freezing: red-first chronology and exclusive publication bundled into one claim — each needs its
own development control (finding 5); the acceptance-value carrier alone does not establish
them.
Trace: `docs/bend2/MANDATE.md` "Deliverable form"; `CONTRIBUTING.md` steps 4-5;
`docs/42-suite-legitimacy.md:112-115`; rulings #539; enforcement CL-06, CL-08, CL-13.

---

## Part C — Policy rows (29): not law candidates without independent justification

These are product, deployment or development choices. Any of them can still be chosen as a
permanent law by the operator; choosing one requires the stated justification, not the class
mark.

**CAP-4.** Decision needed: budgeting only full suites is a workload policy, and the extraction
was wrong — the charge is a host-derived memory share (`coreShareBytes = floor(totalBytes /
cores)` times `suiteCores`), not a measured suite footprint (finding 10; ledger-lane
disagreement 1, conceding its own row overstated the source). Keep, if chosen: a verification is
admitted only when the host can actually fund it, and the charge reflects the run's real cost.
Trace: `impl/src/host-capacity.mjs:237, 249-267`; test
`impl/test/issue297-issue307-host-capacity.test.mjs:77`.

**CAP-5.** Decision needed: proceeding without a lease on an undersized host is a chosen
fallback with operation-specific justification. Keep, if chosen: the host states the shortfall
and the work proceeds with the risk named.
Trace: `impl/src/host-capacity.mjs:725-727, 756`; test
`impl/test/issue333-suite-verify-lease.test.mjs:77`.

**CAP-10.** Decision needed: one shed per exhaustion episode is a recovery policy; a different
workload may need a different response. Keep, if chosen: an exhaustion response is bounded and
recorded so it cannot become a silent loop.
Trace: `impl/src/host-capacity.mjs:305, 66`; tests
`impl/test/issue495-post-admission-shed.test.mjs:136, 162, 342`.

**CAP-11.** Decision needed: parallel width from load thresholds and environment overrides is
tunable scheduling. Keep, if chosen: the width is derived from what the host can fund and stated
before work starts.
Trace: `impl/src/host-capacity.mjs:345-347`; tests
`impl/test/issue424-seat-suite-lease.test.mjs:138`,
`impl/test/issue297-issue307-host-capacity.test.mjs:223`.

**CAP-17.** Decision needed (ledger-lane disagreement 4, going further than Codex): a ceiling
that defers or refuses worker work is the same class of control #541 removed for load. Either
retire it, or carry it as an explicitly stated operator exception with its justification — not
as a law on the strength of being configurable (cutoff-audit row).
Trace: `impl/src/concurrency-policy.mjs:15-25`; tests
`impl/test/concurrency-policy-admission.test.mjs:148, 182, 218, 294`.

**WAKE-2.** Keep: an unknown filter token refuses, naming the admitted set — it never silently
matches nothing. Stop freezing: the alias table and today's vocabulary as a versioned interface.
Trace: `impl/src/wake-stream.mjs:340-364, 455-474`; tests
`impl/test/wake-stream.test.mjs:128`, `impl/test/wake-mcp-consumers.test.mjs:253`.

**WAKE-4.** Keep: a subscription's starting point is stated and honored. Stop freezing: start
at head as the default; a first participant may need history from group creation.
Trace: `impl/src/wake-stream.mjs:763`; test `impl/test/wake-stream.test.mjs:145`.

**WAKE-6.** Keep: a consumer attaching to a standing fault learns the fault is present. Stop
freezing: attach-baseline and crossing as per-signal subscription semantics.
Trace: `impl/src/wake-stream.mjs:342, 741-750`; test `impl/test/wake-stream.test.mjs:248`.

**WAKE-7.** Keep (ledger-lane disagreement 5, behavioral half): one attachment end is reported
once and consistently across transports, so a consumer cannot act twice on one end. Stop
freezing: today's vocabulary and fallback mapping — the consistency is the guarantee, the words
are policy.
Trace: `impl/src/wake-stream.mjs:36-81`; tests
`impl/test/issue356-wake-frame.test.mjs:221, 275, 300, 319`.

**WAKE-9.** Keep: a wake frame identifies what changed and who acted, and asserts nothing it did
not verify. Stop freezing: metadata-only as the design; including verified content may be a
valid later design.
Trace: `impl/src/wake-stream.mjs:531, 488, 99-112`; tests
`impl/test/wake-stream.test.mjs:276, 345`.

**WAKE-11.** Keep (ledger-lane disagreement 5, behavioral half): within one pull, every frame
reports the same observation, so a consumer cannot act on two different facts from one page.
Stop freezing: the commit-header cadence and the fallback value as observation policy.
Trace: `impl/src/wake-stream.mjs:678-684`; test
`impl/test/issue316-provider-degraded.test.mjs:624`.

**CS-01.** Keep: every event in a durable history validates against the schema version it was
admitted under, with construction typed against that declared version. Stop freezing: exactly
thirteen kinds as a permanent bound — vocabulary growth is a versioned protocol decision.
Trace: `impl/src/swarm-contract.mjs:10-29`; tests
`impl/test/swarm-state.test.mjs:92`, `impl/test/issue372-closed-sets-taught.test.mjs:33`.

**CS-08.** Decision needed: which publish forms are admissible at the contribution boundary and
what a document-shaped note means. If approved, the cited justification is the recorded incident
(a reader enumerated a twice-encoded report character by character) and the narrower boundary
(only the contribution-recorded path, where the ambiguity changes what is stored).
Trace: `impl/src/swarm-contract.mjs:563-588, 902-909, 947-952`; test
`impl/test/issue481-string-body-refused.test.mjs:181`.

**CS-09.** Keep: a projection returns the slice its name documents and always keeps the frame.
Stop freezing: the closed name list as a versioned query API.
Trace: `impl/src/swarm-contract.mjs:89-115, 146-152`; tests
`impl/test/swarm-view-slices.test.mjs:94, 136-139, 157`.

**CS-10.** Keep: read-only admission preserves the admitted write authority (the enduring
property; AB-10 carries it). Stop freezing: the exact two-mode vocabulary.
Trace: `impl/src/swarm-contract.mjs:123, 639-642`; test
`impl/test/issue373-read-only-recruit.test.mjs:151`.

**CS-11.** Keep: a guide's delivery priority is explicit and each priority's delivery semantics
is defined. Stop freezing: the two-value vocabulary as a scheduling interface choice.
Trace: `impl/src/swarm-contract.mjs:132, 645-648`; test
`impl/test/issue273-guidance-runtime.test.mjs:168`.

**CS-12.** Keep: lifecycle transitions are stated and provable, with boundary decoders keeping
typed refusals for out-of-vocabulary values. Stop freezing: today's value lists frozen forever.
Trace: `impl/src/swarm-state.mjs:92-94, 510-512, 894-896`; tests
`impl/test/swarm-state.test.mjs:165, 172, 179`.

**CS-13.** Decision needed: whether a no-op policy update is refused, and whether the
seven-variant encoding is used. Stop freezing: both as law without a product reason.
Trace: `impl/src/swarm-state.mjs:766-790`; test
`impl/test/issue443-reroute-on-provider-fault.test.mjs:229`.

**CS-14.** Decision needed: the exclusivity of work-item-versus-path claims — a combined claim
needs a product reason to be impossible. Keep: a claim has an unambiguous target.
Trace: `impl/src/swarm-state.mjs:659-666, 210-220`; test
`impl/test/issue423-claims-proposals-state.test.mjs:128`.

**CS-18.** Keep: item status states delivery truth — landing's own reader consumes
delivered-only, and that dependency is the guarantee to keep. Stop freezing: exactly three
statuses.
Trace: `impl/src/contribution-contract.mjs:29, 200-202`; test
`impl/test/issue310-contribution-contract.test.mjs:164`.

**PM-01.** Keep: grants draw from a declared, versioned permission vocabulary, with boundary
decoders returning typed refusals for out-of-vocabulary values. Stop freezing: exactly seven
permissions as a permanent capability bound.
Trace: `impl/src/swarm-runtime.mjs:1032, 7927-7929`; test
`impl/test/issue314-mcp-core-surface-red.test.mjs:144`.

**PM-02.** Keep: a seat recruited without an explicit grant has a defined, documented default
authority — defaults are explicit, never ambient. Stop freezing: the specific three-grant set.
Trace: `impl/src/swarm-runtime.mjs:1033`; `impl/src/swarm-state.mjs:1301-1303`; test
`impl/test/issue310-contribution-contract.test.mjs:91`.

**PM-04.** Keep: every command's required authority is defined and consistent between dispatch
and advertisement. Stop freezing: today's command-to-permission mappings as an immutable list.
Trace: `impl/src/swarm-runtime.mjs:1057-1067`; test
`impl/test/swarm-native-bridge.test.mjs:312`.

**PM-06.** Keep: the holder/other distinction — a seat acts on its own rows without organize
authority and cannot act on another seat's row uninvited. Stop freezing: the specific per-event
assignments, each needing its own justification.
Trace: `impl/src/swarm-runtime.mjs:1988-2010`; tests
`impl/test/issue423-claims-and-peers.test.mjs:146-149`.

**PM-09.** Keep: every participant verb names its permission and identity fields in one
admission row, and the advertised rows derive from it. Stop freezing: today's verb set and
assignments as frozen — they evolve under a versioned policy contract.
Trace: `impl/src/swarm-contract.mjs:192-241`; test `impl/test/swarm-knowledge.test.mjs:158`.

**CL-11.** Keep: an unapproved overwrite of an already-landed change is prevented — that is the
law candidate. Stop freezing: the blanket path-overlap refusal, which also rejects valid
sequential work on the same files; overlap detection is a policy heuristic in service of the
guarantee.
Trace: `impl/src/swarm-runtime.mjs:7297-7298`; test
`impl/test/issue296-swarm-integrate.test.mjs:247`.

**CL-16.** Decision needed: a seat is never admitted on instructions whose own worked example
contradicts the contribution contract. The objective is free prose by design and the scan is the
only pre-admission boundary check short of restructuring objectives; the recorded incident (a
seat hit the refusal thirteen times) is the concrete failure. Stop freezing: the prose-scan
mechanism as a permanent law.
Trace: `impl/src/contribution-contract.mjs:348-378`; tests
`impl/test/issue502-brief-contract-guard.test.mjs:109, 153`.

**DEV-6.** Decision needed: "whole scope and full authority" needs precise meanings that do not
prohibit useful task decomposition or require global authority. Keep, if chosen with those
meanings: incomplete assignments and authority gaps are surfaced before admission.
Trace: `docs/bend2/MANDATE.md` §3; `docs/39-swarm-runtime.md:1175-1178`.

**DEV-7.** Decision needed: plain technical English is a project writing rule enforced by
review; it is a policy about prose, not a Bend proof over runtime behavior.
Trace: `AGENTS.md` at the repository root.

---

## Part D — Implementation rows (20): preserve the behavior, unfreeze the mechanism

**CUST-9.** Keep: a lane workspace is isolated from other lanes' concurrent work. Unfreeze:
shared refs and object store; clones or snapshots may serve.
Trace: `impl/src/worktree.mjs:1434-1439`; tests
`impl/test/issue412-worktree-non-isolation.test.mjs:47, 56`.

**CUST-10.** Keep: work named only by a lane branch survives a removal boundary. Unfreeze:
branch-moving as the one preservation method.
Trace: `impl/src/worktree.mjs:1892-1943`; tests
`impl/test/issue428-worktree-custody-on-stop.test.mjs:236, 198, 328`.

**CUST-12.** Keep: every custody consumer reaches the same determination. Unfreeze: one named
function; agreement can be a theorem over two computations.
Trace: `impl/src/worktree.mjs:1300, 1324, 2946-2949`; tests
`impl/test/shared-workspace-custody.test.mjs:513, 532`.

**CAP-9.** Keep: a reported queue row is accurate about its holder's liveness. Unfreeze:
sweeping during a read as the housekeeping design.
Trace: `impl/src/host-capacity.mjs:319, 687-691`; tests
`impl/test/issue506-queue-holder-liveness.test.mjs:52, 79`.

**CAP-16.** Keep: the summary and the wake report the same pressure determination. Unfreeze:
one named predicate as the organization — agreement is the property.
Trace: `impl/src/worktree-capacity.mjs:177`; tests
`impl/test/issue297-issue307-host-capacity.test.mjs:359`,
`impl/test/wake-stream.test.mjs:248`.

**WAKE-10.** Keep: a push consumer receives every frame it is entitled to, and the wait reports
progress. Unfreeze: parking on one ledger primitive as the implementation.
Trace: `impl/src/wake-stream.mjs:813-828`;
`impl/src/coordination-ledger-writes.mjs:761`; tests
`impl/test/coordination-ledger-writes.test.mjs:226`,
`impl/test/issue316-sse-attachment-closed.test.mjs`, `impl/test/issue468-stream-errors.test.mjs`.

**WAKE-13.** Keep: a transport's clients cannot send frames the server would misread, and
protocol failures are reported truthfully. Unfreeze: WebSocket masking and the current close
codes; Baton2 may use other transports.
Trace: `impl/src/wake-stream.mjs:1018-1058`; test
`impl/test/wake-binding.test.mjs:55`.

**LEDG-5.** Keep: exclusive write ownership with a bounded fail-closed attempt. Unfreeze:
short-lived claim receipts as the exclusion protocol.
Trace: `impl/src/coordination-ledger-writes.mjs:502-530`; tests
`impl/test/phase42-policy-invalidation.test.mjs:137`.

**LEDG-9.** Keep: corruption evidence is preserved rather than destroyed. Unfreeze: temp-file,
rename and private-mode as the implementation.
Trace: `impl/src/coordination-ledger.mjs:103-123`; tests
`impl/test/issue290-quarantine.test.mjs:72, 120`.

**LEDG-11.** Keep: a checkpoint is derived state that can never override the ledger. Unfreeze:
coalescing and off-request scheduling as performance choices.
Trace: `impl/src/coordination-ledger.mjs:897-905, 1217-1234`; tests
`impl/test/issue366-run-stop-replay-ceiling.test.mjs:361`,
`impl/test/issue351-startup-answer.test.mjs:366`.

**LEDG-14.** Keep: a scan completes over the whole history within bounded memory. Unfreeze: the
literal 256 as a domain constant — it is tuning and needs a stated reason if kept (cutoff-audit
row).
Trace: `impl/src/application-observation.mjs:402-419`; tests
`impl/test/issue140-waiting-on-tail-read.test.mjs:105, 132, 173`.

**LEDG-18.** Keep: session state survives a restart with its integrity checked. Unfreeze: a
second ledger and its byte format, while the target proposes a partitioned journal.
Trace: `impl/src/web-auth.mjs:70-98`; tests
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55, 89, 123`.

**CS-04.** Keep: every command has a declared retry identity, stated per verb and consistent
across surfaces. Unfreeze: the specific two-verb omission as a law.
Trace: `impl/src/swarm-contract.mjs:864-868`; test
`impl/test/swarm-native-bridge.test.mjs:948`.

**CS-15.** Keep: an accepted proposal expands into exactly the rows it named, deterministically.
Unfreeze: exactly the two fields as the permanent plan shape.
Trace: `impl/src/swarm-state.mjs:289-315`; test
`impl/test/issue423-claims-proposals-state.test.mjs:230`.

**CS-20.** Keep: shipped examples are valid under the contract they teach. Unfreeze: the
load-check tooling as a domain law — it is development tooling and belongs in the
development-governance design.
Trace: `impl/src/swarm-event-schemas.mjs:490-509`; tests
`impl/test/swarm-event-schemas.test.mjs:46, 54, 111`.

**AB-01.** Keep: scope matching is total, deterministic and repository-relative — every path has
exactly one answer, and nothing fail-opens. Unfreeze: the one glob dialect.
Trace: `impl/src/path-scope.mjs:5-31`; test
`impl/test/phase83-context-runtime-red.test.mjs:24`.

**AB-07.** Keep: the scope's recorded hold names its true provenance — written by the recruit
effect, never misattributed. Unfreeze: the reserved-prefix recording strategy as the mechanism.
Trace: `impl/src/swarm-runtime.mjs:8424-8428`; test
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:85`.

**PM-05.** Keep: advertised authority and enforced authority agree. Unfreeze: one shared
function as the required mechanism — per finding 6, agreement can equally be a theorem over two
specified computations; both routes are admissible, the agreement is the law.
Trace: `impl/src/swarm-runtime.mjs:1984-2013, 4516-4523`; test
`impl/test/swarm-view-slices.test.mjs:168`.

**CL-09.** Keep: landing preserves the accepted, verified change onto the target — nothing
verified is lost or silently altered. Unfreeze: one squashed commit as the frozen integration
form; rebase, merge or cherry-pick transports remain valid.
Trace: `impl/src/worktree.mjs:2196-2233`; tests
`impl/test/issue296-swarm-integrate.test.mjs:208, 378`.

**CL-12.** Keep: the gate run covers every gate the approved verification policy requires for
the changed paths — selection completeness is the guarantee, and the returned set alone certifies
nothing (finding 7). Unfreeze: the specific path/import-graph derivation as the frozen strategy.
Trace: `impl/src/swarm-runtime.mjs:7463-7483`; `impl/src/landing-table.mjs:160-210`; tests
`impl/test/issue466-landing-selection.test.mjs:298, 239`,
`impl/test/issue463-integrate-gate-paths.test.mjs:330`.

---

## Part E — Retired (1 row)

**WAKE-5 — retired as a target law.** The row's extraction was accurate: the implementation at
`impl/src/wake-stream.mjs:766-773` really drops recorded wake events past the replay bound, and
a test pins that behavior. It is retired because the behavior conflicts with the landed
no-cutoff ruling (#541): a consumer further behind than any replay bound is served the remaining
recorded history from its cursor, so no recorded event is lost to a slow reader. The consolidated
guarantee lives in CX-5 (lossless cursor-based delivery) together with WAKE-3; the lag-and-drop
shape must not be frozen. A typed marker remains acceptable only as a progress notice alongside
complete delivery, never as the delivery's boundary.
Trace: `impl/src/wake-stream.mjs:766-773`; test
`impl/test/wake-mcp-consumers.test.mjs:198, 209`.

---

## Part F — Evidence tasks (4 rows): work items, not laws

**PR-02.** Validation work for AB-02's runtime arm — folded into AB-02's evidence obligations in
the revision. Not a law.
Trace: `impl/src/path-scope.mjs:5-8, 33-36`;
`impl/test/phase83-context-runtime-red.test.mjs:24`.

**PR-03.** Pinning work for PM-01's refusal arm, PM-03's load assert and PM-08. PM-08's task
becomes a checked subset-witness example rather than a test pin, per its proof-carrying carrier.
Trace: `impl/src/swarm-runtime.mjs:7927-7932, 1034-1056`.

**PR-04.** Pinning work for CS-19, CL-10's empty arm and CL-13's race. CS-19 and CL-10 are
superseded by their carriers once landed; the CL-13 race gap remains open as runtime evidence.
Trace: `impl/src/swarm-state.mjs:951-996`; `impl/src/worktree.mjs:2294-2297, 2340-2348`.

**PR-05.** A validation task for CS-16's construction-time guard; superseded in proof form once
the refusal variant makes an undeclared code unwritable.
Trace: `impl/src/swarm-refusals.mjs:203-207`; current guard
`impl/test/issue430-swarm-refusal-set.test.mjs:215`.

---

## Counts (this revision)

Candidates 38 · Split 46 · Policy 29 · Implementation 20 · Retire 1 · Evidence tasks 4 —
138 rows accounted for. The classes are Codex's first-pass assessment; they are not an approval
tally, and no row is approved by this document.

Verification: every trace above was anchor-checked at extraction base `bc2e4fcd` (files exist,
lines in range, quoted test names present — all 131 inventory rows hold; WAKE-5's trace is
retained as historical record). Disagreements between the lanes and the reviewer are recorded in
the entries, not silently resolved: the ledger lane's six statements (CAP-4 extraction
correction, the second-predicate acceptance, the CAP-15 mechanism split as adjudicated, the
CAP-17 retirement recommendation, the WAKE-7/WAKE-11/CAP-8 behavioral halves, and the
provenance-versus-codomain method) and the orchestrator's own standing note that the pinned
guide's unforgeability guarantee is scoped to Base's opaque handle types.

Every carrier named for a Candidate row is a proposal to pin: per the evidence convention, each
needs a compiled, run example under `docs/bend2/examples/laws-*` citing the pinned reference
before `laws.bend` claims it. Still no laws.bend entries and no rewrite implementation: this
document is the pre-approval register.

---

## The reduction record (revision 5 table, carried with the review repairs)

Verdict precedence for mechanical counting: a row is rejected if its verdict contains
"rejected", else reduced if it contains "reduced", else kept. Repairs applied per the r5
review: CAP-3 now points at the adopted narrow abandonment entry; CS-02 and LEDG-17 name their
surviving homes. Mechanical count after repairs: kept 47, reduced 29, rejected 57, retired 1,
evidence block 1 — 135 rows, each accounted for.

| CUST-1 | kept → M-4 | passes |
| CUST-2 | kept → M-4 | passes |
| CUST-3 | reduced → M-4 scope note | failed Q3: one authoritative determination is required; the live-handle registry is an implementation |
| CUST-4 | kept → M-4 | passes |
| CUST-5 | kept → M-4 | passes |
| CUST-6 | reduced → M-4 | failed Q3: the evidence requirement is the law; the metadata and path rules are one mechanism |
| CUST-7 | reduced → M-4 | failed Q3: protection follows ownership, not one folder name |
| CUST-8 | kept → M-7 | passes |
| CUST-9 | rejected | failed Q1: a workspace-representation property, not a forbidden behavior |
| CUST-10 | rejected | failed Q3: branch-moving is one preservation method |
| CUST-11 | reduced → M-4 | failed Q3: custody-before-effects is the law; the receipt mechanism is not |
| CUST-12 | rejected | failed Q3/independence: agreement is a theorem or a routing choice, not a prohibition |
| CAP-1 | reduced → M-10 | failed Q3: derivation honesty is required; the formula is not |
| CAP-2 | reduced → M-10 | failed independence: carried by the no-cutoff entry |
| CAP-3 | reduced → M-10 and M-17 (narrow abandonment, adopted in revision 6) | failed Q3: FIFO is policy; the durable hold and admission-on-release are the guarantees |
| CAP-4 | rejected (policy) | failed Q2: a workload choice, and the extraction overstated the source (derived share, not measured cost) |
| CAP-5 | rejected (policy) | failed Q2: a chosen fallback with operation-specific justification |
| CAP-6 | kept → M-2 | passes |
| CAP-7 | kept → the exact-instance clause of the authority boundary (M-8 in revision 6) | passes |
| CAP-8 | reduced → M-10 | failed Q3: the closed shape is construction hygiene; the byte ceiling is an unjustified cutoff |
| CAP-9 | rejected | failed Q1: housekeeping design, not a forbidden behavior |
| CAP-10 | rejected (policy) | failed Q2: one recovery response among possible ones |
| CAP-11 | rejected (policy) | failed Q2: tunable scheduling |
| CAP-12 | kept → M-8 | passes |
| CAP-13 | rejected | failed Q3: exclusive accounting is required; the seal, root and lock are mechanisms |
| CAP-14 | kept → the exact-instance clause of the authority boundary (M-8 in revision 6) | passes |
| CAP-15 | reduced → M-10 | failed Q3: the terminal refusal dies under the no-cutoff ruling; the bounded queue survives (adjudicated wording) |
| CAP-16 | rejected | failed Q3/independence: agreement is the property, one predicate is an organization |
| CAP-17 | rejected (policy) | failed Q6: conflicts with the no-cutoff ruling; retire or state as an operator exception |
| WAKE-1 | rejected | failed Q3: defined delivery meaning is required; the one-class-per-row design is not the law |
| WAKE-2 | rejected (policy) | failed Q3: truthful refusal of unknown filters kept at the decoder; the vocabulary is versioned |
| WAKE-3 | kept → M-5 | passes |
| WAKE-4 | rejected (policy) | failed Q3: a stated default, not a universal one |
| WAKE-5 | RETIRED | conflicts with the #541 ruling (dropping recorded events from a slow reader) |
| WAKE-6 | rejected (policy) | failed Q3: per-signal subscription semantics |
| WAKE-7 | rejected (policy) | failed Q3: the consistency half is noted in the design notes; the vocabulary is policy |
| WAKE-8 | kept → M-13 | passes |
| WAKE-9 | rejected (policy) | failed Q3: metadata-only is one design; verified content may be valid later |
| WAKE-10 | rejected | failed Q3: one push implementation among possible ones |
| WAKE-11 | rejected (policy) | failed Q3: the once-per-pull consistency half is noted; the cadence is policy |
| WAKE-12 | reduced → M-10 | failed Q3: continuation is the guarantee; the ceiling needs physical derivation |
| WAKE-13 | rejected | failed Q3: transport conformance; Baton2 may use other transports |
| PROP-1 | reduced → M-10 | failed independence: bounded processing is carried by the no-cutoff entry |
| PROP-2 | kept → M-5 | passes |
| PROP-3 | reduced → M-4 scope | failed Q3: one ordering authority is required; the writer count is not |
| LEDG-1 | kept → M-5 | passes |
| LEDG-2 | rejected | failed Q3: detection is required; UTF-8 and newlines are codec choices |
| LEDG-3 | kept → M-1 | passes |
| LEDG-4 | kept → M-2 | passes |
| LEDG-5 | rejected | failed Q3: one exclusion protocol among possible ones |
| LEDG-6 | kept → M-1 and M-12 | passes |
| LEDG-7 | kept → M-5 | passes |
| LEDG-8 | rejected (policy) | failed Q3: actionable provenance is required; the codes and fields are versioned protocol |
| LEDG-9 | rejected | failed Q3: evidence preservation is required; the write pattern is one implementation |
| LEDG-10 | kept → M-5 | passes |
| LEDG-11 | rejected | failed Q3: checkpoints are derived state; coalescing is performance |
| LEDG-12 | kept → M-5 | passes |
| LEDG-13 | rejected | failed Q3: consistent resolution is required; the grammar table is an interface |
| LEDG-14 | rejected | failed Q3: bounded memory is required; the literal 256 is tuning |
| LEDG-15 | kept → M-3a (the stale-evidence prohibition; the gate-purity mechanism stays in these notes) | passes |
| LEDG-16 | kept → M-5 | passes |
| LEDG-17 | rejected | failed independence: carried by the interface clause of the authority boundary (M-7/M-8 in revision 6); returns if Codex shows an uncovered failure |
| LEDG-18 | rejected | failed Q3: session integrity is required; the second ledger and byte format are mechanisms |
| LEDG-19 | reduced → M-5 | failed Q3: cursor validation is the guarantee; head-only waiting is an implementation |
| CS-01 | rejected (policy) | failed Q2: thirteen kinds is today's vocabulary, not a permanent bound |
| CS-02 | reduced → boundary-decoder obligations; the associated flagged entry was withdrawn | failed independence |
| CS-03 | reduced → boundary-decoder obligation of M-1/M-7 | failed Q3: decode-before-effect is an implementation order |
| CS-04 | rejected | failed Q3: declared retry identity is required; the two-verb list is one encoding |
| CS-05 | reduced → M-14 | failed Q3: the structured refusal is the law; the template is presentation |
| CS-06 | reduced → boundary-decoder obligation of M-1/M-7 | failed Q3, as CS-03 |
| CS-07 | reduced → boundary-decoder obligation of M-7 | failed Q3, as CS-03 |
| CS-08 | rejected (policy) | failed Q2: a boundary decision owed, with the recorded incident as the justification |
| CS-09 | rejected (policy) | failed Q3: a versioned query API |
| CS-10 | reduced → M-8 | failed independence: read-only preservation carried by the enlargement ban |
| CS-11 | rejected (policy) | failed Q3: a scheduling interface choice |
| CS-12 | rejected (policy) | failed Q3: prove the transitions; do not freeze the lists |
| CS-13 | rejected (policy) | failed Q2: product choices need a reason |
| CS-14 | rejected (policy) | failed Q2: exclusivity needs a product reason to be impossible |
| CS-15 | rejected | failed Q3: the two-field plan encodes today's API |
| CS-16 | reduced → M-14 | failed Q3: meaning-per-code is the law; the registry inventory is versioned |
| CS-17 | kept → M-3 | passes |
| CS-18 | rejected (policy) | failed Q2: three statuses constrain future reporting without proving correctness |
| CS-19 | kept → M-1 and M-3 | passes |
| CS-20 | rejected | failed Q1: development tooling, not a domain behavior |
| AB-01 | rejected | failed Q3: total deterministic matching is required; the glob dialect is one representation |
| AB-02 | reduced → M-8 scope | failed Q3: lexical rules are necessary and do not establish containment |
| AB-03 | rejected | failed Q3: unambiguous targets are required; the list form is subordinate |
| AB-04 | kept → M-8 (absorbed with M-9) | passes |
| AB-05 | reduced → M-7 and the exact-instance clause of the authority boundary (M-8 in revision 6) | failed independence: carried by the binding entries |
| AB-06 | reduced → M-8 | failed Q4: valid-authority transfer is the law; revocation and recovery scopes are owed |
| AB-07 | rejected | failed Q3: truthful provenance is required; the reserved-prefix strategy is a recording choice |
| AB-08 | rejected | failed Q3: the distinction is required; the exemptions are mechanism |
| AB-09 | kept → M-7 | passes |
| AB-10 | kept → M-8 | passes |
| AB-11 | kept → M-8 | passes |
| AB-12 | reduced → M-10 and M-8 | failed Q6: the 64-entry cap is a superseded cutoff; duplicate rejection needs its own reason |
| AB-13 | reduced → M-7 (boundary recheck) | failed Q3: loopback-only is deployment policy |
| AB-14 | kept → M-7 | passes |
| PM-01 | rejected (policy) | failed Q2: today's vocabulary, not a permanent capability bound |
| PM-02 | rejected (policy) | failed Q3: defaults are policy; explicitness is the property |
| PM-03 | rejected (policy) | failed Q3: defined requirement per action; single-value may prohibit valid conjunctions |
| PM-04 | rejected (policy) | failed Q3: today's mappings are reviewed policy |
| PM-05 | rejected | failed independence: agreement is the law; one shared function is one way (finding 6) |
| PM-06 | rejected (policy) | failed Q2: per-operation justification owed |
| PM-07 | reduced → M-7 | failed Q4: membership currency is part of authority validity |
| PM-08 | kept → M-8 | passes |
| PM-09 | rejected (policy) | failed Q3: the table evolves under a versioned policy contract |
| PM-10 | reduced → the independence premise of the publication-evidence entry; the inequality-proposition route is owed | failed Q3: independence of authority is the guarantee; label inequality is not proof — the inequality proposition route is owed |
| PM-11 | kept → M-7 | passes |
| CL-01 | rejected (policy) | failed Q3: explicit form is required; the six-key heuristic is compatibility |
| CL-02 | kept → M-7 | passes |
| CL-03 | kept → M-3 | passes |
| CL-04 | rejected (policy) | failed Q3: truthful status is required; the stamp vocabulary is not frozen |
| CL-05 | kept → M-3 | passes |
| CL-06 | rejected (policy) | failed Q2: last-accept-wins is a resolution policy with a named alternative |
| CL-07 | kept → M-3 and M-5 | passes |
| CL-08 | kept → M-3 | passes |
| CL-09 | rejected | failed Q3: preservation of the approved change is the contract; one squash commit is a strategy |
| CL-10 | kept → M-3 | passes |
| CL-11 | rejected (policy) | failed Q3: overwrite protection is the guarantee; blanket overlap refusal rejects valid work |
| CL-12 | reduced → M-3 | failed Q3: required-gate coverage is the guarantee; the derivation is a strategy |
| CL-13 | kept → M-3 | passes |
| CL-14 | reduced → M-2 and M-3 | failed independence: three separate properties, each carried |
| CL-15 | kept → M-3 | passes |
| CL-16 | rejected (policy) | failed Q2: prose scanning needs its incident-based justification |
| CL-17 | kept → M-11 | passes |
| PR-01 | kept → M-8 | passes |
| PR-02..PR-05 | evidence tasks | unchanged — work items in `laws-design-notes.md` |
| DEV-1 | kept → M-10 | passes (operator ruling) |
| DEV-2 | kept → M-1 and M-12 | passes (operator ruling) |
| DEV-3 | kept → M-13 | passes (operator ruling) |
| DEV-4 | kept → M-14 | passes (operator ruling) |
| DEV-5 | kept → M-3 | passes (operator ruling; chronology and exclusive publication split into development controls) |
| DEV-6 | kept → M-15 — superseded: deferred (the instruction is preserved above) | passes (operator ruling; precise meanings owed) |
| DEV-7 | kept → M-16 — superseded: excluded (AGENTS.md owns the prose rule) | passes (operator ruling) |

Family verdicts: CX-1 → reduced to M-1 · CX-2 → kept as M-2 · CX-3 → reduced to M-3 · CX-4 →
rejected, failed independence (its divergence ban restates M-7 and M-8 applied per interface;
returns as its own entry if Codex shows an uncovered failure) · CX-5 → split into M-5 and M-10 ·
CX-6 → split: the continuation prohibition was rejected here as a positive obligation [SUPERSEDED
2026-09-22: Codex's r5/r8 reviews disproved that reasoning — the counterexample escapes M-10 and
M-12 — and the narrow prohibition was incorporated into the candidate set as M-17 (no silent
abandonment of accepted, unsettled work); the ready-work half remains design guidance], both
recorded in `laws-design-notes.md`.

Family verdicts (carried): CX-1 reduced to the receipt/intent entry · CX-2 kept as the
uncertainty entry · CX-3 reduced to the publication-evidence entry · CX-4 rejected, its full
theorem in the design notes above · CX-5 split into the history-preservation and no-cutoff
entries · CX-6 split, the narrow no-silent-abandonment prohibition adopted in revision 6 and
the ready-work half recorded here as design guidance.

Reference closure for withdrawn or renumbered marks: M-6 → the exact-instance clause of the
authority boundary (M-8 in revision 6); M-3 → M-3a, M-3b, M-3c; M-15 → deferred (DEV-6, the
instruction preserved above); M-16 → excluded (AGENTS.md, DEV-7); revision 5's flagged
interface entry → the interface clause of the authority boundary.

Superseded-row annotations (2026-09-22, per the r6 review): the DEV-6 row above is superseded — M-15 is DEFERRED, not kept, and the operator instruction is preserved in these notes; the DEV-7 row is superseded — M-16 is EXCLUDED from the application laws, and the prose rule stays in AGENTS.md and document review; the PM-10 row routes its guarantee to the independence premise of the publication-evidence entry. The family-verdicts paragraph and its old CX-6 rejection below the table are historical — revision 6 INCORPORATED the narrow no-silent-abandonment prohibition into the candidate set as M-17 (no operator approval is cited), and the operative set is the 16-entry list in laws-proposed.md (revision 9 onward, after absorbing M-9).
