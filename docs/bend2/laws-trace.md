# Approved law encoding and evidence

The operator approved the 16 operative entries at
`1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`, following the final Codex r9.1
review (`APPROVED`). Authorization was relayed in the bend2-laws-lead4 brief.
[laws-proposed.md](laws-proposed.md) retains the approved behavioral statements.
M-6 and M-9 are clauses of M-8; M-15 is deferred; M-16 is the writing rule.

This increment states ten quantified model obligations in [laws.bend](laws.bend), covering limited
parts of M-5, M-10, M-14 and M-18. [laws-proof.bend](examples/laws-proof.bend) discharges those
obligations, and [laws-transition.bend](examples/laws-transition.bend) drives the real review append
and the real worker admission against those models on an enumerated corpus.
**Each entry below records its own application status.** The remaining 12 entries have trace and
obligation records; they have no checked Bend proposition. The ten compiler TODOs in
`laws.bend` count the model obligations only.

Language evidence uses [the reference pin](reference/README.md),
`bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`, Bend 2.0.25.
The relevant pinned language sections are `guide/GUIDE.md`, Laws and Proofs,
Quantities, and Modules. [laws-check.evidence.md](examples/laws-check.evidence.md)
records the commands, outputs and failures. `python3 docs/bend2/laws-check.py <bend>`
checks the models, the transition witness, the negative controls and two existing
JavaScript regression rows.
At this revision the check reports 24 rows, 0 failed.
It is a bounded evidence check. Root owns the separate deployment command
`npm test --prefix impl`; this lane did not execute it. The check runs under
`/opt/homebrew/bin/python3` on this host; the `python3` first on `PATH` is an asdf shim
with no python plugin behind it.

The per-entry pin boundary follows the proof mechanics below: it names, for each approved entry,
whether this pin can carry its witness at all, and the measured language gap where it cannot.

## Recovery and provenance

The clean starting checkout `11deb7608f45920ccb56f7da3ca3baa55c32987a` is preserved
at `refs/baton/preserve/bend2-laws-lead4/start`. The predecessor snapshot
`881be83b515b3f8c0ccbbd780d014ad7fe56d29e` is preserved at
`refs/baton/preserve/bend2-laws-lead4/predecessor`. Its `laws.bend`, `laws-trace.md`
and `examples/laws-check.evidence.md` match
`refs/baton/preserve/uncommitted/bend2-laws-lead3/20260922T172619Z` byte for byte.
The lane was reconciled onto `cc1a18766c5284b556d0e8622e3436980761407c`.

This increment was recovered from the predecessor's preserved uncommitted tree,
`refs/remotes/origin-preserve/uncommitted/ws-947333eea5e0c5fbc297483e14bd9519/20260923T022150Z`
(commit `ea0549404f430ebfb8432a00551595a9112a9fea`). That tree's `docs/bend2` differs from
`cc1a1876` in exactly the nine files of this increment, and each recovered file was compared
against the same blob by sha256 after writing.

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
| M-14 | Partly enforced. DEV-4, CS-05/16/17: `swarm-contract.mjs`, `swarm-refusals.mjs`, `contribution-contract.mjs` | `issue372-closed-sets-taught.test.mjs`; `issue430-swarm-refusal-set.test.mjs`; `issue371-contract-example.test.mjs` | Checked pure-model obligations: the composed refusal's field, rule and remedy follow the vocabulary row the validator judges by, and the rendered context redacts. The application's own refusal rows are not imported |
| M-17 | Proposed CX-6, as narrowed in the approved set | No complete enforcement test claimed | Retained responsibility, recoverable handoff and authorized-suspension theorem pending |
| M-18 | Proposed destination prohibition from #556 | The approved record cites a prior destination model; it is not rerun or claimed as application evidence here | Checked pure-model decision: a declared deployment dispatches to exactly the declared remote, an undeclared one refuses with the undeclared code, and a publishing outcome carries no code. Dispatch, delivery and outcome remain host effects |

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

## M-14 and M-18 proof mechanics

- **M-14 refusal correspondence.** [laws-refusal-model.bend](examples/laws-refusal-model.bend)
  carries the table the validator judges by and, written independently of it, the reader that
  composes the explanation. Four laws compare a composed refusal against the table: its field, its
  rule, its remedy and its redacted context. The two-reader split is what makes those laws
  falsifiable; had the explanation been composed by calling the table readers directly, both sides
  of every proposition would have been the same term and no mutation could have failed them. The
  check mutates each reader in turn, and each mutation refuses the law that governs it. Scope: the
  model's vocabulary stands for the recorded refusal set, the application's own refusal rows are
  not imported, and the safety clause is modelled as redaction of a secret-valued context.
- **M-18 landing decision.** [laws-decision-model.bend](examples/laws-decision-model.bend) takes
  only a declaration, so no other value can become a target. Three laws state that a declared
  deployment dispatches to exactly the declared remote, that an undeclared deployment refuses with
  the undeclared code, and that a publishing outcome carries no refusal code. Three controls hold
  them: a decision that infers a fixed remote, an undeclared deployment that publishes, and a
  publishing outcome that carries a code. Scope: the decision only — the dispatch, the publish and
  their outcome are host effects and are not modelled — and the refusal code is an opaque model
  constant standing for `integrate_publish_undeclared`.
- **Transition conformance.** [laws-transition.bend](examples/laws-transition.bend) folds the real
  `foldSwarmEvent` review append and reads the real `HostCapacityAuthority` through a JS half that
  requires `impl/src`, then compares eight enumerated cases against these models through a base-3
  fingerprint of the retained decisions.
  [laws-transition.evidence.md](examples/laws-transition.evidence.md) records both runtime lanes,
  the eight cases and the control that drops a retained row. The corpus is enumerated: it binds the
  real transitions to the models on those cases and does not quantify over them.

## Remaining proof mechanics

For each row below, requirement, status, exceptions and rationale are the approved entry
in `laws-proposed.md`; source/test trace is the table above. These records specify the
next exact proposition and examples to implement. The M-14 and M-18 propositions named here are
the ones this increment checks in their pure-model form; every other row, and the application half
of M-14 and M-18, remains an unchecked obligation.
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

## Pin boundary per approved entry

This table names, for each approved entry, whether this pin can carry a witness for it at all.
`checked` means a quantified obligation over a pure model is discharged in this increment;
`checkable` means a witness is expressible at the pin and is not yet written; `model only` means a
pure model can be stated while the host half it quantifies over cannot be checked here; `blocked`
names the measured gap from [language-review.md](language-review.md)'s capability rows and the host
primitive the target architecture owes before the application proof can exist.

| Entry | Pin boundary |
|---|---|
| M-1 | Blocked: LANG-CAP-01. The pin has no durable sync, atomic rename or metadata operation, and `lang-cap-durability.evidence.md` measures write and close with no durability receipt in the result. Model only until an authored C effect family exists. |
| M-2 | Blocked: LANG-CAP-08 (no HTTP or TLS library) and LANG-CAP-01 (no durable attempt record). |
| M-3a | Blocked: LANG-CAP-07 (git runs as a subprocess, which needs the LANG-CAP-05 process family) and the host's compare-and-swap. |
| M-3b | Blocked: LANG-CAP-01 (no atomic rename, so no durable idempotency disposition). |
| M-3c | Checkable: given an injected prior outcome, truthful replay is a pure relation. |
| M-4 | Blocked: LANG-CAP-01 (no stat metadata, directory traversal, permissions or atomic publication). |
| M-5 | Checked: two model obligations discharged, and the real append is driven by the transition witness. The recovery, compaction, replay and delivery clauses remain open. |
| M-7 | Blocked: LANG-CAP-10 (no hashing, HMAC, constant-time comparison or secure random bytes) and the authority store's durability. |
| M-8 | Partly checkable: the no-elevation-by-delegation subset invariant is expressible over the permission set; the instance, revocation and atomic-check halves are blocked by LANG-CAP-10 and LANG-CAP-01. |
| M-10 | Checked: one model obligation discharged, and the real admission decision is read by the transition witness. The cancellation and retention clauses are blocked by LANG-CAP-09. |
| M-11 | Partly checkable: the caller/driver kind disjointness. Driver provenance is blocked by LANG-CAP-06 (no JSON codec) and LANG-CAP-05. |
| M-12 | Blocked: LANG-CAP-05 (no process family) and LANG-CAP-01 (no durable intent). |
| M-13 | Blocked: LANG-CAP-09 (no name cancels a computation, races two or sets a deadline). |
| M-14 | Checked: four model obligations discharged over the refusal vocabulary. The application's own refusal rows are not imported. |
| M-17 | Blocked: LANG-CAP-05 and LANG-CAP-09 (no process lifetime, restart or suspension authority). |
| M-18 | Checked for the decision: three model obligations discharged. Dispatch, delivery and outcome are blocked by LANG-CAP-08 and LANG-CAP-10. |

A blocked entry's witness needs its host effect authored with fault-injection evidence outside
Bend; no compiled example at this pin stands in for it.

## Revision 10: no parking pending an external act (accepted by the swarm; external law review accept)

The no-park entry of [laws-proposed.md](laws-proposed.md) is accepted by the swarm, with the
external law review recording verdict accept, and joins the 16 operator-approved entries above as
the seventeenth entry. Its record:

| | |
|---|---|
| Statement | The runtime never deliberately pauses, idles or truncates an agent's work; no transition may move live work into a state whose only exit is an explicit act by another party (claim, nudge, guide, resume decision, review). The operator's decision of 2026-09-23 states the sanctioned shape: at every turn end Baton wakes the seat's orchestrator with the turn's report, and the orchestrator decides whether to nudge the seat on. |
| Enforcement anchor in Baton | The park commit `89661c1f` introduced into the turn checkpoint and `c200ced7` forced on every participant; issue #572 removes it, and AGENTS.md bans it. |
| Encoding | [examples/laws-no-park.bend](examples/laws-no-park.bend): every state names its waiter, a total `woken` answers whether Baton wakes a party, and `waiter_is_woken` requires every state's waiter to be a woken one. |
| Checked scope | The model law is discharged at the pin and both controls fail as required: a state parked on an unwoken party makes the obligation unsatisfiable (`expected False{}, observed True{}`), and a state the waiter function does not cover is refused (`expected cases for Parked`). [examples/laws-no-park.evidence.md](examples/laws-no-park.evidence.md) records the commands and outputs. |
| Application scope | Open. The law constrains the rewrite's work-state type, its waiter function and the runtime's wake rule; the wake itself and the orchestrator's decision are host effects (root wake is #564), and the current JavaScript park is removed by issue #572, not proved by this law. |
| Review outcome | Accepted by the swarm; external law review accept. Swarm review 2026-09-23 by bend2-reviewer4 (contribution-2b03cd1a, seq 183360), six delivered items: the encoding verified, control A red as required, the aggregate driver, and the three review questions — expressibility at the pin, law versus tested behaviour, and the waits that are not parks. External law review 2026-09-24 by bend2-laws-review8, recorded in [reviews/kimi-law-review-r10.md](reviews/kimi-law-review-r10.md): verdict accept; the encoding was independently re-verified at the pin, both recorded controls reproduced as failing as required, a supplementary control (woken waiter, omitted law discharge) was also refused by the coverage checker, and the three questions were answered as the swarm review answered them. |

## Revision 11: no bookkeeping ledgers in place of function (proposed; reviewed; operator adoption 2026-09-25, encoded at the pin)

| | |
|---|---|
| Adopted statement | Operator adoption 2026-09-25; encoded at the pin. A gate decides from observed runs only; no gate, test or check reads a hand-maintained record of expected results (expected-failure allowance, converged declaration, count or census pin) in place of running the software. A judged landing blocks when a failure with the change has no matching failure identity on the target; target absence contributes no matching failure; an unjudged target is reported as unjudged and supplies no matching failure; an unjudged change cannot authorize landing; every selected invocation must be accounted for. Failure identity is defined by file, test where available, failure kind and specified stable semantic code. |
| Enforcement anchor in Baton | `impl/scripts/expected-red-tests.json` and its guard tests (417 rows and 161 converged files at master `c66098c1`; 451 and 173 at `770e89e3`), SI6 / `CORPUS_COUNTS`, and count literals in tests, removed by 5df1acf5 and c66098c1 (#579). #580 deleted the manifest gate at master `a7ae93e9` (follow-ups `f849019d` and `67b16568`); both reviewed bases and this branch's `impl` still carry it. AGENTS.md bans the pattern. |
| Encoding | [examples/laws-no-ledger.bend](examples/laws-no-ledger.bend): `gate(record, change, target)` and `landing_blocks(record, runs)` quantified over any stored record; `gate_reads_only_observations` and `landing_blocks_iff_breaks` equate them with the specification `breaks`. The adopted statement's encoding adds `FailureId`, `Verdict` (`Cleared`, `Broke{id}`, `NotRun`, `NoVerdict`), `Invocation`, `invocation_breaks`, `judged_landing(record, selected)`, `selected`, `accounted` and `target_verdict`, and discharges twelve laws, including `judged_landing_blocks_iff_a_selected_invocation_breaks`, `selection_is_the_changes_selected_set`, `every_selected_invocation_is_accounted` and `target_verdict_is_the_observed_run`. |
| Checked scope | Both model laws are discharged at the pin. Three controls fail as required: an expected-failure list (`expected False{}, observed True{}` at listed, Failed, Passed), a count pin (at pin 0, Failed, Failed; at pin 1, Passed, Passed), and a gate with no target comparison (Failed, Failed). [examples/laws-no-ledger.evidence.md](examples/laws-no-ledger.evidence.md) records the commands and outputs. Limited result: for fixed supplied outcomes and a fixed supplied selection, the gate equals `breaks` for every explicit record argument, and landing is the OR of those comparisons; outcome provenance, selection completeness, test policy and the application composition remain open. |
| Application scope | Applied to Baton's runtime gate on master `5cf804d0` (contribution-12cf27b90e700ed98dea8dc38ae11a83, landed with its gate green over 585 files). `defaultIntegrationGates` (#580) decides from `compareSuiteVerdicts` and `unaccountedFiles` in `impl/src/suite-comparison.mjs`: the failure identity is the file, the test where the run names one, the failure kind and the semantic code; the selection judged is the set the gate derived from the changed paths it was given; a selected file the run reported no row for is named and blocks; an unjudged target is reported as unjudged and supplies no matching failure; an unjudged change cannot authorize a landing; and the verdict judged is the run the gate started. `impl/test/bend2-revision11-landing-gate.test.mjs` rows r11a, r11b, r11c, r11c2, r11d, r11d2, r11e, r11f and r11g prove those properties, each driving `swarm.integrate` over a fixture repository whose gate runner is scripted. The model's transition composition remains open. Selection and test-contract changes do not authorize omission of their own failures; the repository test-policy clause is enforced separately. |
| Review outcome | External law review 2026-09-25 by bend2-astra-review16, recorded in [reviews/astra-law-review-r11-r12.md](reviews/astra-law-review-r11-r12.md): verdict revise; the encoding was re-verified at the pin and the recorded controls reproduced. The operator adopted the refined comparison policy on 2026-09-25; it is encoded at the pin. |

## Revision 12: the operator's banned runtime patterns (proposed; reviewed; operator adoption 2026-09-25, encoded at the pin)

| | 12a No ceiling and no clock (revises M-10) | 12b Catalogs follow observation | 12c Orchestrator authority |
|---|---|---|---|
| Adoption | Refined statement adopted by the operator 2026-09-25; encoded at the pin. | Refined statement adopted by the operator 2026-09-25; encoded at the pin. | Refined statement adopted by the operator 2026-09-25; encoded at the pin. |
| Enforcement anchor in Baton | `goal-plan.mjs` `policy.limits`; #541's historical 2 s queue wait, `load1m <= 10` refusal and 30 s `commandTimeoutMs` (load and queue refusals removed at `bc2e4fcd`); `drainPolicy` 64 workers / 90 s in `application-deployment.mjs` with `runtime-effects.mjs`'s deadline race, pinned by `issue500-deployment-capacity.test.mjs` (#583); budget hard stops (#258, defaults notify-only after the issue's remedy) | `DEFAULT_ROUTES` direct-harness rows (#549; September 24 observation: cache 8 models, table 2; the manual addition `0b6c6334` dates to September 22). #440 is a credential-fixture precedent: `a21bd055` changes only `impl/test/route-truth.test.mjs`, which derives fixture credentials from routes the test declares | Seat grant without `swarm.stop` (2026-09-25, contribution-7073ae820a93e04c2ba3bb3205a7d28f) |
| Encoding | [examples/laws-no-ceiling.bend](examples/laws-no-ceiling.bend): `authorized_from`, `available_from` and `admitted` derive the decision inputs, and `Disposition`, `Request`, `Work` and `WorkEvent` with `named_disposition` and `step` constrain the transitions. | [examples/laws-derived-catalog.bend](examples/laws-derived-catalog.bend): `Entry`, `Discovery` (`Observed`/`Failed`), `Policy` and `Catalog`, with `served_list` equated to `expected_list` over the complete observed catalog and failed discovery reported. | [examples/laws-orchestrator-authority.bend](examples/laws-orchestrator-authority.bend): `Scope` (`Delegated`/`Own`/`Bare`), `Grant`, `relation_of`, `dispatch` and `effect`, with the scope derivation and the dispatch/effect boundary. |
| Checked scope | Law discharged at the pin; controls fail: size ceiling (size 1+, elapsed 0, authorized, available: `expected Refused{}, observed Admitted{}`), deadline (size 0, elapsed 1+, authorized, short: `expected Refused{}, observed Waiting{}`), derived ceiling (size 2+ over capacity 1: `expected Refused{}, observed Admitted{}`). [evidence](examples/laws-no-ceiling.evidence.md) | Law discharged; controls fail at provided, not listed, not excluded (`expected False{}, observed True{}`) for a hand table and for an allowlist. [evidence](examples/laws-derived-catalog.evidence.md) | Law discharged; controls fail at `Leads{}`/`Stop{}` and `Leads{}`/`Integrate{}`. [evidence](examples/laws-orchestrator-authority.evidence.md) |
| Application scope | Open. The model covers admission inputs and subsequent transitions: terminal transitions bind to actual events, attempts are modelled separately from the durable work request so a transport timeout leaves the attempt unresolved, and disposition is preserved across ticks and attempt timeouts. Owner, owed-data and continuation retention with M-4, M-5 and M-17, and the application to the runtime's transitions, remain open. Actual provider and host failures are reported with observed cause; removing M-10's physical-bound exception is a new policy decision and M-10's data-preservation scope is retained. | Open. The model defines route identity, discovery completeness and policy provenance, and reports failed discovery explicitly; adapter support, credential scope and the distinction between advertised routes and scheduling eligibility or exhausted quota remain open, as does the application to the runtime's route serving. Observing the harness is a host effect and a stated assumption. | Open. The model derives the delegation scope and enforces it at dispatch and effect: a stale grant confers no authority, the caller cannot supply the relation, the effect rechecks the current authority, a current delegation holds every management act, and a seat stops itself. Each action's target and the management-action universe, prospective recruits, authorized reviewers and the root, and prospective recruitment scope remain open, as does the application to the runtime's dispatch; semantic preconditions such as an independently verified landing remain. |
| Review outcome | External law review 2026-09-25 ([reviews/astra-law-review-r11-r12.md](reviews/astra-law-review-r11-r12.md)): verdict revise; every submitted model checked and every recorded control reproduced; operator adoption of the refined statements 2026-09-25; encoded at the pin. | External law review 2026-09-25, verdict revise; operator adoption 2026-09-25; encoded at the pin. | External law review 2026-09-25, verdict revise; operator adoption 2026-09-25; encoded at the pin. |

## Revision 12 adopted entries G1 and G2 (operator adoption 2026-09-25; encoded at the pin)

| | |
|---|---|
| G1 statement | For the same validated semantic request, authenticated authority, observed resources and external events, changing administrative annotations about work cannot change the runtime's selected checks, derived decision inputs, admission, refusal, management permissions, required prerequisites, or continuation transitions. Administrative annotations include expected-failure allowances, convergence declarations, incidental code censuses and status declarations with no corresponding semantic effect. The runtime derives decision inputs from the specified sources. The complete composition, including source selection and dispatch, satisfies this independence. |
| G2 statement | For a valid authorized work request with its required semantic inputs, the runtime imposes no agent-maintained status, census, convergence or completion declaration as a prerequisite for admission or continued execution. A blocked continuation names the actual missing resource, authority, semantic input, or explicit operator/orchestrator decision that enables it. Each prerequisite has a specified enabling effect; administrative maintenance cannot satisfy that description merely by receiving a resource or authority label. The runtime preserves the continuation and wakes the responsible party as required by revision 10. When the prerequisite is satisfied, the runtime makes progress without a separate administrative acknowledgment. |
| Encoding | The review's model probes check at the pin: record independence over six work-act constructors (G1) and a prerequisite classification with `Bookkeeping` forbidden (G2), recorded with [reviews/astra-law-review-r11-r12.md](reviews/astra-law-review-r11-r12.md). The adopted statements are encoded in [examples/laws-annotation-independence.bend](examples/laws-annotation-independence.bend) (four laws: annotation independence, the positive behavior law, the observation's provenance, the decision's source) and [examples/laws-prerequisite-enabling.bend](examples/laws-prerequisite-enabling.bend) (six laws: every prerequisite has an enabling effect, administrative maintenance enables nothing, the prerequisite is the actual missing need, no bookkeeping prerequisite, an orchestrator decision is a legitimate prerequisite, a satisfied prerequisite makes progress). The probes' recorded limits are answered: the positive behavior law fails the always-refusing runtime, the provenance laws fail the record-derived observation, and the enabling-effect laws fail the label-only prerequisite. |
| Application scope | Open. Both laws quantify over the actual state and event projection; for effectful code the comparison preserves relevant events, enabled actions and terminal results. The composition spans source selection, dispatch, admission, refusal, management permissions, prerequisites and continuation transitions. Repository maintenance requirements (inventories, contributor reports, writing rules) remain AGENTS.md policy. |
| Review outcome | External law review 2026-09-25, verdict revise; operator adoption of the refined forms 2026-09-25; encoded at the pin. |
