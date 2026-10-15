# Baton todo

The [open GitHub issues](https://github.com/Flip-Engineering/baton/issues?q=is%3Aissue%20is%3Aopen)
retain findings, ownership and acceptance requirements. This page links current
Baton follow-up work for contributors. Every open issue has a link on this page.

- [#738: Judge initial-input handling fixtures when the baseline admits a successor](https://github.com/Flip-Engineering/baton/issues/738).
  Target workflow `38679395337` retains the first complete native result while
  its receive child admits the still-unhandled task again. The initial-input
  fixture observes either child exit or that actual successor and reports the
  full prompt, original delivery and retained turns on a contradictory start.
  Preserve its implicit handling receipt and open assignment assertions.
  Qualify the same contract on target and candidate with
  [#717](https://github.com/Flip-Engineering/baton/issues/717) and
  [#723](https://github.com/Flip-Engineering/baton/issues/723).

- [#736: Preserve full branch history messages in native landing qualification](https://github.com/Flip-Engineering/baton/issues/736).
  Exact candidate `57b471e9` completed its builds and failed `land-test` twice
  with `land K: candidate message differs from the branch history` in run
  `38679395337`. The isolated exact-source remote reproduction retained full
  commit messages, Git objects and toolchain custody. Both stored landing bodies
  match the required messages; the test's Git log format adds a record newline.
  Read the body with `--format=format:%B` before removing its final newline.
  The corrected isolated native test passes; full source qualification remains
  open. This blocks
  [#717](https://github.com/Flip-Engineering/baton/issues/717); selected-commit
  behavior remains tracked by [#673](https://github.com/Flip-Engineering/baton/issues/673).

- [#735: Judge managed attachment fixtures when their follower producer exits](https://github.com/Flip-Engineering/baton/issues/735).
  Target workflow `38660325053` records the endpointless short admission and
  a following Baton producer exit with signal 11 before its App follower connects.
  The managed follower passed NUL-separated arguments to a host operation that
  expects length-prefixed arguments. Use the existing length-prefixed encoder.
  The endpointless and recorded-endpoint fixtures observe that terminal failure
  during their first connection waits and return complete verdicts. Workflow
  `38662128510` reached the recorded-endpoint setup failure after judging the
  endpointless case. Workflow `38675555092` judged both cases and reached the
  same producer failure in the managed-settlement fixture. All managed App
  attachment waits, including the route-change prewait and second attachment,
  now observe the completed failure through the shared callback. Preserve
  full source, database, output and process
  evidence and all admission, settlement, guidance, receipt and stop assertions.
  Qualify target and candidate with
  [#717](https://github.com/Flip-Engineering/baton/issues/717),
  [#727](https://github.com/Flip-Engineering/baton/issues/727),
  [#718](https://github.com/Flip-Engineering/baton/issues/718),
  [#720](https://github.com/Flip-Engineering/baton/issues/720) and
  [#734](https://github.com/Flip-Engineering/baton/issues/734).

- [#734: Give the failed-session fixture ownership of its serve task](https://github.com/Flip-Engineering/baton/issues/734).
  Target workflow `38658463280` retains the actual provider failure through a
  detached dispatcher. The fixture then waits for the serve to emit that completed
  failure. Preserve complete source, database, spool and process evidence and
  configure the fixture so the serve owns the failure it asserts. Retain all
  provider, concurrent native, late subscription and terminal checks. Qualify the
  same contracts on target and candidate with
  [#717](https://github.com/Flip-Engineering/baton/issues/717),
  [#727](https://github.com/Flip-Engineering/baton/issues/727) and
  [#675](https://github.com/Flip-Engineering/baton/issues/675).

- [#733: Use authorized native credentials without interactive access dialogs](https://github.com/Flip-Engineering/baton/issues/733).
  Configure supported native credential stores for unattended Baton dispatch,
  resumption and contributor reports. The homelab Muse credential setup completed
  through its supported stdin operation and retains private file permissions.
  Verify actual native operations with credential-free evidence and preserve
  existing accounts and keyring access controls. Qualify this route with
  [#727](https://github.com/Flip-Engineering/baton/issues/727),
  [#717](https://github.com/Flip-Engineering/baton/issues/717) and
  [#702](https://github.com/Flip-Engineering/baton/issues/702).

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

- [#729: Resume stored native replies when the observer reconnects](https://github.com/Flip-Engineering/baton/issues/729).
  The target in workflow `38649718256` retains a complete pending native reply
  while its restored observer cursor equals the complete spool. The observer,
  native input and selected fixture form a closed wait cycle. The implementation
  derives pending replies from the recorded attempt during reattachment and
  retains transport, authority, complete bodies, stops and native identity. The
  fixture now checks a causal recovery boundary. Original evidence was preserved
  before the completed controlled stop. Candidate `5d36d95a` failed normal term
  checking because an earlier helper referenced the later `resume_pending`
  definition. The correction passes the drain continuation into those helpers;
  the send, error and reply-selection behavior stays unchanged. Candidate
  `7b5e7e1a` then reached the retained-output caller and identified its reused
  affine `attempt` argument. The caller now declares that shared String explicitly.
  Remote
  qualification remains open with
  [#717](https://github.com/Flip-Engineering/baton/issues/717),
  [#723](https://github.com/Flip-Engineering/baton/issues/723),
  [#725](https://github.com/Flip-Engineering/baton/issues/725),
  [#726](https://github.com/Flip-Engineering/baton/issues/726) and
  [#728](https://github.com/Flip-Engineering/baton/issues/728).

- [#728: Repair native C generation after compiler exits with status 132](https://github.com/Flip-Engineering/baton/issues/728).
  Candidate `3b37ad3f` completes term checking and exits during C generation
  in workflow `38649718256`. Preserve its complete output, pinned compiler,
  source and host evidence. Diagnose the demonstrated compiler failure while
  preserving all command and task behavior. The diagnostic completed three C
  emission passes and exited with SIGILL during its fourth pass. Its complete
  phase stream ends during `legacy_cli` emission and retains repeated CLI costs.
  Moving the fourteen-argument recovery flag comparison into a Boolean helper
  passed term checking on `6c1e0a5a`; workflow `38675555092` then exited with a
  trace/breakpoint trap after 1234.820655 seconds and produced no C output.
  The earlier diagnostic records millions of intermediate operations in the
  legacy argument matcher. The compiler expands its leading `--project` String
  pattern through character and bit constructors and copies the long fallback
  argument patterns into those branches. The source correction compares that
  head with `String.eq` before entering the unchanged argument-count patterns.
  Preserve project precedence, complete arguments and all recovery fallbacks.
  C output, candidate tests, package verification and installed adoption remain incomplete for
  [#717](https://github.com/Flip-Engineering/baton/issues/717). Coordinate with
  [#722](https://github.com/Flip-Engineering/baton/issues/722),
  [#723](https://github.com/Flip-Engineering/baton/issues/723) and
  [#727](https://github.com/Flip-Engineering/baton/issues/727).

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
  [#728](https://github.com/Flip-Engineering/baton/issues/728) records the
  current candidate C-generation failure and its diagnostic evidence.
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

- [#726: Read the registered generation in the legacy keeper recovery fixture](https://github.com/Flip-Engineering/baton/issues/726).
  The legacy attachment marker is complete in the registered attempt generation.
  The fixture waits on its absent base path. Resolve the recorded generation and
  preserve the legacy recovery, native identity, custody and terminal assertions.
  Qualify the corrected contract on target and candidate for
  [#717](https://github.com/Flip-Engineering/baton/issues/717), retaining the
  original incomplete run and its full evidence. Coordinate with
  [#725](https://github.com/Flip-Engineering/baton/issues/725) and
  [#705](https://github.com/Flip-Engineering/baton/issues/705).

- [#725: Settle recovered direct turns after an earlier immutable failure report](https://github.com/Flip-Engineering/baton/issues/725).
  A completed profile retry records a successful native terminal, then recovery
  exits with a report identity conflict and leaves the execution running. Preserve
  the original failure report and full native output while settling the recovered
  turn. The fixture must observe the actual recovery refusal and produce a complete
  verdict. Qualify the repair in the [#717](https://github.com/Flip-Engineering/baton/issues/717)
  release, with [#705](https://github.com/Flip-Engineering/baton/issues/705),
  [#712](https://github.com/Flip-Engineering/baton/issues/712),
  [#713](https://github.com/Flip-Engineering/baton/issues/713) and
  [#720](https://github.com/Flip-Engineering/baton/issues/720).

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
  Candidate qualification is also blocked by the C-generation failure in
  [#728](https://github.com/Flip-Engineering/baton/issues/728).

- [#722: Repair composed coordinator parsing](https://github.com/Flip-Engineering/baton/issues/722).
  The pinned native compiler ended with SIGTRAP on `57e67d1d` and `ef735693`.
  A retained remote Node diagnostic of the compiler derivative ended during
  `Main.normal_cli` lowering with a stack overflow; native crash attribution
  remains unverified. Preserve the complete grammar and output while repairing
  source representation. Exact compiler, target/candidate and package acceptance
  block the [#717](https://github.com/Flip-Engineering/baton/issues/717) release.
  [#728](https://github.com/Flip-Engineering/baton/issues/728) records the later
  failure after complete term checking during C generation.

- [#721: Add Antigravity CLI agent harness support](https://github.com/Flip-Engineering/baton/issues/721).
  Verify the supported CLI protocol and add dispatch, resumption, complete
  events, provider settings, receiver controls and coordinator reporting.
  Preserve native identity, pending work and explicit stops. Qualify the
  packaged harness remotely and through ordinary installed use. Coordinate
  with [#671](https://github.com/Flip-Engineering/baton/issues/671),
  [#703](https://github.com/Flip-Engineering/baton/issues/703),
  [#713](https://github.com/Flip-Engineering/baton/issues/713) and
  [#715](https://github.com/Flip-Engineering/baton/issues/715).

- [#718: Coalesce pending-input notices during failed Codex turns](https://github.com/Flip-Engineering/baton/issues/718).
  Repeated provider failures appended the same pending-input notice to the
  recorded conversation. Deliver committed input once for the current admission,
  retain failed-turn causes, and wake the coordinator for its next-work decision.
  Qualify recovery, new input, operator stops and recipient acknowledgements on
  the affected target and candidate. Verify the packaged and active helper.

- [#720: Stop unchanged completion-request continuations](https://github.com/Flip-Engineering/baton/issues/720).
  Workers awaiting a coordinator's completion confirmation repeatedly generated
  self-addressed continuations and reports. Derive continuation from the current
  assignment and completion request. Preserve terminal evidence, new guidance,
  recipient receipts and the coordinator's exact completion confirmation.

- [#717: Publish and activate the current Baton release](https://github.com/Flip-Engineering/baton/issues/717).
  Version 2.0.0 includes all qualified command, grammar and syntax improvements
  from #714, #715 and #716 with #713, #718 and #720. The README name is `Baton`.
  Qualify the composed source on remote runners, publish its exact tag and
  platform artifacts, and install the complete package through the ordinary
  command path. Retain active conversations, managed work, prior installation
  prefixes and explicit stops during receiver migration. Active adoption
  includes the original owner with 78 released, unacknowledged
  attempts. Reconcile its current retained execution through selected observer
  recovery, preserve complete historical streams before physical acknowledgement,
  and verify the old owner's actual exit before claiming complete adoption.
  [#696](https://github.com/Flip-Engineering/baton/issues/696) and
  [#705](https://github.com/Flip-Engineering/baton/issues/705) cover this recovery.
  Unfinished feature acceptance remains recorded in its original issues.
  [#727](https://github.com/Flip-Engineering/baton/issues/727)
  owns real-agent validation input, instruction updates and acceptance.
  [#728](https://github.com/Flip-Engineering/baton/issues/728) blocks candidate
  C generation and its downstream qualification.

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
  in [#696](https://github.com/Flip-Engineering/baton/issues/696),
  [#705](https://github.com/Flip-Engineering/baton/issues/705) and
  [#676](https://github.com/Flip-Engineering/baton/issues/676).

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

- [#711: Baton2: preserve authored numeric precision in scientific knowledge reads](https://github.com/Flip-Engineering/baton/issues/711).
- [#710: Define structured causal and evidentiary Knowledge nodes and edges with provenance and uncertainty](https://github.com/Flip-Engineering/baton/issues/710).
- [#709: Make Baton2 the main branch after current delivery settles](https://github.com/Flip-Engineering/baton/issues/709).
- [#708: Large native frames keep receive observers busy after model exit](https://github.com/Flip-Engineering/baton/issues/708).
- [#707: Baton2: expose useful shared object evaluation and agent handoff](https://github.com/Flip-Engineering/baton/issues/707).
- [#706: Adopt an unreaped retained turn when new input arrives](https://github.com/Flip-Engineering/baton/issues/706).
- [#704: Repair an absent receiver when replaying a completed direct turn](https://github.com/Flip-Engineering/baton/issues/704).
- [#702: Baton2: multiple Claude and Codex subscriptions with usage-exhaustion fallback](https://github.com/Flip-Engineering/baton/issues/702).
- [#694: Baton2: expose OpenCode Go usage limits and availability to orchestrators](https://github.com/Flip-Engineering/baton/issues/694).
- [#686: Baton2: reduce log volume with practical verbosity and cleanup](https://github.com/Flip-Engineering/baton/issues/686).
- [#685: Pending notifications must wake idle seats or require inbox review](https://github.com/Flip-Engineering/baton/issues/685).
- [#684: Baton2 orchestra must not emit orphaned section memberships](https://github.com/Flip-Engineering/baton/issues/684).
- [#682: Baton2: optional live browser view of Orchestra structure and status](https://github.com/Flip-Engineering/baton/issues/682).
- [#681: Baton2: preserve pending work when a provider quota failure requires model failover](https://github.com/Flip-Engineering/baton/issues/681).
- [#680: Baton2: stale quota failures prevent current provider use](https://github.com/Flip-Engineering/baton/issues/680).
- [#679: Baton2 native checks fail before replay assertions on a large report argument](https://github.com/Flip-Engineering/baton/issues/679).
- [#678: Baton2: existing Players cannot change their configured provider through native controls](https://github.com/Flip-Engineering/baton/issues/678).
- [#677: Baton2: prevent duplicate heavy validation and qualify remote execution placement](https://github.com/Flip-Engineering/baton/issues/677).
- [#675: Baton2: qualify hosted parallel Bend2 validation](https://github.com/Flip-Engineering/baton/issues/675).
- [#674: Native landing advances a checked-out branch without updating its worktree](https://github.com/Flip-Engineering/baton/issues/674).
- [#673: Native landing cannot select a reviewed commit while a Player continues](https://github.com/Flip-Engineering/baton/issues/673).
- [#672: Direct turns admit replacement while the previous child survives observer loss](https://github.com/Flip-Engineering/baton/issues/672).
- [#670: Baton2: classify OMP model errors separately from host exit status](https://github.com/Flip-Engineering/baton/issues/670).
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
- [#705: Reconcile a completed retained attempt before admitting its next turn](https://github.com/Flip-Engineering/baton/issues/705).
  Public selected-observer recovery now reads the current released custody
  awaiting acknowledgement. Ordinary receive admission and direct-turn checks
  retain their existing unreleased selection so a completing observer can deliver
  its report while owed work continues. Qualify the released observer handoff,
  complete report replay, original native continuation, stops and final custody
  acknowledgement with [#717](https://github.com/Flip-Engineering/baton/issues/717).
- [#696: Baton2: recover lost retained custody and checkpoint stream observation](https://github.com/Flip-Engineering/baton/issues/696).
  Active adoption found 78 released attempts retained by the original owner.
  The current semantic observer PID 8117 was sampled waiting in SQLite; a later
  kernel lock query identified historical observer PID 8681 holding the rollback
  database's pending and reserved writer bytes. These are separate observations
  and require current process identities before recovery. Preserve full streams,
  immutable manifests, checkpoints and actual owner/recovery-child lifetimes.
  The scoped public accessor shares manifest and native-birth validation with
  ordinary recovery and preserves acknowledged and unstarted exclusions.
- [#676: Baton2: share one native instance across connected agents](https://github.com/Flip-Engineering/baton/issues/676).
