# Attempt 2 — correctly budget-stopped after deeper review

The second exact-model Codex attempt was again stopped before producing an artifact. It reached
284,292 cumulative tokens against a 250,000 limit while source-tracing the exact coordinator
regions, coordination store, specifications, and crash tests. Exact model attribution and cleanup
all passed; verification and integration remained absent.

The tool trajectory was relevant rather than a harness loop: it inspected the `c8a272e` diff,
then the stop, recovery, follow-up, integration, publication, input, replay, and store paths. The
third ceiling is 450,000, derived from the observed 284,292 plus room to finish the written review.
No other gate is relaxed.
