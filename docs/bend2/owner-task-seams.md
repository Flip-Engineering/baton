# Receive-facing task API and command-to-phase mapping signatures

This document proposes concrete Bend signatures for the receive-facing task
boundary of one native owner process: the task entry and result types,
request-local invocation capture, the command-to-phase mapping, and reply
correlation. It reviews commit `fca7af876c8260c32d17f95f3e19bc68ee1bf561`.

All cited line numbers are at that commit. Unqualified file names are in
`bend2/src/coordinator/`; host files are named with their directory, for
example `host/process.bend` for `bend2/src/host/process.bend`.

The design is a proposal for the Receive, Control, Delivery and synthesis
owners. This document claims no edit authority in any owned region. It
composes `docs/bend2/shared-owner-task-custody-design.md` (owner instance,
duty records, failure isolation, custody process) and supplies the task-level
signatures that design's section 12 names.

## 1. Current request shape

Each fact below was read from this worktree at `fca7af87`.

- The CLI entry parses argv into one `C.Command` and unwraps results with
  `IO.try`: `main.bend:run` (`main.bend:64-68`), `main.bend:execute`
  (`main.bend:82-152`). `C.Receive` reaches `Receive.run` through one more
  `IO.try` (`main.bend:131-132`); `--recover-receive` reaches
  `Receive.recover` the same way (`main.bend:253-255`).
- Durable operations commit through one `BEGIN IMMEDIATE` transaction per
  command: `store.bend:commit` (`store.bend:28-30`) and `store.bend:apply`
  (`store.bend:31-34`), which routes committed messages to endpoint delivery
  through `store.bend:accepted` (`store.bend:7-12`) and
  `Delivery.after` (`delivery.bend:82-89`).
- Detached dispatch commits the message first, then launches
  `baton2 --dispatch-message DATABASE ID` as a detached child:
  `control.bend:dispatch_body` (`control.bend:158-162`) and
  `control.bend:dispatch_admitted` (`control.bend:149-157`). The detached
  child runs `control.bend:deliver` (`control.bend:201-204`).
- Receive admission acquires the session guard, resolves the recorded
  retained attempt, and writes the `executions` slot:
  `receive.bend:acquired_recorded` (`receive.bend:233-238`),
  `receive.bend:selected` (`receive.bend:183-205`),
  `Stop.admit` (`stop.bend:13-17`, SQL at `stop.bend:10-12`).
- The native child is spawned under a per-attempt keeper that retains stdin,
  stdout and `waitpid` authority: `Turn.retained` (`turn.bend:355-362`,
  `ProcessChild.retain` at `host/process.bend:26-29`) and recovery
  attachment (`receive.bend:218-226`, `receive.bend:265-273`,
  `ProcessChild.attach` at `host/process.bend:31-33`,
  `ProcessChild.attach_owned` at `host/process.bend:35-37`).
- Observation threads all state as parameters of one recursive reader:
  `Turn.consume` (`turn.bend:295-330`). Its completion path runs
  `receive.bend:observed` (`receive.bend:142-148`), then
  `receive.bend:completed` (`receive.bend:100-107`) or
  `receive.bend:restart_pending` (`receive.bend:124-135`), then
  `receive.bend:finish_pending` (`receive.bend:88-98`).
- Client output is one process-global fd 1 writer:
  `Text.control_output` (`host/text.bend:9-10`) backed by
  `baton_control_output_call` (`host/text.c:71-82`), which holds
  `flockfile(stdout)` and writes to `STDOUT_FILENO`.
- Native UI requests are keyed by `(attempt, native_id)` in SQLite and
  delivered to the original attempt's keeper socket:
  `native-requests.bend:schema` (`native-requests.bend:13-15`),
  `native-requests.bend:request_sql` (`native-requests.bend:16-21`),
  `native-requests.bend:dispatch` (`native-requests.bend:22-26`).

## 2. Task entry and result

### 2.1 Immutable request context

One record binds every task to its owner, database, session and request. The
owner instance token and the canonical database come from the custody design
(section 1 there); the request id is the caller-chosen correlation id that
today rides in the command argv (`MESSAGE_ID` for dispatch,
`control.bend:158`; the wake message for receive, `receive.bend:258`; the
turn id, `control.bend:224`).

```bend
type OwnerContext is Data:
  OwnerContext{owner: String, database: String, session: String, request: String}
```

The record is created once at admission and never mutated; diagnostics and
duty records copy it. Proposed successor of the loose argv threading in
`control.bend:149-157`, `receive.bend:258-263` and `stop.bend:117-123`.

### 2.2 Original attempt context

One record carries the admitted attempt's identity for the task's whole
life, including historical finish duties after a newer attempt replaces the
`executions` row. Proposed successor of the parameter list threaded through
`receive.bend:completed` (`receive.bend:100-107`) and of the observation
state in `Turn.consume` (`turn.bend:296`).

```bend
type ChildRef is Data:
  ChildRef{handle: U32, owner: String, generation: U32}

type GuardRef is Data:
  GuardRef{handle: U32, owner: String, session: String}

type Observation is Data:
  Observation{cursor: String, last_message: String, terminal: String,
              filter: String, codex_log: String, first_error: String,
              sender: Chan(Result<&1,&1,U32 & String,Unit>),
              deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>}

type AttemptContext is Data:
  AttemptContext{id: String, directory: String, cutoff: String,
                 native: String, capability: Maybe<ChildRef>,
                 guard: Maybe<GuardRef>, observation: Maybe<Observation>}
```

- `id` is the attempt identity `receive:<session>:<cursor>:<hex16>`
  (`receive.bend:198-199`); `directory` is `<db>.attempt-<hex(id)>`
  (`receive.bend:201-202`); `cutoff` is the inbox cursor read at
  `receive.bend:209`.
- `capability` is present only while this task owns a live keeper handle;
  `generation` and `owner` implement the stale-rejection contract of the
  custody design section 7 (`baton_children` indices are process-local and
  monotonic, `host/process.bend:51-79`).
- `guard` is present only while the task holds the acquired session guard
  (`SessionLock.acquire_session`, `host/session-lock.bend:16-20`).
- `observation` names the consume fields verbatim from `turn.bend:296`;
  `Turn.retained_output` (`turn.bend:349-353`) is its recovery constructor.

### 2.3 Native outcome and finish results

The native model/process/observer outcome keeps the existing shape
(`Turn.Outcome`, `turn.bend:20-22`) and gains a named type. The notification,
settlement, ACK and client-output results become values the task owns, each
recorded under the attempt identity.

```bend
type NativeOutcome is Data:
  Ended{status: String, event: String, error: String}

type WakeOutcome is Data:
  Delivered{report: String}
  Outstanding{report: String, reason: String}
  Unavailable{code: U32, rule: String}

type SettleOutcome is Data:
  Settled{count: U32}
  SettleFailed{code: U32, error: String}

type AckOutcome is Data:
  Acknowledged{}
  AckFailed{code: U32, error: String}
  NoCapability{}

type OutputOutcome is Data:
  Written{}
  OutputFailed{code: U32, error: String}

type ExitStatus is Data:
  ExitOk{}
  ExitFailed{code: U32, text: String}

type FinishResults is Data:
  FinishResults{delivery: WakeOutcome, settlements: SettleOutcome,
                ack: AckOutcome, continuation: WakeOutcome,
                output: OutputOutcome, exit: ExitStatus}
```

Each constructor's current producer:

- `NativeOutcome`: `P.ProcessChild.wait` through `Turn.status_text`
  (`turn.bend:124-127`), event selection in `Turn.consume`
  (`turn.bend:312-327`), `start failed`/`input failed` constructions at
  `receive.bend:168` and `turn.bend:454`.
- `WakeOutcome`: `Delivery.deliver` (`delivery.bend:70-76`) through
  `Delivery.wake_result` (`delivery.bend:90-93`), `Stop.deliver`
  (`stop.bend:102-107`), the stopped-recipient handoff
  (`delivery.bend:48-57`), the empty-endpoint completion
  (`delivery.bend:28-30`), the sealed-observe completion
  (`delivery.bend:78-79`). `Outstanding` names an admitted delivery whose
  final result is not yet observed (section 4.3).
- `SettleOutcome`: `NativeRequests.settle` (`native-requests.bend:92-101`)
  joining the per-request delivery channels.
- `AckOutcome`: `ProcessChild.acknowledge` (`host/process.bend:54-56`) at
  `receive.bend:105` and `receive.bend:134`. `NoCapability` names the
  synthetic done on the unstarted path (`receive.bend:172`), which
  acknowledges no handle because none exists.
- `OutputOutcome`: `Text.control_output` results at `receive.bend:46-50`
  (`receive_status`), `turn.bend:42`, `turn.bend:107`, `turn.bend:117`.
- `ExitStatus`: `receive.bend:exit_status` (`receive.bend:51-55`) combined
  last in `receive.bend:finish_pending` (`receive.bend:88-98`).

### 2.4 Task result and entry signatures

```bend
type RefusalPhase is Data:
  TransportRefused{}
  AdmissionRefused{}

type Refusal is Data:
  Refusal{phase: RefusalPhase, code: U32, rule: String}

type TaskResult is Data:
  Refused{refusal: Refusal}
  Attempted{attempt: AttemptContext, native: Maybe<NativeOutcome>,
            finish: FinishResults}
```

`Refused` is the pre-admission refusal: no custody, no cleanup
responsibility, no notification duty (custody design section 2). It carries
the phase so a caller can tell an argv-level rejection from an
admission-level one. `Attempted` is every post-admission outcome: the task
owns the attempt identity and records the native outcome and all finish
results, each of which may carry its own failure.

```bend
type TaskInput is Data:
  ReceiveWake{cmd: String, model: String, effort: String, cwd: String,
              log: String, invocation: Invocation}
  DispatchBody{id: String, sender: String, recipient: String,
               kind: String, body: String}
  DispatchTurn{player: String, id: String, harness_cmd: String,
               task: Invocation, log: String}
  NativeReply{record: RequestRecord, response: String}
  StopRequest{id: String, reason: String, force: Bool}

def Task.receive(ctx: OwnerContext, input: TaskInput) -> IO(TaskResult)
def Task.dispatch(ctx: OwnerContext, input: TaskInput) -> IO(TaskResult)
def Task.reply(ctx: OwnerContext, input: TaskInput) -> IO(TaskResult)
def Task.stop(ctx: OwnerContext, input: TaskInput) -> IO(TaskResult)
```

Current functions each entry succeeds:

- `Task.receive`: `Receive.run` (`receive.bend:257-263`), the admitted
  pipeline `receive.bend:240-255` through `receive.bend:142-148` and
  `receive.bend:88-107`, and the keeper-invoked recovery entry
  `Receive.recover` (`receive.bend:275-276`, reached from
  `main.bend:253-255`).
- `Task.dispatch`: `Control.dispatch_file` (`control.bend:163-167`),
  `Control.dispatch_turn` (`control.bend:224-244`), and the in-process
  store route `Store.apply` plus `Delivery.after`
  (`store.bend:31-34`, `delivery.bend:82-89`).
- `Task.reply`: `NativeRequests.reply` (`native-requests.bend:119-124`).
- `Task.stop`: `Stop.run` (`stop.bend:117-123`).

### 2.5 Failure isolation rule

No proposed signature contains `IO.die` or `IO.try`. Every refusal below
becomes a `Refused` value returned to the requesting client, and every
post-admission `IO.try` unwrap on these paths becomes a recorded
`FinishResults` failure under the attempt identity. Root source review
recorded in the custody design section 4 establishes the halt semantics:
`IO.try` and `IO.die` end the whole process, and a forked fiber does not
catch the halt.

Refusal sites the successors convert, with their current values:

| Site | Current behavior | TaskResult successor |
| --- | --- | --- |
| `receive.bend:245-248` (`registered`) | `IO.die(2)` unregistered session | `Refused{AdmissionRefused, 2, rule}` |
| `stop.bend:26-30` (`require_open`) | `IO.die(2)` terminal stop | `Refused{AdmissionRefused, 2, rule}` |
| `stop.bend:50-54` (`error_result`) | `IO.die(2, error)` stop validation | `Refused{AdmissionRefused, 2, rule}` |
| `turn.bend:477-481` (`supported_harness`) | `IO.die(2)` unsupported harness | `Refused{AdmissionRefused, 2, rule}` |
| `turn.bend:482-487` (`matching_turn`) | `IO.die(2)` foreign turn id | `Refused{AdmissionRefused, 2, rule}` |
| `turn.bend:496-505` (`player_checked`) | `IO.die(2)` at `turn.bend:498` unregistered player | `Refused{AdmissionRefused, 2, rule}` |
| `turn.bend:530-534` (`retained_receive_admitted`) | `IO.die(2)` retained receive blocks direct turn | `Refused{AdmissionRefused, 2, rule}` |
| `turn.bend:542-549` (`acquired`) | `IO.die(2)` at `turn.bend:544` active turn | `Refused{AdmissionRefused, 2, rule}` |
| `control.bend:80-84` (`registered`) | `IO.die(2)` unregistered session | `Refused{AdmissionRefused, 2, rule}` |
| `control.bend:85-89` (`command_present`) | `IO.die(2)` empty harness command | `Refused{TransportRefused, 2, rule}` |
| `control.bend:112-116` (`receiver_result`) | `IO.die(2)` receiver refused | `Refused{AdmissionRefused, 2, rule}` |
| `control.bend:144-148` (`startup_refused`) | `IO.die(2)` principal conflict | `Refused{AdmissionRefused, 2, rule}` |
| `control.bend:149-157` (`dispatch_admitted`) | `IO.die(2)` at `control.bend:151`, law-pinned at `control.bend:192-200` | `Refused{AdmissionRefused, 2, rule}` |
| `control.bend:209-213` (`turn_admitted`) | `IO.die(2)` inactive player | `Refused{AdmissionRefused, 2, rule}` |
| `control.bend:214-218` (`task_path`) | `IO.die(2)` stdin `-` for a detached turn | `Refused{TransportRefused, 2, rule}` |
| `control.bend:47-51` (`identity_check_refusal`) | `IO.die(2)` unmapped model key | `Refused{TransportRefused, 2, rule}` |
| `main.bend:21-25` (`output`), `main.bend:82-86` (`execute`) | `IO.die(1)` empty answer, `IO.die(2)` invalid command | outside the task body: the CLI adapter maps `Refused` to exit status and text |

The `IO.try` unwraps that stay outside the shared task body are the
single-client CLI termination adapters: `main.bend:64-68`,
`main.bend:131-132`, `main.bend:231-235` (keeper), and
`main.bend:253-255` (recovery entry). Inside the task body, each converted
site gains a law pinning the refusal value and the next action, imported
through the real native entry (`main.bend:1-4` imports `laws.bend`).

## 3. Request-local invocation capture

### 3.1 Current capture points

| Input | Captured where | Form at capture | Cite |
| --- | --- | --- | --- |
| dispatch-file body | client process, before any durable effect | full bytes of the task file | `Text.Text.read(path)` at `control.bend:165` |
| dispatch-turn task | path canonicalized at dispatch; bytes read later by the turn child | absolute path (`Control.output`), then bytes at admission | `control.bend:232-233`, `turn.bend:473` |
| receive prompt | committed messages under the attempt cutoff, read once at selection | durable rows concatenated | `receive.bend:200`, cutoff at `receive.bend:209` |
| observe/native-reply/ask/message `-` file bodies | client process stdin | full bytes | `Text.read("-")` opens stdin (`host/text.c:19`), used at `main.bend:137,142,146,150` |
| cwd | resolved to an absolute directory at startup or dispatch | `Control.workspace` realpath | `host/control.bend:3-5`, `control.bend:171` |
| output log | resolved to an absolute path at dispatch | `Control.output` (realpath of the directory, joined base) | `host/control.bend:6-8`, `control.bend:234` |
| harness command | resolved to an absolute executable at dispatch | `Control.command` (realpath or `PATH` search) | `host/control.bend:9-11`, `control.bend:231` |

Immutability today: the dispatch-file body and the receive prompt are
durable rows committed under one transaction, and the store's message
identity guard (`commands.bend:message_upsert` at `commands.bend:158-160`,
`commands.bend:exact_message` at `commands.bend:212-214`) keeps the
committed bytes stable. The dispatch-turn task bytes are read twice: once at
dispatch (`control.bend:233`, a readability check whose value is dropped)
and once at admission inside the turn child (`turn.bend:473`). The child
receives the canonical path (`control.bend:243`), so a file replaced between
dispatch and admission changes the input the attempt executes.

### 3.2 Proposed capture types and signatures

```bend
type TaskBytes is Data:
  Bytes{body: String}
  FrozenPath{path: String}

type Invocation is Data:
  Invocation{cwd: String, log: String, task: Maybe<TaskBytes>,
             harness_cmd: Maybe<String>}

def Capture.cwd(path: String) -> IO(Result<&1,&1,U32 & String,String>)
def Capture.log(path: String) -> IO(Result<&1,&1,U32 & String,String>)
def Capture.executable(path: String) -> IO(Result<&1,&1,U32 & String,String>)
def Capture.stdin() -> IO(Result<&1,&1,U32 & String,String>)
def Capture.task(path: String, stdin: Bool)
  -> IO(Result<&1,&1,U32 & String,TaskBytes>)
```

These succeed the existing host resolvers, whose contracts stay unchanged:
`Control.workspace` (`host/control.bend:3-5`), `Control.output`
(`host/control.bend:6-8`), `Control.command` (`host/control.bend:9-11`),
`Text.read` (`host/text.bend:3-5`). `Capture.stdin` succeeds
`Text.read("-")` (`host/text.c:19`).

### 3.3 Rules

- Capture happens in the request's client process, before any durable
  effect. The owner receives captured values; it resolves no path against
  its own working directory and reads no client stream. The client process
  is `main.bend:cli` (`main.bend:258-265`) today and keeps that role.
- Every path is resolved to an absolute path at capture time. After
  capture, the value is immutable and the task and the durable record use
  only the captured value.
- A dispatch-file request freezes bytes: `Capture.task` returns `Bytes`,
  `Task.dispatch` commits them in the admission transaction, and the
  attempt observes the committed rows (`control.bend:158-166` shape).
- A dispatch-turn request freezes bytes under this proposal: `Capture.task`
  returns `Bytes`, the admission transaction stores them under the turn
  id, and the turn child reads the stored value. The current
  readability-only read at `control.bend:233` and the child's re-read at
  `turn.bend:473` are replaced by one captured value. This closes the
  window recorded in section 3.1; the alternative, a declared frozen-path
  re-read contract, is an owner decision (section 4.3).
- Receive freezes the cutoff and the committed bodies at selection
  (`receive.bend:196-205`); the attempt identity embeds the cutoff, and
  `receive.bend:pending_count_sql` (`receive.bend:69-71`) reads only input
  committed above it.
- The owner process never changes its own working directory and never
  mutates its own environment. Children receive their working directory
  through the spawn file actions of their explicit `cwd` parameter
  (`posix_spawn_file_actions_addchdir_np` at
  `host/process-spawn.c:70` and `:380`, `git/process.c:76`), and the
  detached dispatch child receives the launcher's environment through the
  explicit `environ` reference at spawn time (`host/control.c:7,149`).
  The custody design section 11 replaces that reference with an explicit
  child environment parameter; this document's capture layer supplies the
  per-request values for it.
- Delivery endpoint children need the same explicitness. `Delivery.launch`
  passes `"."` as the endpoint child's cwd (`delivery.bend:31`), so the
  endpoint resolves relative paths against the serving process's working
  directory at delivery time. Under one owner serving many sessions, the
  proposal passes the captured `Invocation.cwd` (or the recipient session's
  recorded workspace) into an explicit endpoint-cwd parameter; the decision
  is recorded in section 4.3.

## 4. Command-to-phase mapping

### 4.1 The four phases

- P1 transport accepted: the request is parsed and argv-level validation
  passed. Anchors: `main.bend:execute` (`main.bend:82-152`),
  `control.bend:command_present` (`control.bend:85-89`),
  `control.bend:task_path` (`control.bend:214-218`).
- P2 durable operation admitted: one transaction committed the operation
  and its identity. Anchors: `store.bend:commit` (`store.bend:28-30`),
  `Stop.admit` (`stop.bend:13-17`), the `native_requests` transaction
  (`native-requests.bend:72`), the receiver/principal transactions
  (`control.bend:123`, `control.bend:174`).
- P3 endpoint executed: the external side effect ran. Anchors:
  `Delivery.launch` (`delivery.bend:27-35`),
  `ProcessChild.control_write` (`host/process.bend:44-46`),
  `ProcessChild.retain`/`attach` (`host/process.bend:26-37`),
  `Control.launch` (`host/control.bend:15-16`).
- P4 final report delivered: the outcome is recorded and the owed
  notification, settlement, ACK and client answer are observed complete.
  Anchors: `Delivery.deliver` results, `Stop.deliver`
  (`stop.bend:102-107`), `receive.bend:finish_pending`
  (`receive.bend:88-98`), `main.bend:print_result` (`main.bend:26-29`).

### 4.2 Mapping table

| Command | P1 transport accepted | P2 durable operation admitted | P3 endpoint executed | P4 final report delivered | P4 owner |
| --- | --- | --- | --- | --- | --- |
| `dispatch-file` | `main.bend:execute` `C.DispatchFile` (`main.bend:87-90`) | `Store.commit(C.Message)` (`control.bend:160`); refusals `store.bend:refused` (`store.bend:21-23`), session-stopped via `store.bend:route_accepted` shape checked at `control.bend:161` | `Control.launch` of `--dispatch-message` (`control.bend:153-156`) | `Control.deliver` runs `Delivery.deliver` (`control.bend:201-204`); the delivery-log append is `delivery.bend:19-26` | detached child; launching caller exits after P3 with the PID (`control.bend:155-157`) |
| `dispatch-turn` | parse at `main.bend:91-94`; stdin refusal `control.bend:214-218` | `Store.commit(C.Session)` plus admission reads (`control.bend:226-230`); the direct-mode slot is written later by the turn child's `Stop.admit` (`turn.bend:471-472`, `stop.bend:13-17`) | `Control.launch` of the `turn` entry (`control.bend:243`) | turn child: `record_exit`, `prepare`, guard release, forked `Turn.finish`, `Delivery.wake_pending` (`turn.bend:513-524`) | turn child; caller exits after P3 |
| `message`/`ask`/`report` | `main.bend:run` (`main.bend:64-68`) | `Store.commit` in `Store.apply` (`store.bend:28-34`); route refusals `store.bend:7-23` | `Delivery.after` → `deliver` → `launch` (`delivery.bend:82-89`, `70-76`, `27-35`); empty endpoint completes at `delivery.bend:28-30` | the returned `Result<&1,&1,U32 & String,String>` is the CLI answer (`main.bend:26-29`); handoff unavailable is `Fail` (`delivery.bend:46,57`) | calling client, synchronous |
| `observe` | `main.bend:run` | `Store.apply(C.Observe)` (`store.bend:28-34`) | sealed: none, `Done` (`delivery.bend:78-79`); unsealed: `deliver` of the terminal report | delivery result returned to the caller | calling client, synchronous |
| `native-reply` | `main.bend:execute` `C.NativeReply` (`main.bend:135-136`) | `response_sql` admission and store, `changes()` check (`native-requests.bend:103-105,121`); refusal `native-requests.bend:106-110` | `send` → `dispatch` → `ProcessChild.control_write` (`native-requests.bend:32-39,22-26`) | `written=1` status JSON (`native-requests.bend:27-31`); already-written short circuit `native-requests.bend:111-118` | calling client, synchronous |
| `stop`/`force-stop` | `main.bend:execute` (`main.bend:83-84`) | `request_sql`/`force_sql` transaction (`stop.bend:41-49`) | `reconcile` → `control_signal` (`stop.bend:80-91`, `host/process.bend:48-50`) | `Stop.run` prints the stop result row (`stop.bend:117-123`, SQL at `stop.bend:34-37`); the stop report message is delivered by the attempt's finish duty (`stop.bend:102-107`) | calling client for the result row; the attempt task for the report |
| retained `receive` — completion | `Receive.run` wake id (`receive.bend:257-263`); queued answer `receive.bend:46-50,240-243` | guard acquire (`host/session-lock.bend:16-20`), recorded-attempt resolve (`receive.bend:233-238`), `Stop.admit` (`receive.bend:204`, `stop.bend:10-17`); empty-input exit `receive.bend:183-188` | `Turn.retained` → `ProcessChild.retain` (`turn.bend:355-362`); recovery `attach_owned`/`attach` (`receive.bend:218-226,265-273`); launch failure `receive.bend:167-172` | `observed` (`receive.bend:142-148`): `record_exit` (`stop.bend:97-101`), then `completed` (`receive.bend:100-107`) or `restart_pending` (`receive.bend:124-135`) | receive client, synchronous |
| retained `receive` — finish duties | — (same task) | stop report committed inside `exited_sql` (`stop.bend:92-101`) | forked `Turn.finish`: parent deliveries `id:observation`, `id`, `id:exit`, `Stop.deliver` (`turn.bend:100-122`), delivery-log append `delivery.bend:19-26` | `finish_pending` joins delivery, settlement (`native-requests.bend:92-101`), ACK (`receive.bend:105`), continuation (`receive.bend:72-76`), combines with `exit_status` (`receive.bend:88-98`) | receive client, synchronous |
| retained `receive` — continuation | — (same task) | none; reads unreceipted input above the cursor (`receive.bend:69-76`) | the next `again()` cycle re-enters admission (`receive.bend:258-263`) | `continue_pending` join (`receive.bend:92,97`); after release the wake read is `Delivery.wake_pending` (`delivery.bend:101-105`) | same task; a queued wake may be consumed by a later attempt (custody design section 2) |
| `--dispatch-message` child | `main.bend:cli` internal branch (`main.bend:248-252`) | none (message already durable) | `Delivery.deliver` (`control.bend:201-204`) | delivery result discarded today; log append only (`delivery.bend:24`) | unowned (section 4.3) |
| `--recover-receive` | `main.bend:253-255` | none (attempt already admitted) | `ProcessChild.attach` (`receive.bend:265-273`) | same as completion rows | recovering process |

### 4.3 Paths the mapping cannot express without an owner decision

1. **Detached dispatch has no recorded P4.** `dispatch-file` and
   `dispatch-turn` return at P3 with the launched PID
   (`control.bend:155-157`, `control.bend:243`), and the
   `--dispatch-message` child discards its delivery result
   (`control.bend:201-204`). No durable record ties the detached child's
   final delivery outcome to the originating request id. The custody
   design section 10 requires the outcome to be recorded under the
   original correlation; the owner must decide the duty-record field that
   carries it and which process writes it. `Task.dispatch`'s `WakeOutcome`
   reserves `Outstanding` for exactly this admitted-but-unobserved state.
2. **dispatch-turn freezes a path today.** The dispatch process validates
   the task file (`control.bend:233`) and the turn child re-reads it at
   admission (`turn.bend:473`). Section 3.3 proposes bytes-at-dispatch;
   the alternative is a declared frozen-path contract. The owners must
   pick one, because the phase table treats P2 as the moment the input is
   fixed.
3. **Endpoint child working directory.** `Delivery.launch` passes `"."`
   (`delivery.bend:31`), so an endpoint child resolves relative paths
   against the serving process's working directory at delivery time. The
   owner must decide whether the endpoint cwd is the request's captured
   cwd or the recipient session's recorded workspace, and the endpoint
   signature gains that explicit parameter.
4. **Synthetic ACK on the unstarted path.** `receive.bend:172` supplies a
   done ACK callback for a launch that never produced a handle, so the
   finish duties cannot distinguish "acknowledged" from "nothing to
   acknowledge". `AckOutcome.NoCapability` names the second state; the
   owner must confirm the enumeration treats them as one fulfilled ACK
   responsibility (custody design section 9) or as two.
5. **Cutoff revision after adoption.** `receive.bend:reconciled_cursor`
   (`receive.bend:149-155`) resets the attempt cutoff to `0` when an
   adopted keeper-loss observation has no event or error, so the
   continuation's P2 identity changes after admission. The phase table has
   no cutoff-revision event; the owner must either declare the revision as
   part of the recovery semantics or name the continuation a new request.
6. **Concurrent old-attempt P4 and new-attempt P2.** `restart_pending`
   forks the old attempt's recovery delivery and enters the fresh attempt
   in the same invocation (`receive.bend:130-133`). One `TaskResult` per
   request cannot carry two live attempts; the duty record of the custody
   design section 2 is the carrier, and the mapping table needs the
   cross-attempt row the owners ratify.
7. **Client output as the final report.** The no-parent finish branch
   writes the outcome JSON to fd 1 and returns it as the delivery answer
   (`turn.bend:110-118`), and `Turn.report` drops the `control_output`
   result (`turn.bend:39-44`) while `player_finished` combines it
   (`turn.bend:107-108`). Under the sink-targeted output successor
   (custody design section 3), the owner must decide whether the client
   answer and the notification report are one `OutputOutcome` or two.

## 5. Reply correlation

### 5.1 Identity inventory

| Layer | Form | Anchor |
| --- | --- | --- |
| External request id | caller-chosen `MESSAGE_ID`, stop id, or wake message id | `control.bend:158`, `stop.bend:41-45`, `receive.bend:258` |
| Domain message id | `messages.id`, derived ids `id:recovery-input`, `id:recovery`, `id:observation`, `id:exit`, `id:deferred`, `stopped-input:<hex>` | `commands.bend:158-160,212-214`; `receive.bend:110-115`; `turn.bend:39-44,100-108,220-235`; `delivery.bend:39-42` |
| Turn/attempt id | `receive:<session>:<cursor>:<hex16>`; `executions` row `(session,id,mode,directory,phase)` | `receive.bend:198-202`; `stop.bend:10-12` |
| Session id | `sessions.id` with parent link and report recipient | `commands.bend:169-171` |
| Local child capability | process-local `U32` index into `baton_children` | `host/process.bend:51-79` |
| Native request id | `<turn>:native:<hex(native_id)>`, unique per `(attempt, native_id)` | `native-requests.bend:13-21` |

### 5.2 Stable native request identity

The request row freezes the correlation at observation time:
`native_requests.id` is built from the turn id and the native event id;
`worker` (the session), `parent`, `attempt`, `native_id`, `method` and the
full `event` are recorded in one transaction
(`native-requests.bend:16-21`, applied at `native-requests.bend:72`). The
JSON-RPC `id` of the native frame is stored data (`native_id`), and the
reply frame's id is rebuilt from the stored row
(`json_patch(json_object('id',r.native_id),...)` at
`native-requests.bend:103-105`). The stable identity is
`(attempt, native_id)`; the client-facing request id is the derived
`native_requests.id` that the parent question carries as `requestId`
(`native-requests.bend:19`).

Closure is per attempt: `NativeRequests.closed` marks unanswered requests
`native-exited` when the attempt's observation ends
(`native-requests.bend:82-86`), and cancel events close the targeted
request (`native-requests.bend:18`).

### 5.3 Same-request-different-input refusal

The upsert admits a repeated observation only when the stored `worker`,
`parent` and `event` all match the new frame; on any difference the upsert
nulls `native_requests.id`
(`ON CONFLICT(attempt,native_id) DO UPDATE SET id=CASE WHEN ... ELSE NULL END`,
`native-requests.bend:17-18`). Every later lookup by that request id then
finds no row, and `NativeRequests.refused` answers with the
`unknown-request` condition
(`native-requests.bend:106-110`). Reply admission additionally requires the
recorded parent, an open request, a non-stopped worker session, and a
single-key response object shaped for the recorded method
(`native-requests.bend:32-39,103-105`); the already-written short circuit
returns the `stdin-written` status for a fulfilled request
(`native-requests.bend:111-118`).

### 5.4 Proposed signatures

```bend
type RequestKey is Data:
  RequestKey{attempt: String, native_id: String}

type RequestRecord is Data:
  RequestRecord{key: RequestKey, id: String, worker: String, parent: String,
                request: String, method: String, event: String,
                reply: Maybe<String>, written: Bool, closed: Maybe<String>}

type ReplyPlan is Data:
  ReplyPlan{frame: String, target: String}

def Requests.observe(ctx: OwnerContext, attempt: AttemptContext, event: String)
  -> IO(Result<&1,&1,U32 & String,RequestRecord>)

def Requests.admit_reply(ctx: OwnerContext, record: RequestRecord,
                         response: String) -> Result<&1,&1,U32 & String,ReplyPlan>

def Requests.execute_reply(ctx: OwnerContext, record: RequestRecord,
                           plan: ReplyPlan) -> IO(SettleOutcome)
```

- `Requests.observe` succeeds `NativeRequests.observe` and `record`
  (`native-requests.bend:75-81,66-74`); the pure same-input check moves
  into a law-pinned decision beside the transaction.
- `Requests.admit_reply` succeeds the SQL admission of
  `native-requests.bend:32-39` and `response_sql`
  (`native-requests.bend:103-105`) as a typed value; refusals become
  `Fail` with the `refused` context (`native-requests.bend:106-110`).
- `Requests.execute_reply` succeeds `dispatch` + `written`
  (`native-requests.bend:22-31`): one `control_write` to the original
  attempt's keeper socket (`host/process.bend:44-46`) and the `written`
  settlement record. The request id, the JSON-RPC id and the destination
  attempt are read only from `record`; nothing addresses the live
  capability of the observing task.

## 6. Scope and handoffs

The signatures above are proposals. The regions and their owners, as
recorded in the custody design's boundary table, are unchanged by this
document: `receive.bend` and `turn.bend` successors belong to the Receive
owner, `control.bend` and `main.bend` entry successors to synthesis,
`delivery.bend` successors to the Delivery owner, the `executions` slot to
the shared stop semantics owner, `host/process.bend` parameters to the
Controls owner, and `host/text.bend`/`text.c` output to synthesis. This
document adds the task-level type names those owners can adopt and the
phase vocabulary for their landing reviews. No compilation, build or test
was run for this document; all evidence is source reading at `fca7af87`,
per the operator execution boundary.
