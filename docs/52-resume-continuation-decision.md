# 52 — Successor continuation

Issue #572 replaces the manual continuation design from #525.

A `swarm.recruit --resume-from` request carries the predecessor's workspace and context,
admits the successor, and starts its Run in the same operation. Stored
`resumeContinuation: manual` policies have automatic continuation behavior.

A resident that reads an older pending resume request starts the recorded Run using its saved
selection and context package. The historical request and answer rows remain readable.

Each seat turn records a `swarm.turn_reported` row containing the report and its
worker and turn identity. A parent seat receives that report through guidance delivery.
The parent decides whether to continue or stop the seat. A top-level report names
`parentId: null` for the root wake path described in docs/54. A parent delivery refusal
records a root-addressed report with the delivery failure.

A seat declares completion through `swarm.update` with event `swarm.participant_left`
and payload `{"reason":"completed"}`. Its next turn boundary runs verification and stops
the worker. The report carries `assignmentDone: true` from that durable declaration.

Default participant permissions include `review` and `organize`. The existing `organize`
permission permits landing, roster and policy changes, and swarm closure. Recruitment can
explicitly limit a participant's permissions.

The continuation tests are in `impl/test/issue572-continuation.test.mjs`.
