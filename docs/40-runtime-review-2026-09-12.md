# Runtime review and scope corrections

Review began 2026-09-12; follow-up 2026-09-13. Initial local and remote revision: `67904d59`. First implementation
checkpoint: `baeaa777`. This review concerns the actual harness and the intended swarm system,
not only the workflow DSL. [The revised design](39-swarm-runtime.md) governs subsequent work.

## Assessment

Baton has useful foundations: native session adapters, attributable events, durable authority,
workspace ownership, separate worker claims and verification, and multiple control surfaces.
The problem is the way these pieces are coupled. Too many decisions about how agents should work
have become universal runtime rules. Some contradict the stated fleet-driver purpose in
[the corrected north star](19-north-star-corrected.md).

A continuously collaborating swarm is not a collection of immutable function calls. Work can
begin with an incomplete description. Findings can change the plan. Review can overlap editing.
Several participants can contribute to one problem; one participant can work on several problems.
A persistent agent session is not finished merely because it has supplied one contribution.
Conversely, a useful change can be accepted while its author remains available.

The corrective direction is to separate participant, work, group, workspace, contribution and
acceptance identities, and attach constraints to the operations that need them. Structured
commands are appropriate for effects with authority. Ordinary agent conversations and tentative
findings need no universal input/output schema. Reproducible snapshots are valuable for specific
checks and publication; they should not freeze all live context.

## Findings and disposition

| Finding | Why it matters | Disposition |
| --- | --- | --- |
| `createWave` awaited each member's start and approval before starting the next | Slow admission serialized independent work before the coordinator's existing concurrent dispatch | Concurrent admissions implemented and authored by a real OMP worker; deterministic roster and per-member failures retained |
| Workflow drive treated failed peers, elapsed silence and repeated unreadable status as reasons to end the wave | Healthy or merely slow peers lost their work window; uncertainty was treated as lifecycle authority | Independent survivors continue; explicit terminality and observer shutdown are separate; silence is observational |
| Terminal members plus an empty harvest could yield `WAVE-OK` | Failed, denied or stopped work appeared successful | Successful phases, actual harvest and known cleanup are required; failed partial contributions remain recoverable |
| `verifiedBy` contained a requested profile that the interpreter did not execute | Receipts overstated their evidence | Renamed to `verificationRequested`; native acceptance verification remains independently recorded |
| Workflow bootstrap staged and committed the caller's dirty checkout | Unrelated user work acquired an agent-authored commit and index mutations | Removed; deployment-pinned base is used. A real driver regression test checks byte-identical index and caller files |
| Capture happened before close, while close could make a later snapshot | Useful work survived physically but vanished from the result receipt | Post-close capture is collected and closure errors/unknown residue remain visible |
| Worker messaging accepted replies only, and one response consumed a broadcast's reply slot | Peer initiation and independent fan-in required root-orchestrator relaying | Current active run/wave membership authorizes initiation; each sender has a reply slot; queued delivery rechecks authority |
| OMP exposed `interaction.requested`, while coordinator consumed `question.asked` | Adapter-only tests passed although an ordinary user could not answer native questions | Actual native-shaped input/select/confirm/cancel frames are tested through coordinator attention and native responses |
| Catalog aliases obscured live canonical commands, and visualization was advertised without a CLI handler | Discovery and execution disagreed | Canonical command rows restored; CLI visualization implemented with existing snapshot/watch authority |
| Undriven Claude completion triggered a policy nudge whose new turn answered that nudge and repeated the cycle | One finished change generated hundreds of redundant completion turns | Reproduced live and repaired by a Baton-managed OMP worker; pausable checkpoints await explicit claim/continuation, with no automatic prompt or expiry verdict |
| Claude `total_cost_usd` was emitted as a delta on each native result | Cumulative native totals appeared to be charged repeatedly | Native cumulative USD is converted to process-generation deltas; duplicate result UUIDs are ignored and replayed init frames do not reset the ledger. Do not infer actual spend from the former faulty aggregate |
| Public MCP size errors retained the error code but lost actionable limits | Agents could not correct a rejected request from its receipt | Safe byte-limit coaching restored with internal exceptions redacted; MCP inventory now names the legitimate scratchpad addition |

The source seams are [wave admission](../impl/src/wave.mjs),
[workflow settlement](../impl/src/workflow-interpreter.mjs),
[coordination](../impl/src/coordinator.mjs), [native OMP](../impl/src/omp-rpc.mjs),
[native Claude](../impl/src/claude-session.mjs),
[surface ownership](../impl/src/surface-capability-catalog.mjs), and
[CLI convergence](../impl/src/production-cli-convergence.mjs).

## Structural gaps that remain

**Groups and dependencies.** A durable wave supplies useful membership evidence, but it is not
yet a general mutable collaboration group. Dynamic recruitment, regrouping, shared context
ownership and dependencies on selected events/artifacts need runtime operations. They should not
be implemented by recompiling a whole immutable DAG or demanding predecessor completion. A tight
subgroup can choose an exclusive writer, barrier or quorum without imposing it on outside peers.

**Native capability preservation.** The ordinary brief previously said to use only tools named
in the brief, although native harness tools are not exhaustively enumerated there. That language
now preserves configured tools, skills, context management and delegated agents within the granted
authority. OMP also stops injecting blanket capability-disabling flags: installed 17.4.0 source
confirms that RPC does not require disabling skills, extensions, rules or LSP. Its native plain
RPC mode still does not provide interactive PTY bash. Removing the flags does not change that native limitation. An explicit immutable Context call can retain its own narrower input contract.
Runtime credential isolation also changes HOME/config locations; therefore preserving the selected
native customization requires explicit support, rather than assuming that starting the executable
preserves its normal skills/plugins/settings. Do not copy an entire credential home as a substitute.

**OMP identity and usage.** Native assistant `message_end` events now feed live token/USD
accounting and observed provider-qualified model identity. The native token metric includes cache
reads/writes. Process generation and turn identity scope the counters; start/end boundaries avoid
replaying a completed message while allowing a real subsequent call with identical contents.
Terminal messages provide fallback when no streaming coverage exists; unverified aggregate
telemetry is not added. Incomplete coverage cannot certify a full usage seal. Native costs below
the ledger's nanodollar precision round upward, with the original amount retained; absent amounts
remain unreported. Ordinary native errors/aborts retain incurred usage and cannot claim successful
work. Actual model changes remain observable; configured effort is not invented as observed effort.
The provider-governance parser now accepts native qualified IDs and context suffixes while keeping
exact route matching. Tool events use canonical lifecycle phases. Native pre-effect enforcement
and provider-call enumeration remain unavailable; the card states those limits.

A separate native Claude agent authored the accounting helper, which root revised after adverse
review and integration. Its direct CLI contribution is not Baton acceptance. A captured native
OMP review stream supplies 41 real assistant calls: replay accounts 5,025,726 native tokens (including
cache) and $0.051988253 in the canonical ledger, with no terminal aggregate double-count. Raw
native amounts total approximately $0.0519882328; the difference is the documented rounding.
All 139 OMP/governance checks, 24 production checks, the surface audits and packed installation
pass at this follow-up. The full-suite release limitation below remains.

**Native subagents.** Baton currently has more evidence for the adapter's main process than for
the harness's delegated participants. Native delegation should remain available, with clear
statements about what Baton can observe, steer, budget and close. A capability card must not claim
complete descendant lifecycle accounting merely because it owns the root process group.

**Workspaces.** Private worktrees are a useful choice, not the definition of collaboration.
Shared group editing needs attributed ownership and conflict handling. Acceptance can identify a
specific revision while ongoing work keeps evolving. Runtime/config isolation is explicitly not OS
filesystem containment; path checks alone also cannot establish that guarantee.

**RPC and process truth.** The original shared ACP transport retried timed-out effectful RPCs with
new identities and reported some kills confirmed before observing process/group death. A timeout
is an unknown result, not permission to replay an effect; sending a signal is not evidence of
closure. Both paths were repaired by a separate native worker using the existing process latch; late
responses to settled issued requests are harmless, while unknown request identities still fail.
OMP had the same unsupported replay assumption and also derived correlation IDs from payloads,
letting identical concurrent commands overwrite each other. A further native worker gave each send
its own identity and made timeout notifications observational, retaining the original pending
response. Observer exceptions and reentrant settlement cannot crash or leak that observation loop.

**Event processing and recovery.** `Coordinator`, `BatonApplication` and `CoordinationStore` total
roughly 47,000 lines at the first checkpoint. Their mixing of admission, observation, recovery,
projection and effects makes local changes difficult to validate. Repeated store scans and large
snapshot/projection work can obstruct the same process that services controls. Extract components
by owned authority and lifecycle, retaining the existing event history; avoid a wholesale rewrite.
Recovery should progress from lifecycle evidence without requiring an operator to keep inspecting.

**Limits and routing.** Static route lists, model names and blanket verification commands age
badly. The initial resident profile named four OMP routes and used `true` as its verifier. The updated
example includes native Codex and Claude, permits caller-selected routes/checks, and defaults to
the repository test command. Dynamic runtime discovery still needs further work. Route availability, provider/model/effort
selection, current account capacity and observed identity are different facts. Concurrency should
follow real host/provider constraints; arbitrary fixed worker counts are not a swarm design.

Wave observations now use independent per-member loops and one caller deadline, with cancellation
separate from worker lifetime. Healthy members can finish and contribute results while another
member's status remains hung. Concurrent observers share one drive per member; cancelled but
unsettled drives remain tracked, and earlier invocations cannot overwrite later receipts. Result
pin reads use abortable subprocesses, with only fallback attribution ordered across the roster.
`progress` and `settle` accept caller signals. A signal-ignoring facade can still leave an observer
unconfirmed; `close` reports that uncertainty alongside explicit member-stop receipts. The result
section is read when a member is first observed resting; a result published later may require
another observation. Local checks pass 39/39 for observer/admission/driver/transport behavior,
36/36 for observer/checkpoint behavior, and 57/57 for adjacent wave/workflow surfaces.

The native observer author committed useful work, but a live disk-capacity refusal at capture
prevented Baton acceptance. Baton preserved the exact commit and closed with zero remaining
owned resources. The receipt also exposed OMP replaying its last native steering message as a
fresh turn: the same-test regression fails before the repair, and the repaired steering/native
integration checks pass 32/32. Native steering now stays with its native queue; only an explicit
continuation starts a subsequent turn. This does not claim to fix the separate OMP usage gap.

An [independent native Claude review](reference/evidence/selfdev-2026-09-12/independent-review-followup.json)
of `6692d712` found further observer and interrupt inconsistencies. Wave evidence now reads current
drive ownership: neither late closure nor a newer active observation inherits an old drainage
flag. All 86 wave observation/driver checks pass. OMP interruption now binds the target turn and
requires both its terminal event and a successful correlated abort response before confirming.
The target cannot also enter contribution acceptance. Follow-up text is delivered once after that
boundary; repeated interrupts share the issued abort and a kill withdraws continuation. The same
prior-source tests reproduce the callback TypeError and duplicate-effect faults. Coordinator
integration verifies that acceptance is suppressed and the successor is in flight. A nudge can
continue an idle session or steer an active one, while unknown modes refuse before effects.
This review used read-only native CLI tools in the existing checkout after fresh-workspace
capacity was refused; it is independent review evidence, not a Baton-accepted self-build.

Concurrent deployment startup also reproduced a
worktree-reconciliation refusal; its original cause remains unconfirmed. A separate minimal
reproduction proved that generic reconciliation deleted a live verification sandbox without an
error. The follow-up removes that unscoped cleanup for verification and integration directories:
explicit owner cleanup remains, and unattributed candidates are retained with diagnostics. Four
new behavioral checks include a real verifier process reading its cwd after reconciliation; the
combined worktree/integration/ownership checks pass 71/71. Durable auxiliary-operation ownership
and process-closure evidence are still required for automatic orphan reclamation. A further creation-race fix tolerates another controller creating
the same authority directory, then validates that directory; a symlink still refuses before Git
effects. All 41 auxiliary/worktree checks pass after that change. Preservation
can therefore retain abandoned disk contents; it does not claim that those resources were closed.
These are tracked gaps, not claims of complete dynamic-swarm support.

The remote tracker already names related gaps: [mutable groups #162](https://github.com/Flip-Engineering/baton/issues/162),
[worker message initiation #206](https://github.com/Flip-Engineering/baton/issues/206),
[OMP attention #255](https://github.com/Flip-Engineering/baton/issues/255),
[live steering #248](https://github.com/Flip-Engineering/baton/issues/248), and
[verification failure digests #149](https://github.com/Flip-Engineering/baton/issues/149).
This pass addresses specific paths within those reports; it does not close entire issues from title overlap.

## Available harnesses and the integration boundary

Local executable discovery found Codex, Claude Code, OMP, Gemini CLI 0.37.0, OpenCode 1.14.28 and
Droid. This is executable availability, not proof of authentication, model capacity or complete
Baton support. Codex, Claude and OMP were used for actual concurrent self-development in this pass;
Codex later reached its account limit. [Live read-only ACP initialization](reference/evidence/selfdev-2026-09-12/acp-discovery.json)
also succeeded for Gemini and OpenCode, and both owned process groups were observed absent after
closure. No provider prompt or authentication claim is inferred from that handshake.

Gemini exposes an ACP stdio interface with session and cancellation controls. OpenCode also
exposes ACP; its current documentation describes model/effort selection, multiple sessions and
native skills. Droid exposes a long-lived JSON-RPC control mode in addition to one-shot execution.
Installed CLI help must be checked alongside documentation: for example, this Droid build says
model/autonomy/effort CLI flags are ignored in JSON-RPC mode and must be set in protocol requests.
[Gemini ACP documentation](https://geminicli.com/docs/cli/acp-mode/),
[OpenCode ACP documentation](https://opencode.ai/v2/docs/cli/acp/),
[Droid control documentation](https://docs.factory.ai/droid-exec/overview).

These are concrete additional adapter paths. A shared ACP transport can handle framing,
correlation and process ownership; it should not silently assume identical authentication,
permissions, model controls, session resumption or native delegation semantics. Negotiate and
record those differences. Do not reduce all harnesses to a one-shot command because that is the
smallest common interface.

## Evidence and release honesty

[Native run receipts](reference/evidence/selfdev-2026-09-12/native-runs.json) distinguish:

- OMP's change accepted by Baton after a real fresh-worktree check: base exit 1, result exit 0.
  The gate's base lacked the new test file, so its `redGreen` flag alone is not same-test regression
  proof. Root separately ran the new concurrency test against original source: it fails on the
  missing second admission, while all three tests pass against the changed source.
- Codex's committed catalog change preserved after a provider account limit, then locally checked.
- Claude's committed visualization change preserved after the completion-loop failure, then
  locally checked. Root integration removed a temporary alias workaround after the actual catalog
  fix landed; the native commit is evidence of authorship, not the final integrated source alone.

Focused integration, production convergence and packed installation checks pass at the first
checkpoint. The first full worktree sweep reported 4,477 tests: 3,790 passed, 491 failed and 196 cancelled.
[Its failure inventory](reference/evidence/selfdev-2026-09-12/full-suite-failures.jsonl) is discovery
evidence; follow-on edits were in progress, so it is not an exact-revision acceptance run. An
isolated original-revision run reports 4,445 tests: 3,746 passed, 508 failed and 191 cancelled.
[Its inventory](reference/evidence/selfdev-2026-09-12/baseline-suite-failures.jsonl) and
[comparison candidates](reference/evidence/selfdev-2026-09-12/suite-comparison.json) distinguish shared
failures from changed observations; those differences alone do not establish causation.
The catalog parity artifact was regenerated, and its test now uses an owned temporary directory.
The old snapshot test searched for a one-line object literal; it was retired in favor of the
behavioral `workflow-swarm-lifecycle` test that checks capture during closure reaches the receipt.
An empty `expected-red.json` is not proof that there is no unresolved work: the shipped-suite
script separately omits filenames ending in `-red.test.mjs`, including tests for shipped behavior.
Neither filename conventions nor stale historical counts establish release acceptance.

The stable `89661c1f` run reports **4,502 tests: 3,839 pass, 468 fail, 195 cancelled**.
[Its failure inventory](reference/evidence/selfdev-2026-09-12/stable-89661c1f-suite-failures.jsonl)
and [baseline comparison with follow-up dispositions](reference/evidence/selfdev-2026-09-12/stable-suite-comparison.json)
record the exact revision and distinguish observed regressions from obsolete contracts and fixture
failures. Follow-up checks pass 92/92 across browser/orientation/native-driver/oracle behavior,
9/9 across persistent-session cases, and 33/33 across OMP transport and deployment seams.
The core coordinator suite also passes 58/58 after correcting its obsolete expectation that
`list()` admits deadline effects. The first pending test had cancelled 47 following cases before
they ran; explicit escalation now checks that unconfirmed resources remain owned. These targeted
passes do not turn the remaining full-suite failures into expected results.

A fresh native Claude self-build on that stable base authored the oracle deadline repair,
completed exactly one native turn with zero automatic nudges, and exposed a checkpoint. Root
reviewed its commit and issued `claim_turn`; Baton accepted the result after actual fresh-worktree
verification and then closed with zero owned resources. Native model identity was observed as
`claude-sonnet-4-6`; recorded cost was $0.9040269. This validates the repaired completion path in a
real harness. Multiple-result cost deltas are additionally covered by deterministic adapter tests.

At the initial remote review there were no open PRs. The latest `master` CI run executed no verification steps
because the requested self-hosted runner labels had no available matching runner; an earlier
hosted run was blocked by account budget. The unrelated Flip runner is not a Baton CI resource. The revised workflow defaults to a GitHub-hosted
runner and permits an administrator-selected `BATON_RUNNER_LABELS` JSON array. This removes the
missing-label dependency without changing account budgets. [Draft PR #256](https://github.com/Flip-Engineering/baton/pull/256)
publishes the reviewed branch. Its [hosted CI run](https://github.com/Flip-Engineering/baton/actions/runs/34742633299)
successfully acquired a runner, installed dependencies and started the full suite; completion was
still pending at this checkpoint. No passing CI or merge acceptance is claimed.
[Latest reviewed CI run](https://github.com/Flip-Engineering/baton/actions/runs/32467651667),
[earlier hosted run](https://github.com/Flip-Engineering/baton/actions/runs/32433183018).

The practical acceptance target is observable collaboration and recoverable useful work across
real native harnesses, with specific checks supporting specific claims. The remaining work should
be selected from these gaps as the swarm discovers what it needs; this review is not a mandatory
sequence or a requirement to enumerate all future work upfront.
