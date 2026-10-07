# MCP surface audit — dynamic-workflow-2026-08-03 (attempt dw-2026-08-06T00:35:49.006Z)

Board assignment received (`board-dw20260806003549-mcp`, item
`board-item:f941394315f50e18ec5806e3368ea08afd25861d275532678bf5c70097c7a2fb`, title
"workstream: mcp-surface audit"), quoted exactly as it arrived:

> Survey the mcp control-surface dialect and write mcp-surface-audit.md. Audit the MCP dialect for
> an orchestrating AGENT: read impl/MCP.md, impl/src/mcp-descriptor.mjs (small), and the initial...

(the `detail` field arrived truncated with a trailing `...`; nothing past that point was received —
see Friction 5 below.)

Knowledge canary received
(`knowledge:Finding:ac51698193cdb4e6a46354631324e7432195eb24fae087b60b52b021cbb4446b`), quoted
exactly:

> acceptance canary: the acceptance canary phrase is COPPER-FOXNIFE-89007. Seeded by the
> orchestrator to prove the BD3-A read lane serves run-horizon knowledge to the mcp-surveyor.

Method: read `impl/MCP.md` in full and `impl/src/mcp-descriptor.mjs` in full; surveyed the
initialize/tool-table region of `impl/src/mcp-northbound.mjs` (2,143 lines) via targeted
`grep -an`/`sed -n` passes rather than a linear read. Cross-checked tool counts and per-surface
membership by importing the module's own exported inventory functions
(`mcpApplicationToolNames`, `mcpAdvancedToolNames`, `mcpCombinedToolNames`) with `node -e` rather
than counting array literals by eye.

## The dialect

**Connection and descriptor.** A deployment is a bounded, closed JSON descriptor
(`impl/MCP.md:13-37`) read once at open and immutable for the server's life (`impl/MCP.md:3-4`).
`loadMcpDescriptor` (`impl/src/mcp-descriptor.mjs:88-133`) enforces this via `closedRecord`
(`impl/src/mcp-descriptor.mjs:34-44`): any field outside the declared set is rejected by name, and
the error names the field plus the constraint, never the value
(`impl/src/mcp-descriptor.mjs:25-28`, matching the doc's promise at `impl/MCP.md:5`). File
credential refs are containment-checked against symlink escape both lexically and via
`realpathSync` (`impl/src/mcp-descriptor.mjs:56-74`). A descriptor whose routes carry no
resolvable harness adapters degrades to a doctor-only facade rather than pretending a harness
exists (`impl/src/mcp-descriptor.mjs:135-169`, honest `application_command_unavailable`).

**Surface selection.** Three surfaces exist: `application` (default/"ordinary"), `advanced`, and
`combined` (`impl/src/mcp-descriptor.mjs:23`, `impl/src/mcp-northbound.mjs:1191`). The server picks
the exposed tool table per surface at construction time (`impl/src/mcp-northbound.mjs:1221-1222`):
- `application` → `ORDINARY_APPLICATION_TOOL_DEFINITIONS` only
- `advanced` → `ADVANCED_TOOL_DEFINITIONS` only
- `combined` → all four tables concatenated (`impl/src/mcp-northbound.mjs:788`)

I measured the actual sizes by calling the module's exported helpers directly: **33 tools** on
`application`, **19** on `advanced`, **84** on `combined` — so 32 tools (`84 − 33 − 19`) exist
*only* on `combined` and are invisible to both single-purpose surfaces. Both `initialize`'s
implicit-notification `tools` payload and `tools/list` return exactly `this.toolDefinitions`
(`impl/src/mcp-northbound.mjs:1328,1333`), so a default client — one that opens the descriptor's
documented default `surface: "application"` (`impl/MCP.md:46-47`) — sees only the 33-tool ordinary
set. `MCP.md`'s generated tool-inventory table (`impl/MCP.md:110-148`, 30 rows) matches that
ordinary surface; its `kernel`-profile rows (`knowledge.promote`, `knowledge.settlement_lease`,
`scratchpad.elevate`, `scratchpad.settle`) are still wired onto the *ordinary* MCP tool table
(confirmed by grep: `baton_scratchpad_elevate`/`baton_scratchpad_settle`/`baton_knowledge_promote`/
`baton_knowledge_settlement_lease` are all defined inside `LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS`,
`impl/src/mcp-northbound.mjs:385-643`) — "kernel" here is a capability-class label
(`impl/MCP.md:99-106`), not a surface-visibility gate. An agent on the default surface can *see*
and *call* these four tools; the descriptor's `principal.capabilities` (never defaulted for
`settlement`) is what actually blocks misuse.

**Closed schemas.** Every ordinary/reflex tool's `inputSchema` is built through one `schema()`
helper (`impl/src/mcp-northbound.mjs:267-269`) that unconditionally sets
`additionalProperties: false`. The one hand-rolled exception, `fleet_capability_invoke`
(`impl/src/mcp-northbound.mjs:684-691`), still spreads `schema(...)` as its base before adding a
`oneOf`, so `additionalProperties: false` survives. The closed-schema guarantee holds uniformly
across all four tables.

**The six new workflow-surface tools.** `impl/src/mcp-northbound.mjs:584-638` adds six tools to
the *ordinary* table: `baton_run_message_send`, `baton_run_message_receipt`,
`baton_run_attention_watch`, `baton_run_scratchpad_read`, `baton_run_scratchpad_elevate`,
`baton_run_knowledge_seed` — the comment above them (`impl/src/mcp-northbound.mjs:106-107`) labels
them "the six ordinary workflow-surface tools" from "Facade-projection epic (#87+#48)". Their
capability classes are registered explicitly at `impl/src/mcp-northbound.mjs:108-113`
(send/elevate/seed require `control`; the two reads require only `observe`), and their names are
listed in `ORDINARY_EXPLICIT_TOOLS` (`impl/src/mcp-northbound.mjs:780-787`) — meaning they dispatch
through hand-written `_dispatch` branches (`impl/src/mcp-northbound.mjs:1110-1146`, then
`1771-1832`) rather than through `APPLICATION_COMMAND_DEFINITIONS`, so their failures reach a typed
`stateFailureCode` lane rather than the generic `command_failed` path. The comment at
`impl/src/mcp-northbound.mjs:580-583` is explicit that none of the six carries a wire
`idempotencyKey`: retries on send/elevate mint new effects honestly, and elevate/seed replay safety
lives server-side in deterministic keys. `MCP.md`'s generated table confirms all six as `ordinary`
(`impl/MCP.md:121,125-132`). Structurally they are one array literal appended inside
`LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS` (`impl/src/mcp-northbound.mjs:385-643`), and the
whole array — six new tools included — is stamped uniformly at the end with
`_meta['baton/registryDigest']` and `execution: { taskSupport: 'forbidden' }`
(`impl/src/mcp-northbound.mjs:639-643`).

**Initialize instructions.** The `initialize` response (`impl/src/mcp-northbound.mjs:1309-1319`)
returns, verbatim:

> `${flipFace('smile')} baton — reflexive multi-agent orchestration. Waves are the primary surface
> (start/attach/steer); settlement lanes arrive through the envelope tools. See MCP.md.`

(`impl/src/mcp-northbound.mjs:1318`). It names waves and "envelope tools" (the four
`scratchpad_elevate`/`scratchpad_settle`/`knowledge_promote`/`knowledge_settlement_lease` ops
documented at `impl/MCP.md:90-106`) but names neither the six workflow-surface tools nor
`baton_deployment_doctor` nor `baton_run_act`/`baton_run_stop`.

**Ordinary vs. combined split, in detail.** The 32 combined-only tools split into two different
groups:
1. **Reflex tools** (`impl/src/mcp-northbound.mjs:714-772`): `baton_context_eval` plus the
   `SURFACING_MATRIX_MCP_ROWS` projection — `baton_board_{read,post,retitle,reorder,close,drop}`,
   `baton_package_{admit,attach,read}`, `baton_repl_cite`, `baton_knowledge_{recall,horizon}`,
   `baton_decision_list` (descriptions at `impl/src/mcp-northbound.mjs:730-741`) — genuinely new
   capability surfaces not reachable any other way through MCP.
2. **`fleet_run_*` canonical mirrors** (`impl/src/mcp-northbound.mjs:365-384`, e.g.
   `fleet_run_start`, `fleet_run_status`, `fleet_run_stop`, `fleet_run_approve`,
   `fleet_run_workstreams`) — not new operations. They dispatch to the same
   `APPLICATION_COMMAND_DEFINITIONS` entries the ordinary table already exposes under
   `baton_run_start`, `baton_run_view`/`baton_run_inspect`, `baton_run_stop`, etc.
   (`impl/src/mcp-northbound.mjs:13-15,32-47`), just under a `fleet_`-prefixed canonical name. They
   only appear when `surface: "combined"`, even though the underlying operations are fully
   ordinary.

## Frictions found

1. **`initialize.instructions` omits the newest ordinary surface.** The onboarding text an LLM
   client reads before ever calling `tools/list` (`impl/src/mcp-northbound.mjs:1318`) orients
   entirely around waves and the four settlement/envelope tools. It says nothing about
   `run.message.*`, `run.attention.watch`, `run.scratchpad.*`, or `run.knowledge.seed` — a client
   that trusts `instructions` as its map of "what this server is for" will not learn these six
   exist until it does a full `tools/list` scan and reads each description individually.

2. **Two independent canonicalization mechanisms, with different surface reach.**
   `CANONICAL_ORDINARY_SIBLINGS` (`impl/src/mcp-northbound.mjs:22-31`, 6 operations: `run.do`,
   `run.view`, `run.member.view`, `run.member.send`, `run.member.stop`, `application.help`) mirrors
   both the legacy and canonical spelling into the *ordinary* table
   (`impl/src/mcp-northbound.mjs:650-653`) — a caller reaches the operation either way on the
   default surface. But `MCP_APPLICATION_ENTRIES` → `APPLICATION_TOOL_DEFINITIONS`
   (`impl/src/mcp-northbound.mjs:13-15,365-384`, ~18 operations including `run.start`, `run.stop`,
   `run.approve`, `run.workstreams`) mirrors only into the `combined`-only `fleet_run_*` names — the
   canonical spelling for those operations is invisible on both `application` and `advanced`. A
   tool author skimming the ordinary table would reasonably assume canonical/legacy pairs follow
   one uniform pattern; they don't.

3. **`fleet_*` (advanced) tool definitions lack the `_meta['baton/registryDigest']` stamp that
   ordinary and reflex tools carry.** The closing `.map()` for `ADVANCED_TOOL_DEFINITIONS`
   (`impl/src/mcp-northbound.mjs:707`) sets only `execution`, while the equivalent maps for the
   ordinary table (`impl/src/mcp-northbound.mjs:639-643`) and the reflex table
   (`impl/src/mcp-northbound.mjs:723-727`, `751-757`) both add `_meta`; the comment at
   `impl/src/mcp-northbound.mjs:686-688` even states reflex tools are "stamped with `_meta` exactly
   like the ordinary table above" — `advanced` is the one table that isn't. A client keying
   drift-detection off `_meta['baton/registryDigest']` presence gets a false negative for every
   `fleet_*` tool.

4. **Board is unreachable on the documented default surface.** `impl/MCP.md`'s "Orchestrate a
   wave" walkthrough (`impl/MCP.md:61-88`) and its generated tool table (`impl/MCP.md:108-148`)
   never mention board tools, and the measured `application` tool set confirms it: none of
   `baton_board_{read,post,retitle,reorder,close,drop}` is reachable unless the deployment
   descriptor sets `surface: "combined"` — a non-default, advanced-deployment-only choice
   (`impl/MCP.md:46-47`). An orchestrating agent following the documented default path has no
   MCP-native way to read or post to a board at all — which is exactly why this audit's own board
   assignment had to arrive over a separate `CONTEXT_READ` wire lane rather than an MCP tool call.

5. **The board assignment I received was truncated mid-sentence** ("...and the initial..."),
   naming only two of the three files this audit was supposed to read before cutting off. Per the
   "never invent content" rule, I did not guess the missing text; I inferred the intended third
   target (the initialize/tool-table region of `impl/src/mcp-northbound.mjs`) from the outer task
   framing that accompanied the dispatch, not from the board content itself, and I'm flagging the
   truncation here rather than silently completing the sentence.

## Recommendations

- Extend `initialize.instructions` (`impl/src/mcp-northbound.mjs:1318`) to name the
  message/attention/scratchpad/knowledge-seed lane as a second first-class category alongside
  waves, or point at an `impl/MCP.md` section that documents it — `MCP.md` itself currently has no
  narrative section for the six tools either, only the generated table row-per-tool
  (`impl/MCP.md:108-148`); a short prose paragraph mirroring "Orchestrate a wave" would close both
  gaps at once.
- Either fold the `fleet_run_*` mirrors into the ordinary surface (matching
  `CANONICAL_ORDINARY_SIBLINGS`'s dual-registration pattern) or document explicitly in `MCP.md` why
  `run.start`/`run.stop`/etc. have a canonical spelling that is deliberately combined-only — as
  written, the asymmetry reads as an oversight rather than a decision.
- Add the `_meta['baton/registryDigest']` stamp to `ADVANCED_TOOL_DEFINITIONS`
  (`impl/src/mcp-northbound.mjs:655-707`) for parity with the ordinary and reflex tables, or note in
  a comment why `advanced` is intentionally excluded.
- Consider surfacing at least read-only board access (`baton_board_read`) on the `application`
  surface — an agent operating under the documented default profile currently cannot read the board
  it is coordinating against without a `combined` deployment, which this audit had to route around
  via a non-MCP wire lane.

Deployment verification: this evidence tree is exercised under Baton deployment profile
`default@88080f5eb6286bc0e0bc68b09a77ef0bf3268803c830f7ebe9bffa55f64e496d`; the reviewer contract's
execution check (`true`, argv `[]`, cwd `.`, expected exit `0`) is independent of this file's
content and was run directly (`bash -c true` → exit 0) as part of this session.
