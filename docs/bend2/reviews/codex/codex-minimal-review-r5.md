# Codex review of revision 5: minimal inviolables

Reviewed 2026-09-21. Draft SHA256: `ad740ae0cd707e312a072af43e6424ec3078c8a3f5f4a9ce2be4abd9b4a762fc`.

Recommendation: revise before presenting these as settled candidates for approval. Reducing the number of headings to 16 has removed many implementation choices, but several headings still combine independent restrictions, exclude valid behavior, or leave the forbidden behavior undefined. This review approves no law.

The target is the smallest sufficient set of essential prohibitions on application behavior. An operator-selected policy can qualify. Existing runtime checks, a current AGENTS.md rule and a property that would be useful to prove do not automatically qualify. Count distinct restrictions and their consequences; heading count is not the measure of minimality.

## Findings that affect admission

### M-16 belongs in the existing writing instructions

M-16 at line 164 regulates prose style and document placement. Those instructions remain binding in AGENTS.md and normal review. They do not prevent a banned behavior from being coded into the application, which is the operator's clarified purpose for the minimal law set. Remove this entry from the proposed application laws while retaining its existing source and enforcement process.

### M-15 cannot enter the set with its forbidden behavior still undefined

At line 155, the meanings of whole mandate and completion are expressly owed. Useful task decomposition, temporary loss of a permission, deliberate review boundaries and assigning more than one agent cannot be judged against undefined terms. Preserve the operator's scope instruction in the design notes, then specify the precise assignment behavior it forbids. Do not convert the unresolved wording into an inviolable contract or weaken the operator's instruction through an invented interpretation.

### M-3 compresses several restrictions into one heading

Line 53 includes publication eligibility, artifact/version binding, duplicate publication, no-change reporting, revision resolvability, dirty-tree reporting and repository authority. Some duplicate M-7, M-8 and M-11. Others need narrower scope:

- The same contribution may be published to multiple authorized destinations. A reverted change may be deliberately reapplied. Forbid an unauthorized duplicate logical effect under the same operation identity, rather than all repeated publication of a contribution.
- An idempotent retry may truthfully report an earlier landing even though this attempt changes nothing. Forbid claiming a new effect that did not occur.
- The dirty-tree clause must describe which artifact or result the evidence covers. Merely having unrelated dirty files cannot invalidate every report.

Retain the essential prohibition on publishing work outside the applicable authority and evidence conditions for the actual artifact and target. Assess the remaining truthfulness and identity clauses under the laws that already own them. Do not make fewer headings carry the full former specification.

### M-7 bans legitimate supplied data, and M-8 confuses delegation with granting authority

M-7 at line 95 forbids any caller-supplied actor, author, reviewer, scope or attribution value. Callers legitimately propose scopes, identify the contribution being reviewed, submit evidence about an author, or present an authenticated delegation. The forbidden behavior is trusting an assertion as authority or established attribution without the required validation. The field's arrival in a request is not itself forgery.

M-8 at line 103 says the granter must hold every authority it grants. An operator or provisioning role can legitimately hold authority to grant a permission without personally possessing its execution permission. Forbid granting beyond valid granting authority; ordinary delegation may then have a subset rule. Also distinguish a read-only observer reporting an existing change from claiming that its own read request performed a change.

These corrections preserve the hard boundary while leaving authentication and delegation designs open.

### M-1 and M-12 overreach their acknowledgment scope

M-1 at line 38 applies to answering an operation. A query, a refusal or a clarification can validly answer without recording new durable work. Scope the rule to an acknowledgment claiming that managed work has been accepted or recorded.

Its retry clause must preserve the operation's identity and committed meaning while allowing the reported state to advance from queued to completed. Requiring every retry to return the original disposition can freeze the result forever or reuse a receipt for changed arguments.

M-12 at line 135 would ban synchronous reads, waiting for the intent write itself and an optional caller-selected wait. The intended prohibition is requiring a caller to remain blocked until accepted managed work completes. The durable acceptance boundary and the subsequent execution need distinct meanings. This is an operator-selected interaction rule; it does not require banning every synchronous function or response.

### M-5 needs logical preservation, and M-9 must permit waiting

M-5 at line 74 can be read as forbidding a storage migration that rewrites physical records while preserving the accepted facts, identities and required ordering. State which logical evidence and owed events cannot be lost or altered. Separate physical layout from those protected facts. Its pre-write-gate clause also should not prohibit a correct atomic validate-and-commit implementation merely because validation and mutation share one operation.

M-9 at line 111 requires the second claimant to refuse. Waiting for the first holder, serializable transactions and compatible resource subdivisions may preserve exclusive authority. Forbid conflicting unauthorized mutation; do not prescribe refusal as the only response. A written coordination rule is not sufficient merely because it exists: it must preserve the approved ownership semantics.

### The reason for rejecting CX-6 is unsound

At line 320, the continuation prohibition is rejected because it is a positive obligation, with M-10 and M-12 claimed to cover stranded work. Positive and negative wording can express the same invariant. Review the behavior.

Counterexample: accept and durably record work, immediately return its receipt, then detach it from all schedulers and continuation owners without a terminal disposition. Keep the history and event transport intact. There is no elapsed-time, size or count cutoff; the caller was not held. M-10 and M-12 both hold, yet the work is silently abandoned.

Reconsider the narrow prohibition **do not silently abandon accepted, unsettled work**. Explain whether an existing law truly excludes the example. A retained, justified continuation or an explicit authorized disposition can implement it. This does not require a particular scheduler, worker topology, execution order, completion deadline or a promise that an unresponsive provider eventually succeeds. Keep the broader ready-work and temporal-progress specifications in the design notes unless they independently meet the minimality threshold.

## Row-by-row disposition

These are purpose/scope judgments, not approvals or proof verdicts.

| Row | Disposition | Necessary boundary or remaining objection |
| --- | --- | --- |
| M-1 | Retain a narrower prohibition | No acceptance claim without recoverable matching intent; retries preserve identity and meaning while allowing state to progress. |
| M-2 | Retain with precise exceptions | No invented outcome and no unjustified repetition of an uncertain effect. A lost response can be resolved later; the binding reason should not call it permanent. |
| M-3 | Reduce and remove overlap | Preserve actual publication's evidence/authority conditions. Scope duplicate effects by operation and destination; separate truthful retry reporting. |
| M-4 | Retain the preservation boundary | Forbid disposal of unsettled or unpreserved work. Same-generation evidence alone does not establish freshness; define authorized disposal and retained-artifact cases. |
| M-5 | Retain logical preservation | Protect accepted facts, identities, required ordering and owed events. Avoid prescribing record layout, one validation style or a universal ordering across unrelated partitions. |
| M-6 | Retain or absorb into precise authority scope | Exact resource/generation binding is important. It may be a necessary clause of the authority boundary rather than a separate law. Identifier recycling is not universal and is not needed to justify it. |
| M-7 | Rewrite the banned behavior | Forbid unvalidated assertions acquiring authority or established attribution. Permit legitimate supplied identifiers, requested scopes and validated delegation. |
| M-8 | Rewrite granting scope | Forbid effects and delegation beyond valid authority, including fail-open scope handling. Account for explicit authority to grant rights. |
| M-9 | Reduce to ownership preservation | Permit queuing and valid transactional coordination. Check whether the resulting prohibition is already covered by the authority boundary. |
| M-10 | Retain the operator's cutoff prohibition | Scope it to valid requested work and owed data. A physical shortage can justify waiting or a truthful failure; it cannot promise immediate continued execution after resources disappear. Explicit cancellation and the task's own stopping condition need separate semantics. |
| M-11 | Retain a truthfulness prohibition | Caller input must not fabricate established execution, verification or publication facts. Reconcile overlap with M-2/M-3/M-7 without hiding distinct obligations. |
| M-12 | Narrow to acceptance versus execution | No mandatory wait for managed work to finish before acknowledging its recorded acceptance. Permit queries, the durability prerequisite and optional waiting. |
| M-13 | Retain the operator's delivery prohibition | Required progress notifications must reach agents without agent-invoked fetch/rearm. Optional history inspection remains permitted; delivery must mean reaching the actual agent interface. |
| M-14 | Narrow to truthful useful refusals | State the actual failed rule and safe relevant context. Give a remedy when known; explicitly unknown or unavailable remedies are valid. Do not require fabricated advice or disclosure of protected inputs. |
| M-15 | Defer pending definition | The draft cannot identify its forbidden behavior precisely enough yet. Preserve the operator's instruction outside the adopted law set while resolving it. |
| M-16 | Exclude from application laws | Preserve it in AGENTS.md and document review. Its subject is repository prose style. |

## Demotions and evidence

CX-4's full interface-equivalence theorem can remain in the design notes. It covers more than the minimal authority and intent boundaries. Those boundaries must apply through every exposed path, so a new interface cannot provide an exception to an approved prohibition. An uncovered concrete violation can justify a new law; complete interface equivalence is not automatically one.

The broad recovery/codec correctness work and full ready-work progress specifications also belong in the design notes. Their important banned behaviors should be expressed at the appropriate minimal boundary, without importing all implementation obligations as law clauses.

The document's `runtime` label currently asserts present enforcement of every clause. Its cited rows do not establish complete enforcement of several new combined requirements, particularly M-2's uncertainty handling. Mark each prohibition as extracted, partly enforced or proposed based on specific evidence. This review did not audit all runtime paths or certify any new Bend proof.

Repair the reduction record before relying on its completeness: CAP-3 still points to a nonexistent M-18, the admission test lists two questions while the table cites Q3 through Q6, and several rejected rows say a guarantee is required without naming its surviving home. Trace guarantees semantically; matching a source-row identifier to a broad heading does not establish coverage.

No universal target count is proposed. Keep only the independent restrictions that survive necessity, scope and overlap review, and demonstrate each with a plausible coding change the law would forbid. Implementation agents should then retain freedom to choose the rest of Baton2's design.
