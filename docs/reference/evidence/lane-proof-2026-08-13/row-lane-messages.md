# ROW BRIEF — row-lane-messages: exercise the message-kind, reply, and elevation lanes

Read `foundry-brief.md` first (the lane laws bind you). Exercise each lane and record the
evidence (messageId/eventSeq or the verbatim refusal):

1. **Message kinds** — send the coordinator THREE messages, one per kind: `query` ("Which
   report sections do you want first?"), `inform` ("My lane-evidence draft is underway"),
   `steer` (a suggestion about the QA's structure — yes, a member steering upward; record
   whether the lane accepts it). Record each messageId and delivery state.
2. **The reply chain** — if the coordinator answers your query, REPLY to its message (not a
   new message) and record the thread linkage. If no answer arrives, record the absence.
3. **Note elevation** — publish one `doubt` and one `plan` note (your real working notes about
   this wave's lanes). The wave's `elevateWhenNotes` policy should elevate them; record
   whether an elevation event fired and what it carried.
4. **The shared publish** — attempt to publish your findings summary to the `shared`
   scratchpad partition. The channel audit says this is gapped (#158 — the kernel
   `writeScratchpad` hardcodes `worker:<id>`): record the EXACT refusal or the partition it
   actually landed in. This is the campaign's load-bearing negative test.

Then write `docs/reference/evidence/lane-proof-2026-08-13/lane-messages.md`: per lane — the
exchange record + verdict PROVEN/GAPPED/UNEXERCISED. Attempt line verbatim in the first five
lines.
