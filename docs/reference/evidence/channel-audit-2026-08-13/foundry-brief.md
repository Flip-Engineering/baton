# CHANNEL AUDIT FOUNDRY — shared frame (multi-member audit workflow, 2026-08-13)

Every member reads this first. This wave audits baton's cross-agent collaboration channels AS
THEY ACTUALLY BEHAVED in this campaign's real waves — not as designed. The evidence base is
the last 24h of foundry waves (contract foundry, review foundry wave-a, suite foundry, fold
foundry, review foundry wave-b): their briefs, reports, QAs, worktrees (`.baton/wt/ws-*`), and
the resident's coordination store.

## The shared laws (bind every member)

- **Evidence or it didn't happen.** Every claim cites a file path, an event (store + offset),
  or a report section. "The channel works" without a cited instance of it working is a hole,
  not a finding.
- Verdict per channel: PROVEN (cited instance of correct behavior) / GAPPED (cited instance of
  the channel failing, being unreachable, or being bypassed) / UNEXERCISED (no wave used it —
  say so; that is itself a finding about the composition layer).
- No clocks anywhere. Read-only outside your deliverable. `grep -an`/`sed -n` NUL discipline on
  `application.mjs` + `coordination-store.mjs`.
- **Escalation posture:** authority-class ambiguity → DECISION_REQUEST with 2–4 options + free
  response. Judgment calls are yours — record them.
- **Publish-as-you-go:** findings go to your file AND the full text to the `shared` scratchpad
  partition (kind `note`, title = your row role). If the publish path itself fails, THAT is a
  finding — record the exact refusal, and your file remains the durable artifact.
- **THE ATTEMPT-ECHO LAW (#171):** your objective opens with an `[attempt: <salt> <role>]`
  line. Your report file MUST carry that line VERBATIM in its header — the harvest refuses
  attribution without it.

## Known evidence anchors (start here)

- `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §0/§6 — the coordinator's
  `shared`-publish was UNREACHABLE from its snapshot; a row's publish landed in `worker:<row>`
  with "elevation at settlement" claimed. Verify both against the store.
- `docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md` — all 4 rows independently
  confirmed the shared-partition write gap (#158's gap).
- The resident's coordination store location is UNDOCUMENTED — row-chan's first job is to find
  it (the resident serves `impl/scripts/resident.deployment.mjs`; `openBaton({repo})` with no
  explicit stateDir; the worktrees' meta live at `.baton/wt/*.meta.json`; `.baton/` top-level
  holds per-taskwave dirs but none for resident-run waves — find where resident wave state and
  the coordination events actually persist, and record the path as a finding either way).
- `gh` was unauthenticated inside at least one member worktree (redteam-155.md's publish note) —
  row-env's brief covers this class.
