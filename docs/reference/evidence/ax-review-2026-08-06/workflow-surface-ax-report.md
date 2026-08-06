# AX Review — WORKFLOW-SURFACE epic agent experience (attempt ax-2026-08-06T03:03:32.570Z)

Reviewed as an orchestrating agent would: read impl/MCP.md + impl/CLI.md, then exercised all eight
facade ports, six MCP tools, nine CLI spellings against the impl sources (NUL-safe grep -an) + the
WS-01/FP-01..19 pins; `node --test impl/test/workflow-surface-red.test.mjs` is green (37/37).

## What worked
- The MCP tool schemas carry the hard wire grammars the docs omit: `message:[a-f0-9]{64}`
  (baton_run_message_receipt, mcp-northbound.mjs:596), `scratchpad-entry:[a-f0-9]{64}` (:625), scope
  `shared|worker:<id>` (:613). A schema-reading agent is covered on the MCP surface.
- Byte-cap coaching names cap AND actual (2048-byte message body, application.mjs:12415-12420;
  FP-15 pins the wire; same for board title/detail/evidence).
- Receipts chain end-to-end: `messageId`→message_receipt, `entryId`→scratchpad_elevate,
  `item.itemId`+`boardRunBinding {runId,result:'adopted'|'bound'}` (application.mjs:12785-12786),
  and the `knowledge:<Type>:<hex>` nodeId cited verbatim into wave objectives (WS-01) — enough to
  drive the scripted workflow.
- Closed shapes: unknown MCP fields die at the key-closure; bad CLI sub-verbs are loud
  `cli_invalid`, never a silent run-start objective (application-cli.mjs:1373-1376).
- Resolve-then-authorize is honest: unknown messageId/task refuse `application_unauthorized`
  identically to foreign ones (application.mjs:12632-12636 / :12704-12708); non-terminal elevation
  rides as typed `{ok:false,result:'scratchpad_settlement_not_ready'}` (isError false, FP-19).
- The eight ports dispatch pre-gate so a live lease holder reads as review authority (FP-18); the
  ordinary command table stays byte-unchanged.

## Frictions (each: reproduction shape → file:line)
1. **attention.watch is silently dead for the documented MCP principal (HIGH).**
   `baton_run_attention_watch {repoId, runId, kind:'member_terminal'}` under MCP.md's example
   principal `{userId:'operator', capabilities:[...,'control']}` (MCP.md:29-31): the lane admits only
   `wave-owner` or a live run-orchestrator lease (coordinator.mjs:6997-7018; leases mint only in
   settlement, never at run/wave start), so it throws `attention_scope_forbidden` and the northbound
   catch silently returns `{schemaVersion:1, runId, afterCursor:0, throughCursor:0, reasons:[]}`
   (mcp-northbound.mjs:1802-1805). An agent watches a completed member and forever sees "no news";
   WS-01 passes only because its principal is literally named `wave-owner`. MCP.md never discloses the
   requirement; the fallback also rewinds the cursor to 0 regardless of the requested cursor (:1804).
2. **knowledge_seed evidence refs are opaque on the MCP wire.** Schema says `items:{type:'object'}`
   (mcp-northbound.mjs:635) while the registry knows `oneOf {coordinationSeq:int≥1}|{artifactId}`
   (application-semantics.mjs:152-157); a malformed ref dies at the facade with generic
   `application_knowledge_seed_invalid`. CLI.md shows no evidence example.
3. **CLI wire grammars are undocumented and the refusal doesn't teach them.**
   `baton run message receipt abc123` → `message ID is invalid` (application-cli.mjs:1386) with no
   format hint; CLI.md's example shows bare `MESSAGE_ID`. Same for `scratchpad-entry:` / worker-scope.
4. **run.message.send soft-fail states are undocumented.** `{runId, kind:'inform', body:'x'}` to a
   run with zero live workers → `{ok:false, result:'run_not_active'}` (coordinator.mjs:6836); unknown
   worker → `worker_not_active` (:6831), both passed through as non-error receipts
   (application.mjs:12597-12620). Right after waves.start members may not have spawned yet; the docs
   never mention the retry case.
5. **Two refusal-code namespaces per tool.** Shape error (both runId+workerId) → MCP guard's
   `invalid_message_send` (mcp-northbound.mjs:1116); deep error (oversize body) → facade's
   `application_message_send_invalid`. MCP.md lists neither family.
6. **message_receipt has fields that never advance.** `{repoId, messageId}` → `{delivered:true|null,
   read:true|null, actedOn:null, reply:null}` (coordinator.mjs:6914-6920): `actedOn` is
   unconditionally null, `read` tri-state; the description says "the lane's exact shape" without
   disclosing which fields a poller may wait on.
7. **board.read truncates with no continuation.** Past 512 items / 256KiB it returns
   `boardViewTruncated:true` (application.mjs:513-603; limits.mjs:89-90) with no facade cursor
   (application.mjs:12788-12806); the remainder is unreadable through any surfaced verb.
8. **The CLI worker-target flag is undocumented.** `--worker w-1` parses (application-cli.mjs:1369) but
   CLI.md shows only the RUN_ID form; the XOR rule is invisible to a docs-first caller.
9. **scratchpad.elevate's taskId has no documented discovery path.** `--task TASK_ID` is resolved
   run-scope by the facade (application.mjs:12696-12710), but neither doc says where an agent gets it.
10. **The verified-Finding-requires-evidence rule is code-only.** `{type:'Finding', grounding:'verified',
    body:'x'}` with no evidence → `application_knowledge_seed_invalid` (application.mjs:12588); the MCP
    enums can't express the conditional and the description never mentions it.
11. **Boards are absent from the MCP surface.** `run.board.post/read` surfaces are
    ['embedded','cli'] (application-semantics.mjs:1660-1677) — two of the eight epic ports have no
    MCP tool, though MCP.md calls MCP "the primary agent-facing surface" without noting the gap.

## Recommendations
1. **Mint a run-orchestrator lease for the descriptor operator at run.start/waves.start** so the
   documented principal actually pages attention (or require `wave-owner` in MCP.md's principal
   block); make the empty fallback echo the requested cursor and audit the silent conversion.
2. Carry the registry's `evidenceRef` oneOf into the MCP knowledge_seed schema and add seed-evidence
   + `message:<64hex>` / `worker:<id>` examples to CLI.md so parse refusals aren't the only teacher.
3. Document the send soft-fail states and the receipt's permanent-null fields in MCP.md's steer
   prose; map the guard's `invalid_*` codes onto the `application_*` family (or document both).
4. For scratchpad.elevate, document the taskId source or accept `workerId` and derive the task
   server-side; for board.read, expose a cursor or state the 512-item/256KiB ceiling is final.

Verified: `node --test impl/test/workflow-surface-red.test.mjs` — 37 pass, 0 fail. Fine as-is: message
send/receipt chaining, scratchpad read pagination, byte-cap coaching, and the CLI parse discipline.
