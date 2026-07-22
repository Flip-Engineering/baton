# MCP reflex surface decisions contract — baton_context_eval / decision / board / package tools

Ground truth: docs/32 §3.5 (docs/32-reflexive-orchestration.md:256-273), issues #16/#17/#18/#19
(residual MCP-surface acceptance in each), the REFLEX-1/4 landed code (c164532, 3671bfe), and the
REFLEX-2/3 contracts in this directory's sibling evidence dir
(docs/reference/evidence/reflex-wave-live-2026-07-21/, committed b0d4976). Code: tool tables
(mcp-northbound.mjs:252-393), generic application dispatch (:1012-1043), explicit fleet branches
(:1044-1092), hand-rolled arg validation (:477-578), applicationAnswerSchema (:228-235),
context_eval method-only port (application.mjs:8364-8417, note :136-147), Web bridge parity by
construction (mcp-web-bridge.mjs:242-281, kimiBatonMcpEntry.enabledTools :294-296).

## Part A — binding architecture (the one structural decision)

1. **A fourth tool table.** New `REFLEX_TOOL_DEFINITIONS` (all `baton_*`-named) concatenated into
   `TOOL_DEFINITIONS` (mcp-northbound.mjs:392-393) and stamped with the same
   `execution: { taskSupport: 'forbidden' }` + `_meta 'baton/registryDigest'` treatment as the
   ordinary table (:334-338). NOT added to `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (those map 1:1
   onto `APPLICATION_COMMAND_DEFINITIONS` via `APPLICATION_TOOL`/`ORDINARY_APPLICATION_ENTRIES`),
   and NOT to `ADVANCED_TOOL_DEFINITIONS` (fleet_* coordinator surface, different audience).
2. **Explicit dispatch branches, never command-table keys.** Reflex tools route as explicit
   `else if` branches in `_dispatch` (the fleet_* shape, :1044-1092) calling the application
   methods directly (`application.contextEval`, `application.command('run.answer', …)`, and the
   REFLEX-2/3 hub methods). NO new `APPLICATION_COMMAND_DEFINITIONS` keys: the card fixtures are
   deliberately frozen (application.mjs:136-147 names phase64/12/72/16); REFLEX-4 already took
   this bypass for context_eval and this contract generalizes it. Idempotency/actor conventions
   are the generic branch's, reused verbatim: `actor = mcp:${userId}:${sessionId}` (:1024),
   stateful `` `mcp.call:${callId}` ``, read-only `` `observe-${hash(...)}` `` (:832-838).
3. **Inventory tests extended deliberately, in the same commit.** phase16-mcp-northbound
   (:65-79, :88-101) asserts closed verbatim inventories and `tools.length === 47`; the reflex
   table changes all three. The red tests name the NEW closed counts (9 ordinary + 19 fleet_run +
   19 advanced + N reflex) and assert the reflex names verbatim — a closed inventory stays closed.
   `kimiBatonMcpEntry.enabledTools` (mcp-web-bridge.mjs:294-296) is the third name-registration
   site and MUST list the new tools in the same diff.
4. **Web parity is by construction — keep it.** The bridge serves the same `McpFleetServer`
   (mcp-web-bridge.mjs:272-273), so the reflex table appears there automatically. The bridge's
   `ORDINARY_COMMANDS` proxy allowlist (:13-15) is NOT extended to proxy reflex methods remotely in
   this wave; remote Web clients get the tool list served locally by the bridge's own server
   instance. (If a reflex method needs the remote facade later, that is a named follow-up, not a
   default.)

## Part B — `baton_context_eval` (closes #19's MCP gap)

5. Bind `application.contextEval(request, principal, context)` (application.mjs:8364-8417)
   directly — the already-landed authority, including its pure-program refusal
   (`application_context_effect_forbidden`) and `validateContextEvalArgs` shape
   (application.mjs:322-335). Input schema mirrors CONTEXT_EVAL_ARGS exactly:
   `{ repoId, idempotencyKey, runId?, manifestDigest?, role?, program }`, exactly-one-of
   runId/manifestDigest enforced by the method. Returns the method's `inspect` projection
   (application.mjs:8413-8415) — never a raw cell. Annotations:
   `readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false`
   (stateful Bench admission, idempotent by cell identity). The honest-absence comment at
   mcp-northbound.mjs:24-28 is replaced by the tool.

## Part C — decision tools (closes #16's MCP gap)

6. **`baton_decision_list` (read-only).** Returns the sanitized pending-decision projection for a
   run: the same `blocked_interaction:decision` attention items `projectBlockedInteraction`
   produces (application.mjs:240-253), filtered to kind=decision, each carrying
   `{ requestId, question, options[{id,label}], allowFreeResponse, recommended, deadlineMs }`
   through the boundedAttentionText/SECRET_SHAPED_TEXT discipline. Read-only idempotency
   (`observe-` hash), `readOnlyHint:true`. Never a ledger event (the F10 non-evented-read rule
   boards already follow).
7. **`baton_decision_answer` (stateful).** Dispatches to
   `application.command('run.answer', { runId, requestId, answer }, …)` through the SAME generic
   application-command branch used by `fleet_run_answer` — i.e. the tool's name is registered in
   `APPLICATION_TOOL` mapping to `'run.answer'` so it inherits lease/sessionAuthority passthrough
   (:1012-1043). Input schema restricts `applicationAnswerSchema` (:228-235) to the two decision
   forms only: `{ optionId }` or `{ text }` (free response). Kind-matching stays hub-side
   (`assertAnswerKindMatches`, application.mjs:308-317) — the tool does not re-check, it
   constrains shape. Malformed answers stay pending (issue #16 acceptance).

## Part D — board tools (bind REFLEX-2 hub methods as they land)

8. Six tools per docs/32 §3.5: `baton_board_{post,reorder,close,claim,report,read}`. Authority
   split mirrors the REFLEX-2 contract (reflex2-boards-decisions.md:77-89): post/reorder/close
   are orchestrator-authority transitions (board-fence bumping) and require the run's
   orchestrator principal (the `activeRunOrchestratorLeaseForSession` authority already threaded
   at :1012-1021); claim/report are worker-surface operations admitted with the caller's actor
   identity. `baton_board_read` is the cached `BoardProjection` (keyed
   `(board, workerId, boardFence)`) — non-evented, never appends a ledger event, serves
   `boardViewTruncated` explicitly on MAX_BOARD_VIEW_BYTES overflow.
9. Failure surfacing: `stale_board_fence` and `board_item_digest_mismatch` map through
   `stateFailureCode` (:108-148) as typed tool errors, never protocol errors. Schemas carry
   `expectedBoardFence` (CAS) for claim and exact `(itemId, itemVersion)` for report/close.

## Part E — package tools (bind REFLEX-3 hub methods as they land)

10. Three tools per docs/32 §3.5: `baton_package_{admit,attach,read}`. admit runs
    `normalizeContextPackage` admission (hub-derived `packageEvent`, reserved-field refusal
    `reserved_package_field`, unique branch names, non-empty branches); attach binds
    `run.attach_package(run, packageDigest, { scope })` (reflex3-packages-decisions.md:72-74) —
    fenced O(1) pointer binding, NO byte re-read; read resolves branches through
    `withContextArtifactVerification` and surfaces missing/changed bytes as the typed
    `artifact_unavailable` tool error (never silent recompute, §93.5).

## Part F — red tests first (`impl/test/mcp-reflex-surface-red.test.mjs`)

- The new closed tool inventory: reflex names asserted verbatim; phase16 counts updated in the
  same commit; `execution.taskSupport==='forbidden'` and `additionalProperties:false` on every
  reflex tool; `kimiBatonMcpEntry.enabledTools` contains the reflex names.
- context_eval: schema-shape refusal (`invalid_arguments`/`unknown_argument_field`),
  exactly-one-of runId/manifestDigest, pure-program refusal maps to
  `application_context_effect_forbidden` tool error, a pure eval returns the inspect projection
  and the cell is citable by `cell:<digest>`.
- decision_list: pending decision appears sanitized (secret-shaped text redacted), no ledger
  event appended by the read; empty when none pending. decision_answer: `{optionId}` settles a
  decision (decision.settled), `{text}` settles free-response, `{decision:'allow'}` shape is
  REFUSED at schema level, answering a question-kind request through the decision tool stays
  pending (kind check hub-side).
- boards: post bumps the board fence, read serves cache-identical projection until a fence bump,
  claim with stale `expectedBoardFence` → typed `stale_board_fence`, report binds exact
  (itemId, itemVersion). packages: admit with `provenance.packageEvent` → `reserved_package_field`
  tool error; attach is a binding without revalidation work; read of a missing-artifact branch →
  `artifact_unavailable`.
- Parity: the Web bridge `tools/list` contains the reflex names (same-server construction).

## Part G — boundaries

No `APPLICATION_COMMAND_DEFINITIONS` additions. No schema-evaluated validation rewrite (keep the
hand-rolled `validateArguments` style). No `board.read`/`package.read` ledger event kinds (reads
are non-evented everywhere). No remote-facade proxying of reflex methods in `ORDINARY_COMMANDS`
this wave. Notifications/elicitation/resources (docs/32 §3.5 lines 264-273) and
`baton_wave_*` tools are SEPARATE slices, not this wave. No git commits, no scratch/log writes
anywhere (including /tmp). Do not modify the REFLEX-2/3 hub implementations from this wave — bind
to what landed; gaps are reported, not patched around.

## Part H — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the
worktree root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`,
exit 0) stays green.
