# The Flip experience — the brand persona as a living status channel (docs/38)

*Ideation + design for making baton and the baton MCP visually appealing and dynamic through
the Flip character (the `/flip` repo's mascot — big round eyes, wide smile, gold cheek
sparkles — holding the conductor's baton, Fantasia-style). Cross-refs: #115, #133 (the filed
asks), #135 (staged startup lines), #315 (the rework), `impl/src/brand.mjs` (the shipped
foundation), `.github/assets/banner.svg` (the repo banner). Status: **reworked by operator
decision (2026-09-14)** — Flip is brand identity only; the pose grammar of §3 is retired
(see §3).*

---

## 1. What exists today

- `flipFace(['smile'])` / `flipLine(text, {color})` in `impl/src/brand.mjs`: ONE static mark —
  the smile ✦(◕‿◕)✦ — ANSI color only on a TTY, **stderr only** (stdout stays machine-clean).
  There is no pose vocabulary and no pose derivation anywhere (`brand_pose_invalid` for any
  other name, kept so the MCP server-identity line keeps its mark).
- `flipStatus(statusClass, {color})`: the stderr **status channel** — a closed set of plain
  glyphs and words (`● ready`, `◐ working`, `▲ needs you`, `✗ refused`, `‖ stalled`, `○ idle`,
  `⇣ draining`, `✓ done`) derived from the projection classes by ONE function; shown on a TTY
  only, **silent when stderr is piped**; `flipAnnounce` composes mark + status + text for the
  serve lifecycle and refusal lines.
- Rendered today at: the serve lifecycle lines (publication, drain, exit), the bare-help
  brand line, and the error line (`baton: <code>: …`) — mark + status word on a TTY, the
  bare text when piped.
- The banner SVG: Flip with the baton over the wordmark.

So the seed is real and already obeys the two laws that matter most for UX flair in an
agentic system: **the human channel is stderr, the machine channel is never decorated**, and
**color/animation degrade to plain text** outside a TTY.

## 2. The design principles (the honesty law, applied to delight)

1. **Flair annotates truth; it never replaces it.** A Flip face may sit beside a refusal;
   it may never soften, reword, or substitute for the typed code + field + next action
   (#160's law). Cute is a rendering layer over honesty, never instead of it.
2. **Machine output is sacred.** Nothing persona-shaped ever enters stdout JSON, MCP tool
   payloads, receipts, or the event log. The persona lives on stderr, in help text, in
   human-rendered views, and in report chrome.
3. **Degrade gracefully.** No TTY → plain unicode. No unicode → ASCII (`:)`-class fallback).
   CI/piped → silent. Animation → a single static frame when in doubt.
   *(Contradiction resolved 2026-09-14, #315: this rule contradicts §1's older "plain
   unicode otherwise" for a piped stderr. The stronger honesty rule wins and **CI/piped is
   silent**: the mark and the status glyph are never emitted on a piped stderr, while a
   refusal's typed text itself is not persona and still reaches the reader.)*
4. **One status grammar everywhere.** The same status word means the same state on the CLI,
   in the MCP client chrome, and in HTML reports — one derivation (`flipStatus`), never a
   second vocabulary.

## 3. The pose grammar — RETIRED (operator decision, 2026-09-14)

**Decision (issue #315).** The persona-as-state-channel concept is reworked, not
implemented: Flip is **brand identity only**. Every rule this doc places on Flip (stderr
only, never in machine payloads, derived from projections or it does not exist, punctuation
not noise, never softening a refusal) is right, and together they leave a one-glyph status
indicator that a conventional glyph set expresses without a vocabulary to learn or a persona
to keep honest. The day's evidence — one pose on everything — shows that deriving faces from
state is work that competes with honesty work and loses. An operator running many lanes
needs rows, not a face. The eight-pose grammar below is retired with this reason; state is
carried by the closed status set of §1, derived from the same projection classes by ONE
function (`flipStatus`). The pose prose elsewhere in this doc (§4–§7) is historical design,
not shipped behavior.

### The retired grammar (historical)

The two shipped poses covered "fine" and "busy." The system has richer truth than that, and
the character can carry it. Proposed vocabulary (each pose = one named system state, all
deriving from the existing projections — never a second source of truth):

| Pose | Sketch | Meaning (binds to) |
|---|---|---|
| `smile` | ✦(◕‿◕)✦ | ready / success / gate green |
| `thinking` | ✦(◕﹏◕)◦ | working / waiting on the provider |
| `attentive` | ✦(◕o◕)❗ | **attention required** — a parked decision, an `awaiting` state (the #10 `blocked_interaction` class) — the single highest-value pose: the face that says *you must act* |
| `cheering` | \(◕‿◕)/✦ | wave complete, harvest green (WAVE-OK) |
| `concerned` | ✦(◕﹏◕|||) | a member stalled / watchdog escalated (#67 states) |
| `sleeping` | ✦(－‿－)💤 | idle resident, zero waves (serve idle tick) |
| `reaping` | ✦(◕‿◕)🧹 | cleanup/drain in progress |
| `confused` | ✦(◎﹏◎)？ | a refusal — ALWAYS adjacent to the typed refusal, never instead of it |

The grammar rule: **poses derive from the same projections the machine surfaces expose**
(progressClass, waitingOn, wave registry state). If a pose can't be derived from the
projections, it doesn't exist — the persona never invents state. (That is what keeps the
character honest: Flip can only ever *read*.) The rule survives the pose vocabulary: the
closed status set derives by the same law, and an undervivable status is absent, never
invented.

## 4. Native animation (the #133 ask)

- **The working loop**: while a command waits on the resident (a `waves run`, a long
  `run view --until`), the CLI's stderr renders a two-to-four-frame Flip cycle — thinking →
  baton-twirl — on the ordinary spinner cadence, ending on the terminal pose (cheering /
  concerned / confused). Implementation shape: a tiny frame list in `brand.mjs` and a
  `flipSpin(stopWhen)` helper riding the same TTY gate; the frames are unicode-only.
- **The orchestra view** (`waves list --watch`, or the resident's own tick): the wave roster
  rendered as Flip conducting N seats — each member a one-line glyph with its phase pose;
  the conductor's baton ticks when any member produces a meaningful event (the
  `meaningfulEventAt` projection drives the animation — a *data-driven* animation, not a
  wall-clock one; quiet roster, still conductor).
- **Startup narration (#135 synergy)**: serve's staged readiness lines arrive with Flip
  poses — binding (thinking), listening (attentive), published (cheering) — turning the
  silent-minutes bug's fix into the product's first impression.

## 5. The MCP surface

MCP tool payloads are machine channels — **the persona never enters them**. The legitimate
MCP-side moments:

- **Server identity**: the MCP `serverInfo` name/version is what clients display in their
  server lists — `baton (Flip)` with the SVG as the client-side icon where the client
  supports one (several MCP clients render a server avatar from a bundled asset; the asset
  ships in the package).
- **Tool descriptions**: the first line of each tool's description may carry the face (they
  are human-authored prose read by humans in client UIs); the *schemas* stay sterile.

*(The former "notification cadence" bullet — progress/attention notifications carrying a
pose field the client MAY render — is deleted by the operator decision of 2026-09-14: no
pose field exists anywhere. A client derives the status from the wake class.)*

### 5a. The decision-loop chrome (design-only; retired with the §3 grammar)

(The moments below remain real — the system asking for a human is the highest-value moment —
but they are carried by the closed status words and the typed decision payload, never by a
pose.)

The single highest-value crossover between the brand and the collaboration layer: the
worker's upward **DECISION_REQUEST** lane (#10's `blocked_interaction`, the multi-choice +
free-response question primitive) rendered *as Flip moments on both ends*:

- **Upward (worker → orchestrator):** the orchestrator's surface — MCP elicitation where
  the client supports it, the attention pose ✦(◕o◕)❗ on the CLI/TUI — presents the question
  with its 2–4 options as a first-class visual event, not a log line. The pose derives from
  the same `waitingOn`/`blocked_interaction` projection the machine surface exposes (the
  §2 honesty law: Flip only ever reads). In a sub-orchestrated wave (#74), the pose chains:
  the tight cell's coordinator sees its member's attentive frame; if it escalates, the top
  orchestrator sees the cell's frame — the visual nesting mirrors the authority nesting.
- **Downward (orchestrator → worker):** the answer lands on the worker's own down-channel
  (#79's delivery push) with a settling frame — a nod/cheer on answer, the thinking pose on
  "wait." The worker's stderr is the human-visible tail of the decision loop; closing it
  visually is what makes the loop feel *answered*, not just delivered.
- **Progress as mood, not spinners:** long tool calls (a wave round-trip, a harvest) stream
  MCP `progress` notifications whose optional pose field walks the grammar (thinking →
  attentive on a parked decision → cheering on green harvest). The animation is data-driven
  off `meaningfulEventAt` exactly as §4's orchestra view — quiet roster, still conductor.
- **Client capability honesty:** elicitation-capable clients get the rich prompt;
  others get the plain typed decision payload. The pose field is always optional chrome;
  the decision itself is always the machine channel. A client that renders nothing loses
  no function.

This subsection is the design answer to "the MCP should feel alive": the character appears
precisely at the moments the *system needs a human*, and nowhere else.

## 6. CLI + resident moments

- `baton help` — the smile + one-line persona intro; `help <topic>` topic glyphs.
- `baton doctor` — the readiness report with per-route statuses (ready / blocked /
  unobserved) — the doctor's rows already carry states; the status word is a render of them.
- Refusals — the full typed refusal + the next action, with the `✗ refused` status beside
  it on a TTY. The status makes the error *findable*; the #160 triple makes it *useful*. Both.
- `waves list` — roster rows with the closed status words (working / needs you / stalled /
  terminal), so a glance reads the wave.

## 7. HTML reports + the banner

- The campaign report chrome (the 24h-report precedent) gets the Flip frame: header banner,
  status words on section states, the wave timelines with member rows. Enjoyable *and*
  precise — the report's technical content is unchanged; the frame makes it navigable.
- The repo banner stays static SVG; an animated variant (SMIL/CSS keyframes inside the SVG —
  GitHub sanitizes animation partially, so a tasteful two-state shimmer at most) is a
  maybe-later. The `baton dogfood snapshot` committer avatar (the operator's original ask):
  the Flip-with-baton crop from the banner as the avatar image.

## 8. What this is NOT

- Not in logs, receipts, envelopes, tool payloads, or any machine channel.
- Not a persona that speaks in first person about system state it can't see (no "I'm
  checking…" narration unless the state exists in a projection).
- Not animation when piped, in CI, under `NO_COLOR`, or in tmux-unaware contexts.
- Not a priority over any honesty work (#155–#160, #169) — this is the frame, honesty is
  the picture.

## 9. Sequencing (cheap-first rungs)

1. **Rung A — RETIRED with the §3 grammar (2026-09-14, #315):** the pose vocabulary
   expansion was withdrawn; the brand mark and the closed status channel shipped instead.
2. **Rung B:** `flipSpin` working-loop on CLI waits + the doctor/attention status bindings.
3. **Rung C:** the orchestra watch view (`waves list --watch` — rides #157's registry
   fidelity fix so interpreter waves show too).
4. **Rung D:** MCP identity/description chrome (with the notification lane; the pose field
   is deleted — a client derives the status from the wake class).
5. **Rung E:** HTML report chrome + the avatar crop.
6. **Rung F:** the §5a decision-loop chrome (rides #79's delivery lane + #10's
   `blocked_interaction` + the notification lane; MCP elicitation binding where clients
   support it).

Each rung is independently landable, suite-pinned (a status derivation is a pure function of
the projection — trivially red-first), and removable without touching truth.
