# Issue #156 — MCP default profile as a bus superset — implementation contract

**Status:** v1.0 DRAFT
**Date:** 2026-08-13
**Verification HEAD:** `f5bf3386cb2ac8d2bcd83079a13dfd8be534d894` (current worktree HEAD at drafting)
**Brief:** `contract-156-brief.md` (this directory)
**Issue:** #156 — `gh` is not authenticated in this worktree, so the issue body was unavailable at
drafting time; the brief's decisions, the audit (`control-surface-audit-2026-08-13/
surface-audit-mcp.md`), and the code carry the requirements. Every anchor below was re-verified
against the current tree at the verification HEAD.

**Seed.** The audit's finding is the lived evidence: the documented default MCP profile is NOT a
superset of the bus. The web bus serves 14 run-lifecycle operations the default `application`
profile cannot reach — `run.status`, `run.follow`, `run.wait`, `run.approve`, `run.answer`,
`run.adopt`, `run.evidence`, `run.export`, `run.feedback`, `run.integrate`, `run.recover`,
`run.review`, plus `run.resume_work` / `run.retry_verification` which are absent from EVERY MCP
profile (`surface-audit-mcp.md:64-66`). 12 of the 14 are recoverable only by redeploying at
`combined`; 2 are hard-missing (`surface-audit-mcp.md:122, 128`). The operator posture is the
law's root: MCP is the primary agent surface, and a default that cannot approve a plan, wait for
a run, or resume a paused run forces the orchestrator to leave the surface mid-loop
(`surface-audit-mcp.md:113, 123`).

**The control law (operator, campaign) applied here.** The contract's only law is the parity law
(D1): **the default MCP profile must be a superset of the web bus, per op, mechanically derived
from the admission maps.** Everything else inherits the audit's sound core untouched — the
profile split, the M4b dual-spelling pattern, the stateful/reconcilable admission machinery, and
the web/CLI surfaces that already serve all 14 ops are NOT redesigned.

**Read-order executed.** (1) the issue — unavailable, see above; (2) the audit evidence —
`control-surface-audit-2026-08-13/surface-audit-mcp.md` in full (§1.1 parity table :14-60,
§1.2 findings :62-68, §5 steering fitness :105-115, §6 F1/F2 :121-131, §8 verdict); (3) the
profile machinery — `impl/src/mcp-northbound.mjs` (the profile tables, the `baton_*` vs
`fleet_run_*` split, the M4b alias pattern, the dispatch/authority/stateful/reconcilable
registration, `validateArguments`, the observe-path gate); (4) `impl/MCP.md` (the documented
default :46-47, :83-89) + how it is generated (`impl/scripts/render-surface-docs.mjs`);
(5) the bus-side authority — `impl/src/application.mjs` `APPLICATION_COMMAND_DEFINITIONS`
(NUL-bearing; read via `grep -an`/`sed -n` only) and `impl/src/application-semantics.mjs` (the
registry, `deriveSurfaceNames`, the `approve_plan` alias, the alias rows); (6) the test idioms —
`impl/test/phase16-mcp-northbound.test.mjs`, `impl/test/mcp-reflex-surface-red.test.mjs`,
`impl/test/phase67-progressive-agent-experience.test.mjs`, `impl/test/phase72-kimi-orchestrator-mcp.test.mjs`
(the five hand-pinned application tool lists), and the conformance gates
(`render-surface-docs.mjs --check`, `scripts/surface-conformance.mjs` — both exit 0 at HEAD).
No NUL-bearing file was opened whole.

**Cross-references (not re-specified here):** **#142** — generated docs, never hand-written (the
MCP.md tool inventory is generated from `mcpApplicationToolNames()`); **#159** — the parity pin is
mechanically derived from the admission maps, never a hand list (the doctrine this contract's D3
exists to satisfy); **M4b** (docs/36 §9) — the canonical tool rendered beside its legacy sibling,
inheriting schema/annotations/dispatch under either spelling; **M4A-3** (docs/36 §8.1) — an alias,
help, or example edit provably cannot move `authorityDigest`, which is why the D4 alias rows are a
presentation-only change. Each is cited at the decision it touches.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **The application profile is `ORDINARY_APPLICATION_TOOL_DEFINITIONS` = 35 tools** (29 legacy + 6 M4b siblings), selected at construction and named by `mcpApplicationToolNames()`. | `impl/src/mcp-northbound.mjs:690-696` (table), `:1269-1270` (selection), `:2222-2224` (`mcpApplicationToolNames()`); `scripts/surface-inventory-artifact.json:56-92` (`mcp.application` = 35) |
| G2 | **The parity gap is 14 ops, mechanically derivable.** The web bus = the 25 `web:true` commands in `APPLICATION_COMMAND_DEFINITIONS`; the application profile's served command set = the 11 unique commands in `ORDINARY_APPLICATION_ENTRIES`. Bus − served = exactly the audit's 14. Verified this session by command-level derivation. | `application.mjs:168-207` (web:true/mcp:true flags; `run.status`:183, `run.follow`:184, `run.approve`:185, `run.wait`:186, `run.answer`:187, `run.feedback`:188, `run.evidence`:190, `run.adopt`:191, `run.retry_verification`:192, `run.resume_work`:193, `run.review`:194, `run.integrate`:195, `run.export`:196, `run.recover`:197); `mcp-northbound.mjs:54-70` (`ORDINARY_APPLICATION_ENTRIES`); `scripts/surface-conformance.mjs:378-383` (`webBusNames()`); `scripts/surface-inventory-artifact.json:12` (`webBusCommands` = 25), `:202-…` (`web.bus` = 25) |
| G3 | **The two hard-missing tools already have full dispatch machinery; only the tool DEFINITION is missing.** `fleet_run_resume_work`→`run.resume_work` and `fleet_run_retry_verification`→`run.retry_verification` are admitted by `MCP_APPLICATION_ENTRIES` (both `mcp:true`), registered in `APPLICATION_TOOL`, `CAPABILITY`, `STATEFUL`, `RECONCILABLE`; `tools/call` refuses only because the name is not in `toolNames` (no definition row). | `mcp-northbound.mjs:14-16` (`MCP_APPLICATION_ENTRIES`), `:33-42` (`APPLICATION_TOOL`), `:79-86` (`CAPABILITY`), `:128-140` (`STATEFUL`), `:141-148` (`RECONCILABLE`), `:383-402` (`APPLICATION_TOOL_DEFINITIONS` — no resume/retry rows), `:1390` (`tools/call` name check); `application.mjs:192-193` (`run.retry_verification`/`run.resume_work` are `web:true, mcp:true, mcpStateful:true, reconcilable:true`); artifact has neither in `mcp.combined` (`surface-inventory-artifact.json:114-200`) |
| G4 | **The M4b pattern is the existing sibling mechanism.** Each canonical sibling inherits its legacy sibling's exact wire schema, annotations, and dispatch, so one operation is reachable under either spelling. | `mcp-northbound.mjs:23-32` (`CANONICAL_ORDINARY_SIBLINGS`, 6 rows), `:690-694` (sibling definition = `{...base, name: sibling.tool}`), `:751-754` (the M4b contract comment); `surface-audit-mcp.md:65` (the audit's "covers only 10 ops" is its count of ops already reachable under a `baton_*` spelling; the actual table is the 6 rows above) |
| G5 | **The 12 lifecycle ops have NO legacy `baton_*` base — their canonical spelling is the `fleet_run_*` definition in `APPLICATION_TOOL_DEFINITIONS`.** These 18 `fleet_run_*` rows carry `execution: { taskSupport: 'forbidden' }` (stamped by the table `.map`) but NOT `_meta`. | `mcp-northbound.mjs:383-402` (`fleet_run_start`:384 … `fleet_run_export`:401; the `.map` stamp at `:402`), `:403-685` (the legacy table that DOES carry `_meta`, stamped at `:683-689`) |
| G6 | **The bus verb semantics for the two hard-missing ops are registry-authoritative and bounded.** `run.resume_work`/`run.retry_verification` take `{runId, reason}`, `reason` max 1_024, coordinate-free (PS5); malformed args throw `application_resume_invalid` / `application_retry_invalid`; `stateFailureCode` passes every `application_*` code through verbatim. | `application-semantics.mjs:675-682` (registry `retry_verification`/`resume_work` label+summary), `:722-723` (capabilities `['resume_work','observe']`/`['retry_verification','observe']`); `application.mjs:1071-1089` (`normalizeRetryVerification`/`normalizeResumeWork`), `:1080` (the PS5 comment), `:5347, 5433` (`_authorize` on both); `mcp-northbound.mjs:201-210` (`stateFailureCode` application_* passthrough) |
| G7 | **Both conformance gates pass at HEAD.** `render-surface-docs.mjs --check` exits 0 (the generated MCP.md/CLI.md blocks are byte-current) and `scripts/surface-conformance.mjs` prints `surface-conformance: ok` and exits 0 (profile-doc parity holds at 35 application / 86 combined / 25 web). | verified this session at the verification HEAD; `render-surface-docs.mjs:145-154` (`checkSurfaceDocs`), `surface-conformance.mjs:735-745` (parity main) |
| G8 | **The 35-tool application inventory is hand-pinned in five test sites** (plus the combined-count/prefix pins). Each lists the exact 35 names and must be updated on implementation. | `impl/test/phase16-mcp-northbound.test.mjs:92-103` (application list), `:121-122` (combined = 86 + ordinary prefix); `impl/test/mcp-reflex-surface-red.test.mjs:201-215` (length 35 + list); `impl/test/phase67-progressive-agent-experience.test.mjs:647-661` (list + `additionalProperties === false` + every tool's `_meta['baton/registryDigest']`); `impl/test/phase72-kimi-orchestrator-mcp.test.mjs:296-308` and `:629-…` (two more 35-lists) |
| G9 | **MCP.md documents the application default and its kernel-control caveat; the tool inventory below is generated.** | `impl/MCP.md:46-47` (`application` is "the documented default"; `advanced`/`combined` are "explicit kernel-control deployments"), `:83-89` (the initialize prose), `:144-184` (the generated inventory block); `render-surface-docs.mjs:95-119` (`renderMcpToolInventory` — tool list from `mcpApplicationToolNames()`) |
| G10 | **The doc-parity gate enforces the generated doc's completeness.** For `mcp.application`, `checkProfileDocParity` extracts the tool column from the generated block and asserts every served tool appears; a served table that grows forces the doc to regenerate or the gate fails. | `surface-conformance.mjs:495-545` (`checkProfileDocParity`, the `mcp.application` branch at `:501-523`) |
| G11 | **The renderer resolves a tool to its operation key via `mcp.baton` surfaceAlias rows, else canonical `byDerived`, else the fallback key = the tool name.** 9 of the 14 ops are canonical (resolve cleanly); 5 are not (`run.status`, `run.follow`, `run.wait`, `run.resume_work`, `run.retry_verification`) and would fall back to showing the tool name as its own operation key. Alias rows live in `SURFACE_ALIAS_ROWS` → `presentationProjection`, which provably cannot move `authorityDigest` (and thus the tools' `_meta` stamps). | `render-surface-docs.mjs:104-115` (alias → byDerived → fallback); `application-semantics.mjs:1731` (`SURFACE_ALIAS_ROWS`), `:2020-2059` (`authorityProjection` excludes `surfaceAliases`; `presentationProjection` includes them), `:2060` (`digest: authorityDigest`); verified: the 14 canonical/not-canonical split (9 canonical, 5 not) |
| G12 | **`run.approve` is reachable on the application profile only indirectly today** — via `baton_run_act`'s approve_plan semantic action, which requires a digest-keyed `actionId` the agent must already have read out of a run view. There is no direct `run.approve`. | `application-semantics.mjs:810` (`approve_plan: 'run.approve'`); `surface-audit-mcp.md:40, 68` (the audit's "partial" verdict and finding 5) |
| G13 | **The wait/follow bounded-wait special cases are hard-coded to the `fleet_run_*` spellings** in two sites. Both must admit the new `baton_run_*` siblings or the siblings bypass the maxWaitMs bound and the observe-path authority gate. | `mcp-northbound.mjs:954-955` (`validateArguments`: `['fleet_run_wait', 'fleet_run_follow']` → `invalid_run_wait`), `:1510` (the observe-path post-dispatch `_authority` gate `['fleet_run_follow', 'fleet_run_wait']`) |
| G14 | **The 14 commands' admission facts are closed.** All are `web:true, mcp:true, reconcilable:true`; 10 are `mcpStateful:true` (`approve/answer/adopt/export/feedback/integrate/recover/review/resume_work/retry_verification`), 4 are read-only (`status/follow/wait/evidence`). Their capability classes and command args are the sibling tables' source. | verified this session from `APPLICATION_COMMAND_DEFINITIONS` (full table in §2 D1) |

---

## 2. Decisions

### D1 — The parity law and the mechanism: `baton_*` siblings for all 14 (NOT `combined` as the default)

**Choose the audit's recommendation — the default profile becomes a superset of the bus — and
reject the alternative (flipping the documented default to `combined`).** The operator's posture
(the brief's framing) decides it: MCP is the primary agent surface, and the default must not be
the crippled one. `combined` serves the kernel + reflex surface — `fleet_spawn`/`fleet_send`/
`fleet_kill`, goal/plan, board/package/REPL/knowledge (`mcp-northbound.mjs:697-754, 756-830`) —
which MCP.md documents as "explicit kernel-control deployments" (`MCP.md:46-47, 87`). Flipping the
default would balloon the trusted surface from 35 to 102 tools and contradict the documented
posture, trading a 14-op gap for an 86-tool authority expansion. The sibling extension instead
gives the ordinary surface a stable `baton_*` spelling for every bus verb, exactly as the audit's
F1 fix prescribes (`surface-audit-mcp.md:124`), reusing the M4b mechanism the audit found sound.

**The law (one direction, mechanically stated):**

```
∀ command c ∈ {n : APPLICATION_COMMAND_DEFINITIONS[n].web}:
      c ∈ { command : (tool, command, _) ∈ ORDINARY_APPLICATION_ENTRIES }
```

The application profile's served command set is a superset of the web bus, per op. The law is
one-directional because the application profile already exceeds the bus (waves M-only ops, the
workflow/knowledge families, `baton_decision_answer`, `baton_deployment_doctor` — `surface-audit-mcp.md:20-25, 51-58`); bidirectional equality is a non-goal.

**Mechanism — the siblings are derived from the admission maps at module load, never a hand
list (the #159 doctrine).** Two new derivations and one new table, all inside
`mcp-northbound.mjs`:

1. **The served-command set**, exported for the red suite (D3):
   `mcpApplicationCommandNames() = [...new Set(ORDINARY_APPLICATION_ENTRIES.map(([, command]) => command))].sort()`.
2. **The uncovered set**, computed at module load from the two admission maps:
   `uncoveredCommands() = webCommands.filter((name) => !servedCommands.has(name))` where
   `webCommands = Object.entries(APPLICATION_COMMAND_DEFINITIONS).filter(([, d]) => d.web).map(([name]) => name)`
   and `servedCommands = new Set(ORDINARY_APPLICATION_ENTRIES.map(([, command]) => command))`.
   At HEAD this is exactly the 14 ops (G2). The implementation adds a new frozen table
   `LIFECYCLE_ORDINARY_SIBLINGS` = `uncoveredCommands().map((command) => ({ key: command, tool: deriveSurfaceNames(command).mcp, source: 'fleet_' + command.replaceAll('.', '_') }))`
   — one mechanical name derivation (`deriveSurfaceNames`, `application-semantics.mjs:1130-1151`),
   one mechanical source name, no hand-written row. The 14 rows land as:

   | key | sibling tool | source definition | stateful | capability classes |
   |---|---|---|---|---|
   | run.status | baton_run_status | fleet_run_status | — | observe |
   | run.follow | baton_run_follow | fleet_run_follow | — | observe |
   | run.wait | baton_run_wait | fleet_run_wait | — | observe |
   | run.approve | baton_run_approve | fleet_run_approve | ✓ | approve+observe |
   | run.answer | baton_run_answer | fleet_run_answer | ✓ | approve+observe |
   | run.adopt | baton_run_adopt | fleet_run_adopt | ✓ | adopt_result+observe |
   | run.evidence | baton_run_evidence | fleet_run_evidence | — | observe |
   | run.export | baton_run_export | fleet_run_export | ✓ | export_result+observe |
   | run.feedback | baton_run_feedback | fleet_run_feedback | ✓ | control+observe |
   | run.integrate | baton_run_integrate | fleet_run_integrate | ✓ | integrate_result+observe |
   | run.recover | baton_run_recover | fleet_run_recover | ✓ | control+observe |
   | run.review | baton_run_review | fleet_run_review | ✓ | review+control+observe |
   | run.resume_work | baton_run_resume_work | fleet_run_resume_work (new, D2) | ✓ | resume_work+observe |
   | run.retry_verification | baton_run_retry_verification | fleet_run_retry_verification (new, D2) | ✓ | retry_verification+observe |

3. **Three registration spreads** carry each sibling onto every surface that already routes it:
   - `ORDINARY_APPLICATION_ENTRIES` (:54-70): `[tool, command, APPLICATION_COMMAND_DEFINITIONS[command]]` per sibling — this is what makes the served-command set (and the D3 law) grow.
   - `APPLICATION_TOOL` (:33-42): `[tool, command]` per sibling — this is what `_dispatch` (:1691) and `applicationArgs` (:903-912) route on.
   - `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (:690-696): per sibling, a definition built by
     `{ ...APPLICATION_TOOL_DEFINITIONS.find((tool) => tool.name === sibling.source), name: sibling.tool, _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }) }`.
     The `...source` spread inherits the `fleet_run_*` wire schema, annotations, and
     `execution: { taskSupport: 'forbidden' }` (stamped at `:402`) — the M4b "one operation, one
     schema under either spelling" claim (G5). **The `_meta` stamp must be added explicitly**:
     `fleet_run_*` sources carry `execution` but not `_meta`, and the phase67 pin asserts every
     ordinary tool carries the registry digest (`phase67:660`). The `find` reads
     `APPLICATION_TOOL_DEFINITIONS` directly (defined `:383`, before `:690`), never `TOOL_BY_NAME`
     (defined `:831`, after — a TDZ trap).
4. **The two wait/follow special-case lists admit the siblings** so the bounded-wait semantics are
   inherited, not bypassed: extend `['fleet_run_wait', 'fleet_run_follow']` to
   `['fleet_run_wait', 'fleet_run_follow', 'baton_run_wait', 'baton_run_follow']` at BOTH `:954-955`
   (the `invalid_run_wait` maxWaitMs bound) and `:1510` (the observe-path post-dispatch `_authority`
   gate).

Because `CAPABILITY` (:85), `STATEFUL` (:139-140), and `RECONCILABLE` (:147-148) are each built by
spreading `ORDINARY_APPLICATION_ENTRIES`, the three spreads above register every sibling's
capability classes, stateful idempotency, and reconcilable replay with no further code.

**The combined profile inherits the siblings automatically** — `TOOL_DEFINITIONS` is
`[...ORDINARY_APPLICATION_TOOL_DEFINITIONS, ...APPLICATION_TOOL_DEFINITIONS, ...ADVANCED_TOOL_DEFINITIONS, ...REFLEX_TOOL_DEFINITIONS]`
(`:830`), so combined serves the 14 `baton_*` siblings in its ordinary prefix plus (per D2) the 2
new `fleet_run_*` rows: 86 → 102. That is consistent with the existing design (combined already
serves both spellings where siblings exist) and requires no profile-specific branch.

**Refusal/observability (D1):** §4 (`invalid_run_wait` for the wait/follow siblings; `forbidden`
via the inherited `_authority`/`CAPABILITY` mechanism `:1325-1335`). **Acceptance pins:** RG-02,
RG-05, RG-06, RG-07, RG-12.

### D2 — The two missing tools: `fleet_run_resume_work` and `fleet_run_retry_verification`

Both are added to `APPLICATION_TOOL_DEFINITIONS` (`:383-402`), the table the combined profile
serves; their `baton_*` siblings then flow from D1. Their admission already exists (G3) — the
definitions make them real tools. The schemas mirror the bus verbs exactly (G6): the bus command
takes `{runId, reason}`, `reason` bounded at 1_024; the MCP tool adds the transport fields
`repoId` (required on every MCP tool) and `idempotencyKey` (required because both are
`mcpStateful: true`).

**`fleet_run_resume_work`** — closed schema (mirrors `run.resume_work`, `application.mjs:193`):

```
inputSchema: schema({ ...repo, ...idem, runId,
                       reason: { type: 'string', minLength: 1, maxLength: 1_024 } },
                     ['repoId', 'idempotencyKey', 'runId', 'reason'])
description: 'Restore preserved progress in a fresh task using an orchestrator-selected harness, model, and effort.'
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
```

**`fleet_run_retry_verification`** — closed schema (mirrors `run.retry_verification`,
`application.mjs:192`):

```
inputSchema: schema({ ...repo, ...idem, runId,
                       reason: { type: 'string', minLength: 1, maxLength: 1_024 } },
                     ['repoId', 'idempotencyKey', 'runId', 'reason'])
description: 'Re-run the pinned verification of the exact preserved candidate without another provider turn; candidate-failure confirmation is one-shot and instability-preserving.'
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
```

Both descriptions are the registry's own label/summary text (`application-semantics.mjs:675-682`)
— the single derivation source, so the MCP wording and the bus help cannot drift. Both carry
`execution: { taskSupport: 'forbidden' }` via the table's `.map` (`:402`).

**Capability classes and admission:** `['resume_work', 'observe']` and `['retry_verification', 'observe']`
are inherited automatically — the rows are already in `MCP_APPLICATION_ENTRIES` (`:14-16`), so
`CAPABILITY` (`:79-86`), `STATEFUL` (`:128-140`), and `RECONCILABLE` (`:141-148`) already register
them; only `TOOL_BY_NAME`/`toolNames` lacked the names. `_dispatch` routes them through
`APPLICATION_TOOL[name]` → `run.resume_work`/`run.retry_verification` (`:1691`), and
`validateArguments` (`:947-956`) projects `{runId, reason}` via `applicationArgs` and runs the
bus's own `validateApplicationCommandArgs` — the closed `{runId, reason}` shape is enforced at both
the MCP schema layer and the command layer.

**Refusal/observability (D2):** §4 (`application_resume_invalid`, `application_retry_invalid`;
`not_found` when the run is gone — all via `stateFailureCode`). **Acceptance pins:** RG-04, RG-08,
RG-09.

### D3 — The parity pin: mechanically derived, never a hand list

The red suite (suggested home `impl/test/mcp-profile-parity-red.test.mjs`) adds ONE derivation and
proves "MCP default ⊇ bus" per op with it. The bus side comes from `APPLICATION_COMMAND_DEFINITIONS`
(`web:true` — the admission map); the served side comes from the new `mcpApplicationCommandNames()`
export (the ordinary dispatch table — the admission map). Neither side is a hand list.

```js
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { deriveSurfaceNames } from '../src/application-semantics.mjs';
import { mcpApplicationCommandNames, mcpApplicationToolNames, mcpCombinedToolNames } from '../src/mcp-northbound.mjs';

const busCommands = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.web)
  .map(([name]) => name)
  .sort();
const servedCommands = mcpApplicationCommandNames();
const uncovered = busCommands.filter((command) => !servedCommands.includes(command));
assert.deepEqual(uncovered, [], 'every web-bus command is a served application command');
```

At HEAD the assertion fails with exactly the audit's 14 names in the diff (the red state). On
implementation it goes green with `[]`. The per-op proof is the diff itself: each uncovered name is
an op. A second, tool-level row closes the loop — every uncovered command's sibling tool exists at
the default (the D1 mechanism rendered through the ONE shared `deriveSurfaceNames`), so the law is
proven on tools, not just commands:

```js
const missingSibling = busCommands
  .filter((command) => !servedCommands.includes(command))
  .map((command) => deriveSurfaceNames(command).mcp)
  .filter((tool) => !mcpApplicationToolNames().includes(tool));
assert.deepEqual(missingSibling, [], 'every uncovered bus command has a default-profile sibling tool');
```

(Note: a bare `tools.length === commands.length` equality is NOT asserted — the profile serves 49
tools for 25 commands, because dual-spellings and MCP-only families legitimately exceed the
command set; the closure above is per-op, never a count equality.)

plus the two hard-missing tools' admission, also mechanical:

```js
assert.ok(mcpCombinedToolNames().includes('fleet_run_resume_work'));
assert.ok(mcpCombinedToolNames().includes('fleet_run_retry_verification'));
```

The derivation is the #159 doctrine made executable: the pin shares the exact two admission maps
the implementation derives its siblings from, so the law cannot pass while a gap exists and cannot
encode a stale hand list.

**Acceptance pins:** RG-01, RG-03, RG-05, RG-09 (§5).

### D4 — The doc half: the default-profile section teaches the final shape (generated, never hand-written)

The #142 law is already satisfied for the inventory: `renderMcpToolInventory` reads
`mcpApplicationToolNames()` (`render-surface-docs.mjs:95-119`), so adding the 14 siblings to
`ORDINARY_APPLICATION_TOOL_DEFINITIONS` regenerates the table to 49 rows with no hand edit — and the
`checkProfileDocParity` gate (`surface-conformance.mjs:501-523`) REFUSES a served tool absent from
the doc, so a stale block cannot ship. Three follow-through items make the doc teach the final
shape:

1. **Five `mcp.baton` surfaceAlias rows** so the 5 non-canonical ops resolve to their operation
   keys instead of the renderer's `key = tool` fallback (G11): `['run.status', 'mcp.baton', 'baton_run_status']`,
   `['run.follow', 'mcp.baton', 'baton_run_follow']`, `['run.wait', 'mcp.baton', 'baton_run_wait']`,
   `['run.resume_work', 'mcp.baton', 'baton_run_resume_work']`,
   `['run.retry_verification', 'mcp.baton', 'baton_run_retry_verification']`, added to
   `SURFACE_ALIAS_ROWS` (`application-semantics.mjs:1731`). These touch `presentationProjection`
   only — `authorityProjection` excludes `surfaceAliases` and `digest = authorityDigest`
   (`application-semantics.mjs:2020-2060`), so the tools' `_meta` stamps and live-session authority
   provably cannot move (M4A-3). The 9 canonical ops need no rows (`byDerived` resolves them).
2. **The prose refresh** (hand-maintained, like all prose): MCP.md's application-default blocks
   (`:46-47`, `:83-89`) must teach that the default serves every web-bus verb — e.g. "the
   documented default; it serves the full run-lifecycle and web-bus surface" — while keeping the
   kernel-control caveat on `advanced`/`combined`.
3. **Regenerate the inventory artifact** so the counts reflect the new surface: `scripts/surface-conformance.mjs`
   (`--write-inventory`, the surface-inventory-artifact.json writer) yields `mcp.application` 35 → 49,
   `mcp.combined` 86 → 102, `mcp.advanced` 19 unchanged, `web.bus` 25 unchanged,
   `webBusCommands` 25 unchanged, `applicationCommandDefinitions` 26 unchanged. The gate's
   `checkProfileDocParity` then passes against the regenerated blocks.

**Acceptance pins:** RG-10, RG-11 (§5).

---

## 3. Closed literals (ACTUAL sorted order, `localeCompare` banned)

- **The 14 sibling tool names** (each derived by the ONE shared `deriveSurfaceNames`, listed here
  as the closed set the implementation adds): `baton_run_adopt, baton_run_answer, baton_run_approve,
  baton_run_evidence, baton_run_export, baton_run_feedback, baton_run_follow, baton_run_integrate,
  baton_run_recover, baton_run_resume_work, baton_run_retry_verification, baton_run_review,
  baton_run_status, baton_run_wait` in ACTUAL sorted order.
- **The two new `fleet_run_*` definitions**: `fleet_run_resume_work, fleet_run_retry_verification`
  in ACTUAL sorted order.
- **The refusal codes (D1/D2/D4)**: `application_resume_invalid, application_retry_invalid,
  forbidden, invalid_run_wait, not_found` in ACTUAL sorted order.
- **The profile counts after implementation**: `mcp.application` = 49, `mcp.combined` = 102,
  `mcp.advanced` = 19, `web.bus` = 25.
- **The D3 derivation's closed input set**: the 25 `web:true` command names (G2) — a closed literal
  of the admission map, not a hand list; the pin never names the 14.

Each literal is its own `.sort()` result; `localeCompare` is banned.

## 4. Refusal/observability vocabulary

The new tools ride the existing typed-lane machinery; no new code family is invented. The typed
codes the surface teaches:

| Code | Meaning | Mechanism |
|---|---|---|
| `invalid_run_wait` | a `baton_run_wait`/`baton_run_follow` (or `fleet_run_*` sibling) requested `timeoutMs` above the deployment `maxWaitMs` bound | the extended `validateArguments` check `:954-955` |
| `application_resume_invalid` | `baton_run_resume_work`/`fleet_run_resume_work` args rejected by `normalizeResumeWork` (unknown field, missing `runId`/`reason`, `reason` over 1_024) | `application.mjs:1082-1089`; `stateFailureCode` passthrough `:201-210` |
| `application_retry_invalid` | `baton_run_retry_verification`/`fleet_run_retry_verification` args rejected by `normalizeRetryVerification` | `application.mjs:1071-1078`; `stateFailureCode` passthrough |
| `forbidden` | the caller's capability class does not authorize the op (e.g. `approve`, `resume_work`, `retry_verification`) | the inherited `_authority`/`CAPABILITY` mechanism `:1325-1335`, `:79-86` |
| `not_found` | the `runId` addresses no run | the inherited `stateFailureCode` allowlist `:204` |

Every code is a typed `application_*`/`stateFailureCode` lane code — an MCP agent receives the typed
code plus (for lane refusals) the sanitized message, never a generic `command_failed` and never a
private provider detail (the MN1/MN8 sanitization law, `:1516-1521`). The two wait/follow siblings
also inherit the observe-path authority gate (extended `:1510`).

## 5. Campaign-law constraints and non-goals

- **No redesign of what the audit found SOUND.** The profile split, the M4b pattern, the
  stateful/reconcilable admission machinery, the 25-command web bus, and the CLI/web surfaces that
  already serve all 14 ops are byte-identical. `application.mjs` is NOT touched — the bus admission
  maps (`APPLICATION_COMMAND_DEFINITIONS`, `normalizeResumeWork`, `normalizeRetryVerification`,
  `_authorize`) already exist and stay as-is.
- **The parity law is one-directional.** `bus ⊆ application`, never `application ⊆ bus`; the
  application profile's MCP-only families (waves, decision channel, workflow/knowledge) are
  non-goals here (they exceed the bus by design).
- **The combined profile keeps its documented posture.** `combined` remains the explicit
  kernel-control deployment; D1's siblings appear in its ordinary prefix only because the combined
  table composes the ordinary table — no profile-specific branch, no kernel surface expansion.
- **No clocks.** The change adds no timing, waiting, or concurrency behavior; the existing
  `maxWaitMs` bound is a deployment-approved bound on an existing wait op, inherited not invented.
- **No hand lists where a derivation exists.** The D3 pin, the sibling table, and the operation-key
  resolution all derive from the admission maps or the ONE `deriveSurfaceNames` (the #159/#142
  doctrine). The five test-site name lists (G8) are updated from `mcpApplicationToolNames()` /
  `mcpCombinedToolNames()` outputs, never by re-authoring names by hand.
- **Non-goals.** Making `combined` the default; bidirectional profile↔bus equality; direct
  `application_*` schema changes on the 12 existing commands; `baton_run_answer` replacing
  `baton_decision_answer` (they coexist — one is the run-lifecycle spelling, one the decision
  channel, both reach `run.answer`); touching `run.answer`'s strict `applicationAnswerSchema`
  (a #159-adjacent question, out of scope).

## 6. Red-first acceptance

Implementation begins by adding the focused red suite (suggested home
`impl/test/mcp-profile-parity-red.test.mjs`) and demonstrating that its positive rows fail against
the current machinery (no `mcpApplicationCommandNames()` export, no siblings, no `fleet_run_resume_work`/
`fleet_run_retry_verification`, no alias rows, 35/86 counts). Every red row fails at a NAMED stage
at HEAD and goes green only on the implementation. Existing suites remain unchanged and green; no
existing assertion is weakened to admit the new behavior (the five name lists are updated, not
weakened).

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| RG-01 | `mcpApplicationCommandNames()` does not exist at HEAD (the import throws). | The export exists and returns the served command set, ACTUAL sorted order. |
| RG-02 | `tools/list` on an `application`-surface server returns 35 tools, none of the 14 lifecycle names (`phase16:92-103`, `reflex:201-215`). | `tools/list` returns 49 tools including `baton_run_status`, `baton_run_wait`, `baton_run_approve`, …, `baton_run_resume_work`, `baton_run_retry_verification`; the 14 are exactly the D3 uncovered set rendered through `deriveSurfaceNames`. |
| RG-03 | The D3 parity derivation (bus commands − served commands) reports 14 uncovered names. | The same derivation reports `[]`; the red suite's positive row is green with no hand list. |
| RG-04 | `fleet_run_resume_work`/`fleet_run_retry_verification` are in no `tools/list` — application AND combined. | Both appear in combined `tools/list` (combined = 102); the application profile reaches the same ops via `baton_run_resume_work`/`baton_run_retry_verification`. |
| RG-05 | No application-profile tool can approve, adopt, evidence, export, feedback, integrate, recover, review, answer, or status a run directly. | Every web-bus command is served (D3), and each of the 14 lifecycle ops' sibling dispatches to its bus command through `APPLICATION_TOOL`. |
| RG-06 | The sibling spellings do not exist, so no schema-inheritance claim can be made. | `baton_run_status`'s wire schema byte-equals `fleet_run_status`'s (modulo `name`), `baton_run_approve`'s equals `fleet_run_approve`'s, and so on for all 12 inherited rows; each carries `execution.taskSupport === 'forbidden'` and `_meta['baton/registryDigest']`. |
| RG-07 | No `baton_run_wait`/`baton_run_follow` exists to bound. | `baton_run_wait` with `timeoutMs > maxWaitMs` returns `invalid_run_wait`; within the bound it dispatches and the observe-path `_authority` gate runs post-dispatch (extended `:954-955`, `:1510`). |
| RG-08 | Calling `fleet_run_resume_work`/`fleet_run_retry_verification` refuses at the `tools/call` name check today (`:1390`). | Both dispatch to `run.resume_work`/`run.retry_verification`; malformed args return `application_resume_invalid`/`application_retry_invalid`; `idempotencyKey` is required (stateful); an exact retry reconciles (reconcilable). |
| RG-09 | Combined serves 86 tools with no resume/retry. | Combined serves 102 tools including `fleet_run_resume_work` + `fleet_run_retry_verification`; the 14 `baton_*` siblings lead the ordinary prefix. |
| RG-10 | The generated MCP.md inventory lists 35 application tools; the 5 non-canonical ops would render as `key = tool`. | `render-surface-docs.mjs --check` passes with the 49-row generated block; the 5 alias rows resolve `run.status`→`baton_run_status`, `run.follow`→`baton_run_follow`, `run.wait`→`baton_run_wait`, `run.resume_work`→`baton_run_resume_work`, `run.retry_verification`→`baton_run_retry_verification` in the Operation column; MCP.md's prose teaches the final shape (D4). |
| RG-11 | `surface-conformance.mjs` passes today at 35/86 (a 49/102 surface is not representable). | `surface-conformance.mjs` prints `surface-conformance: ok` at 49/102; `surface-inventory-artifact.json` is regenerated (`mcp.application` = 49, `mcp.combined` = 102). |
| RG-12 | The five hand-pinned application tool lists + combined-count pins are 35/86 today. | `phase16:92-103` + `:121-122`, `mcp-reflex-surface-red.test.mjs:201-215`, `phase67:647-661`, and `phase72:296-308` + `:629-…` are updated to the 49/102 shapes, re-derived from `mcpApplicationToolNames()`/`mcpCombinedToolNames()` outputs (never re-authored by hand); `phase67:660` (every ordinary tool carries `_meta['baton/registryDigest']`) still passes because the sibling constructor adds the stamp. |

**The verification HEAD** is `f5bf3386cb2ac8d2bcd83079a13dfd8be534d894` (current worktree HEAD at
drafting); every anchor above was re-verified against it. The deployment verification command is
the brief's execution contract (executable `true`, no arguments, working directory `.`, exit code
0) — the authored change is this contract document, and the parity properties (RG-01…RG-12) are
pinned future-gate properties, not properties the current gate must yet emit.

## 7. Open questions

1. **`baton_run_answer` alongside the decision channel.** `baton_decision_answer` already reaches
   `run.answer` (`application-semantics.mjs:1895`; `surface-audit-mcp.md:41` calls the decision
   channel "the decision channel, not run.answer"). D1 adds `baton_run_answer` anyway because the
   parity law is command-level and `run.answer` is `web:true` — the served-command table must cover
   it or the mechanical derivation reports a gap. **Verdict:** add it; the two tools coexist (one
   run-lifecycle spelling, one decision channel, one op). A reviewer who prefers to treat the
   decision channel as satisfying `run.answer` must justify an exclusion in the parity law — the
   mechanical pin would otherwise fail.
2. **The doc resolution of the 5 non-canonical ops.** D4 adds 5 `mcp.baton` surfaceAlias rows (a
   `presentationProjection`-only registry touch; `authorityDigest` provably unmoved, M4A-3) so the
   generated table teaches the operation keys. The alternative — accepting the renderer's `key =
   tool` fallback — is a zero-registry change but teaches tool names, not bus verbs. **Verdict:**
   add the alias rows. Flag for the reviewer: any audit that pins the registry `presentationDigest`
   (e.g. banned-token/ordering sweeps over `SURFACE_ALIAS_ROWS`) will see the 5 rows move it; the
   authority surface cannot move.
3. **Where the 14 sibling rows live.** D1 uses a new `LIFECYCLE_ORDINARY_SIBLINGS` table derived
   from the admission maps, because the source definitions differ from `CANONICAL_ORDINARY_SIBLINGS`
   (which sources the legacy `baton_*` table; the lifecycle siblings source the `fleet_run_*`
   table and must add `_meta` explicitly). A reviewer who prefers folding them into
   `CANONICAL_ORDINARY_SIBLINGS` must extend its source resolution to `APPLICATION_TOOL_DEFINITIONS`.
4. **The parity law's boundary.** The law is measured against `APPLICATION_COMMAND_DEFINITIONS`
   `web:true` — the same admission map the web bus derives from (`webBusNames()`,
   `surface-conformance.mjs:378-383`). The web northbound's direct-port wave verbs
   (`WAVE_WEB_ENTRIES`, `web-northbound.mjs:31-38`) are deliberately outside the map (they are
   MCP-only or direct ports, `surface-audit-mcp.md:20-25`); a reviewer who wants the law to also
   cover them must extend the bus side — that is a separate web-parity question (#159-adjacent), not
   part of #156's default-profile gap.
