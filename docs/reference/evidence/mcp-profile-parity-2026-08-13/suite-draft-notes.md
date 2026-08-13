# #156 SUITE — red-first draft notes (mcp profile parity, v1.1 FOLDED)

[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-156]

**Suite:** `impl/test/mcp-profile-parity-red.test.mjs`
**Binding contract:** `mcp-profile-parity-contract.md` (**v1.1 FOLDED** — source of truth, this
directory; the worktree copy is stale v1.0) folded against `redteam-156.md` via `fold-156.md`.
**Verification command:** `node --test impl/test/mcp-profile-parity-red.test.mjs` (from the repo root)

## Verified split (run twice from the repo root, record of both)

| run | tests | pass | fail | note |
|-----|-------|------|------|------|
| 1 | 21 | **8** | **13** | 8 guard pins green (RG-P1..RG-P8); 13 capability rows red at their NAMED stages |
| 2 | 21 | **8** | **13** | identical — **STABLE** |

No non-assertion failures on either run (no TypeError / ERR_TEST_FAILURE / unhandled rejection).
The 13 red rows fail at the named stage carried in the first assertion of each test — every one is a
behavior assertion (`tools/list` count, dispatch result, rendered row), never a vacuous shape
assertion, so no row can green trivially. The 8 pins pass today on surfaces #156 leaves unchanged
(the conformance citizen + the two committed-artifact count pins + the four hand-pinned lists + the
combined-count pin) and must stay green under a correct impl.

## Inventory (21 rows — 13 RED / 8 PIN)

### GREEN guard pins (pass today; guard unchanged behavior + suite integrity)

Each pin is its OWN row at a NAMED stage (judgment call J9) — one plausible-wrong-impl failure
trips exactly that row, never a bundle.

| ID | Pins (contract §) | Stage / what it guards |
|----|-------------------|------------------------|
| **RG-P1** | fold record, D4 item 3 | `conformance-main-green` — `surface-conformance.mjs` executable main stays a citizen (`surface-conformance: ok`, exit 0). |
| **RG-P2** | D4 item 3 | `artifact-application-count-pin` — the committed `surface-inventory-artifact.json` `mcp.application` count equals the LIVE `mcpApplicationToolNames().length`; a surface change without artifact regeneration trips this pin. |
| **RG-P3** | D4 item 3 | `artifact-combined-count-pin` — the committed artifact `mcp.combined` count equals the LIVE `mcpCombinedToolNames().length`. |
| **RG-P4** | D1 (RG-12 row, §5) | `phase16-application-tool-list-pin` — the phase16 application tool list (:92, marker disambiguated per J6) stays equal to the live output. |
| **RG-P5** | D1 (RG-12 row, §5) | `mcp-reflex-application-tool-list-pin` — the mcp-reflex application tool list (:202) stays equal to the live output. |
| **RG-P6** | D1 (RG-12 row, §5) | `phase67-application-tool-list-pin` — the phase67 ordinary tool list (:647) stays equal to the live output. |
| **RG-P7** | D1 (RG-12 row, §5) | `phase72-application-tool-list-pin` — the phase72 listed tool list (:296) stays equal to the live output. |
| **RG-P8** | D1 (RG-12 row, §5) | `phase16-combined-count-pin` — the phase16 combined-count pin (:121) stays equal to `mcpCombinedToolNames().length`. |

### RED rows (fail today — stage: absent from this tree)

| ID | Contract § | Stage / what lands |
|----|-----------|--------------------|
| **RG-01** | D1 step 1, D3 pin 1 | `mcpApplicationCommandNames()` and `mcpApplicationDispatch()` land as exports (namespace import); served set is ACTUAL-sorted and duplicate-free; the dispatch map is frozen. |
| **RG-02** | D1 | the default application `tools/list` is 49 and includes every D3-uncovered sibling tool; set-equals `mcpApplicationToolNames()` (tools/list order ≠ sorted — set-equality, judgment call J5). |
| **RG-03** | D3, fold Amendment 2 | `webCommands − served = []` per op (the parity law, never a hand list) + construction-order anchors: `uncoveredCommands()` precedes `LIFECYCLE_ORDINARY_SIBLINGS` in source, and the table is built by `.map` over the snapshot (never hand-inlined — #159). |
| **RG-04** | D2 | `fleet_run_resume_work` / `fleet_run_retry_verification` land on combined; the application profile reaches both ops via `baton_run_resume_work` / `baton_run_retry_verification`. |
| **RG-05** | D1 step 1, D3 pin 3 | every uncovered bus command's sibling tool binds to its bus command in the frozen `APPLICATION_TOOL` map (`dispatch[tool] === command`). |
| **RG-06** | D1 spread 3, M4b | the 12 inherited siblings (source set derived from `webCommands`, never hand-listed) byte-inherit the `fleet_run_*` wire schema + annotations, carry `execution.taskSupport: 'forbidden'` and the `_meta['baton/registryDigest']` stamp; at HEAD the sibling spellings do not exist, so no schema claim can be made (the row is RED at the spelling assertion). |
| **RG-07** | D1 item 4 | the wait/follow list admits the siblings — Gate A: `baton_run_wait` is a registered tool and `timeoutMs > maxWaitMs` → `invalid_run_wait` (validateArguments bound); Gate B: `baton_run_follow` is a registered tool and a principal without the follow capability is refused `forbidden` AFTER dispatch (observe-path post-dispatch `_authority` gate). |
| **RG-08** | D2 | both fleet tools dispatch statefully: `idempotencyKey` required (`invalid_idempotency_key` when absent), a `application_resume_invalid` command-lane throw reaches the wire TYPED, and an exact retry replays the prior outcome with exactly one `application.command` dispatch (reconcilable). |
| **RG-09** | D1, D2 (RG-09 row) | combined `tools/list` = 102, serves both fleet tools + all 14 `baton_*` siblings, the siblings LEAD the ordinary prefix in definition order (contract's `webCommands` order — judgment call J4), and the set equals `mcpCombinedToolNames()`. |
| **RG-10a** | D4 item 1 | the 5 non-canonical ops (`run.status`, `run.follow`, `run.wait`, `run.resume_work`, `run.retry_verification`) each have a `['canonical', 'mcp.baton', sibling-tool]` surfaceAlias row. |
| **RG-10b** | D4 item 1 | the renderer's canonical-miss fallback byte-string `?? { key: alias.canonical, profile: 'ordinary' }` is present in `render-surface-docs.mjs`. |
| **RG-10c** | D4 | `renderMcpToolInventory()` renders each of the 5 non-canonical ops under its OPERATION key (first content cell), not the tool name — the doc half shows the resolved operation. |
| **RG-11-R** | D4 item 3 | the regenerated `surface-inventory-artifact.json` encodes `mcp.application` = 49 and `mcp.combined` = 102. |

## Stages

Every RED row carries its named stage in the first failing assertion's message (the second column
above). At HEAD the failure modes are: exports absent (RG-01/03/05), application count 35 ≠ 49
(RG-02), combined 86 ≠ 102 (RG-04/09), sibling spellings absent (RG-06/07/10a/10c), fallback
byte-string absent (RG-10b), artifact 35/86 (RG-11-R). Under a correct impl all 13 clear.

Every PIN row carries its named stage too (RG-P1..RG-P8) — green at HEAD and under a correct impl,
each tripping only the plausible wrong one it guards (a broken conformance main, a stale artifact,
a drifted hand-pinned list, a wrong combined-count pin).

## Invented surfaces (suite-chosen seams)

The contract pins **behavior**, not these JS spellings; each is the most sibling-consistent reading
of the named contract surface, and each is verified absent at HEAD so no row can vacuous-green.

- `mcpNorthbound.mcpApplicationCommandNames()` — the served-command set export (D1 step 1 / D3).
- `mcpNorthbound.mcpApplicationDispatch()` — the frozen `APPLICATION_TOOL` tool→command map.
- `LIFECYCLE_ORDINARY_SIBLINGS` + `uncoveredCommands()` — the D1 construction-order mechanism
  (source ORDER/EXISTENCE anchors in `mcp-northbound.mjs`).
- the 14 `baton_run_*` lifecycle siblings — derived via `deriveSurfaceNames(command).mcp` over the
  uncovered set, never hand-listed (#159); the 14 names are the contract's §3 closed literal.
- `fleet_run_resume_work` / `fleet_run_retry_verification` — the two D2 fleet definitions.
- the 5 `mcp.baton` surfaceAlias rows + the renderer canonical-miss fallback byte-string (D4 item 1).
- the extended wait/follow list `['fleet_run_wait', 'fleet_run_follow', 'baton_run_wait', 'baton_run_follow']`.

## Suite law (how the red-first + campaign constraints are honored)

- **Red-first / namespace imports.** `mcp-northbound.mjs` is imported `import * as mcpNorthbound`
  so the file loads today; every RED row's first assertion is behavioral. The 14 sibling names are
  never hand-listed in the suite either — they are derived from `webCommands` and
  `deriveSurfaceNames`, matching the contract's own mechanism.
- **Hermetic.** Every fixture `mkdtempSync`s under `os.tmpdir()` and is removed in `test.after`; no
  network, no provider spawns, no host state. `CoordinationStore` is a real temp-dir-backed store;
  `application` is a mock with a `commandCalls` capture and a typed-throw override.
- **No clocks as controls.** `NOW` is a fixed injected epoch; `maxWaitMs = 25_000` is the
  deployment-approved wait bound (not a test timer), `60_000` the conformance-subprocess timeout.
- **Static source anchors.** Only ORDER/EXISTENCE/byte-string assertions — never line-window
  anchors (#166): the construction-order pins, the wait/follow byte-string, the renderer fallback
  byte-string.
- **`watchdog.stallMs`.** The fixtures construct an `McpFleetServer` with a **stub** `coordinator:
  {}` — no real `Coordinator` is built, and `McpFleetServer` takes no watchdog knob (only
  `Coordinator` does, coordinator.mjs:1068-1075). The clause is vacuous for this fixture shape
  (judgment call J7).
- **Split-twice.** Two consecutive runs from the repo root, both recorded above; identical.
- **Attempt-echo.** Present verbatim in this file and in the suite header.

## Judgment calls

- **J1 (RG-08 typed-refusal oracle ambiguity).** The contract's RG-08 oracle says malformed resume
  args return `application_resume_invalid` via `stateFailureCode`, but `validateArguments`
  (mcp-northbound.mjs:948-953) collapses ANY throw from `validateApplicationCommandArgs` — including
  `normalizeResumeWork`'s `application_resume_invalid` — to `'invalid_run_command'`. Resolution: pin
  the TYPED-LANE passthrough via the mock `command()` throwing
  `Object.assign(new Error('Run resume request is invalid'), { code: 'application_resume_invalid' })`
  for a `runId: 'run-bad'` discriminator — the established reflex-test pattern. The impl must
  preserve the `application_*` code through the dispatch→`stateFailureCode` lane for the oracle to
  hold; the args-schema refusal lane (a `run.bad` shape through the validator) is the contract
  ambiguity and is intentionally NOT pinned.
- **J2 (RG-10c cell index).** The renderer emits `| \`key\` | \`profile\` | \`tool\` | effect |`;
  the operation key is the FIRST content cell (`cells[1]` after `row.split('|')`). Verified against
  the current renderer before pinning.
- **J3 (RG-07 byte-string + behavioral gates).** The extended-list byte-string is asserted
  `>= 1` occurrence, NOT `>= 2`, so a correct impl that extracts a shared constant does not
  false-fail; both gates are instead proven behaviorally — Gate A (`baton_run_wait` over the bound →
  `invalid_run_wait` at the validateArguments site) and Gate B (`baton_run_follow` for a
  control-only principal → `forbidden` at the observe-path post-dispatch `_authority` site).
- **J4 (RG-09 sibling order).** "The 14 siblings lead the ordinary prefix" in **definition order**
  — the contract's `webCommands` = `Object.entries(APPLICATION_COMMAND_DEFINITIONS)` iteration
  order — NOT sorted. The contract's 14-row table (lines 119-134) is explicitly illustrative (QA
  M1) and does not match the definition order; `uncoveredCommands()` preserves definition order, so
  a faithful impl spreads the siblings in that order.
- **J5 (tools/list order ≠ sorted names).** `tools/list` yields `baton_help` first while
  `mcpApplicationToolNames()` sorts `baton_application_help` first; all cross-checks use SET
  equality, never array deep-equal on order (RG-02, RG-09, RG-12).
- **J6 (RG-P4 phase16 marker disambiguation).** `assert.deepEqual(response.result.tools.map((tool) =>
  tool.name), [` matches BOTH phase16:68 (the 19-tool fleet list) and :92 (the 35-tool application
  list); the marker is extended to include the first element `'baton_help'` so it anchors :92 only.
- **J7 (watchdog vacuity).** Recorded above — no real Coordinator in these fixtures, so the suite
  law's `watchdog.stallMs` clause is vacuous; noted for the coordinator's lint.
- **J8 (construction-order closure).** The mechanism is pinned directly by the ORDER/EXISTENCE
  anchors (RG-03) AND closed by the rows: if an impl computed `uncoveredCommands()` after the spread
  (returning `[]`), `LIFECYCLE_ORDINARY_SIBLINGS` would be empty and RG-02/RG-06/RG-09 would fail on
  the sibling spellings — so the D3 law cannot pass vacuously.
- **J9 (every pin its own row).** The two original compound PIN tests (RG-11P: 3 assertions, RG-12:
  5 assertions) were split into 8 single-purpose pin rows (RG-P1..RG-P8), each carrying its NAMED
  stage in the first assertion's message. Rationale: a wrong impl that breaks exactly one pinned
  fact trips exactly that row — the red list names the precise regression — and a row whose guard
  clears cannot green the bundle by accident. The split does not change what is pinned, only the
  failure granularity; both recorded splits (21 tests / 8 pass / 13 fail) are identical and stable.

## Shared scratchpad publish attempt (#158) — REFUSED, recorded as campaign evidence

Per the foundry brief, this row attempted to publish these draft notes to the `shared` scratchpad
partition (kind `note`, title `#156`) as the work progressed. The publish **failed** — the shared
write lane is RED at HEAD. The exact refusal, captured against a real temp-backed
`CoordinationStore` at HEAD `e371f70`:

- **Attempt (the #158 shared-append shape):**
  `writeScratchpad({ runId, taskId, workerId, entry: { kind: 'note', text: … }, scope: 'shared' },
  { actor: 'worker', principalId, key })`
  → **REFUSED** `code = "scratchpad_write_invalid"`,
  `message = "scratchpad write envelope is invalid"`.
  The kernel envelope validator (`coordination-store.mjs:14065-14068`) requires exactly
  `['runId', 'taskId', 'workerId', 'entry']` — a `shared` scope is not expressible, so the shared
  tier cannot be addressed.
- **Control (the only expressible shape):** the same fields WITHOUT the `scope` field → ACCEPTED
  but bound to `scope = "worker:worker-row-suite-156"` (`coordination-store.mjs:14103` hardcodes
  `worker:${fields.workerId}`). The lane exists but can never reach `shared`.
- **Surface gap:** the `run.scratchpad.append` verb itself is absent from the application dispatch
  at HEAD — `application.mjs:12522-12523` routes only `run.scratchpad.read` / `run.scratchpad.elevate`
  (the #158 G1 gap; the folded contract at `scratchpad-write-contract.md:32-47`).

This row therefore has no shared-partition publication; the notes exist only in this evidence dir
in the row worktree, per the #174 law, until the wave settles.

## Non-arbitrary numeric pins

`49` and `102` are the contract's folded profile counts (D1/D2/D4 — derived from the 14 uncovered
bus ops on the application/combined profiles), not control limits. `maxWaitMs = 25_000` is the
deployment-approved wait bound (not a control on work). `60_000` is the conformance-subprocess
`execFileSync` timeout (a process watchdog, not a workflow control).
