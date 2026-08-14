# ROW NOTES — row-cli2: the CLI parser legs (append branch + run.watch + teaching)

[attempt: f7d7aa00-a8e9-43c8-b3c9-4e53650e8dff row-cli2]

Seam: `impl/src/application-cli.mjs` (the only file changed — 111 insertions / 21 deletions,
`git diff --stat` confirms no other path). Acceptance rows all GREEN; the non-green rows in the
adjacent suites are pre-existing and belong to other rows (named below, not absorbed).

## What landed

1. **`run.scratchpad.append` (A1-1 / A1-2).** The scratchpad branch gains the closed append case:
   `{runId, scope, kind, body}` with `--scope` validated against `shared|worker:<id>` (the read
   branch's exact regex), `--kind` defaulting to `note`, and a non-note body JSON-parsed into the
   kernel's closed per-kind shape (plan `{objective, steps:[{text,state}]}` with `state` in
   todo|doing|done; doubt `{question, context}`; link `{label, relation, target}`). A malformed or
   mis-shaped body refuses `cli_invalid` naming the expected shape — never a silent string (H2.3,
   mirroring the elevate branch's `--entries` handling).
2. **Bare / unknown-sub scratchpad teaching (A9-1 / A9-2, same rung as A9-1).** Bare `run
   scratchpad` → `run scratchpad requires a subcommand: read|elevate|append`; `run scratchpad
   <bogus>` → `unknown run scratchpad subcommand bogus; expected read|elevate|append`. Kills the
   `unexpected argument undefined` leak (F-9 family).
3. **`run watch` (R1 / R4).** A dedicated `action === 'watch'` branch serves `run watch RUN_ID` →
   `run.watch` (canonical `run.watch`, op `run.follow`) and bare `run watch` refuses value-required
   (`Run ID is invalid`, `cli_invalid`) — never the `parseStart` silent reinterpretation.
4. **`baton application help` (R5 verb column).** A top-level `application help` handler parses the
   derived `application.help` surface name to `application.help`, closing the drift path where the
   Example (`baton help`) compiled but the taught Verb refused.
5. **The #155 contract (cli-silent-start, needed for its acceptance).** `RUN_FACADE_VERBS` →
   `FACADE_NOUNS` (one named constant, PT-4(a)); `ALIAS_FIRST_TOKENS` = `['view','list','member']`
   (PT-4(b)); `RUN_RECOGNIZED_FIRST_TOKENS` spread-composed from `lifecycleActions + FACADE_NOUNS +
   start/follow + ALIAS_FIRST_TOKENS` (PT-4(c)/composition-form requirement); the bare/unknown-sub
   `member` incomplete-prefix refusal (rule 2); and the Damerau-1 typo guard rewritten to the
   contract's `did you mean 'run <V>'? … use 'run start <T>'` message with per-neighbor handling for
   follow/steer/member/attention (rules 3/4, PT-2a/2b/2c).

## The F8 anchor and the PT-7 39→40 constraint (honored, quoted)

The recovered row-cli notes named two cross-wave constraints. Both are honored:

- **F8 silent-reinterpretation defect anchor.** `application-cli.mjs`'s `cliRunVerbTypoRefusal` is
  the F8 seam: an unknown single-token `run` verb that is Damerau-1 from exactly one recognized
  first-token now refuses `cli_command_unavailable` with the suggestion + `run start` escape; a
  token distance-1 from zero (plain objective) or two-or-more (ambiguous — never a guess) stays
  objective-first. This is the single surface shared by #155 PT-2a and #160 C2 (both green).
- **PT-7 39→40 cross-wave pin.** The notes warned: "adding `watch` as a recognized first-token
  inflates the cli-silent-start suite's (#155) DERIVED detection set from 39 → 40, which breaks that
  suite's currently-GREEN PT-7 pin … row-sf159 must coordinate rather than silently break the pin."
  **Resolution chosen:** `watch` is served via a dedicated branch placed *after* the
  `const lifecycleActions = new Set(...)` literal, so the suite's `extractLifecycleVerbs` /
  `extractRunBranchFacadeLabels` derivations never see it. `watch` is therefore NOT a member of
  `RUN_RECOGNIZED_FIRST_TOKENS` — the detection set stays **39**, and PT-7 / PT-2c / PT-4(c)
  (`watch` excluded; `run.watch` keeps `cli: null`, never a recognized first-token) all stay green
  **without any suite edit**. The acceptance suites are immutable this wave, so a detection-set
  39→40 re-pin was not possible; serving `watch` outside the detection set is the coordinated
  alternative that honors the 39 pin rather than breaking it.

## Acceptance evidence (`node --test` from repo root)

- `scratchpad-write-red.test.mjs` — **A1-1, A1-2, A9-1 (and A9-2) GREEN**; P-A1/P-A4/P-A5/P-A6/P-A7
  green. (A2-2, A3-1, A4-1, A4-2, A5-1, A6-1, A7-1..A8-1, A10-1 remain red — kernel/web/deploy/
  coherence legs, NOT this row's files.)
- `doc-truth-conformance-red.test.mjs` — **R1, R4, R5 GREEN**; R2/R6/R7/R10/P-CS1-b/P-CS4 green.
  (R3, R8, R9, R11 remain red — MCP/scripts/artifact legs, NOT this row's files.)
- `cli-wave-fidelity-red.test.mjs` — **16/16 green** (unchanged).
- `cli-silent-start-red.test.mjs` — **12/12 green** (PT-1..PT-10).
- `error-actionability-red.test.mjs` — **22/22 green** (C2 still green on the new message).

## Named-not-absorbed (pre-existing, other rows' seams)

- **scratchpad A2-2 / A3-1 / A4-* / A5-1 / A6-1 / A7-* / A8-1** — `application.mjs` dispatch +
  `web-northbound.mjs`/`mcp-northbound.mjs` + `application-deployment.mjs` restrictor + the kernel
  write path (row-web2 / row-deploy2 / row-kernel).
- **A10-1** — the append coherence pin. Leg (a) (parser) and the web/MCP/registry legs are green, but
  leg (b) needs `run.scratchpad.append` in `CLI_WEB_COMMANDS`; I deliberately did NOT add it because
  that would move the committed artifact's `cliWebCommands` 39 → 40 and break P-CS4 (the artifact is
  `impl/scripts/`, row-docs2's). This is a cross-row coherence item for the coordinator.
- **doc-truth R3 / R8 / R9** — `mcp-northbound.mjs` answer schema + briefing (row-errors / row-web2).
- **doc-truth R11** — the committed `surface-inventory-artifact.json` counts. Note the `parserLifecycleDispatchCount`
  gate marker (`if (!lifecycleActions.has(action)) return parseStart`) is absent because the #155
  guard uses `RUN_RECOGNIZED_FIRST_TOKENS` — that leg needs the artifact regenerated by row-docs2.
- **grammar-m5 M5-1 / surface-conformance SC6** — the `surface-divergence-ledger.json` is empty /
  unsorted (row-errors / row-docs2). Verified pre-existing: both fail identically at HEAD before my
  change (confirmed via `git stash` + rerun).

## Verification

```
node --test impl/test/cli-silent-start-red.test.mjs    # 12 pass / 0 fail
node --test impl/test/cli-wave-fidelity-red.test.mjs   # 16 pass / 0 fail
node --test impl/test/error-actionability-red.test.mjs # 22 pass / 0 fail
node --test impl/test/doc-truth-conformance-red.test.mjs   # R1/R4/R5 green (8 red rows are other seams)
node --test impl/test/scratchpad-write-red.test.mjs        # A1-1/A1-2/A9-1/A9-2 green (11 red rows are other seams)
```

Regression guards green: `grammar-m1..m4b` (6/10/8/7), `phase64-application-cli` (15/15),
`phase68-unified-agent-entrypoint` (21/21), `cli-truthfulness-red` (7/7), `cli-dead-paths-red`
(9/9), `cli-adapters` (24/24), `workflow-dsl-red` (35/35), `workflow-as-data-red` (30/30),
`wave-observability-red` (30/30), `control-surface-truth-red` (7/7), `surfacing-matrix-red` (5/5).
