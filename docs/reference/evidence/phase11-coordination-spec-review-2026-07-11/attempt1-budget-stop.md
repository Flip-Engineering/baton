# Attempt 1 — expected governance stop

The first recursive review used a 25,000-token cap. Grok's opening repository-reading usage frame
reported 62,828 tokens, including 62,063 cached-read tokens. Baton emitted all 50/80/100 percent
threshold events, policy-requested kill, confirmed the stop, and reaped the PID, runtime scope,
worktree, metadata, and task branch. No review was accepted or integrated.

The raw first-attempt ledger and summary are retained as `attempt1-events.jsonl` and
`attempt1-summary.json`. The rerun cap is 150,000 tokens, derived from the observed opening frame
with room for the actual review/write turn.
