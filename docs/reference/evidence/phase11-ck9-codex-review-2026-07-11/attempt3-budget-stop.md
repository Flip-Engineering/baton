# Attempt 3 — protocol defect, not a request for more budget

The third exact-model attempt reached 498,851 cumulative tokens against 450,000 without writing
the review. It performed 28 relevant source/test/evidence reads, but continued expanding the audit
after enough evidence was available. Exact model attribution and full reap passed; verification
and integration were absent.

The next run changes the orchestration protocol instead of increasing budget: the brief caps
repository-read/tool calls, and Baton sends a native mid-turn steer at the 50% budget event telling
the worker to stop exploring and write the bounded artifact. The hard ceiling is reduced to
350,000. This directly tests budget-aware operator control.
