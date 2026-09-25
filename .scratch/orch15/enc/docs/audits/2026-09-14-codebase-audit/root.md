# Deep codebase audit — root synthesis (2026-09-14)

Audited tree: master `f2ea904c` ("Guidance frames name their sender and time"). Root: Claude Fable 5.1,
operating Baton from the main checkout. Method: four read-only reading agents (Claude Opus 5) each took
one slice of `impl/src` and wrote a slice report with file:line evidence; the root re-read the cited
lines for every item ranked below, marked each **CONFIRMED** (root read the code and agrees),
**PLAUSIBLE** (consistent with the code, not exercised) or **CORRECTED** (the slice overstates or
misreads), added its own findings from operating Baton during the audit (the `R-` items), and
decided a disposition per item. Two coupled audit swarms (`audit-a`, GLM lead with DeepSeek workers;
`audit-b`, DeepSeek lead with GLM workers) ran the same brief on the main resident at the same commit;
their reports and the comparison are in [`swarm-a/`](swarm-a/), [`swarm-b/`](swarm-b/) and
§8 below.

Slice reports, unedited: [giants.md](giants.md) (coordinator, store, custody, verification —
46 items), [adapters.md](adapters.md) (harness sessions and briefs — 43 items),
[swarm.md](swarm.md) (swarm runtime and surface — 44 items), [surfaces.md](surfaces.md)
(application, CLI, MCP, web — see §7). Item references below use the slice prefix:
`G-17` is giants item 17, `A-E1` adapters error 1, `S-F1` swarm friction 1, `U-…` surfaces, `R-…` root.

---

## 1. Headline

Baton's biggest defects are not missing features. They are **places where the harness produces a
confident wrong answer**, and **places where a correct abstraction exists and nothing makes it the
only way to express the fact**. Twelve findings decide the ranking; every one was confirmed at the
cited line by the root.

| # | Finding | Status | Disposition |
|---|---|---|---|
| 1 | The referee's ENOENT shell fallback is dead: the first child's `close` listener settles the promise with `-2` before the shell child runs, so a command whose first token is not on the deployment PATH is a **candidate failure** (`verification_exit_mismatch`), blamed on the worker (G-18, `referee.mjs:184`) | CONFIRMED | root fix, this session |
| 2 | `tokenize` matches the **last** quote in the whole command, so two quoted arguments become one mangled token; the receipt says one command ran and another did (G-19, `referee.mjs:114`) | CONFIRMED | root fix, this session |
| 3 | OMP children are spawned without `detached`, so the reap latch names a process group that does not exist, `kill(-pid, 0)` returns ESRCH and Baton publishes **`kill.confirmed` for a group it never had**; OMP `kill()` sends SIGTERM with no escalation (A-E1, `omp-rpc.mjs:169`) | CONFIRMED | lane `process-truth` |
| 4 | A trust-gate failure, including the cleanup error the gate deliberately rethrows, lands in `.catch(noop)`: the task keeps whatever state the gate reached, with no receipt (G-27, `coordinator.mjs:13606`) | CONFIRMED | lane `silent-failures` |
| 5 | `reapRunScratchpads` is a synchronous `do/while` with no deadline and no progress assertion, on the run-stop path where every other deadline is converging (G-24, `coordinator.mjs:12302`) | CONFIRMED | lane `drain-convergence` |
| 6 | Drain convergence gates success on every worker in the fleet but attempts only the frozen target set; the terminal throw carries no `waitingOn`; a durable non-terminal task with no handle spins to the deadline; a deadline hit at admission latches `_drainState` shut (G-20/21/22/2, `coordinator.mjs:2974, 3016, 1847, 1749`) | CONFIRMED | lane `drain-convergence` |
| 7 | The Claude-family session worker gets the weaker brief dialect: no write-authority, no repository-mutation denial, no ambient knowledge, no output format (A-F1, `cli-adapters.mjs:99-115` vs `adapter.mjs:132-174`); and **no renderer lists the tools** the brief tells the worker to restrict itself to (A-F2) | CONFIRMED | lane `brief-and-tools` |
| 8 | Re-recruiting an existing participant with an identical payload is a **silent no-op that returns a success receipt**, because the content-addressed idempotency key short-circuits before the fold's `participant_duplicate` guard (S-E1/E2/N2, `swarm-runtime.mjs:687`, `coordination-store.mjs:12822`) | CONFIRMED | root fix, this session |
| 9 | `swarm.watch` and `inspect` copy the whole coordination ledger on every call while the store already exposes the cursor form (S-E3, `swarm-runtime.mjs:348, 472`) | CONFIRMED | root fix, this session |
| 10 | Four adapters answer an idle interrupt with `{ok:true}` and no terminal flag, so a routine stop waits out the entire stop deadline (A-E2, `codex-appserver.mjs:1047`, `grok-acp.mjs:909`, `kimi-acp.mjs:646`, `claude-session.mjs:1476`) | CONFIRMED | lane `stop-shape` |
| 11 | `wait()` discards prose-only digests and the next call acks past them: worker messages and turn summaries vanish from the digest surface (G-17, `coordinator.mjs:13022, 13110`); the application layer builds its views elsewhere, so the loss is confined to the public digest API | CONFIRMED, impact narrowed | root fix, this session |
| 12 | `defaultVerificationConcurrency` gives a two-core machine two concurrent suites, contradicting its own docstring (G-29, `referee.mjs:47`; the root's own #269 code) | CONFIRMED | root fix, this session |

Two findings the root **corrected**:

- A-G2 says OMP's missing `turnCompletion` means an OMP turn "is never parked as a steerable
  checkpoint". The card is indeed missing the field and the default is `'claim'`, but
  `_turnCompletionOf` (`coordinator.mjs:3296`) answers `'pausable'` for any swarm participant run
  before it reads the card, which is why the root watched OMP participants sit at `turn: paused` in
  three live swarms during this audit. The consequence holds for ordinary (non-swarm) OMP runs only;
  the liveness-probe exclusion (`route-liveness.mjs:37`) holds always. Disposition: the
  `process-truth` lane completes the card with `turnCompletion: 'pausable'` and the eight verbs, and
  adds the ordinary-run pause test the slice's reading implies is missing.
- G-17's blast radius: `wait()`'s digest is consumed by the coordinator's direct callers and
  tests; `application.mjs` calls `coordinator.wait(100)` purely as a change-sleep and never reads
  the digest (`application.mjs:4055, 8190`). The bug is real for the public API and fixed; nothing
  in the resident flows loses a message through it.

---

## 2. Cross-cutting insights

These are the observations the root would not have reached from any one slice.

**2.1 The right helper exists and nothing makes it the only way.** `eventsView()` with no argument
"copies the world", says the store's own comment, and it offers `eventsView(fromSeq)` and
`eventCursor()` for exactly this reason (`coordination-store.mjs:8500`). The coordinator calls the
zero-argument form at four sites, three of them per peer message (G-38/45); the swarm runtime at two
more, once per watch iteration (S-E3). `isPhysicalWorkspaceId` is imported and used twice while
fifteen inline copies of its regex decide whether a checkout may be destroyed (G-36). `UPDATE_PERMISSIONS`
is a third table over a closed vocabulary that has load-time parity assertions for the other two
tables and none for itself (S-E10). Two brief renderers carry different authority text (A-F1).
Three spellings of "this participant is alive" (S-F5). Baton's own repair pattern for this, used in
`surface-gate.mjs` and `swarm-contract.mjs`, is a load-time or gate-time assertion that the
derivation is the only source. Every item in this family is fixed the same way: one assertion or
lint row per fact, so the next inline copy fails the gate instead of drifting.

**2.2 Honesty about the provider, silence about Baton.** The adapter layer flags every emulated verb,
every observation gap and every unavailable usage seal (A-N6). It records nothing when Baton itself
disables the vendor sandbox (A-G8), drops a process generation on auth refresh (A-E3), re-sends a
non-idempotent `session/new` after a timeout (A-E4), or advertises a frame ceiling it does not
enforce (A-E10). The same asymmetry produces the two false confirmations in this audit: OMP's
`kill.confirmed` (A-E1) and the referee's candidate-blamed ENOENT (G-18). The rule that follows:
**a harness action that changes what the provider can promise is itself a fact for the card or the
ledger**, with the same discipline the cards already apply to the provider.

**2.3 Silence is a statement.** An absent card field is a behavior (A-N2). A `.catch(noop)` on an
operation is indistinguishable from one on an observation — 77 sites in `coordinator.mjs` alone
(G-46), and the three that matter (`_runTrustGate`, `_beginStop`, `_cleanupClosedTransport`) discard
the outcome of the operation itself. A reap that exhausts its attempt count says "deadline" (G-30). A
failed spill mint truncates attention while the docstring above it says it never truncates (G-25). A
failed progress preservation cancels the stall reap and leaves nothing that can fire (G-26). The
`bestEffort(promise, reason)` helper G-46 proposes costs nothing at runtime and makes the dangerous
class countable; the root adopts it as the shape for the `silent-failures` lane.

**2.4 Deadline machinery assumes a responsive loop that three paths take away.** Every stop, drain and
watchdog bound is a timer racing an operation. `Atomics.wait` in the capacity lock
(`worktree-capacity.mjs:233`), the scratchpad reap spin (G-24) and whole-ledger replay in `_load`
(`coordination-replay.mjs:234`) block that loop for multi-second or unbounded stretches, after which
`_forceStop` durably records `stop_unconfirmed` against a child that answered (G-43). The root adds a
fourth resource of the same kind from this audit: the orchestrator's **attention**. The `--follow`
wake feed on `audit-a` woke once per `native.subagent_observed` row, hundreds of times in minutes
(R-2); the root's own monitor was throttled and then killed by its harness. The cause is a hand-kept
exclusion list: `watch()` skips `content.tool_call`, `route.observed` and `resource.*` telemetry
(`swarm-runtime.mjs:476-478`) and the later-added `native.subagent_observed` and `content.message`
payload kinds never joined it, the §2.1 pattern again. A wake feed that wakes on everything is a
blocked loop for whoever watches it.

**2.5 Legitimacy and gaps live in different systems.** 449 expected-red rows encode "known broken"
for 47 files; the swarm slice has zero rows while five swarm issues are open (S-G2, S-N1). The
unified control grammar does not contain the word "swarm" (S-G1). The seam inventory does not see
`SwarmRuntime` (S-G4). And the suite verdict itself is machine-local: a clone-hosted worker reported
25 unexpected failures the root could not reproduce from the worker's stated cause (R-1). Green means
"nothing regressed on this machine", and nothing in the verdict says which machine or why a row is
red. The `legibility` lane and a reason-per-row manifest (S-I6) are the repair.

**2.6 Content-addressed idempotency keys make fold guards dead code.** `recordSwarm` returns the
prior event on a key match before folding (`coordination-store.mjs:12822`). Every write whose key
derives from the payload's own identity therefore never reaches the fold's uniqueness check:
`participant_duplicate`, `contribution_duplicate` (S-N2). The guards read as defence in depth and are
neither reached nor tested. This generalizes the #267 finding that allocation had to move to
replayed ids: **whenever a key is derived from identity, the identity check must happen before the
key lookup, in the runtime, as a typed refusal.**

**2.7 What a participant structurally cannot know (the agentic-experience lens).** Its budget
(required on every brief, rendered nowhere, enforced nowhere — A-F3). Which Baton tools it holds
(instructed to use only advertised tools; no list — A-F2). That the hub re-runs its verification
(only `renderPrompt` says so — A-N4). Whether its guide was delivered (no receipt, no view row —
S-G6; a guide to a paused participant records no `message.sent` at all — R-3). That its refusal was
seen by anyone (S-G7). That `availableActions` includes a command most of whose payloads it may not
send (S-F1). That its ordinary prose is scanned by six control grammars (A-G6). That the root exists
until the root comments, at which point it appears as a full-authority member (S-N3). Every one of
these is a fact Baton holds and does not tell. The remedy is not more prose in the brief; it is the
view and the receipt: a `## Tools` section derived from `brief.tools`, a `guide` row returned by
`swarm.guide`, a durable `swarm.operation_refused` row, `updates` beside `availableActions`.

---

## 3. Frictions (consolidated)

Things an agent or operator must know or do that the code could do for them.

- **Verification blames the worker for the harness's PATH** (G-18) and **runs a different command than
  the receipt says** (G-19). Fixed at the root, see §5.
- **Drain capacity is derived from a unit mismatch** (`timeoutMs / 4` interactions) and cannot be set
  (G-1); a drain that trips its deadline at admission latches the fleet shut with `coordinator_closed`
  (G-2); terminal resource release is refused during a drain (G-3). Lane `drain-convergence`.
- **A crashed check poisons its identity and the remedy is a code comment** (G-4); **a capacity policy
  change bricks the ledger without naming the file** (G-5); **`pinBaseSha` parks work in a stash under a
  moving name** (G-6); **archived replay reports zero progress** (G-7). Lane `custody-and-capacity`.
- **Two brief dialects, the weaker one on the busiest tier; no tool list; a mandatory unrendered
  budget; a write-authority paragraph pointing at a section that may not exist; typed refusals on some
  adapters and prose on others; peer-messaging availability invisible on the card; three payload
  shapes under `resource.tokens`; `terminal: true` meaning two things** (A-F1…F8). Lanes
  `brief-and-tools` and `stop-shape`.
- **`availableActions` promises `swarm.update` to a read-only participant** (S-F1); **every view ships
  every payload schema and example** (S-F2, 30–60 KB per echo); **every brief is world-readable**
  (S-F3); **the `--follow` feed projects on the wrong side of the wire** (S-F4); **`swarm.create`
  reuses a membership refusal** (S-F6); **a watch interrupted by close returns the store's word**
  (S-F7); **`swarm.list` filters silently** (S-F8); **`actionTargets` is emitted for unavailable
  actions** (S-F9). Lane `swarm-view-projection`.
- **R-1 Verification parity is machine-local.** The two clone-hosted residents ran without the
  machine-local credential files the main checkout has. The projections worker on `tight-271`
  reported 25 unexpected failures in its checkout and attributed them to the missing file. The
  root's probe (a scratch worktree of the clone, `phase78` with and without the key at the worktree
  root) showed the credential-dependent rows there are already expected-red and unaffected by the
  key, so the attribution is unproven and the remaining rows need the A/B against pristine master
  the root uses for #257. Friction: **a worker cannot tell an environmental red from its own**, and the
  verdict has no environment dimension. Fixed operationally (files copied to both clones); the
  verdict-side fix is the reason-per-row manifest (S-I6).
- **R-2 The wake feed wakes on native-subagent telemetry** (#272's "one wake per semantic row",
  confirmed at scale). **R-3 A guide to a paused participant rides `nudgeTurn`, which records no
  `message.sent` receipt**, so the new `guide` row on `swarm.guide` is `null` for the most common
  case (reported by the `tight-271` projections worker; #273 runtime side).
- **R-6 A tool call in flight disarms the stall detector with no bound and no attention row**
  (G-16, confirmed live). The `tight-271` lead (GLM) requested an `eval` tool call at 05:54:32Z and
  its worker log has no event since: for the 95 minutes this synthesis took, the swarm view said
  `state: working, turn: running`, the contribution it was recruited to review sat unreviewed, the
  watchdog re-armed on `turnInFlight` every cycle, and nothing anywhere named the wait. Baton
  records only the tool name for a native call, so the root cannot even see what the call is. The
  root took over the review; the lane's report records the takeover. Recorded on #265 and #291.

## 4. Gaps

- The trust gate does not run during a drain and no receipt says verification was skipped (G-8).
  Verification cleanup failure is recorded and ignored (G-9). `runCommand` has no output bound while
  its sibling does (G-10); coverage and mutation runs ignore the abort signal (G-11) and one timeout
  is spent four times (G-12); `accept()` ignores `expectExit` (G-15). Lane `referee-runtime`.
- The operational log has no archival and every worker log is read in full at construction (G-13);
  segment compaction buys layout, not startup time (G-14); nothing bounds `turnInFlight` (G-16). Issue
  only: design work, not a lane.
- `kill()` can never report "unconfirmed" (A-G3); Claude's in-flight control requests are never
  settled on close (A-G4); frames after a settled turn are dropped without trace (A-G5); six control
  grammars scan prose with no capability gate (A-G6) and the spoof-safety claim is narrower than
  stated (A-G7); Baton writes a config that disables the vendor sandbox and the card says
  "unverified" (A-G8); `credentialMechanism` ignores projected trees (A-G9); the legacy adapter tier
  publishes cards no gate can consume (A-G10). Lanes `process-truth` and `legibility`.
- The control grammar has no swarm section (S-G1); the manifest has no swarm rows (S-G2) and one
  63.8 KB `-red` file with none (S-G3); the seam inventory does not see `SwarmRuntime` (S-G4); scoped
  view does not scope `context` (S-G5); guidance has no domain existence (S-G6); refusals leave no
  trace (S-G7); `_worker` and `_workerFor` disagree (S-G8); un-completion is ungated (S-G9); one
  failure policy exists (S-G10); contributions are unbound strings (S-G11) and the string shortcut
  cannot carry `workId` (S-G12). Lanes `legibility` and `swarm-view-projection`; S-G6 is #273, S-G7
  is #271 W2 (in flight on `tight-271`).

## 5. Errors — verified at the root

| Ref | Where | Verdict |
|---|---|---|
| G-17 | `coordinator.mjs:13022, 13110` | CONFIRMED; impact narrowed to the digest API |
| G-18 | `referee.mjs:184` | CONFIRMED (the slice ran it; the root read the listener wiring) |
| G-19 | `referee.mjs:114` | CONFIRMED |
| G-20/21/22/23 | `coordinator.mjs:2974, 3016, 1847, 1964` | CONFIRMED |
| G-24 | `coordinator.mjs:12302` | CONFIRMED |
| G-25/26/27 | `coordinator.mjs:4280, 9753, 13606` | CONFIRMED |
| G-29 | `referee.mjs:47` | CONFIRMED (cores=2 → 2 lanes) |
| G-36 | fifteen inline `ws-` regex copies | CONFIRMED by grep |
| A-E1 | `omp-rpc.mjs:169` | CONFIRMED (`{cwd, env, stdio}` only; latch built on `child.pid`) |
| A-E2 | four adapters | CONFIRMED (coordinator finalizes only on `terminal === true` or the event, `coordinator.mjs:8619, 10253`) |
| A-F1/F2 | `cli-adapters.mjs:110-117` | CONFIRMED (Goal, Dispatch, Immutable Context only) |
| A-G1/G2 | `omp-rpc.mjs:416-467` | card gap CONFIRMED; runtime consequence CORRECTED (§1) |
| S-F1 | `swarm-runtime.mjs:371-374` | CONFIRMED |
| S-E1/E2 | `swarm-runtime.mjs:687`, `coordination-store.mjs:12822` | CONFIRMED by reading; test added with the fix |
| S-E3 | `swarm-runtime.mjs:348, 472` | CONFIRMED |
| S-E6 | `swarm-runtime.mjs:352, 360` | CONFIRMED (live capture in the 09-14 communication audit) |
| S-N3 | `swarm-runtime.mjs:626-630` | CONFIRMED (all seven permissions, no parent) |

Errors the root did not re-execute and carries as PLAUSIBLE: G-28, G-30…G-35, A-E3…E19, S-E4, S-E5,
S-E7…E10. Each is in its lane's objective with the instruction to reproduce before changing.

## 6. Improvements the root adopts as lane shapes

1. `bestEffort(promise, reason)` for the observational catches; the three operational catches get
   receipts (G-46, G-25/26/27).
2. One brief renderer with a dialect tag and a `## Tools` section derived from `brief.tools`; budget
   rendered as the notify-only evidence it is (A-I1, A-I2, A-F3).
3. One idle-interrupt shape: the event form (`control.interrupt_confirmed`), because D9 says a
   confirmed stop is always an event (A-I3); `terminal: true` gets one meaning (A-F8).
4. `detached: true` and SIGKILL escalation for OMP; `cwd` for the Codex app-server child; drain
   Claude's pending control requests on close; per-turn Kimi crash latch (A-I5, A-I7, A-I8).
5. A projection argument on `inspect` — a shape selector, never a size cap (S-I3); `updates` beside
   `availableActions` and the SDK text that says which is which (S-I1); `_worker` delegating to
   `_workerFor` (S-I7).
6. A reason per expected-red row, swarm rows for the open swarm gaps, `SwarmRuntime` in the seam
   inventory, a swarm section in the control grammar (S-I6, S-G1…G4).
7. `eventsView(seq, 1)` and `waveClosure()` where the coordinator scans (G-37, G-38); a per-worker
   attention index (G-39); a fast path for `tick()` (G-40).
8. The magic ceilings in §G-41 replaced by derivations, configuration or notify-only signals, per
   the repository rule; `Atomics.wait` off the main thread (G-42).
9. `maxBuffer` on every git call that can exceed 1 MB, from one derivation (G-32).

## 7. Surfaces slice (application, CLI, MCP, web)

The surfaces reading agent delivered 64 items ([surfaces.md](surfaces.md)): 20 errors, 10 gaps,
15 frictions, 12 improvements, 7 insights, probing the live registry, the web validator, the CLI
parser and the documented MCP stdio entry point as a real subprocess. This is the slice the
user's stance makes primary (MCP as the agentic use-surface), and it carries the audit's most
severe operational findings. Root verification at the cited lines:

| Ref | Finding | Verdict | Disposition |
|---|---|---|---|
| U-E4 | `deployment.doctor {check:true}` and the dot spelling of the scratchpad append reach `undefined.has` in the envelope validator; `execute` is awaited bare in `handle()`, so the rejection is unhandled and **ends `baton serve` for every agent** (`web-northbound.mjs:118-120, 183-219, 604-605, 1697`) | CONFIRMED | **root fix, this session**: `DEPLOYMENT_ARG_FIELDS` spread, the append's dot spelling derived through the direct-port map, a load-time completeness assertion over every admitted command, and one failure boundary returning `500 command_dispatch_failed` |
| U-E1 | the descriptor principal has no `expiresAt`, so `_authority` refuses every call `unauthenticated`; the documented quickstart is dead (`mcp-descriptor.mjs:185-188`, `mcp-northbound.mjs:1611`) | CONFIRMED | #287 |
| U-E6 | `run.scratchpad.append` is bridge-admitted and refused by the CLI hand-list (`application-cli.mjs:30-49`); the #270 gate facade admits 132 names where production admits 49 (U-N4) — a correction to the root's own gate work | CONFIRMED | #289 |
| U-E10 | `MAX_RUN_LIST_ITEMS = 64` refuses `runs.list` forever past 64 runs with no cursor; `MAX_RUN_VIEW_WORKERS = 1_024`, `MAX_ATTENTION = 64` (`application.mjs:59-61`) — the repository's no-arbitrary-limits rule, violated on the primary read path | CONFIRMED | #289 |
| U-E8 | an unrecognized `baton run <verb>` starts a provider Run named after the verb — the one finding that spends money on a wrong guess | PLAUSIBLE (parser probe by the slice) | #289 |
| U-E2, U-E3, U-E5, U-E7, U-G1…G10 | advertised-uncallable tools, the duplicate canonical key, invalid pre-filled `action.do` envelopes, an unfollowable episode continuation, the missing ordinary run-lifecycle tools | PLAUSIBLE (live probes by the slice) | #287, #289 |
| U-E12…E14, U-F9, U-F10 | resident close asserts leases before withdrawing the publication; a dead resident is reported as a network problem; `baton doctor` swallows the drift refusal | PLAUSIBLE; the root hit U-F10 live during this audit (below) | #288 |
| U-F1, U-F2, U-N6 | MCP validator refusals are bare codes; `cliError` never sets `wireSafe`; the refusal quality the operator wants exists in four places and is never generalized | CONFIRMED (`mcp-northbound.mjs:1707`, `application-cli.mjs:66`) | #288 |
| U-N1, U-N3, U-N5 | the parity assertion compares the registry to itself; the surface gate probes a raw server no entry point ships; five hand-maintained lists claim to be one registry | CONFIRMED by reading | #289 |

**R-5 (root, live).** While this synthesis was being written, `baton swarm check` for the
`flaky-257` contribution returned `cli_transport_failed: Baton Web connection failed; check your
network and retry` over a Unix socket while the resident was alive and the check it had accepted was
running in its verify sandbox. A long verification over the CLI's blocking call outlives the
transport's request timeout and is reported as a network fault (U-F10's wording, U-F3's inversion);
the honest shape is a receipt and a watch, which the runtime already has
(`contribution.check_queued` / `check_started` / `check_completed`). Recorded on #288.

The surfaces slice changes the audit's ranking: three of the twelve headline findings in §1 would
now be joined by U-E4 (a resident-killing crash, fixed), U-E1 (a dead documented entry point) and
U-E8 (a wrong guess that costs money). §2.1's pattern is this slice's root cause too: U-N5's five
lists are the same disease as the fifteen inline regex copies, and U-N1/U-N3 are the gate that
cannot see it.

## 8. The coupled audit swarms: comparison and contrast

Two swarms were recruited on the main resident at 06:27Z with the same brief: audit the same three
slices (giants, surfaces, swarm) under declared coupling and synthesize. `audit-a`: GLM lead
(`zai/glm-5.3-flash`), DeepSeek workers, all three workers in the lead's checkout under an
exclusive-writer record. `audit-b`: DeepSeek lead (`deepseek/deepseek-flash`), GLM workers, one shared
checkout for the three workers, the lead apart. Their reports: [swarm-a/](swarm-a/) (lead 24 KB,
workers 31/20/29 KB) and [swarm-b/](swarm-b/) (lead 22 KB, workers 15/19/21 KB). Timeline: both
created 06:27Z; `audit-a` synthesis 06:56Z (~30 min); `audit-b` synthesis 07:17Z (50 min), of which
13 min was one rework of a transcription error the lead caught by comparing the written file's md5
with the reviewed contribution body.

**8.1 What the swarms found that the reading agents did not.** Fourteen findings, most of them
either live-observed on the machinery the swarms were running on, or reached by executing code
rather than reading it:

- *Durable before validate, nobody owns repair* (swarm-a #1, executed end to end): the coordination
  store appends to disk before it folds, replay re-applies with no catch, and the pass-through writers
  (`recordDriver`, the audit writers) have no validator, so one malformed event makes every later write
  refuse and restart throw. The same posture in the capacity ledger and the worker log. Filed as #290.
- *Evidence fields asserted by non-observations* (swarm-a #2): `signaled: true` unconditionally, a
  `reaped` count from a loop that reaps nothing, `redGreen` from a timed-out base, a checkpoint marked
  corrupt by a size heuristic. The rule swarm-a's giants wrote — an evidence field may only be set by
  the observation that names it — is the sharpest sentence in either report. Filed as #291.
- *A pause record stuck in `resolving` hangs every later turn* (swarm-a #4) and *nothing sweeps the
  stall cycle* (swarm-b #2); *one malformed adapter frame wedges a task and its teardown* (swarm-a #8);
  *the fate clock is dead in three adapters and alive in one* (swarm-b #10). All #291.
- *`holder_released` deadlocks behind any departed member's group seat* — found independently by both
  swarms (a #10, b #4), one by folding the exact sequence. #290.
- *The writer coupling's guard was inert for the first writer* (swarm-b #5): observable only live,
  because it depends on a freshly recruited holder having no recorded `workspaceId`. *Re-declaring a
  synchronization point wipes arrivals; `releasedBy` names the wrong party; arrivals carry no
  timestamp; the barrier is hidden from members whose subtree does not own the group; the printed
  retry key wedges `guide`/`stop`; the bridge hangs up on an over-cap streamed body.* #292.
- *The route table an operator routes from is stale and readiness is derived twice* (swarm-b #3). #293.
- *The surface gate's green is not evidence of wiring* (swarm-a #5): any typed refusal counts as a
  resolved path, the coordinator mock is a total proxy, 28 of 131 tools are "resolved" only by
  refusal. This corrects the root's own #270 gate work and joins U-N3/U-N4 on #289.
- *`--write-expected-red` rewrites all 449 manifest rows from a partial run* (swarm-a, second tier). #290.
- *The referee's unbounded capture, measured*: a `yes` verifier produced 522 MB captured and ~1.5 GB
  hub RSS (swarm-a #3) — G-10 with a number on it.

**8.2 What the reading agents found that neither swarm did.** The reading agents were systematic
where the swarms were opportunistic: the fifteen inline custody regexes (G-36), the four zero-argument
`eventsView()` sites in the coordinator (G-38), the 77 silent catches (G-46), the drain convergence
trio (G-20/21/22), the two brief dialects and the unlisted tools (A-F1/F2), the five hand-maintained
registry lists (U-N5), and — decisive for the MCP-primary stance — the dead descriptor entry point
(U-E1) and the resident-killing validator crash (U-E4). Neither swarm probed the web validator, the
descriptor path, or the MCP tool tables at all; their `surfaces` workers read the deployment and CLI
layers instead. Neither swarm found the OMP process-group defect (A-E1) or the idle-interrupt
deadline burn (A-E2).

**8.3 Where all three agreed.** The referee tokenizer (G-19; both swarms executed it), the ENOENT
fallback (G-18; swarm-a), `availableActions` lying to a participant (S-F1; both swarms lived it), the
wake storm on native-subagent telemetry with the same exclusion list at `swarm-runtime.mjs:476-478`
(R-2; both leads measured it: 15 wakes in 5 s, 10 in 5 s), the external auto-enrol with all seven
permissions (S-N3; swarm-b), the check recorded as a `comment` (S-E7; both), and the runner's `kill
EPERM` crash (R-4; swarm-a's first verification run died on it). Three independent routes to the same
lines is the strongest evidence in this audit.

**8.4 How the two swarms differed from each other.** `audit-a`'s lead synthesized rules (the
evidence-by-observation rule, "durable first, validate always, nobody owns repair") and ran the
deployment verification twice, hitting the runner crash and then an environmental RED it attributed
correctly. `audit-b`'s lead was stronger on the coupling record itself — worker-authored arrivals,
seven writer versions with reasons, md5-bound artifacts, timings to the second, refusals verbatim — and
did not run the suite because the objective said not to, recording that the dispatch gives no
precedence rule between an objective constraint and the verification contract (a real gap; the
lead's honesty about it is the finding). `audit-a` guided a worker that had arrived without
contributing; `audit-b` guided a fidelity fix. In both, coupling informed and never gated: both leads
serialized writes through guides and the record documented it. `audit-b`'s workers took 16, 21 and
31 minutes; `audit-a`'s 7 to 19. GLM-led review latency was 36 s to 5 min, DeepSeek-led at most 40 s.

**8.5 What the comparison says about the method.** Reading agents with a whole slice and no tool
budget find the structural, enumerable defects; coupled swarms running on the system under audit find
the defects that only show up live, and they find them in the runtime they are standing on. Neither
replaces the other, and the overlap set (8.3) is what to fix first. The cost asymmetry is real: the
swarms consumed roughly 33,000 ledger events, nearly all `evidence.mapped` telemetry (swarm-a's own
measurement), for 20 findings; the four reading agents produced 197 items with no ledger at all. The
swarms' distinctive product is not the item count but the lived coupling record (§8.1, #292) and the
executed reproductions.

## 9. Fixed during the audit (root, this session)

Listed with their commits once landed: G-18, G-19, G-29 (`referee.mjs`); G-17 (`coordinator.mjs`);
S-E1/E2 typed `swarm_participant_exists`, S-E3 cursor reads, S-E10 parity assertion
(`swarm-runtime.mjs`); R-4 the suite runner no longer dies on `EPERM` from its own group signal
(`run-suite.mjs`); U-E4 the web validator's field tables are complete, asserted at load, and the
northbound entry has a failure boundary (`web-northbound.mjs`). Operational: credential files
placed in both clone roots (R-1).

## 10. Issues and lanes

Filed from this audit, one per lane bundle, each listing its items by slice reference:

| Lane | Issue | Items |
|---|---|---|
| `drain-convergence` | #277 | G-1, G-2, G-3, G-20, G-21, G-22, G-23, G-24, G-28 |
| `silent-failures` | #278 | G-25, G-26, G-27, G-46, G-9, G-34, G-30 |
| `referee-runtime` | #279 | G-10, G-11, G-12, G-15 |
| `brief-and-tools` | #280 | A-F1, A-F2, A-F3, A-F4, A-N4, A-I1, A-I2 |
| `process-truth` | #281 | A-E1, A-E3, A-E7, A-E10, A-E11, A-G1, A-G2, A-G3, A-G4, A-I5, A-I6, A-I7, A-N1 |
| `stop-shape` | #282 | A-E2, A-F8, A-I3, A-E5, A-E6, A-I8, A-E4 |
| `swarm-view-projection` | #283 | S-F1, S-F2, S-F4…F9, S-G5, S-G8, S-G9, S-G12, S-E4…E7, S-E9, S-I1, S-I3, S-I7 |
| `legibility` | #284 | S-G1, S-G2, S-G3, S-G4, S-I6, S-N1, A-G10, R-1 |
| `custody-and-capacity` | #285 | G-32, G-6, G-5, G-35, G-33, G-4, G-7, G-13, G-14, G-42 |
| `store-hygiene` | #286 | G-36, G-37, G-38, G-39, G-40, G-41, G-31, G-45 |
| `mcp-entry-points` | #287 | U-E1, U-E2, U-E9, U-E11, U-E17, U-E18, U-G1, U-G2, U-G3, U-G10, U-N7 |
| `web-and-refusals` | #288 | U-E12…E16, U-E19, U-F1…F4, U-F9…F14, U-I1, U-I2, U-I10…I12, U-N6, R-5 |
| `registry-truth` | #289 | U-E3, U-E5…E8, U-E10, U-E20, U-G4…G9, U-F5…F8, U-F15, U-I3…I9, U-N1…N5; swarm-a #5 |
| `store-durability` | #290 | swarm-a #1, #10, second tier (`--write-expected-red`); swarm-b #4, #8 |
| `evidence-by-observation` | #291 | swarm-a #2, #4, #8; swarm-b #2, #9, #10 |
| `coupling-truth` | #292 | swarm-b #5, #7, #9, §3, §4; swarm-a #7, #9, 'what did not' |
| `route-truth` | #293 | swarm-b #3; swarm-a #7 |

R-2 is recorded on #272 (the wake-class filter), R-3 on #273 (guide receipts on the paused path),
S-E6 on #272, S-E7 on #269 item 2, S-G6 on #273 and S-G7 on #271. Items already in flight before
the audit keep their issues: #265 (stop convergence with native children), #268, #271, #272, #273,
#274, #276.
