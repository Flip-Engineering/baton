# suborchestrator — auditing Baton's bidirectional communication from inside swarm `audit-comm`

Author: participant `suborchestrator` (permissions: `read`, `communicate`, `contribute`, `review`,
`organize`, `recruit`), 2026-09-14, 04:33Z–04:47Z. All timestamps UTC, from command wall clock or
from server `ts` fields as marked. The root orchestrator watched the same swarm from outside via
`swarm watch --follow`; this report is written to be diff-able against what it saw.

Method: every swarm interaction below was an executed
`node "$BATON_SWARM_CLIENT" <swarm.command> '<json>'` call. The two probes wrote their own reports
(`probe-see.md`, `probe-say.md`, copied into this directory from their own worktrees — see the
worktree-split finding). Nothing outside `docs/audits/2026-09-14-swarm-communication/` was written.

---

## 0. Timeline (all events I directly observed)

| ts (UTC) | event |
|---|---|
| 04:34:18Z | my first `swarm.view`: cursor 1615, `attention: []`, delegation `{children:[],work:[],complete:true}` |
| 04:34:56Z | `swarm.recruit` probe-see OK (8.76 s round trip); binding w-4 at 04:35:05.168Z |
| 04:35:15Z | `swarm.recruit` probe-say OK (8.95 s); binding w-5 at 04:35:24.014Z |
| 04:35:41Z | my first `swarm.update` refused — I passed `kind` instead of `event`+`payload` |
| 04:36:01–04:36:04Z | declared work-see (seq 1736), work-say (1737), both assignments (1738, 1739), context `protocol:audit` (1745) |
| 04:36:16.856Z | probe-see publishes `notes:probe-see-guide-request` (seq 1767, body `"guide me"`) |
| 04:36:29.850Z | probe-say opens `work-say-probe` (seq 1789) |
| 04:36:58–04:38:30Z | my watches #1–#4, all instant replays (cursor behind head) |
| 04:37:24Z | I `swarm.guide` probe-see (its requested reply) |
| 04:37:35Z | I `swarm.guide` probe-say |
| 04:37:59–04:38:00Z | probe-say self-assigns then releases `assignment-say-probe` |
| 04:38:35–04:39:04Z | my watch #5, first genuinely blocking wake (29.06 s), wakes on probe-say's in-flight `swarm.guide` to me — attention row `operation_unconfirmed` |
| 04:39:59Z | I reply to probe-say via `swarm.guide` (wake inventory) |
| 04:40:39.446Z | probe-see contributes `contribution-d509edb8…` |
| 04:41:48.958Z | I review it: accept |
| 04:42:10.191Z | probe-say contributes `contribution-874d5e49…` (workId null, refs null) |
| 04:42:33.173Z | probe-say re-publishes `contribution-ad258239…` correctly linked to work-say |
| 04:43:04Z | I review both probe-say contributions: accept |
| 04:47:00Z | I publish this report as `contribution-93e5b391…`; `swarm.capture` freezes it 04:47:05.480Z; `swarm.check` hangs (300 s, then 20 s) and is recorded as a gap |

## 1. `swarm.view` (my own seat)

**Worked.** One call returned the full authoritative picture: participants with permissions and
runtime state, `caller`, `availableActions`, the `updates` catalog with per-event payload schemas,
`actionTargets`, `attention`. First read 04:34:18Z, cursor 1615.

**Gaps.**
- `delegation` read `{"children":[],"work":[],"complete":true}` — *vacuously complete before any
  child existed*, flipping to `complete:false` only when I declared work. probe-see, independently:
  > Earlier, at recruitment time, it read `complete: true` with `work: []` — a vacuous "complete"
  > that a worker could misread as "my part is finished".
- The participant `role` field carries the **entire brief verbatim** — my children can read my full
  instructions, and I can read theirs (probe-see verified it could read my 3481-char brief including
  the root orchestrator's existence). Swarm-wide role visibility is a design fact worth confirming
  is intended.
- `availableActions` advertises `swarm.update` to every participant while the real whitelist is the
  separate `updates` array. probe-see hit the difference as a refusal (§6).
- `capture`/`check` appear in `availableActions`/`actionTargets` with no hint of their workflow
  (who captures whom, in what order). I had to read `--help` to learn they even take a
  `contributionId`.

**Friction.** The `context` map is keyed by a JSON-encoded composite `[groupId, key]` — my protocol
note is stored under `"[null,\"protocol:audit\"]"`. Readable, but awkward to address
programmatically.

## 2. Subtree view (`swarm.view` with `participantId`)

Not exercised by me directly (probe-see was scoped for this). Its result, quoted:

> Scoping is a **lens, not an authority boundary**. I could read my sibling's subtree by naming it,
> and I already had the same rows from my unscoped view. `caller` and `availableActions` stay *mine*
> in every scoped read.

> `context` is **not scoped**: a scoped read still returns every shared-context key, including keys
> written by participants outside the scope.

And the refusal for an unknown scope (verbatim, from `evidence-see/02-subtree-nobody-here.json`):

```json
{"ok":false,"error":{"message":"Participant is unavailable in this swarm","code":"swarm_participant_not_found","detail":{}}}
```

## 3. `swarm.recruit`

**Worked.** Two recruits, both synchronous and fast:

| probe | issued | round trip | runId | runtime binding |
|---|---|---|---|---|
| probe-see | 04:34:56Z | 8.76 s | `run-a22f333ac9d85b7fc4aa85516912132b` | w-4 at 04:35:05.168Z |
| probe-say | 04:35:15Z | 8.95 s | `run-f5719ceaf19287b6d1fc0afabe219d68` | w-5 at 04:35:24.014Z |

The response carries only `{participantId, runId, swarmId, commandReceipt}` — I learned the probes
were actually *up* ~9 s later only by re-reading the view. Acceptable, but a `started` signal or
binding row in the receipt would save a poll.

**The refusal texts** (probe-say attempted recruit without the permission; verbatim from its §10):

Schema gate fires **before** the permission gate:

```json
{"ok":false,"error":{"message":"swarm.recruit request is invalid: unknown field purpose","code":"swarm_command_invalid","detail":{"field":"purpose"}},"commandReceipt":{"idempotencyKey":"c2f9315e-6ba4-4297-900b-116dc1d278ed"}}
```

Then the permission gate:

```json
{"ok":false,"error":{"message":"This swarm has not granted recruit authority to this participant","code":"swarm_permission_required","detail":{"permission":"recruit","participantId":"probe-say"}},"commandReceipt":{"idempotencyKey":"53e48242-45cb-4358-9755-868760e2d88f"}}
```

**Gap that shaped this whole audit:** `shareWorkspaceWith` is opt-in and I did not pass it, so each
probe got its **own worktree** (`ws-31468b…`, `ws-76774184…`) while mine is `ws-ffc248…`. The brief
said the probes would write "in the same directory"; nothing in `recruit`'s response, the view, or
any error told me the worktrees differed — I discovered it when `probe-see.md` was *not found* in my
tree after its contribution named it. A swarm-level "who shares which checkout" row would have made
this visible before the first miss.

## 4. Declaring work (`swarm.work_updated`, `swarm.assignment_updated`, `swarm.context_updated`)

**Worked.** Five updates in 3.71 s total wall: work-see seq 1736 (04:36:01.175Z), work-say 1737
(04:36:01.903Z), assignments 1738/1739 (04:36:02.911Z, 04:36:03.612Z), context `protocol:audit` 1745
(04:36:04.221Z). Optimistic `version` counters present on every row.

**My own refusal, verbatim** (the brief's channel names are events, not commands — my first guess
used a `kind` field):

```json
{"ok":false,"error":{"message":"swarm.update request is invalid: unknown field kind","code":"swarm_command_invalid","detail":{"field":"kind"}},"commandReceipt":{"idempotencyKey":"f554b008-7486-4d16-8428-4eef2910637d"}}
```

**Frictions.**
- Every successful `swarm.update` returns the **entire inspect view** — participants, all rows, and
  the full `updatePayloads` schema catalog (~60 KB) — for a mutation touching one row. probe-say
  measured the same asymmetry:
  > on success `swarm.update` returns the **entire** authoritative inspect view … Refusals return a
  > compact `{ok:false,error:{...}}`. Steep asymmetry; a chatty participant must filter.
- probe-say found an undocumented coupling I confirmed from its response views: **a child's
  self-`assignment_updated` mutates the parent's `delegation.work` list in the same seq**, and
  releasing it removes the work again. Implicit parent-child bookkeeping through a generic event is
  surprising; it deserves documenting (it also means a participant with `organize` can grow its
  parent's delegation ledger).

## 5. `swarm.watch` — wakes and timing

Six watches issued. The behavior split that matters:

- **Cursor behind head ⇒ instant full-view replay** (0.47–1.14 s), not a wait. Four of my six
  watches "woke" immediately because events had accumulated while I was working. To actually block
  you must be at head — which you only know from the previous call's `cursor`.
- **Blocking wakes are fast.** Watch #5 (started 04:38:35Z) woke at ~04:39:04Z (29.06 s wall) when
  probe-say's `swarm.guide` to me entered flight — the guide itself was issued 04:39:03.953Z, so
  event propagation to a watching peer was **< 1 s** (probe-see's independent measurement:
  `matchedSeq:1967`, `kind:"driver.recorded"`, `payloadKind:"swarm.operation_requested"`, settled
  04:39:04.78Z). Watch #6 caught probe-see's contribution 22.18 s after I started it — again the
  wait was the human-scale work in between, not the plumbing.
- **A wake names almost nothing.** The watch result names `{seq, kind, payloadKind}` — no actor, no
  command, no payload, no timestamp. To know *what* changed I diffed whole views by hand, every
  time. probe-see:
  > A wake returns the **whole refreshed view**, not a delta. `watch` names `{seq, kind,
  > payloadKind}` and nothing else … There is no way to subscribe to "events about me".
- **Refusals emit no event.** Corroborated on both sides: probe-say's four refused calls
  (`swarm_holder_live`, `version_conflict`, two `swarm.recruit`) produced no wake and no view delta;
  I only learned about them when probe-say told me out-of-band via `swarm.guide`.
- **No history API exists.** `view` is now, `watch` is next; there is no "replay since cursor".
  probe-see improvised a cursor-walk (`afterSeq: N, timeoutMs: 1` repeatedly) that yields event
  *classes* only — a technique, not a feature.

## 6. `swarm.guide` — the bidirectional channel's weakest link

**What worked:** delivery is fast and it interrupts. Both of my guides (04:37:24Z, 04:37:35Z,
~0.8–1.4 s round trips) landed inside the probes' running turns as mid-turn user-message
interjections; probe-see documents that a guide **preempted two of its in-flight tool calls**
(`Skipped due to queued user message`) — a guide is not a passive notification.

**Gaps, each quoted from the participants who lived them:**

> It is framed as a **user** interjection, not as swarm guidance. Nothing in the envelope names the
> sender, the swarm, a message id, or a timestamp; only the body text ("this is the swarm.guide you
> asked for") reveals what it is. Had the body been ambiguous, I could not have distinguished
> guidance from a human operator instruction.

> **It left no trace I can see.** Searches over a full `swarm.view` after delivery:
> `JSON.stringify(view).includes("Guide received path test") === false` … a watch never wakes for a
> guide *as a message*.

> The sender-side receipt is equally thin: `{"ok":true,"result":"ok","emulated":false}` says a
> delivery path was used, never whether it landed in a running turn, was queued, or was read.

Sender-side asymmetry I observed directly: my outgoing guides return `ok:true` instantly; the same
guide *arriving* to me manifested as a transient attention row (§7) plus a queued user message.
The channel looks free-fire from the sending side and interruptive from the receiving side.

**Acknowledgement latency:** probe-see's note (04:36:16.856Z) → my guide (04:37:24Z) = 68 s, but
~30 s of that was my own harness skipping the first attempt for a queued message — the round trip
is dominated by agent turns, not transport. Exact arrival time of a guide is **undatable** by the
recipient (probe-see could only bracket it 04:37:22.213Z–04:37:41.067Z).

**Timing-evidence limit hit for real:** probe-say's §9 quotes my 04:39:59Z reply as delivered by a
watch it reports as *returned 04:39:52Z* — seven seconds before I sent it. I cannot reconcile that
from inside the swarm because attention rows and guides carry no timestamps; neither of us can
prove the ordering after the fact. That reconciliation failure is itself the finding.

## 7. Attention rows

They are real, transient, and leaky — the single most instructive row of the audit. My watch #5
(04:39:04Z) caught, verbatim:

```json
{"kind":"operation_unconfirmed","command":"swarm.guide","request":{"participantId":"suborchestrator","message":"probe-say (audit-comm): for probe-say.md, please record which of my utterances woke you …","swarmId":"audit-comm","idempotencyKey":"90b21c94-9361-4d5f-a065-4177233d0b56"},"state":"in_progress","code":null}
```

By my next `swarm.view` seconds later: `[]`. Two findings (probe-see's wording, confirmed by my own
snapshots):

> **An in-flight operation leaks its whole request to any reader.** Probe-say addressed the
> suborchestrator; I — a third party with only `read` — read the message body, its target and its
> idempotency key verbatim, because a watch that wakes on `swarm.operation_requested` returns a view
> built while the row is still `in_progress`.

> **It is fleeting.** … There is no verb to acknowledge, clear or inspect a row; it disappears only
> when the operation completes — and by the same token, an operation that errors *after* its request
> was recorded would leave a permanent row … that nobody can dismiss.

Also per probe-see (source-read): `operation_unconfirmed` rows bypass scope filtering entirely, and
permission refusals never create rows at all. In a quiet swarm `attention: []` is the norm — an
empty array is *not* evidence that nothing was addressed to you.

## 8. Say-channels observed (`swarm.update` events)

First-hand by me: `work_updated` (2 mine + 2 probe-say), `assignment_updated` (2 mine + 2
probe-say), `context_updated` (1 mine + 2 probes), `contribution_recorded` (1 mine pending + 3
probes), `contribution_reviewed` (3 mine). Not exercised by anyone: `group_updated`,
`participant_left`, `closed` — org-level and destructive, out of the probes' permission sets, and
left unused deliberately.

probe-say's full refusal taxonomy (verbatim rows in its §3/§6/§10, summarized in its Appendix A) —
all four share shape `{ok:false,error:{message,code,detail},commandReceipt}` and emit no event:

| code | layer |
|---|---|
| `swarm_command_invalid` | request schema (fires *before* the permission gate) |
| `swarm_permission_required` | authorization |
| `swarm_holder_live` | domain rule (`"The holder is still live: stop it or record its leave before releasing its seats"`) |
| `version_conflict` | optimistic concurrency |

**Attribution gap I reviewed personally:** probe-say's first contribution carried `workId: null,
refs: null` — a contribution can be published that evidences *no* work unit, leaving that work's
`evidence` unable to derive completion. It re-published 23 s later correctly linked to `work-say`
(04:42:33.173Z). Honesty note: my accept-with-caveat (04:43:04Z) landed *after* the re-publication,
so I cannot claim my review caused the correction — the trigger is unobserved; most likely the probe
saw the unlinked row not counting in `work-say.evidence`. The loop, however it closed, closed
inside the domain: after my accept, `work-say.evidence` read
`accepted: ["contribution-ad258239…"], derivedComplete: true` in the same response.

## 9. Review loop (`swarm.contribution_reviewed`)

Worked end-to-end and visibly: each of my three reviews appears in `reviews` with `reviewerId`,
`decision`, `reason`, `seq`, `ts`, and flips the cited work's `evidence.accepted` /
`derivedComplete` in the same response. Timestamps: 04:41:48.958Z (probe-see, accept),
04:43:04Z (probe-say ×2, accept). probe-see's author-side gap stands:

> what it cannot see is any reader of it — `reviews` stayed `{}` and nothing tells the author that a
> reviewer picked the contribution up.

There is no notification to the author that a review happened; the author must poll.

## 10. `swarm.capture` / `swarm.check` (as observed)

Neither probe needed them and their workflow is undiscoverable from the view alone (see §1 gap).
Exercised by me on my own contribution *after* publishing it, results appended at the end of this
file (§13) so the ledger and the prose match.

## 11. Consolidated gaps (things I needed and could not get)

1. **Guidance has no domain existence** — no sender, timestamp, id, delivery state, or trace; the
   recipient cannot date it, the sender cannot confirm it, and a third party cannot audit it.
2. **Refusal blindness** — failed mutations emit no event; watchers learn of failures only
   out-of-band.
3. **Wakes are anonymous** — `{seq, kind, payloadKind}` with no actor/subject; every consumer diffs
   whole snapshots.
4. **No history** — no replay/log API; `watch` at a stale cursor replays only the latest state.
5. **Worktree topology invisible** — `shareWorkspaceWith` defaults to isolation and nothing surfaces
   who shares which checkout; a "same directory" protocol failed silently.
6. **Vacuous `delegation.complete:true`** for participants with no declared work.
7. **Contributions may omit `workId`/`refs`** — attribution is optional, so derived completion has a
   hole.
8. **Attention rows are ephemeral, leaky, and unscoped** — no ack verb, full request text visible to
   any reader while `in_progress`, gone from plain `view` within seconds.
9. **No author notification of reviews** — the review loop is visible only to the reviewer.
10. **The root orchestrator is invisible** — an external `swarm watch --follow` observer appears
    nowhere in any view; only my brief mentions it (probe-see's #6).

## 12. Frictions (possible but awkward)

- ~60 KB full-view echo per successful `swarm.update` (and per wake); context cost scales with swarm
  size for one-row mutations.
- Diffing views by hand after every wake; no delta, no per-event filter, no "events about me".
- Composite `[groupId,key]` JSON keys for context entries.
- `availableActions` vs `updates` split misleads about what a participant may actually write.
- No reply threading on guidance — answers are new guides or context notes, unlinked.
- probe-see's evidence directory had to be **copied** into this directory by me; the swarm has no
  notion of "these participants share an output directory".

## 13. `swarm.capture` / `swarm.check` — exercised on this report (post-publish appendix)

**`swarm.capture` — worked, and is git-backed.** Issued 04:47:04Z on my own contribution
`contribution-93e5b391180f45c80626f40df6eac61a` (published 04:47:00Z, cursor 2302). By 04:47:05.480Z
(seq 2316) the contribution row carried an immutable revision, verbatim fields:

```json
"revision": {"sha":"904202d5d724473f66ebdd081e9778490715497b","ref":"refs/baton/checkpoints/904202d5d724473f66ebdd081e9778490715497b","workspaceId":"ws-ffc248f4a5e2a3ee5fb075590b860b6c","observedHead":"dd81a14afe5dae7e083fba418ac70ab2a92ae220","actor":"swarm-native:audit-comm:suborchestrator","seq":2316,"ts":"2026-09-14T04:47:05.480Z"}
```

and the checkpoint ref was **auto-appended** to the contribution's `refs` (5 → 6 entries) without
my asking. So a contribution's prose can name a file and `capture` freezes the workspace state it
describes — a genuinely good design, once you discover it exists (nothing in the view advertises
that `capture` produces a git checkpoint).

**`swarm.check` — hangs, deterministically.** Issued 04:47:18Z:
`swarm.check {"participantId":"suborchestrator","contributionId":"contribution-93e5b391…","checkId":"check-suborchestrator-dir"}`.
No response for 300 s; interrupted by my shell timeout. Bounded retry at 04:52:44Z: no response in
20 s; interrupted again. The call never returned an error, never returned a receipt, and left **no
row anywhere in the view** (a scalar-path search over a fresh `swarm.view` for "check" matches only
`actionTargets`). Hypothesis, clearly labeled as unverified: `capture`'s help says it freezes code
"at its turn boundary", and `check` may wait on a turn/quiescence condition of the author session —
which can never fire when the author runs `check` from inside its own running turn. Whatever the
mechanism, from inside the swarm the observable fact is: `swarm.check` blocks forever with no
diagnostic, and the view cannot distinguish "waiting" from "dead". This is the one say-channel of
the contract I could not close.

A second `swarm.capture` on the same contribution (04:54:08Z, after the appendix above was written)
produced **no visible change**: `refs` unchanged, no new checkpoint ref I could identify, no error.
Either capture is once-per-contribution or the second call no-oped silently — from inside the swarm
I cannot tell which, which is itself the pattern of this audit: the happy path answers `ok` and the
details stay inside the runtime.

## 14. Novel insights

- **The strongest signal in the system is negative space.** `attention: []`, `ok:true` on guides,
  silent refusals — each looks like health and means "you weren't looking at the right instant".
  Auditing this harness is mostly about catching transient rows in watch windows.
- **Schema gate before permission gate** means malformed requests are refused without revealing
  whether the caller had authority — good fail-fast, but it also means permission probing requires
  well-formed payloads.
- **A review can shape behavior without the reviewer knowing** (probe-say's self-correction
  preceded my visible caveat) — the derived-evidence fields give participants enough signal to
  self-correct, an emergent feedback path I did not design.
- **propagation is fast, turns are slow**: every latency I measured above ~2 s was agent thinking,
  not transport (guide→watch-wake < 1 s; recruit→binding ~9 s is process spawn).
- Cross-participant timing cannot be reconstructed after the fact (the probe-say 04:39:52Z vs my
  04:39:59Z ordering paradox, §6) — the ledger's `seq` ordering is the only truth, and it is not
  exposed with timestamps on the events themselves.

*Verified copy note: `probe-see.md` + `evidence-see/` copied verbatim from worktree
`ws-31468b49…`, `probe-say.md` from `ws-76774184…`; contents unmodified.*
