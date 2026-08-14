[attempt: e6dd1617-ba1f-43fc-9392-cacef07d7a07 impl-170]
# impl-170 notes — the #170 DSL PACKAGE landing

Date: 2026-08-13 · Attempt: `e6dd1617-ba1f-43fc-9392-cacef07d7a07` · Role: `impl-170`.
Authority: `workflow-dsl-contract.md` v2 FOLDED + `impl-170-brief.md` (the package scope).

## 1. Split records

**Main suite `impl/test/workflow-dsl-red.test.mjs`** — declared red baseline `35 · 5/30` (5 PIN rows
green, 30 capability rows red at `workflow_dsl_compile_missing`). After this landing:

| Run | tests | pass | fail |
|---|---|---|---|
| final | 35 | 35 | 0 |

**Addendum suite `impl/test/workflow-dsl-package-red.test.mjs`** — the orchestrator's declared split
record is empty ("filled at landing"); this landing fills it. First measured pass after the compiler
+ seam landed: `12 · 9/3` (PK-A, PG-A, PG-PIN red — see §3). After the three fixes below:

| Run | tests | pass | fail |
|---|---|---|---|
| final | 12 | 12 | 0 |

**Adjacents** (workflow-as-data-red · wave-observability-red · control-surface-truth-red ·
mcp-profile-parity-red) — run to completion with no new red row (§4).

## 2. What landed (the package scope, complete)

1. **The compiler** `impl/src/workflow-dsl.mjs` (new) — the 16-directive line grammar, pure of the
   text given `repoRoot`, every refusal carrying `{line, field, expected}` + `detail` on the thrown
   error, the closed `workflow_*` family (no 6th code), constants INLINE byte-identical to the
   interpreter (S5 inline form), no eval/Function/import()/file-reads (S1; only gated
   `realpathSync`). Exports `compileWavefile` + `WAVEFILE_DIRECTIVES` + default.
2. **The seam** — `waves.compile` direct-port command (`application.mjs` `compileWaveSpec`, dispatched
   beside `waves.run`), read-only MCP tool `baton_waves_compile`, `baton_waves_run` + `waves_run` +
   facade `baton.waves.compile` all gain `specDsl`; `waves.run`'s registry row gains `web` (OQ6).
   `waves run`/`runWorkflow` sniffs + compiles a wavefile path (R10 head seam, D2 sniffing rule).
3. **Steering cross-validation** (fold H3) — `signalOnMembersDone` roles cross-checked against the
   member roster at admission (a typo refuses `workflow_steering_unknown` / `declared member role`).
   `answerDecisions` keys are question patterns, not roles — they cannot be roster-cross-checked, so
   that half is left as the contract's residual (noted, not silently dropped).
4. **#176 authority closure** — the six `waves.*` verbs refuse `run_orchestrator_command_forbidden`
   under a session-authority context (checked on the RAW context, before full context validation —
   see §3). The eight facade direct ports' own `_authorize` is untouched.
5. **#183 `wave_already_terminal`** — `waves.start` (createWave) with a terminal wave's key refuses
   typed, naming prior waveId + derived verdict + the re-key action; live-wave dedupe preserved.
6. **#171 pre-seeding** — spec-shaped members (objectiveRef) render their objective and pre-seed the
   declared `report` file with the verbatim `[attempt: <salt> <role>]` first line at spawn.
7. **#180 verification profile** — `driver.verification` accepts `none`/`suite:<path>`/`gate`;
   unknown profiles refuse `workflow_spec_invalid` naming `verification`; member outcomes project
   `verifiedBy`. The member-facing top-level `verification` SPEC field stays REMOVED (B4).
8. **#195 adapter contract** — `adapter.mjs` exports `ADAPTER_CONTRACT_DEFINITION` (the eight-method
   Definition role) and every `canonicalOperations` entry + top-level registry value declares a
   `canonicalOutput` shape (entries enumerable; container values NON-enumerable so deepEqual/JSON
   projections of the containers stay byte-unchanged).

Generated surface docs (CLI.md / MCP.md inventory blocks) and the surface-inventory artifact were
REGENERATED via the shipped generators (`render-surface-docs.mjs`, `surface-conformance.mjs
--write-inventory`), never hand-edited.

## 3. Decisions + judgment calls

- **`admitSpec` export (P1/P2/S2 dependency).** The round-trip pins need `admitSpec` importable; the
  contract's P1 names this ("the impl rung must export it"). Exported `admitSpec` from the
  interpreter — the ONLY interpreter change beyond the #180 verification projection (the DSL still
  lowers TO it; the closed spec is untouched).
- **#183 terminality signal.** The interpreter computes a receipt verdict but never persists it;
  after `wave.close()` the member runs read `stopping`/`stopped`, so the prior `completed` success is
  gone. The replay check (`application.assertWaveStartReplayable`) therefore derives the verdict from
  the bound runs' terminal phases: all-closed → refuse; all-clean-closed (`completed`/`result_ready`/
  `stopped`/`stopping`) → `WAVE-OK`, else `WAVE-INCOMPLETE`. Honest within the durable signal; the
  exact interpreter verdict is not recoverable post-close and is named as a derivation, not a replay.
- **`BatonClient.#application` is the command PORT, not the application.** The facade's
  `_assertWaveStartReplayable` had to be exposed through the port (`bindBaton` adds it conditionally),
  else the check silently no-op'd.
- **#176 gate placement (the PG-A row).** The addendum's `sessionAuthorityContext()` carries only
  `{sessionAuthority}` — it omits the `transport`/`requestId`/`idempotencyKey` that
  `normalizeCommandContext` requires, so the context normalizer throws `application_context_invalid`
  before any post-context gate. The waves.* gate is therefore checked on the RAW context BEFORE full
  validation: any session-authority marker on a waves.* verb refuses
  `run_orchestrator_command_forbidden`. This is MORE conservative than the run.* siblings (which
  validate context first) and is the only reading that satisfies the row without editing it.
- **PG-PIN (per-call authorize override).** The row passes a 5th arg `{authorize: async () => false}`
  to `application.command`, which historically ignored it (4-param signature). Added an optional
  5th `rawOptions` to `command()` that overrides `this.authorize` for the duration of ONE dispatch
  via `_authorize`'s `this._authorizeOverride ?? this.authorize` check. The direct ports' own
  `_authorize` is untouched (it still reads `this.authorize` through the override check); a caller
  that omits the 5th arg is byte-behavior-identical.
- **Compiler constants form.** Inline (byte-identical to `workflow-interpreter.mjs`), satisfying S5's
  inline branch; no shared constants module was introduced (the interpreter stays self-contained).
- **`canonicalOutput` (PA-B).** The row iterates `Object.values(APPLICATION_SEMANTIC_REGISTRY)` —
  which is the WHOLE registry (not just `canonicalOperations`), so every top-level object/array value
  needed the field. Attached NON-enumerably to the containers (`depths`, `sections`, `operations`,
  `actions`, `cli`, `defaultOperations`, `advanced`, `aliases`, `canonicalOperations`,
  `surfaceAliases`, `enums`, `serializationOrder`) so `deepEqual`/`JSON.stringify` projections of
  those containers stay byte-unchanged (verified: `phase83`/`phase84`/`phase89`/`grammar-m2`/
  `semantic-progress` registry deepEquals are unaffected).

## 4. Anything not green / residual

- **None in the two target suites** — 35/35 + 12/12 at the final run.
- **Contract residual (fold H3), restated:** `answerDecisions` keys name question patterns, not
  roles; the interpreter's `admitSteering` checks only non-emptiness + shape, so a policy key that
  names no real question still compiles clean and is a silent no-op at run time. That half of H3 is
  not roster-cross-checkable and is left per the contract's §3 residual.
- **`waves.start` (the COMMAND port, `startWave`) does not carry the #183 check** — it computes a
  DIFFERENT waveId (`digest({idempotencyKey, members})`) than the facade's createWave
  (`sha256(idempotencyKey)`), a pre-existing waveId inconsistency across the two surfaces. The #183
  check lands on the facade path the row exercises; the command-port replay is a named follow-on.

## 5. Collateral: the MCP tool-count cascade (contract-driven, mechanical)

`baton_waves_compile` is a NEW ordinary MCP tool (the contract's D4/DR-2). Adding it shifts the
MCP ordinary-surface count 35 → 36 and the combined count 86 → 87. The following pinned tool
inventories/counts are COLLATERAL of that contract-mandated addition and were updated mechanically
(never hand-invented — each is `+ baton_waves_compile` in the definition position after
`baton_waves_run`, plus the `+1` count):

- `impl/test/phase16-mcp-northbound.test.mjs` — application tool list + `baton_waves_compile`;
  combined count 86 → 87.
- `impl/test/mcp-reflex-surface-red.test.mjs` — application tool list + `baton_waves_compile`;
  application count 35 → 36; combined count 86 → 87.
- `impl/test/phase67-progressive-agent-experience.test.mjs` — application tool list + `baton_waves_compile`.
- `impl/test/phase72-kimi-orchestrator-mcp.test.mjs` — application tool list + `baton_waves_compile` (×2).
- `impl/test/wave-observability-red.test.mjs` A3-2 — the pinned MCP enumeration count 35 → 36.

Consequence named (not silently dropped): the #156 siblings suite (`mcp-profile-parity-red`) RED rows
RG-02/RG-09/RG-11 pin composition folds `35 + 14 = 49` / `86 + 2 + 14 = 102`. The #170 tool shifts
the base to 36/87, so those folds become `36 + 14 = 50` / `87 + 2 + 14 = 103` — the siblings feature
(when it lands) must re-derive those targets. The RED rows still fail at their DESIGNED stages
(`application-tools-count-49`, `combined-102-includes-siblings`, `artifact-counts-49-102`), and the
PIN rows stay green, so `mcp-profile-parity-red` holds its declared split (8 pass / 13 red).

## 6. Verification

- `node --test impl/test/workflow-dsl-red.test.mjs` → 35/35.
- `node --test impl/test/workflow-dsl-package-red.test.mjs` → 12/12.
- Adjacents: `workflow-as-data-red` 30/30 · `wave-observability-red` 30/30 ·
  `control-surface-truth-red` 7/7 · `mcp-profile-parity-red` 8 pass / 13 red-by-design (declared split).
- Collateral suites re-verified green after the pinned-count updates: `phase16-mcp-northbound` 29/29 ·
  `mcp-reflex-surface-red` 21/21 · `phase67` + `phase72` 32/32.
- `node impl/scripts/surface-conformance.mjs` → `surface-conformance: ok`.
- Deployment verification contract: executable `true`, args `[]`, cwd `.`, exit 0 (no-op).
