# Approved law encoding and evidence

The operator approved the 16 operative entries at
`1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`, following the final Codex r9.1
review (`APPROVED`). Authorization was relayed in the bend2-laws-lead4 brief.
[laws-proposed.md](laws-proposed.md) retains the approved behavioral statements.
M-6 and M-9 are clauses of M-8; M-15 is deferred; M-16 is the writing rule.

This increment states three quantified model obligations in [laws.bend](laws.bend),
covering limited parts of M-5 and M-10. [laws-proof.bend](examples/laws-proof.bend)
discharges those obligations. **Application proof status is open for all 16 laws.**
The remaining 14 entries have trace and obligation records below; they have no checked
Bend proposition in this increment. The three compiler TODOs in `laws.bend` count the
model obligations only.

Language evidence uses [the reference pin](reference/README.md),
`bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`, Bend 2.0.25.
The relevant pinned language sections are `guide/GUIDE.md`, Laws and Proofs,
Quantities, and Modules. [laws-check.evidence.md](examples/laws-check.evidence.md)
records the commands, outputs and failures. `python3 docs/bend2/laws-check.py <bend>`
checks the models, six negative controls and two existing JavaScript regression rows.
It is a bounded evidence check. Root owns the separate deployment command
`npm test --prefix impl`; this lane did not execute it.

## Recovery and provenance

The clean starting checkout `11deb7608f45920ccb56f7da3ca3baa55c32987a` is preserved
at `refs/baton/preserve/bend2-laws-lead4/start`. The predecessor snapshot
`881be83b515b3f8c0ccbbd780d014ad7fe56d29e` is preserved at
`refs/baton/preserve/bend2-laws-lead4/predecessor`. Its `laws.bend`, `laws-trace.md`
and `examples/laws-check.evidence.md` match
`refs/baton/preserve/uncommitted/bend2-laws-lead3/20260922T172619Z` byte for byte.
The lane was reconciled onto `cc1a18766c5284b556d0e8622e3436980761407c`.

The retained draft rechecks at the pinned compiler. It contains one proved worker
lemma; the handoff's six additional prepared proofs are absent from those three files.
That lemma's implementation is reused in `laws-worker-model.bend`. The old approval
holds, empty runtime section and claims that receipt or exported record shapes establish
effect provenance are superseded by this trace. The full original files remain in the
preservation refs. Their obsolete prose is historical evidence.

## Trace coverage

The inventories [ledger](laws-ledger-inventory.md) and
[validators](laws-validators-inventory.md) record source and test anchors at
`bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b`. The table carries those historical
anchors by stable row ID. Rows other than M-5 and M-10 have not been rerun in this
increment. A cited test covers its named enforcement point; no row claims that a
historical JavaScript test proves the complete approved prohibition.

| Approved ID | Historical enforcement and source | Historical test trace | Current checked scope |
|---|---|---|---|
| M-1 | Partly enforced. LEDG-3/6: `coordination-ledger.mjs` keyed append and `coordination-ledger-writes.mjs` flush; CS-19: receipt fields | `phase11-coordination-store.test.mjs` duplicate-key row; `issue290-ledger-sync.test.mjs`; CS-19 has a test gap | Application proposition and crash-window proof pending |
| M-2 | Proposed CX-2. `coordination-ledger.mjs` prospective fold and quarantine provide partial supporting mechanisms | `issue290-prospective-fold.test.mjs` covers the supporting fold mechanism | External-attempt state machine and recovery proof pending |
| M-3a | Partly enforced. CL-03/08/12/13/15, PM-11, LEDG-15: `swarm-runtime.mjs` contract admission/integrate; `worktree.mjs` landing | `issue310-contribution-contract.test.mjs` (c); `issue296-swarm-integrate.test.mjs` 296e/296f; `issue466-landing-selection.test.mjs`; `issue292-coupling-truth.test.mjs` | Exact artifact/basis theorem pending; stale-evidence and artifact-scoped dirty-tree clauses remain proposed enforcement |
| M-3b | Extracted. CL-05/14, LEDG-3: `swarm-state.mjs` duplicate contribution/integration guards; keyed ledger append | `swarm-state.test.mjs` contribution duplicate; `issue296-swarm-integrate.test.mjs` 296h; `phase11-coordination-store.test.mjs` duplicate key | Logical-effect identity theorem pending |
| M-3c | Partly enforced. CL-10, LEDG-3: `worktree.mjs` empty-range refusal and ledger retry return | LEDG-3 duplicate-key test; CL-10 empty-range arm has a test gap | Attempt/outcome attribution theorem pending |
| M-4 | Extracted. CUST-1/4/6/11: `shared-workspace-custody.mjs`; `worktree.mjs` removal and physical-owner publication | `workspace-preservation.test.mjs` dirty/ignored content and live-holder rows; `phase92.2-physical-workspace-owner-red.test.mjs` failure-atomic publication | Disposal proof over actual observation, generation and effect pending |
| M-5 | Partly enforced. CL-07: `swarm-state.mjs` review append; LEDG-1/7/10/19: ledger/replay; WAKE-3/5, PROP-2: stream obligations | `swarm-state.test.mjs` opposing reviews; `issue296-swarm-integrate.test.mjs` 296f; ledger/stream inventory rows | Two quantified pure-model review lemmas checked; application recovery/compaction/delivery proof pending |
| M-7 | Partly enforced. AB-09/14, CL-02, PM-11/07, CUST-8, AB-05: `swarm-native-bridge.mjs` token-derived identity; runtime/fold attribution | `swarm-native-bridge.test.mjs`; `issue292-coupling-truth.test.mjs`; `shared-workspace-custody.test.mjs` T5 | Actual authentication/attribution theorem pending |
| M-8 | Partly enforced. PM-08, AB-04/05/06/10/11/12, CAP-7/12/14, PR-01, CL-15: runtime grants, claim and lease instance checks | `issue423-claims-proposals-state.test.mjs`; `issue373-read-only-recruit.test.mjs`; PM-08 refusal has a test gap | Exact resource/action/time authority and granting-authority proofs pending; fail-open scope remains proposed enforcement |
| M-10 | Partly enforced. CAP-2/3/15, DEV-1, PROP-1, AB-12: `host-capacity.mjs` worker admission; other cutoff boundaries | `issue297-issue307-host-capacity.test.mjs` HC-2; remaining inventory rows | Retained pure-model worker lemma checked; application-wide cutoff/data retention proof pending |
| M-11 | Extracted. CL-17: `swarm-event-schemas.mjs` and `swarm-contract.mjs` separate caller kinds from driver facts | `swarm-refusals.test.mjs`, fabricated driver-row refusal | Actual decoder-to-effect theorem pending |
| M-12 | Extracted. DEV-2, LEDG-6: managed-work acceptance and durable intent boundary | `issue290-ledger-sync.test.mjs` covers persistence; DEV-2 cites the operator contract | Acknowledgment/managed-completion dependency proof pending |
| M-13 | Extracted. DEV-3, WAKE-8: native attachment and `wake-stream.mjs` attribution | `wake-stream.test.mjs` attachment covering hosted swarms | Actual agent-interface delivery and re-arm independence proof pending |
| M-14 | Partly enforced. DEV-4, CS-05/16/17: `swarm-contract.mjs`, `swarm-refusals.mjs`, `contribution-contract.mjs` | `issue372-closed-sets-taught.test.mjs`; `issue430-swarm-refusal-set.test.mjs`; `issue371-contract-example.test.mjs` | Actual failed-condition/context/refusal correspondence proof pending |
| M-17 | Proposed CX-6, as narrowed in the approved set | No complete enforcement test claimed | Retained responsibility, recoverable handoff and authorized-suspension theorem pending |
| M-18 | Proposed destination prohibition from #556 | The approved record cites a prior destination model; it is not rerun or claimed as application evidence here | Actual dispatch/completion destination theorem pending |

Source filenames in this table are under `impl/src/`; test filenames are under `impl/test/`.
The approved M-5 and M-10 classifications retain the historical WAKE-5 drop qualification:
the drop existed at the extraction base and was retired under #541.

## M-5 review-history proof mechanics

1. **Requirement and violation.** Accepted facts, identity and required order survive the
   named transformations. For the bounded append model, erasing prior reviews or dropping
   the newly accepted row violates this requirement.
2. **Status and permitted designs.** Approval is complete; enforcement is partial. Storage
   layout and compaction strategy remain open. The model specifies logical review order.
3. **Exact propositions.** For every reusable `List<Review>` history and every `Review`
   row, `prefix(length(history), append_review(history, row)) == history` and
   `suffix(length(history), append_review(history, row)) == [row]`. `Review` contains
   arbitrary natural-number identity, author, artifact and basis, plus a decision.
   These are model fields; a mapping from the actual application row is still owed.
   No distinctness or nonempty-history premise limits the quantification.
4. **Transition and proof.** `laws.bend` imports the exact `append_review` model used by
   the proof. `laws-proof.bend` proves the prefix equality by structural induction and
   equality rewriting; the suffix equality uses structural induction. There is no
   Baton2 application transition imported yet. The corresponding JavaScript append
   is `foldSwarmEvent`, `swarm.contribution_reviewed`, at `swarm-state.mjs:2265`,
   with `[...existing, review]` at line 2278 on `cc1a1876`.
5. **Examples and vacuity.** The unchanged model checks and builds/runs natively. Five
   isolated implementation mutations fail the unchanged imported obligations and proofs:
   `[row]`, `history`, `[]`, reordered rows, and replacement identity. In particular,
   returning the original history fails the new-row obligation. The command also checks
   that the bare obligation module fails with three open claims. Compiler diagnostics
   are recorded verbatim; the negative controls require a type mismatch at a law proof.
6. **External assumptions and remaining scope.** The checked functions are pure. Applying
   this result to Baton2 requires the actual transition import, a complete row mapping,
   correct admission, and proofs for every recovery, compaction, replay and delivery
   path. Durable storage, crash behavior, host conformance and subscriber obligations
   remain outside this model. The model carries no cleanup or provenance capability.
7. **Trace and simplification.** CL-07 is the extraction row. The direct source and
   `swarm-state.test.mjs:648` opposing-review regression were re-read at `cc1a1876`;
   the regression passes. The older 296f trace checks rejection after revocation and
   does not directly assert all retained review rows. The quantified theorem can serve
   as a review-transition contract after integration; no JavaScript check is removed
   by this increment.

## M-10 worker-admission proof mechanics

1. **Requirement and violation.** The approved prohibition covers arbitrary cutoffs of
   valid work and owed data, with its stated physical-bound and cancellation clauses.
   This model addresses the existing unconditional worker-admission branch only.
2. **Status and permitted designs.** Approval is complete; full enforcement is partial.
   The retained worker rule is one existing policy instance. The broader law permits
   waiting or truthful failure for a physical shortage and explicit cancellation.
3. **Exact proposition.** For every `mt: Bool` and `bf: Bool`,
   `room_for(Worker{}, mt, bf) == True{}`. The booleans abstract verify memory pressure
   and available verify budget; there is no assertion about numeric load measurement.
4. **Transition and proof.** The three functions in `laws-worker-model.bend` are reused
   from `881be83b`. The proof is definitional equality after reducing the worker branch.
   `host-capacity.mjs:275`, `roomFor`, was re-read at `cc1a1876`: every admitted
   non-verify kind returns true. The Bend model restricts its kind vocabulary to the
   two existing lease kinds. Application imports remain pending.
5. **Examples and vacuity.** The retained draft and current proof check. A mutation
   returning false for the worker branch fails the unchanged law. Constant acceptance
   satisfies this bounded worker proposition; resource safety, authority, effect
   truthfulness and the other approved laws remain separate obligations.
6. **External assumptions and remaining scope.** No scheduler, measurement, queue,
   timer or IO effect is present in this model. Actual scheduling, physical-resource
   measurement and retention/continuation of owed data need independent proofs and
   adapter evidence. This lemma establishes neither the rest of M-10 nor M-17.
7. **Trace and simplification.** DEV-1 and CAP-2/3/15 supply the historical trace.
   `issue297-issue307-host-capacity.test.mjs:77`, HC-2, passes at `cc1a1876`.
   The model documents an existing branch for later integration. It authorizes no
   removal of admission checks elsewhere.

## Remaining proof mechanics

For each row below, requirement, status, exceptions and rationale are the approved entry
in `laws-proposed.md`; source/test trace is the table above. These records specify the
next exact proposition and examples to implement. **All are unchecked obligations.**
No proposed mathematical notation below is claimed to be accepted Bend syntax.

| ID | Required application proposition and premises | Passing / violating controls to compile | Host assumptions to expose |
|---|---|---|---|
| M-1 | Every acceptance at time t implies recovery now contains its operation identity, committed meaning and admitted authority; retries preserve those coordinates | Durable keyed acceptance / acknowledgment before durable write and changed-meaning retry | Persistence ordering, fsync/crash semantics, recovery and authority identity |
| M-2 | Every settlement or retry of attempt a follows outcome evidence or a recovery/new-action authorization accounting for a | Evidence-based settlement / fabricated success, failure or duplicate dispatch after lost response | Provider idempotency, observation identity and durable attempt record |
| M-3a | Every publication of artifact/version to target/basis satisfies all applicable live review, verification, tree-record and repository-authority conditions | Bound evidence / stale target, stale artifact, unresolved revision or missing artifact tree state | Git object identity, CAS, validation completeness and host effects |
| M-3b | Per admitted operation identity and authorized destination, one logical effect occurs, with explicit reapplication treated by its authorization | Retry returning original event / duplicated append or landing | Atomic idempotency disposition, external-effect recovery |
| M-3c | Every claimed new effect is attributable to that attempt; a replay reports the earlier outcome with its identity | Truthful replay / observer claiming a new effect | Effect observation and receipt identity |
| M-4 | Disposal satisfies live custody and current preservation for that workspace instance, or explicit discard authorization; disposable infrastructure follows its classification | Preserved released generation / stale capture, live holder, or release treated as capture | Filesystem observation, generation identity, atomicity and deletion conformance |
| M-7 | Every established actor/scope/attribution is validated by applicable authority records; observation claims equal verified observations | Validated assertion / forged caller actor or invented custody status | Authentication and authority-store conformance |
| M-8 | Each effect/grant/delegation is authorized for its actual resource instance, action and time, including ownership semantics and granting authority | Valid instance and grant / stale generation, fail-open scope, overlapping exclusive ownership | Token/instance identity, atomic authority check, revocation and effect dispatch |
| M-11 | Decoder/fold acceptance of caller data cannot establish execution/verification/publication facts without their establishing evidence | Caller request / forged driver execution or publication row | Boundary completeness and authenticated driver provenance |
| M-12 | Acceptance acknowledgment depends on the M-1 durable intent and does not require managed completion unless the caller chose to wait | Receipt before managed completion / unconditional join before receipt | IO scheduler, durable-intent completion, interface delivery |
| M-13 | Required notifications reach the actual interface under its delivery assumptions without a mandatory agent fetch/re-arm | Passive receiving interface / internal enqueue without delivery or fetch-only transport | Interface attachment, transport delivery, lifetime and recovery |
| M-14 | Refusal explanation matches its actual failed predicate and safe context; any remedy is grounded or explicitly unknown/unavailable | Accurate safe refusal / wrong rule, invented remedy or secret disclosure | Predicate/context observation, safe disclosure policy and rendering |
| M-17 | Every accepted unsettled operation retains responsibility or a recoverable handoff, terminal disposition or authorized suspension with reason and resumption authority/condition | Retained owner/recoverable handoff / dead owner ID or silent detach | Process lifetime, durable handoff, restart and suspension authority |
| M-18 | Actual publication dispatch and completion use the canonical shared destination designated by admitted repository authority; unknown identity blocks dispatch and unknown outcome invokes M-2 | Designated endpoint / local intermediary substituted via origin | Adapter conformance, endpoint identity, configuration stability and delivery |

Each implementation must also be challenged with refusal of all work, deletion of relevant
history, and constant success where its types permit those behaviors. Useful admitted actions
need passing witnesses. Which simplifications become justified depends on proofs over the
actual transitions; this increment makes no application simplification claim.
