# 56 — Visual surface design (issue #585, stage 2)

*A design per surface, answering the gaps G1–G9 of docs/55-visual-surface-audit.md. Every design
is measured against the presentation laws P1–P5 (docs/38-flip-visual-surfaces.md) and the honesty
law (docs/38-flip-experience.md): a status that cannot be derived from the projections does not
exist; machine channels carry no decoration; degradation is plain text.*

## D1. The status vocabulary reaches the human wake rendering (G6)

`flipStatus` (impl/src/brand.mjs) is the one derivation from projection classes to the closed
status set. Several wake-class literals already derive because they are also projection classes
(`dead` → ✗, `paused` → ▲, `attention` → ▲, `closed`/`integrated` → ✓, `left` → ✓). The remaining
event-shaped classes (`contribution_recorded`, `work_updated`, `guidance_delivered`, …) are
events, not states, and stay underivable — the honesty law applies to events as much as to
states, and an event is not a status.

Design:

1. `STATUS_DERIVATION` admits the wake classes that name a lifecycle state of their subject and
   no others. The additions are exactly: `capacity_pressure` → needs you (the operator must free
   space), `reroute_proposed` → needs you,
   `root_owed` → needs you, `contribution_integrated` → done, `resident_lifecycle` → ready,
   `incarnation_changed` → ready, `queued` → idle, `stalled` (already present),
   `draining` (already present). Event classes that report activity without a subject state
   (`recruited`, `assigned`, `work_updated`, `coupling_updated`, `context_updated`,
   `contribution_recorded`, `reviewed`, `note`, `knowledge`, `guidance_delivered`, `checkpoint`,
   `refused` is already present) gain nothing.
2. The `baton top` timeline view prefixes each wake frame row with the derived status text when
   `flipStatus(frame.wakeClass)` derives, and the bare class name otherwise (the renderer already
   has this exact fallback shape in `statusWord`). The CLI follow paths keep machine-clean JSON
   per row (S9 law stands: stdout is never decorated).
3. Machine payloads — the wake frame itself, MCP tool results, bridge envelopes — gain no status
   field. The wakeClass is the honest classification; a second field would be a second vocabulary
   riding a machine channel, which P1 and the persona law both forbid. The derivation lives in
   one module and is applied at render time.

## D2. MCP progress notifications on bounded blocking calls (G1)

The MCP spec's progress affordance needs no capability negotiation: a client that wants progress
puts `_meta.progressToken` on the `tools/call` params; a server that honors it emits
`notifications/progress` carrying that token. `McpFleetServer.notify()` (mcp-northbound.mjs:2157)
is the existing sink.

Design:

1. The blocking reads — `fleet_wait`, `baton_run_wait`, `fleet_run_wait`, `baton_run_follow`,
   `fleet_run_follow`, and the `baton_surface` watch verb — are chunked server-side: instead of
   one `coordinator.wait(min(timeoutMs, maxWaitMs))`, the server waits in slices, and between
   slices that returned no events it emits one progress notification. The chunking does not
   change the wire contract: the same total bound (`maxWaitMs`, deployment-derived) holds, the
   same result is returned, and a call without a progressToken behaves byte-identically to
   today.
2. The progress payload is derived, never estimated: `progress` is the count of events observed
   so far by this call (0 between slices), `total` is always absent (no total exists), and
   `message` is one line naming what the call waits on and the cursor it holds — e.g.
   `waiting on fleet events · cursor 4 · 12s of 25s`. The elapsed/remaining figures come from the
   call's own deadline arithmetic, not from a clock read about the fleet.
3. A server without a notification sink (a transport that cannot deliver server notifications)
   skips emission silently — the same posture the wake plane takes (mcp-northbound.mjs:2057).
   Progress is additive chrome; the result is the machine channel.
4. The slice length is derived from the call's own bound: `max(1000, maxWaitMs / 8)`, so a
   deployment that tightens `maxWaitMs` tightens the cadence with it. No new constant enters the
   limits registry; the cadence decides only how often a notification is offered, never when a
   call ends.

Harness fit: Claude Code renders MCP progress on the tool call's spinner line; codex renders it
in the tool call row; omp surfaces it in its tool-event stream. A client that renders nothing
loses no function.

## D3. `baton statusline` — the Claude Code status line command (G4)

Claude Code renders one persistent status line from a configured shell command
(`statusLine: {type: "command", command: …}` in settings; the harness runs the command and
displays its first stdout line). This is the one harness chrome surface that is a command Baton
already knows how to be.

Design:

1. New CLI verb `baton statusline` in `impl/scripts/baton.mjs`. It reads the resident of the
   current working directory through the ordinary client, derives one line, prints it on stdout,
   exits 0. The line: `✦(◕‿◕)✦ <status> — <one fact row>`, where the status derives through
   `flipStatus` from the same precedence `baton top` uses (attention first, then run phase, then
   resident state) and the fact row is the bounded counts the projections already carry —
   e.g. `2 attention · 3 seats working · routes 4/5 ready · served 0d24fec8 (+9)`.
2. Honesty under failure: when no resident serves this directory, or the projections cannot be
   read, the verb prints nothing and exits 0. A status line that cannot derive state displays
   nothing; it never prints a stale or invented state, and it never prints an error into the
   operator's chrome (the error path is stderr, exit non-zero — the harness simply shows no
   line).
3. The command ignores whatever session JSON the harness pipes to stdin. State comes from the
   resident, not from the harness's idea of the session.
4. Color and motion are always off: the output is captured, not a TTY. The mark rides the line
   because the line is human chrome — the same rule as the serve lifecycle lines.
5. Baton never writes the operator's settings. The README/docs entry prints the settings stanza
   for the operator to paste:
   `{"statusLine": {"type": "command", "command": "baton statusline"}}`.

Other harnesses: codex and omp have no equivalent user-configurable status command surface today
(§3 of the audit); when one appears, the same verb serves it.

## D4. Attention as MCP elicitation, capability-gated (G2)

The decision-loop chrome of docs/38-flip-experience.md §5a, restated without the retired pose
grammar: when the connected MCP client declared the `elicitation` capability at `initialize`,
and an attention item whose principal matches the session principal appears, the server issues
`elicitation/create` with the typed decision payload (question text plus options). Where the
capability is absent, the existing channels carry the item unchanged: the `attention` wake frame
(S8/S9) and the attention section of the run view.

Blocking prerequisite, stated plainly: the server's transports today carry server→client
*notifications* only (`notificationSink`); an elicitation is a server→client *request* with a
correlated response. The transport layer (stdio driver and the web bridge) must grow a request
channel before D4 can land. This stage implements D4 behind that seam:

1. A `requestSink(method, params) → Promise<result>` beside `notificationSink`, wired on the
   stdio driver with id correlation and on the loopback bridge. A transport without one reports
   the capability as absent — the same honest-degradation posture as the wake sink.
2. The elicitation's content is the attention item's own typed payload; the answer lowers through
   the existing `run.answer` authority, exactly as the TUI's allow/deny does (P5). No new
   settlement path.
3. An elicitation the client cancels or declines records nothing and settles nothing; the
   attention item stays open for `run.answer`. The elicitation is a presentation of the item,
   not a second queue.

If the transport seam cannot land in stage 3, D4 is carried forward with the seam named, and the
gap stays documented rather than half-built.

## D5. The MCP presentation names its own seat (G5)

`renderBatonVisual` composes the header `baton top · <view> · <runId>` for every consumer,
including `createBatonMcpPresentation`. The renderer takes a `seat` option: `'baton top'` from
the TUI, `'baton'` from the MCP presentation. One option, one call site each, no behavioral
change beyond the label. The audit's capture regenerates in the stage-3 tests.

## D6. A status first line for the seat brief (G7)

The seat brief (S11) is instruction text; its only live state is the route-usage table. Two
additions, both derived from values the brief already carries, both attached to the
provider-facing value only (the admitted `task.brief` and its digest stay byte-stable — the
runtime-briefing.mjs seam rule):

1. A `## Status` line immediately after `## Goal` when the brief carries `routeUsage`: one line
   of counts derived from the table — `Routes: 12 ready · 1 degraded · 2 exhausted · 9 recruitable`.
   A brief with no routeUsage renders no section (the absence-on-empty law).
2. Wake rows delivered into a seat's session are prefixed with the derived status word when the
   wake class derives one (D1's table), e.g. `▲ needs you — root_owed: …`. The
   prefix is applied at the seat-facing renderer (the bridge's wake-to-message seam), not to the
   frame itself; undervivable classes render unprefixed.

## D7. The five harnesses with no wake delivery stay honest (G3)

`HARNESS_WAKE_DELIVERY` records `none` for codex, omp, grok, kimi-code, and muse with the reason
for each. No reachable session mechanism exists for them today; inventing one (an inbox file the
harness never reads, a prompt injected blind) would violate the honesty law by presenting a
delivery that delivers nothing. The design keeps the table as the truth and routes operator
visibility through the surfaces that exist: the MCP wake plane for harness sessions that bind
the Baton MCP server (S8), `baton top` and the Run desk for the operator, and `baton statusline`
for Claude Code chrome (D3). The table's `note` strings are the documentation; the audit's §3
table is the operator-facing statement. No code changes here.

## D8. Codex seats pin the goal on the thread (G8)

Codex app-server carries first-class goal state (`thread/goal/set`, docs/02:41; the `goals`
feature is stable-on, docs/reference/codex-runtime.md:202). Design: the codex adapter
(codex-appserver.mjs), after `thread/start` for a Baton-dispatched seat, issues
`thread/goal/set` with the brief's definition-of-done text. The DoD then survives transcript
compaction as thread state. Honesty: the goal text is exactly the brief's `## Definition of
done` section, no paraphrase. A codex version without the method refuses typed
(`goal_pinning_unavailable`) and the spawn proceeds — the brief still carries the DoD in the
transcript. Implementation is conditional on the adapter's schema pin admitting the method; if
the pinned schema lacks it, D8 is carried forward rather than probed live.

## D9. Motion stays constant until the projection reaches the model (G9)

The MCP presentation's four sparkle frames are decorative punctuation under P4 and need no state.
Data-driven motion (docs/38 §4) requires the visual model to carry `meaningfulEventAt`; until it
does, there is nothing honest to animate with. No change this stage.

## Decisions recorded

- `serverInfo.name` stays `baton`. The name is an identifier in client allowlists and permission
  configs; the mark already rides the instructions line, which is the human-read field.
- MCP tool descriptions stay sterile prose (S6). A description is served once and cached; it is
  the wrong field for live state, and docs/38 §5's optional mark adds no information there.
- The CLI's machine-clean stdout law is untouched everywhere: every new human rendering is a new
  verb or a stderr line, never a decoration of an existing JSON output.

## Stage-3 implementation set

| Design | Module(s) | Test surface |
|---|---|---|
| D1 | brand.mjs (derivation rows), visual-renderer.mjs (timeline prefix) | status derivation unit pins; timeline render test |
| D2 | mcp-northbound.mjs (chunked wait + progress emission) | a stub client with a progressToken receives derived progress frames; a tokenless call is byte-identical |
| D3 | impl/scripts/baton.mjs (`baton statusline`), README stanza | render test: resident up with attention, resident up clean, resident absent (empty, exit 0) |
| D4 | transport requestSink + mcp-northbound.mjs elicitation seam | conditional; carried forward if the seam cannot land |
| D5 | visual-renderer.mjs (`seat` option) | presentation render test names `baton`, TUI render names `baton top` |
| D6 | adapter.mjs (brief Status line), the bridge wake-to-message seam | brief render test with and without routeUsage; wake message prefix test |
| D8 | codex-appserver.mjs (goal pin at spawn) | conditional on the schema pin; adapter stub test |

## Stage 3 — what landed

Stage 3 implements D1, D5, D6 and D8, the root wake message and the mark rule. The root
orchestrator implemented it directly from the swarm lead's stage-3 commit (5fbf9b34) and made these
changes before landing:

- D2 is withdrawn. It served the blocking reads (`fleet_wait`, run wait and follow) in time slices of
  `max(1000, bound / 8)` to offer "still waiting" frames. Those reads end at a caller deadline
  (`timeoutMs`, `maxWaitMs`), which is the wait-ceiling pattern #541 removes, and the slices add
  timer-driven output built on fixed numbers. Progress on those tools waits for #541 and #592, which
  replace blocking waits with native wake.
- D3 is moved to #592. `baton statusline` as built read `swarm.list` and one attention view per swarm
  on every redraw; on this deployment one render took 126 s, and it capped the swarms it read. A
  status line must read a small snapshot the deployment keeps current on each commit. The #592
  session host keeps the obligation and seat state that snapshot is derived from, so the status line
  is built on it there.
- The root wake message moves out of wake-delivery.mjs (which #592 replaces) into
  attention-message.mjs, a pure composer the #592 dispatcher calls. It no longer shortens any value:
  the stage-3 version cut each value at 200 characters and the message at 2000, which cut the ask
  the root has to answer. The message now also carries the subject of the contribution it is about.

### The mark rule

The mark rides a line Baton writes for a person to read — the stderr channel on a TTY, the
`baton top` frame, the MCP instructions field, a message delivered into a person's session — and
never a machine channel (stdout JSON, an MCP tool result, a wake frame, a bridge envelope).
`flipHumanLine` (brand.mjs) is the one function that composes such a line; `flipAnnounce` gates it
on a TTY for stderr, `baton top` reads it for its header, and the attention message reads it.
Nothing else spells the mark.

### One status derivation

`flipStatus` (brand.mjs) gains the wake classes that name a lifecycle state of their subject:
`capacity_pressure`, `reroute_proposed` and `root_owed` derive
`needs you`; `contribution_integrated` derives `done`; `resident_lifecycle` and
`incarnation_changed` derive `ready`; `queued` derives `idle`. `open` (a live swarm) derives
`ready`. Event-shaped classes
(`contribution_recorded`, `reviewed`, `work_updated`, `knowledge`, …) gain nothing: an event is
not a status, and the honesty law applies to events as much as to states.

`flipStatusPrefix` is the one spelling of the wake-row prefix (`▲ needs you — `), read by the
seat brief's wake lines, the root wake message and the `baton top` timeline. Those three surfaces
therefore name one class with the same words.

### Per design

| Design | Landed |
|---|---|
| D1 | `flipStatus`/`flipStatusPrefix` as above; the `baton top` timeline prefixes each wake row with the derived status word and shows the bare class name otherwise. |
| D2 | Withdrawn (see above): the blocking reads it decorated are replaced by native wake (#541, #592). |
| D3 | Moved to #592: the status line reads a snapshot the session host keeps current on each commit. |
| D5 | The renderer takes a `seat`: `baton top` from the TUI, `baton` from the MCP presentation and the production MCP visualize leg. |
| D6 | The seat brief carries a `## Status` line after `## Goal` when it carries route usage (`Routes: 12 ready · 1 degraded · 2 exhausted · 9 recruitable`), and its wake-event lines carry the derived status prefix. |
| Root wake | `composeOwedMessage` and `composeTurnReportMessage` (attention-message.mjs): the mark and derived status, the owed kind in words (`review owed`, `answer owed`), the seat and contribution, the contribution subject, the ask, and the runnable next command; no JSON and no value shortened. wake-delivery.mjs calls it until #592 replaces that delivery. |
| D8 | The codex adapter pins the brief's `## Definition of done` text as first-class thread state through `thread/goal/set` after `thread/start`; a build without the method records the refusal and the spawn proceeds. |
| D4 | Carried forward. The transports carry server-to-client notifications only; an elicitation is a server-to-client request with a correlated response, and no transport has a request channel (the stdio driver attaches a write-only `notificationSink`). The seam is named: a `requestSink(method, params) → Promise<result>` on the stdio driver and the loopback bridge, beside the existing sink. |
| D7 | No change, as designed. |
| D9 | No change, as designed. |

### Observations the audit recorded (repaired after stage 3)

The audit's S3 capture recorded two rendering defects that no design in this document claimed. Both
are repaired, with width rows:

- The timeline's unattached-stream line truncates into an unfinished sentence at 84 columns. The
  line is now chosen from three complete statements, longest that fits, so a narrow terminal reads
  the shortest one whole instead of half a sentence.
- The overview's Resident row renders `—  —  —  ● ready` when the doctor projection carries no
  identity fields. The row now renders only the cells the projection carries, and the same
  one-vocabulary rule reaches the fleet roster's member state, so no cell of the operator's frame
  invents a placeholder for an absent fact.

### After stage 3: the wake stream's human form, and the desk's vocabulary

Two further audit items carried no design, and both are addressed:

- **S9's presentational gap.** The audit's most honest surface had no human form on the CLI: a
  wake frame printed as JSON per line, with the readable rendering living only inside `baton top`.
  `wake-render.mjs` renders one line per frame — sequence, class, subject, the next act the frame
  itself spells — through the one mark rule and the one wake-row prefix, and `writeFollowPage` is
  the one place a follow leg decides its channels: stdout keeps its machine frame per row, stderr
  carries the human line on a TTY only. Verified by a live follow of a fixture resident: with a
  pty, stderr carries `✦(◕‿◕)✦ #7 context_updated context verify` beside the JSON row; with pipes,
  stderr is empty and stdout carries the frame alone.
- **S12's split vocabulary.** The browser Run desk named a run's own state with the projection's
  raw class literal while the terminal and MCP surfaces named the same class with the derived
  status word. The derivation does not move: `flipStatusTable` serves brand.mjs' ONE table as
  plain data, projected into the served page, applied at render time. A class the table does not
  carry keeps the desk's own humanized spelling, so nothing the desk showed changed shape.

Two items were assessed and deliberately not built:

- **D4 (MCP elicitation).** #592 owns the operator-interaction architecture, and its design
  (docs/57 §4.3/§4.4) keeps approvals, questions and interrupts in the harness's own native UI and
  forbids a substitute approval UI. An elicitation would have Baton render that prompt itself, and
  the transport request channel it needs sits in the session-host area #592 owns. D4 is retired
  into #592 rather than built here.
- **MCP logging notifications** (the audit's §3 row 2). A `notifications/message` record carrying
  Baton's wake rows would duplicate the custom wake notification on a machine channel, which the
  one-channel-per-purpose law and P1 refuse. The audit's row stands as a statement of what is
  absent, not as a design this document adopts.

### The desk's phase vocabulary: the review and the repair

The desk's spine named `awaiting_plan_approval`, `approved`, `running` and `work_completed`, and
this document called the canonical set `awaiting_approval`, `working` and `completed`. The review
that item asked for reads every phase literal an outward projection can carry:

- `application.mjs:5478-5493` serves `awaiting_plan_approval`, `denied`, `work_completed`,
  `inconclusive`, `failed`, `cancelled`, `paused`, `running`, `approved`, `stopped`, `stopping`.
- `application.mjs:5751-5756` serves `completed`, `reviewing`, `work_completed`.
- `application-observation.mjs:2753` and `:2829-2838` serve `planning`, `planning_failed`,
  `awaiting_plan_approval`, `denied`, `work_completed`, `failed`, `cancelled`, `paused`,
  `running`, `approved`, `stopped`, `stopping`.
- `application-semantics.mjs:21-28` and `:67-79` hold the canonical set and the generated
  legacy-to-canonical map. `canonicalRunPhase` is what the phase predicates and the wave driver
  resolve through; no outward serializer calls it.

The projections therefore serve the legacy spellings (`awaiting_plan_approval`, `approved`,
`running`, `work_completed`, `interruption_uncertain`, `planning_failed`) beside the canonical
ones, and the desk's set was a subset of them: an interrupted, degraded or inconclusive run
rendered the intent step and lost its evidence section. `web-operator.mjs` carries ONE table
naming the desk's step for every canonical phase and every legacy spelling, projected into the
served page as data and applied at render time. A phase the table does not carry reads the intent
step, which is what the desk rendered for an unknown literal before this change. The step decides the
terminal row: `interrupted`, `interruption_uncertain` and `paused` read the execute step,
`work_completed` and `result_ready` the review step, and `degraded` and `inconclusive` the
evidence step they are.

`planning_failed` stays on the plan step: its view offers `retry_planning` and reads "safe to
retry" (`application-observation.mjs:2772`), so the registry's `failed` mapping is the
phase-predicate axis rather than the desk's progression.

One desk item stays open: the desk offers `stop` for an interrupted run and has no control for the
`send` action that run's `nextActions` offer.
