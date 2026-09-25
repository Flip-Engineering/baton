# 55 — Visual surface audit (issue #585, stage 1)

*Audit of how Baton presents what it is doing inside the harnesses it runs in, across every
surface an operator or an agent can read. Stage 1 of 3: this document is the audit and the gap
list. Stage 2 is the design per surface; stage 3 is the implementation with rendering tests.*

The issue body could not be read from this worktree (`gh` is not authenticated here); the scope
below is the mandate as the recruiting brief quoted it. Every capture in §2 was produced by
running the production modules named beside it against fixture data, or against a live
`McpFleetServer` over a stub coordinator, on 2026-09-25 at base commit 0d24fec8. One capture
(the swarm seat brief, §2.11) also exists as live evidence: this audit was written by a recruited
seat whose own session opened with exactly that rendering.

The audit measures each surface against the presentation laws of docs/38-flip-visual-surfaces.md
(P1–P5) and the honesty law of docs/38-flip-experience.md: no status that cannot be derived from
the projections; Flip is brand identity only, state rides the closed `flipStatus` channel (#315);
the human channel is stderr and human-rendered views, machine channels carry no decoration.

## 1. The surface inventory

| # | Surface | Producer | Channel | Audience |
|---|---|---|---|---|
| S1 | Brand mark and status channel | `impl/src/brand.mjs` | stderr, TTY only | operator |
| S2 | CLI verb output | `impl/scripts/baton.mjs`, `impl/src/application-cli.mjs` | stdout JSON; stderr lines | operator and scripts |
| S3 | `baton top` | `impl/src/baton-top.mjs` + `visual-model.mjs` + `visual-renderer.mjs` | terminal | operator |
| S4 | `baton_surface_visualize` | `visual-renderer.mjs` `createBatonMcpPresentation` | MCP tool result | agents and operator clients |
| S5 | MCP server identity and instructions | `impl/src/mcp-northbound.mjs:2314`, `production-mcp-convergence.mjs:525` | MCP `initialize` result | harness client UIs and models |
| S6 | MCP tool descriptions | `impl/src/mcp-core-tools.mjs`, `mcp-northbound.mjs` | MCP `tools/list` | harness client UIs and models |
| S7 | MCP tool result envelopes | `mcp-northbound.mjs:289` | MCP `tools/call` results | models |
| S8 | MCP notifications | `mcp-northbound.mjs:956,962` | `notifications/baton/wake`, `notifications/baton/resident_reincarnated` | MCP clients |
| S9 | Wake stream frames | `impl/src/wake-stream.mjs` | CLI follow (JSON per row), SSE, WebSocket | operators, scripts, clients |
| S10 | Harness wake delivery | `impl/src/wake-delivery.mjs` | per-harness mechanism | operator's own harness sessions |
| S11 | Seat briefs | `impl/src/adapter.mjs` `renderBrief`, `runtime-briefing.mjs`, `swarm-runtime.mjs` | the harness's prompt channel | recruited seats |
| S12 | Web Run desk | `impl/src/web-operator.mjs` | browser | operator |
| S13 | Swarm bridge client | `impl/src/swarm-client.mjs` (as `$BATON_SWARM_CLIENT`) | stdout JSON envelopes | recruited seats |

S12 is documented for completeness; docs/38 assigns its semantics and visual vocabulary as shared
but leaves browser interaction to it, and this audit does not redesign it.

## 2. Captures

### S1 — the brand channel

`flipFace` renders the one mark, `flipStatus` derives the closed status set from projection
classes, `flipAnnounce` composes both for stderr. Capture (`color` off, as on a piped or plain
terminal):

```text
# flipFace (the one mark)
✦(◕‿◕)✦

# flipStatus — the closed status channel (one row per status)
ready      ● ready
working    ◐ working
needs you  ▲ needs you
refused    ✗ refused
stalled    ‖ stalled
idle       ○ idle
draining   ⇣ draining
done       ✓ done

# flipStatus honesty: an underivable class answers null
flipStatus('mysterious') → null

# flipAnnounce on a TTY vs piped stderr
tty=true : ✦(◕‿◕)✦ ● ready — resident serving /run/baton.sock
tty=false: resident serving /run/baton.sock
tty=true refused: ✦(◕‿◕)✦ ✗ refused — baton: cli_invalid: unexpected argument --bogus
```

The channel obeys the honesty law mechanically: `flipStatus` returns `null` for a class outside
`STATUS_DERIVATION`, and the line renders without a status prefix. The ANSI table in `brand.mjs`
is empty by stance: the color hook exists, and no escape byte is ever emitted today.

Where it renders: only in `impl/scripts/baton.mjs` — the serve lifecycle lines, the bare-help
brand line (`flipLine`, baton.mjs:374), and the error line (baton.mjs:549). No other CLI verb,
and no other process, emits it.

### S2 — CLI verb output

Every ordinary verb prints its result as JSON on stdout (`baton.mjs` lines 369–543: one
`JSON.stringify` write per command path). stderr carries the S1 lines only. `baton top` and the
help text are the two exceptions that render for a human on stdout.

Consequence visible in the captures of S9: an operator following a swarm reads one JSON frame per
line; the wake class, subject, and next action are fields, not rendered rows.

### S3 — `baton top`

The four views over one bounded model, captured at width 84 (and overview at 40):

```text
✦(◕‿◕)✦ baton top · overview · run:render
────────────────────────────────────────────────────────────────────────────────────
Status  ▲ needs you
What is happening
  Flip is quietly keeping an eye on one active worker.
Run spine
  runId       run:render
  phase       working
  objective   Render responsive terminal feedback
  progress    execute
Resident
  —  —  —  ● ready
Swarm family
  (no living swarms)
Fleet roster
  worker:render  renderer  working  route codex/gpt-6-astra
Attention
  request:1  approval  answer  Allow rendering?  [respondable]
    → baton run answer run:render request:1
Pulse
  lanes   —
  routes  1 ready of 1
```

```text
✦(◕‿◕)✦ baton top · topology · run:render
────────────────────────────────────────────────────────────────────────────────────
Fleet graph
  coordinates (x, y) — node grid positions:
    0,0  run:render
    1,0  worker:render renderer
    2,0  codex/gpt-6-astra
    3,0  request:1 (approval)
  edges:
    run:render member worker:render
    worker:render uses codex:gpt-6-astra
```

```text
✦(◕‿◕)✦ baton top · timeline · run:render
────────────────────────────────────────────────────────────────────────────────────
Wake stream
  (wake stream not attached — the seat attaches one stream per resident when the wa…
Run events
  provenance: prose ‹worker words› · fact
  #4  prose  ‹The layout is ready.›
```

```text
✦(◕‿◕)✦ baton top · telemetry · run:render
────────────────────────────────────────────────────────────────────────────────────
Route readiness
  codex  gpt-6-astra  high  ready
Workers
  active 1  ·  total 1
Scheduler
  lanes   —
```

At width 40 the same overview stacks and truncates with `…`; every line fits (the renderer's
width law is test-pinned in `impl/test/visual-renderer.test.mjs`). The status line derives from
the model's attention/run/resident classes through `flipStatus` — P1 and the honesty law hold.
Worker prose renders inside `‹angle delimiters›` — P2 holds.

Two observations for the design stage: the timeline view's unattached-stream line truncates into
an unfinished sentence at 84 columns, and the Resident row renders `—  —  —  ● ready` when the
doctor projection carries no identity fields.

### S4 — `baton_surface_visualize`

The MCP envelope (captured from `createBatonMcpPresentation` over the same fixture model):

```json
{
  "kind": "baton.visual_presentation",
  "text": "✦(◕‿◕)✦ baton top · overview · run:render\n────…",
  "accessibleSummary": "Flip is quietly keeping an eye on one active worker.",
  "animation": { "kind": "flip_sparkle", "loop": true, "msPerFrame": 350,
    "frames": [ {"glyph":"✦","x":0,"y":0,"opacity":0.2}, …4 frames ] },
  "refresh": { "tool": "baton_surface_visualize",
    "arguments": { "runId": "run:render", "follow": true, "afterCursor": 0, "attentionCursor": 0 } }
}
```

The static text is ANSI-free and always present; the animation is four fixed sparkle frames —
decorative punctuation under P4, and not data-driven (docs/38-flip-experience.md §4's
`meaningfulEventAt`-driven motion is not implemented; the frames are a constant list).

Finding: the rendered text's header says `baton top · overview` even when the frame is served
over MCP to a client that never ran `baton top`. The header names the wrong seat.

### S5 — MCP server identity and instructions

The live `initialize` result (advanced profile, stub coordinator, captured over a real
`McpFleetServer`):

```json
{
  "protocolVersion": "2025-11-25",
  "capabilities": { "tools": { "listChanged": false } },
  "serverInfo": { "name": "baton", "version": "0.1.0" },
  "instructions": "✦(◕‿◕)✦ baton — reflexive multi-agent orchestration. Waves are the primary
    surface (start/attach/steer); settlement lanes arrive through the envelope tools. See MCP.md.
    Served repoId: repo:visual-audit — pass this exact value as repoId on every tool call. No
    orchestrator briefing pack minted yet."
}
```

The production convergence wrapper appends one suffix (`production-mcp-convergence.mjs:525-529`):

> " Unified surface tools project Baton's existing control, observation, telemetry,
> communication, task management, knowledge, diagnostics/environment awareness, and notification
> authorities; use baton_surface_catalog for profile-specific availability and baton_surface_watch
> for the composed existing notification loop."

The greeting composes three dynamic sentences from live facts: the served repoId, the wake
auto-subscription the session took (#529), and the briefing-pack head with its ledger Δ. This is
the strongest instruction surface Baton has: it already states derivable facts and names the next
action. `serverInfo` carries no Flip mark (name is the bare `baton`); docs/38-flip-experience.md
§5 proposed `baton (Flip)` plus a client-side icon. A harness displays `serverInfo.name` in its
MCP server list and the instructions in its server detail view (Claude Code `/mcp`) and may feed
the instructions to the model as context.

### S6 — MCP tool descriptions

The eight core tools, description first lines as served:

```text
baton_deployment — Deployment authority: doctor reads fresh readiness (routes, workspace, credential posture as metadata). Quota-free; the route-picking prerequisite.
baton_run — One Run: start, view (the one read, depth/section/role axes), list, send, stop, answer (settles attention), do (the advertised action executor, L2).
baton_swarm — One swarm: create, list, view (the sliced read), update (the closed event set), recruit, guide, capture, check. capture/check are identity-keyed; the rest carry idempotencyKey.
baton_waves — One wave cohort: start (detached, per-member quota), list, progress (paged), send, stop — member-targeted by runId.
baton_knowledge — The knowledge layer: search the deployment evidence and contributions (seq cursor), seed one content-addressed node inside a run horizon.
baton_wakes — The session wake plane (#294): subscribe (a filter over the session's ONE attachment, frames arrive as notifications), since (one bounded pull page), unsubscribe. Never a second connection.
baton_services — Provider services (issue #317): list the deployment's configured API services — the models each offers, the routes derived from them, and subscription-window usage with its reset instant.
baton_surface — Progressive disclosure: catalog the capabilities this deployment profile serves, describe one (schema and posture), invoke it through its existing authority; snapshot, watch (bounded composite), visualize.
```

These are dense, correct, and static: they describe what a tool is, never what Baton is doing
right now. That is correct for a description field (it is served once at `tools/list`, cached by
clients), and docs/38-flip-experience.md §5 permits the mark on the first line of a description
— not currently used. Per-harness, these strings appear in tool pickers and in the model's
system context, so their density is also token cost in every session that binds the server.

### S7 — MCP tool result envelopes

A success envelope (captured: `fleet_list` over the stub):

```json
{ "result": {
    "content": [{ "type": "text", "text": "{\"result\":[{\"id\":\"worker-1\"}]}" }],
    "structuredContent": { "result": [ { "id": "worker-1" } ] },
    "isError": false } }
```

Every result double-carries the payload: once as JSON text in `content` (what older clients and
most model context windows read) and once as `structuredContent`. Refusals are typed and coached
— the refusal body carries `code`, a `retryable` verdict, and an `action` remedy
(mcp-northbound.mjs:289-294), and an unknown tool name is answered with the nearest advertised
tool and the full admitted roster (captured: the `baton_run` on an advanced-profile server is
refused `unknown_tool` with `nearest: fleet_drain` and the 19-tool list).

Observation for design: the envelope is honest and machine-complete, but nothing in it marks
severity or state for a human reader — a client UI rendering the text block shows raw JSON. The
`flipStatus` vocabulary does not reach MCP results.

### S8 — MCP notifications

Exactly two notification methods leave the server: `notifications/baton/wake` (a wake frame per
matching ledger row, for each subscription the session opened) and
`notifications/baton/resident_reincarnated` (once, when the bridge re-binds to a successor
incarnation, #306/#314). The wake auto-subscription at `initialize` is opt-in (`autoWake`,
mcp-northbound.mjs:2188). No standard MCP notification method is emitted: no
`notifications/progress`, no `notifications/message` (logging), no `notifications/tools/list_changed`.

Whether a harness renders `notifications/baton/wake` at all is client-defined. The method is
custom (`baton/wake`), so a generic MCP client records it at best; the frame reaches the model
only if the client surfaces notifications into context.

### S9 — wake stream frames

One frame, as `baton deployment watch --follow` prints it (captured from `deriveWakeFrame`):

```json
{
  "schemaVersion": 1, "kind": "baton.wake", "seq": 33712, "ts": "2026-09-25T02:41:10.003Z",
  "wakeClass": "contribution_recorded", "swarmId": "swarm-visual-20260925",
  "participantId": "visual-impl1", "workerId": null, "runId": null, "actor": null,
  "subject": { "kind": "contribution", "id": "contribution-abc123" },
  "next": "baton swarm check swarm-visual-20260925 visual-impl1 contribution-abc123 CHECK_ID",
  "observation": false,
  "served": { "commit": "0d24fec8619d1cae9bf74ca5d38883e8d42e95de", "behind": 9 },
  "row": { "seq": 33712, "kind": "swarm.contribution_recorded", "…": "…" }
}
```

Every frame carries the closed `wakeClass`, the subject, the `next` action spelled as a runnable
command, and the served-commit drift header (#316). The class table is a closed, documented set
of 26 classes (`WAKE_CLASS_TABLE`, wake-stream.mjs:120), each with a one-line summary and a next
action; `baton help swarm.watch` renders the table. The same frames ride SSE and the loopback
WebSocket, and both legs terminate with the typed `baton.wake_stream_ended` frame carrying
`resumeFrom` (#316 b).

This is the most honest surface in the set. Its gap is presentational: on the CLI the frame is
JSON per line, and the human-readable form exists only inside `baton top`'s timeline view.

### S10 — harness wake delivery

`HARNESS_WAKE_DELIVERY` (wake-delivery.mjs:14-37) is the whole truth, verbatim:

| Harness | Mechanism | Can start a turn | Note |
|---|---|---|---|
| claude-code | session-socket | yes | a cross-session message to `/tmp/cc-socks/<pid>.sock` starts a turn in the session `claude agents --json` names |
| codex | none | no | an idle codex session does not process its inbox in the background |
| grok | none | no | grok agent stdio belongs to Baton's spawned child process and cannot reach an operator grok session |
| kimi-code | none | no | Kimi ACP stdio belongs to Baton's spawned child process and cannot reach an operator kimi-code session |
| muse | none | no | muse exec stdio belongs to Baton's spawned child process and cannot reach an operator muse session |
| omp | none | no | omp RPC stdio belongs to Baton's spawned child process and cannot reach an operator omp session |

A Claude Code root session receives a wake as a `<cross-session-message …>` user frame that
starts a turn (#564). On every other harness the operator's own session receives nothing; the
wake plane reaches recruited seats through the swarm bridge (S13) and MCP clients through S8, not
through the harness's own UI.

### S11 — seat briefs

`renderBrief` (adapter.mjs:502) composes the one brief every dialect renders; a swarm recruit's
brief carries the `## Swarm` section (derived once in swarm-native-access.mjs), route usage, the
lane contract, and the verification contract. Captured against the canonical presentation
(dialect `omp-rpc`; section order as rendered, the static bridge guidance elided here — it is the
`SWARM_BRIEF_SECTION` text, quoted in full by the recruiting brief of any swarm seat):

```text
[baton brief:omp-rpc]
## Goal
[deadbeef] Audit and improve how Baton shows what it is doing inside the harnesses it runs in.
## Dispatch
This task is already dispatched by Baton. Use your configured native harness tools, skills, …
## Tools
Use only the tools advertised here for Baton actions; any other Baton surface is not authorized for this task.
- BATON swarm bridge
## Swarm

Your native tools, skills, and delegation remain available. You can coordinate directly with
this swarm using your own granted authority.
[SWARM_NATIVE_GUIDANCE + SWARM_BRIDGE_GUIDANCE — the static bridge text, derived once in
swarm-native-access.mjs:96-118]

### Route usage
- omp/deepseek-flash@high: ready | turns=0 tokens=0 | concurrency=22/∞ | recruitable=true
- kimi-code/k3@high: degraded | turns=0 tokens=0 | quota=exhausted resetAt=unknown | concurrency=0/∞ | recruitable=false
## Write authority
Harness permissions are execution capability, not write authority. …
## Constraints
- Baton deployment profile default@fb468fc4
- Do not claim completion without the deployment verification command.
## Path scope
- README.md
- docs/**
- impl/**
## Definition of done
Baton preserves exact route, result, and cleanup truth.
The requested repository improvement is implemented and verified.
## Verification (preserve this execution contract; also satisfy the assigned work)
Execution mode: direct executable and argv (no shell)
Executable (JSON string): "npm"
Arguments (JSON array, in order): ["test","--prefix","impl"]
Working directory (relative to the assigned worktree): "."
Expected exit code: 0
The hub re-runs this exact command independently after you finish; …
```

The brief is instruction content for the seat, not a status display: it says what the seat must
do and may use. Its status content is the route-usage table (live route states at recruit time)
and the pending-attention section (absent here by the absence-on-empty law). The brief renders
identically in structure across dialects; the `cli` dialect swaps the section headings for
task-shaped lines (`Task:`, `Constraints:`, `Done when:`).

How it appears per harness: as the spawned session's first user message — Claude Code transcript,
codex turn input, omp user message (this seat's own session opened with exactly this text), kimi
and grok ACP prompt. After that first frame, the seat hears from Baton only through wake rows
(S13) and orchestrator messages.

### S12 — the web Run desk

`web-operator.mjs` serves the browser Run desk (progression, activity, workstreams, evidence,
attention, narrative). Per docs/38 it keeps its own interaction design; this audit records two
facts only: it exists as a visual surface with its own rendering, and it shares no component with
the terminal/MCP renderer beyond the projections both read.

### S13 — the swarm bridge client

A recruited seat's standing channel is `node "$BATON_SWARM_CLIENT" <verb>`, answered with one
JSON envelope (`{"ok":true,"result":…}` or a typed refusal whose message begins "Nothing was
recorded:"). Wake rows reach the seat as harness user messages authored by the bridge (the
`BATON_SWARM_BRIDGE_AUTOWAKE` subscription), prefixed so the seat can tell them from operator
prose — in this session they arrive as `[baton brief:omp-rpc]`-style frames. The seat never sees
`flipStatus`, the wake class table, or the visual model; its picture of the swarm is the JSON of
`swarm.view` plus the brief's static guidance.

## 3. Harness-native affordances Baton does not use

Each row is confirmed absent by search of `impl/src` on 2026-09-25; the affordance itself is
documented in the cited reference.

| Affordance | Evidence of absence | Where documented |
|---|---|---|
| MCP progress notifications (`notifications/progress`, `progressToken`) | no match in `impl/src` | docs/03-protocol-analysis.md:29-32 names the affordance: progress during a long call can stream fleet digests while a blocking call holds |
| MCP logging notifications (`notifications/message`) | no match in `impl/src` | MCP specification; docs/03 |
| Server-initiated elicitation toward MCP clients (`elicitation/create`) | no match in `impl/src`; adapters only *answer* harness-side elicitations (claude-session.mjs:1545, omp-rpc.mjs:692) | docs/32-reflexive-orchestration.md:268-270 designs the binding; docs/38 §5a carries it as rung F |
| Claude Code status line (`statusLine` in settings) | no match in `impl/src` or `docs` | Claude Code settings schema; the harness renders one line of command output in its chrome continuously |
| Claude Code hooks as a display surface (SessionStart, Notification) | no match in `impl/src` | docs/reference/claude-harness.md:58-114 (hook inventory) |
| Codex `thread/goal/set` (goal state on the thread, outside the transcript) | no match in `impl/src` | docs/02-harness-control-surfaces.md:41 |
| MCP tasks extension (`io.modelcontextprotocol/tasks`) | no match in `impl/src` | docs/03-protocol-analysis.md:29 (experimental, five statuses, `tasks/get` polling plus notifications) |

## 4. Gaps

G1. **Long MCP calls report no progress.** A blocking call (`fleet_wait`, a wave round-trip)
holds the client's tool call open with no `notifications/progress` stream; the harness UI shows
its generic waiting state with no Baton content. (S7, §3 row 1; docs/03:32.)

G2. **Attention never arrives as an interactive prompt in any harness UI.** The attention row
reaches MCP clients as a wake frame (S8) or a tool result (S7); no client receives an
elicitation it can answer inline. The operator answers with `baton run answer` in a terminal, or
the seat answers through its own channel. The elicitation binding designed in docs/32:268 and
carried as docs/38 rung F is unimplemented. (§3 row 3.)

G3. **Only one harness delivers wakes to the operator's own session.** Claude Code has the
session socket; codex, omp, grok, kimi-code, and muse are `none` (S10). On five of six harnesses
an operator working inside the harness sees nothing when a contribution lands or a seat stalls.

G4. **No harness chrome carries Baton state.** The Claude Code status line and hooks, and any
equivalent persistent UI region in codex or omp, are untouched (§3 rows 4-5). The only surfaces
that show live state are ones the operator or agent must open: `baton top`, the Run desk, a
`swarm.view` call.

G5. **The MCP presentation text names the wrong seat.** `baton_surface_visualize` renders the
`baton top` header inside MCP results (S4 finding). Cosmetic, but it is the surface agents
actually read.

G6. **The visual model's status vocabulary stops at the renderer.** `flipStatus` drives the
stderr channel and the `baton top` status row, but MCP tool results (S7), wake frames (S9), and
the seat's bridge traffic (S13) carry no derived status word; a reader of those surfaces
re-derives state from raw fields. One derivation exists (`brand.mjs`); three surfaces do not use
it. (P1 holds — no second derivation exists anywhere — so this is an unshared derivation, not a
dishonest one.)

G7. **The seat brief is a wall of static text with no status glanceability.** The route-usage
lines carry live state (`quota=exhausted`, `recruitable=false`), but the brief has no summary
line a seat can read first: state is distributed across sections. The `[baton brief:<dialect>]`
marker is the only frame the seat learns to recognize; wake rows that arrive later carry no
equivalent class word. (S11, S13.)

G8. **Codex goal state is unpinned.** Codex can hold the definition-of-done as first-class
thread state (`thread/goal/set`); Baton carries it only in the brief transcript, where
compaction can drop it. (§3 row 6.)

G9. **Motion hints are not data-driven.** The MCP presentation's four sparkle frames are a
constant; docs/38-flip-experience.md §4's design ties motion to `meaningfulEventAt`. P4 permits
the constant; the design stage decides whether data-driven motion is worth the seam. (S4.)

## 5. What stage 2 must decide

1. Which affordances in §3 Baton adopts, per harness, with the honesty law applied to each: a
   status line or progress notification derives from the projections or it does not exist.
2. Whether `flipStatus` becomes a shared payload field on MCP results and wake frames (G6), and
   in what closed spelling.
3. The interactive-attention path per client capability (G2): elicitation where supported, the
   typed decision payload elsewhere (docs/32:268-270 already designs the degradation).
4. The wake-delivery story for the five `none` harnesses (G3): which harness has any reachable
   surface at all, and what Baton says when none exists.
5. The brief's first lines (G7): what a seat reads in the first screenful.
6. The S4 header fix and any other single-seat relabeling (G5).

## Appendix — capture reproduction

Every capture in §2 regenerates from the production modules: `brand.mjs` exports for S1;
`deriveWakeFrame` over a synthetic `swarm.contribution_recorded` ledger row for S9; `renderBrief`
with a swarm brief value for S11; `projectBatonVisualModel` + `renderBatonVisual` +
`createBatonMcpPresentation` over the fixture snapshot of `impl/test/visual-renderer.test.mjs`
for S3/S4; a live `McpFleetServer` over a stub coordinator (the `impl/test` idiom) for S5-S7.
The S6 roster is `coreToolDefinitions()` mapped to `name — description`. The stage-3
implementation pins these renderings as tests so the audit cannot drift from the code.
