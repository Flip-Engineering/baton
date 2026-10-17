# Baton todo

The [open GitHub issues](https://github.com/Flip-Engineering/baton/issues?q=is%3Aissue%20is%3Aopen)
retain findings, ownership and acceptance requirements. This page links current
Baton follow-up work for contributors. Every open issue has a link on this page.

## Current delivery work

- [ ] Complete [PR #772](https://github.com/Flip-Engineering/baton/pull/772)
  qualification and adoption. Preserve the failed integrated Main C-generation
  attempt. Qualify the selected compiler, build the complete coordinator, run
  selected target/candidate checks, produce normal macOS and Linux archives,
  verify normal installation and exercise all four native harnesses. Merge,
  publish and adopt the release after its acceptance requirements pass.
  Coordinate [#751](https://github.com/Flip-Engineering/baton/issues/751),
  [#761](https://github.com/Flip-Engineering/baton/issues/761),
  [#771](https://github.com/Flip-Engineering/baton/issues/771) and
  [#747](https://github.com/Flip-Engineering/baton/issues/747).
- [ ] Restore unfinished homelab sessions after reboot through supported
  retained-attempt recovery. Preserve databases, native conversations, input,
  explicit stops, original outcomes and contributor modes. Verify both runner
  accounts, namespaces, retained roots and live ownership before continuation.
  Track persistence in [#703](https://github.com/Flip-Engineering/baton/issues/703),
  custody in [#696](https://github.com/Flip-Engineering/baton/issues/696),
  gone-attempt status in [#712](https://github.com/Flip-Engineering/baton/issues/712)
  and canonical owner election in
  [#787](https://github.com/Flip-Engineering/baton/issues/787).
- [ ] Continue the broad [pure Bend2 rewrite](https://github.com/Flip-Engineering/baton/issues/539)
  through the existing Baton Ensemble and native authors. Review specifications,
  source and independent critique for role SHA-256, installation laws, text
  reads, server framing, filesystem/path/environment operations and build tools.
  Keep SHA-256 logic in Bend2 and add the mechanical byte-read effects it needs.
  Qualify each repaired slice against its selected target, preserving earlier
  failures, then qualify the integrated source. Foreign host effects retain
  their documented IO boundary.
- [ ] Continue the [compiler Branching Ensemble](https://github.com/Flip-Engineering/baton/issues/776)
  using the [branching workflow](https://github.com/Flip-Engineering/baton/issues/751).
  Review source changes, compiler correctness, representative output parity,
  retained-state behavior and exact distribution identity before selecting a
  compiler for the next complete build. Qualify object reuse with cold and warm
  inputs; keep fixture measurements scoped to their actual entries.
- [ ] Deliver the required [Bend2 REPL](https://github.com/Flip-Engineering/baton/issues/778)
  through CLI, MCP and interactive use. Standard archives and installation must
  include the locked compiler, Bun runtime and notices, and check the required
  system C/SQLite prerequisites before activation. Qualify pure and native IO
  with the original source unavailable, Bend2-only parsing, persistent values,
  recovery and two actual Conductor sessions sharing results through
  [#777](https://github.com/Flip-Engineering/baton/issues/777).
- [ ] Complete [ordinary detached delivery](https://github.com/Flip-Engineering/baton/issues/668),
  [Codex input witness](https://github.com/Flip-Engineering/baton/issues/780),
  [subscription cleanup](https://github.com/Flip-Engineering/baton/issues/781)
  and [receive projection recovery](https://github.com/Flip-Engineering/baton/issues/786)
  qualification on the integrated candidate and installed native routes.
- [ ] Finish the [knowledge audit](https://github.com/Flip-Engineering/baton/issues/779)
  and its follow-ups: [coordinator laws](https://github.com/Flip-Engineering/baton/issues/782),
  [scope/direction validation](https://github.com/Flip-Engineering/baton/issues/783),
  [evidence resolution](https://github.com/Flip-Engineering/baton/issues/784) and
  [relation identity](https://github.com/Flip-Engineering/baton/issues/785).
  Preserve actual failed checks and fixture corrections. Complete remaining
  selected paired checks, full public knowledge commands and installed
  acceptance. Retain judged retrieval quality and performance comparisons as
  open audit work.
- [ ] Complete fresh native [knowledge promotion](https://github.com/Flip-Engineering/baton/issues/730)
  and [consumer acceptance](https://github.com/Flip-Engineering/baton/issues/746)
  against the final installed candidate.
- [ ] Expose the operator's configured model choices and capability context in
  [#792](https://github.com/Flip-Engineering/baton/issues/792), coordinated with
  account discovery, availability and
  [subscription fallback](https://github.com/Flip-Engineering/baton/issues/702).
- [ ] Research and implement [account and API-credit tracking](https://github.com/Flip-Engineering/baton/issues/793)
  for multiple configured accounts and native funding routes. Preserve the
  distinction between subscription usage and Console/API-key usage, report
  actual usage and known availability, and qualify fallback with unknown
  balance capability explicitly retained. Coordinate
  [#702](https://github.com/Flip-Engineering/baton/issues/702),
  [#681](https://github.com/Flip-Engineering/baton/issues/681),
  [#694](https://github.com/Flip-Engineering/baton/issues/694),
  [#703](https://github.com/Flip-Engineering/baton/issues/703),
  [#711](https://github.com/Flip-Engineering/baton/issues/711) and
  [#792](https://github.com/Flip-Engineering/baton/issues/792).
- [ ] Consolidate completed branches and PRs under
  [#774](https://github.com/Flip-Engineering/baton/issues/774), preserving active
  worktrees and original evidence. Close issues only against the required
  source, qualification, release and runtime evidence. Preserve the
  [direct output-path acceptance](https://github.com/Flip-Engineering/baton/issues/775).
- [ ] Preserve homelab resource visibility and independent runner work under
  [#677](https://github.com/Flip-Engineering/baton/issues/677). Continue
  [Antigravity harness support](https://github.com/Flip-Engineering/baton/issues/721)
  as tracked product work.

## Completed evidence and remaining acceptance

The published [baton-cli proposal](https://github.com/Flip-Engineering/baton-cli/issues/1)
and its reviewed reports are retained; implementation issues in that repository
remain open. The [knowledge comparison](https://github.com/Flip-Engineering/baton/issues/779#issuecomment-6222094104)
retains its accepted findings and limits. Local disk archival completed its
authorized cleanup scope. These completed activities do not complete the open
product acceptance listed above.

The coordinator law aggregate at `a16fbc5e3` passed its hosted compiler check in
[run 38989564886](https://github.com/Flip-Engineering/baton/actions/runs/38989564886),
with original wait status 0 and empty stderr. This proves the checked aggregate
compiles. Runtime law evaluation, integrated release and installed acceptance
remain open under [#782](https://github.com/Flip-Engineering/baton/issues/782).

## Issue backlog

- [#781: Release blocked and queued subscription reads during unsubscribe](https://github.com/Flip-Engineering/baton/issues/781).
  Give each queued notice its own socket descriptor, retire the subscription
  handle on the IO loop, and shut down the socket before closing it. Qualify
  blocked and queued read completion, natural follower exit, unchanged pending
  input and actual proxy status. Coordinate with
  [#761](https://github.com/Flip-Engineering/baton/issues/761) and
  [#780](https://github.com/Flip-Engineering/baton/issues/780).

- [#780: Keep Codex input witness stdout as one JSON document](https://github.com/Flip-Engineering/baton/issues/780).
  Route the actual proxy cleanup diagnostic to stderr for the witness command.
  Preserve its single complete JSON result, native-turn authority, cleanup wait
  and returned cleanup failures. Qualify complete owned inbox reads and automatic
  handling through the installed public Codex client. Coordinate with
  [#761](https://github.com/Flip-Engineering/baton/issues/761) and
  [#773](https://github.com/Flip-Engineering/baton/issues/773).

- [#779: Audit knowledge graph retrieval and traversal](https://github.com/Flip-Engineering/baton/issues/779).
  Use a Baton Ensemble to review the implemented algorithms and CLI/MCP tools,
  compare project-manager source and deployed behavior, and assess relevant
  primary research. Reproduce representative and adversarial retrieval cases.
  Review ranking, multi-hop traversal, authorization, citations, stale knowledge,
  latency, memory and token use. Retain independent reports, peer critique and
  synthesis, then track and qualify justified fixes. Coordinate with
  [#710](https://github.com/Flip-Engineering/baton/issues/710),
  [#718](https://github.com/Flip-Engineering/baton/issues/718),
  [#720](https://github.com/Flip-Engineering/baton/issues/720),
  [#724](https://github.com/Flip-Engineering/baton/issues/724),
  [#777](https://github.com/Flip-Engineering/baton/issues/777) and
  [#778](https://github.com/Flip-Engineering/baton/issues/778).

- [#778: Add a Bend2 REPL written in Bend2](https://github.com/Flip-Engineering/baton/issues/778).
  Evaluate Bend2 expressions and definitions through CLI, MCP and an interactive
  session. Retain named definitions, results, submitted source and actual
  diagnostics. Preserve Bend2 typing, effects and affine-value semantics, session
  recovery, scoped authority, immutable references and complete failures. Baton
  derives identity and scope and accepts source inline or through stdin. Qualify
  the Bend2 notebook handler, canonical compiler boundary, required compiler/Bun
  dependency closure, retained compiler/native attempts and interactive drafts
  described in [the REPL design](repl.md). Check named definitions reconstructed
  from pure results and import through complete recipient-owned message reads.
  Keep the submitted source and complete process outcomes through original-attempt
  recovery. Remote qualification and
  installed acceptance remain pending. Qualify
  external-agent evaluation, composition, sharing and restart through the
  installed commands. Coordinate with
  [#777](https://github.com/Flip-Engineering/baton/issues/777),
  [#724](https://github.com/Flip-Engineering/baton/issues/724) and
  [#710](https://github.com/Flip-Engineering/baton/issues/710).

- [#777: Pass committed context snapshots between seats by citation](https://github.com/Flip-Engineering/baton/issues/777).
  Commit immutable sender context snapshots under a declared schema and carry
  versioned citations in briefs and reports. Resolve the cited values through
  authorized recipient reads, preserving the cited version and resolution
  failures. Review the issue's archived JavaScript REPL contracts against the
  current Bend context APIs. Compare token use and receiving-seat prefix-cache
  behavior on the same two-seat task with inline context and cited snapshots.
  Coordinate with [#707](https://github.com/Flip-Engineering/baton/issues/707),
  [#778](https://github.com/Flip-Engineering/baton/issues/778),
  [#710](https://github.com/Flip-Engineering/baton/issues/710),
  [#718](https://github.com/Flip-Engineering/baton/issues/718) and
  [#720](https://github.com/Flip-Engineering/baton/issues/720).

- [#776: Reduce Bend build time and peak memory with complete qualification](https://github.com/Flip-Engineering/baton/issues/776).
  Profile fixed-point backend passes, retained intermediate terms, generated C
  compilation and native test builds. Measure identical cold and warm source
  and toolchain inputs. Extend verified reuse, parallel independent compilation
  and tests, and exact cache verification. Preserve full selected comparison,
  native, package and installed acceptance, complete failures and provenance.
  Main9 compilation completed with the packaged compiler after the retained
  Main7 backend trap. Object caching covers native fixture builds.
  Receive and Control baseline, cold-cache and warm-cache outputs were identical;
  all six unchanged ReceiveOutput tests passed on the homelab. Main9 C generation
  took 2,101 seconds and peaked at 136 GiB. Release qualification and compiler
  memory work continue.
  Further optimization proceeds alongside release work. Coordinate with
  [#677](https://github.com/Flip-Engineering/baton/issues/677),
  [#741](https://github.com/Flip-Engineering/baton/issues/741),
  [#751](https://github.com/Flip-Engineering/baton/issues/751),
  [#761](https://github.com/Flip-Engineering/baton/issues/761) and
  [#771](https://github.com/Flip-Engineering/baton/issues/771).

- [#775: Validate direct-turn output paths with recorded receivers](https://github.com/Flip-Engineering/baton/issues/775).
  Validate the requested output parent before native preparation for every direct
  turn. A recorded managed Codex endpoint skips the default-receiver creation
  path, which previously performed this check. The candidate Control regression
  launched a live native fixture with a missing output parent. Preserve its full
  failed-run evidence and qualify setup refusal, interrupted recovery, explicit
  stops and resumed input across all four native harnesses. Coordinate with
  [#761](https://github.com/Flip-Engineering/baton/issues/761),
  [#747](https://github.com/Flip-Engineering/baton/issues/747) and
  [#773](https://github.com/Flip-Engineering/baton/issues/773).
  Scripted Control fixtures register their Codex TCP receiver explicitly and
  retain its route across continuation. Their parent uses a notice endpoint;
  reader tests verify the complete retained report and registered argv. Full
  Control acceptance retains the missing-output-parent refusal regression.

- [#774: Consolidate completed PRs and contributor branches during delivery](https://github.com/Flip-Engineering/baton/issues/774).
  Agents merge authorized work after required checks pass and remove completed
  contributor references. Reconcile the retained branch and worktree backlog
  using advertised tips and ancestry or exact incorporation evidence. Preserve
  active worktrees, uncommitted files and immutable build evidence. Coordinate
  the active [#772](https://github.com/Flip-Engineering/baton/pull/772) landing
  with [#717](https://github.com/Flip-Engineering/baton/issues/717) and
  [#747](https://github.com/Flip-Engineering/baton/issues/747). After branch
  consolidation concludes, close completed issues against verified main,
  release and runtime evidence. Preserve open acceptance requirements for
  unfinished source and pending qualification.

- [#773: Use concise contextual agent actions and automatic handling receipts](https://github.com/Flip-Engineering/baton/issues/773).
  Add `send PLAYER "text"`, `finish "summary"` and `confirm PLAYER` to the
  contextual command surface. Shorten generated notices and task instructions;
  Baton resolves project, session, routing and action identities. Successful
  native settlement records handling of complete owned reads. The interactive
  Claude MCP route needs native prompt-scoped reads and successful Stop handling;
  failed and interrupted prompts retain their pending input. Preserve unread
  input, failed turns and existing explicit compatibility commands. Match
  MCP capability discovery to the concise help surface and retain contextual
  inbox, authored-message and batch tools. Explain Conductor roles, Ensemble
  coupling and the branching workflow in CLI and MCP discovery; coordinate this
  chooser with [#751](https://github.com/Flip-Engineering/baton/issues/751).
  Keep central branch help reachable through CLI and MCP; state role assignment
  effects, tight peer membership, organizational Sections and action-batch grammar.
  Run the actual contextual inbox and native successful-turn handling acceptance
  after the help change. Coordinate
  with [#723](https://github.com/Flip-Engineering/baton/issues/723),
  [#761](https://github.com/Flip-Engineering/baton/issues/761),
  [#716](https://github.com/Flip-Engineering/baton/issues/716) and
  [#598](https://github.com/Flip-Engineering/baton/issues/598).

- [#771: Reuse completed Main evidence for the current qualification target](https://github.com/Flip-Engineering/baton/issues/771).
  The released candidate's target artifact embeds the earlier `ff5298d3` baseline.
  Current `main` is `b5b4c61a`; its production inputs match the released 2.0 source.
  The workflow accepts a completed target Main handoff through the existing
  production-input and compiler verification. The exact `b5b4c61a` remote target
  build and transfer verification passed naturally, with a direct object-cache
  hit, generated C `ca552285` and executable `b27bf926`. The
  [complete proof](https://github.com/Flip-Engineering/baton/issues/771#issuecomment-6207964053)
  retains source, toolchain, substitution, streams and original wait results.
  Full selected target and candidate CI remains pending. The existing exact-target
  artifact path is preserved. Coordinate with
  [#741](https://github.com/Flip-Engineering/baton/issues/741),
  [#747](https://github.com/Flip-Engineering/baton/issues/747),
  [#751](https://github.com/Flip-Engineering/baton/issues/751) and
  [#761](https://github.com/Flip-Engineering/baton/issues/761).

- [#769: Preserve OMP output while handling event-filter compatibility](https://github.com/Flip-Engineering/baton/issues/769).
  OMP 17.4 rejected `set_event_filter` without echoing its request ID. Its
  cumulative message snapshots expanded a 112 KB thinking stream into a
  953 MB retained stream and exhausted the filesystem during the transport
  review. Preserve complete native output, handle the actual filter response
  and derive display output from accepted message events. Coordinate with
  [#686](https://github.com/Flip-Engineering/baton/issues/686),
  [#761](https://github.com/Flip-Engineering/baton/issues/761) and
  [#770](https://github.com/Flip-Engineering/baton/issues/770), with the
  exit-zero raw-preservation case tracked by
  [#796](https://github.com/Flip-Engineering/baton/issues/796).
  The 2026-10-17 recovery patch is on retained source HEAD
  `35152919ad99f1938c76dfa8db33f2b1ebfa762d`; the invalid-tail helper passed
  its focused type check in 359 ms. A combined Main build was started from this
  source; a separate memory-only build from `0880cf3` is being used for the
  memory correction. Runtime acceptance requires bounded-memory receive and
  checkpoint recovery from a NUL-corrupted tail, with the original bytes and
  pending input preserved.
  The exact-hash review was read under the existing DeepSeek native, attempt
  `receive:rewrite-deepseek:984:691184f811a59c6b8a14f0707ae2ba0e`. It confirms
  the affine failure is fixed and verifies the error-appending and keeper-loss
  marker dependencies. Follow-up source tracing established that the full-spool
  check in `instance.bend:166` gates successful input-witness settlement; it
  does not gate process-attempt retirement. The nonempty corruption error keeps
  the owed inbox input unsettled. A separate raw-preservation constraint remains:
  normal keeper exit-zero acknowledgement unlinks stdout in
  `process-spawn.c:1100-1111`, while the owner-loss path preserves it. The pure
  Bend2 recovery path must leave an exit-zero NUL tail incomplete and retain its
  raw spool, checkpoint, native UUID and owed input. Custody-proven owner loss
  can retire the dead attempt while leaving the inbox input unsettled.
  Supporting failed-observation retirement after exit zero requires a separate
  process-acknowledgement change. The repaired plan has a passing Muse review;
  native implementation, admission pins and the compaction decision remain
  open. See the [October 17 issue update](https://github.com/Flip-Engineering/baton/issues/769#issuecomment-6228858193).

- [#770: Retain actual native wait status after a filesystem write failure](https://github.com/Flip-Engineering/baton/issues/770).
  The [#769](https://github.com/Flip-Engineering/baton/issues/769) review reaped
  its native process while the status-file write failed with `ENOSPC`. The
  keeper then released its in-memory status. Recovery sees an unfinished
  attempt with an unknown native outcome. Preserve actual wait evidence
  through the failed write and allow the retained attempt to settle through
  its supported recovery path. Preserve the original stream, failed
  checkpoint and incomplete handling. Coordinate with
  [#761](https://github.com/Flip-Engineering/baton/issues/761).

- [#761: Move Codex inbox coordination decisions into Bend](https://github.com/Flip-Engineering/baton/issues/761).
  Implementation is active after the 2.0 release and adoption. Bend owns inbox
  coordination; the native host supplies Codex protocol transport. Remove the
  Node inbox helper and qualify the installed path.
  Move database claims, native and stop checks, input selection, failure
  retention, admission and continuation from `codex-inbox-wake.mjs` into Bend.
  Preserve complete input, first receipts, terminal reporting and restart
  recovery. Follow the [#539 operator correction](https://github.com/Flip-Engineering/baton/issues/539#issuecomment-5766719155)
  and [#592](https://github.com/Flip-Engineering/baton/issues/592); carry the
  real writer-contention regressions from
  [#750](https://github.com/Flip-Engineering/baton/issues/750) and
  [#760](https://github.com/Flip-Engineering/baton/issues/760). This work follows
  the 2.0 release; coordinate with [#747](https://github.com/Flip-Engineering/baton/issues/747).
  Preserve the recorded Codex environment when another provider sends a report.
  The installed Muse review inherited its private `HOME` during parent wake;
  explicit receiver environment configuration restored delivery. Retain the
  [observed socket failure](https://github.com/Flip-Engineering/baton/issues/761#issuecomment-6203830573).
  The implementation now routes claims, input, stops, admission, continuation,
  terminal reporting and failure retention through the compiled Bend coordinator.
  The native adapter transports complete WebSocket frames and owns the proxy
  process lifetime. Registration captures `HOME` and effective `CODEX_HOME`;
  connect, configure and managed delivery translate recorded helper endpoints.
  The fixtures retain #750/#760 writer contention through the original SQLite
  busy callback, complete input, NULL receipts and exactly one successful RPC.
  A restarted follower reuses the committed terminal report bytes, preserving
  complete items, the first parent receipt and unread input during replay.
  The transport passed 13 remote fixtures. The Bend inbox module passed its
  remote compiler check. Terminal replay now reuses the existing committed report
  body before retrying wake and settlement; its regression preserves the original
  complete items and first receipt across two follower processes. The composed
  executable exposed an invalid eager match on suspended IO during actual public
  Codex acceptance. Qualify explicit Result propagation through ordinary IO and
  proxy cleanup before the next release. Retain the original failure and compiler
  crash evidence. Corrected root fixtures pass all 15 remote tests; full native
  tests and actual public Codex acceptance remain pending on the repaired executable.

- [#758: Wait for fixture owner publication before cleanup shutdown](https://github.com/Flip-Engineering/baton/issues/758).
  The target Control cleanup in run `38785813982` recorded shutdown success
  before the remaining owner's generation-3 record was published. The idle
  owner had zero physical slots and every retained attempt was acknowledged.
  A supported shutdown settled it and preserved all baseline errors. Cleanup
  now establishes public owner readiness at the exact sole-owner boundary and
  verifies the same PID, process start and command before shutdown. The empty-process
  path and zero-process assertion are preserved. The real owner-publication
  regression and existing project-resume cleanup test passed remotely on Main6;
  the held owner exited naturally with status 0. Integrate this fixture correction
  and preserve the original unsupported baseline verdict. This follow-up coordinates
  with [#747](https://github.com/Flip-Engineering/baton/issues/747) and
  [#755](https://github.com/Flip-Engineering/baton/issues/755).

- [#751: Add branching Ensemble variant after Baton 2.0](https://github.com/Flip-Engineering/baton/issues/751).
  Implementation is active after the [#717](https://github.com/Flip-Engineering/baton/issues/717)
  release and active adoption. Use explicit Conductor intervention boundaries
  and record observed resource use. Apply the runtime budget rules in
  `AGENTS.md`. Use the
  [Fork-and-Flush paper](https://arxiv.org/html/2610.07447v1) to design parallel
  branches from a recorded workspace with fresh native conversations. Let the
  owning Conductor configure evaluation and select the continuing branch.
  Retain every branch's artifacts, ancestry, seeds, reports and selection
  evidence in the database. Preserve pending work, explicit stops and recovery.
  Qualify isolated branching, context initialization, evaluated selection,
  continuation and restart behavior on remote native clients. Coordinate with
  [#713](https://github.com/Flip-Engineering/baton/issues/713),
  [#723](https://github.com/Flip-Engineering/baton/issues/723) and
  [#731](https://github.com/Flip-Engineering/baton/issues/731).
  The implementation records workspace snapshots, fresh child configuration,
  evaluator output and actual status, atomic selection, continuation and recovery.
  A failed receiver setup retains its operation and prevents task admission.
  The [command and behavior guide](branching-ensembles.md) describes this surface.
  Keep the team and branching chooser concise across help, MCP and agent docs;
  explain both coupling modes, Ensemble-scoped source defaults, selection of a sole owned
  Ensemble, the default score direction and the explicit `select` trigger.
  All six remote branching fixtures pass. Four actual Codex branches passed the
  independent evaluator; the selected branch continued in the same conversation.
  A separate recovery run passed restart, retained lineage and explicit-stop
  preservation after the paired driver failed during its recovery snapshot.
  Retain both outcomes. The paired scores show no demonstrated performance gain.
  Final composed release qualification remains pending with
  [#761](https://github.com/Flip-Engineering/baton/issues/761).

- [#747: Wait for actual native settlement in real acceptance drivers](https://github.com/Flip-Engineering/baton/issues/747).
  Browser fixture native identity and worker completion are tracked in
  [#759](https://github.com/Flip-Engineering/baton/issues/759).
  Git App key special-bit fixture portability is tracked in
  [#757](https://github.com/Flip-Engineering/baton/issues/757).
  TypeScript symbol-scope correction is tracked in
  [#756](https://github.com/Flip-Engineering/baton/issues/756).
  Parallel fixture signal scope and required generated C staging are tracked in
  [#755](https://github.com/Flip-Engineering/baton/issues/755).
  Actual native-receive admission completed before its successful background
  bootstrap; knowledge phase checks ran before the producer capture began.
  Root-day started a second direct turn while the original native remained
  active, and recovery's initial live-message command refused the recipient's
  missing native identity. Await actual selected execution and process
  settlement, admit recovery's first task through the existing canonical batch
  transport, and retain an explicit verification path for already-admitted work.
  The retained recovery run completed its observer-loss checkpoint, then failed
  while reading an absent canonical transcript. Read the registered attempt
  generations, record zero output before their first write, and retain every
  complete transcript hash and original report assertion.
  Later root-day completion checks rejected an original successful direct turn
  after a parent response advanced the current execution. Select its retained
  direct request and terminal custody. Codex emitted completed command events
  without start events; observe those events and require the owned observer to
  remain live before the intentional loss. Hierarchy's native steer succeeded,
  while its first handling receipt was plain text. Check the registered native
  response separately from the immutable handling receipt. Preserve the original
  failed runs and their task-storage qualification.
  Git acceptance must await the native review receipt before landing. Guidance
  already resumes the conflicted worker through its registered receiver; await
  that same native turn and its resolved branch before checked landing.
  The controlled Git fixture must supply its guided worker, handling receipt
  and subsequent report at those waits. Run its real rebase and landing checks
  with the controlled native boundary.
  The nested receive continuation fixture read the queued assignment through
  its completion helper during the first turn. Successful settlement handled
  that complete read, leaving no continuation to accept. Keep the original
  completion exchange disabled in both continuation cases and inspect assignment
  receipt metadata before the shared completion helper reads a complete body.
  Observe actual receive-child exit while awaiting the next native. Use the
  scripted parent endpoint to isolate the host ACK failure. Await the actual
  self-promotion continuation after message admission. Preserve the host ACK
  failure, live continuation, report and receipt assertions.
  Focused receive profile tests reached a native identity on the first attempt,
  then selected an empty history path during account handoff. Resolve the
  recorded conversation after observing that attempt, as direct turns do, and
  retain the original native, transcript and provider-cause assertions.
  Root wake diagnostics recorded integral `inputSeq` values as JSON real numbers.
  Recognize those stored cursors so coalescing and provider failure replay retain
  their original input and complete cause.
  An administrative explicit database override failed while canonicalizing an
  absent inherited database despite having no admitted attempt directory. Read
  the attempt context first and retain canonical database equality for native
  calls with a nonempty inherited attempt directory.
  Owner witness reads can reach a new listener before its incarnation record
  is published. Retry the existing stale-incarnation response while retaining
  the original spawn and protocol checks. The complete shared-owner suite
  passes with the corrected host function. MCP capability discovery reads
  global help, and its command, contract and root suites pass. Controlled
  native fixtures must establish their recorded conversation before owned
  reads and complete handling before their terminal frame.
  The remaining native checks exposed stale fixture contracts: compile the
  native entry with its GNU C dialect, supply the current receive attempt
  argument, and inject the stop process group into the current session header.
  Receiver switching retains a failed App terminal as the command result while
  durably admitting newer input. Assert both that complete failure and the
  subsequent native turn. Preserve every later interruption and stop assertion.
  Preserve trailing spaces when comparing a fixture owner's process command,
  and create the unrelated project as a valid Git checkout before testing its
  recorded session boundary. The three affected dispatch checks pass remotely.
  The receive output check compares the complete committed delivery row and
  separately asserts the public read's derived input status. Compile its waiter
  fixture with the production optimization setting.
  The contextual action suite completed its assertions, then failed while an
  asynchronous delivery wrote into its temporary directory during cleanup.
  Await owned fixture subprocesses and the selected database owner's exit before
  removing that directory. Preserve the original complete run and its failure.
  The corrected full contextual action suite passes all 56 tests remotely.
  Installed context acceptance also reached a fresh runtime launch whose declared
  `program` field was omitted by the shared source accessor. Read `program` for
  runtime launch requests. Focused package run `38377` on the completed `2994dd9d8`
  runtime passed native handoff, resume and stop checks, then failed with `ENOENT`
  because the runtime attempt parent directory was absent. Fix `3358ceec7` creates
  that parent through the existing directory API. Run `22720` on `3358ceec7`
  then failed with `EINVAL`: the nested role directories did not meet the
  physical owner's database-parent identity check. Fix `b3b17fe28` places both
  role directories directly beside the database. The next focused package run
  reached runtime commands, then rejected pause because launch had published
  running before Node's initial pause. Await that pause before publishing launch.
  Publish the current release state after the keeper confirms exit. Runtime
  roles without a guard descriptor also failed cleanup with `EBADF`; close the
  descriptor when present and retain close errors for actual descriptors.
  Reuse the completed Main C through the existing complete foreign-source
  substitution proof and recompile the corrected host code. Run `55894` then
  passed runtime launch, release and cleanup, but refused the observe request's
  explicit empty effect array before admission. Accept the canonical empty-array
  value while preserving nonempty effect validation. Installed context acceptance
  and final source qualification remain pending.
  The complete native run also suspended an observer while it retained a SQLite
  read lock, blocking the fixture's native handling write. Suspend the observer
  while holding a reader-free database boundary, then release that boundary
  before the native completes its handling and terminal output.
  Target project resume exited before connecting to its controlled native.
  Observe that child while accepting the connection and retain its complete
  command output, native-start log and original resume assertions.
  Candidate run `38750337394` completed the nested receive suite with exit zero,
  then failed its empty stdout assertion because fixture progress used stdout.
  Send those diagnostics to stderr and preserve native protocol output and all
  assertions. Complete source qualification remains pending.
  The target replay fixture left its initial assignment open and waited for a
  direct command whose automatic continuation awaited fixture input. Complete
  that initial assignment through the public completion exchange before replaying
  the retained report. Preserve the queued-input and report assertions.
  Shared native control consumers must also bind the acceptance helper used by
  their borrowed `accept` method. Preserve all configuration, installed identity
  and task-start assertions while completing that fixture dependency.
  Candidate run `38755427825` reached an OMP owned read before its emitted
  conversation identity was recorded. Await the matching running native binding
  through read-only metadata observations before scripted commands. Preserve all public
  owned reads, and report a recorded nonzero native exit while awaiting its
  successful report or initial control connection in the held-task fixture.
  The target native launch omits the inherited attempt directory; retain its
  matching running session binding while checking the exact directory when supplied.
  The first target check failed with `KeyError` for the absent inherited variable. A complete current
  fixture run then retained a matching committed binding while the new subscription
  waited for another notice. Remove that fixture subscription and observe the
  binding predicate directly; retain both failed synchronization attempts. The scoped
  held-task check passes with the current and target binaries.
  The installed Configure fixture then retained its sole idle owner during cleanup:
  its global executable had already been restored by another cleanup. Match the
  executable recorded in the fixture configuration, as owner shutdown does.
  Muse continuation checks preserve the first successful turn's handling receipt
  and select later owed guidance. Receiver-switch checks observe `exit 0`, release
  the old native attempt and await admission through the current receiver.
  Await the exact later guidance admission before settling its active App turn.
  Preserve a missing-follower failure after successful short admissions and
  settled native custody leave no managed producer, connection or recorded wake.
  Preserve failed fixture files and process facts, then close owned children
  before collecting inherited server pipes.
  A newer report can start the next App turn while its public wake returns the
  older owed input's retained failure. Assert its complete admitted message through
  the batch result, preserving the prior failure, partial result, owed receipts
  and exact next turn. Retain a consistent SQLite backup and omit transient
  database sidecars from failed-fixture copies.
  Candidate run `38771989568` changed the recorded native conversation during
  the one-shot contention check. The original managed follower enforced that
  identity change, and serve retained its failed task. Require the exact
  `native-w2` fence cause and failed serve result after the complete one-shot,
  native identity and stopped-input assertions.
  Browser acceptance reached the final actor through End while its cursor was
  outside the viewport. Scroll the keyboard-selected actor into view. The complete
  browser acceptance now passes with the current actor cards and knowledge view.
  Root wake acceptance retained a live follower after an explicit stop arrived
  during SQLite admission contention. Recheck stop state after the claim returns
  without admission. All 13 root wake checks pass with the correction, including
  the real writer and public stop regression. Preserve the original notice,
  native RPC and interrupted process evidence.
  Preserve complete bodies, native lineage, first receipts, reports, original
  failure evidence and every semantic assertion. Validate the corrected callers
  remotely without duplicate tasks. Coordinate with
  [#727](https://github.com/Flip-Engineering/baton/issues/727),
  [#730](https://github.com/Flip-Engineering/baton/issues/730) and
  [#746](https://github.com/Flip-Engineering/baton/issues/746).

- [#746: Read promoted root holdings in the knowledge consumer acceptance](https://github.com/Flip-Engineering/baton/issues/746).
  Source review found that the consumer task and verifier use the knowledge
  audit view while requiring the producer's local control finding to be absent.
  Read the existing universal scope with subject `root` for both consumer native
  conversations and the consumer verifier. Preserve producer and root audit
  reads, the exact producer-to-root promotion, full evidence and provenance,
  and the reviewed document landing. Validate the corrected driver through its
  actual remote native route. Coordinate with
  [#724](https://github.com/Flip-Engineering/baton/issues/724),
  [#727](https://github.com/Flip-Engineering/baton/issues/727) and
  [#730](https://github.com/Flip-Engineering/baton/issues/730).

- [#732: Infer handling receipts for connected Claude MCP sessions](https://github.com/Flip-Engineering/baton/issues/732).
  Connected Claude MCP handling now derives receipts from complete owned reads,
  the registered endpoint and native conversation, and live process ancestry.
  The endpoint socket binds the actual bridge process and connection. Restart,
  forged context, changed endpoint or native identity, and explicit stops retain
  their handling checks. Qualify the
  real Claude channel for [#723](https://github.com/Flip-Engineering/baton/issues/723),
  [#727](https://github.com/Flip-Engineering/baton/issues/727) and
  [#717](https://github.com/Flip-Engineering/baton/issues/717).

- [#731: Prepend a generated ideation seed to agent initialization guidance](https://github.com/Flip-Engineering/baton/issues/731).
  Native initialization prepends an application-generated random seed and an
  instruction to use its abstract qualities when interpreting the task. The
  implementation retains complete prompting and original task text in the
  database, with stable retry and recovery input across supported harnesses. This is
  the operator-requested adaptation of [String Seed of Thought](https://arxiv.org/abs/2510.21150).
  Receive retries carry their recorded predecessor initialization across fresh,
  profile, transient and route continuations. Each actual attempt retains its
  complete guidance. Packaged one-shot adapters use the shared receiver.
  The internal `native-attachment-input` command retains separate MCP and initial
  task components for an actual managed Claude attempt or recorded conversation
  and shares its seed, including initialization before the native identity frame.
  External MCP and root-day callsites are implemented and source reviewed.
  Managed Codex App admission now uses the same stored seed and instruction,
  retaining complete RPC guidance for each admission and sharing the recorded
  native conversation's seed across retry. Tokenless legacy pointers retain
  their complete changing guidance. Remote qualification remains pending.
  Remote retry, attachment and installed acceptance remain open.
  Qualify native initial input and the installed route for
  [#716](https://github.com/Flip-Engineering/baton/issues/716),
  [#723](https://github.com/Flip-Engineering/baton/issues/723),
  [#727](https://github.com/Flip-Engineering/baton/issues/727) and
  [#717](https://github.com/Flip-Engineering/baton/issues/717).

- [#730: Infer contextual knowledge evidence from retained reports](https://github.com/Flip-Engineering/baton/issues/730).
  `knowledge record --evidence report` selects the unique authored report after
  the current assignment to its canonical coordinator. Native CLI, MCP and the
  real-agent driver preserve complete evidence and explicit references. Missing
  and ambiguous reports return a precise refusal. Remote qualification remains
  open for [#723](https://github.com/Flip-Engineering/baton/issues/723),
  [#727](https://github.com/Flip-Engineering/baton/issues/727) and
  [#717](https://github.com/Flip-Engineering/baton/issues/717).
  The native knowledge driver now requests graceful shutdown of its exact
  persistent owner between phases after native capture exits and all other
  owned work finishes. It retains the complete shutdown command result and
  owner-exit observation bound before the shutdown request. Logical sessions, findings and report review
  remain in the database. Real-route qualification remains open.

- [#727: Use database task input and contextual actions in native validation](https://github.com/Flip-Engineering/baton/issues/727).
  The real-agent drivers `accept-kimi-hierarchy.py`, `accept-native-receive.py`,
  `accept-hierarchy.py`, `accept-root-day.py`, `accept-git.py`,
  `accept-knowledge-context.py` and `accept-receive-recovery.py` now submit full
  task text and contextual actions through [#716](https://github.com/Flip-Engineering/baton/issues/716)
  and [#723](https://github.com/Flip-Engineering/baton/issues/723). Their direct-turn,
  recovery, context, native route, report, steering, correction and checked-landing
  assertions remain in scope. Explicit caller-file import fixtures remain.
  The standalone root-day and recovery drivers stage the complete executable
  and helper prefix and retain its provenance. The Kimi driver also accepts a
  supplied coordinator through the shared staging operation. Its checked
  landings use the explicit `BEND` compiler and retain that compiler's path,
  version and hash separately from the supplied executable's build provenance.
  Install and configure the required native clients on the homelab runner.
  Recovery observes process exit through Linux pidfds or macOS/BSD kqueue;
  its controlled protocol fixture also runs on Linux. Retain the complete
  observer-loss, queued retry, conversation, report, receipt and process evidence.
  [#732](https://github.com/Flip-Engineering/baton/issues/732) records the connected
  Claude handling prerequisite. Remote real-route acceptance remains open
  for [#717](https://github.com/Flip-Engineering/baton/issues/717).
  The compiler correction in
  [#728](https://github.com/Flip-Engineering/baton/issues/728) qualified in 2.0.
  Current compiled Codex follower acceptance remains in
  [#761](https://github.com/Flip-Engineering/baton/issues/761).
  Source review at `57b471e9` found that the native-receive driver's final
  receipt assertion includes new root-to-operator reports whose terminal
  recipient has no delivery endpoint. Preserve those complete reports for the
  operator's review and verify their native lineage separately from handled
  participant input. Audit all seven drivers for this recipient distinction
  and waits whose producer has already completed before the real-route run.
  The recovery driver now requests graceful owner shutdown after both real
  parent reports, then retains its existing wait for all owned processes to
  exit. Full shutdown output and actual owner-exit observations accompany
  the original recovery and native-process completion assertions. The owner
  lifetime observation is registered before the shutdown request.

- [#724: Expose deliberate scratchpad operations through native CLI and MCP](https://github.com/Flip-Engineering/baton/issues/724).
  The current native command surface lacks the deliberate scratchpad operation
  required for authored working notes feeding agent knowledge. Define complete
  creation, reads, append and elevation with typed notes, plans and doubts,
  author and scope provenance, and existing knowledge authority. Infer internal
  identities through [#723](https://github.com/Flip-Engineering/baton/issues/723).
  Preserve database task dispatch and the generated task-source file ban from
  [#716](https://github.com/Flip-Engineering/baton/issues/716). Implementation
  and remote installed acceptance remain open. Coordinate with
  [#539](https://github.com/Flip-Engineering/baton/issues/539),
  [#707](https://github.com/Flip-Engineering/baton/issues/707),
  [#710](https://github.com/Flip-Engineering/baton/issues/710) and
  [#717](https://github.com/Flip-Engineering/baton/issues/717).

- [#723: Infer agent action identities and handling state](https://github.com/Flip-Engineering/baton/issues/723).
  Generate mutation identities inside Baton and resolve completion requests,
  current assignments, complete recipient-owned input and native receipts from
  recorded context. Agents express semantic actions and targets. Preserve
  explicit compatibility selectors, coordinator authority, earlier receipts,
  stops and incomplete work. Carry the behavior through CLI, MCP and agent
  instructions. The current trial and onboarding instructions use semantic
  actions and native handling inference; explicit control selectors remain
  documented for administrative compatibility. Qualify these instructions in
  the [#717](https://github.com/Flip-Engineering/baton/issues/717)
  release. [#727](https://github.com/Flip-Engineering/baton/issues/727) qualifies
  contextual actions and inferred receipts in the real-agent validation drivers.
  One-shot Codex and OMP Conductors now delegate to the shared retained
  receiver, including semantic action instructions and database initialization
  evidence from [#731](https://github.com/Flip-Engineering/baton/issues/731).
  Current receive and assignment recovery tutorials use database task input
  and inferred native receipts. Explicit stored-message replay and
  caller-authored file imports retain their compatibility role. Remote native
  qualification of this source correction remains open.
  Coordinate with [#714](https://github.com/Flip-Engineering/baton/issues/714),
  [#715](https://github.com/Flip-Engineering/baton/issues/715),
  [#716](https://github.com/Flip-Engineering/baton/issues/716),
  [#718](https://github.com/Flip-Engineering/baton/issues/718) and
  [#720](https://github.com/Flip-Engineering/baton/issues/720).
  Current compiled Codex follower acceptance remains in
  [#761](https://github.com/Flip-Engineering/baton/issues/761).

- [#721: Add Antigravity CLI agent harness support](https://github.com/Flip-Engineering/baton/issues/721).
  Verify the supported CLI protocol and add dispatch, resumption, complete
  events, provider settings, receiver controls and coordinator reporting.
  Preserve native identity, pending work and explicit stops. Qualify the
  packaged harness remotely and through ordinary installed use. Coordinate
  with [#671](https://github.com/Flip-Engineering/baton/issues/671),
  [#703](https://github.com/Flip-Engineering/baton/issues/703),
  [#713](https://github.com/Flip-Engineering/baton/issues/713) and
  [#715](https://github.com/Flip-Engineering/baton/issues/715).

- [#716: Dispatch task text and retain it in the database](https://github.com/Flip-Engineering/baton/issues/716).
  The [dispatch interface](task-start-716.md) uses `baton dispatch "task text"`
  and complete stdin input through CLI and MCP. Retain requests, complete text
  and setup outcomes in the database. Generated Markdown and task-source files
  are banned. [#724](https://github.com/Flip-Engineering/baton/issues/724) records
  the missing deliberate scratchpad operation for agent knowledge.
  Trial and onboarding instructions dispatch complete text and retain the input
  in the database. Standing workflow instructions remain separate from each
  task's source. Caller-supplied UTF-8 import remains optional. It consumes the
  strict named-route reader from corrected #703 source `25f29f0d` and preserves
  the original #703 ownership. Remote target/candidate, full package and
  installed task-entry qualification remain part of the current #717 release.
  [#727](https://github.com/Flip-Engineering/baton/issues/727) qualifies complete
  database task input in the real-agent validation drivers.

- [#715: Simplify agent commands with a contextual action grammar](https://github.com/Flip-Engineering/baton/issues/715).
  The integrated [agent commands](agent-commands.md) extend the project and
  session context from [#714](https://github.com/Flip-Engineering/baton/issues/714)
  to inspection, assignments, decisions, managed work, knowledge and project
  operations. Each batch item retains its full input and individual outcome.
  Native input status derives from complete recipient reads and the matching
  native terminal report, including full `pending` and Pretty reads. Foreign
  recipient rows and metadata-only reads remain observational. Remote
  qualification and active installation remain
  part of the current #717 release.
  - [ ] Record delivered and read status through the recipient harness.
  - [ ] Record routine handling from the recipient turn without a separate
    acknowledgement command for every message.
  - [ ] Preserve incomplete handling after failed or interrupted turns,
    original receipt history, explicit stops and replay behavior.
  - [ ] Keep replies, decisions and matched task completion independently
    recorded. Coordinate recipient settlement changes with
    [#713](https://github.com/Flip-Engineering/baton/issues/713).
  - [ ] Update inbox selection and pending notes for native message status;
    validate batch outcomes and installed commands on the remote runner.

- [#713: Route unchanged native-turn reports through the coordinator](https://github.com/Flip-Engineering/baton/issues/713).
  Successful turn settlement created a self-addressed task continuation
  while the assignment was open and the worker inbox was empty. Wonder Full and
  Synthesis repeated unchanged held-work reports; later Muse turns returned
  quota errors. Deliver the turn report to the recorded coordinator for its
  next-work decision. Keep the worker assignment, original input, provider
  errors and owned validation process intact. New guidance reaches the same
  native conversation through ordinary delivery.

- [#712: Report gone native attempts without stale running state](https://github.com/Flip-Engineering/baton/issues/712).
  Normal CLI and Orchestra UI observations must show a gone or unknown native
  attempt accurately when its process and keeper are absent and terminal status
  is unavailable. Preserve the original input, receipt, conversation, streams,
  assignment and explicit stops. Ordinary recovery and provider configuration
  must preserve that identity. The existing `native-instance-conductor` owns
  assignment of the repair. Related recovery and shared-custody work remains
  in [#696](https://github.com/Flip-Engineering/baton/issues/696) and
  [#676](https://github.com/Flip-Engineering/baton/issues/676). Completed
  retained-attempt reconciliation is recorded in
  [#705](https://github.com/Flip-Engineering/baton/issues/705).

- [#671: Deliver pending guidance into live headless Muse conversations](https://github.com/Flip-Engineering/baton/issues/671).
  The retained `semantic-impl-code` attempt has six pending guidance inputs and
  owns managed build session 29. Muse receives an initial prompt file with stdin
  closed; the current live guidance bridge is enabled for OMP. Provide a supported
  headless input path that preserves the conversation, managed work, parent,
  explicit stops and complete bodies. Distinguish admission, recipient receipt
  and model handling. The existing managed-command runtime wake can continue the
  same conversation. [#705](https://github.com/Flip-Engineering/baton/issues/705)
  covers reconciliation after terminal custody; the continuation requirement is
  recorded in [#572](https://github.com/Flip-Engineering/baton/issues/572).
  [Retained source and custody evidence](https://github.com/Flip-Engineering/baton/issues/671#issuecomment-6133386222)
  records the current input gap and build qualification limits.

- [#703: Manage persistent project settings through installed Baton](https://github.com/Flip-Engineering/baton/issues/703).
  This work remains unfinished. Provide public commands to read and save
  project-local settings that survive reopened and new sessions, worktrees and
  package upgrades. Show effective defaults and explicit session overrides.
  Include model choices for roles and Contributor preference as project defaults.
  Isolate projects and preserve active native routes, conversations and explicit
  stops. Credentials remain in the native providers' external account stores.
  A linked-worktree `--project ... project-sessions` read exited 2 when its
  pointer resolved under the shared Git common directory; see the
  [observed #703 pointer failure](https://github.com/Flip-Engineering/baton/issues/703#issuecomment-6135011161).
  Root coordinates the work; `semantic-controls-next` owns the installed CLI/MCP
  surface, and Root owns UI changes.

## Other open work

- [#793: Track configured accounts, native funding routes and API credits](https://github.com/Flip-Engineering/baton/issues/793).
  Research supported account and usage APIs, preserve unknown balances and
  qualify account-aware observation and fallback. Coordinate subscription
  routing in [#702](https://github.com/Flip-Engineering/baton/issues/702),
  provider failure in [#681](https://github.com/Flip-Engineering/baton/issues/681),
  availability in [#694](https://github.com/Flip-Engineering/baton/issues/694),
  persistent settings in [#703](https://github.com/Flip-Engineering/baton/issues/703),
  authored numeric precision in [#711](https://github.com/Flip-Engineering/baton/issues/711),
  model discovery in [#792](https://github.com/Flip-Engineering/baton/issues/792),
  and Kimi usage-window tracking in
  [#797](https://github.com/Flip-Engineering/baton/issues/797). The observed
  web reset text was `5-hour usage / Code / 100% / Resets 10-16 20:41`
  (2026-10-16 20:41 PDT / 2026-10-17 03:41 UTC). The read-only OMP usage
  query returned no Kimi report; API availability remains unverified. The
  separate OAuth refresh failure does not establish the historical 403 token.
- [#792: Expose configured model options and capability context](https://github.com/Flip-Engineering/baton/issues/792).
  Discover configured harness/account choices, model availability and capability
  assessments with their observed limits. Coordinate with
  [#702](https://github.com/Flip-Engineering/baton/issues/702),
  [#694](https://github.com/Flip-Engineering/baton/issues/694) and
  [#681](https://github.com/Flip-Engineering/baton/issues/681).
- [#787: Keep one owner election domain across runtime directories](https://github.com/Flip-Engineering/baton/issues/787).
  Integrate and qualify the canonical per-user IPC directory with existing
  ownership and permission checks. Preserve the four baseline split-owner
  reproductions and 34 distinct passing candidate cases; installed adoption
  and complete release qualification remain open. Preserve the separately
  observed socket and lock unlinks with their unattributed cause.
- [#786: Recover missing retained output projections and settle the original input](https://github.com/Flip-Engineering/baton/issues/786).
  Rebuild the projection from retained output when its directory is absent,
  preserve durable checkpoint order and coalesce native wake claims. Qualify
  active and completed output recovery, original receipt settlement and native
  notification behavior. Preserve complete input and actual provider/process
  failures through recovery. Coordinate with
  [#761](https://github.com/Flip-Engineering/baton/issues/761),
  [#769](https://github.com/Flip-Engineering/baton/issues/769) and
  [#770](https://github.com/Flip-Engineering/baton/issues/770), with the
  exit-zero raw-preservation case tracked by
  [#796](https://github.com/Flip-Engineering/baton/issues/796).
  The #769 candidate leaves the owed input unsettled on the NUL-tail path. The
  full-spool checkpoint check gates successful input-witness settlement, while
  process retirement follows a separate exited-and-released path. Normal
  exit-zero acknowledgement unlinks stdout, so the pending pure Bend2 follow-up
  will keep an exit-zero NUL tail incomplete. Custody-proven owner loss with no
  status marker can retire the dead process attempt while retaining the raw
  spool, checkpoint, native UUID and owed inbox input. Supporting
  failed-observation retirement after exit zero remains a separate
  process-acknowledgement task linked here. Focused type checking passed; full
  build and runtime bounded-memory/recovery evidence remain open. See the
  [October 17 recovery update](https://github.com/Flip-Engineering/baton/issues/786#issuecomment-6228858963).
- [#796: Retain raw output when retiring exit-zero invalid observation](https://github.com/Flip-Engineering/baton/issues/796).
  Process-attempt acknowledgement after an exit-zero observer error unlinks
  stdout. Preserve the original stream, validated checkpoint, manifest and
  native UUID while leaving the owed inbox receipt pending. Qualify a later
  receive on that same UUID. Coordinate with [#696](https://github.com/Flip-Engineering/baton/issues/696),
  [#769](https://github.com/Flip-Engineering/baton/issues/769),
  [#770](https://github.com/Flip-Engineering/baton/issues/770) and
  [#786](https://github.com/Flip-Engineering/baton/issues/786).
- [#782: Update stale coordinator laws and include their evaluation in validation](https://github.com/Flip-Engineering/baton/issues/782).
  The knowledge audit in [#779](https://github.com/Flip-Engineering/baton/issues/779)
  tracks the retained compiler failures, source review and passing hosted
  aggregate compiler check. Runtime evaluation and release qualification remain
  open.
- [#783: Validate knowledge scope and traversal direction on each command surface](https://github.com/Flip-Engineering/baton/issues/783).
  Track the CLI and MCP contract with the [#779 audit](https://github.com/Flip-Engineering/baton/issues/779).
- [#784: Define and validate knowledge evidence references and citation lineage](https://github.com/Flip-Engineering/baton/issues/784).
  Track missing references and supported evidence schemes with the [#779 audit](https://github.com/Flip-Engineering/baton/issues/779).
- [#785: Preserve relation authorship when an explicit relation ID collides](https://github.com/Flip-Engineering/baton/issues/785).
  Review author-owned repairs and cross-author conflicts with the [#779 audit](https://github.com/Flip-Engineering/baton/issues/779).
- [#711: Baton2: preserve authored numeric precision in scientific knowledge reads](https://github.com/Flip-Engineering/baton/issues/711).
- [#710: Define structured causal and evidentiary Knowledge nodes and edges with provenance and uncertainty](https://github.com/Flip-Engineering/baton/issues/710).
- [#707: Baton2: expose useful shared object evaluation and agent handoff](https://github.com/Flip-Engineering/baton/issues/707).
- [#702: Baton2: multiple Claude and Codex subscriptions with usage-exhaustion fallback](https://github.com/Flip-Engineering/baton/issues/702).
- [#694: Baton2: expose OpenCode Go usage limits and availability to orchestrators](https://github.com/Flip-Engineering/baton/issues/694).
- [#686: Baton2: reduce log volume with practical verbosity and cleanup](https://github.com/Flip-Engineering/baton/issues/686).
- [#685: Pending notifications must wake idle seats or require inbox review](https://github.com/Flip-Engineering/baton/issues/685).
- [#682: Baton2: live browser view of Orchestra structure and status](https://github.com/Flip-Engineering/baton/issues/682).
- [#681: Baton2: preserve pending work when a provider quota failure requires model failover](https://github.com/Flip-Engineering/baton/issues/681).
  Coordinate reset-aware retry and model routing with
  [#797](https://github.com/Flip-Engineering/baton/issues/797); preserve
  unknown reset data until a supported source is verified.
- [#797: Track Kimi Code usage windows and reset times](https://github.com/Flip-Engineering/baton/issues/797).
  The user observed `5-hour usage / Code / 100% / Resets 10-16 20:41`,
  equivalent to 2026-10-16 20:41 PDT / 2026-10-17 03:41 UTC. A read-only OMP
  usage query had no Kimi report. Verify a supported provider usage/reset source
  before implementing; use known resets for retry timing and available
  account/model routing. Preserve unknown values. Track OAuth refresh separately
  under [#793](https://github.com/Flip-Engineering/baton/issues/793).
- [#677: Baton2: prevent duplicate heavy validation and qualify remote execution placement](https://github.com/Flip-Engineering/baton/issues/677).
  Homelab runners 725 and 24006 are online in the existing restricted Baton
  runner group. Runner 24006 has a separate account, service, mount namespace,
  storage, work directory, home, temporary directory and tool cache.
  [Provisioning and permission evidence](https://github.com/Flip-Engineering/baton/issues/677#issuecomment-6184549467)
  records its readiness for independent jobs. Full release qualification remains
  tracked in [#717](https://github.com/Flip-Engineering/baton/issues/717).
- [#675: Baton2: qualify hosted parallel Bend2 validation](https://github.com/Flip-Engineering/baton/issues/675).
- [#669: Baton2: OMP terminal elision markers break native report extraction](https://github.com/Flip-Engineering/baton/issues/669).
- [#668: Baton2: ordinary delivery waits for the recipient endpoint lifetime](https://github.com/Flip-Engineering/baton/issues/668).
- [#666: Baton2: queued parent report receives no wake after observer recovery](https://github.com/Flip-Engineering/baton/issues/666).
- [#664: Baton2: diagnose audit check failures whose original stderr was omitted](https://github.com/Flip-Engineering/baton/issues/664).
- [#644: The resident retains 346 worktrees (8.2 GiB under .baton) while the host runs out of disk](https://github.com/Flip-Engineering/baton/issues/644).
- [#598: Remove mechanisms that serve no observed failure: hypothetical hardening, check-in gating, redundant durability, property accounting](https://github.com/Flip-Engineering/baton/issues/598).
- [#592: Production architecture for waking the root and seats (the #564 configured-target implementation is rejected and removed)](https://github.com/Flip-Engineering/baton/issues/592).
- [#539: Rewrite Baton in Bend2: language review, adversarial architecture review, laws file, and rewrite plan](https://github.com/Flip-Engineering/baton/issues/539).
- [#530: Hardcoded numeric ceilings gate real work throughout the goal/plan policy and beyond — remove the control-flow pattern, not just retune the numbers](https://github.com/Flip-Engineering/baton/issues/530).
- [#714: Simplify agent inbox commands with a contextual action grammar](https://github.com/Flip-Engineering/baton/issues/714).
- [#696: Baton2: recover lost retained custody and checkpoint stream observation](https://github.com/Flip-Engineering/baton/issues/696).
  Active adoption found 78 released attempts retained by the original owner.
  The current semantic observer PID 8117 was sampled waiting in SQLite; a later
  kernel lock query identified historical observer PID 8681 holding the rollback
  database's pending and reserved writer bytes. These are separate observations
  and require current process identities before recovery. Preserve full streams,
  immutable manifests, checkpoints and actual owner/recovery-child lifetimes.
  The scoped public accessor shares manifest and native-birth validation with
  ordinary recovery and preserves acknowledged and unstarted exclusions.
  Postrelease 2.0.0 `serve` refused the historical Muse implementer attempt
  recorded as `exited` / `start failed`: its valid manifest and `launch` remain,
  while `native.birth` and `native-start-error` are absent. Track this failed-start
  recovery boundary with [#712](https://github.com/Flip-Engineering/baton/issues/712);
  the new owner was elected and retained zero attempts and observers.
  On 2026-10-17, seven retained portfolio attempts had raw stdout ending in a
  NUL-corrupted tail beyond the last valid checkpoint. The pinned 2.0.0 receiver
  returned NUL22 before provider launch. The original logs, checkpoints, native
  UUIDs and pending inputs remain preserved. The isolated recovery candidate is
  on source HEAD `35152919ad99f1938c76dfa8db33f2b1ebfa762d`; its invalid-tail
  helper has SHA256
  `feeaac508b11a55ff1fa1a6e1f72e9d3350b691f385b2d84ff0740b67c8c37d4` and
  passed a focused type check in 359 ms. The combined emergency `-O0` Main build
  is running from that source. Acceptance still requires bounded-memory
  receive and checkpoint recovery with the original bytes and pending input
  preserved. An exact-hash review is assigned to the existing `rewrite-deepseek`
  session. The deployed OMP producer correction remains tracked in
  [#769](https://github.com/Flip-Engineering/baton/issues/769), with follow-on
  retry behavior in [#786](https://github.com/Flip-Engineering/baton/issues/786).
- [#676: Baton2: share one native instance across connected agents](https://github.com/Flip-Engineering/baton/issues/676).

  Follow-up 2026-10-17: the separate clean-stream `knowledge-deepseek` setup
  failure was repaired through the supported Baton `receiver` action. Its
  pending dispatch `dispatch:bb56091c-a309-43eb-a490-fb89f4dc0909` is now read
  under UUID `01a147c2-99b1-7000-bcb7-cbaea84d2e53`; attempt
  `receive:knowledge-deepseek:42:8e458cd46f641dd816c5b02d89530874` is running
  with a running execution. The input receipt remains pending. The failed Kimi
  quota report `receive:rewrite-kimi:893:4e9ee3cd15600e2468722b117b5d22b8`
  remains unacknowledged; its #769 scope was routed to the existing DeepSeek
  native as guidance `message:rewrite-tooling:a8c03fce4bfa7a5adebc8d2ab5660f1f`,
  read under the same native UUID in attempt 941. The exact-hash review update
  `message:rewrite-tooling:d915a4983290d89d7fcf8de3fd8b212e` is admitted to the
  same DeepSeek UUID and was read under attempt
  `receive:rewrite-deepseek:984:691184f811a59c6b8a14f0707ae2ba0e`; its review
  report is pending delivery. Source tracing corrected the review's initial
  concern: the full-spool witness gates successful input settlement, while
  process-attempt retirement is a separate exited-and-released transition. The
  nonempty NUL error leaves the owed input unsettled. Normal exit-zero
  acknowledgement unlinks stdout, so the pure Bend2 candidate must keep an
  exit-zero NUL tail incomplete; custody-proven owner loss can retire the dead
  process attempt with the original spool, checkpoint, native UUID and input
  retained. Failed-observation retirement after exit zero remains a separate
  process-acknowledgement task tracked by #696, #769 and #786. See
  [#796](https://github.com/Flip-Engineering/baton/issues/796) and the
  [October 17 #696 update](https://github.com/Flip-Engineering/baton/issues/696#issuecomment-6228856867).
  The original fframes attempt 694 exited with status 0. A guarded configure
  then set `fframes-lead` to `muse-wonder-1.0` at high effort, preserving UUID
  `01a1475d-d987-7bf2-8968-b31165d91a60`. The retained coordinator task was
  resumed once on the same UUID after identifying open child work. Guidance
  `message:operator:a7c7a1da93eb2e889a164f7c1b54ed87` was read under attempt
  `receive:fframes-lead:735:5e1acf5a17c271f828ce9dce9bef577d`; the session remains
  running on the standard model, with no unread inbox items. The latest owned
  report `report:0e6847548dfc53dde2bb0f3696682fe0` says `native-gpu` is actively
  editing `fframes-3d/src/gpu/mod.rs` and should remain undisturbed.
  `material-shader` has repeated queued-message preemption that prevents tool
  calls from executing; the lead reports additional guidance would worsen the
  queue. Simulation and quality had exited on Kimi quota; their routes have
  since been guardedly changed to DeepSeek Flash and their same-UUID
  continuations are running. No new SHAs were reported; tips remain `3e6d9da`
  and `0ee836f`, with parity incomplete.

  At the terminal windows for `simulation` attempt 743 and `quality` attempt
  681, guarded `configure --expected-model kimi-code/k3` changed each route to
  `deepseek/deepseek-flash`. Both stayed on the OMP harness, retained their
  existing endpoints and native UUIDs, and resumed through the configure wake.
  `simulation` is running attempt
  `receive:simulation:743:e6ef015825d0940a0669fdaaa1b5d69e` on UUID
  `01a14713-d3b8-7000-b15a-112318059965`; PID 275354/birth 577257 matches its
  native birth record. It owns 11 pending reads, including the retained task
  continuations, and its stdout/checkpoint are 726751/423 bytes. `quality` is
  running attempt `receive:quality:681:ba9ce72234e0ee01c934eeab81d32c9f` on UUID
  `01a14714-293d-7000-b23e-1d3738750b6e`; PID 278344/birth 583887 matches. It
  owns both pending inputs and its stdout/checkpoint are 92238/332 bytes. The
  prior Kimi quota reports remain in both ledgers; no new Kimi turn was started.
  These are active continuations, not completed implementation or quality
  evidence.

  The reports describe a five-hour quota window but provide no reset timestamp
  or `Retry-After`; the reset time is unknown. A read-only `omp usage
  --provider kimi-code --json --redact` query returned no Kimi usage report.
  The default OMP store in the seats' HOME has one `kimi-code` OAuth credential
  disabled after `invalid_grant`, updated 2026-10-06 18:51:01 UTC, and no Kimi
  usage-history or cooldown rows. The saved seat command has no explicit API
  key, profile or config override, and the owner environment contains no
  credential variable names. The historical 403 does not identify its token,
  so credential binding remains unproven. Track OAuth refresh separately under
  [#793](https://github.com/Flip-Engineering/baton/issues/793); no Kimi retry
  or credential mutation was performed.

  At 02:55 UTC, user units `acp-render-farm.service` and
  `acp-render-farm-gpu1.service` were active with four running render containers
  and two sampled worker processes using 120% Blender CPU and 97% Python CPU.
  The bounded NVIDIA sample showed 0% GPU utilization; GPU0 admission reported
  thermal or power-brake code `0x20` at 47 C, GPU1 was 63 C, and GPU3 remained
  user-held. These samples show active CPU work and do not establish completed
  GPU rendering. No GPU controls were used.
  At 03:02 UTC, both user units were still active. A bounded `nvidia-smi`
  sample showed UUID `GPU-1a60290b-b538-1ac7-9a81-3978d3b12c60` at 22% GPU,
  49 C and 49.28 W; `GPU-b7aaa373-d194-a71f-539d-e0a10dbfc4ce` was at 0%,
  67 C and 64.17 W; user-held `GPU-b983e9da-46fc-ecd8-1449-53e039430591`
  was at 0%, 57 C and 41.62 W. This shows GPU0 rendering activity while the
  other sampled lanes remain idle; no GPU controls were used.
