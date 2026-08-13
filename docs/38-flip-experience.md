# The Flip experience — the brand persona as a living status channel (docs/38)

*Ideation + design for making baton and the baton MCP visually appealing and dynamic through
the Flip character (the `/flip` repo's mascot — big round eyes, wide smile, gold cheek
sparkles — holding the conductor's baton, Fantasia-style). Cross-refs: #115, #133 (the filed
asks), #135 (staged startup lines), `impl/src/brand.mjs` (the shipped foundation),
`.github/assets/banner.svg` (the repo banner). Status: design, unscheduled; low priority and
deliberately so — but cheap rungs are marked.*

---

## 1. What exists today

- `flipLine(text, {pose, color})` / `flipFace(pose)` in `impl/src/brand.mjs`: two poses —
  `smile` ✦(◕‿◕)✦ (ready/success) and `thinking` ✦(◕﹏◕)◦ (working/waiting) — ANSI color only
  on a TTY, plain unicode otherwise, **stderr only** (stdout stays machine-clean), unknown
  poses refuse typed (`brand_pose_invalid`).
- Rendered today at: the serve lifecycle lines (startup publishes as thinking, close as
  smile), bare-help and error lines (`baton: <code>: …` with the thinking face).
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
4. **One persona grammar everywhere.** The same pose means the same state on the CLI, in the
   MCP client chrome, and in HTML reports. Flip is one character with consistent moods, not
   a sticker pack.

## 3. The pose grammar — Flip's face as a status channel

The two poses cover "fine" and "busy." The system has richer truth than that, and the
character can carry it. Proposed vocabulary (each pose = one named system state, all
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
character honest: Flip can only ever *read*.)

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
- **Notification cadence**: progress/attention notifications (when the notification lane
  lands) carry a pose field the client MAY render — declared, optional, never load-bearing.

## 6. CLI + resident moments

- `baton help` — the smile + one-line persona intro; `help <topic>` topic glyphs.
- `baton doctor` — the readiness report with per-route poses (green smile / auth-red
  concerned / unobserved thinking) — the doctor's rows already carry states; the face is a
  render of them.
- Refusals — the confused face + the full typed refusal + the next action. The face makes
  the error *approachable*; the #160 triple makes it *useful*. Both.
- `waves list` — roster rows with phase poses (working/attention/stalled/terminal), so a
  glance reads the wave.

## 7. HTML reports + the banner

- The campaign report chrome (the 24h-report precedent) gets the Flip frame: header banner,
  pose glyphs on section states, the wave timelines with member poses. Enjoyable *and*
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

1. **Rung A (cheap, pure additive):** the pose vocabulary expansion in `brand.mjs` (the
   eight-pose grammar + the derivation helpers from progressClass/waitingOn), rendered at
   the existing flipLine sites. One small diff, zero behavior change, immediately visible.
2. **Rung B:** `flipSpin` working-loop on CLI waits + the doctor/attention pose bindings.
3. **Rung C:** the orchestra watch view (`waves list --watch` — rides #157's registry
   fidelity fix so interpreter waves show too).
4. **Rung D:** MCP identity/description chrome + the notification pose field (with the
   notification lane).
5. **Rung E:** HTML report chrome + the avatar crop.

Each rung is independently landable, suite-pinned (a pose's derivation is a pure function of
the projection — trivially red-first), and removable without touching truth.
