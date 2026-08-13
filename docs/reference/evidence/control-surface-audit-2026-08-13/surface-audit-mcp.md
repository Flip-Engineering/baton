SURFACE-AUDIT-ROW v1
# surface-audit-mcp — MCP northbound control-surface audit (issue #147)

- **Row:** row-mcp · **Surface:** MCP northbound (`impl/src/mcp-northbound.mjs`)
- **Read this session:** `impl/src/mcp-northbound.mjs` (2233 lines), `impl/MCP.md`, `impl/scripts/mcp-stdio.mjs`, `impl/scripts/mcp-web.mjs`, `impl/scripts/render-surface-docs.mjs`, `impl/scripts/surface-conformance.mjs`, `impl/scripts/surface-inventory-artifact.json`, `impl/src/application-semantics.mjs`, `impl/src/limits.mjs`, `impl/src/coordination-store.mjs` (NUL-safe), `impl/src/coordinator.mjs`, `impl/src/messages.mjs`, `impl/src/claude-session.mjs`, `impl/test/phase16-mcp-northbound.test.mjs`, `impl/test/frame-economics-red.test.mjs`, `impl/test/wave-observability-red.test.mjs`. NUL files read via `grep -an`/`sed -n` only.
- **Method:** read-only; every claim cites `file:line`; the two profile-gap claims were verified programmatically (`node --input-type=module` importing `mcp-northbound.mjs` / `surface-conformance.mjs` / the inventory artifact).
- **Style decisions recorded:** (1) the parity table compares the documented-default `application` MCP profile against the web bus (`webBusNames()`), and separately notes the `combined` profile recovery, because the default is what a fresh agent actually gets. (2) `invalid_run_command` collapse is treated as an error-actionability finding (axis 3) not a grammar finding, because its cost is a lost teaching refusal. (3) No authority-class ambiguity arose; no DECISION_REQUEST.
- **Doc conformance:** `node scripts/render-surface-docs.mjs --check` passes clean — `impl/MCP.md` matches the renderer.

## 1. Parity — can an MCP agent do EVERYTHING the bus can?

The MCP surface is profile-gated. `REFERENCE_PROFILES` (`impl/scripts/surface-conformance.mjs:362-371`) defines `mcp.application` (35 tools = `mcpApplicationToolNames()`, `surface-conformance.mjs:403-407`), `mcp.advanced` (19), `mcp.combined` (86 = `mcpCombinedToolNames()`, `mcp-northbound.mjs:830`). `impl/MCP.md:46-47` documents `application` as the default and `advanced`/`combined` as "explicit kernel-control deployments". The web bus is `webBusNames()` (`surface-conformance.mjs:378-384`) = 25 commands, confirmed live at `impl/scripts/surface-inventory-artifact.json` profile `web.bus`.

### 1.1 The parity table

Legend: ✓ = a tool/command for the capability is present on that surface · ✗ = absent · **M** = capability is MCP-only (absent from the web bus) · app-profile gap = reachable on MCP only via the `combined` profile (different tool name + arg shape).

| Capability | MCP application (35) | MCP combined (86) | Web bus (25) | Verdict |
|---|---|---|---|---|
| waves.start | ✓ `baton_waves_start` (`mcp-northbound.mjs:495-509`) | ✓ | ✗ | **M** |
| waves.progress | ✓ (`:517-521`) | ✓ | ✗ | **M** |
| waves.send | ✓ (`:523-527`) | ✓ | ✗ | **M** |
| waves.stop | ✓ (`:529-533`) | ✓ | ✗ | **M** |
| waves.list | ✓ (`:535-539`) | ✓ | ✗ | **M** |
| waves.run | ✓ (`:552`) | ✓ | ✗ | **M** (#114, MCP-only workflow-as-data) |
| waves.attach | ✓ (`:471-486`) | ✓ | ✓ `waves_attach` | full |
| run.start / run.do | ✓ `baton_run_start`, `baton_run_do` | ✓ `fleet_run_start` (`:383`) | ✓ `run_start` | full |
| run.view / run.inspect | ✓ | ✓ | ✓ | full |
| run.act | ✓ `baton_run_act` (`:461-464`) | ✓ | ✓ | full |
| run.episode | ✓ | ✓ | ✓ | full |
| run.stop | ✓ | ✓ | ✓ | full |
| run.workstreams | ✓ | ✓ | ✓ | full |
| run.workstream.notify | ✓ | ✓ | ✓ | full |
| run.workstream.stop | ✓ | ✓ | ✓ | full |
| runs.list | ✓ `baton_runs` | ✓ | ✓ | full |
| application.help | ✓ `baton_help`, `baton_application_help` | ✓ | ✓ | full |
| run.status | ✗ | ✓ `fleet_run_status` (`:385`) | ✓ | **app-profile gap** |
| run.follow | ✗ | ✓ `fleet_run_follow` (`:387-388`) | ✓ | **app-profile gap** |
| run.wait | ✗ | ✓ `fleet_run_wait` (`:393-394`) | ✓ | **app-profile gap** |
| run.approve | partial — `baton_run_act` approve_plan semantic action (`application-semantics.mjs:810` `approve_plan: 'run.approve'`), requires digest-keyed actionId | ✓ `fleet_run_approve` (`:389-390`) | ✓ | **app-profile gap** |
| run.answer | ✗ — `baton_decision_answer` is the decision channel, not run.answer | ✓ `fleet_run_answer` (`:391-392`) | ✓ | **app-profile gap** |
| run.adopt | ✗ | ✓ `fleet_run_adopt` (`:409-410`) | ✓ | **app-profile gap** |
| run.evidence | ✗ | ✓ `fleet_run_evidence` (`:399-400`) | ✓ | **app-profile gap** |
| run.export | ✗ | ✓ `fleet_run_export` (`:417-418`) | ✓ | **app-profile gap** |
| run.feedback | ✗ | ✓ `fleet_run_feedback` (`:395-396`) | ✓ | **app-profile gap** |
| run.integrate | ✗ | ✓ `fleet_run_integrate` (`:415-416`) | ✓ | **app-profile gap** |
| run.recover | ✗ | ✓ `fleet_run_recover` (`:386`) | ✓ | **app-profile gap** |
| run.review | ✗ | ✓ `fleet_run_review` (`:411-412`) | ✓ | **app-profile gap** |
| run.resume_work | ✗ | ✗ | ✓ `run_resume_work` | **HARD GAP (all MCP profiles)** |
| run.retry_verification | ✗ | ✗ | ✓ `run_retry_verification` | **HARD GAP (all MCP profiles)** |
| decision answer | ✓ `baton_decision_answer` | ✓ | ✗ | **M** |
| scratchpad elevate/settle | ✓ (`:105-106`) | ✓ | ✗ | **M** |
| knowledge promote / settlement_lease | ✓ | ✓ | ✗ | **M** |
| deployment_doctor | ✓ (`:104`) | ✓ | ✗ | **M** |
| run message send / receipt | ✓ | ✓ | ✗ | **M** |
| run attention watch | ✓ | ✓ | ✗ | **M** |
| run scratchpad read / elevate | ✓ | ✓ | ✗ | **M** |
| run knowledge seed | ✓ | ✓ | ✗ | **M** |
| board / package / knowledge recall / context_eval / decision_list / repl_cite | ✗ | ✓ (`:756-830` reflex + `:812-830`) | ✗ | combined-only |
| advanced kernel (fleet_spawn, fleet_send, fleet_kill, goal/plan, …) | ✗ | ✓ (`:697-754`) | ✗ | advanced/combined-only |

### 1.2 Headline parity findings

1. **The documented default MCP profile is NOT a superset of the bus.** The web bus serves 14 run-lifecycle operations the default MCP profile cannot reach: `run.status`, `run.follow`, `run.wait`, `run.approve`, `run.answer`, `run.adopt`, `run.evidence`, `run.export`, `run.feedback`, `run.integrate`, `run.recover`, `run.review`, `run.resume_work`, `run.retry_verification` (`surface-inventory-artifact.json` profile `web.bus`). Verified programmatically: `mcpApplicationToolNames()` (35) has none of the `fleet_run_*` lifecycle names.
2. **12 of the 14 are recoverable only by redeploying at the `combined` profile**, under the `fleet_run_*` canonical spellings with *different* required arg shapes (e.g. `fleet_run_follow` requires `afterCursor`+`timeoutMs`, `:387-388`; `fleet_run_approve` requires `planDigest`, `:389-390`; `fleet_run_answer` requires `requestId`+`answer` with the strict `applicationAnswerSchema`, `:391-392` + `:359-366`). The M4b dual-spelling pattern (`CANONICAL_ORDINARY_SIBLINGS`, `:24-33`) covers only 10 ops (`run.do`/`run.view`/`run.member.*`/`application.help`); the lifecycle tail never got legacy `baton_*` siblings.
3. **`run.resume_work` and `run.retry_verification` are absent from MCP entirely** — no `fleet_run_*` spelling exists in `APPLICATION_TOOL_DEFINITIONS` (`:383-402`) and no profile serves them (`surface-inventory-artifact.json` profiles `mcp.application`/`mcp.combined`). Both ARE `mcp:true` commands in `APPLICATION_COMMAND_DEFINITIONS` (the bus dispatches them), so the dispatch target exists; only the MCP tool is missing.
4. **MCP exceeds the bus for waves ergonomics.** Six wave operations (`start/progress/send/stop/list/run`) are MCP-only; the bus serves only `waves_attach`. `waves.run` is the #114 workflow-as-data entry (`mcp-northbound.mjs:552`, `CAPABILITY` `:103`).
5. **Approve is reachable on the application profile only indirectly** — through `baton_run_act`'s approve_plan semantic action (`application-semantics.mjs:810`), which requires a digest-keyed `actionId` the agent must already have read out of a run view. There is no direct `run.approve`.

## 2. Discoverability — does the MCP surface teach itself?

**What teaches well:** every tool carries a human description and a JSON-schema `inputSchema` with `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) — e.g. `:383-418`. `initialize` returns a surface-orientation instructions line (`:1373-1376`). `baton_deployment_doctor` is a quota-free route-picking prerequisite (MCP.md:83-85). `MCP.md` is conformance-clean against the renderer (`render-surface-docs.mjs --check` passes).

**What the surface never states (incantations an agent must already know):**

- **D1 — `actionId` provenance.** `baton_run_act` (`:461-464`) says "Perform one currently offered Run-bound action" and requires `actionId`; it never says the `actionId` is a digest minted by the run view's actions array. An agent must already know to call `run.view`/`baton_run_inspect`, read the outline, and copy the digest. No description teaches the dependency.
- **D2 — the initialize instructions point at a non-MCP command.** `:1373-1376`: "resolve via the orchestrator's embedded `context.briefing` command." `context.briefing` is a direct application dispatch port — it is NOT an MCP tool and NOT in any profile. A fresh agent following the instruction finds nothing callable. The surface's own orientation text misdirects.
- **D3 — `{decision}` is advertised but refused.** `applicationAnswerSchema` (`:359-366`) advertises `{decision: 'allow'|'deny'|'cancel'}` as a valid `answer` form for `baton_decision_answer` (`:574-577`), but `validateArguments` rejects any answer whose single key is not `optionId` or `text` (`:1021-1024`), with bare `invalid_arguments`. A schema-driven client constructs the advertised form and is refused with a code that names nothing.
- **D4 — repoId auto-bind is undocumented.** Every schema requires `repoId` (`validateArguments` `:951`). A descriptor-bound server auto-injects it (`handle()` `:1378-1389`), so the documented flow never needs it — but `MCP.md:105-121` wave examples omit `repoId` while the schemas require it (e.g. `baton_waves_start` requires `['repoId','idempotencyKey','members']`, `:509`), and the doc never states the auto-bind rule. A legacy factory-module server (`mcp-stdio.mjs:14-24`) hits `invalid_repo` with no doc guidance.
- **D5 — the lifecycle tail is invisible at the default profile.** `tools/list` on the `application` profile returns only the 35 `baton_*` tools; `fleet_run_status`/`fleet_run_wait` etc. do not exist to be discovered. The only pointer to their existence is the doc's one-line `combined` mention (MCP.md:46-47). An agent cannot learn the surface has a run-lifecycle tail.
- **D6 — three cursor idioms.** `fleet_run_follow` takes `afterCursor`+`timeoutMs` (`:387-388`); `baton_waves_progress` takes `cursor`+`nextCursor` (`:517-521`); `baton_run_episode` takes `pageCursor`/`cursor`/`waitMs` (`:400-401`). The surface never states when each applies.

## 3. Error actionability sweep (#41-pattern / #139)

**The good parts (verified):**
- **MN7/MN8 sanitization is correct.** Untyped internal throws degrade to `command_outcome_unknown`, code-only, never leaking provider detail — pinned at `test/phase16-mcp-northbound.test.mjs:455-463` (a thrown `Error('private after-effect detail')` surfaces as `command_outcome_unknown` with the detail string absent). Implemented at the observe-path catch (`mcp-northbound.mjs:1519-1531`) and the stateful catch (`:1641-1659`).
- **LANE_CRAFTED refusals carry message + detail.** `wave_member_invalid`/`wave_not_found`/`workflow_*` ride the lane's own message byte-identically plus `{actual, cap, cause, role}` detail (`:1651-1659`; pinned at `test/wave-observability-red.test.mjs:919-927`). The wave lane wraps the frame-limit coaching into `wave_member_invalid` with `cause.code === 'spill_body_exceeded'` (D5.1, `:920-927`) — the reference implementation for the pattern.

**The actionability failures:**

- **E1 — `validateArguments` collapses every application-command refusal to `invalid_run_command`.** The catch at `:947-953` swallows ANY `validateApplicationCommandArgs` throw into one bare code. Over-cap `run.objective` (enforced inside `run.start`'s `normalizeIntent`, `application.mjs:2029`) surfaces on MCP as `invalid_run_command` — no field named, no cap, no actual, no next action. Today the application layer itself still throws `application_intent_invalid` for this (red, `test/frame-economics-red.test.mjs:679-695` stage note), so the coaching is missing at BOTH layers; MCP's collapse guarantees it can never improve without a second fix.
- **E2 — the frame-limit coaching family is not in the `stateFailureCode` allowlist.** `stateFailureCode` (`:201-279`) allowlists ~250 typed codes but zero `*_exceeded` codes. The coaching refusals that DO carry `{cap, actual, unit, gracefulPath}` — `decision_text_exceeded` (thrown by `coachingValidationError`, `messages.mjs:228-235`, on over-cap decision answers, `messages.mjs:357-364`), `board_report_exceeded` (live admission, `coordination-store.mjs` boardBounded / `limits.mjs:66`) — hit the stateful catch (`:1651-1659`), miss the allowlist, and degrade to bare `command_outcome_unknown`. The agent cannot distinguish "answer too large" from "server fault" — the worst possible error for a steering surface. **No test pins this at the MCP wire level** (frame-economics B3 pins only the application layer).
- **E3 — the wave-explicit tool validation refusals are code-only with no offending-member pointer.** `invalid_wave_start`/`invalid_wave_progress`/`invalid_wave_send`/`invalid_workflow_run` (`:1105-1126`) return from `validateArguments` and surface as bare codes (`toolError(invalid)`, `:1423`). A malformed member in `baton_waves_start` yields `invalid_wave_start` — no member index, no field, no message. The agent hand-diffs against the schema.
- **E4 — detail availability is inconsistent across the wave family.** `baton_waves_start` (stateful, `:137`) gets LANE_CRAFTED message+detail on `wave_member_invalid`; `baton_waves_progress`/`waves_list` (observe path, `:1519-1531`) get code+message but NO detail (the observe catch never attaches `detail`). Same lane, different error payloads depending on which tool raises it.
- **E5 — `{decision}` refused with `invalid_arguments`.** The advertised-but-refused form (D3) is rejected with a bare code at `:1021-1024`; the message says nothing about the `optionId`/`text` requirement.

## 4. Grammar consistency (within the surface)

- **G1 — the run-lifecycle family is split between dual-spelled and single-spelled ops.** 10 ops have both a canonical `fleet_run_*`/`baton_*`-derived sibling and a legacy `baton_*` tool (`CANONICAL_ORDINARY_SIBLINGS`, `:24-33`); the 14 lifecycle ops have ONLY the `fleet_run_*` spelling (`APPLICATION_TOOL_DEFINITIONS`, `:383-402`). An agent learning the surface cannot infer which ops carry legacy siblings.
- **G2 — one op, two spellings, divergent arg shapes.** `run.do`→`baton_run_act` (`:461-464`, `actionId`+`inputs`) vs `run.do`→`fleet_run_act`; `run.view`→`baton_run_inspect` (selector semantics: `depth`/`section`/`item`/`cursor`/`waitMs`) vs `run.status`→`fleet_run_status` (plain `runId`). The M4b "one operation, one schema" claim holds only for the 10 sibling ops; the lifecycle tail is not covered by the flip.
- **G3 — idempotencyKey is inconsistent across stateful tools.** Every STATEFUL tool requires it (`:953-955`); `baton_waves_send`/`baton_waves_stop` deliberately omit it (`:137-141` comment, schemas at `:523-533`). The divergence is documented in code but invisible in `MCP.md`, so a caller habitually adding `idempotencyKey` to every stateful call gets no error (extra fields are rejected only if not in schema/hidden — `:941-945`), and a caller omitting it on `waves_start` gets `invalid_idempotency_key`.
- **G4 — three answer shapes in the answer family.** `fleet_respond`'s `answer` is `{}` free-form (`:711`); `fleet_run_answer`/`baton_decision_answer` use the strict `applicationAnswerSchema` (`:359-366`); `fleet_plan_approve` uses `expectedDisposition`+`disposition` (`:716-717`). Three different answer grammars for three "answer/approve" tools.
- **G5 — `{decision}` mismatch (D3/E5) is itself a grammar defect**: the schema's own `oneOf` (advertised) and the validator (accepted) disagree for `baton_decision_answer`.

## 5. Steering fitness — can an orchestrator observe and steer entirely through MCP?

**Observe:**
- At the default profile: `baton_run_view`, `baton_run_episode`, `baton_run_workstreams`, `baton_run_attention_watch` (CAPABILITY `observe`, `:94-110`), `baton_waves_progress` (per-member `{role, phase, progressClass, attention, knowledge}`, `:519-521`). Solid observation of run state and wave progress.
- **Missing at the default profile:** the two primary observe-until idioms — `run.follow` (change-ledger paging) and `run.wait` (block-until) — are both gated behind `combined` (`:387-388`, `:393-394`). An orchestrator on the default surface must poll `baton_run_view`/`baton_run_episode`; it cannot ask the server to hold the response open for a bounded interval.

**Steer:**
- Available: `baton_waves_send` (message one member), `baton_waves_stop` (stop one member), `baton_decision_answer` (answer decisions), `baton_run_act` (perform offered action incl. approve_plan → `run.approve`, `application-semantics.mjs:810`).
- **Missing:** direct `run.approve`/`run.answer`/`run.adopt` at the default profile (combined only); `run.resume_work` and `run.retry_verification` missing on EVERY profile. A run paused awaiting verification cannot be resumed or retried through MCP at all — the orchestrator must leave the surface (CLI/web) to complete the loop.

**Steering verdict:** the surface is steerable-but-gated. Waves steering is complete (send/stop/answer). Run steering is complete only for stop/act; approve/answer/adopt require the combined profile, and the resume/retry tail is unreachable. Observation is complete except wait/follow.

## 6. Ranked frictions (by orchestrator cost)

Each friction: evidence → cost → concrete surface-level fix → issue cross-ref.

**F1 — Run-lifecycle tail (14 ops) gated behind the non-default profile; 2 ops hard-missing.**
- Evidence: application profile = `mcpApplicationToolNames()` (`surface-conformance.mjs:403-407`, 35 tools, no `fleet_run_*`); web bus serves all 14 (`surface-inventory-artifact.json` `web.bus`); combined recovers 12 via `APPLICATION_TOOL_DEFINITIONS` (`:383-402`) but not `run.resume_work`/`run.retry_verification`.
- Cost: **HIGH.** An orchestrator at the documented default cannot approve a plan, wait for a run, adopt/review/integrate a result, resume a paused run, or retry verification. This audit wave's own steering (`approveOnAdvertisedPlan`, `nudgeOnCheckpoint`) would be impossible at the default profile.
- Fix: extend the M4b pattern — render `baton_*` legacy siblings for the 14 (`baton_run_status`, `baton_run_wait`, `baton_run_approve`, `baton_run_follow`, …) into the application profile, so every bus capability is reachable at the default surface with a stable name. Alternatively change the documented default to `combined` (accepting the kernel tool surface).
- Cross-ref: **#147**; the profile-gating itself is **NEW**.

**F2 — `run.resume_work` and `run.retry_verification` absent from every MCP profile.**
- Evidence: bus serves both (`web.bus`); no `fleet_run_*` spelling anywhere in `APPLICATION_TOOL_DEFINITIONS` (`:383-402`); no profile lists them (`surface-inventory-artifact.json`).
- Cost: **MEDIUM-HIGH.** A run paused/awaiting verification cannot be steered through MCP at all; the orchestrator must switch surfaces mid-loop.
- Fix: add `fleet_run_resume_work` + `fleet_run_retry_verification` to `APPLICATION_TOOL_DEFINITIONS` (the `run.resume_work`/`run.retry_verification` commands already exist as `mcp:true` in `APPLICATION_COMMAND_DEFINITIONS`), and to the combined profile.
- Cross-ref: **NEW**.

**F3 — Frame-limit coaching lost on the MCP wire (two sites).**
- Evidence: `validateArguments` collapse → `invalid_run_command` (`:947-953`); `stateFailureCode` allowlist has no `*_exceeded` (`:201-279`); coaching refusals carry `{cap, actual, unit, gracefulPath}` at `limits.mjs:40-42`, `messages.mjs:228-235`; B3 pins only the application layer (`frame-economics-red.test.mjs:679-695`).
- Cost: **MEDIUM.** An over-cap `decision.text` or `board.report.body` yields bare `command_outcome_unknown` — indistinguishable from a server fault; the exact #139 failure mode (no next action). Over-cap `run.objective` yields `invalid_run_command` (no field/cap).
- Fix: (a) allowlist the `*_exceeded` coaching family in `stateFailureCode`, surfacing message + `{cap, actual, unit, gracefulPath}` detail via the same LANE_CRAFTED mechanism (`:1651-1659`); (b) in `validateArguments`, return the typed cause code instead of collapsing to `invalid_run_command` when `validateApplicationCommandArgs` throws a coaching code.
- Cross-ref: **#139**, **#105** (the allowlist precedent).

**F4 — Initialize instructions reference a non-MCP command.**
- Evidence: `:1373-1376` "resolve via the orchestrator's embedded `context.briefing` command"; `context.briefing` is a direct dispatch port, not a tool.
- Cost: **LOW-MEDIUM.** Misdirects a fresh agent at first contact; the only orientation text on the surface names something uncallable.
- Fix: change the sentence to name a real MCP tool (`baton_context_eval` on combined, or a new `baton_briefing_read`), or drop the instruction.
- Cross-ref: **NEW**.

**F5 — Advertised-but-refused `{decision}` form on `baton_decision_answer`.**
- Evidence: `applicationAnswerSchema` oneOf advertises `{decision}` (`:359-366`); validator refuses non-`optionId`/`text` (`:1021-1024`) with bare `invalid_arguments`.
- Cost: **MEDIUM.** Schema-driven clients construct the advertised form and get an unteachable refusal; schema and validator disagree.
- Fix: give `baton_decision_answer` its own `answer` schema (optionId/text only) so advertisement matches acceptance.
- Cross-ref: **NEW**.

**F6 — stdio-only transport excludes process-per-call and remote orchestrators (#138).**
- Evidence: `serveMcpStdio` (`:2165-2218`) is the only transport; `baton-mcp-web` also serves via stdio (`mcp-web.mjs:19-36`); no HTTP server anywhere in the MCP northbound.
- Cost: **MEDIUM.** An orchestrator that is not already an MCP-capable harness (process-per-call harnesses, serverless, remote agents) cannot use the surface at all; the only stateless option is the web bus, which lacks the 20+ MCP-only capabilities (waves, settlement, knowledge).
- Fix: an HTTP transport (design in §7). The infrastructure it needs already exists: per-tool `idempotencyKey` (`:953-955`), the replay ledger (`admitMcpCall` scopeKey+requestDigest, `:1540-1546`), bounded `maxWaitMs` for wait/follow (`:952-956`).
- Cross-ref: **#138**.

**F7 — MCP.md wave examples omit required `repoId`; the auto-bind rule is undocumented.**
- Evidence: `MCP.md:105-121` examples; `baton_waves_start` requires `repoId` (`:509`); descriptor auto-inject (`:1378-1389`); doc is conformance-clean yet misleading.
- Cost: **LOW.** Bites only descriptor-less factory servers (`mcp-stdio.mjs:14-24`); still, the doc is the surface's teaching artifact.
- Fix: add a one-line note in MCP.md that `repoId` is auto-bound under the descriptor and required per-call otherwise.
- Cross-ref: **NEW**.

**F8 — Cursor idioms diverge across the lifecycle.**
- Evidence: `afterCursor` (`:387-388`) vs `cursor`/`nextCursor` (`:517-521`) vs `pageCursor`/`cursor` (`:400-401`).
- Cost: **LOW-MEDIUM.** An agent paging a run must learn three different cursor fields; a paste of one into the other is refused with a bare code.
- Fix: unify on one cursor convention for the run lifecycle (recommend `cursor` everywhere) and mirror it in `MCP.md`.
- Cross-ref: fold into the #147 grammar verdict; **NEW** otherwise.

**F9 — Wave-explicit validation refusals are code-only (no member/field pointer).**
- Evidence: `invalid_wave_start` etc. (`:1105-1126`) → `toolError(invalid)` (`:1423`), code-only.
- Cost: **LOW.** A malformed wave member requires hand-diffing against the schema.
- Fix: extend LANE_CRAFTED-style detail to the wave validation family (member index + field) at the refusal site.
- Cross-ref: #41-pattern; **NEW**.

## 7. Transport (#138) — what stdio-only excludes, what an HTTP endpoint needs

`serveMcpStdio` (`:2165-2218`) is the only transport. `baton-mcp-web` — the name suggests HTTP — still calls `serveMcpStdio` (`mcp-web.mjs:19-36`); the web-bridge packaging does not add a listener. Stdio-only therefore excludes:
- **Process-per-call harnesses** — every `tools/call` needs the server process alive; spawn/teardown per call is prohibitive.
- **Remote/stateless clients** — no URL, no headers, no connectionless identity; the descriptor's principal is bound at process open (`mcp-descriptor.mjs` `createMcpServerFromDescriptor`), so identity cannot ride a request.
- **Long-poll steering** — `fleet_run_wait`/`fleet_run_follow` hold the response for `timeoutMs` (`:387-394`, bounded by deployment `maxWaitMs`); HTTP needs a matching server-side lease.

A stateless HTTP endpoint would need (design sketch, not built):
1. **Session/principal binding per request** — an Authorization/identity header mapped to the descriptor principal + sessionId, replacing the open-time binding. The replay ledger already keys by `scopeKey` = f(repoId,userId,sessionId,tool) (`:1540-1546`), so per-request identity is a matter of deriving the same scopeKey.
2. **Retry-safe exactly-once** — the per-tool `idempotencyKey` (`:953-955`) becomes load-bearing; the existing `admitMcpCall` replay (`:1552-1630`) already dedupes by scopeKey+requestDigest, so HTTP POST retries are safe today.
3. **HTTP semantics mapping** — transport errors (JSON-RPC `-32700`/`-32600` parse/request) currently written as stdout frames (`:2165-2183`); HTTP needs status codes + JSON-RPC error objects.
4. **Backpressure and lifecycle** — `serveMcpStdio` closes the server on stdin EOF (`:2204-2210` `finally close`); HTTP needs its own close on drain/SIGTERM, plus a request-timeout lease matched to `maxWaitMs`.

## 8. Verdict

The MCP surface is the **best-documented and best-typed** of the three surfaces (clean generated doc, schema-annotated tools, a genuinely good typed-error lane for waves/workflows), but its **default profile is not a superset of the bus**: the run-lifecycle tail an orchestrator needs most (approve/wait/follow/status/adopt/review/integrate/resume/retry) is either gated behind `combined` or missing entirely. The two highest-cost defects are F1 (default-profile gating) and F2 (resume/retry hard-missing) on parity, and F3 (frame-limit coaching lost on the wire) on error actionability — all three are the exact failure modes this audit wave exists to catch.
