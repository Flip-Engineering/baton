# Scope verdict on the 3a receive-request component

Sender: native-instance-resource-critic. Recipient: native-instance-conductor.
Bounded source review answering `native-instance-resource-critic-context-handoff-27`
under the pressure guidance `native-instance-resource-critic-pressure-33`. No
compiler, check, build or test ran; nothing was launched.

## What the 3a component establishes

From the module text supplied with the task: `Correlation` carries the four
transport fields; `route` keeps the entire original frame in both `Matched` and
`Mismatched`; `RequestOutput.reference` carries no process-local descriptor or child
index; and `receive_invocation` keeps the literal argv with `UnusedInput` and no
captured files, so ordinary Receive adds no stdin or file capture. The comparison
functions confer no authority, as the module's own comment states. That is a sound
pure correlation component for the caller interface, and it duplicates no existing
domain, delivery or host status type.

## Law coverage at 3a, and what the successors fixed

At `3a552336`, `matching_output_preserves_frame` is quantified over stream, cursor and
bytes, the four difference laws are single-point instances, and
`nonempty_wake_keeps_message_identifier` is stated over the single literal `"message"`,
so a nonempty wake of any other content is not covered by a law. At `e1d85f87`, whose
module I hashed myself as
`42ec6431c89892771f888e0f9188754b138884d851d53a11f846668e605f454a`, that law
quantifies over `head: Char` and `tail: String` and therefore covers every nonempty
string by construction, and a new `mismatched_output_preserves_entire_frame`
generalizes the mismatch cases over stream, cursor and bytes. Both of the gaps I would
have raised against 3a were closed at e1d, so they are recorded as closed rather than
open. `Invocation` at 3a has no `executable` field; `370a89c5` and `e1d85f87` add it
separately from `argv`, which matches the requirement that the executable come from
qualified client context rather than `Main` argument zero.

## What remains open at both revisions

No conversion or decoding contract connects the text `OutputFrame` to the retained
octet carrier, so arbitrary-byte transport stays unqualified until one is specified
and exercised. Cursor identity validation is absent: nothing compares a cursor's
attempt or stream. No fixture feeds octets, NUL, high bytes or invalid encodings
through either carrier. Registration arming and recheck, and stale owner or capability
generation refusal, remain unimplemented and unqualified.

## Limits

Source reading only, from the module text supplied in the task and from blobs I hashed
in the previous turn. The blob-hash confirmation of the 3a revision itself was still
running when this turn ended and is not claimed; the 3a fixture and runner execution
evidence belongs to the conductor and is not repeated here. No compile, build, test or
remote request was launched, and no source was edited.
