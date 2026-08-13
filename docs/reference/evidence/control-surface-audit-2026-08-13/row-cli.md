# ROW BRIEF — row-cli: audit the CLI surface (issue #147)

Read `audit-brief.md` first (the shared frame: axes, laws, escalation posture, deliverable
shape). Your surface is the **CLI** (`node impl/scripts/baton.mjs …`) — the human/operator thin
client that agents also drive.

## Your reading list (verify, then go where the evidence leads)

- `impl/src/application-cli.mjs` — the surface itself.
- `impl/CLI.md` — the generated surface doc (regenerated from the registry; check it matches
  reality).
- The verb set: `waves list`, `waves run`, `run.view`/`inspect`, `serve`, `setup`, `doctor`,
  profile handling — how an agent discovers them (`--help`? error messages? the doc?).

## Row-specific questions (in addition to the shared axes)

- Which orchestration operations are IMPOSSIBLE from the CLI today (must drop to the bus —
  e.g. cursor passing #136, `run_act` with inputs)? List them; that list is the CLI's parity
  gap.
- Error quality: does a misspelled verb / bad flag / missing profile teach the fix? Cite the
  refusal sites.
- Is the CLI grammar consistent (noun_verb vs noun.verb, flags vs positionals)?
- Scriptability: is output stable and parseable (JSON modes, exit codes)? What did the
  campaign's drivers have to scrape?

Deliverable: `surface-audit-cli.md` here (marker `SURFACE-AUDIT-ROW v1` on line 1) + the full
text posted to the `shared` scratchpad partition.
