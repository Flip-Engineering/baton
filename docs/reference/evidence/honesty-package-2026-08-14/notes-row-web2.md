# ROW WEB2 — the dispatch + briefing legs: append dispatch, answer schema, initialize briefing

[attempt: a9aaedf7-3c8b-4709-a54d-465a7d9e6ddc row-web2]

Row-web2's acceptance: `scratchpad-write-red.test.mjs` A2-2/A3-1 and
`doc-truth-conformance-red.test.mjs` R3/R8/R9 green, plus `mcp-reflex-surface-red`,
`phase16-mcp-northbound`, `phase72-kimi-orchestrator-mcp` green. Nothing in this file was
fabricated — every claim cites a code anchor or a suite run.

## Scope (work-only boundary)

`impl/src/application.mjs` (the `_commandDispatch` append branch + the two append methods —
additive ONLY) · `impl/src/mcp-northbound.mjs` (answer schema + shared answer-shape guard +
initialize briefing sentence) · `docs/reference/evidence/honesty-package-2026-08-14/**` (this
note). `impl/src/web-northbound.mjs` needed NO edit — the web four-table admission landed via
recovery (A3-2 already green) and `_dispatch` already routes `run_scratchpad_append` →
`application.command('run.scratchpad.append', …)` with the envelope's auth plumbed; the only
missing rung was the application handler this row adds. `impl/MCP.md` needed NO edit —
`render-surface-docs.mjs --check` exits 0 (the generated inventory block already carries
`run.scratchpad.append → baton_run_scratchpad_append`, and MCP.md never documents the retired
`{decision}` answer form or the `context.briefing` resolution promise).

One file written outside the source boundary: a **surface-truth test restage** in
`impl/test/phase16-mcp-northbound.test.mjs` (§4), maintained under the f4a64da
"surface-truth restage" precedent (notes-row-kernel.md §7) and the CLAUDE.md failing-tests rule.
The acceptance suites (`scratchpad-write-red`, `doc-truth-conformance-red`) were never edited.

## 1. Application append dispatch + handler — `application.mjs` (A2-2/A3-1, and A6-1/A7/A8)

**Dispatch branch** (`:12633`, additive, in the facade-projection direct-port block beside
read/elevate):
`if (name === 'run.scratchpad.append') return this.scratchpadAppend(args, principal);`

**`_normalizeScratchpadAppend`** — the closed arg closure `{runId, scope, kind, body,
idempotencyKey}` (D2.1); scope `^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$`; `kind` defaults to
`note`; `idempotencyKey` matches the kernel's `SCRATCHPAD_IDEMPOTENCY_KEY`. It builds the kernel
`entry` from `kind`+`body`: `note` → `{kind:'note', text}` (body is a string); `plan`/`doubt`/
`link` → `{kind, ...body}` with the kernel-required nullable defaults (`supersedes: null` for plan,
`context: null` for doubt). The per-kind VALUE validation (string bounds, step shape, URL checks)
stays in the kernel's `normalizeScratchpadEntry` — never re-implemented here.

**`scratchpadAppend`** — `_authorize('run.scratchpad.append', principal, runId, {scope})`, then
the H3.1 surface namespacing (`auth.key = `${idempotencyKey}:${scope}`) before
`coordination.appendScratchpad({runId, scope, entry}, {actor, principalId, key?})`, returned as
`deepFreeze({schemaVersion:1, ...outcome})`. Envelope closure, the 8192 B body bound, partition
caps, and idempotency/conflict all stay kernel-side and pass through verbatim — so
`scratchpad_entry_exceeded` (A7-1), `scratchpad_partition_exhausted` (A7-2/A7-3), and
`scratchpad_write_conflict`/`idempotent` (A8-1) surface unchanged. This is why the application
handler flips not only A2-2/A3-1 but also A6-1/A7-1/A7-2/A7-3/A8-1 green against the recovered
kernel.

## 2. Answer schema + shared guard — `mcp-northbound.mjs` (R3/R9)

- Removed the retired `decision` branch from `applicationAnswerSchema` (`:415`). It now
  advertises exactly `optionId`/`text` (D3 #5, the grammar verdict).
- Added `ACCEPTED_ANSWER_KEYS = Object.freeze(['optionId','text'])` and the shared
  `answerShapeRejected(answer)` guard.
- Extended the guard to `fleet_run_answer` **before** the `APPLICATION_TOOL` block (`:1038`) —
  `fleet_run_answer` maps to `run.answer`, so the guard must fire before
  `validateApplicationCommandArgs` (which would otherwise collapse a `{decision}` answer to
  `invalid_run_command`, the exact B6 acceptance hole).
- The `baton_decision_answer` guard now reads the same `answerShapeRejected`, so the schema and
  both consumers cannot disagree.

## 3. Initialize briefing honesty — `mcp-northbound.mjs` (R8)

The trailing initialize sentence dropped the "resolve via the orchestrator's embedded
`context.briefing` command" promise (G9 — no `baton_context_briefing` tool exists in any profile).
It now states the pack is "an embedded-only data note, not an MCP command" (D3 #4).

## 4. Surface-truth restage — `impl/test/phase16-mcp-northbound.test.mjs`

`UA5/MN` drove `fleet_run_answer` with `answer: { decision: 'allow' }` — the exact string form D3
#5 retires (contract-fold.md G8/B6: `validateApplicationCommandArgs('run.answer',
{answer:{decision:'allow'}})` accepted it). With the guard extended, that call now correctly
refuses `invalid_arguments`, so the pin is restaged to `answer: { optionId: 'opt-1' }` — the
test's intent (fleet_run_answer → run.answer, repoId/idempotencyKey stripped) is unchanged; only
the retired answer form moves. This is a mechanical consequence of the source change, not a
behavior edit.

## Acceptance state (verified 2026-08-14, in-worktree)

| Suite | Result | Notes |
|---|---|---|
| `scratchpad-write-red.test.mjs` | **15/23** | A2-2, A3-1 green (also A2-1/A2-3/A3-2 from recovery, A6-1/A7-x/A8-1 via this handler, all PINs). Remaining 8 RED are row-cli2 (A1-1/A1-2/A9-1/A9-2/A10-1) + row-deploy2 (A4-1/A4-2/A5-1). |
| `doc-truth-conformance-red.test.mjs` | **9/13** | R3, R8, R9 green. Remaining 4 RED (R1/R4/R5/R11) are the `run.watch` parser leg (application-cli.mjs — not this row). |
| `mcp-reflex-surface-red.test.mjs` | **21/21** | — |
| `phase16-mcp-northbound.test.mjs` | **29/29** | after the §4 restage |
| `phase72-kimi-orchestrator-mcp.test.mjs` | **20/20** | — |

Adjacent, re-verified fresh (untouched by this row — the web `run_answer` path still accepts the
string `{decision:'allow'}`; only the MCP `fleet_run_answer` guard changed): `mcp-packaging-red`
18/18, `error-actionability-red` 22/22, `phase64-application-cli` 15/15,
`phase68-unified-agent-entrypoint` 21/21. `phase12-web-northbound` is 31/33 with two PRE-EXISTING
`run.start` route-validation failures (`application_route_invalid` vs `invalid_command`) unrelated
to this row's files.

## Craft-law compliance

No clocks; no `localeCompare`; additive-only on application.mjs (the append branch + two methods,
no existing branch touched); NUL discipline held on application.mjs (its 3 NUL bytes on line 626
untouched — the two edits are far from it, verified NUL count 3 before/after); generated docs
checked, not hand-edited; the acceptance suites never edited; the one test restage is a documented
surface-truth consequence, not a behavior change; this attempt line verbatim in the first five
lines.
