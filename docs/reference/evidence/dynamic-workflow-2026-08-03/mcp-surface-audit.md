# MCP surface audit — dynamic-workflow-2026-08-03

Board assignment received (`board-dw20260805234404-mcp`, item
`board-item:ff071e133c6f7ddef2ce032b5a0aa4df3d729afac07c77fe8b339023a1298978`, title
"workstream: mcp-surface audit"), quoted exactly as it arrived:

> Survey the mcp control-surface dialect and write mcp-surface-audit.md. Audit the MCP dialect for
> an orchestrating AGENT: read impl/MCP.md, impl/src/mcp-descriptor.mjs (small), and the initial...

(the `detail` field arrived truncated with a trailing `...`; nothing past that point was received.)

Knowledge canary received (`knowledge:Finding:5b7b98705f5cf835c5eb18139b9a6cef022327c7117a2affcf71c9aa2ab1b206`),
quoted exactly:

> acceptance canary: the acceptance canary phrase is COPPER-FOXNIFE-44013. Seeded by the
> orchestrator to prove the BD3-A read lane serves run-horizon knowledge to the mcp-surveyor.

Method: read `impl/MCP.md` in full, `impl/src/mcp-descriptor.mjs` in full, and the
initialize/tool-table region of `impl/src/mcp-northbound.mjs` via targeted `grep -n`/`sed -n`
passes; cross-checked tool counts and per-surface membership by importing the file's own exported
inventory functions (`mcpApplicationToolNames`, `mcpAdvancedToolNames`, `mcpCombinedToolNames`,
`impl/src/mcp-northbound.mjs:2132-2143`) rather than counting by eye.

## The dialect

**Connection and descriptor.** A deployment is a bounded, closed JSON descriptor
(`impl/MCP.md:13-37`) read once at open and immutable for the server's life
(`impl/MCP.md:3-4`). `loadMcpDescriptor` (`impl/src/mcp-descriptor.mjs:88-133`) enforces this via
`closedRecord` (`impl/src/mcp-descriptor.mjs:34-44`): any field outside the declared set is
rejected by name, and the error names the field plus the constraint, never the value
(`impl/src/mcp-descriptor.mjs:25-28`, matching the doc's promise at `impl/MCP.md:5`). File
credential refs are containment-checked against symlink escape both lexically and via
`realpathSync` (`impl/src/mcp-descriptor.mjs:56-74`).

**Surface selection.** Three surfaces exist: `application` (default/"ordinary"), `advanced`, and
`combined` (`impl/src/mcp-descriptor.mjs:23`, `impl/src/mcp-northbound.mjs:1191`). The server picks
the exposed tool table per surface at construction time
(`impl/src/mcp-northbound.mjs:1221-1223`):
- `application` → `ORDINARY_APPLICATION_TOOL_DEFINITIONS` only
- `advanced` → `ADVANCED_TOOL_DEFINITIONS` only
- `combined` → all four tables concatenated (`impl/src/mcp-northbound.mjs:788`)

I measured the actual sizes by calling the module's own exported helpers rather than trusting a
comment: **33 tools** on `application`, **19** on `advanced`, **84** on `combined` — so 32 tools
(`84 − 33 − 19`) exist *only* on `combined` and are invisible to both single-purpose surfaces. Both
`initialize`'s `tools` response and `tools/list` return exactly `this.toolDefinitions`
(`impl/src/mcp-northbound.mjs:1327-1328,1333`), so a default client — one that opens the
descriptor's documented default `surface: "application"` (`impl/MCP.md:46-47`) — sees only the
33-tool ordinary set. `MCP.md`'s generated tool-inventory table (`impl/MCP.md:110-148`) matches
that ordinary set (30 rows, `ordinary`/`kernel` profile column; the 2 `kernel`-profile rows —
`baton_knowledge_promote`, `baton_knowledge_settlement_lease` — are gated by the descriptor's
`settlement` capability, `impl/MCP.md:99-106`), confirming the doc is generated from the same
surface a real client would see.

**Closed schemas.** Every tool's `inputSchema` is built through one `schema()` helper
(`impl/src/mcp-northbound.mjs:267-269`) that always sets `additionalProperties: false`. I grepped
every `inputSchema:` site in the tool-table region and found none that bypass `schema()` for a
hand-rolled object (the one exception, `fleet_capability_invoke`'s literal inline schema at
`impl/src/mcp-northbound.mjs:684`, still declares `additionalProperties: false` directly). So the
closed-schema guarantee holds uniformly across all four tables, not just the ordinary one.

**The six new workflow-surface tools.** `impl/src/mcp-northbound.mjs:579-638` adds six tools to the
*ordinary* table under a "Facade-projection epic (#87+#48, contract v2.2)" comment:
`baton_run_message_send`, `baton_run_message_receipt`, `baton_run_attention_watch`,
`baton_run_scratchpad_read`, `baton_run_scratchpad_elevate`, `baton_run_knowledge_seed`. Their
capability classes are registered explicitly at `impl/src/mcp-northbound.mjs:106-113` (send/elevate/
seed require `control`; the two reads require only `observe`) and their names are listed in
`ORDINARY_EXPLICIT_TOOLS` (`impl/src/mcp-northbound.mjs:780-787`) — meaning they dispatch through
hand-written `_dispatch` branches (`impl/src/mcp-northbound.mjs:1110-1146,1771-1832`) rather than
through `APPLICATION_COMMAND_DEFINITIONS`, and the comment at
`impl/src/mcp-northbound.mjs:580-583` is explicit that none of the six carries a wire
`idempotencyKey` — retries on `send`/`elevate` mint new effects honestly, and replay safety for
elevate/seed lives server-side in deterministic keys (Decisions 7/9). `MCP.md`'s generated table
confirms all six as `ordinary` (`impl/MCP.md:121,125,129-132`). Structurally, they are one array
literal appended to `LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS`
(`impl/src/mcp-northbound.mjs:385-643`), and the whole array — the six new tools included — is
stamped uniformly at the end with `_meta['baton/registryDigest']` and
`execution: { taskSupport: 'forbidden' }` (`impl/src/mcp-northbound.mjs:639-643`).

**Initialize instructions.** The `initialize` response
(`impl/src/mcp-northbound.mjs:1309-1319`) returns, verbatim:

> `${flipFace('smile')} baton — reflexive multi-agent orchestration. Waves are the primary surface
> (start/attach/steer); settlement lanes arrive through the envelope tools. See MCP.md.`

(`impl/src/mcp-northbound.mjs:1318`). It names waves and "envelope tools" (the four
`scratchpad_elevate`/`scratchpad_settle`/`knowledge_promote`/`knowledge_settlement_lease` ops
documented at `impl/MCP.md:90-106`) but does not name or categorize the six workflow-surface tools,
`baton_deployment_doctor`, or `baton_run_act`/`baton_run_stop` at all.

**Ordinary vs. combined split, in detail.** I diffed the combined name list against
ordinary ∪ advanced to see exactly what "combined-only" means in practice
(`impl/src/mcp-northbound.mjs:2132-2143`). The 32 combined-only tools split into two very different
groups:
1. **Reflex tools** (`impl/src/mcp-northbound.mjs:770-772`, table comment at
   `impl/src/mcp-northbound.mjs:684-689`): `baton_board_{read,post,retitle,reorder,close,drop}`,
   `baton_package_{admit,attach,read}`, `baton_repl_cite`, `baton_knowledge_{recall,horizon}`,
   `baton_decision_list`, `baton_context_eval` — genuinely new capability surfaces not reachable
   any other way through MCP.
2. **`fleet_run_*` canonical mirrors** (`impl/src/mcp-northbound.mjs:365-384`, e.g.
   `fleet_run_start`, `fleet_run_status`, `fleet_run_stop`, `fleet_run_approve`,
   `fleet_run_workstreams`) — these are *not* new operations. They are the same
   `APPLICATION_COMMAND_DEFINITIONS` entries the ordinary table already exposes under
   `baton_run_start`, `baton_run_view`/`baton_run_inspect`, `baton_run_stop`, etc.
   (`impl/src/mcp-northbound.mjs:13-15,32-47`), just under the `fleet_`-prefixed canonical name.
   They only appear when `surface: "combined"` even though the operations themselves are fully
   ordinary.

## Frictions found

1. **`initialize.instructions` omits the newest ordinary surface.** The onboarding text an LLM
   client reads before ever calling `tools/list` (`impl/src/mcp-northbound.mjs:1318`) orients
   entirely around waves and the four settlement/envelope tools. It says nothing about
   `run.message.*`, `run.attention.watch`, `run.scratchpad.*`, or `run.knowledge.seed` — a client
   that trusts `instructions` as its map of "what this server is for" will not know these six exist
   until it does a full `tools/list` scan and reads each description.

2. **Two independent canonicalization mechanisms, with different surface reach.**
   `CANONICAL_ORDINARY_SIBLINGS` (`impl/src/mcp-northbound.mjs:22-31`, 6 operations: `run.do`,
   `run.view`, `run.member.view`, `run.member.send`, `run.member.stop`, `application.help`) mirrors
   both the legacy and canonical spelling into the *ordinary* table
   (`impl/src/mcp-northbound.mjs:650-653`) — a caller reaches the operation either way on the
   default surface. But `MCP_APPLICATION_ENTRIES` → `APPLICATION_TOOL_DEFINITIONS`
   (`impl/src/mcp-northbound.mjs:13-15,365-384`, ~18 operations including `run.start`, `run.stop`,
   `run.approve`, `run.workstreams`) mirrors only into the `combined`-only `fleet_run_*` names —
   the canonical spelling for those operations is invisible on both `application` and `advanced`.
   A tool author skimming the ordinary table would reasonably assume canonical/legacy pairs are a
   uniform pattern; they are not.

3. **`fleet_*` (advanced) tool definitions lack the `_meta['baton/registryDigest']` stamp that
   ordinary and reflex tools carry.** Compare the closing `.map()` for
   `ADVANCED_TOOL_DEFINITIONS` (`impl/src/mcp-northbound.mjs:707`, `execution` only) against the
   equivalent maps for the ordinary table (`impl/src/mcp-northbound.mjs:639-643`) and the reflex
   table (`impl/src/mcp-northbound.mjs:723-727`, both note the comment at
   `impl/src/mcp-northbound.mjs:686-688` explicitly says reflex tools are "stamped with `_meta`
   exactly like the ordinary table above"). `advanced` is the odd one out — a client that keys
   drift-detection off `_meta['baton/registryDigest']` presence gets a false signal for every
   `fleet_*` tool.

4. **Board is unreachable on the documented default surface.** `impl/MCP.md`'s "Orchestrate a
   wave" walkthrough (`impl/MCP.md:61-88`) and its generated tool table
   (`impl/MCP.md:108-148`) never mention board tools, and the measured `application` tool set
   confirms it: none of `baton_board_{read,post,retitle,reorder,close,drop}` is reachable unless
   the deployment descriptor sets `surface: "combined"` — a non-default, advanced-deployment-only
   choice (`impl/MCP.md:46-47`). An orchestrating agent following the documented default path has
   no MCP-native way to read or post to a board at all.

5. **Board assignment I received was truncated mid-sentence** ("...and the initial..."), which is
   itself a small instance of friction #4/#5's theme: the board-read path (`CONTEXT_READ` here, not
   an MCP tool) delivered a `detail` field cut off exactly where it would have named the third file
   to inspect. I inferred the intended third target (the initialize/tool-table region of
   `impl/src/mcp-northbound.mjs`) from the outer task framing, not from the board content itself,
   per the "never invent content" rule — flagging it rather than silently completing the sentence.

## Recommendations

- Extend `initialize.instructions` (`impl/src/mcp-northbound.mjs:1318`) to name the
  message/attention/scratchpad/knowledge-seed lane as a second first-class category alongside
  waves, or point at the `impl/MCP.md` section that documents it — right now `MCP.md` itself has no
  narrative section for the six tools either (only the generated table row-per-tool at
  `impl/MCP.md:108-148`); a short prose paragraph mirroring "Orchestrate a wave" would close both
  gaps at once.
- Either fold the `fleet_run_*` mirrors into the ordinary surface (matching
  `CANONICAL_ORDINARY_SIBLINGS`'s dual-registration pattern) or document explicitly in `MCP.md` why
  `run.start`/`run.stop`/etc. have a canonical spelling that is deliberately combined-only — as
  written, the asymmetry looks like an oversight rather than a decision.
- Add the `_meta['baton/registryDigest']` stamp to `ADVANCED_TOOL_DEFINITIONS`
  (`impl/src/mcp-northbound.mjs:655-707`) for parity with the ordinary and reflex tables, or note in
  a comment why `advanced` is intentionally excluded.
- Consider surfacing at least read-only board access (`baton_board_read`) on the `application`
  surface — an agent operating under the documented default profile currently cannot read the board
  it is coordinating against without a `combined` deployment.
