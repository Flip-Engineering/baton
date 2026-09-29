# Codex review of revision 8

Reviewed 2026-09-22. The delivered draft has SHA256 `d1c3924653c0d61ff61db30af085e4c3587acb4f8213e017cad5dbbd83e07c91`. I verified that both it and the delivered design notes match their files in source commit `fabfef59c3c9d6b0e7a8e008914490a366e3d91c`, using read-only Git object inspection in the resident clone.

**Verdict: the substantive r6 counterexamples are addressed. I support presenting the candidate set to the operator after the narrow consolidation and presentation corrections below.** M-17 and M-18 pass the purpose/scope review as independent prohibitions. M-9 does not pass as another independent law, because M-8 now expressly includes its restriction. This review is a recommendation about suitability, not operator adoption or certification of implementation.

## Required minimality correction: finish absorbing M-9 into M-8

M-8 at lines 143-150 now forbids exclusive-claim coordination that fails to preserve the approved ownership semantics. M-9 at lines 157-163 says it is a specified part of that valid authority and would require a new counterexample to become its own law. Keeping it among the independent prohibitions contradicts that conclusion.

Move M-9 to the absorbed list and route its AB-04 evidence to M-8. Preserve its waiting, serializable-transaction and compatible-subdivision examples as explanations of the freedom M-8 permits. Keep its identifier for traceability; do not renumber the surviving entries. This removes a duplicate law without removing a guarantee. The resulting list has 16 independent entries; that number is the result of the overlap review, not a target.

This is the only remaining admission-level consolidation I require for this revision. I am not asking to expand the contract or revive the full design specification.

## Findings closed by the actual r8 text

| Prior concern | r8 result |
| --- | --- |
| M-4 allowed settled custody to conceal unpreserved work | Closed. Either custody or preservation obligations can prohibit disposal, and release is expressly not preservation evidence. Explicit authorized discard remains distinct. |
| M-5 mixed history preservation with validation mechanics | Closed. The history prohibition is now logical preservation; M-3a owns using evidence after its relevant basis ceases to hold. |
| M-6 was claimed absorbed without writing its requirement | Closed. M-8 binds authority to the resource instance, action and time of effect, and excludes authority for an earlier instance. |
| Observer reporting duplicated the authority clause | Closed. The false new-effect claim is routed to M-3c. |
| M-14 allowed an unexplained refusal | Closed. The operative prohibition now includes omission of the safe explanation. |
| M-17 could be satisfied by nominal orphan ownership or require an invented dependency | Closed. Actual retained responsibility or recoverable handoff is required; an authorized pause names its reason and resumption authority or condition. |
| M-5/M-10 overstated enforcement at the extraction base | Closed for the identified violation. Both labels now identify partial enforcement and the surviving WAKE-5 drop. |

M-1's acceptance scope, M-2's uncertainty handling, M-3b's operation-scoped duplicate-effect ban, M-3c's truthful retry reporting, M-7's validation boundary, and M-12's distinction between acceptance and optional completion waiting retain the corrections already reviewed. M-10 and M-13 remain the operator-selected cutoff and notification contracts. M-15 remains deferred and M-16 remains outside the application laws.

## M-17: suitable independent prohibition

The counterexample remains decisive: accept and record work, acknowledge it immediately, then detach it from every continuation responsibility without a terminal disposition or authorized suspension. Neither avoiding arbitrary cutoffs nor avoiding a mandatory caller wait forbids that transition. The revised M-17 does.

Its clarified scope permits different schedulers, recovery protocols, authorized pauses and handoffs. It does not require a completion deadline, scheduler fairness theorem or success from an unavailable provider. I have no remaining admission objection to it.

## M-18: suitable independent prohibition

The revised prohibition forbids the actual wrong-destination publication effect as well as counting another destination as completion. It binds the repository and target to admitted authority instead of allowing the current `origin` value to establish the destination. The old counterexample cannot comply merely by accurately saying that the local intermediary received the push.

Keep M-18 independent of M-3a's evidence eligibility and M-8's permission breadth. Permission to write to two repositories does not permit silently substituting one for the other in an accepted publication operation. Local preparation remains possible; it cannot fulfill shared publication. No additional law about GitHub, remote names, another checkout or a particular command is justified.

The previously checked two-destination probe is an appropriate proof-shape demonstration. Its passing and rejecting results already exist in `destination-probe/results.json`; I did not rerun the unchanged probe or claim new compiler evidence in this review.

During formalization, external assumptions must be precise. A host contract may establish what an effect executor or authenticated endpoint does; the proof must still show that the actual operation uses that contract for its designated destination. Assuming that publication reaches the intended repository would assume the very result at issue. In particular, binding two fields copied from one mutable alias is insufficient. These are the already identified proof obligations, not additional laws or a reason to delay the suitability decision.

## Corrections for the operator-facing draft

These do not require another open-ended design review:

1. **Distinguish incorporation into the draft from adoption.** Replace unqualified claims that M-17/M-18 are adopted with proposed or incorporated into the candidate set, unless actual operator approval is cited. Both entries are correctly marked proposed in their bodies; the title, changelog and held questions should agree.
2. **Make M-3a's label match all of its text.** Its heading calls only evidence-staleness proposed, while its evidence paragraph also calls the artifact-scoped dirty-tree clause proposed. Use partly enforced and identify both proposed clauses. The corrected WAKE-5 labels do not establish complete enforcement of unrelated clauses.
3. **Put current disposition beside the affected rows.** The design notes now explicitly mark the earlier DEV-6/DEV-7/CX-6 dispositions superseded, which resolves the substantive historical-versus-current ambiguity. However, those annotations are at the end while the table still displays kept for DEV-6/M-15 and DEV-7/M-16. Mark those rows historical/superseded in place or provide a clearly labeled current table. Route LEDG-15's retained stale-evidence prohibition to M-3a, keeping its gate-purity mechanism in the notes, and route AB-04 to M-8 once M-9 is absorbed. The historical source should remain available.

I verified that the current carried table has 135 physical rows and the stated mechanical tally of 47 kept, 29 reduced, 57 rejected, one retired, and one grouped evidence row. That is a historical disposition tally, not a count of approved laws. No new count target or additional restriction follows from it.

## Direct answers to the review request

1. The narrowed prohibitions are suitable candidates, with M-9 absorbed into M-8 as above. The justification is the forbidden behavior and necessary scope, not the number of headings or existing runtime checks.
2. Yes: M-17 has the necessary narrow continuation meaning and excludes a failure M-10/M-12 permit.
3. Yes: M-18 is the appropriate independent prohibition; its model proof shape is relevant and its actual effect-boundary proof remains owed.
4. The specific enforcement overstatements identified in r6 are corrected. M-3a needs the label correction above. I have not audited every present runtime path, so this is not blanket certification that each extracted clause is fully enforced today.
5. The corrected set can be presented for the operator's decision. The existing implementation/proof/negative-example/external-assumption requirements then apply to the selected laws. This suitability review does not authorize adding an unreviewed implementation or weakening a law to make its proof pass.

The exact consolidation and presentation corrections above are sufficient for my recommendation to proceed; another broad review round is unnecessary unless the proposed behavioral meaning changes.
