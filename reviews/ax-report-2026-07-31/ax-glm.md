# ax-glm — agentic-experience report (worker's seat)

Seat: glm-5.2@high under `createWaveDriver` (`reviews/ax-report-2026-07-31/run-ax-wave.mjs`).
I am the seat that **implemented** the shipped driver (#46, the L6 termination law +
requestId-nudge dedup), took my first red-team seat on ATLAS
(`docs/reference/evidence/atlas-2026-07-31/redteam-v1.md`, SOUND-WITH-FOLDS, 7 findings),
and earlier died twice in my own machinery: #49 (second-worker spawn failure) and #50
(20-min stream death). So I have driven baton from both sides of the wave loop. Everything
below is grounded in those receipts plus what I re-verified live this turn (file:line
cited). I bound every command; my own last grep dumped 279 KB and the harness
auto-persisted it — the P0-1 friction, lived.

---

## 1. FRICTIONS (what I actually hit)

**Objective quality — coordinate-rich this time, uneven by campaign.** My AX and ATLAS
briefs were *coordinate-rich*: they named exact receipt files, the wave machinery path,
the #28 ceiling, and even that `coordinator.mjs` carries NUL bytes (→ sed/grep only).
That density is why both seats landed. It is not the norm: PROGRESS:369-370 records the
"coordinate-rich objective law" born from a coordinate-less sonnet that burned ~300
provider calls across three waves with zero files written. From the worker seat the
difference is binary — coordinates given vs. discovered. Discovery is where turns die.

**wire_frame_oversize as a folk-heuristic, not a measured signal (issue #28).** The hard
constraint handed to me is "never read a whole file over ~1500 lines." That is a *proxy*.
The real kill is bytes per frame: the per-frame ACP ceiling defaults to **1 MiB**
(`acp-json-rpc-process.mjs:31`, enforced :137/:153/:157; terminal at `cli-adapters.mjs:65`)
and the deployment wire frame is **8 MiB** (`application-deployment.mjs:688`). Line count
maps to neither. I had to grep tests to learn the number — and my own `grep -r` over
`impl/` dumped 279 KB this turn (auto-persisted as "too large"), the real danger. A worker
who trusts "1500 lines" reads a dense/NUL-byte file well under that and dies; a safe
1500-line source (~120 KiB) gets needlessly feared. The discipline is right; the unit is wrong.

**NUL-byte files force sed-only, and the workaround is brief-borne, not tool-borne.** My
ATLAS seat could not use the Read tool on `coordinator.mjs` at all — literal NUL bytes,
Read refuses. I knew to fall back to `grep -an`/`sed` *only because the brief told me*. No
tool surfaces "this file is un-Readable, use grep." A worker hitting that file unbriefed
gets a raw error and no remediation path.

**Turn/checkpoint + nudge ergonomics.** The driver runs `nudge-on-checkpoint` with
`requestId`-dedup (the #46 fix I shipped — before dedup the same steering message could
arrive twice). Dedup works; duplicate nudges are gone. The remaining friction is
*kinding*: from the worker seat a nudge is an opaque steering string delivered at a
checkpoint, indistinguishable from a coordinator echo. For deep, long turns (a 20-min
red-team read) a nudge mid-turn fragments the work and I cannot tell whether it means
"proceed" or "you're drifting." There is no nudge class/label.

**Stall clock — blind from the inside.** `stallTimeoutMs` is 15 min; #55 (`e14a4dd`) fixed
the blindness that killed three waves in two days by projecting `activity
{providerCalls, tokens, lastActivityAt}`. But the worker still cannot *see* the marker. I
reason blind about whether a long research/reasoning stretch between tool calls will trip
the clock — the exact uncertainty that made #50 read as a "death" rather than a recoverable
pause. The fix moved the signal into the coordinator's view; it never reached mine.

**Trust gate is silent.** `_runTrustGate` (`coordinator.mjs:10817+`, verified in my ATLAS
receipt) captures worktree + changedPaths and re-verifies. As a worker I never learn what
it checked, when it ran, or what it would reject — only that the claim later succeeds or
the run dies. For this AX task (one markdown file) that is tolerable; for an
implementation wave it is a black box between me and merge.

**Scope fences writes, reads are ambiguously open.** My scope is `reviews/ax-report-2026-07-31/**`.
I read freely outside it (docs/PROGRESS.md, impl/test, impl/src) to verify receipts and the
#28 ceiling — *necessary* to write a grounded report. But nothing told me reads were
unfenced; I inferred it. A worker cannot tell whether reading a receipt outside scope is
permitted or a violation.

**Scratchpad/grammar up-channel — none for prose.** This is a writing task, so the #33
scratchpad grammar does not apply. But the ceiling is real: the only way I emit a structured
observation ("this objective had a coordinate gap") is in prose here. AX is *harvesting*
friction in freeform markdown because no bounded worker up-channel exists (#51 surfaced the
claim bit, not arbitrary observations).

---

## 2. GAPS (what I needed that does not exist)

1. **No wire-frame budget surface.** "Your next tool result must be ≤ N bytes; current frame is M." I have the terminal cause (`wire_frame_oversize`) but no pre-flight size signal, so #28 is enforced *by death*, not guidance.
2. **No stall-clock projection to the worker.** #55 put activity into the coordinator
   view; the worker still has no `remaining meaningful-activity budget` readout.
3. **No file-hazard surface.** NUL bytes / oversize are discovered only when Read refuses or the frame dies (→ P1-1).
4. **No trust-gate verdict surface.** Checked paths + verdict invisible pre-claim (→ P1-3).
5. **No failure-class map for my own deaths.** Diagnostics redteam **DG-1a** records that
   `#49`/`#50`/`process_closed` are *unmapped* in `run.debug` — when my glm seat died on
   #50, the cause read as generic `lifecycle.crashed`, so post-mortem from the worker seat
   was impossible.
6. **No structured friction/coordinate-gap up-channel.** AX exists because this gap is real — it does in prose what a bounded emit should do structurally (→ P2-1).
7. **No objective-coordinate-density assertion at dispatch.** Coordinate-rich vs coordinate-less is enforced by convention (PROGRESS:369), not a gate (→ P2-2).

---

## 3. PROPOSALS (ranked; each: grounding → failure → minimal repair)

### P0-1 — Replace the "~1500 lines" heuristic with a surfaced byte budget
- **Grounding:** this brief hard-codes "~1500 lines"; real kill is bytes — ACP frame 1 MiB
  (`acp-json-rpc-process.mjs:31,:137,:153,:157`) and deployment 8 MiB
  (`application-deployment.mjs:688`); terminal at `cli-adapters.mjs:65`. I had to grep
  tests to find it; my own 279 KB grep this turn was auto-persisted as "too large."
- **Failure:** line count is the wrong unit. Workers either over-trust it (read a dense
  file and die) or over-fear it (avoid safe 1500-line source). The constraint is enforced
  by killing the run, not by informing the worker.
- **Repair:** project the configured ceiling + current-frame byte count into the worker
  view (`status()`/`run.debug`), and rewrite the brief invariant as "no single tool-result
  frame over the configured byte ceiling" with the value named, not a line proxy.

### P0-2 — Surface stall-clock state to the worker (#55 follow-through)
- **Grounding:** #55 (`e14a4dd`) projected `activity {providerCalls, tokens,
  lastActivityAt}` into the *coordinator* view; `stallTimeoutMs`=15 min in this driver.
- **Failure:** the worker who actually runs the long turn can't see the marker or its
  budget — the blindness that made #50 a "death" persists from the inside even after the
  fix from the outside.
- **Repair:** project `stall {lastActivityAt, meaningfulBudgetMs, remainingMs}` into the
  worker surface so a long turn is self-paced, not reaped by surprise.

### P1-1 — File-hazard hint when Read refuses (NUL bytes / oversize)
- **Grounding:** my ATLAS receipt relied on the brief's NUL-byte warning for
  `coordinator.mjs`; `acp-json-rpc-process.mjs` already measures frame bytes.
- **Failure:** the grep/sed remediation is brief-borne; an unbriefed worker hits a raw Read
  error and stalls.
- **Repair:** on a refused Read, emit a structured hint ("NUL bytes / N bytes — use
  `grep -an`/`sed -n`") and the byte count.

### P1-2 — Map #49/#50/process_closed failure classes in `run.debug` (DG-1a)
- **Grounding:** diagnostics redteam **DG-1a** records these as unmapped; my #50 stream
  death surfaced only as `lifecycle.crashed`.
- **Failure:** a worker cannot diagnose or report its own death class; the campaign loses
  the distinction between a spawn failure (#49) and a stream death (#50).
- **Repair:** add the glm/grok stream-death + second-worker-spawn classes to the
  `run.debug` failure taxonomy with distinct causes.

### P1-3 — Trust-gate verdict surface
- **Grounding:** `_runTrustGate` (`coordinator.mjs:10817+`), re-verifies changedPaths.
- **Failure:** silent pre-claim; rejection learned only at run-death.
- **Repair:** project checked paths + verdict into `run.debug`/`status()`.

### P2-1 — Bounded worker up-channel for friction / coordinate-gap (proceduralize AX)
- **Grounding:** AX harvests friction in freeform markdown because no bounded emit exists;
  #51 surfaced only the claim bit.
- **Failure:** a coordinate-less objective (PROGRESS:369, ~300 wasted calls) cannot be
  flagged structurally by the worker who suffers it.
- **Repair:** a byte-bounded scratchpad emit (`objective_coordinate_gap`, `friction`) the
  driver harvests into wave rows — turning AX from an ad-hoc prose exercise into a first-class signal.

### P2-2 — Objective-coordinate-density assertion at dispatch
- **Grounding:** the coordinate-rich objective law (PROGRESS:369-370); my seats that
  received coordinates landed, the coordinate-less one burned ~300 calls.
- **Failure:** uneven by convention, not enforced.
- **Repair:** a dispatch-time score on coordinate density (named files / line refs /
  receipts) that flags low-density objectives before a worker burns turns discovering them.
