# Issue #114 — the workflow-as-data driver (v1.0 DRAFT)

- **Issue:** #114 — one closed spec + one verb ends the bespoke-driver era
- **Date:** 2026-08-06
- **Status:** DRAFT v1.0 — implementation contract
- **Frame:** operator directive 2026-08-06 ("why haven't you moved to an improved control surface
  or a DSL"); the composition law (docs/PROGRESS.md:391); five working bespoke drivers as the
  pattern's receipts (bd3-live-acceptance, spec-wave, suite-wave, blueteam-wave, fold-wave,
  dynamic-workflow demo — all under docs/reference/evidence/).

## Ground truths (verified against HEAD 0c605ad)

1. The wave driver's shipped steering vocabulary is `steering: 'nudge-on-checkpoint'` +
   `finalization: 'claim-on-stall'` + poll/stall/hardcap knobs (wave-driver.mjs — the
   createWaveDriver options shape; the demo and acceptance drivers ride it).
2. The bespoke drivers' variance is exactly three axes: (a) the member set (roles, seats,
   scopes, objectives), (b) extra steering behaviors (message-on-spawn, elevate-when-notes,
   answer-decisions, signal-on-members-done — the #94 demo's four), (c) the harvest spec
   (which files to recover from pins and how to match them).
3. `baton.recipes.implementContract` (recipes.mjs) proves a recipe is data + closed run
   options over the wave machinery — the embedding point for the generalized form.
4. The module-load side effect is real and bitten: every bespoke driver executes at import
   (a duplicate fold wave launched accidentally by importing one, 2026-08-06, killed).
5. Objectives over the recipe's 4096-byte rendered cap hit `recipe_oversize` (#101 — the
   cap that refused a wave at render); objectives must come from files by reference.

## Decisions

**D1 — the closed spec.** One JSON document, validated closed at admission:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "string",
  "members": [{ "role": "string", "exact": {"harness": "…", "model": "…", "effort": "…"},
               "scope": ["paths/**"], "objectiveRef": "path/relative/to/repo" }],
  "steering": {
    "approveOnAdvertisedPlan": true,
    "nudgeOnCheckpoint": { "message": "…" },
    "claimOnStall": true,
    "messageOnSpawn": { "kind": "query", "body": "…" },
    "elevateWhenNotes": { "kinds": ["note"], "maxEntries": 3 },
    "answerDecisions": { "policy": { "synthesize": "approve" } },
    "signalOnMembersDone": { "roles": ["…"], "message": { "kind": "query", "body": "…" } }
  },
  "harvest": { "paths": ["docs/…/file.md", "impl/test/x.test.mjs"] },
  "verification": { "command": "node", "arguments": ["--test", "…"] }
}
```

Unknown fields refuse `workflow_spec_invalid` naming the field; member-level violations
`workflow_member_invalid` (reusing wave.mjs's validateMember laws verbatim — scope globs,
exact-route closed shape). Objective text never appears inline (objectiveRef only — D5/GT5).

**D2 — the lane.** `baton.recipes.runWorkflow(spec | specPath)` on the embedded facade +
`baton wave run <spec.json>` CLI verb + the MCP tool `baton_wave_run` — all three over ONE
interpreter (a recipe-family function that validates the spec, starts the wave, drives the
steering policies, harvests per the harvest spec, and returns the structured receipt).
The interpreter is pure evaluation over a frozen spec object — importing it executes NOTHING
(GT4's law made structural: no top-level wave start in the module graph).

**D3 — the steering policies.** Each steering field maps to a closed, receipted policy on the
driver loop (all events surfaced to `receipt.steering[]` with the requestId/trigger):
- `approveOnAdvertisedPlan` — status → actions carry approve_plan → run.approve with the
  advertised digest, once per member (the demo's proven step).
- `nudgeOnCheckpoint` / `claimOnStall` — the shipped wave-driver behaviors, verbatim.
- `messageOnSpawn` — run.message.send on first-live (with the spawn-window retry per #97's
  typed worker_spawning refusal — retried, never fatal).
- `elevateWhenNotes` — run.scratchpad.read (task tier) → run.scratchpad.elevate with
  entryIds filtered by kinds, maxEntries-bounded, once per member.
- `answerDecisions.policy` — a closed map of requestText-pattern → answer (optionId), or
  'defer' (leave for the human; the attention item surfaces); every answer receipted.
- `signalOnMembersDone` — when the named roles reach terminal, send the message to the
  remaining members (the demo's lead-signal pattern).

**D4 — the harvest spec.** `harvest.paths` drives pin recovery: probe the newest result pins
then checkpoint pins for each path, verify content (non-empty; a per-path optional
`mustContain` string), write into the repo, and receipt per-path {pin, bytes, matched} —
ending the matcher-by-convention misses (the campaign's three bespoke-matcher misses).

**D5 — objectives by reference.** `objectiveRef` reads the brief from a repo file (bounded,
containment-checked) — never inline; the recipe render cap never fires on a file (#101's
class closed for this lane).

**D6 — the receipt.** `{ outcomes, steering, harvest, verdict, basis, waveId, manifestDigest }`
— the same shape the bespoke drivers hand-write today, structured.

## Non-goals (v1)

The Program IR lowering (#9 — the spec is the seed, not the program); nested workflows;
conditional member graphs (v1 members start together; phases gate through answerDecisions /
signalOnMembersDone); dynamic member addition mid-wave; the tight-cell group field (lands
with #102, then composes).

## Refusal vocabulary

`workflow_spec_invalid` (field-named) · `workflow_member_invalid` (role-named) ·
`workflow_objective_ref_invalid` (missing/oversize/escapes-repo) · `workflow_steering_unknown`
· `workflow_harvest_invalid` · all existing wave-lane codes unchanged.

## Red-first acceptance (pin groups)

- **W1** — the closed schema: every malformed field refuses its named code; a valid spec
  validates.
- **W2** — re-drive the suite-wave as a spec (4 deepseek members drafting suites): identical
  outcome shape (4 result_ready), zero driver script.
- **W3** — each steering policy fires: a member with an advertised plan gets approved; a
  checkpoint gets nudged; a spawn message lands and receipts; notes elevate; a decision gets
  answered per policy; the done-signal sends.
- **W4** — harvest: a spec with harvest.paths recovers the files with per-path receipts;
  a mustContain mismatch is a named harvest miss, never silent.
- **W5** — the import law: importing the lane's module starts nothing (no wave, no spawn,
  no network) — a static row.
- **W6** — refusal constancy: the same malformed spec produces the byte-identical refusal on
  the embedded facade, the CLI, and the MCP tool.

## Open questions

1. Whether `answerDecisions.policy` values may be a bounded expression (pattern match on the
   question text) or a closed enum map only (leaning: closed map v1).
2. Whether the CLI verb is `baton wave run` (singular, new) or `baton waves run` (family
   plural — the existing verbs are waves.*): leaning `waves run` for family consistency.
3. Whether the harvest spec gains `onto:` (harvest into a subdir) in v1 — leaning yes (the
   evidence-dir pattern needs it).
