# suite-draft-notes — row-suite-170 (#170 workflow-DSL red-first suite)

[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]

**Source of truth:** `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` **v2
FOLDED**. The worktree snapshot (`e371f70`, "Baton private effective-tree snapshot") PREDATES the
fold commit (`30e1e73`), so the folded contract is not on disk in this worktree — every citation was
read from the main repo checkout at `master` (`30e1e73`), which is byte-identical to the fold output.
The red team is `redteam-170.md`, the fold map `fold-170.md`, the original brief
`contract-170-brief.md` (all read from the same checkout). The suite law that binds this row is
`suite-foundry-2026-08-13-c/foundry-brief.md` (wave-c).

## Deliverable

`impl/test/workflow-dsl-red.test.mjs` — 31 tests: 5 PIN rows (green at HEAD) + 26 capability rows
(red at HEAD at a NAMED stage). **Every contract pin (P1–P10, R1–R10, S1–S5) is a row at its named
stage** — plus the OQ6 registry-seam pin and the five PIN-* invariant rows. Compiler-seam assertions
(`compileWavefile` / `WAVEFILE_DIRECTIVES` via a dynamic namespace import that throws the named stage
`workflow_dsl_compile_missing` while the module is absent) plus static source-scan rows and
registry/CLI rows (ORDER/EXISTENCE/byte-string only — no absolute line-window anchors, #166).
Hermetic: `mkdtemp` repoRoot fixtures with `t.after`/`finally` cleanup, no network, no provider
spawns, no host state, no clock. Sorted-key literals in actual sorted order, no `localeCompare`.

## Row inventory

| Row | Kind at HEAD | What it guards |
|---|---|---|
| PIN-A | **PIN (green)** | interpreter string path stays JSON-only — a non-JSON `.dsl` file refuses `workflow_spec_invalid` "not valid JSON" (R10's substance, G2 consequence) |
| PIN-B | **PIN (green)** | the interpreter admission-time `workflow_*` family is exactly the 5 codes the DSL reuses — no new allowlist entry (G5) |
| PIN-C | **PIN (green)** | the interpreter closed field sets (SPEC/MEMBER/EXACT/STEERING) are the exact totality target the DSL must cover (G1) |
| PIN-D | **PIN (green)** | `admitSpec` fixes `schemaVersion` exactly 1 and defaults harvest to `{ paths: [] }` (S2's interpreter-side ground truth) |
| PIN-E | **PIN (green)** | the MCP `LANE_CRAFTED` arm forwards `cause?.detail` — the wire leg the compiler's triple rides (P9's seam exists at HEAD) |
| P1 | **capability (RED)** | `admitSpec(compileWavefile(text, {repoRoot}))` does not throw; `canonicalJson(admitSpec(…)) === canonicalJson(compileWavefile(…))` for Appendix A + minimal wavefile |
| P2 | **capability (RED)** | wave-level `scope` expands into every member lacking an override; a member `scope` overrides only itself; Appendix A compiles byte-for-byte to the committed fixture `workflow-dsl-foundry-roundtrip.json` |
| P3 | **capability (RED)** | no deeper inheritance: repeated top-level `scope` accumulates (fold A2), a member scope is own-or-copy never a merge, no route/steering/harvest defaults |
| P4 | **capability (RED)** | `WAVEFILE_DIRECTIVES` covers all 16 directives / every closed field; `schemaVersion` is never authorable |
| P5 | **capability (RED)** | compile-level totalness: a DSL text compiles; a non-`{`, non-`wave` first token (incl. `[`) refuses `workflow_spec_invalid` with `expected: 'wave <key>'` (D2 sniffing) |
| P6 | **capability (RED)** | surfaces parity: CLI `baton waves compile` verb, bus `waves_compile` transport + `specDsl`, MCP `baton_waves_compile` tool, facade `baton.waves.compile` — the identical text rides every surface |
| P7 | **capability (RED)** | the compile seam is pure + idempotent (double compile byte-equal) and exposes no wave-starting surface (`runWorkflow`/`run`/`start` absent) |
| P8 | **capability (RED)** | generated-docs row: `renderWavefileGrammar()` renders the directive table; the `surface-conformance` main gains the wavefile leg |
| P9 | **capability (RED)** | MCP #160 triple: `baton_waves_run` gains `specDsl` and dispatches through the seam so the typed code + `detail` reach the MCP wire |
| P10 | **capability (RED)** | web #160 triple (**GATED on #160 R3**, contract N1): `specDsl` admitted + the pre-TypeError `workflow_*` prefix arm lands |
| OQ6 | **capability (RED)** | registry seam: `waves.compile` canonical operation lands on `['embedded','mcp','cli','web']` with `effect: 'observe'`; `waves.run` gains `web` (OQ6) |
| R1 | **capability (RED)** | unknown directive → `workflow_spec_invalid {line, field: 'memberr', expected: '<closed directive list>'}` |
| R2 | **capability (RED)** | member missing exact fields → `workflow_member_invalid {field: 'exact.harness', expected: 'harness|model|effort'}` (first-missing-field-wins, folded R2 order) |
| R3 | **capability (RED)** | member with no scope + no wave default → `workflow_member_invalid {field: 'member <role>', expected: 'non-empty scope'}` |
| R4 | **capability (RED)** | duplicate role → `workflow_member_invalid {field: 'member <role>', expected: 'unique role'}` |
| R5 | **capability (RED)** | `messageOnSpawn async` → `workflow_steering_unknown {field: 'messageOnSpawn.kind', expected: 'inform|query|steer|brief|result'}` |
| R6 | **capability (RED)** | `elevateWhenNotes doubt,secret` → `workflow_steering_unknown {field: 'elevateWhenNotes.kinds', expected: 'doubt|link|note|plan'}` |
| R7 | **capability (RED)** | bare-directory scope → `workflow_member_invalid {field: 'scope', expected: '"<dir>/**"'}` |
| R8 | **capability (RED)** | absolute harvest path → `workflow_harvest_invalid {field: 'harvest.paths[0]', expected: 'non-empty path in the repo path class'}` |
| R9 | **capability (RED)** | `wave "bad key!"` → `workflow_spec_invalid {field: 'idempotencyKey', expected: '<IDEMPOTENCY_PATTERN>'}` |
| R10 | **capability (RED)** | HEAD seam: the application `runWorkflow` sniffs + compiles a wavefile path (and admits inline `specDsl`) — the seam that flips the current "not valid JSON" refusal green |
| S1 | **capability (RED)** | compiler body has no `eval(`/`new Function`/`import(` and no fs-read surface; only `realpathSync` (repoRoot-gated) permitted |
| S2 | **capability (RED)** | every emitted IR has `schemaVersion === 1` and no `driver` field (incl. after `admitSpec`) |
| S3 | **capability (RED)** | three-way invariant: the generated `WAVEFILE_DIRECTIVES` set equals the compiler accepted set and is a subset of the documented 16-directive table (#159) |
| S4 | **capability (RED)** | `WAVEFILE_DIRECTIVES` is disjoint from the baton-attached dispatch surface (`attempt`/`salt`/`runId`/`waveId`/`lane`/`driver`/`cadence`/`projection`) |
| S5 | **capability (RED)** | compiler closed constants (`IDEMPOTENCY_PATTERN`, `MAX_MEMBERS`, `MESSAGE_KINDS`, `SCRATCHPAD_KINDS`) equal the interpreter's byte-for-byte (or a shared closed module) |

Every contract pin is a row — nothing deferred. P10 is a red capability row whose named stage records
the #160 R3 gate (`stage[web-triple-gated-on-160r3]`): it stays red until BOTH the DSL seam and the
#160 pre-TypeError arm land, which is the contract's own N1 sequencing, not a row omission.

## Stage table — every row at its named stage (pins green at HEAD, capabilities red)

Each test name carries its canonical named stage (`<ROW> [<stage>]`); the assertion messages carry
the granular stages below. "Fails a plausible wrong impl that…" is the pin-audit column.

| Row | Kind | Named stage(s) | Reading at HEAD `e371f70` | Fails a plausible wrong impl that… |
|---|---|---|---|---|
| PIN-A | PIN | `stage[interpreter-json-only]` | **green** — the interpreter string path `JSON.parse`s and refuses the `.dsl` text "not valid JSON" | moves the DSL compile INTO the interpreter (breaking D4's byte-unchanged / seam-at-surfaces law) |
| PIN-B | PIN | `stage[closed-refusal-vocabulary]` | **green** — the 5 admission codes are the only `workflow_*` admission constructors | mints a 6th admission code (allowlist churn, G5) |
| PIN-C | PIN | `stage[closed-field-sets]` | **green** — SPEC/MEMBER/EXACT/STEERING byte-strings match the contract's G1 | changes the interpreter's closed field set (the DSL mirror target drifts) |
| PIN-D | PIN | `stage[schemaVersion-fixed]` | **green** — `raw.schemaVersion !== 1` refuses; emit fixes `schemaVersion: 1`; harvest default `{ paths: [] }` | lets the interpreter emit a different schemaVersion or a non-empty harvest default |
| PIN-E | PIN | `stage[mcp-lane-crafted-detail]` | **green** — the MCP arm forwards `cause?.detail` | drops the `cause?.detail` forward (the P9 wire leg dies) |
| P1 | capability | `stage[workflow_dsl_compile_missing]` / `stage[workflow_dsl_admission_seam_missing]` / `stage[roundtrip-*]` | **RED** — compiler absent; `admitSpec` not exported | emits an IR `admitSpec` rejects, or that canonicalizes differently after admission |
| P2 | capability | `stage[appendix-a-roundtrip]` / `stage[scope-default-*]` / `stage[foundry-fixture-committed]` | **RED** — compiler absent | collapses the five scopes wrong, bleeds a member override into a sibling, or never commits the immutable fixture (B2) |
| P3 | capability | `stage[no-deeper-*]` | **RED** — compiler absent | merges a member scope with the default, invents a route/steering/harvest/driver default, or drops the A2 accumulation |
| P4 | capability | `stage[total-coverage-*]` | **RED** — compiler absent | omits a directive from `WAVEFILE_DIRECTIVES` or makes `schemaVersion` authorable |
| P5 | capability | `stage[sniffing-*]` | **RED** — compiler absent | guesses by extension/heuristics, accepts `[` as JSON, or fails to require `wave` first |
| P6 | capability | `stage[surfaces-parity-*]` | **RED** — `waves compile` verb absent; no `waves_compile` transport / `baton_waves_compile` tool / `waves.compile` method | lands the seam on only some surfaces, or as a bolted-on field instead of a new command/tool (DR-2) |
| P7 | capability | `stage[compile-seam-*]` | **RED** — compiler absent | makes compile non-deterministic or exports a wave-starting surface (the seam stops being read-only) |
| P8 | capability | `stage[generated-docs-*]` | **RED** — no `renderWavefileGrammar` / no conformance wavefile leg | hand-writes the directive table (breaks the #159 single-source invariant) |
| P9 | capability | `stage[mcp-triple-*]` | **RED** — no `specDsl` on `baton_waves_run`; no compile in dispatch | bolted `specDsl` onto the wrong tool, or drops the `detail` wire leg (B4) |
| P10 | capability | `stage[web-triple-*]` | **RED** — no `specDsl`; no pre-TypeError `workflow_*` arm (still `invalid_command`) | leaves the TypeError-name arm destroying bare `workflow_*` into `invalid_command` (#160 R3) |
| OQ6 | capability | `stage[registry-seam-*]` | **RED** — no `waves.compile` row; `waves.run` lacks `web` | registers `waves.compile` with a wrong surface set (ghost row), a non-`observe` effect, or fails to add `web` to `waves.run` (OQ6) |
| R1–R9 | capability | `stage[<refusal>-*]` | **RED** — compiler absent | drops the `{line, field, expected}` triple, or the `detail` wire leg (B4), or names the wrong field/expected (shallow-greenable) |
| R10 | capability | `stage[head-seam-*]` | **RED** — the application hands the path straight to the interpreter (JSON-only) | leaves the JSON-only string load in place so a wavefile still refuses "not valid JSON" |
| S1 | capability | `stage[no-eval-no-fs]` | **RED** — compiler absent | `eval`/`Function`/`import()`s the spec, or reads files (A4) |
| S2 | capability | `stage[no-driver-schemaVersion]` | **RED** — compiler absent | emits `driver` or a schemaVersion other than 1 |
| S3 | capability | `stage[three-way-invariant-*]` | **RED** — compiler absent | an accepted directive not in the documented table (or vice-versa) — the #159 invariant broken |
| S4 | capability | `stage[closure-*]` | **RED** — compiler absent | names a machine-minted field as a directive (the A5 closure proof) |
| S5 | capability | `stage[constants-*]` | **RED** — compiler absent | desyncs a closed constant from the interpreter (the OQ2 drift the round-trip alone cannot see) |

## Measured splits (split-twice, run from the repo root)

```
node --test impl/test/workflow-dsl-red.test.mjs
```

- **Run 1 — 31 tests, 5 pass / 26 fail** (5 PIN rows green; all 26 capability rows red at their
  named stages — the compiler-dependent rows at `workflow_dsl_compile_missing` /
  `workflow_dsl_admission_seam_missing`, the surface/registry/source-scan rows at their own stage)
- **Run 2 — 31 tests, 5 pass / 26 fail** (stable — identical split)

Green PIN rows at their named stages: `[interpreter-json-only]`, `[closed-refusal-vocabulary]`,
`[closed-field-sets]`, `[schemaVersion-fixed]`, `[mcp-lane-crafted-detail]`. Red capability rows at
their named stages: `[roundtrip]`, `[scope-default]`, `[no-deeper-inheritance]`, `[total-coverage]`,
`[sniffing]`, `[surfaces-parity]`, `[compile-seam]`, `[generated-docs]`, `[mcp-triple]`,
`[web-triple]`, `[registry-seam]`, `[unknown-directive]`, `[member-missing-fields]`,
`[member-no-scope]`, `[duplicate-role]`, `[messageOnSpawn-bad-kind]`, `[elevate-bad-kind]`,
`[bare-directory-scope]`, `[absolute-harvest-path]`, `[bad-idempotency-key]`, `[head-seam]`,
`[no-eval-no-fs]`, `[no-driver-schemaVersion]`, `[three-way-invariant]`, `[closure]`, `[constants]`.

## Judgment calls (recorded — no DECISION_REQUEST channel exists in this worktree)

1. **P1/P2/S2 depend on `admitSpec` being importable; `canonicalJson` is reimplemented locally.**
   The round-trip pin (D1/P1) is written as `admitSpec(compileWavefile(…))` — the test must reach the
   REAL validator, so the impl rung must export `admitSpec` from `workflow-interpreter.mjs` (or
   extract a shared closed/admission module, which S5 already sanctions). At HEAD it is module-local,
   so the suite reports a DISTINCT named stage `workflow_dsl_admission_seam_missing` (not the
   compiler stage) to keep the two dependencies separable for the coordinator. `canonicalJson` is a
   key-sorting presentation helper (`workflow-interpreter.mjs:58-63`, "key order is presentation,
   never identity", D1); the suite uses a byte-behavior-identical local copy so the round-trip leg
   stays hermetic without a second export dependency.
2. **R2 pins the folded first-missing-field order exactly.** The §4 R2 table says
   `field: 'member <role>'`, but the folded ordering note (R2) fixes the FIELD leg to the first
   missing field in `harness → model → effort → objectiveRef` order, with `expected` naming that
   field's closed set. The suite pins the deterministic claim (`field: 'exact.harness'`, NOT
   `objectiveRef`, when both are missing; `expected: 'harness|model|effort'` from the §3 table) — the
   "any one of the listed missing fields" reading is explicitly rejected as shallow-greenable.
3. **R3/R4 `field` leg `member <role>` is a template.** The §4 tables give `field: 'member <role>'`;
   the folded D2 defines the field leg as "the directive name … or `member <role>` for member
   refusals". The suite pins the role-bearing member leg via `/^member\s/u` (accepting the
   role-substituted `member alpha` or the template `member <role>`), because the contract never pins
   the substitution itself. `code`, `expected`, and `line` are pinned exactly.
4. **OQ6 pins `waves.compile.effect === 'observe'`.** DR-2/OQ1 makes `waves.compile` a read-only,
   admission-free inspectable seam ("it never starts a wave"), so the registry row's effect must be
   `observe` — a wrong impl giving it `control`/`application_read` is caught. The `waves.run`-gains-`web`
   half pins the OQ6 ghost-row fix (its `waves_run` bus transport already exists, G2).
5. **P5 is compile-level, not surface-level.** The full sniffing discriminator lives in the
   application `runWorkflow` seam (D2); hermetically the suite pins the compiler-side totalness that
   the sniffer relies on: a valid wavefile compiles, a `[`-leading token refuses as a wavefile at
   line 1 (`field` = first token, `expected: 'wave <key>'`), and `wave` must be first. The JSON-vs-DSL
   split's JSON half is PIN-A (green), and the seam-side flip is R10 (red).
6. **S1's `realpathSync` gate is behavioral, not a line anchor.** The suite bans the read surface
   (`readFileSync`/`readFile`/`openSync`/`fstatSync`) and `eval`/`Function`/`import(` by byte-string,
   and asserts the only fs import permitted is the gated `realpathSync`. The gating itself (symlink
   escape → `workflow_harvest_invalid` when `repoRoot` is provided) is a behavioral leg exercised by
   the round-trip rows, not a pinned line window (#166).
7. **P6/P9/P10/R10/S3 are source-scan/registry rows, not full surface e2e.** The four-surface parity
   (P6), the MCP/web wire triple (P9/P10), the HEAD seam (R10), and the generated-docs invariant (S3)
   are pinned at the seam-registration level — CLI verb via `parseBatonCli`, MCP tool via
   `mcpApplicationToolNames`, and the rest via ORDER/EXISTENCE/byte-string source scans of the exact
   symbols the contract's D4 table names (`waves_compile`, `specDsl`, `baton_waves_compile`,
   `renderWavefileGrammar`, `compileWavefile`, the `startsWith('workflow_')` arm). A full in-process
   four-surface drive would require the entire DSL impl to exist; the registration pins are the
   hermetic, red-at-HEAD equivalent and are shallow-green-proof (each names the ONE symbol the seam
   must introduce, so a wrong impl that lands a partial seam is caught).
8. **P10 is a red capability row, not a deferral.** The contract's N1 gates P10 on #160 R3 landing;
   the suite represents that as a named stage `stage[web-triple-gated-on-160r3]` that stays red until
   both the DSL `specDsl` seam AND the #160 pre-TypeError `workflow_*` arm land. This keeps "every pin
   is a row" true while recording the external sequencing honestly.

## Shared-scratchpad publish — failed; refusal recorded (campaign evidence #158)

The foundry-brief asks rows to publish notes to the `shared` scratchpad partition; a failed publish
is itself campaign evidence. Attempted from this worktree at HEAD `e371f70`:

```
node impl/scripts/baton.mjs run scratchpad write shared "workflow-dsl-170-notes"
  →  cli_invalid: unexpected argument write   (exit 0 — the refusal is the CLI's, not the shell's)
```

**Exact refusal:** the scratchpad facade at HEAD exposes only `read` and `elevate` sub-verbs
(`application-cli.mjs:1476-1511`); there is **no client-addressable scratchpad write** verb, so a
`kind=note` publish to the `shared` partition cannot be addressed from the client surface. This is
the same #158-family evidence `redteam-170.md` §6 already recorded (write-only refusal; the `shared`
scope is readable by a worker but the kernel hardcodes `worker:<id>` for writes).

## Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
