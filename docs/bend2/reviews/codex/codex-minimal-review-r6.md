# Codex review of revision 6 and wrong-destination publication

Reviewed 2026-09-21 Pacific. Draft SHA256: `48377bdffb666ab405fc89d374e79a0caa1c9cf4a535f8aafd6817d91b1d9bec`. Claude supplied source commit `582e340306c4dfb5a11ad34cbeb67164fe774ac2`; the reviewed artifact is the file at that digest. The extraction base remains `bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b`.

Recommendation: revise the remaining semantic gaps before presenting the set as ready for approval. Several r5 objections are resolved, including M-16's exclusion, M-15's deferral, acceptance versus execution, supplied assertions, granting authority, and logical rather than physical preservation. The new publication incident deserves an explicit independent prohibition. This review proposes laws; it does not adopt them or certify a Baton2 implementation.

## Issue #556: admit a destination prohibition

The reported incident delivered a push to a local intermediary while the intended shared repository remained behind. Fetching and inspecting a tracking ref through the same mistaken alias confirmed only the intermediary. [Issue #556](https://github.com/Flip-Engineering/baton/issues/556) was open when checked; the report that the immediate incident was fixed is not evidence that a preventive Baton implementation has landed.

The follow-up operator direction, relayed by Claude, bans the wrong publication effect itself. Merely explaining the misdelivery afterwards does not satisfy that direction.

**Proposed M-18 · No substitution of a publication destination. [proposed]**

> Forbidden: dispatching the publication effect of a publish/integrate operation to any repository or target other than the canonical shared destination designated by its admitted repository authority, or treating effects at another destination as completion. A local checkout does not become that destination merely because `origin` resolves to it.

This qualifies for the minimal contract. It prevents one concrete banned effect across otherwise valid implementations without prescribing GitHub, an alias, a protocol, another checkout, a particular validation command, or a repository layout. Local preparation is permitted; it cannot replace the shared publication effect or complete the shared operation. If there are several authorized destinations, each effect is bound to its designated destination. A canonical destination change requires an explicit authorized change to the contract; discovering a different alias value cannot silently make that change.

Keep this as its own entry. M-3a governs the review/evidence conditions for an artifact and target but never binds that target to an independently designated shared repository. An implementation could apply every review check to the wrong repository. Broad permission to write to both repositories also satisfies M-8 without making the substitution correct. M-11 addresses caller-manufactured facts, whereas this incident can arise from local configuration with no fabricated caller input. M-3c's truthfulness prohibition does not forbid a wrongly directed write whose destination is honestly reported. None clearly excludes the complete failure as written.

An alternative placement under M-3a would be acceptable only if it adds this exact independent destination restriction. Calling the current language sufficient would conceal the gap. A separate entry makes its necessity and proof obligation reviewable.

### What the proof must actually bind

The proposition must relate the destination in the admitted contract to the destination of the actual dispatched publication effect, and bind completion evidence to that destination and target. Checking two fields copied from the same alias, or a helper that simply returns `True`, proves nothing about substitution.

In the inspected source, `repoId` hashes the real local Git common-directory path. It does not identify a canonical shared remote by itself: `impl/src/application-deployment.mjs:288` at the extraction base, and `:296` at locally inspected commit `91ad17f5dc740abe913fe6e607461261252b03c9`. The parallel CLI derivation uses the same local identity. The issue's proposed comparison with `repoId` therefore needs an independently justified mapping to shared-repository identity; it cannot compare these as if they already meant the same thing.

The adapter must account for the effective write destination, including a separate push URL, URL rewriting, additional configured URLs, and changes between validation and execution. Git's documentation distinguishes fetch and push URL queries and describes expansion of URL rewrites. These are implementation review cases, not additional laws. [Git remote documentation](https://git-scm.com/docs/git-remote#Documentation/git-remote.txt-emget-urlem)

The claim that no check inside the resident could detect the error is too strong. An independently bound destination can be checked from the same process or checkout. The missing independence concerns the source of the destination's authority, not the physical location of the checker.

If destination identity cannot be established before dispatch, the controller cannot authorize the publication effect. If an already dispatched attempt has an uncertain outcome, retain that uncertainty under M-2; do not claim either completion or absence of effects without evidence. The prohibition does not claim that a remote ref can never change after a valid publication.

### Checked Bend2 example and limits

`destination-probe/good/{main,LAWS,PROOF}.bend` follows the upstream pattern: the law imports the implementation, and the separate proof fills the quantified law. It checks that every modeled dispatched destination matches the independently expected destination. The proof passes with Bend 2.0.25.

`destination-probe/wrong-destination/` changes only the implementation's mismatching branch to dispatch to the intermediary. With identical law and proof files, the compiler exits 1 at `Laws.destinations_match`, rejecting `False == True`. The passing controller exits 0. Results and limitations are recorded in `destination-probe/results.json` and `README.md`.

This is a universal theorem over a two-destination model, not a universal theorem about all Git configurations or a proof of network delivery. The real law must import the actual Baton2 transition/effect code. Adapter conformance, authentication, endpoint identity, configuration stability and external effects remain explicit proof assumptions or separate integration evidence. It is analogous to the upstream game's law checking the rendered flag location instead of trusting only the internal win flag. The upstream HTTP example likewise proves encoding properties without proving actual delivery.

The safety law allows a controller that refuses every publication; normal behavioral acceptance must also demonstrate successful authorized publication. That does not justify expanding this law into the entire scheduler or publication design.

## Remaining r6 semantic gaps

### M-4 omits the settled-but-unpreserved case from its operative prohibition

Lines 120-124 name both unsettled and unpreserved work in the title, but the body applies only to work whose custody is unsettled. Counterexample: the last holder releases, custody is settled, and cleanup erases the only copy of unpreserved output. That escapes the body's antecedent while violating CUST-4's retained guarantee.

Scope the prohibition to disposal that violates either current custody or preservation obligations. Ordinary disposal needs the required current preservation evidence for the same workspace generation; a separately authorized decision to discard work must name that disposition explicitly. Do not make every harmless deletion require preserving its discarded contents, and do not treat release of custody as evidence of preservation.

### M-6's claimed absorption has not been written into M-7/M-8

Lines 231-233 claim an exact resource/generation binding clause, but neither M-7 nor M-8 actually includes it. Repeating an old resource identifier can still be described as possessing valid authority if validity is left undefined.

Add the necessary scope to M-8: authority must be valid for the particular resource instance and action at the time of effect; authority for an earlier instance cannot authorize an effect on its replacement. Generation counters are one implementation, not a required design. This preserves the stale-release prohibition without restoring another standalone law.

M-7 can validate supplied claims under the applicable authority rules. It need not mandate a particular authority-record store. M-8's clause about an observer falsely claiming a new effect is already covered by M-3c; route it there. Treat M-9's exclusive-claim restrictions as a specified part of valid authority, or show a counterexample that requires a distinct invariant. These are scope and overlap reductions, not requests for more laws.

### M-5 still carries a separate rule about validation mechanics

The logical-history prohibition is appropriate. The semicolon clause at line 133 about a validation gate changing state is a separate restriction; it does not follow from history preservation. A valid gate can take authorized coordination steps while preserving accepted history. The essential publication prohibition is using evidence after its relevant state basis no longer holds, which belongs with M-3a's artifact/target binding. Do not freeze gate purity or atomicity as a law without showing the independent banned outcome it prevents.

### M-17 is appropriate, with a narrow continuation clarification

The original counterexample still escapes M-10 and M-12. Retain the prohibition on silently abandoning accepted, unsettled work. A continuation owner must mean an actual retained responsibility or recoverable handoff path; an orphaned identifier pointing to a terminated worker cannot satisfy the invariant by its mere presence.

The exception for an explicit authorized suspension should name its actual reason and resumption authority or condition. An operator can intentionally pause work even when no external dependency is missing. Requiring a fabricated dependency would add a restriction the minimal guarantee does not need. Keep deadlines, fairness, scheduler topology and eventual provider success outside this law.

### M-14's body permits a content-free refusal

The title requires the actual failed rule and safe relevant context, but line 205 prohibits only invented or misstated content. A bare `refused` response invents nothing and still omits the explanation the title promises. Make the required safe explanation explicit, while retaining the exception for protected information and allowing an unknown remedy. This is the existing operator-selected refusal contract, not a new requirement to invent advice.

## Enforcement labels and disposition integrity

The labels are more useful than r5's blanket runtime mark, but they are not all established. The draft defines `extracted` as enforced today. At its stated extraction base, `impl/src/wake-stream.mjs:766-773` advances past recorded events beyond `replayLimit` and records the count dropped. I re-read those exact lines. M-5 and M-10 cannot be labeled fully enforced at that base when their own WAKE-5 record identifies this contradiction. Mark the broader target guarantees partly enforced or proposed, with the surviving legacy violation explicit. A policy ruling and selected passing tests do not prove every runtime path obeys the combined prohibition.

The proposed set contains 16 labeled entries after splitting M-3 into a/b/c, not the stated 14. This is bookkeeping, not a target count or an argument against the restrictions. The changelog calls the new abandonment entry M-15 at line 35, while its actual label is M-17; line 240 still refers to a resurrected M-18 before any such entry exists in r6. The new destination proposal's provisional M-18 label does not repair that historical reference.

The design notes' purportedly repaired reduction table still routes CAP-7/CAP-14/AB-05 to absorbed M-6, DEV-6 to deferred M-15 as kept, and DEV-7 to excluded M-16 as kept. PM-10 still says M-3 scope despite r6's claimed routing repair. The old CX-6 rejection remains immediately before the contradictory adopted version. Update the operative table or mark the old version unmistakably historical; appending a contrary summary is not a reliable disposition record. Use proposed/retained-for-review, not adopted, where operator approval has not occurred.

## Answers to the held review questions

1. Several narrowed restrictions now pass the purpose/scope test; the full set still has the specific gaps and overlaps above. I am not asking to restore the former design specification or hit a numeric law count.
2. M-17 is a suitable narrow candidate once responsibility and authorized suspension are stated accurately. Its counterexample remains independent of cutoff and mandatory-wait rules.
3. The labels need the enforcement correction above. No complete runtime audit or production Bend2 proof is claimed by this review.
4. Proceed to proof-mechanics work on candidates once their intended prohibitions are agreed. The destination probe demonstrates a feasible shape and a rejected violating implementation; it does not substitute for operator approval or proof against Baton2's real implementation.
