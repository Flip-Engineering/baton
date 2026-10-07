# AX report — ax-sonnet worker seat, 2026-07-31

Two campaigns, two very different outcomes. Issue #53 (run.debug accessor) landed — I wrote
the accessor, CLI verb, and client method, and `impl/test/issue53-run-debug-red.test.mjs`
is on disk today. The bidirectional (BD) contract killed me three times in a row with zero
files written before a re-seated grok worker cleared it. This report is written from the
losing seat as much as the winning one — that asymmetry is the most useful data point I have.

## 1. FRICTIONS

**Objective quality — coordinates were the deciding variable, not model or task difficulty.**
The issue #53 objective (`docs/reference/evidence/issue53-run-debug-2026-07-24/run-impl-wave.mjs:34-58`)
pointed me at one 82-line contract file and five named scope files, and I landed it. The
first BD objective (`.../bidirectional-2026-07-31/run-impl-wave.mjs:20-25`) told me to "read
docs/.../bidirectional-decisions.md — the LATEST version section is your authority" against
a 294-line contract carrying a folded v1+v2 with dozens of `coordinator.mjs:NNNN` citations,
and gave `scope: ['impl/**']` — the whole implementation tree. No pre-digested coordinate
list. Per the commit trail (`git log` on `run-impl-a-wave.mjs`, commit `6b8b034`), that first
attempt "researched 15min, 141 tool calls, zero edits — nothing salvageable." The decomposed
BD-A retry (same commit) narrowed scope to rules 1/2/4/5 but still just said "read the v2
section" — no coordinates. My third death (`impl-a2-evidence.json`, role
`bd-a2-implementer-sonnet`) shows the identical shape: `phase: "working"`, `terminal: false`,
`basis: "stall"`, `nudges: []`, `claims: []` — I never even reached a checkpoint before the
stall clock fired. Only the fourth attempt (`run-impl-a-wave.mjs` at HEAD, commit `14668f3`,
re-seated to grok) got an explicit `COORDINATES` paragraph with ~10 `file.mjs:line-range`
citations — and it landed. `docs/PROGRESS.md:369-371` names this exactly: "a coordinate-less
sonnet burned ~300 provider calls across three waves with zero files written." That's me.
From the inside, a dense multi-rule contract with file:line citations sprinkled through prose
reads as a research task, not an implementation task — I spent my budget building a mental
map of `coordinator.mjs`/`application.mjs` instead of writing tests, because nothing told me
where to start cutting.

**wire_frame_oversize discipline** was stated clearly and I never tripped it, but it wasn't
free — `application.mjs`/`coordinator.mjs`/`coordination-store.mjs` contain literal NUL bytes
so the Read tool refuses them outright, forcing every citation-following step through
`grep -n`/`sed` via Bash instead of a normal read. That's an extra tool round-trip per
citation, which matters when the objective hands you a dozen citations to verify before you
can write a single test row. Worth noting the issue #53 objective duplicates its final
paragraph verbatim (`run-impl-wave.mjs:52-57`, "Work ONLY in your scoped files..." appears
twice) — harmless, but it's a sign objective text gets assembled without a dedup pass.

**Turn/checkpoint ergonomics.** The two driver generations I saw differ a lot. Issue #53 used
a hand-rolled loop (`run-impl-wave.mjs:113-156`): 20s poll, nudge on `turn_checkpoint` with a
fixed re-steer message, 20-min stall via status-hash marker, 3h cap. The BD waves used
`createWaveDriver` with `steering: 'nudge-on-checkpoint'`, `finalization: 'claim-on-stall'`,
`stallTimeoutMs: 15*60_000`. On the issue #53 run I never saw a nudge land negatively — I
paused at natural checkpoints and the fixed re-steer text was generic enough not to derail me.
On the BD runs I never got that far: `impl-evidence.json` and `impl-a2-evidence.json` both
show `nudges: []` — the stall clock, not a nudge, ended each attempt. So I can't say nudges
confused me; I can say the checkpoint/nudge machinery never got a chance to help because the
pre-#55-fix stall marker (a pure event-projection digest, per `docs/PROGRESS.md:345-349`)
couldn't distinguish "long unpaused tool-call research" from "stuck," and 15 minutes is not
enough wall-clock to digest a 294-line, multi-file-citation contract AND produce a first edit.

**Scope rules.** Narrow, file-enumerated scope (issue #53: 5 named files) was easier to work
inside confidently than broad glob scope (BD: `impl/**`) — not because of any enforcement
friction, but because a narrow list doubles as an implicit map of "these are the files that
matter," which is exactly the signal the BD objectives were missing elsewhere.

**Scratchpad/grammar lines.** The issue #53 contract pins `code` = `result` for scratchpad
receipts and bans raw internals like `scratchpadFence`/`eventSeq` from the projection
(`issue53-decisions.md:30-37`) — writing the red rows against that (`R53-2`, `R53-4`) was
straightforward because the contract gave the exact object shape to assert against. That
precision is what a coordinate-and-shape-rich contract looks like; the BD contract had the
same rigor in its rules but not translated into a per-worker starting map.

**Trust gate / stall clocks.** I never reached a live decision/pause interaction on either
campaign, so I can't report firsthand friction there — only that the contract text
(`bidirectional-decisions.md:19-32`) is careful that a claim is gate input, never proof, which
reads correctly from a spec standpoint.

## 2. GAPS

- **No worker-visible stall signal.** I had no way to see what the driver's stall marker saw
  about me. Pre-#55-fix, that marker was a pure status-view digest with resource events
  filtered out (`docs/PROGRESS.md:345-349`) — so a long silent research stretch and a genuine
  hang were indistinguishable from the *driver's* side, and completely invisible from *my*
  side. I had no signal telling me "you have N minutes of stall budget left, checkpoint now."
- **No mid-attempt escalation path for a coordinate-less objective.** When an objective is a
  contract-reading assignment instead of a coordinate list, there's no protocol for a worker
  to say "this needs an exploration budget separate from the implementation budget" before the
  stall clock quietly kills the attempt. The fix landed structurally (better objectives on
  retry) but only after three dead attempts — there's no in-run request-more-budget or
  request-coordinates act.
- **No cross-attempt carryover.** Each of my three BD deaths started from a cold worktree with
  zero memory of what the prior attempt had already ruled out. If attempt 1 spent 141 tool
  calls mapping `coordinator.mjs`, none of that map survived into attempt 2's context — the
  next sonnet seat (and the eventual grok seat) re-paid the same reading tax rather than
  inheriting a scratchpad of "already-verified" citations.
- **No worker-side completion confirmation.** The issue #53 evidence (`evidence-impl.json`)
  is a "stray" receipt per its own commit message (`95d50d9`, "stray wave receipts from
  #28/#53 arcs") — `phase: "working"`, `resultSha: null` — even though the work landed (the
  test file and `run.debug` wiring are on disk today, confirmed live via grep). That gap was
  fixed orchestrator-side by the W93 wave-durability work, but from a worker's seat there is
  still no signal distinguishing "my result was harvested" from "the driver detached and lost
  me." I only know #53 landed because I went and grepped for it just now, not because baton
  told me.

## 3. PROPOSALS

**P0 — Treat "read a large multi-rule contract" as a distinct phase with its own budget,
separate from the implementation stall clock.**
Grounding: three sonnet BD deaths, all `basis: "stall"`, all zero edits, all pre-dating any
`turn_checkpoint` (`impl-evidence.json`, `impl-a2-evidence.json`). Failure: a worker handed a
294-line contract with dozens of citations and no digest has to choose between reading
carefully (burns stall budget, dies silently) and skimming (implements the wrong rule).
Minimal repair: this is effectively what the coordinate-rich-objective law
(`docs/PROGRESS.md:369-371`) now does — but codify it as a pre-dispatch lint, not a lesson
re-learned per contract: an objective that references a contract file over ~150 lines should
be required to carry an explicit coordinate list before a wave is allowed to start, the same
shape the successful BD-A3 objective used.

**P0 — Surface the stall marker's own state to the worker.**
Grounding: `impl-evidence.json`/`impl-a2-evidence.json` show the kill was silent from my side
— no nudge, no attention item, just gone. Failure: a worker doing legitimate long-form
research has no way to know it's approaching a stall kill and self-checkpoint to save
progress. Minimal repair: an act or scratchpad convention a worker can use to mark "still
reading, here is my running citation list" that resets the stall clock the way a real edit
would — cheap insurance against exactly the failure mode #55 was filed for.

**P1 — Carry forward a dead attempt's scratchpad into the next attempt's objective.**
Grounding: BD-A → BD-A2 → BD-A3 (grok) each started cold; only the coordinates that a human
(or a red-team) manually re-derived and pasted into the next objective survived. Failure:
redundant exploration cost paid three times for one contract. Minimal repair: when a wave
dies with `basis: "stall"` and zero edits, have the driver harvest whatever the worker did
emit (tool-call file list, partial scratchpad notes) and splice it into the retry objective's
coordinate section automatically, rather than relying on a human to notice and re-author it.

**P1 — Give the worker a durable "did I land" confirmation independent of driver attach
state.**
Grounding: `evidence-impl.json` for issue #53 reads `phase: "working"`/`resultSha: null`
despite the work being verifiably on disk (`impl/test/issue53-run-debug-red.test.mjs` exists,
`run.debug` is wired in `application-client.mjs:1139`, `application-cli.mjs:1032-1532`).
Failure: a worker (or a report like this one) can't distinguish "my result shipped" from "the
driver lost track of me" without manually grepping the tree after the fact. Minimal repair:
independent of the W93 orchestrator-side fix, expose a worker-queryable "was my last commit
harvested" check that doesn't depend on the same wave-attach state that failed here.

**P2 — Dedup objective text before dispatch.**
Grounding: `issue53-run-debug-2026-07-24/run-impl-wave.mjs:52-57` repeats its closing
paragraph verbatim. Failure: harmless here, but it's a canary that objective assembly has no
dedup/lint pass, and a future concatenation bug could silently double a *different*,
contradictory instruction instead of a redundant one. Minimal repair: a cheap
build-time or dispatch-time check that an assembled objective has no duplicate paragraph.
