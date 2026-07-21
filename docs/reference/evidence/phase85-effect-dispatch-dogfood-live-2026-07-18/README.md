# Phase 85 generic effect-dispatch dogfood

This directory records two exact parallel Codex implementation attempts against the bounded generic
dispatch gate. Both used `gpt-5.6-sol`, one at `high` and one at `xhigh`, through Baton's concise
`openBaton().workflow()` surface.

The first Run was interrupted after its aggregate Workflow status appeared idle with zero turns,
usage, and edits. Baton's durable recovery terminalized both Attempts, observed and closed both
process records, stopped two targets with zero remaining ownership, and closed with zero workers.
No Candidate existed. Inspection of the retained worker journals then proved the status was false:
the builder had 34 tool events and 9 edit events across six implementation files; the adversary had
23 tool events and 3 edit events including the new dispatch test.

The rerun was monitored through the worker journals and allowed to finish naturally. Both workers
used tools, edited scoped code, and ran tests, but Baton's verification/Candidate gate retained zero
Candidates. Run-stop found both already terminal, observed and closed both process records, returned
zero remaining targets/workers, and left caller status/index unchanged. No failed checkpoint was
promoted or reconstructed as a Candidate.

These Runs exposed two control-surface gaps: aggregate status did not rebuild durable worker
activity after restart, and zero-Candidate completion did not show the Attempts' terminal causes.
The first gap plus durable terminal-cause fallback is fixed in the caller tree and proven by the
cross-harness status evidence; live progress/member stop while `complete()` is blocked remains open.
