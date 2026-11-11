# PM-AGENT — pm's agent-integration layer vs baton's surfaces

[attempt: 43ea3f5f-c961-47f2-92d6-2d565dab76b4 row-pm-agent]

Row lane: **the agent-facing surface — ambient context, activation, session continuity, tool
ergonomics.** Read first: `foundry-brief.md` (shared laws), `row-pm-agent.md` (this row brief),
`pm-digest/README.md` (the `.rs` files are truth, prose docs stale-risk). pm side grounded in
`src_mcp_tools.rs` (the 37-tool registry), `src_mcp_dashboard.rs` (`session_init` +
`build_knowledge_briefing`), the v6 doc's Pillar 2 (UserPromptSubmit ambient injection) and its
§1.2 CLI-parity gap table. Baton side grounded in `impl/src/mcp-northbound.mjs` (the 67-tool
capability-classified surface), `workflow-interpreter.mjs` (`messageOnSpawn`/`nudgeOnCheckpoint`/
`elevateWhenNotes` steering), `coordinator.mjs` (`_orientationL0Grant`, `serveKnowledge`), the
#103 briefing pack (minted at wave close), the #71 orchestrator wake (event-derived long-poll),
the #163 quiescence contract (event-derived completion), the #159 doc-truth conformance gate
(CLI↔MCP parity class), and the channel-audit environment report (what a member can actually
reach).

**Verdicts per candidate: ADOPT / ADAPT / REJECT / ALREADY-HAVE with the landing zone.
Every pm time-based mechanism is ADAPT-to-event-derived or REJECT per the standing veto.
A mechanism that injects into the machine channel is REJECT per the sterile-surface law.**
Judgment calls are recorded inline; authority-class ambiguity is flagged DECISION_REQUEST.

---

## 1. Ground truth — pm's agent-facing surface (landed vs intent)

The `.rs` code is the truth; the prose overstates. pm's *landed* agent-facing machinery is
small and read-shaped:

| pm mechanism | Landed reality | Intent-only (prose/v6/TASKS) |
|---|---|---|
| **37-tool MCP registry** | `src_mcp_tools.rs` — 37 `ToolDef`s, mostly **write** tools (create experiment, log finding, add edge, set belief, set confidence, constraint add) | — |
| **Computed knowledge briefing** | `build_knowledge_briefing` (`src_mcp_dashboard.rs:22-119`): active phase → top-5 recent findings sorted by `created_at` (`:54`), active constraints with severity (`:67-78`), untested hypotheses (`Proposed` status, `:80-101`), contradictions in the phase neighborhood (top-3, `:103-116`) | — |
| **Session-start injection** | `tool_session_init` (`src_mcp_dashboard.rs:349-479`): per active project, actionable phases + pending experiments as `-> TaskCreate:` lines, stale-hypothesis sweep (`proposed > 7 days`, `is_stale` `:14-18`, `:412-419`), orphaned-findings sweep (`:426-434`), then appends each project's knowledge briefing (`:459-468`) | — |
| **Phase-scoped context** | `tool_session_context` (`src_mcp_dashboard.rs:744-924`): 3-hop phase subgraph, grouped findings/hypotheses/decisions/literature, suggested next actions, stale-hypothesis check (`:906-912`), appends the briefing | — |
| **Ambient injection WITHOUT being asked** | NOT landed | v6 Pillar 2, E#119/E#123 — a `UserPromptSubmit` hook (`~/.claude/hooks/pm-context-inject.sh`) calling a CLI `session-init` mirror, gated on `PM_INJECT=1`, 30s cache (`v6-cognitive-augmentation-scope.md:111-121,178-181,214`) |
| **Delta-aware stop-nudge** | NOT landed | v6 E#127 — `pm since --session` = `created_at > last_nudge_ts`, state file `~/.local/share/pm/last-nudge.ts` (`v6-cognitive-augmentation-scope.md:115-118,150-151`) |
| **Idle detection → dashboard nudge** | NOT landed | `DESIGN.md:36-37` ("monitors tool call frequency, injects dashboard when idle"); `TASKS.md` P5.3 (idle detection threshold config) |
| **Auto-scaffold on phase completion** | NOT landed (the `tool_scaffold` READ is landed, `src_mcp_dashboard.rs:231-347`) | `DESIGN.md:37-38` ("when phase completes, creates task tracker items for next phase"); `TASKS.md` P5.4 |
| **Structured session-handoff doc** | NOT landed | `DESIGN.md:40-43` layer 5; `TASKS.md` P6.1/P6.2 (handoff doc on session end, inject at session start) |
| **Delta query** | `tool_since` (`src_mcp_dashboard.rs:662-740`) — "nodes created or modified since date **or session**"; session-anchored alternative exists | — |

So pm's landed surface is a **read-compute-tool** layer: the agent must *call* `pm_session_init` /
`pm_session_context` / `pm_dashboard` to receive the briefing. The ambient activation (hooks,
stop-nudge, idle, auto-scaffold, handoff docs) is **design intent that never shipped** — the v6
doc's own honest gap statement ("the briefings exist as functions but are not yet wired into
Claude Code hooks", `v6-cognitive-augmentation-scope.md:11-14`).

## 2. Ground truth — baton's agent-facing surface

- **The MCP surface is 67 distinct tools, capability-classified, not a flat registry.**
  `mcp-northbound.mjs` registers kernel `fleet_*`, ordinary `baton_*`, and reflex tools
  (`:403-689` ordinary row, `:697-755` advanced/fleet row, `:756-830` reflex row, `:79-120`
  the `CAPABILITY` classification; 67 distinct `name:` tool registrations — the one
  non-tool `name: 'baton'` at `:1372` is `serverInfo`, not a tool). Every tool carries
  annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and a
  capability class; the unified control grammar (M0-M5) enforces conformance. pm's 37 tools
  are flat `ToolDef`s with no capability/effect classification (`src_mcp_tools.rs`).
- **Spawn context is a fixed string + a fixed structural map + a keyword-recall slice.**
  `messageOnSpawn` is a `{kind, body}` fixed string validated at spec admission
  (`workflow-interpreter.mjs:239-246`), sent on first-live bounded ≤3 attempts to a DELIVERED
  messageId (`:706-709,771-803`). The L0 orientation pack is a **fixed structural map**
  (`_orientationL0Grant`, `coordinator.mjs:11362-11368`: `{frame, map, packId, scope}`,
  content-addressed by digest of the static map, `UNTRUSTED_ORIENTATION_L0`), injected into
  every spawn brief (`coordinator.mjs:3846-3847`). The ambient knowledge slice is `serveKnowledge`
  (`coordinator.mjs:10732-10756`): keyword-recall over findings matching the run objective,
  bounded (`maxFindings`/`maxBytes`), provenance-wrapped `{knowledge, untrusted:true}`,
  honest-empty — it rides the provider-facing brief, never `task.brief`.
- **The computed-digest surfaces are event-boundary-minted, and orchestrator-scoped.**
  The #103 briefing pack is minted at wave close (never a timer, `briefing-pack-contract.md`
  D2), content-addressed, `UNTRUSTED_CAMPAIGN_BRIEFING`-framed, served at session start with
  an **epoch-lag disclosure** (`composedAtEventSeq` vs ledger head — D5c), and is **never
  served through the worker read port** (#96 boundary: every run-scoped query kind intersects
  the run-horizon predicate, `coordinator.mjs:11369-11382`). The #71 wake is a `waitAfter`-
  anchored long-poll over the orchestrator's composed attention surface with a closed
  `WAKE_REASONS` set and the honest empty `{woken:false, timedOut:true}` (`orchestrator-wake-
  contract.md` D1, G1).
- **Member-side up-channel is six grammars, mostly unexercised.** `DECISION_REQUEST`,
  `SCRATCHPAD_WRITE`, `CONTEXT_READ`, `MESSAGE_SEND`, `BOARD_CLAIM`, `BOARD_REPORT`
  (`environment.md` §4). `gh` is unauthenticated in member worktrees; the scratchpad write
  lands `worker:<id>` and elevates at settlement; `shared` is not directly writable (§2).
- **The parity gate is a class-level three-way invariant.** #159 (`doc-truth-conformance-
  contract.md`) installs documented ⇄ parsed ⇄ admitted per surface, derived mechanically from
  the SAME tables the runtime consults — never renderer-vs-renderer (G6).
- **Idle/completion is event-derived by law.** #163 quiescence declares the wave quiesced
  when the roster produces no meaningful events across a roster-derived window
  (`contract-163.md` D1.1); #67 stall watchdog is evidence-derived (`no_progress_evidence`,
  closed `REARM_KINDS`). The drive loop still runs on `hardCapMs` + a 3h wall clock
  (`application.mjs:118`) — the de-clocking is the #163 DRAFT, not the reality.

---

## 3. Candidate verdicts (the agent-facing surface)

| # | Candidate (pm mechanism) | Verdict | Landing zone / note |
|---|---|---|---|
| C1 | Computed knowledge briefing at session/wave start (`build_knowledge_briefing` — findings + constraints + untested hypotheses + contradictions) | **ADAPT** | Member spawn briefs carry no computed digest today (`serveKnowledge` is finding-only keyword recall, `coordinator.mjs:10732-10756`; `messageOnSpawn` is a fixed string). The *categorized digest shape* is the idea; the activation must be event-boundary-minted, run-scoped (#96), UNTRUSTED-framed. Landing: extend the ambient-slice shape at the renderBrief seam, not a per-prompt hook |
| C2 | Ambient injection WITHOUT being asked (UserPromptSubmit hook, E#119/E#123) | **REJECT** (as designed) | Per-prompt machine-channel injection of a re-computed digest = the sterile-surface violation + the v6 risk register's own admitted 5+KB bloat/latency (`v6-cognitive-augmentation-scope.md:214-215`). The *never-ask* property is ALREADY-HAVE in #103's serve-at-session-start (orchestrator) and #81 L0-at-spawn (worker) — both event-boundary, not per-prompt |
| C3 | Delta-aware re-briefing / stop-nudge (E#127 `pm since --session`) | **ADAPT** | pm's `created_at > last_nudge_ts` is a wall-clock control (REJECT as-is). The *only-what-changed* property is the #71 wake's split-cursor paging (`storeCursor`/`reasonsCursor`) and #103's epoch-lag — ALREADY-HAVE at the orchestrator transport. For the **member nudge lane**: `nudgeOnCheckpoint` is a fixed string (`workflow.json` steering) — an event-derived change-summary riding the nudge is the ADAPT |
| C4 | Idle detection → dashboard nudge (tool-call frequency, P5.3) | **REJECT** (pm form) | Frequency-threshold idle detection + auto-inject = machine-channel + clock. The event-derived shape is #163's roster-derived quiescence (DRAFT, not landed) — that is the veto-compliant form baton is already building |
| C5 | Auto-scaffold on phase completion (P5.4) | **REJECT** | Derive-next-step task creation = machine-channel injection + derived status (the #161 D4 law: status/task creation is an orchestrator decision with evidence, never a hook). The `tool_scaffold` *read* (TaskCreate-ready phase roll-up) is on-demand and harmless; the *auto* trigger is not. Cross-ref row-pm-dag C3/C9 |
| C6 | CLI↔MCP parity testing (the `--all` double-execution bug) | **ALREADY-HAVE** | #159's three-way invariant (documented ⇄ parsed ⇄ admitted, mechanically derived) is the class-killer that subsumes pm's instance-level gap table. Their §1.2 table (`pm context`/`pm query`/`pm session-init` missing, `search --all` bug) is a good *inventory practice*; baton's gate compares against the runtime's own tables, not a hand-maintained list |
| C7 | Session-handoff document on session end (P6.1/P6.2) | **ALREADY-HAVE** | #103 is the content-addressed, epoch-lagged, event-minted handoff — strictly stronger than pm's free-text doc. It serves the exact boundary my reality hits: orchestrator session start / compaction. #59 (re-drive continuity) is the worker shape. No free-text handoff doc lands |
| C8 | Session lifecycle records (`pm_session_start`/`pm_session_end`/`pm_session_set_experiment`) | **REJECT** | Redundant in baton: the run IS the session; waves/wake are the activation; timestamps are wall-clock. No landing zone |
| C9 | Tool ergonomics: `-> TaskCreate:` pre-formatted output (`src_mcp_dashboard.rs:216,304,405`) | **ALREADY-HAVE** (as a concept) | baton's task admission is store-level (spawn → run → task via workflow spec + objectiveRef + harvest); the spawn brief IS the task-creation artifact. A tool emitting task-tracker lines would be a redundant second surface |
| C10 | Direct worker-writable knowledge surface (`pm_log_finding`, `pm_add_edge`, `pm_set_belief`, `pm_set_confidence`) | **REJECT** (pattern) | The lie-able surface veto: a worker mutating the KG directly (auto-link scoring, belief status) is exactly "a surface that can lie." baton's promotion lanes are actor-gated (`promotionActor` closed to `orchestrator`/`operator:*`, `coordination-store.mjs:361`) and the settlement ritual is the write gate — ALREADY-HAVE the correct shape. (Knowledge-structure specifics are row-pm-kg's lane; here the verdict is about the agent-facing *surface*) |
| C11 | `pm_since` delta read (session-anchored) | **ALREADY-HAVE** | The event-derived delta is `run.follow`'s change page + the #71 wake cursors. A "what changed since cursor" read exists; pm's date form is the clock variant, its session form is the acceptable seed |

---

## 4. Detailed evaluation

### C1 — Computed knowledge briefing at session/wave start (the difference is the point)

The row brief names this the sharpest comparison: **baton's `messageOnSpawn` is a fixed string;
pm's session briefing is a computed digest.** Verified both sides:

- pm computes, per active project: recent findings (top-5, sorted by `created_at`), active
  constraints with severity, untested hypotheses (`Proposed`), contradictions in the phase
  neighborhood (`build_knowledge_briefing`, `src_mcp_dashboard.rs:22-119`). It is injected by
  `tool_session_init` at session start (`:349-479`) and by `tool_session_context` per project
  (`:744-924`). This is genuinely more informative than a fixed string — it tells the agent
  **what is known, what is constrained, what is untested, what contradicts**, scoped to the
  active phase.
- baton's worker spawn gets: (a) `messageOnSpawn` — a fixed string authored at workflow-spec
  time (my own `workflow.json` steering carries one), (b) L0 orientation — a fixed structural
  map (`_orientationL0Grant`, `coordinator.mjs:11362-11368`), (c) `serveKnowledge` — keyword
  recall over **findings only**, matched against the run objective (`coordinator.mjs:10732-
  10756`). The ambient slice is bounded, honest-empty, UNTRUSTED-framed — the frame discipline
  is right — but it is a **flat relevance list of findings**, not a categorized digest of
  findings + constraints + hypotheses + contradictions.

So the gap is real and member-side. The ADAPT must respect four laws:

1. **Event-boundary mint, not per-prompt.** The v6 design (UserPromptSubmit per prompt, C2)
   is rejected; the digest is minted at a state-change boundary (spawn, checkpoint, close) —
   the #103 D2 discipline.
2. **Run-scoped by the #96 boundary.** Project-tier truth must not leak into a sibling run's
   horizon (`briefing-pack-contract.md` D7/G8: `_runHorizonNodeIds` closes per-run,
   `coordinator.mjs:11374-11382`). The member digest is computed over the run's OWN horizon:
   the run's findings, the constraints that bind the run, the hypotheses the run is testing,
   the contradictions in the run's evidence. That is #96's option (a) question — see
   DECISION_REQUEST.
3. **Constraints/hypotheses/contradictions are already store-derivable.** Constraint nodes and
   hypothesis nodes exist in the KG with the same query surface as findings; `find_contradictions`
   is pm's, baton's KG has `Contradicts` edges (`kg-settlement` epic). The *categorization* is a
   read-side projection over existing store state — no new authority, no new writes.
4. **UNTRUSTED + bounded + honest-empty**, exactly the `serveKnowledge` frame. The digest is
   advisory evidence to verify, never instruction; oversize degrades deterministically
   (drop oldest findings first), never truncates mid-field.

**Landing zone:** extend the ambient-slice shape at the renderBrief seam
(`coordinator.mjs:10732-10756` is served at the provider-facing brief, never `task.brief`), or
a run-scoped `CONTEXT_READ` query kind that composes the four-section digest over the run's
horizon. Sized honestly: a read-side composition over existing KG queries — small, veto-
compliant, and the **single most visible improvement** in this lane (see §7).

### C2 — Ambient injection without being asked (UserPromptSubmit)

pm's v6 gap is "the briefings exist but are not wired into hooks" and the smallest win is the
`UserPromptSubmit` hook (`v6-cognitive-augmentation-scope.md:11-16,202-208`). Reject as designed:
a hook that recomputes and injects a digest **on every prompt** is (a) a machine-channel
injection (the sterile-surface law), and (b) the v6 risk register's own admitted failure mode —
"5 findings x 150 char x N projects = 5+ KB per prompt", mitigated only by caps/gating
(`:214-215`). The *never-ask* property is not the problem — the *per-prompt* cadence and the
*recompute-at-read* is.

Baton already has the never-ask property at the right boundaries: #103 serves the orchestrator
digest at session start; #81 L0 rides every spawn brief; `serveKnowledge` rides the spawn
brief's render. The **cadence** is the honest difference: baton mints at state-change
boundaries and serves at session/spawn boundaries; pm (as designed) computes at every prompt.
The #103 D2 "session starts, wakes, compactions, crons, and intervals mint NOTHING" is the
pinned law. **REJECT** the pm activation; **ALREADY-HAVE** the property.

### C3 — Delta-aware re-briefing / stop-nudge

pm's E#127 is explicitly a wall-clock mechanism: `created_at > ?last_nudge_ts`, state file
`last-nudge.ts` (`v6-cognitive-augmentation-scope.md:115-118`). That specific shape is REJECT
(clock). But the *idea* — "the nudge carries only what changed since the last nudge" — is the
right ergonomic and baton already has it at the transport:

- The #71 wake pages `actions`/`reasons` past a **split cursor** (`storeCursor` + `reasonsCursor`)
  and returns the honest empty when nothing advanced (`orchestrator-wake-contract.md` D1/D3). A
  woken orchestrator sees only the delta. **ALREADY-HAVE.**
- #103 pairs every serve with an **epoch-lag disclosure** (`composedAtEventSeq` vs ledger head,
  Δ in events, `briefing-pack-contract.md` D5c) — staleness is a number, never a vibe.
  **ALREADY-HAVE.**

The ADAPT residue is the **member nudge content**. `nudgeOnCheckpoint` is a fixed string
(`workflow.json`; `workflow-interpreter.mjs:856-876` sends `st.nudgeOnCheckpoint.message`). A
delta-aware member nudge would compose "what changed in your run since your last checkpoint"
from the run's event page — the change-summary already carried by `run.follow`'s page. That is
a content-composition change to the nudge lane (the nudge stays best-effort, once per role), not
a new transport. **Landing zone:** the `handleCheckpoint` lane (`workflow-interpreter.mjs:856-876`)
composes a bounded change-summary when a `turn_checkpoint` is present. Sized honestly: small;
the data is already in the polled view. Marked **ADAPT**, lower priority than C1.

### C4 — Idle detection → dashboard nudge

pm: "monitors tool call frequency, injects dashboard when idle" (`DESIGN.md:36-37`), P5.3 idle
threshold. Two rejections: (a) a frequency threshold is a clock/accumulator control, (b) idle →
inject = machine-channel auto-action. The veto-compliant fragment is **event-cadence-derived
silence detection with no auto-action** — and that is exactly #163's quiescence (roster-derived
evidence window, `WAVE-QUIESCED`, `contract-163.md` D1.1). #163 is a DRAFT, not landed; the drive
loop still runs on `hardCapMs`/the 3h `PRODUCTION_WORKFLOW_DRIVER` clock (`application.mjs:118`).
So: **REJECT** the pm form; the baton landing zone is #163 itself (already in the
campaign queue) — nothing new to adopt.

### C5 — Auto-scaffold on phase completion

pm: "when phase completes, creates task tracker items for next phase" (`DESIGN.md:37-38`), P5.4.
The pm-dag row already rejected the auto-transition half (C3) and the auto-scaffold (C9) — I
cross-reference, not re-specify: task/tracked-item creation is an orchestrator decision with
evidence (#161 D4), never a hook; and an idle-triggered injection into the agent runtime is the
machine-channel violation. The **read** half of `tool_scaffold` — an on-demand phase roll-up
with experiment status counts and dependency/constraint/principle sections
(`src_mcp_dashboard.rs:231-347`) — is a harmless read projection whose analog baton composes
via `waves.list` + the plan object (row-pm-dag C6's portfolio projection). **REJECT** the auto
trigger; the read shape is already covered by the read-side dashboard ADAPT in the dag lane.

### C6 — CLI↔MCP parity testing

pm's own failure inventory is instructive precisely because it is an *instance* list: `search
--all` iterates projects but `tool_search` is project-agnostic, printing the same global results
N times; `pm context`/`pm query`/`pm session-init` have no CLI mirrors
(`v6-cognitive-augmentation-scope.md:39-47,94-99`). baton's #147/#159 class is the *general*
defect — documented surfaces teach verbs the parsers and admission refuse — and #159's contract
fixes the CLASS with a three-way mechanical invariant (documented ⇄ parsed ⇄ admitted, derived
from the runtime's own tables, never renderer-vs-renderer; `doc-truth-conformance-contract.md`
D1/G6). The `--all` bug is the exact class pm's table catches instance-by-instance; baton's gate
would catch it mechanically at admission.

**ALREADY-HAVE.** One honest note: baton's gate checks **admission/inventory** parity, not
**output** parity. pm's `--all` bug is a *behavioral* divergence (MCP output vs CLI output). If
baton ever ships a CLI mirror of an MCP tool where the output MUST match byte-for-byte, that is
a per-tool output-parity pin — not a new subsystem. No current surface needs it (CLI renders
text, MCP returns JSON — deliberately different surfaces). Recorded as a non-gap.

### C7 — Session-handoff documents

pm: P6.1 "structured handoff doc on session end", P6.2 "session start context injection (handoff
+ dashboard + stale findings)" (`TASKS.md:66-67`; `DESIGN.md:40-43`). Design only, and the free-
text shape is the lie-able one (a hand-written resume prompt is exactly what #103 replaced — the
8KB hand-written 22:49 prompt is the issue's own seed, `briefing-pack-contract.md:5-7,63-66`).

Baton's answer is the #103 briefing pack: content-addressed (`packId` = digest of the body),
minted at wave close from ledger receipts (D2/D8), served at every session start with an epoch-
lag disclosure (D5c), UNTRUSTED-framed (D5a), and advisory (D5b — never gates). For my reality —
orchestrator session compaction — this is exactly the resume artifact: it resolves the campaign
state (rings/lanes/landings/parked/blocked-on/standingLaws) without archaeology. **ALREADY-HAVE**;
strictly stronger than pm's doc. #59 (re-drive continuity, `redrive-continuity-2026-08-07/`) is
the worker-side same-shape. No free-text handoff doc lands.

### C8 — Session lifecycle records

`pm_session_start`/`pm_session_end`/`pm_session_set_experiment`
(`src_mcp_dashboard.rs:624-660,926-931`) create timestamped session rows so a session can be
recovered later. baton's run IS the session: runs are durable, long-lived, replay-derived, and
the wake/follow surfaces are the resume lanes. A separate "session" concept adds a second
timeline to reconcile for zero ergonomic gain, and its timestamps are wall-clock. **REJECT.**
(The `pm_since` *session-anchored delta* — "what changed since session N" — is the one useful
fragment, and baton's follow cursors already serve it, C11.)

### C9 — `-> TaskCreate:` pre-formatted tool output

pm tools append `-> TaskCreate: subject="..." description="..."` to their output
(`src_mcp_dashboard.rs:216,304,405`). This is response-formatting that offloads the tracker-
item shape to the agent. baton's task admission is store-level and spec-shaped: a spawn is a
`workflow.json` member (role, objectiveRef, scope, report, harvest `mustContain`), and the run
view + attention lanes are the tracker. A tool that emits tracker lines would duplicate a
surface that already exists with authority. **ALREADY-HAVE** as a concept (the spawn objective +
harvest contract IS the task item); the specific formatting ergonomic is cosmetic.

### C10 — Direct worker-writable knowledge surface

pm's write tools let the agent mutate the KG directly: `pm_log_finding` with auto-linking via
composite scoring, `pm_add_edge`, `pm_set_belief`, `pm_set_confidence`
(`src_mcp_tools.rs` tool table). This is the "surface that can lie" veto in its purest form — a
worker asserting edges and belief states is authoring truth the system then trusts. baton's
shape is the opposite: knowledge admission is actor-gated (`promotionActor` closed to
`orchestrator`/`operator:*`, `coordination-store.mjs:361`), the settlement ritual is the write
gate, and the worker's scratchpad elevates at settlement (`elevateWhenNotes`,
`workflow-interpreter.mjs:877-908`). **REJECT** the pattern — baton **ALREADY-HAVE** the correct
write authority. The read-side half of pm's surface (`pm_search`, `pm_context`, `pm_query` —
composite-scored retrieval) is genuinely richer than the member read port, but that is the
knowledge-structure lane (row-pm-kg), not the agent-activation lane; I flag it, I don't re-spec.

### C11 — `pm_since` delta read

`pm_since` supports a session anchor ("changes since session N") alongside a date
(`src_mcp_dashboard.rs:662-740`). The date form is a clock; the session form is the acceptable
seed and is already served by `run.follow`'s change page + the #71 wake cursors (C3).
**ALREADY-HAVE.** No action.

---

## 5. Time-mechanism census (every pm clock in this lane → ADAPT-to-event-derived or REJECT)

| pm mechanism | Source | Verdict |
|---|---|---|
| Stale-hypothesis sweep `> 7 days` (`is_stale`) | `src_mcp_dashboard.rs:14-18,412-419,906-912` | **REJECT** — wall-clock staleness; a hypothesis is closed by evidence (tested/refuted), never by age |
| Delta-aware stop-nudge `created_at > last_nudge_ts`, `last-nudge.ts` | v6 E#127 (`v6-cognitive-augmentation-scope.md:115-118`) | **REJECT** as clock; **ADAPT** the only-what-changed property to the event-derived form (C3 — baton's follow/wake cursors already have it) |
| UserPromptSubmit per-prompt injection (30s cache, `PM_INJECT=1` gate) | v6 E#119/E#123 (`:111-121,178-181,214`) | **REJECT** — per-prompt machine-channel injection; the never-ask property is ALREADY-HAVE at event boundaries (C2) |
| Idle detection threshold (tool-call frequency) | `DESIGN.md:36-37`, `TASKS.md` P5.3 | **REJECT** — frequency threshold + auto-inject; the event-derived shape is #163 quiescence (C4) |
| Auto-scaffold trigger on phase completion | `DESIGN.md:37-38`, `TASKS.md` P5.4 | **REJECT** — derived task creation + machine-channel (C5) |
| Session start/end timestamps | `src_mcp_dashboard.rs:624-660` | **REJECT** — redundant + wall-clock (C8) |
| `pm_since` date form | `src_mcp_dashboard.rs:662-740` | **REJECT** date form (clock); session form ALREADY-HAVE (C11) |

Baton's landed time-adjacent surfaces that stay: the node wall budget (operator-pinned backstop,
not a workflow control), #67's liveness windows (evidence-based, re-arm on evidence), and #163's
planned roster-derived quiescence (event-cadence, DRAFT). Nothing clock-derived from pm lands.

---

## 6. The activation comparison (what the two systems actually do at the boundaries)

The honest synthesis for this lane:

- **pm's read surface is richer; its activation is imagined.** `build_knowledge_briefing` +
  `session_init` + `session_context` are landed, useful, computed reads — but the v6 ambition
  (hooks, idle, scaffold, handoff docs) never shipped. baton's surfaces are the opposite:
  activation is landed and event-derived (#103 mint-at-close, #71 long-poll wake, L0-at-spawn,
  `serveKnowledge`), while the *content* delivered to a member at spawn is thinner than pm's
  digest.
- **baton's honesty discipline is strictly stronger on every axis.** UNTRUSTED frames on every
  model-consumed artifact (#103 D5a, L0 frame, `serveKnowledge` untrusted wrapper); epoch-lag
  instead of "fresh" claims (#103 D5c); honest-empty instead of fabricated reasons (#71 D1.3);
  mint-at-state-change instead of recompute-at-read (#103 D2); actor-gated writes instead of
  worker-writable KG (C10). pm's design has none of these — the v6 doc's own risk register
  reaches for gates/caps to paper over the bloat.
- **The one genuine gap pm's shape exposes is a member-side computed digest.** pm tells a
  spawned agent "here is what is known, what constrains you, what is untested, what
  contradicts" scoped to the active phase. baton tells a spawned worker "here is the L0
  structural map, here is the objective, here are findings matching your objective's
  keywords." The categorized-digest shape is the C1 ADAPT.

---

## 7. Judgment calls and DECISION_REQUEST items

- **C1 is the one-place judgment call.** I ranked it the strongest ADAPT in the lane because
  it is the only candidate where pm's *landed* shape (the digest) exceeds baton's *landed*
  shape (the flat keyword slice) — every other candidate either reduces to REJECT (clock /
  machine-channel) or ALREADY-HAVE (event-derived transport, class gate, handoff pack). If the
  coordinator prefers a smaller rung, the digest can be cut to findings + constraints only
  (drop hypotheses/contradictions) — the constraint section is the cheapest high-value add.
- **The #96 boundary is an authority-class question — DECISION_REQUEST.** Extending the
  member-facing digest to constraints/hypotheses/contradictions requires deciding who may serve
  what to a worker run. Options: (a) **run-scoped digest only** — the four sections are computed
  over the run's OWN horizon (findings in the run, constraints binding the run, hypotheses the
  run tests, contradictions in its evidence), which respects #96's per-run closure and needs no
  boundary change; (b) **defer to #96's option (a)** — if #96 lands project-tier service through
  the read port, the digest becomes project-scoped; (c) **no code** — document the shape as the
  coordinator's advisory and let #96 decide. My lean: (a) — the run-scoped digest is a read-side
  composition over existing KG queries, veto-compliant, and does not wait on #96.
- **C3's member nudge change is a shape choice, not authority-class.** Composing a change-
  summary into `nudgeOnCheckpoint`'s message is a content change to a best-effort lane. I left
  it lower priority than C1 because the transport already carries the data; if the coordinator
  wants the member nudge to stay a fixed string (spec-authored, deterministic), that is
  defensible — record it.
- **Cross-lane handoff:** the read-side portfolio projection (row-pm-dag C2/C6) is the landing
  zone for pm's `pm_dashboard`/`pm_next` reads; my lane does not re-spec it. The KG read
  ergonomics (`pm_search`/`pm_context`/`pm_query`) belong to row-pm-kg; I flag C10's read half
  as their territory.

---

## 8. Shared-scratchpad publish — ATTEMPTED, DID NOT LAND (recorded per #158)

The foundry frame requires publishing this report's text to the `shared` scratchpad partition
(`foundry-brief.md:27-28`). I emitted the member write surface — the `SCRATCHPAD_WRITE` up-channel
grammar (`claude-session.mjs:29,103-119`), closed shape `{entry: {kind, text},
expectedFence: "current", idempotencyKey: "row-pm-agent.report.final"}` — during this session.

**Verified: it did not land.** The resident coordination store
(`.git/baton/application-v3/state/coordination/events.jsonl`) records **zero** scratchpad events
for this worker (`w-268`): no `scratchpad.entry_written`, no `scratchpad.write_result`, no
refusal — grep for the idempotency key returns 0 hits across the whole 44MB file, and grep for
`w-268`+`scratchpad` returns 0. The channel is demonstrably LIVE in this wave: sibling row
`row-lane-messages` (`w-264`) landed three worker-scoped entries this same hour
(`scratchpad.entry_written` seq 75173/75205/76159, 19:24–19:38Z, scope `worker:w-264`). My
emission produced no event, and this worker's `evidence.mapped` telemetry stops at seq 76268
(19:40:02Z) — the coordinator's per-worker stream for `w-268` was not recording this session's
post-compaction continuation. **Exact observable:** a silent non-landing — no typed refusal
(a refusal would surface as `scratchpad.write_result` `ok:false`, `coordinator.mjs:12697-12700`),
no `entry_written`, no elevation. That silent gap is itself campaign evidence for #158.

**Structural impossibility, independent of the non-landing:** even a landed member write is
worker-scoped by construction — `writeScratchpad` hardcodes `const scope = 'worker:' + fields.workerId`
(`coordination-store.mjs:14103`); `shared` is writable only through the settlement lane
(`settleWorkflowScratchpad`, `coordination-store.mjs:14326`); elevation is orchestrator/
operator-gated (`elevateTaskScratchpad` requires `auth?.actor === 'orchestrator'`,
`coordination-store.mjs:14173`). So the frame's "publish to the `shared` partition" describes a
capability no member seat has — the exact RED #158 specifies and the channel audit documents
(`environment.md` §2). The durable file (this report) is the runtime handoff; the coordinator
reads it as the harvest artifact.

---

## 9. Verification / deliverable boundary

- Deliverable: `docs/reference/evidence/pm-comparison-2026-08-13/pm-agent.md` (this file).
  Work confined to `docs/reference/evidence/pm-comparison-2026-08-13/**`. No source files
  modified.
- Deployment verification (Baton contract): executable `true`, args `[]`, cwd `.`, expected
  exit code `0`.
- **Tree provenance (honest):** this row's worktree is a snapshot at `e371f70`; the baton
  `impl/src/*.mjs` citations in this report resolve against that worktree HEAD (re-verified
  this session with `grep -an`/`sed -n` on the worktree files). The pm-digest `.rs` files and
  the prose digests (`v6-cognitive-augmentation-scope.md`, `DESIGN.md`, `TASKS.md`), the
  pm-comparison `foundry-brief.md`/`row-pm-agent.md`/`workflow.json`, and the
  `channel-audit-2026-08-13/environment.md` evidence do **not** exist in the worktree — they
  live only in the main repo tree and are cited from there (the pm-digest `.rs` files are the
  authoritative ground truth; prose stale-risk noted where relied on). All impl anchors were
  re-read this session against the worktree working tree at `e371f70`; the two evidence dirs
  (`channel-audit-2026-08-13/`, `pm-digest/`) were re-read against the main repo tree.
- Citations: pm side — `src_mcp_tools.rs`, `src_mcp_dashboard.rs` (anchors re-verified:
  `build_knowledge_briefing` `:22`, `is_stale` `:14`, `tool_session_init` `:349`,
  `tool_session_context` `:744`, `tool_since` `:662`, `tool_scaffold` `:231`), `v6-cognitive-
  augmentation-scope.md`, `DESIGN.md`, `TASKS.md`. Baton side — `mcp-northbound.mjs`,
  `workflow-interpreter.mjs` (steering keys `:52-53`, `messageOnSpawn` validation `:239-246`,
  delivery `:706-709`, `signalOnMembersDone` `:740-751`, `pumpMessageOnSpawn` `:771-803`,
  `handleCheckpoint` `:856-876`, `tryElevate` `:877-908`), `coordinator.mjs` (`serveKnowledge`
  `:10732-10756`, `_orientationL0Grant` `:11362-11368`, L0 injection `:3846-3847`, run-horizon
  `:11369-11382`), `application.mjs:118`, `application-semantics.mjs:59-62`, `messages.mjs:18`,
  `coordination-store.mjs` (`promotionActor` `:361`, `writeScratchpad` `:14064-14110`,
  elevation gate `:14173`, `settleWorkflowScratchpad` `:14326`), the `workflow.json` for this
  wave, `briefing-pack-contract.md` (#103), `orchestrator-wake-contract.md` (#71),
  `doc-truth-conformance-contract.md` (#159), `contract-163.md` (#163 DRAFT),
  `orientation-scoping.md` (#81), `redrive-continuity-2026-08-07/` (#59),
  `channel-audit-2026-08-13/environment.md`, `docs/PROGRESS.md` (#174, `:36-38`).
