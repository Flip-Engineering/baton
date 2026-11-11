# ROW BRIEF — row-web: audit the resident bus / web northbound surface (issue #147)

Read `audit-brief.md` first (the shared frame: axes, laws, escalation posture, deliverable
shape). Your surface is the **web/resident bus**: the unix-socket HTTP command endpoint
(`POST /v1/commands`) that `baton serve` publishes, its connection profiles/tokens, the SSE/
follow machinery, and the envelope grammar.

## Your reading list (verify, then go where the evidence leads)

- `impl/src/web-northbound.mjs` — the surface itself.
- `impl/src/application.mjs` — the direct ports and command dispatch (`grep -an`, NUL
  discipline) — which commands the bus admits, how refusals are shaped.
- `~/.config/baton/connections/*.json` — the profile shape an orchestrator must discover (do
  NOT print token file contents; note their existence, permissions, and discovery ergonomics).
- The orchestrator's own driver evidence: `docs/reference/evidence/run-task-wave.mjs` and the
  resident-pump patterns this campaign used — real consumer ergonomics of your surface.

## Row-specific questions (in addition to the shared axes)

- What does an agent need to KNOW to make its first call (socket discovery, token file, Origin
  header, envelope fields, repoId)? How much of that does the surface itself teach?
- Command spelling (`dots→underscores`): documented anywhere an agent can find? Refusal when
  misspelled?
- `run_view`/`run_act` ergonomics: digest-keyed actionIds, server-derived inputs, cursor
  continuation (#136-class) — could a fresh agent drive a run to completion blind?
- SSE/follow: can an orchestrator SUBSCRIBE instead of poll? What are the gaps (#132 follow-ups)?

Deliverable: `surface-audit-web.md` here (marker `SURFACE-AUDIT-ROW v1` on line 1) + the full
text posted to the `shared` scratchpad partition.
