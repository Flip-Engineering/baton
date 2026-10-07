# Kimi law review of revision 10: no parking pending an external act

**Verdict: accept.** The revision 10 entry passes law review. The encoding is verified at the
pin by independent re-execution, the entry meets the law definition, and the admitted and
forbidden waits are as the entry records them.

This review runs on a Kimi K3 seat (bend2-laws-review8) in place of the Codex route, which the
current routing forbids. It follows the format of the Codex records in this directory. A law
review is a recommendation about suitability; adoption remains the operator's decision.

Reviewed commit: `9aeb1ae3` on `bend2-rewrite`, which carries the status annotation commit
`2fc5fdaf`.

- `docs/bend2/laws-proposed.md`: SHA256 `e8896870f2ecccfb7ef99f699a8b16c80c97497da854585ce4009391f3337a5d`.
- `docs/bend2/laws-trace.md`: SHA256 `755de5dd5a71295dd118cf54e961d052a6acfea1b4ee4ba58aa5bad9f870907f`.
- `docs/bend2/examples/laws-no-park.bend`: SHA256 `25630ec88a4a62d3b76ca976619cdb5045194e4c6261ba4f14be6bb530a3eaa8`.
- `docs/bend2/examples/laws-no-park.evidence.md`: SHA256 `3422c11427ee3a275e402a29a3b4278d4d10d05ff38b914927bf15eaee40ab6f`.

## Independent re-verification

The host had no bend toolchain installed, so I installed the pinned one with the vendored
installer `docs/bend2/reference/toolchain/install-2.0.25.sh` (SHA256
`94b259043a341acbfb11e99559c56b518bfb1d6733227f1e6af595ec954ab29e`, matching the reference
README) into `node_modules/.bend`. The installed binary has SHA256
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`, identical to the value the
evidence file records. Host: macOS 27.0.0, arm64 (Apple M4).

I re-ran the three commands the evidence file records. Observed outputs match the recorded
outputs exactly.

Base model, both invocations:

```sh
$ node_modules/.bend/bin/bend docs/bend2/examples/laws-no-park.bend --check-only
All terms check.
exit=0
$ node_modules/.bend/bin/bend docs/bend2/examples/laws-no-park.bend
All terms check.
exit=0
```

Control A (`Parked{turn: Nat}` added to `State`, `case Parked{+turn}: Unwoken{}` added to
`waiter_of`, `case Parked{+turn}: {==}` added to the law's discharge). My scratch copy's diff
against the committed file is byte-identical to the diff the evidence file records
(23a24, 29a31, 47a50):

```sh
$ bend <scratch>/laws-no-park-parked-unwoken.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- turn : Nat
Location: waiter_is_woken
49 |     case Complete{}: {==}
50>|     case Parked{+turn}: {==}
51 |
exit=1
```

Control B (`Parked{turn: Nat}` added to `State`, `case Parked{+turn}: {==}` added to the law's
discharge, `waiter_of` unchanged). Diff byte-identical to the recorded one (23a24, 47a49):

```sh
$ bend <scratch>/laws-no-park-parked-unhandled.bend --check-only
Error:
- expected : cases for Parked
- observed : \{}
Location: waiter_of
26 | def waiter_of(s: State) -> Party:
27>|   match s:
28 |     case Working{+turn}: Runtime{}
exit=1
```

Both controls fail as required.

I added one supplementary control of my own, to close the triangle the two recorded controls
leave open: `Parked{turn: Nat}` added to `State` with a *woken* waiter
(`case Parked{+turn}: Orchestrator{}` in `waiter_of`) and no case added to the law's discharge.
The compiler refuses it:

```sh
$ bend <scratch>/laws-no-park-parked-woken-nodischarge.bend --check-only
Error:
- expected : cases for Parked
- observed : \{}
Location: waiter_is_woken
45 | def waiter_is_woken(s):
46>|   match s:
47 |     case Working{+turn}: {==}
exit=1
```

A constructor can therefore be added to this model only by naming a waiter, having that waiter
be one Baton wakes, and discharging the law for the new case. Omitting the discharge is caught
by the same coverage check that catches an unnamed waiter.

I also read the pinned language reference (`docs/bend2/reference/upstream/guide/GUIDE.md`,
Laws and Proofs) to confirm the semantics the encoding relies on: a law must be proven inside a
paired def; `{==}` proves `{a == b : T}` only when both sides compute to the same term; a
match must cover every constructor. The observed compiler behavior agrees.

## Answers to the three review questions

### 1. Is the statement expressible at the pin as written?

Yes. The claim is scoped to the model, and the discharged law plus its controls establish it
there. `waiter_is_woken` quantifies over the closed `State` type and requires
`woken(waiter_of(s)) == True{}` for every state. A constructor whose waiter is `Unwoken{}`
makes the per-case obligation reduce to `False{} == True{}`, an equality with no closed
inhabitant at this pin, so the failure is unsatisfiability of the obligation (control A:
`expected : False{}, observed : True{}`), not merely an unwritten proof. A constructor the
waiter function does not cover is refused by the coverage checker (control B), and a
constructor covered in `waiter_of` but omitted from the law's discharge is refused by the same
check on the paired def (my supplementary control). The unrepresentability claim needs no
stronger obligation than these supply, because the claim is about this closed type and its two
functions: no constructor can be added beside the discharged law without naming a woken waiter.

The boundary of the claim is equally clear. The encoding does not show that the rewrite's
actual work-state type cannot harbor a park; that requires importing the real transitions, and
the record correctly lists the application scope as open. The mapping `Complete{}` to
`Runtime{}` is a convention: a complete state waits on no one, and any woken party would do.
The mapping's correctness for real parties is an application obligation, not a model gap.

### 2. Is the entry a law, or tested behaviour?

It is a law. It names a specific forbidden behaviour: a transition that moves live work into a
state whose only exit is an explicit act by another party (claim, nudge, guide, resume
decision, review). The prohibition binds every otherwise-valid implementation: any runtime
design, whatever its scheduler, either contains such a state or does not. It has an
enforcement anchor: the encoded law over the work-state type for the rewrite, and for the
current JavaScript Baton the park commit `89661c1f`, the forcing commit `c200ced7`, issue #572
which removes the park, and the AGENTS.md ban.

It survives the triviality question. An implementation with no waiting states satisfies the
entry, and in such an implementation the guarantee holds because work is never stranded. An
implementation with waiting states must wait only on parties Baton wakes, which is the
guarantee. There is no design that complies with the wording while stranding live work on an
unwoken party.

It is consistent with the approved set and not redundant with it. M-12 forbids requiring the
caller to wait for managed completion; a parked seat's caller was already acknowledged, so M-12
holds while the park persists. M-17 forbids detaching accepted work from every continuation
owner; a parked seat retains a nominal owner, so M-17's wording does not reach the park. The
2026-09-23 incident — every live seat parked by 06:40 UTC and still parked seven hours later —
is the failure both entries permit and this entry forbids. That is the shape of an independent
law: a counterexample the existing set admits.

It is not tested behaviour. A test obligation asserts that a specific check ran and passed;
this entry forbids a transition shape in every implementation, with the model encoding as its
proof carrier and the application import as its recorded open obligation. That matches the
treatment of M-17 and M-18 in the r9.1 approval.

### 3. Which waits does the law admit, and which does it forbid?

The law admits exactly the waits whose waited-on party is one Baton wakes. In the model those
are `Runtime{}` — the runtime resumes the work itself, which covers a run waiting on a
verification lease, a seat waiting on a provider retry, and a gate run waiting on a runner —
and `Orchestrator{}` — the parent seat or the root, which Baton wakes at turn end with the
turn's report under the operator's 2026-09-23 decision. The law forbids every wait whose only
exit is an act by a party Baton does not wake, modelled as `Unwoken{}`: the park shape of
`89661c1f`, where the seat waited for an external `claim_turn` or `nudge_turn` and the runtime
woke no one.

The model states no obligation that a wait ends, and that omission is correct. A termination
obligation would forbid legitimate unbounded waits — a provider that never answers is handled
by M-2's unresolved-attempt rule and M-10's physical-bound rule, not by this entry — and would
exceed the operator's decision, which sanctions waiting on the orchestrator without bounding
the orchestrator's decision time.

## Scope of this verdict

This review accepts the entry as a law and its encoding as verified at pin `a4952426` with bend
2.0.25. It does not certify the current JavaScript Baton, whose park is removed by issue #572
as engineering work, and it does not discharge the application scope: importing the rewrite's
actual work-state type, waiter function and wake rule, and the host effects of the wake itself
and the orchestrator's decision (root wake is #564), remain open obligations as recorded in
`laws-trace.md`.
