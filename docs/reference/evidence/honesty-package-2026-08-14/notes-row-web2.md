# ROW WEB2 — the dispatch + briefing legs (web/MCP append dispatch, answer schema, initialize briefing)

[attempt: 5e53de2d-33b2-4774-ac68-65f46bb4b5bd row-web2]

Row-web2's acceptance: `scratchpad-write-red.test.mjs` A2-2/A3-1 and
`doc-truth-conformance-red.test.mjs` R3/R8/R9 green; the adjacent surfaces
`mcp-reflex-surface-red`, `phase16-mcp-northbound`, `phase72-kimi-orchestrator-mcp` green.
The kernel `appendScratchpad` and the web/MCP admission tables were row-kernel's (recovered);
this row routes the application `_commandDispatch` and the answer/briefing surface into them.
Nothing fabricated — every claim cites a code anchor or a suite run.

## Scope (work-only boundary, honored)

`impl/src/application.mjs` (the `_commandDispatch` append branch + its handler/normalizer only —
additive) · `impl/src/mcp-northbound.mjs` · `impl/MCP.md` (verified, no content change) ·
`docs/reference/evidence/honesty-package-2026-08-14/**`. One surface-truth test restage
(`impl/test/phase16-mcp-northbound.test.mjs` line 202) under the f4a64da precedent — the answer
schema change legitimately moves that pin (see §4). `application-cli.mjs`/`CLI.md` (row-cli2's)
and the deployment seam (row-deploy2's) were never touched; the acceptance suites were never
edited.

## The application dispatch leg (A2-2 / A3-1 / A6-1 / A7-* / A8-1)

`_commandDispatch` gains `if (name === 'run.scratchpad.append') return this.scratchpadAppend(args,
principal);` (`application.mjs`, the facade direct-port block) — the branch the web and MCP
dispatch legs already route into (web `APPLICATION_COMMAND.run_scratchpad_append` →
`application.command('run.scratchpad.append', …)`; MCP `baton_run_scratchpad_append` →
`application.command('run.scratchpad.append', …)`).

- **`_normalizeScratchpadAppend`** — the closed closure `{runId, scope, kind?, body,
  idempotencyKey?}`; `runId` `validId`, `scope` the `SCRATCHPAD_SCOPE` grammar
  (`^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$`), `kind` in `note|plan|doubt|link` (default
  `note`), `body` required, `idempotencyKey` the `SCRATCHPAD_IDEMPOTENCY_KEY` grammar when
  present. Malformed args refuse `application_scratchpad_append_invalid` (the #158 refusal-vocab
  code). `workerId` is deliberately absent — the author is server-bound to `auth.principalId`
  (H1.3).
- **`scratchpadAppendEntry(kind, body)`** — closes the body into the kernel entry shape
  (`normalizeScratchpadEntry`, `coordination-store.mjs:607-696`): `note` = `{kind, text}` (string
  body); `plan`/`doubt` default `supersedes`/`context` to `null`; `link` passes `{label, relation,
  target}` through. The kernel's `normalizeScratchpadEntry` stays the deep authority — the surface
  never re-implements it.
- **`scratchpadAppend`** — `_authorize('run.scratchpad.append', principal, runId, {scope})` then a
  DIRECT `this.driver.coordination.appendScratchpad({runId, scope, entry}, {actor, principalId,
  sessionId, key?})`. The caller-supplied key is namespaced `auth.key = `${callerKey}:${scope}``
  (H3.1 — the two-scope replay disambiguation is the SURFACE's job, never a kernel amendment); an
  absent key derives kernel-side (`run.scratchpad.append:<runId>:<scope>:<contentDigest>`, OQ2).
  The receipt is returned verbatim (`{ok, result:'written'|'idempotent', entryId, entryDigest,
  scope, scratchpadFence, eventSeq}`). It never routes through `scratchpadElevate`/
  `elevateTaskScratchpad` (law 4 — an ephemeral write, no candidacy mint), satisfying A6-1.

## The answer-schema correction (R3 / R9)

- **Schema** (`applicationAnswerSchema`, `mcp-northbound.mjs`): the retired `{decision}` branch is
  removed; the advertised branches are exactly `[optionId, text]` (R9 leg 1). A new
  `ACCEPTED_ANSWER_KEYS = Object.freeze(['optionId', 'text'])` constant is the single shared
  closed-set source read by the guard and documented beside the schema (the D3 #5 "one guard, one
  shared constant" disposition).
- **Guard** (`validateArguments`): the answer-shape guard now covers BOTH consumers —
  `baton_decision_answer` AND `fleet_run_answer` (folded red-team B6). It is placed BEFORE the
  `APPLICATION_TOOL` validator so the closed set wins over the otherwise-permissive
  `validateApplicationCommandArgs('run.answer', …)` path; a `{decision}`/`{resolution}` answer on
  either consumer refuses `invalid_arguments` (R3 / R9 leg 2), never the non-guard
  `invalid_run_command`.

## The initialize briefing (R8)

The initialize `briefingSentence` dropped the "resolve via the orchestrator's embedded
context.briefing command" suffix (G9 — it named a non-MCP command). It now states the pack is an
embedded-only data note resolved inside the orchestrator — no MCP tool reads it. R8's name
extraction finds zero phantom tool names.

## Surface-truth restage (f4a64da precedent)

The answer-schema change retires `{decision}` and extends the guard to `fleet_run_answer`, so the
`phase16-mcp-northbound.test.mjs` UA5/MN pin that dispatched `fleet_run_answer` with
`answer:{decision:'allow'}` → `run.answer` is now a refused form. That one pin was restaged to the
valid `answer:{optionId:'opt-a'}` form (same `→ run.answer` mapping, same downstream
`mcp.call_admitted` projection) — a mechanical consequence of the surface change, not a behavior
edit. The acceptance suites were never edited.

## Acceptance state (verified 2026-08-14, in-worktree)

| Suite | Result | Notes |
|---|---|---|
| `scratchpad-write-red.test.mjs` A2-2 | **green** | MCP tools/call dispatches to a written receipt + kernel read-back |
| `scratchpad-write-red.test.mjs` A3-1 | **green** | web envelope dispatches to a written receipt + kernel read-back |
| `scratchpad-write-red.test.mjs` (full) | **15 pass / 8 red-by-owner** | A2-1/A2-2/A2-3/A3-1/A3-2/A6-1/A7-1/A7-2/A7-3/A8-1 + P-A1/P-A4/P-A5/P-A6/P-A7 green. Red: A1-1/A1-2/A9-1/A9-2/A10-1 (row-cli2 parser/CLI_WEB_COMMANDS/D4) and A4-1/A4-2/A5-1 (row-deploy2 restrictor) |
| `doc-truth-conformance-red.test.mjs` | **9 pass / 4 red-by-owner** | R3/R8/R9 green (this row) + R2/R6/R7/R10/P-CS1-b/P-CS4. Red: R1/R4/R5 (row-cli2 parser) and R11 (row-docs2 artifact counts) |
| `mcp-reflex-surface-red.test.mjs` | **21/21** | — |
| `phase16-mcp-northbound.test.mjs` | **29/29** | after the §4 restage |
| `phase72-kimi-orchestrator-mcp.test.mjs` | **20 tests, flaky on one** | `KC6/KC7/KC8: packaged Kimi MCP entry crosses a real authenticated Web listener with pure stdio` is timing/environment-dependent (passes in isolation run 1, fails run 2 at `phase72:642` `responses[2].result.isError === false`). It is NOT reachable from this row's diff (application append dispatch, answer schema/guard, briefing, the phase16 pin) — it spawns a real HTTP listener + `mcp-web.mjs` stdio child with a monkey-patched fetch. See §6. |

## Flaky test register (CLAUDE.md failing-tests rule)

The `phase72-kimi-orchestrator-mcp.test.mjs` `KC6/KC7/KC8` row is non-deterministic: it starts a
real authenticated Web listener (`createAuthenticatedWebServer` on `127.0.0.1:0`), issues a
`ttlMs: 60_000` session, and spawns `node --import <trusted-proxy-fetch preload> mcp-web.mjs` to
cross the bridge — the third frame's `tools/call` intermittently returns `isError: true` (assert
`phase72:642`). Verified PRE-EXISTING: with this row's three source files stashed (baseline tree),
the same test still flipped across runs (2 pass, 1 fail of 3) — the flake is not reachable from
this row's diff, which touches only the application append dispatch, the answer schema/guard, and
the initialize briefing. `gh` is unauthenticated in this worktree, so the issue could not be filed
here; the failure mode is recorded for the coordinator to file as `bug`/flaky at landing.

## Craft-law compliance

No clocks; no `localeCompare`; byte literals only in `limits.mjs`; additive-only on the closed
vocabularies (the append dispatch branch, the answer-schema branch removal, the briefing rewording);
NUL discipline held on `application.mjs` (3 NUL bytes at line 628, `grep -an`/`sed -n` for reads —
my edits are far from that region); generated docs regenerate identically (`render-surface-docs.mjs`
produced no `MCP.md`/`CLI.md` diff — the inventory already matched served reality); the acceptance
suites never edited; all work confined to this worktree; this attempt line verbatim in the first
five lines.
