# ROW-WEB2 — the dispatch + briefing legs (web/MCP append dispatch, answer schema, initialize briefing)

[attempt: 534910b2-4212-4114-8f85-71ca5797a2dc row-web2]

Row: `row-web2` — the drain-truncated dispatch legs of the honesty package. This row turns
`scratchpad-write-red.test.mjs` A2-2/A3-1 (and the handler rows A6-1/A7-1/A7-2/A7-3/A8-1 they
unlock) and `doc-truth-conformance-red.test.mjs` R3/R8/R9 green, correctly — dispatch routes into
the kernel `appendScratchpad` (never re-implements it), and the answer-schema/briefing honesty is
the folded #159 D3 #4/#5 law verbatim.

## Scope (work-only boundary, honored)

`impl/src/application.mjs` (the `_commandDispatch` append branch + its handler + normalizer —
additive) · `impl/src/mcp-northbound.mjs` (answer schema, answer-shape guard, initialize
briefing) · `impl/MCP.md` (no hand-edit needed — see below). `impl/src/web-northbound.mjs` was
**not** edited: the web append dispatch was already wired by row-kernel's four-table admission
(`APPLICATION_COMMAND.run_scratchpad_append` → `_dispatch` → `application.command('run.scratchpad
.append', …)`); the missing rung was the application `_commandDispatch` branch this row adds.
`application-cli.mjs`/`CLI.md` (row-cli2's) and the deployment seam (row-deploy2's) untouched.
The acceptance suites never edited.

## Implementation

### application.mjs — the append dispatch into the kernel (additive only)

- **Dispatch branch** (`application.mjs:12709`): `if (name === 'run.scratchpad.append') return
  this.scratchpadAppend(args, principal);` — its own direct port beside read/elevate, a single-line
  dispatch that does NOT route through `scratchpadElevate`/`elevateTaskScratchpad` (A6-1 law 4).
- **`_normalizeScratchpadAppend`** (`application.mjs:13110`): the closed envelope — `{runId,
  scope, kind?, body, idempotencyKey?}`, `scope` against the D1 two-tier pattern, `kind` in the
  closed set (default `note`), `body` present, `idempotencyKey` against the key pattern. Exactly
  as permissive as the kernel (never narrower) — the per-kind body shape is the kernel
  `normalizeScratchpadEntry`'s authority, reached through `appendScratchpad`.
- **`scratchpadAppend`** (`application.mjs:13390`): authorize at the seam with `{scope}` (the D1
  law the deployment restrictor enforces), build the closed per-kind `entry` (`note` wraps `body`
  as `text`; `plan`/`doubt`/`link` default their optional content fields to the kernel-null
  forms), then call `this.driver.coordination.appendScratchpad({runId, scope, entry}, auth)` with
  `auth = {actor: principal.actor, principalId: principal.principalId, key: `${idempotencyKey}:
  ${scope}`}`. The H3.1 surface namespacing (key suffixed by scope) is what makes a same-key
  different-scope retry land a DISTINCT kernel binding (P-A4). Lane refusals
  (`scratchpad_entry_exceeded`, `scratchpad_partition_exhausted`, `scratchpad_write_conflict`)
  propagate with their `.code` untouched, under the `schemaVersion: 1` envelope marker.

### mcp-northbound.mjs — answer-schema honesty (R3/R9) + briefing honesty (R8)

- **`ACCEPTED_ANSWER_KEYS`** (new shared constant `Object.freeze(['optionId','text'])`) +
  **`applicationAnswerSchema`** drops the `{decision}` branch (`mcp-northbound.mjs:415-426`) — the
  advertised forms are now exactly `[optionId, text]` (R9 leg 1 structural pin).
- **Answer-shape guard** moved to run **before** the `APPLICATION_TOOL` validator and extended to
  **both** consumers (`if (name === 'baton_decision_answer' || name === 'fleet_run_answer')`,
  `mcp-northbound.mjs:1038-1046`). It refuses any answer key outside `ACCEPTED_ANSWER_KEYS` with
  `invalid_arguments` — so `{decision}` (and any rename, e.g. `{resolution}`) is refused on
  `fleet_run_answer` by the guard, never the non-guard `invalid_run_command` collapse (R3/R9 leg 2
  behavioral pins). Moving it before the validator is load-bearing: the old position left
  `fleet_run_answer`'s `{decision}` refusal to `validateApplicationCommandArgs`'s collapse.
- **Initialize briefing** (`mcp-northbound.mjs:1488-1490`): the trailing sentence drops the
  "resolve via … `context.briefing` command" suffix (a non-MCP command, G9) and now states
  "the briefing pack is an embedded-only data note." — D3 #4's option (a), so the initialize
  briefing names no non-MCP command (R8).

### MCP.md

No hand-edit. `node impl/scripts/render-surface-docs.mjs --check` exits 0 after the source
changes, so `impl/MCP.md` is byte-synced to the generators; its answer example already carries
`{ "optionId": "opt-1" }` and its inventory already lists `run.scratchpad.append`.

## Acceptance verification (final, in this worktree)

| Suite | Result | Notes |
|---|---|---|
| `scratchpad-write-red.test.mjs` | **15/23** | This row's 7 stages green: A2-2, A3-1, A6-1, A7-1, A7-2, A7-3, A8-1 (was 8/23 before the branch landed). The 8 red rows are the other rows' named stages: A1-1/A1-2/A9-1/A9-2 (row-cli2), A4-1/A4-2/A5-1 (row-deploy2), A10-1 (three-way, gated on row-cli2's parser). |
| `doc-truth-conformance-red.test.mjs` | **9/13** | This row's 3 stages green: R3, R8, R9 (was 6/13). The 4 red rows are R1/R4/R5 (row-cli2's run.watch), R11 (row-docs2's artifact count). |
| `mcp-reflex-surface-red.test.mjs` | **21/21** | green — the R6 `{decision:"allow"}` → `invalid_arguments` pin still holds on `baton_decision_answer`. |
| `phase72-kimi-orchestrator-mcp.test.mjs` | **20/20** | green — tool-list count pins unchanged. |
| `phase16-mcp-northbound.test.mjs` | **28/29** | 1 break — the D3 #5 collision (DECISION_REQUEST 1 below). |
| `briefing-pack-red.test.mjs` | **30/31** | 1 break — the D3 #4 collision (DECISION_REQUEST 2 below). |

Adjacent green-unchanged (re-verified this row): `error-actionability-red` 22/22 ·
`cli-wave-fidelity-red` 16/16 · `reflex1-decision-requests-red` 34/34 ·
`phase67-progressive-agent-experience` 12/12 · `wave-observability-red` 30/30 ·
`control-surface-truth-red` 7/7 · `mcp-profile-parity-red` 8 pass/13 fail (the designed split) ·
`workflow-dsl-red` 35/35 · `workflow-dsl-package-red` 12/12 · `workflow-as-data-red` 30/30 (from
row-docs' finish-time run; untouched by this row) · `node impl/scripts/surface-conformance.mjs`
reports ok.

## DECISION_REQUEST 1 — phase16 UA5/MN `{decision:'allow'}` vs. D3 #5 (R9)

A genuine contract collision, outside this row's file boundary (`phase16-mcp-northbound.test.mjs`
is not in the row's partition).

**The conflict.** `phase16-mcp-northbound.test.mjs:202` drives `fleet_run_answer` with
`answer: { decision: 'allow' }` and asserts `response.result.isError === false` (`:212`). D3 #5
(doc-truth-conformance-2026-08-13/contract-fold.md:280-292) retires `{decision}` from the MCP
surface on BOTH consumers — the fold names `validateApplicationCommandArgs('run.answer',
{answer:{decision:'allow'}})` accepting the form as the exact approval-settlement hazard it closes.
With the guard extended to `fleet_run_answer` (this row's R9 implementation), that sample now
refuses `invalid_arguments`, so the row fails at `:212` (`true !== false`). R9 green requires the
retirement; phase16 `:212` green requires accepting it — mutually exclusive without a suite edit.

**Recommended disposition: `opt-restage-phase16`.** The `{decision}` form legitimately retired;
the pin's intent (tool→command mapping) is preserved by restaging the sample answer to a live
form — `answer: { text: 'yes' }` (the requestId is `question-1`) or `answer: { optionId: 'opt-1' }`.

DECISION_REQUEST: {"question":"phase16-mcp-northbound.test.mjs:202 pins fleet_run_answer dispatching answer {decision:'allow'} (assert :212 isError===false), but doc-truth D3 #5 (R9) retires {decision} from the MCP surface on both consumers, so the sample now refuses invalid_arguments. The restage is outside row-web2's file boundary. Which disposition?","options":[{"id":"opt-restage-phase16","label":"Restage phase16 :202 sample answer to a live form ({text:'yes'} for question-1, or {optionId:'opt-1'}) — the move is D3 #5's {decision} retirement; the tool→command mapping intent is unchanged"},{"id":"opt-accept-collateral","label":"Accept the phase16 :212 break as documented D3 #5 collateral (record it in the wave's red-by-design set)"},{"id":"opt-nuanced-guard","label":"Reconsider R9: accept {decision:<string>} on fleet_run_answer and refuse only {decision:<object>} — contradicts D3 #5's named {decision:'allow'} hazard, not recommended"}],"allowFreeResponse":true,"deadlineMs":3600000}

## DECISION_REQUEST 2 — briefing-pack D6a-1 `context.briefing` vs. D3 #4 (R8)

A second genuine contract collision, also outside this row's file boundary.

**The conflict.** `briefing-pack-red.test.mjs:1157` asserts
`instructions.includes('context.briefing')` (D6a-1). D3 #4
(doc-truth-conformance-2026-08-13/contract-fold.md:275-278) retires the non-MCP `context.briefing`
resolution promise from the initialize sentence (G9: no `baton_context_briefing` tool exists in
any profile). With the sentence reworded to "the briefing pack is an embedded-only data note."
(this row's R8 implementation), the `includes('context.briefing')` assertion fails. R8 green
requires NOT naming `context.briefing`; D6a-1 `:1157` green requires naming it — mutually
exclusive without a suite edit. (`briefing-pack-red` is not in this row's brief acceptance list.)

**Recommended disposition: `opt-restage-d6a`.** D3 #4 is the newer contract authority; D6a-1's
other three assertions (head packId, "minted at event", ≤240 bytes) all still pass — only the
`context.briefing` naming assertion is stale.

DECISION_REQUEST: {"question":"briefing-pack-red.test.mjs:1157 (D6a-1) pins instructions.includes('context.briefing'), but doc-truth D3 #4 (R8) retires the non-MCP context.briefing naming from the initialize sentence (G9), so the reworded sentence no longer includes it. The restage is outside row-web2's file boundary. Which disposition?","options":[{"id":"opt-restage-d6a","label":"Restage D6a-1 :1157 to assert the embedded-only note (drop the context.briefing includes assertion) — the move is D3 #4's retirement; the other three D6a-1 assertions still pass"},{"id":"opt-accept-collateral","label":"Accept the D6a-1 :1157 break as documented D3 #4 collateral"}],"allowFreeResponse":true,"deadlineMs":3600000}

## Craft-law compliance

No clocks; no `localeCompare`; byte literals only in `limits.mjs`; additive-only on the closed
vocabularies; NUL discipline held on `application.mjs` (3 NUL bytes at line 631 untouched —
verified byte-count before and after) and `coordination-store.mjs` untouched; the acceptance
suites never edited; all work confined to this row's worktree; this attempt line verbatim in the
first five lines; generated docs regenerated via `render-surface-docs.mjs --check` (no hand-edits).
