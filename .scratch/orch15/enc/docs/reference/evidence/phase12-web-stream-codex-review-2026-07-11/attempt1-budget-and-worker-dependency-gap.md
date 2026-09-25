# Attempt 1 — finding preserved, report rejected

The exact `gpt-5.6-sol`/low report-only reviewer found one medium-severity WN6 defect: an established
SSE connection rechecked neither credential expiry nor live revocation, so it could continue
reading coordination events past the principal's authorization lifetime. The full proposed report
is preserved as a `content.file_edit` diff in `events.jsonl`.

The worker then ran the exact multi-file test command in its own worktree. That worktree did not
contain the main checkout's explicitly installed `impl/node_modules`, so three modules failed to
load `@ast-grep/napi`. Continued reporting crossed the 300,000-token hard budget and Baton
cancelled, killed, and fully reaped the worker. No review commit was captured or integrated.

The defect was independently reproduced and corrected with expiry and live-session liveness tests.
Baton now supports separately configured, copied worker-worktree dependencies as well as detached
verifier dependencies; neither path symlinks or mutates the main checkout. Attempt 2 reruns the
report-only review against the corrected current HEAD with a bounded larger budget.
