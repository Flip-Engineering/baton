# Independent Baton2 law proposals

Governing clarification: [laws should be a minimal contract of inviolables](operator-minimal-law-scope.md). These six families are exploratory material to reduce, split or reject. Their desirable guarantees do not automatically belong in the law set; each retained obligation must identify an essential banned behavior without prescribing the broader project design.

Date: 2026-09-21. Status: proposed for adversarial review and operator decision. None is approved, implemented or entered into laws.bend.

These six contract families target Baton's purpose: coordinating authorized agent work through execution, review, publication and recovery. Some consolidate guarantees scattered through revision 3; others make missing relationships explicit. Each individual obligation still requires a separate decision. The accompanying [138-row assessment](codex-law-suitability-r3.md) challenges whether the existing proposals deserve to be laws at all.

## Form and admission criteria

The Bend-style declarations below show the intended quantifiers and relationships. They are design sketches, not checked code. The referenced Baton2 implementation modules and contract predicates do not yet exist. Ownership modes and concrete types must be chosen with those implementations. No type name in these sketches supplies an unproved guarantee.

`K` names the real implementation under review. `Contract` names the operator-reviewed meaning of the requirement, including admissible histories and observations. Its predicates must be defined independently enough to detect a broken implementation. The review must reject an empty admissible-history domain, a predicate that always succeeds, or a definition that excludes the failure the law was supposed to prevent. Provide concrete admissible histories and productive examples alongside each universal claim.

This follows the upstream examples: laws apply to the actual implementation, preservation complements safety, and the observation must expose the relevant failure. Pure proofs cover the modeled transition and effect protocol. Host storage, authentication, process execution and external publication need explicit assumptions, an executor that follows the protocol, and corresponding integration evidence.

## CX-1: An acknowledgment refers to recoverable work

**Proposed rule.** Every acknowledgment that an operation has been recorded must identify a recoverable intent with the same operation identity, arguments and admitted authority. That intent must survive every supported crash and recovery sequence after the acknowledgment. A later authorized cancellation or settlement is retained as a disposition of that operation.

**Why this deserves a contract.** Baton receives work on behalf of agents that can disconnect or restart. An acknowledgment without recoverable intent lets accepted work disappear while the caller reasonably treats submission as complete. Queue representation and storage technology do not change this obligation.

```bend
law receipt_has_recoverable_intent:
  for +trace: Contract.AdmissibleTrace
  for +receipt: K.Receipt
  for seen: Contract.ReceiptObserved(K.run(trace), receipt)
  Contract.ExactIntentRecoverable(K.durable_view(K.run(trace)), receipt)
```

**Adversarial example.** Return a receipt, crash before the durable write, then restart with no operation. A receipt-shaped return value must not make this execution pass. Submitting the same identity with different arguments must not silently reuse the earlier acknowledgment.

**Scope and alternatives.** This permits journals, transactional databases, replicated storage, synchronous completion and asynchronous execution. Supported durability and failure assumptions must be stated. It does not promise survival after every durable copy is destroyed. The expected failure model cannot be weakened by reclassifying an ordinary process crash as unsupported.

**Proof and effects.** Prove the implication over the actual protocol's observable traces, including crashes between each effect and acknowledgment. Establish what the persistence acknowledgment means at the host boundary. Require a positive submission example so withholding all receipts cannot satisfy the product requirement by itself.

**Relation to the draft.** Strengthens DEV-2, LEDG-3/6 and CS-19 by relating the external receipt to recoverable meaning. It does not preserve any particular receipt-file implementation.

## CX-2: Recovery preserves uncertainty about an external effect

**Proposed rule.** When Baton lacks evidence establishing whether an external attempt happened, it must retain that uncertainty. It may repeat the attempt only through a justified idempotent recovery protocol or a newly authorized action that explicitly accounts for the uncertain earlier attempt.

```bend
law unresolved_attempt_stays_unknown:
  for +state: K.State
  for +attempt: K.AttemptId
  for unresolved: Contract.OutcomeUnestablished(state, attempt)
  {K.observed_outcome(state, attempt) == K.Unknown{} : K.Outcome}

law recovery_retry_is_justified:
  for +state: K.State
  for +attempt: K.AttemptId
  Contract.RetryJustified(state, attempt, K.recover_attempt(state, attempt))
```

**Why this deserves a contract.** A process can fail after creating a branch, launching a worker or publishing a result but before recording the response. Treating the missing response as proof of failure can duplicate the action; treating it as success invents evidence. This problem persists across provider and storage choices.

**Adversarial example.** A worker was launched, its launch response was lost, and recovery launches another worker under a new identifier while reporting one execution. The law must inspect the attempt identity, actual effect plan and recovery evidence.

**Scope and alternatives.** Idempotency keys, queryable external receipts, fencing and explicit operator-directed retries are permitted. Cancellation may stop future work while the historical attempt's outcome remains unknown. A desire to cancel does not establish that an earlier effect never occurred.

**Proof and effects.** The first obligation concerns truthful reporting; the second concerns permitted recovery effects. Keep their proofs and approval separate. An idempotency assertion supplied by an arbitrary caller cannot establish provider behavior. External idempotency or reconciliation requires adapter-specific evidence and a named trust assumption.

**Relation to the draft.** Adds an explicit uncertainty contract across LEDG-3, CAP-6/14, recovery and CL-14. This is a proposed improvement; the extraction does not establish complete current enforcement.

## CX-3: Published work is the work the evidence authorizes

**Proposed rule.** An ordinary publication must bind the actual published artifact, target revision and operation identity to the applicable review, verification and authority evidence. Any change relevant to that evidence must be evaluated under the approved evidence-validity policy before publication.

```bend
law publication_matches_its_evidence:
  for +trace: Contract.AdmissibleTrace
  for +published: Contract.PublicationObserved(K.run(trace))
  Contract.ExactPublicationEvidence(K.run(trace), published)
```

**Why this deserves a contract.** Baton's review and verification have practical value only when they apply to what reaches the destination. A passing result associated with a nearby commit or an obsolete target can otherwise authorize different work.

**Adversarial example.** Verify artifact A, mutate the landing checkout to B, and publish B with A's passing status. Also test a target branch changing between verification and publication. A `Verified` constructor or a success flag must not establish the correspondence.

**Scope and alternatives.** Permit squash, merge, rebase, immutable package publication and other reviewed strategies. The contract relates semantic artifact identity and required evidence; it does not require one commit topology. Cached verification may remain valid under an explicitly approved equivalence rule. An authorized rollback is a distinct operation with its own evidence policy.

**Proof and effects.** Prove that every publication command produced by the real transition function carries evidence bound to its exact inputs and target condition. Require the publication executor to honor those inputs and use an atomic target condition or equivalent protection. Observe the actual published result in integration evidence. Separate obligations cover provenance, evidence validity and target concurrency; one carrier cannot certify all three.

**Relation to the draft.** Consolidates and tightens CL-8/9/12/13/14 and DEV-5. It preserves the reason for verification while allowing the implementation and gate-selection strategy to evolve.

## CX-4: Equivalent requests have equivalent authority and effects across interfaces

**Proposed rule.** When supported interfaces receive the same semantic request, operation identity and authenticated authority at the same policy and state revision, they must reach equivalent admission decisions and effect plans. Interface presentation may differ.

```bend
law interface_admission_agrees:
  for +state: K.State
  for +authority: K.AuthenticatedAuthority
  for +command: Contract.CommonCommand
  for left: K.Interface
  for right: K.Interface
  {Contract.decision_meaning(K.dispatch(left, state, authority, command)) ==
   Contract.decision_meaning(K.dispatch(right, state, authority, command)) :
   Contract.DecisionMeaning}
```

**Why this deserves a contract.** Agents choose CLI, MCP and other supported interfaces to perform the same work. Divergent authority or operation semantics make correctness depend on the chosen transport and encourage duplicate coordination logic.

**Adversarial example.** A read-only request is refused by CLI but an MCP nested option authorizes a write. Another failure is accepting a request through both interfaces while only one records durable intent. The compared meaning must include authority, durable disposition and effect identity.

**Scope and alternatives.** Different authenticated grants, protocol versions, supported feature sets or state revisions can legitimately produce different results. State those differences explicitly. The rule permits shared functions, independently implemented adapters and generated interfaces. It does not mandate identical response bytes or one particular module organization.

**Proof and effects.** Bind the theorem to actual decoding, normalization and dispatch paths. The sketch starts with a semantic command; each concrete interface additionally needs proof that its real decoder preserves that meaning. A theorem over an unused shared helper is insufficient. The equivalence relation must not erase the fields where authority or effects differ.

**Relation to the draft.** Strengthens CS-2, PM-5 and LEDG-17 and the target architecture's single authority model. This is more useful as a permanent requirement than forcing every consumer to call one named predicate.

## CX-5: Recovery and storage changes preserve the agreed logical history

**Proposed rule.** Replaying, checkpointing, compacting or recovering a supported accepted history must preserve its agreed observable meaning. Resuming a durable subscription from its accepted cursor must preserve every still-owed event in order.

```bend
law recovery_preserves_observation:
  for +history: Contract.AcceptedHistory
  {Contract.observe(K.recover(K.encode(history))) ==
   Contract.observe(K.replay(history)) : Contract.Observation}

law compaction_preserves_cursor_remainder:
  for +history: Contract.AcceptedHistory
  for +cursor: Contract.ValidCursor(history)
  {K.owed_events(K.compact(history), cursor) ==
   K.owed_events(history, cursor) : List<K.Event>}
```

**Why this deserves a contract.** Agents may restart after work has been accepted or consume coordination events slowly. Losing a review, an operation identity or an owed event changes what Baton permits and what the agent knows. Internal storage maintenance must preserve the contract those participants rely on.

**Adversarial example.** A projection rebuild treats a landed contribution as pending and lands it again. A compactor preserves current status but removes an event owed to a disconnected subscriber. A review fold retains only its newest review.

**Scope and alternatives.** Permit new codecs, segment layouts, databases, checkpoints, streaming page sizes and versioned migrations. The observation must cover approved histories, identities, authority and recovery behavior, rather than only a summary status. An operator-authorized erasure or policy migration is a separately specified semantic transition; it cannot be disguised as transparent compaction.

**Proof and effects.** Prove the actual pure codec/replay/compaction relations for declared versions and corruption outcomes. Host persistence and byte retrieval remain effect obligations. Cursor identity and scope must be defined independently of a small replay buffer; a buffer limit cannot remove still-owed events. Pure observational equality does not by itself establish physical crash durability.

**Relation to the draft.** Consolidates WAKE-3, PROP-2 and LEDG/CL history requirements, and directly excludes WAKE-5's superseded drop behavior. These two example obligations should be approved and proved separately.

## CX-6: Pending work has a justified continuation, and ready work can advance

**Proposed rule.** Every unsettled accepted operation must retain a continuation that can be acted on or an explicit reason for waiting tied to a real dependency, missing authority or unresolved effect. When that operation is selected and its declared prerequisites hold, the transition must produce the next action or its valid terminal result.

```bend
law pending_work_has_a_continuation:
  for +state: Contract.ReachableState
  for +operation: Contract.UnsettledOperation(state)
  Contract.JustifiedContinuation(state, operation, K.next(state, operation))

law selected_ready_work_advances:
  for +state: Contract.ReachableState
  for +operation: K.OperationId
  for ready: Contract.ReadyWitness(state, operation)
  exs progress: K.ProgressStep
  {K.next(state, operation) == K.Advance{progress} : K.NextStep}
```

**Why this deserves a contract.** Accepted work can remain recorded while nobody has the responsibility or trigger needed to continue it. A system that always waits or refuses can satisfy many safety rules while failing Baton's purpose. Baton needs a positive obligation to make its supported workflows executable.

**Adversarial example.** Park an agent awaiting its parent, then remove or disconnect that parent without establishing another continuation. Another failure is returning `Wait` for a ready operation because an unrelated task exists. The waiting explanation must reference an actual blocking condition under the approved policy.

**Scope and alternatives.** Permit priorities, queues, resource-based throttling, safe cancellation and unresolved external effects. A real authority dependency or physical constraint may block progress. No fixed completion deadline or universal parallelism requirement follows. Preserve the operator's full-scope and authority requirements while specifying which actor is responsible for each continuation.

**Proof and effects.** State readiness and blocking in the reviewed contract, provide reachable witnesses, and prove the real pure transition's response. Native wake delivery and eventual scheduling require host and scheduler assumptions plus integration evidence. These finite-step laws do not alone prove that every operation eventually completes, particularly when a provider never returns. A future temporal progress theorem must expose its fairness and environmental premises.

**Relation to the draft.** Adds a positive continuation obligation to CAP-3, DEV-2/3 and wake/recovery behavior. It is motivated by the documented stalled-agent and resume-routing incidents; complete enforcement in the current implementation is not claimed.

## Separate development contract: preserve the approved meaning of laws

**Proposal.** A change to implementation or proof must not silently weaken an approved law, its interpretation, its quantified domain or its trust assumptions. Changes to those contracts require operator review and an explicit new approval.

The proof gate should identify the approved statement set and semantic dependencies, check proofs against the implementation being accepted, and expose all trusted assumptions. Replacing the checked implementation with a different deployment or proving an unused model must fail the acceptance procedure. Any unsafe code in the proof's dependency path needs explicit treatment; unrelated effect code is assessed at its actual boundary.

This deserves a development contract because otherwise the repair path can delete the requirement instead of satisfying it. Bend checks the supplied propositions. Repository permissions, review policy and release provenance enforce who may change them and what is deployed. Do not claim that a standalone Bend law can establish those external governance facts.

## Ideas considered and withheld

- **Every operation executes exactly once.** An unconditional promise ignores a crash after an external effect and before its response. CX-2 instead requires truthful uncertainty and justified recovery; stronger guarantees depend on the particular effect protocol.
- **All independent operations commute or always run in parallel.** Journal ordering, physical resources and approved scheduling policy can legitimately distinguish their execution order. A narrower commutativity theorem may be useful for a specific domain operation, but a system-wide rule has not earned permanent status.
- **Every admitted operation eventually succeeds.** Providers, users and required authorities can fail or stop responding. CX-6 proves justified next steps under explicit premises; success and fairness require separate, scoped contracts.
- **A verified status means the system is safe.** That wording hides which implementation, artifact, effect and failure model were verified. Each law must specify the actual observation and obligation it protects.

The upstream examples support this level of scrutiny. The sort needs element preservation as well as ordering; the game relates its theorem to the displayed board; the evaluator distinguishes valid expression types from correct optimization; and the HTTP example states only the pure encoder properties it proves.
