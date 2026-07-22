# MCP reflex surface decisions contract v2 — baton_context_eval / decision / board / package tools

**v2 revised per red-team findings R-MCP-1..11 (2026-07-22).** v1 (a48cf97) verdict was
needs-revision: the registration-derivation story was wrong (R1/R2), "Web parity by
construction" was false (R3), operator board claim/report recreated the F8 wedge (R4), typed
errors didn't reach the new codes (R5), the answer-shape guard didn't exist (R6), and
board/package binding was undecidable pre-landing (R9 — mooted: REFLEX-2/3 have since landed,
64e657d/b683eb2, and their hub method names are pinned below from code).

Ground truth: docs/32 §3.5, issues #16/#17/#18/#19 (residual MCP acceptance), landed REFLEX
code, and: tool tables (mcp-northbound.mjs:252-393), derived registration sets (:44-57),
generic application dispatch (:1012-1043), explicit fleet branches (:1044-1092), read-only
observe path (:830-852), hand-rolled arg validation (:477-578), applicationAnswerSchema
(:228-235), context_eval method (application.mjs:8364-8417), decision attention projection
(application.mjs:256-277).

## Part A — binding architecture (R1, R2, R11: registration is explicit, per-tool)

1. **A fourth tool table.** `REFLEX_TOOL_DEFINITIONS` (all `baton_*`-named) concatenated into
   `TOOL_DEFINITIONS` (mcp-northbound.mjs:392-393), frozen with `execution: { taskSupport:
   'forbidden' }` and stamped with `_meta { 'baton/registryDigest' }` exactly like the ordinary
   table (:334-338) — the combined list stays _meta-consistent (R11). NOT added to ORDINARY
   (those map 1:1 onto APPLICATION_COMMAND_DEFINITIONS) nor ADVANCED (fleet_* audience).
2. **Explicit dispatch branches, never command-table keys** (the fleet_* shape, :1044-1092).
   NO new APPLICATION_COMMAND_DEFINITIONS keys — the card fixtures are deliberately frozen
   (application.mjs:136-147).
3. **Registration sets are pinned per tool, in this contract** (R1: CAPABILITY/STATEFUL/
   RECONCILABLE derive from MCP_APPLICATION_ENTRIES/ORDINARY_APPLICATION_ENTRIES (:44-57) —
   reflex tools are in NEITHER, so every reflex tool MUST be registered explicitly or
   `_authority` computes `[undefined]` and refuses with `forbidden` (:691-693)):

   | tool | path | capabilities | notes |
   |---|---|---|---|
   | `baton_context_eval` | STATEFUL + RECONCILABLE | `['observe']` | caller idempotencyKey + cell identity (R2/R10) |
   | `baton_decision_list` | read-only observe | `['observe']` | `observe-` hash idempotency (:832-838) |
   | `baton_decision_answer` | STATEFUL + RECONCILABLE | `['approve','observe']` | same as run.answer (application.mjs:122); admitMcpCall settlement integrity (R2) |
   | `baton_board_post/reorder/retitle/close` | STATEFUL + RECONCILABLE | `['observe']` + orchestrator lease | orchestrator-authority transitions |
   | `baton_board_read` | read-only observe | `['observe']` | non-evented, cache-served |
   | `baton_package_admit/attach` | STATEFUL + RECONCILABLE | `['observe']` + orchestrator lease | admission/attach authority |
   | `baton_package_read` | read-only observe | `['observe']` | resolve-time revalidation |

4. **Identity conventions reused verbatim**: `actor = mcp:${userId}:${sessionId}` (:1024);
   stateful `` `mcp.call:${callId}` `` with admitMcpCall; read-only `` `observe-${hash(...)}` ``.
   The run-orchestrator lease (`activeRunOrchestratorLeaseForSession`, :1012-1021) is required
   for orchestrator-authority tools; its absence is a typed refusal, not a fallback.

## Part B — `baton_context_eval` (closes #19's MCP gap; R10)

5. Explicit branch calling `application.contextEval(request, principal, context)`
   (application.mjs:8364-8417). The branch STRIPS `repoId`/`idempotencyKey` before the call —
   `validateContextEvalArgs` refuses unknown keys (:322-335). Principal fits
   `normalizePrincipal`; context carries transport/requestId/idempotencyKey/capabilityAuthority
   (+ sessionAuthority when the lease exists). Input schema mirrors CONTEXT_EVAL_ARGS;
   exactly-one-of runId/manifestDigest enforced by the method. Pure-program refusal surfaces as
   the typed `application_context_effect_forbidden` tool error (Part F). Returns the method's
   `inspect` projection — never a raw cell. Annotations `readOnlyHint:false,
   destructiveHint:false, idempotentHint:true` — honest ONLY because the tool is STATEFUL
   (Part A table): the caller idempotencyKey dedupes calls; cell identity dedupes evaluation.
   The honest-absence comment at mcp-northbound.mjs:24-28 is replaced by the tool.

## Part C — decision tools (closes #16's MCP gap; R6, R7)

6. **`baton_decision_list` (read-only).** Returns pending decision projections from
   `projectDecisionAttention` (application.mjs:256-277 — NOT `projectBlockedInteraction`, which
   returns only `{kind, summary}`, R7): `{ requestId, question, options[{id,label}],
   allowFreeResponse, recommended }` through the boundedAttentionText/SECRET_SHAPED_TEXT
   discipline. `deadlineMs` is NOT exposed (no projection carries it, R7) — surfacing it means
   extending `projectDecisionAttention`, which this contract does NOT do (named follow-up).
   Read-only observe path; never a ledger event.
7. **`baton_decision_answer` (stateful).** Explicit branch dispatching
   `application.command('run.answer', { runId, requestId, answer }, …)` with the generic
   branch's lease/sessionAuthority passthrough (:1035-1040). **Answer-shape guard (R6):** the
   branch (in `validateArguments`, the hand-rolled style) rejects any answer key other than
   `optionId` or `text` BEFORE hub dispatch — `{decision:'allow'}` is a typed
   `invalid_arguments` refusal, because the advertised `oneOf` is never evaluated server-side
   and `normalizeAnswer` would otherwise accept `{decision}` and settle an APPROVAL through the
   decision tool (`assertAnswerKindMatches`, application.mjs:310). Kind-matching stays hub-side;
   the red test asserts: `{optionId}` against a question-kind request stays pending with
   `application_answer_kind_mismatch`, never settles.

## Part D — board tools (R4: the operator-claim wedge; binds landed code)

8. **Orchestrator surface only: `baton_board_{post,reorder,retitle,close,read}`.** Binding the
   landed hub methods: `postBoardItem` (coordination-store.mjs:12061), `reorderBoardItem`
   (:12121), `retitleBoardItem` (:12113), `closeBoardItem` (:12128), and `boardSnapshot`
   (:12203) for read — orchestrator lease required for the four transitions (board-fence
   bumping, reflex2 contract :77-89). Schemas carry `expectedBoardFence` where the hub takes it.
9. **NO claim/report tools this wave (R4).** `requestBoardClaim` (:12142)/`submitBoardReport`
   (:12162) bind `(workerId, taskId)` identity; an MCP operator claim has no handle/task, so no
   terminal hook can ever reap it — the item wedges `claimed` permanently, the exact F8
   deadlock (`_expireBoardClaims` is task-terminal-driven, coordinator.mjs). MCP-driven
   claim/report is REFUSED with a typed `board_claim_principal_forbidden`-style code; enabling
   it requires non-task-claimant expiry semantics first (named follow-up, REFLEX-2 amendment or
   new issue).
10. **`baton_board_read` operator identity (R11):** the operator reads with `workerId = null`
    → the full projection (the "orchestrator sees all" slice). The cache is PROCESS-LOCAL —
    rebuilt non-evented after restart; the contract's "never a ledger event" holds across
    restart because recompute appends nothing. Red tests assert read-after-restart behavior.

## Part E — package tools (binds landed code)

11. **`baton_package_{admit,attach,read}`** binding `admitContextPackage`
    (coordination-store.mjs:8796), `attachContextPackage` (:8830), and
    `resolveContextPackageBranch` (:8779) + `contextPackage`/`contextPackageAttachments`
    (:8569, :8584) for read projections. Admit enforces the landed rules (reserved_package_field,
    unique names, non-empty branches); attach is the fenced O(1) pointer binding (no re-read);
    read resolves through `withContextArtifactVerification`, surfacing missing/changed bytes as
    the typed `artifact_unavailable` tool error — never silent recompute (§93.5).

## Part F — typed-error reach (R5)

12. Extend `stateFailureCode` (:108-148) with the reflex codes: `stale_board_fence`,
    `board_item_digest_mismatch`, `reserved_package_field`, `package_branch_name_conflict`,
    `package_branch_empty`, `package_provenance_integrity`, `artifact_unavailable`,
    `application_context_eval_invalid`, `application_context_effect_forbidden`,
    `application_answer_kind_mismatch`, and the Part D claim-refusal code — never
    `command_outcome_unknown` for these. Extend the read-only error gate (:851) so read-only
    reflex tools map typed codes too (today only `fleet_goal_plan_status ||
    APPLICATION_TOOL[name]`). Red tests assert each code from its triggering call.

## Part G — Web surface decision (R3, R8: NO reflex tools on the bridge this wave)

13. The Web bridge serves `surface: 'application'` = only the ordinary table
    (mcp-northbound.mjs:636-637); its facade rejects `run.answer` and has no `contextEval`
    (mcp-web-bridge.mjs:13-15, :198); its coordinator is a stub (:268). "Parity by
    construction" is FALSE for the reflex table. **Decision: reflex tools are embedded/local
    only.** `kimiBatonMcpEntry.enabledTools` (:294-296) is NOT extended; phase72's pinned
    bridge inventory (:294-297, :464-470, :618-621) stays green UNCHANGED. Red tests assert the
    bridge `-32602` boundary for reflex names (R11). Web reflex parity = facade + surface
    extension, owned as a named follow-up with its own phase72 churn.

## Part H — red tests first (`impl/test/mcp-reflex-surface-red.test.mjs`)

- Registration: every reflex tool resolves a non-undefined CAPABILITY entry; STATEFUL tools
  take the admitMcpCall path (`mcp.call:${callId}` idempotency, replay returns the admitted
  outcome — R2); read-only tools take the observe path.
- Inventory: phase16 closed counts extended in the same commit (47 + N reflex, names verbatim,
  taskSupport forbidden, additionalProperties false, _meta present on reflex tools); phase67
  ordinary-surface assertions unchanged; phase72 bridge assertions unchanged.
- context_eval: strip repoId/idempotencyKey (no `application_context_eval_invalid` on those);
  exactly-one-of; pure refusal typed; projection returned; cell citable `cell:<digest>`.
- decision_list: pending decision appears sanitized; no ledger event; empty otherwise.
  decision_answer: `{optionId}` settles (decision.settled); `{text}` free-response;
  `{decision:'allow'}` refused `invalid_arguments` pre-dispatch; `{optionId}` vs question-kind
  → `application_answer_kind_mismatch`, stays pending; idempotent replay.
- boards: post bumps fence; stale `expectedBoardFence` → typed code; claim/report refused with
  the Part D code; operator read = full slice; read after restart recomputes non-evented.
- packages: reserved_package_field refusal typed; attach O(1) (no revalidation work); missing
  artifact at read → `artifact_unavailable`.
- bridge: reflex names → `-32602`; ordinary names still served.

## Part I — boundaries

No APPLICATION_COMMAND_DEFINITIONS additions. No schema-evaluated validation (hand-rolled
`validateArguments` style preserved). No claim/report over MCP (Part D.9). No reflex tools on
the Web bridge or in enabledTools (Part G). No ledger-evented reads anywhere in this surface.
No board/package hub implementation changes from this wave — bind to what landed
(coordination-store.mjs:8569-8855, :12057-12210). No git commits, no scratch/log writes
anywhere (including /tmp).

## Part J — validation + slicing

Slice 1 (one wave, one seat): registration machinery (Parts A, F) + context_eval (B) +
decision tools (C) + inventory/error tests. Slice 2 (second seat, same wave): board (D) +
package (E) tools + their tests. Both: focused suite green, then full suite
`node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver reviewer
contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0) stays green.
