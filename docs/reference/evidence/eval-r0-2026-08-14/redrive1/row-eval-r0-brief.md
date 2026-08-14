# ROW BRIEF — row-eval-r0: EVAL-R0 — the first honest eval number (#107)

Five landed rungs, re-driven solo-vs-driven, with the pre-registered pivot criterion. Read
the issue (`gh issue view 107` — if gh is unauthenticated in your worktree, ground in the
docs: grep for EVAL-R0 under docs/ and the pre-registration text) and the landed rungs'
evidence. Your job: execute the eval protocol EXACTLY as pre-registered — no scope drift,
no post-hoc criterion edits — and report the number with its evidence.

RE-DRIVE NOTES (wave-b, 2026-08-14): (1) wave-a's row STOP+DECISION_REQUEST was verified
needs-fold by its coordinator — its §3.1 auth claim was WRONG: `deepseek_key.json` and
`glm_key.json` both exist at the main repo root (the deployment resolves credentials via
repoRoot); its §3.2 capacity model predates the #221 law — invented seat ceilings are RIPPED
OUT; provider-true typed backpressure (429/rate_limited, retried, ledgered) is the ONLY
queue. Do not STOP on capacity you have not measured against the live resident. (2) The
deliverable below is named to match the wave's harvest exactly — wave-a's harvest missed
because the brief and harvest disagreed (filed as the launch-validation gap).

**Your file partition:** `docs/reference/evidence/eval-r0-2026-08-14/**` ONLY. Read-and-run
only outside it. If the pre-registration demands live provider runs you cannot complete from
the worktree (auth/capacity), STOP and DECISION_REQUEST with options — do not improvise a
weaker eval and present it as R0.

**Deliverable:** `notes-row-eval-r0.md` — the protocol as-registered, the runs, the numbers,
the pivot-criterion verdict, and every limitation named. `[attempt: <salt> row-eval-r0]`
verbatim in the first five lines.
