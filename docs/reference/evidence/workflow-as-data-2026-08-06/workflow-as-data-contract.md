# Issue #114 — the workflow-as-data driver (v1.2 SUITE-FOLDED)

- **Issue:** #114 — one closed spec + one verb ends the bespoke-driver era
- **Date:** 2026-08-06
- **Status:** DRAFT v1.2 — implementation contract (red-team #114 + blue-team suite-fold-2 folded)
- **Fold note:** v1.2 is the suite-fold-2 revision (`suite-blueteam.md`, verdict NEEDS-FOLD; the
  finding → resolution map is `suite-fold-2.md`, same dir): the D1 member shape declares `report`
  (F2), member admission is the wave.mjs member laws PLUS the path-scope class (F12), and D3's
  messageOnSpawn delivered-keying is tightened — a delivery counts ONLY on `delivered > 0 &&
  typeof messageId === 'string'` (F1). v1.1 folds `contract-redteam.md` (the issue #114 red-team
  report, same dir —
  verdict NOT FOLD-READY) into the v1.0 contract. All six blockers **B1–B6 are folded** (no
  deferrals); open question 2 is folded NOW (the verb is `waves run` / `baton_waves_run`, the
  family plural); open questions 1 and 3 are deferred with the red-team's pins absorbed into
  D3/D4. The §0 citation corrections are applied (GT1 default finalization is `none`; GT2 lists
  six drivers, not five; D3's `worker_spawning` is spec-not-shipped — a depending-on-#97 row).
  The MCP `stateFailureCode` allowlist becomes contract-required work (B3). The blocker → change
  map for BOTH phases is `contract-fold.md` (same dir).
- **Frame:** operator directive 2026-08-06 ("why haven't you moved to an improved control surface
  or a DSL"); the composition law (`docs/PROGRESS.md:391` — verified `sed -n '385,395p'`: "no new
  orchestration wave may require a new script file"); six bespoke drivers as the pattern's receipts
  (bd3-live-acceptance, spec-wave, suite-wave, blueteam-wave, fold-wave, dynamic-workflow demo —
  all under `docs/reference/evidence/`). The recorded receipts are mixed: `BD3-LIVE-OK`,
  `BLUE-WAVE-OK`; `SPEC-WAVE-INCOMPLETE`, `SUITE-WAVE-INCOMPLETE`, `DYNAMIC-WORKFLOW-INCOMPLETE`
  — the incomplete harvests are the on-disk evidence for blocker B1.

## Ground truths (verified against HEAD 3953f81)

1. The wave driver's shipped steering vocabulary is `steering: 'nudge-on-checkpoint'` + the
   poll/stall/hardcap knobs, with `finalization` defaulting to **`none`** (`claim-on-stall` is
   opt-in vocabulary, not the shipped default — red-team §0 GT1 correction).
2. The bespoke drivers' variance is exactly three axes: (a) the member set (roles, seats,
   scopes, objectives), (b) extra steering behaviors (message-on-spawn, elevate-when-notes,
   answer-decisions, signal-on-members-done — the #94 demo's four), (c) the harvest spec
   (which files to recover from the wave's results and how to match them).
3. `baton.recipes.implementContract` (recipes.mjs) proves a recipe is data + closed run
   options over the wave machinery — the embedding point for the generalized form.
4. The module-load side effect is real and bitten: every bespoke driver executes at import
   (a duplicate fold wave launched accidentally by importing one, 2026-08-06, killed).
5. Objectives over the recipe's 4096-byte rendered cap hit `recipe_oversize` (#101 — the
   cap that refused a wave at render); objectives must come from files by reference.
6. #97's typed `worker_spawning` refusal is **spec-not-shipped at HEAD** — the live
   `run.message.send` returns `worker_not_active`/`run_not_active`, never `worker_spawning`.
   The retry vocabulary is a **depending-on-#97 row**; the real receipt is the demo's retry
   pattern (`run-dynamic-workflow.mjs:218-230` — verified: a real `messageId` marks sent,
   otherwise deferred) (red-team §0 D3 correction).
7. `stateFailureCode` (`mcp-northbound.mjs`) preserves `application_*`, `worker_policy_*`,
   `run_orchestrator_*` and an explicit allowlist — none of the five `workflow_*` codes are on
   it today, so a `workflow_*` refusal degrades to `command_outcome_unknown` on the MCP wire
   (red-team §6.1 — B3's evidence).

## Decisions

**D1 — the closed spec (folded: B4, B6).** One JSON document, validated closed at admission:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "string",
  "members": [{ "role": "string", "exact": {"harness": "…", "model": "…", "effort": "…"},
               "scope": ["paths/**"], "objectiveRef": "path/relative/to/repo",
               "report": "path/relative/to/repo" }],
  "steering": {
    "approveOnAdvertisedPlan": true,
    "nudgeOnCheckpoint": { "message": "…" },
    "claimOnStall": true,
    "messageOnSpawn": { "kind": "query", "body": "…" },
    "elevateWhenNotes": { "kinds": ["note"], "maxEntries": 3 },
    "answerDecisions": { "policy": { "synthesize": "approve" } },
    "signalOnMembersDone": { "roles": ["…"], "message": { "kind": "query", "body": "…" } }
  },
  "harvest": { "paths": ["docs/…/file.md", "impl/test/x.test.mjs"] }
}
```

**`report` is a declared member field (F2).** The bespoke drivers carry each member's report path
in the member object (`wave-driver.mjs` members carry it), and the D6 `outcomes[].resultSha`
materializes exactly as the bespoke waves' outcomes did — so the closed schema declares `report` as
an allowed member field (a member-relative path, same containment class as `objectiveRef`) rather
than refusing it as unknown. A spec that carries `report` is valid; `report` is never executed
(pure data, same as `scope`).

**`verification` is REMOVED from the schema (B4 — the recipes-lane precedent R-DC-6).** The
recipe lane already removed `verification` for exactly this reason — a schema field whose consumer
is undefined is dead schema, and a consumer that executes it is a spec-carried executable escape
that contradicts the import law (`recipes.mjs:249` — "`verification` is REMOVED (no consumer —
R-DC-6)"). Pinning it to the coordinator's pinned-verification mechanism would work (expectExit +
repo-worktree containment + `receipt.verification`), but v1 removes it: the schema stays pure data,
and verification needs ride the wave machinery's existing lanes. A spec that carries `verification`
at all refuses `workflow_spec_invalid` naming the field.

Closedness is **recursive**, at EVERY nesting level — `members[].exact`, `members[].scope[]`,
`steering.*` (each sub-object), `harvest.paths[]` — via the recipes-lane pattern
(`recipes.mjs:81-116`): `assertClosed` refuses unknown keys naming the exact field,
`assertNoFunctions` refuses a function smuggled into any known slot (e.g. a closure at
`steering.messageOnSpawn.body`), `deepFreeze` freezes the admitted spec — all three at every level.
`schemaVersion` is an enum (`1` only): a spec with `schemaVersion: 999` (or absent) refuses
`workflow_spec_invalid` naming `schemaVersion`. Member admission is the UNION of `wave.mjs`'s
member laws and `path-scope.mjs`'s path class (F12): `wave.mjs`'s `validateMember` laws (non-empty
role, reserved-role refusal, scope-array shape, `exact` shape, `objectiveRef` presence) PLUS the
path-scope class — `path-scope.mjs` alone ACCEPTS `['reports']` and rejects only NUL / absolute /
backslash / `..`-segment, so the scope admission is the union of both: a scope entry containing a
`..` segment, an absolute path, a backslash, or a NUL refuses `workflow_member_invalid` naming the
entry AT ADMISSION (no late `path_scope_invalid` crash). Every one of these violations refuses
`workflow_member_invalid`. The steering sub-schema enums are closed against the producers' own
vocabularies: message kinds `inform|query|steer` (`coordinator.mjs:6795`) and scratchpad kinds
`doubt|link|note|plan` (`coordination-store.mjs:507` SCRATCHPAD_KINDS) — a bad value refuses
`workflow_steering_unknown` naming the field and value.

Unknown fields refuse `workflow_spec_invalid` naming the field; member-level violations
`workflow_member_invalid` (role-named). Objective text never appears inline (objectiveRef only —
D5/GT5).

**D2 — the lane (folded: B3, OQ2).** `baton.recipes.runWorkflow(spec | specPath)` on the embedded
facade + `baton waves run <spec.json>` CLI verb + the MCP tool `baton_waves_run` — all three over
ONE interpreter (a recipe-family function that validates the spec, starts the wave, drives the
steering policies, harvests per the harvest spec, and returns the structured receipt). The verb is
the plural family — **OQ2 folded NOW**: `waves run` / `baton_waves_run` (the existing family is
plural on both surfaces: CLI `waves`, MCP `baton_waves_attach|start|progress|send|stop`).
The interpreter is pure evaluation over a frozen spec object — importing it executes NOTHING
(GT4's law made structural: no top-level wave start in the module graph). The loader is
`JSON.parse`-only: no `eval`, no `Function`, no `import()` of the spec path (an `import()` would
be the executable escape). The module graph must not transitively import a module with a top-level
`await openBaton(...)`.
The MCP surface's `stateFailureCode` allowlist MUST add the five `workflow_*` codes as
contract-required work (B3) — today a `workflow_*` throw degrades to `command_outcome_unknown`.

**D3 — the steering policies (folded: B5).** Each steering field maps to a closed, receipted
policy on the driver loop (all events surfaced to `receipt.steering[]` with the requestId/trigger):
- `approveOnAdvertisedPlan` — status → actions carry approve_plan → run.approve with the
  advertised digest, once per member (the demo's proven step).
- `nudgeOnCheckpoint` / `claimOnStall` — the shipped wave-driver behaviors, verbatim.
- `messageOnSpawn` — run.message.send on first-live; bounded retries **≤3 total**, keyed to a
  DELIVERED `messageId` (the driver's `refusalNudgeBudget` precedent — consumed on delivered
  acknowledgment only). A delivery counts as DELIVERED ONLY when the receipt carries
  `delivered > 0 && typeof messageId === 'string'` — messageId-presence alone is insufficient,
  because `sendMessage` mints `message:<sha256>` unconditionally and the coordinator's delivery
  chain counts a resolve-with-`{ok:false}` as delivered (F1); a delivery that throws, resolves
  `{ok:false}`, or is refused does NOT consume the budget. After the budget, a named
  `steering_message_undelivered` evidence line and STOP. Never fatal, never forever. The
  `worker_spawning` retry vocabulary is a depending-on-#97 row (GT6).
- `elevateWhenNotes` — run.scratchpad.read (task tier) → run.scratchpad.elevate with entryIds
  filtered by kinds, maxEntries-bounded, **exactly once per member per wave**, keyed durably by
  `(runId, role)` across a driver restart/attach; a typed refusal
  (`scratchpad_write_conflict` / `scratchpad_partition_exhausted`) retries **≤2**, then a named
  evidence line on final failure.
- `answerDecisions.policy` — a closed map of requestText-pattern → answer (optionId), or 'defer'.
  Match semantics: exact literal or anchored pattern, **first-match-wins** iterating the map in
  insertion order; the chosen `optionId` is validated against the live decision's `options` (or
  `allowFreeResponse` → send `text`); dedup by `(runId, requestId)`; any non-match → `defer`
  (leave for the human; the attention item surfaces). Every answer receipted.
- `signalOnMembersDone` — when the named roles reach terminal, send the message to the remaining
  members (the demo's lead-signal pattern). Terminality is monotonic — bounded (SOUND, red-team §3.4).

**D4 — the harvest spec (folded: B1, B2).** `harvest.paths` recovers per-path from the run's
**authoritative result sha** via the #99 harvest-accessor — the same section read `wave.mjs`
materialize uses (result section first, `run.inspect { depth: 'section', section: 'result' }`),
never a creatordate pin probe. `mustContain` is demoted to a **post-materialization integrity
check** (never the selection mechanism). Recovery is **waveId-bound**: the accessor reads the wave's
OWN runs (the receipt's `waveId` is the binding key), and the wave's attempt marker
(`[attempt: <salt>]`) is verified in harvested content before accepting — a wrong or parallel
wave's byte-similar pin cannot be attributed (B2). A path missing from the authoritative sha
receipts a **named `harvest_miss`** — no silent drop, no magic byte floor (the 200-byte skip that
dropped the suite-wave/spec-wave deliverables is gone). Every `harvest.paths` entry is
containment-checked (lexical resolve + `realpathSync` symlink-escape — the
`mcp-descriptor.mjs:46-72` precedent), refusing `workflow_harvest_invalid` on escape.

**D5 — objectives by reference (folded: mechanism pinned).** `objectiveRef` reads the brief from a
repo file — never inline; the recipe render cap never fires on a file (#101's class closed for this
lane). Containment is the `mcp-descriptor.mjs:46-72` lexical + `realpathSync` double check, with a
byte bound at admission (64 KiB, documented here) and `workflow_objective_ref_invalid` on
missing/oversize/escapes-repo.

**D6 — the receipt (folded: verdict/basis pinned).** `{ basis, harvest, manifestDigest, outcomes,
steering, verdict, waveId }` — the same shape the bespoke drivers hand-write today, structured.
`verdict` = outcome+harvest completeness (`'WAVE-OK'` when every member settled and every harvest
path recovered; `'WAVE-INCOMPLETE'` naming the miss otherwise). `basis` = the canonical outcome map
(`'completed'` when every member settled `result_ready`; the spec manifest digest when an
incomplete verdict forces a reference basis).

## Non-goals (v1)

The Program IR lowering (#9 — the spec is the seed, not the program); nested workflows;
conditional member graphs (v1 members start together; phases gate through answerDecisions /
signalOnMembersDone); dynamic member addition mid-wave; the tight-cell group field (lands
with #102, then composes); `harvest.onto:` subdirs (OQ3 — deferred; if added, the subdir gets the
same lexical + realpath containment as `harvest.paths`).

## Refusal vocabulary

`workflow_harvest_invalid` (containment/paths) · `workflow_member_invalid` (role-named, scope
admission) · `workflow_objective_ref_invalid` (missing/oversize/escapes-repo) ·
`workflow_spec_invalid` (field-named, recursive) · `workflow_steering_unknown` (key/enum-named) ·
all existing wave-lane codes unchanged. Named evidence lines (never silent):
`steering_message_undelivered` (receipt.steering) · `harvest_miss` (receipt.harvest).

## Contract-required work (B3)

The MCP `stateFailureCode` allowlist (`mcp-northbound.mjs`) MUST add the five `workflow_*` codes
so a `workflow_*` refusal surfaces typed on the MCP wire instead of degrading to
`command_outcome_unknown`.

## Red-first acceptance (pin groups, folded to v1.1)

- **W1** — the closed schema, recursively: every malformed field (top-level AND nested) refuses
  its named code; `schemaVersion` is an enum; scope `..`/absolute/backslash/NUL refuses
  `workflow_member_invalid` at admission; a valid spec validates.
- **W2** — re-drive the suite-wave as a spec (4 deepseek members drafting suites): the pinned
  structural shape — 4 `result_ready`, each outcome `{role, phase→result_ready}` after
  canonicalization, per-path harvest receipt keys — and zero per-wave driver script (one shared
  interpreter; the spec is the driver).
- **W3** — each steering policy fires AND its bounds hold: a member with an advertised plan gets
  approved ONCE; a checkpoint gets nudged; a spawn message lands and receipts with a delivered
  `messageId` — and a non-delivering member draws ≤3 attempts then `steering_message_undelivered`;
  notes elevate exactly once per `(runId, role)` with refires deduped; a decision gets answered
  per policy with `optionId` validated and `(runId, requestId)` dedup — a non-match defers, an
  invalid optionId refuses; the done-signal sends.
- **W4** — harvest on the #99 accessor: per-path recovery from the run's authoritative result sha,
  waveId-bound, `mustContain` a post-check (a mismatch is a named `harvest_miss`, never silent), a
  missing path receipts a named `harvest_miss`, harvest-path escapes refuse
  `workflow_harvest_invalid`.
- **W5** — the import law: importing the lane's module starts nothing (no wave, no spawn,
  no network) — a static row with a spawn/network oracle.
- **W6** — refusal constancy: the same malformed spec produces identical `{code, message}` payloads
  via a pinned accessor per surface (facade throw / CLI `body.error` / MCP
  `structuredContent.error`), with the five `workflow_*` codes in the MCP `stateFailureCode`
  allowlist as a named stage.

## Open questions

1. Whether `answerDecisions.policy` values may be a bounded expression (pattern match on the
   question text) or a closed enum map only — **DEFERRED to v2**, with the v1 pins already folded
   into D3 (exact-or-anchored match, first-match-wins insertion order, optionId validation).
2. Whether the CLI verb is `baton wave run` or `baton waves run` — **FOLDED NOW**: `waves run` /
   `baton_waves_run` (the family plural).
3. Whether the harvest spec gains `onto:` (harvest into a subdir) in v1 — **DEFERRED** (additive,
   non-blocking; the subdir must get the same lexical + realpath containment as `harvest.paths`).
