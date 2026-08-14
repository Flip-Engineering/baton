# row-audit-147 — notes

[attempt: audit147-rerun-redrive1-20260814 row-audit-147]

Full deliverable: `redrive1/audit-147-rerun.md`

## Summary

Re-ran the #147 control-surface audit against CURRENT master with attempt-echo (every claim re-verified this run; all evidence in-repo, no `gh`).

- **CLOSED since the audit (9):** CLI F-1 (typo refusal), F-3 (waves send/stop), F-10 (steer sunset refusal); MCP F3 (coaching), F7 (repoId), F9 (structured wave validation); Web F2 (field-named 400s), F4 (coaching 413), F8 (authorize preconditions).
- **STILL BITES (12):** CLI F-2 (run.watch advertised-but-dead → silent "watch"-objective run), F-4/F-5 (cursor refused), F-7 (help waves no-op), F-8 (exit-code taxonomy); MCP F1 (profile not superset, 37 vs 88), F2 (resume/retry hard-missing), F4 (context.briefing), F5 ({decision} advertised-refused), F6 (stdio-only), F8 (cursor idioms); Web F1/F9 (dot/underscore/argv three spellings), F5 (SSE unadvertised), F6 (wait-ceiling value).
- **MOVED (1):** prior §2 #10 — scratchpad write verb now on MCP (`baton_run_scratchpad_append`) + web (`run_scratchpad_append`); CLI absence is documented policy (`CLI.md:11`).
- **NEW findings (7):** N-1 waves.compile (DSL #170) cross-surface; N-2 conformance inventory undercounts web bus 31 vs 33 (`surface-conformance: ok` still green); N-3 scratchpad.append lands MCP+web, bare CLI error leaks `undefined`; N-4 #210 clone-free eventsView + WLS-1 steering index (context); N-5 glm-5.3/ceiling-4 admitted but CLI.md fleet-routes table stale; N-6 MCP app profile 35→37, still not superset; N-7 divergence-ledger mechanism (9 entries).

**DECISION_REQUEST (3 authority-class ambiguities):** DR-1 run.watch silent-compilation — defect (honesty) vs tested R6 contract (doc-truth stale)? DR-2 CLI scratchpad-append — MOVED vs still-bites? DR-3 MCP profile non-superset — tracked-red-by-design vs still-bites? See `redrive1/audit-147-rerun.md` §5 for options and recommendations.

**Judgment calls:** F-6 (connection refusals) and F-7 (help) classified PARTIAL — code-surface improved, live-server actionability not re-probed; no `gh` claims made (worktree may be unauthenticated); red-by-design gates cited only as in-repo artifacts.
