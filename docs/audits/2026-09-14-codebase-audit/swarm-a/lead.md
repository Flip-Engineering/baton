# swarm audit-a — lead synthesis (2026-09-14)

Lead: `lead` (participant, swarm `audit-a`). Workers: `giants`, `surfaces`, `swarm` — one report each
in this directory ([giants.md](giants.md), [surfaces.md](surfaces.md), [swarm.md](swarm.md)), all read
in full by the lead and accepted after independent spot-verification of their highest-impact claims.
This file is the synthesis: the ten findings that matter most across the three reports and the lead's
own live seat, what the declared coupling did and did not do, the refusals observed (verbatim), and
the timings. Nothing in `impl/` was modified by anyone in this swarm (verified: `git status --porcelain
-- impl/` empty; `impl/src/mcp-northbound.mjs` sha256 matches the digest surfaces disclosed after its
in-place probes).

## The ten findings that matter most

Ordered by the audit's priorities: silent failures, non-converging waits, the harness misreporting its
own state, then participant/orchestrator experience. "Verified" = the lead re-checked the cited code
or ran the probe's claim path itself, not just read the worker's report.

1. **One refused fold permanently bricks the coordination store — validation happens after the durable
   append.** `coordination-store.mjs:1497-1507`: `_appendFile` (durable) runs *before*
   `try { this._apply(event); } catch (error) { throw this._poisonProjection(event, error); }`; replay
   re-applies the same event through the same fold with no catch (`coordination-replay.mjs:279`), so a
   malformed payload that reaches one pass-through writer (`recordMcpAudit`/`recordWebAudit`
   `coordination-store.mjs:11913-11919`, `recordDriver` `:12605-12611` — no validator, unlike
   `recordSwarm` `:12816-12818`) makes every later write refuse `coordination_projection_poisoned` and
   makes restart itself throw. Giants reproduced the full arc (wave roster poison → second append
   refused → reopen refuses `wave_registry_invalid`). The sibling failures share one posture giants
   names precisely: "durable first, validate always, nobody owns repair" — the capacity ledger writes
   unvalidated and reads strict (`worktree-capacity.mjs:568-577` vs `:304-327`, bricking every
   deployment sharing the repo), a torn worker-log line bricks read *and* append for that worker with
   no repair verb (`log.mjs:99-103`), and a wedged coordination directory is hand-repair-only.
   **Fix:** run the fold's validators (or a prospective fold, the `recordSwarm` precedent) before
   `_appendFile`; add a supported quarantine/repair verb so no single event can make a store
   unreplayable; let readers and `startupStatus()` see `_projectionPoison`.

2. **Evidence fields are asserted by anything *except* the observation they name — the certificates
   lie.** Five independent sites, each converting a non-observation into a positive fact:
   `redGreen: true` derived from a timed-out base run (`referee.mjs:350-351`, verified: `baseExit =
   baseRun.timedOut ? null : baseRun.exitCode` makes `null !== expectExit` pass the hardening gate);
   `signaled: true` returned unconditionally, including when no signal was sent and even on `EPERM`
   (`process-lifecycle.mjs:263-264`) — which the coordinator then publishes as durable signal
   authority (`coordinator.mjs:1878-1883, 1907-1926`); `{reaped: N}` from a loop that mutates nothing
   (`coordination-replay.mjs:1016-1020`, verified: `if (Date.parse(pack.validity) <= now) reaped += 1`
   — no reclamation exists); `checkpoint: 'corrupt'` from a size heuristic that rejects compact()'s own
   valid checkpoint (`coordination-store.mjs:1037`, giants probe: identical store flips valid→corrupt
   with `beforeSeq` 2 vs 1991); `outcome: candidate_failed` from the referee's dead ENOENT fallback
   settling before the replacement child runs (`referee.mjs:184-194`). **Fix (giants' rule, adopt it
   literally):** an evidence field may only be set by the observation that names it; a give-up needs its
   own reason, never the name of an observation that did not happen.

3. **The referee's verdict is a fact about mangled argv and unbounded capture, not about the
   candidate.** Two runners disagree about the verification contract: the legacy string path is
   hand-tokenized with a greedy `lastIndexOf` quote rule that merges two same-quote arguments
   (`referee.mjs:113-118`; giants probe: `sh -c` exits 0, referee reports `observedExit: 1`,
   `passed: false`), pushes every chunk into memory with `outputExceeded` hardcoded false
   (`:179-180`, `:159-166`; giants probe: `yes` verifier → 522 MB captured, ~1.5 GB RSS in the hub),
   has no cancellation signal and no post-run re-check for `coverageCommand`/`mutationCommand`
   (`:360, :385`), while the argv path bounds capture (`:227-228, 255-271`) but dies untyped without
   `envAllowlist` (`:218-219`) and computes `NaN` bounds without `maxOutputBytes` (`:227-228`). The
   worker is shown `Execution mode: legacy shell command` (`verification-presentation.mjs:29-30`) and
   pastes a command that behaves differently from the gate that graded it. **Fix:** one runner —
   delete/await the ENOENT fallback, drop the greedy tokenizer (the presentation already promises shell
   semantics), same capture bound and signal handling on both paths, require `envAllowlist`/
   `maxOutputBytes` up front with a typed refusal.

4. **A pause record stuck in `resolving` hangs every later turn on it, forever, invisibly.**
   `coordinator.mjs:2492-2497` awaits `record.resolvingDone`, resolvable only by `rollback`/`commit`
   (`:2509-2519`) — no timer, no `finally`, no repair; any throw between reservation and commit
   strands it (giants measured `claimTurn`/`nudgeTurn` timing out with no timer of their own), while
   `pausedTurns()` filters by `pausedTurnStatus` and skips exactly the wedged rows
   (`:2313-2326`) — the authoritative layer says wedged, the presented layer says fine. Related: a
   plain `mode:'turn'` send to a paused member bypasses the checkpoint and orphans a fresh pause record
   that can never settle (`:8046-8065`, `:2237-2250`, `:2524-2529`), reachable from `fleet_send`
   (`mcp-northbound.mjs:2272`) with no new code. **Fix:** settle pause records in a `finally` and
   re-check task/handle terminality after every await (the `_dispatch` precedent `:4032-4033`); gate
   the turn lane on the pause like `continueParticipant` does.

5. **The surface gate's green is not evidence of wiring.** The gate accepts any typed refusal as a
   "resolved path" (`impl/scripts/surface-gate.mjs:148-154`, verified verbatim:
   `continue; // any other typed refusal is a resolved path`) while `mcp-northbound.mjs:395` maps
   internal faults — including `TypeError` — into the same `invalid_command` lane (surfaces' mutation
   probe: an unwired tool returns exactly the unwired-name signature and the gate stays green); the
   probe's coordinator is a total proxy that answers every property with `ok: true`
   (`surface-gate.mjs:91-96`, verified; surfaces' probe rewrote all 29 coordinator call sites to
   nonexistent methods with 0 of 131 classifications changing); the application mock lacks
   `actionAuthority`, so three headline verbs are "proven" by a refusal the mock itself caused
   (`:83-90`). 28 of 131 advertised tools (21%) are classified as resolved *only* via typed refusal.
   **Fix (surfaces' items 19-21):** treat `invalid_command`/`application_unavailable` as findings; make
   the coordinator mock throw on unknown properties; derive the application mock from the real class's
   prototype.

6. **Watch wakes drown the follower: routine telemetry wakes, and the wake names no subject.** The
   exclusion list covers only `content.tool_call`/`route.observed`/`resource.*` under
   `evidence.mapped`/`driver.recorded` (`swarm-runtime.mjs:476-478`, verified by the lead) — so
   `native.subagent_observed` and `content.message` wake every watcher (the latter reproduced by the
   swarm worker driving the real `_watch`; `content.message` is in the repo's own noise set,
   `application.mjs:88`, and in the operational set that matches, `coordinator.mjs:61`). The lead lived
   it: 15 wakes in 5 seconds, all `evidence.mapped/native.subagent_observed`, zero coordination
   content, during ordinary worker research — docs/39:160 states routine tool/usage events do not wake
   watchers; the code corrects only a subset (the doc-vs-code drift surfaces at
   `docs/39:160-161` vs `swarm-runtime.mjs:476-478`). And a wake carries `{seq, kind, payloadKind}`
   only (`:488-489`), so every follower re-reads the whole view per wake — which is itself a
   full-ledger copy per iteration (`:472` `eventsView()` with no args, vs the store's own #227 note
   `coordination-store.mjs:8500-8505`; same pattern for per-view operation scans `:348-349` and
   per-participant log copies `:261-262`). **Fix:** one shared "not a milestone" set
   (`application.mjs:88` already owns half of it); let `swarm.watch` take an event-class filter;
   attach the acting participant and changed coordinate to `watch.event`; read the tail
   (`eventsView(cursor + 1)`), not the world.

7. **The advertised surface misleads its own agents.** `availableActions` lists `swarm.update` to a
   contribute-only participant while the real per-event whitelist is the separate `updates` field
   (`swarm-runtime.mjs:371-374`, `:448-450`; the swarm worker's own live view is the evidence); the
   guidance text shipped to every native participant names a verb that does not exist — "shown by
   inspect" (`swarm-native-access.mjs:56`; there is no `swarm.inspect` in
   `SWARM_COMMAND_DEFINITIONS`, `swarm-contract.mjs:39-111`); and `impl/CLI.md:220-229`'s Fleet-routes
   table — the one table an operator routes work from — sits outside every generated byte-checked
   block (`render-surface-docs.mjs:151-154`) and names `glm`/`deepseek` as harnesses while the served
   registry is `codex/kimi-code/grok/claude-code/omp` over omp routes
   (`application-deployment.mjs:2207`, `:100-112`; surfaces printed the served table to confirm). An
   agent that trusts either list spends a turn learning the truth by refusal. **Fix:** advertise the
   intersection (`availableActions` ∩ per-event permission) or drop `swarm.update` from the coarse
   list; one-word doc fix (`inspect` → `view`); generate the fleet table as a third `TARGETS` entry.

8. **One malformed adapter frame wedges a task and its teardown.** `question.asked`/
   `approval.requested` use `payload?.requestId` with no type check (`coordinator.mjs:13953-14000`;
   the decision branch one case later does check, `:14085`), so a frame without it parks the worker
   `blocked` and the task `input_required` under the key `undefined`; `claimInteraction`/
   `interactionStatus` refuse it (`:10595, :10609`), the stop path's resolver is truthiness-gated
   (`:8755-8772`), and `closeAuthority()` then refuses `:1674` — one untrusted frame produces a
   task no one can answer, stop cleanly, or drain (giants reproduced the wedge). **Fix:** validate the
   frame shape at the boundary and refuse typed; make the stop resolver key-based, not truthiness-based.

9. **The bridge hangs up on the exact client error it exists to explain.** An over-cap request body
   streamed without `content-length` is answered with `req.destroy()` before any response
   (`swarm-native-bridge.mjs:94-102`), and the response writer skips dead responses
   (`:109`) — the client gets `ECONNRESET` instead of the typed 413 `swarm_bridge_frame_exceeded` the
   declared-length path delivers (swarm worker reproduced both against a real bridge; the doc claims
   the streamed case is covered, `docs/audits/2026-09-13-runtime-policy/native-swarm-access.md:180`;
   the test file has no chunked case). A participant over the frame cap — easy with a large guide or
   finding — learns nothing. **Fix:** drain, answer the 413, then destroy
   (`res.end(body, () => req.destroy())`); add a chunked transfer-encoding test.

10. **The release operation the runtime's own attention rows recommend cannot run in a reachable
    state.** `swarm.holder_released` prunes only the holder from each group roster
    (`swarm-runtime.mjs:554-565`, verified: `members: group.members.filter((member) => member !==
    holder.participantId)`), proves the batch by trial fold, and the fold refuses any group still
    naming an inactive member (`swarm-state.mjs:435-439`, verified) because `participant_left` never
    touches groups — so with two departed members in one group the batch dies as a raw
    `SwarmIntegrityError` (swarm worker folded the exact sequence: `REFUSED swarm.group_updated ::
    participant_not_active`), and the same ledger's replay re-dies at startup per finding 1. **Fix:**
    prune the roster to currently-active members in the planned event (swarm worker verified the
    filtered batch folds), or convert the trial-fold integrity error into a typed refusal naming the
    group and seat to repair.

**Second tier** (real, verified, not top-ten): phantom `localAuthority` hold after spawn failure
refuses teardown until a second kill (`coordinator.mjs:3781-3782, 4446-4456`); completion evidence
never meets check outcomes — a *failed* check on the completing contribution is invisible because a
check lands as a prose-reason `comment` (`swarm-runtime.mjs:734-738, 174-179, 503-525`); the context
key a writer reads back is the internal composite `[null,"writing:surfaces"]`
(`swarm-state.mjs:116-117`, lead-verified from a live view); `releasedBy` records the caller-named
`participantId`, not the actor, so an organizer's release reads as the worker's own
(`swarm-state.mjs:588`, lead-verified live: lead released, row says `releasedBy: "surfaces"`);
`delegation.complete` is vacuously true for a participant with no work (`swarm-runtime.mjs:233-235`);
`--write-expected-red` rewrites all 449 manifest rows from a partial single-file run
(`run-suite.mjs:398-400` vs the guard one statement later `:406`).

## What the declared coupling did, and did not, do

Declared up front: four units of work (`work-giants`, `work-surfaces`, `work-swarm`,
`work-synthesis` with `dependsOn` all three), one group (`auditors`), one synchronization point
(`reports-in`), one failure policy (`independent`), one exclusive-writer record (`writer-shared`)
operated by the lead because `swarm.coupling_updated` requires `organize`
(`swarm-runtime.mjs:23`) and workers hold `read,communicate,contribute` (arrivals need only
`read`, `:614-616`).

**What worked, end to end.** The dependency machinery is the strongest thing in this runtime: the
three `waitsOn` rows on `work-synthesis` flipped to `settled: true` with named evidence contributions
immediately after the lead's three accepts — completion of the synthesis prerequisite was *derived*,
not asserted, and visible at a glance. `reports-in` gave an honest arrival checklist (arrivals
`surfaces, swarm, giants`; `awaiting` correctly listed live members only). Guidance was delivered
mid-turn and into paused sessions (surfaces processed its correction nudge while paused). Review →
accept → evidence closed the loop: every report landed as a contribution naming its `workId`, and the
lead's accepts are what settled the waits. The failure policy was declared but never exercised (no
member died — nothing to observe there, stated honestly).

**What did not.** (a) The writer record never serialized anything: files were disjoint, sequencing
never contended, and the one worker that finished while no record was held proceeded without it —
correctly, per the documented informs-not-fences rule (docs/39:238-244), and it disclosed the
deviation in its report. "Exclusive writer" is therefore a courtesy label unless participants opt to
honor it; with a shared checkout it recorded intent, nothing more. The one-writer refusal path was
never exercised, so its refusal text is unverified by this run. (b) The record can misattribute: the
lead's release on surfaces' behalf was recorded `releasedBy: "surfaces"`
(`swarm-state.mjs:588` stores the caller-named `participantId`; the true actor is only in the row's
`actor` field) — the "who released" fact docs/39:227 promises is the wrong answer exactly when an
organizer does the releasing, which is the designed case. (c) Operating the writer on workers' behalf
cost round-trips the permission model forces: workers cannot hold the record, so each write needed a
context entry, a lead watch, a declare, and a guide — two workers fell back to the documented
10-minute rule rather than wait. (d) The lead's own writer claim names no checkout
(`workspaceId: null`) because the lead's seat has no workspace row — for a shared-checkout audit the
central record does not name the shared checkout when the organizer holds it. (e) The wake channel
that should have carried all of this delivered 15 wakes per 5 seconds of worker tooling and one
relevant `swarm.contribution_recorded` wake in the whole run (finding 6).

**Refusals observed (verbatim).** The lead authored no refused swarm call this session. Two
worker-seat refusals are on record: the swarm worker's `swarm.watch` with an unknown field —
`swarm_command_invalid: unknown field cursor` (swarm.md, friction 5), which also demonstrates that
refusals leave no durable trace (nothing was appended); and giants' report of `pausedTurns` hiding a
`resolving` record is a refusal-adjacent omission, not a refusal. The writer-refusal and
integrity-refusal paths were never hit in this run (sequencing avoided contention; the
holder-release trap of finding 10 requires a departed-member state this swarm never entered).

## Timings (UTC, 2026-09-14; from bridge receipts and ledger seq/ts)

- 06:27:17 — lead session bound (seq 22). Swarm created empty by the deployment at ~06:27:13.
- ~06:31–06:32 — setup: 4 work items (synthesis with `dependsOn`), 3 recruits (each `shareWorkspaceWith`
  the prior participant; all landed in the lead's checkout `ws-d6262c202b3a35b76082c49d503be24d`),
  group + `reports-in` + `independent` policy + 4 assignments, then 3 guides. All within ~90 s of
  bridge calls; recruits start native runs immediately (workers were `working` within seconds).
- 06:36:34 (seq 9167) — writer declared for `surfaces` after its `writing:surfaces` context entry.
- 06:38:43 — `surfaces` contribution; ~06:38 arrivals[0], turn paused. ~7 min research→report.
- 06:39:19 (seq 18987) — `surfaces` accepted, after one correction nudge: it had arrived *without*
  publishing its contribution (protocol step skipped; the wait would never have settled; the lead
  noticed via watch + a direct view, sent the exact call to run, worker complied while paused).
- 06:43:49 — `swarm` contribution (29.2 KB; wrote without waiting for the writer record, disclosed in
  its report). 06:44:40 accepted; ~06:45 arrived.
- ~06:47 — `giants` requested the writer; declared immediately; guided to write.
- 06:49:34 (seq 32734) — `giants` contribution. 06:50:08 accepted; arrived; writer released.
- 06:50–06:56 — lead synthesis: all three `waitsOn` settled, this file written under the lead's
  writer claim.
- Worker wall-clock: first report ~7 min after recruit, last ~19 min; lead review latency per report
  36 s–5 min (dominated by reading, not mechanics). Ledger grew from cursor 132 at first view to
  >32,700 events by synthesis — nearly all `evidence.mapped` worker telemetry, not swarm events
  (finding 6's cost, measured).

## Review decisions

- `contribution-d7f783207caef750433f7d685a2f8442` (surfaces, work-surfaces) — **accept** 06:39:19.
  Spot-verified: `surface-gate.mjs:91-96` total proxy and `:148-154` refusal lane, verbatim; tree
  verified clean after its disclosed in-place probes (sha256 `4c7cd16e…` unchanged).
- `contribution-4114f439eb6136b40c4e7bd50cab6b0e` (swarm, work-swarm) — **accept** 06:44:40.
  Spot-verified: `content.message` in `RUN_TIMELINE_OPERATIONAL_KINDS` (`coordinator.mjs:61`) vs
  `NOISE_TELEMETRY_OPERATIONAL_KINDS` (`application.mjs:88`) against the `_watch` predicate; unguarded
  `--write-expected-red` (`run-suite.mjs:398-407`); holder-release batch vs fold refusal
  (`swarm-runtime.mjs:554-565`, `swarm-state.mjs:435-439`), all verbatim.
- `contribution-a99dc5897e424a5a41aaa03a2f925e04` (giants, work-giants) — **accept** 06:50:08.
  Spot-verified: `redGreen` from a timed-out base (`referee.mjs:350-351`); durable-append-before-fold
  (`coordination-store.mjs:1497-1507`); `reapExpiredContextPacks` counting without reaping
  (`coordination-replay.mjs:1016-1020`), all verbatim.

No report needed a rejection or a second correction round beyond surfaces' missed contribution step.

## Lead's own seat (observations no single worker file shows)

- The missed-contribution failure mode is structural, not carelessness: arrival (`read`) is easier
  than contribution (`contribute` on the right event shape), and a member can arrive with its work
  never referenced — the sync point settled happily around a hole the dependency view only revealed
  because the lead cross-checked contributions vs arrivals. A view row like
  "arrived but no contribution references their work" would close it.
- `swarm.recruit` returns bare `{participantId, runId, swarmId}` (`swarm-runtime.mjs:700`) while
  create/update return the full inspect view — the lead mis-parsed two recruit responses before
  noticing; membership confirmation requires a second `swarm.view`.
- The participant `role` field carries the recruit's entire objective prose
  (`swarm-runtime.mjs:688`) — every view renders multi-KB prose where a role label belongs.
- Every swarm mutation returns the whole view (swarm friction 3); across this session the lead's own
  calls re-materialized the projection dozens of times for single-field answers.
- Budget: no `resource.budget_threshold` notification was raised during this run.

## Verification

Deployment verification (direct executable and argv, no shell): `node impl/scripts/run-suite.mjs`
from the worktree root, run once after this file and the reports were written — result recorded in
the swarm contribution that names this file. The swarm itself wrote only
`docs/audits/2026-09-14-codebase-audit/swarm-a/{lead,giants,surfaces,swarm}.md`.

### Verification addendum (actual result)

The deployment verification (`node impl/scripts/run-suite.mjs`, direct executable and argv, from the
worktree root) was run twice after this file and the reports were written:

- **Run 1 (~84 s): the runner itself crashed** with an unhandled `Error: kill EPERM` from its own
  process-group reaper (`run-suite.mjs:229 signalGroup → :249 reapProcessGroup → :316 runFile`), mid-lane,
  before any verdict — no suite verdict exists for that run. Giants audited exactly this family
  (its process-lifecycle findings: reap ladders that misreport or escape their contract); here the
  runner's own reap threw uncaught and killed the runner, nondeterministically (run 2 on the identical
  tree completed).
- **Run 2 (~19 min): completed, verdict RED, exit 1** — verbatim: `baton suite verdict: RED —
  4694 passed, 448 expected red (0 of them cancelled by a dangling await earlier in their file),
  41 unexpected failure(s), 1 stale expectation(s), 0 hung, 0 stalled lane(s)`. Of the 41, 14 fail
  with "No provider credential is projected into the worker runtime for this route", several are
  load/timing-shaped in this sandbox (resident publication timeouts, ACP 1000 ms setup timeouts,
  `worktree-capacity-contention` WCC2 "elapsed 268ms"), and one expectation is stale
  (`blind-waits-red` A1-a is now green and should leave the manifest). The swarm wrote only the four
  markdown files in this directory; none of the failing paths is plausibly attributable to them, and
  the honest statement is: the deployment verification does not pass in this environment at HEAD,
  for reasons dominated by missing provider credentials and sandbox timing, plus one runner
  crash on the first attempt.
