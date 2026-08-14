# ROW WEB2 — the dispatch + briefing legs (web/MCP append dispatch, answer schema, initialize briefing)

[attempt: b5a27da7-6d21-4daa-a28c-245fafcc79f6 row-web2]

Row scope: `impl/src/application.mjs` (the `_commandDispatch` append branch ONLY — additive) ·
`impl/src/mcp-northbound.mjs` · `impl/src/web-northbound.mjs` · `impl/MCP.md` · this notes file.
The kernel `appendScratchpad` fold and the web/MCP admission tables landed via recovery
(row-kernel); the drain truncated the DISPATCH legs — this row wires the application handler and
the answer-schema / initialize-briefing honesty. Nothing fabricated; every claim cites a code
anchor or a suite run. The acceptance suites were never edited.

## What landed

- **`run.scratchpad.append` dispatch (A2-2 / A3-1)** — `application.mjs` `_commandDispatch` gains
  the append branch (`if (name === 'run.scratchpad.append') return this.scratchpadAppend(args, principal);`)
  beside the read/elevate direct ports. The new `scratchpadAppend` handler:
  - normalizes the closed arg closure `{runId, scope, kind?, body, idempotencyKey?}` in
    `_normalizeScratchpadAppend` (sibling of `_normalizeScratchpadRead`), refusing
    `application_scratchpad_append_invalid` on any malformed shape;
  - passes `{scope}` to `_authorize('run.scratchpad.append', principal, runId, {scope})` — the D1
    write law lives at the surface seam (row-deploy2 installs the restrictor), never in this fold;
  - maps the closed body into the kernel's per-kind entry closure (`_scratchpadAppendEntry`: note
    `{kind,text}` · plan `{kind,objective,steps,supersedes}` · doubt `{kind,question,context}` ·
    link `{kind,label,relation,target}`) and routes into `appendScratchpad` — never re-implements
    the envelope/body-bound/idempotency contract;
  - namespaces the caller idempotency key by scope before the kernel auth
    (`key = ${idempotencyKey}:${scope}`, H3.1) so a same-key cross-scope retry lands on DISTINCT
    kernel bindings; an absent key derives kernel-side.
  The MCP `_dispatch` branch (`baton_run_scratchpad_append` → `application.command('run.scratchpad.append', …)`)
  and the web four-table direct-port admission (incl. `WEB_DIRECT_PORT_COMMANDS`) were already
  present from recovery — they now reach a live handler instead of `application_command_unavailable`.

- **Answer schema decision-free + guard covers both consumers (R3 / R9)** — `applicationAnswerSchema`
  drops the retired `{decision}` branch (advertises exactly `optionId`/`text`), and the shared
  accepted-answer-keys guard (`['optionId','text']`) now covers `fleet_run_answer` as well as
  `baton_decision_answer`. The guard was moved BEFORE the `APPLICATION_TOOL` validator block, so a
  `{decision}`/`{resolution}` answer is refused with `invalid_arguments` by the guard instead of
  collapsing to the validator's generic `invalid_run_command` catch (the B6 approval-settlement
  hazard).

- **Initialize briefing honesty (R8)** — the trailing initialize sentence no longer promises
  "resolve via the orchestrator's embedded `context.briefing` command" (a non-MCP command, G9); it
  now states the pack is an embedded-only data note.

## Acceptance (verified in-worktree, 2026-08-14)

| Suite | Result | Notes |
|---|---|---|
| `scratchpad-write-red.test.mjs` | **15 pass / 8 fail** | My rows green: A2-2, A3-1, A6-1, A7-1, A7-2, A7-3, A8-1 (the handler rows flip green with the dispatch leg) + the 7 pre-existing greens. The 8 red are upstream-owned at their named stages: A1-1/A1-2/A9-1/A9-2/A10-1 (row-cli2 parser) and A4-1/A4-2/A5-1 (row-deploy2 restrictor). |
| `doc-truth-conformance-red.test.mjs` | **9 pass / 4 fail** | My rows green: R3, R8, R9. The 4 red are upstream: R1/R4/R5 (row-cli2) and R11 (row-docs2). |
| `mcp-reflex-surface-red.test.mjs` | **21/21** | unchanged |
| `phase72-kimi-orchestrator-mcp.test.mjs` | **20/20** | unchanged |
| `phase16-mcp-northbound.test.mjs` | **28/29** | ONE new collision — see DECISION_REQUEST below. |
| `briefing-pack-red.test.mjs` | **30/31** | ONE new collision (not in my acceptance list, surfaced for the gate) — see DECISION_REQUEST below. |

## Landing blockers — the two #159-mandated surface moves collide with pre-existing pins

Both collisions are the direct, unavoidable consequence of this wave's own #159 contract
(`doc-truth-conformance-2026-08-13/contract-fold.md`), which RETIRES `{decision}` (D3 #5) and the
`context.briefing` resolution promise (D3 #4). The retired forms are pinned by two pre-existing
suites that were green at the recovery base; both now fail their named stage. This is a
**DECISION_REQUEST** — the coordinator's brief lists only phase11/phase12 as restage candidates
and phase16 as "green-unchanged", neither of which anticipates these #159-mandated retirements.

- **phase16 UA5/MN (line 202)** — `fleet_run_answer` with `answer: { decision: 'allow' }` is
  dispatched. #159 D3 #5 / red-team B6 retire the `{decision}` form entirely ("accepted answer
  keys are exactly `optionId`/`text`", contract-fold.md:388); the guard now refuses it with
  `invalid_arguments`, so the row's `response.result.isError === false` assert fails.
  **Restage (recommended):** change the sample answer to a valid form — `answer: { optionId: 'opt-a' }`
  (the typed decision-channel form, mirroring `reflex1-decision-requests-red.test.mjs:757`, which
  stays green) — keeping the row's actual purpose (Run-tool → application-bus dispatch mapping)
  intact. **Alternatives:** (a) revert the D3 #5 retirement (rejects the acceptance R9 — not
  viable); (b) land a real decision-channel MCP tool that accepts `{decision}` (out of scope).

- **briefing-pack-red D6a-1 (line 1157)** — pins `instructions.includes('context.briefing')` ("the
  line names the orchestrator-facing resolve lane"). #159 D3 #4 / G9 retire that promise: the note
  must not point an MCP client at a command with no MCP tool (the embedded `context.briefing`
  resolve lane has no MCP projection). **Restage (recommended):** assert the new embedded-only
  note (e.g. the sentence carries the packId + "embedded-only data note"), or drop the
  `context.briefing` assertion. **Alternative:** land a real `baton_context_briefing` MCP tool (the
  OQ the contract names) so the note can name a real tool — a follow-on, not this rung.

Neither collision is fixable in the impl without violating the #159 acceptance suites (which are
immutable this wave). Both are "the refusal surface legitimately moved" cases — the restage is the
coordinator's adjudication (coordinator-brief.md item 6/7), with the move quoted here.

## Craft-law compliance

No clocks · `localeCompare` never used · byte literals only in `limits.mjs` · additive-only on
closed vocabularies (the append branch + handler are new code; the answer schema drops a retired
branch; the guard adds a consumer) · NUL discipline held on `application.mjs` (the 3 NUL bytes at
`application.mjs:631` are untouched; edits landed far away) · generated `impl/MCP.md` already
consistent with the retired forms (it teaches the `optionId` answer and names no
`context.briefing` promise — no regeneration needed) · the acceptance suites were never edited ·
work confined to the row's worktree and file partition.
