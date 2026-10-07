# Owner corrections after recursive hardening

The exact `gpt-5.6-sol`/low Baton worker produced captured commit `428f4d4`. Baton's fresh verifier
accepted it, fast-forward integration succeeded, and the native process, worktree, runtime scope,
and task branch were all killed/reaped.

Owner review retained the worker's audit ordering, ticket/connection ceilings, initial-frame bound,
split content-trust metadata, replay slicing, and three regression tests, then closed additional
seams before the independent review gate:

- all byte/count/time limits reject zero, fractional, negative, or unbounded configuration;
- an initial snapshot must fit both its frame ceiling and current pending-buffer capacity;
- `write()` backpressure stops the pump immediately;
- response setup failure decrements active connection authority and is audited;
- snapshot overflow uses the canonical `temporarily_unavailable` WN7 error;
- the web authority itself rejects multi-repository relabeling even with a custom stream;
- real HTTP ticket issuance and SSE consumption are test-covered; and
- an actual Scratch claim proves content trust remains `claimed`, distinct from authoritative event
  occurrence/order.

Focused Phase 11/12 validation passes 54/54 and the complete implementation suite passes 589/589.
These corrections are normal owner hardening, not a trust-gate bypass; the resulting commit is sent
through a separate Baton review turn.
