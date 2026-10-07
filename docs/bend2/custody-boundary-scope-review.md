# Custody design boundary and scope review

Independent review of the shared owner task, custody and concurrency design and
its module. Reviewer: session `native-critic-boundary-scope`, under
`native-instance-owner`. This review edits no reviewed file.

## Reviewed artifacts

Read-only from the owner worktree
`.scratch/semantic-context-20261005/worktrees/native-instance-owner`
(branch `native-instance-owner-custody`, HEAD `6fbd75bc`):

| Artifact | SHA-256 at review time |
| --- | --- |
| `docs/bend2/shared-owner-task-custody-design.md` | `716028edb1293826e47af80d4e6c75d5343ef2e3d4a468581c455e50352e431d` |
| `bend2/src/context/custody-tasks.bend` | `f36c717abd98b783574dd1ba36f9865d580068887eed3834b993cd88c4dc4b7f` |
| `bend2/test/native-instance-owner/custody-tasks.bend` | `a8396804b7f75904700c09f63063300d8c9c6853ef47e05e02b7d0aaf211ee29` |
| `bend2/test/native-instance-owner/run.py` | `cfb78d24d53ba85849bad1b360ac5819e5e9bbc8f0ec2bba5831ffd48cfadfd2` |

The design document and the module are additions on the owner branch. They are
absent from `fca7af876c8260c32d17f95f3e19bc68ee1bf561`
(`git ls-tree -r fca7af87 -- <paths>` returns nothing for them). Source
citations were therefore verified against my own worktree checked out at
`fca7af87`, which is the commit the design names as its reference.

## Verdicts

| Check | Verdict |
| --- | --- |
| 1. Boundary compliance | Partial. Receive/Turn, Stop, ProcessChild/Direct, Main/Commands/MCP and Text carry handoff markers; Delivery does not, and the boundary table claims two further instance modules. |
| 2. Scope | Pass. No service framework, no second messaging path, no agent cap, no new keeper or lifecycle service inside the module, and no grant admitted by the module. |
| 3. Source grounding | Pass with corrections. Every cited file:line resolves to the claimed content. Seven imprecisions are listed below. |
| 4. Runtime-halt claims | Pass. Reproduced on a remote runner with my own probe; raw evidence below. |
| 5. Writing style | Fail. The contrast-to-absent-alternative pattern and one metaphor recur, concentrated in the last quarter of the document. |

No blocking finding. The blockers to integration are the handoffs the document
already names; findings B1 and B2 below are authority questions for the owner to
resolve before any of this text is treated as an accepted boundary.

## Check 1: boundary compliance

### What is marked correctly

The boundary table at `shared-owner-task-custody-design.md:530-539` marks every
region the task names, with one exception:

- `:533` `src/coordinator/receive.bend`, `turn.bend` — "accepted handoff required".
- `:534` `src/coordinator/stop.bend` (`executions`) — "accepted handoff required".
- `:535` `src/host/process.bend`, `process-spawn.c` — "accepted handoff required".
- `:536` `src/host/text.c`, `text.bend` — "accepted handoff required".
- `:537` `src/coordinator/main.bend`, `commands.bend`, `scripts/mcp-conductor.mjs` — "accepted handoff required".

The body repeats the marking where it proposes the corresponding change:
`:361-362` for the read path ("requires the controls-next handoff"), `:494-496`
for the environment parameter, `:500` for the hosted entry ("by synthesis
handoff"). The opening at `:7-9` states that the document "grants no edit
authority in the regions they own".

### B1: Delivery has no boundary row

The task lists Delivery among the regions whose proposed changes must be marked
as requiring the existing owner's handoff. The boundary table has no row for
`src/coordinator/delivery.bend`, and the document names no owner for it.
Section 10 (`:452-467`) establishes delivery-outcome requirements for the owner
(retry identity, no duplicate native grant, retained failure attribution,
empty-endpoint completion), and sections 2 and 4 enumerate delivery paths as
converted work. Those requirements land in a file whose owner and handoff
condition the document leaves unstated.

Correction: add a Delivery row naming the current owner and "accepted handoff
required".

### B2: The boundary table claims two further instance modules

Row `:539` claims `src/instance/event-registry.bend` (new) as "additive, owned
here", and `:569-570` refers to `retained-table.bend` as the retained keyed
table. Both files exist in the owner worktree under `bend2/src/instance/`
(`event-registry.bend`, 45412 bytes; `retained-table.bend`, 9591 bytes;
`owner-service.bend`, 4282 bytes). The task bounds edit authority to the new
custody module, its fixture, and its own document. The document as written
claims a second and third new source file, with no handoff statement and no
statement that later tasking moved them into this owner's scope.

Correction: either cite the tasking that assigned `src/instance/` to this owner,
or mark those rows as requiring the instance owner's handoff.

### B3: The author's own fixture and runner are absent from the table

The fixture and runner at `bend2/test/native-instance-owner/` are the author's
files, and `run.py:52-54` lists them as `OWNED`. The boundary table names only
the module. Naming them in the table would make the claimed scope complete.
This is a completeness gap rather than a boundary violation.

### Sentences that read as claimed authority or as an implemented runtime

None of the following exceeds the marked boundary, and each is recorded here
with its location for completeness:

- `:471-473` states the ProcessChild environment change in the present
  indicative ("gain an explicit environment parameter ... passes that envp").
  The section closes at `:494-496` with the handoff statement, so the claim is
  bounded where the proposal is made.
- `:268-272` states the Text sink successor in the present indicative. The row
  at `:536` carries the handoff; the paragraph itself does not.
- `:343-345` states "The coordinator-only prototype with per-attempt keepers
  supplies limited observer-savings evidence". I found no artifact for that
  prototype: the only occurrence of "observer-savings" under the owner worktree
  is this document. The claim needs either a citation or removal.
- `:155` ("One owner process serves one bound database.") and `:523` ("The owner
  serves the existing baton CLI and MCP operations") use the present tense
  inside "## Design". Present-tense design statements are normal in a design
  section, and `:325` and `:500` mark the same objects as targets and proposals.

## Check 2: scope

The module admits no grant and invokes no ProcessChild operation. It is a pure
decision module: its header comment states "This module performs no IO", and the
exported surface is `OwnerInstance`, `Slot`, `Attempt`, `Ref`, `Results`, `Duty`,
`Refusal`, the field accessors, `open_duty`, `check_slot`, `advance_slot`,
`check_attempt`, the five `record_*` functions, `fulfilled`, `duty_clear`,
`seal_completion`, `duty_open`, `rebuild_decided` and `rebuild`. No function in
it creates, admits or authorizes a process capability.

The document matches the module on each scope question the task raised:

- No generic service framework and no second messaging path: `:523-526` states
  the owner serves the existing CLI and MCP operations with their current names,
  and that the design adds no operation registry, plugin surface, message bus or
  second messaging path.
- No agent cap: `:359-361` states the read path introduces no agent-count cap,
  and names the observed 64 as a helper-pool size with capacity bounded by
  memory and file descriptors.
- No new admission, keeper or lifecycle service in the module: `:448-450` states
  that grant, cancel, reap, release and ACK remain the existing ProcessChild
  operations and that the module introduces no new keeper, daemon or lifecycle
  service.

Two scope notes:

- Section 5 (`:319-348`) proposes one fixed shared custody process per Orchestra
  database, holding `waitpid`, stdin writes and the output spool for all
  attempts. This is the largest addition in the document. It is a host-layer
  design target, `:329-330` leaves ProcessChild/Direct edits with controls-next,
  and the module does not embody it. It sits inside the stated scope as a
  host-region handoff.
- The module itself performs no IO; the "composes existing ProcessChild
  operations" property holds of the host layer the document proposes, not of the
  module file.

## Check 3: source grounding

Every file:line citation was read against my worktree at `fca7af87`. All of them
resolve to the claimed content. Corrections follow the verified list.

### Verified citations

| Citation in the design | Verified anchor at `fca7af87` |
| --- | --- |
| `host/session-lock.bend:acquire_session` | `session-lock.bend:16-19`: `canonical` then `try_acquire(canonical,session)` then the continuation |
| `host/session-lock.c` lock construction | `session-lock.c:39-55`: `realpath(database)`, `".lock-"`, hex session bytes, open descriptor, `flock(...,LOCK_EX\|LOCK_NB)` in an EINTR loop |
| busy acquisition answers `queued` (`receive.bend:acquired`) | `receive.bend:240-243`: `case None{}: receive_status(db,session,"queued")` |
| `br_spawn` passes `call->lock` as fd 4 | `process-spawn.c:364-379` maps the `lock` parameter to descriptor 4; the keeper call site is `process-spawn.c:1080`; `main.bend:231-245` reads it back through `--host-process-keeper` |
| `process-spawn.c:720-724` | `BR_RELEASE` requires `exited`, closes `keeper->lock`, writes the `released` marker |
| `receive.bend:recover_owned`, `process-spawn.c:1139` | `receive.bend:218-225` calls `P.ProcessChild.attach_owned(directory,lock)`; `process-spawn.c:1138-1139` routes `BP_ATTACH_OWNED` to `br_attach_orphan(...,(int)call->lock)` |
| `stop.bend:admit_sql` row and phase transitions | `stop.bend:10` `admit_sql` writes `'starting'`; `:87` sets `phase='running'`; `:93` sets `phase='exited'` with the status text and the stop-report insert |
| `receive.bend:selected` attempt directory | `receive.bend:201-202`: `db ++ ".attempt-" ++ lower(hex(id))` |
| `process-spawn.c:693-695,723,728` markers | `:695` `status`, `:723` `released`, `:728` `acknowledged` |
| `br_file` exclusivity and `EEXIST` handling | `process-spawn.c:183-186` (`O_EXCL` when `exclusive`); `:602-606` treats `EEXIST` as success for `BR_RELEASE`/`BR_ACK` only |
| `process-spawn.c:27,1250` | `:27` `static BatonChild **baton_children`; `:1250` `call->handle=(u32)baton_child_count++` |
| `receive.bend:completed` order | `receive.bend:100-105`: `Turn.prepare`, `release_observer`, `P.ProcessChild.release`, `finish_pending` |
| `receive.bend:96-105` | finish sequence inside `finish_pending` (`:91-98`) and the tail of `completed` (see C3-4) |
| `receive-laws.bend:421-423` | the release and finish calls of `completion_prepares_before_owner_release` (`:418-423`; see C4); the named law `report_persists_before_best_effort_control_output` is at `receive-laws.bend:31` |
| `turn.bend:consume` parameter list | `turn.bend:296`: `cursor, last_message, terminal, filter, codex_log, first_error, sender, attempt, deliveries` |
| `Turn.retained_output` | `turn.bend:349-353` |
| `native-requests.bend:25` | `native-requests.bend:25` `case True{}: P.ProcessChild.control_write(attempt,frame)`; the `UNIQUE(attempt,native_id)` key is at `:14`; `:16-20` records the parent and attempt |
| `native-request-laws.bend:36-37` | law `native_reply_uses_recorded_attempt_and_frame` at `native-request-laws.bend:33-36` |
| `delivery.bend:launch` | `delivery.bend:27-34` runs `Process.run(argv ++ [id])` per message |
| `.root.log` append | `delivery.bend:19-24`: `log = db ++ ".root.log"`, `Text.append` |
| `delivery.bend:handoff_sql` | `delivery.bend:39-41` |
| `delivery.bend:wake_sql`, comment at `wake_pending` | `delivery.bend:97-98`; comment at `:100`; `wake_pending` at `:101` |
| `git-series.mjs` scoped_environment, execve, key deletion | `harness/git-series.mjs:141` `scoped_environment`, `:181` `process.execve`, `:205-206` `delete environment.OPENAI_API_KEY` / `CODEX_API_KEY` |
| `process-spawn.c:6` and `:84` | `:6` `extern char **environ`; `:84` `posix_spawnp(...,environ)` |
| `text.c:71-74` | function at `:71`, `flockfile(stdout)` at `:74`, the fd 1 write at `:76-80` (see C3-2) |
| `receive.bend:247-248` | `registered` at `:245`; `case False{}: IO.die(Unit,2,...)` at `:248` |
| `turn.bend:544,480,485` | `acquired` `:544`, `supported_harness` `:480`, `matching_turn` `:485`, each `IO.die(Unit,2,...)` |
| `stop.bend:29` | `require_open` `:26-29`; `IO.die(Unit,2,...)` at `:29` |
| `process-spawn.c:1096` | `br_recovery` at `:1092-1103`; the suppression test at `:1096` |
| named commits `e3dd9c58`, `72f081d3…`, `932cd36d`, `5fea8d62` | all present in the object store |
| companion `docs/bend2/shared-native-owner-boundaries.md` | present in the `native-instance-conductor` worktree |
| `:572-577` unavailable host primitives | none of `attach_reader`, `read_ready`, `register_ready_event`, `cancel_registration`, `release_frame`, `release_reader`, `release_destination`, `prepare_env`, `describe_preparation`, `dispose_preparation` occurs anywhere under `bend2/src`, `bend2/harness` or `bend2/scripts` at `fca7af87`; `br_read_source_*` and `br_read_offer_*` are present at `72f081d3` in `bend2/src/host/process-read-source.h` and `process-read-offer.h`; `BR_CANCEL` is present at `e3dd9c58` in `bend2/src/host/process-spawn.c` |

### Corrections

C1. Design `:36-37` renders `admit_sql` as
`ON CONFLICT(session) DO UPDATE SET id,mode,directory,phase,status`. The source
at `stop.bend:10` reads
`ON CONFLICT(session) DO UPDATE SET id=excluded.id,mode=excluded.mode,directory=excluded.directory,phase=excluded.phase,status=''`.
The rendering drops the `excluded.` form and the `status=''` value.

C2. Design `:137-138` cites `text.c:71-74` for "holds `flockfile(stdout)` and
writes directly to fd 1". `flockfile(stdout)` is at `text.c:74` and the
`write(STDOUT_FILENO, ...)` loop is at `text.c:76-80`. Cite `text.c:71-80`.

C3. Design `:78-80` cites `process-spawn.c:725-731` for `BR_ACK` including
"removes the stdout spool". The marker write, `finishing` and the spool path are
at `:728-731`; the `unlink(path)` is at `:733`. Cite `process-spawn.c:725-736`.

C4. Design `:83-88` cites `receive.bend:96-105` for the `finish_pending`
fork/join sequence. The forks are at `receive.bend:91-92`, the delivery join and
`NativeRequests.settle` at `:93-94`, the acknowledgment at `:95`, and the
continuation join at `:97`; `:100-105` is `completed`. The companion citation
`receive-laws.bend:418-423` is `completion_prepares_before_owner_release`
(`Turn.prepare` at `:420`, observer release at `:421`, native release at `:422`,
`finish_pending` at `:423`), which pins the prepare-before-release order. Cite
`receive.bend:88-98` for the
fork/join sequence and `receive-laws.bend:418-423` for the ordering law.

C5. Design `:404-421` (the proposed `Custody` surface) differs from the shipped
module in four places:

| Design text | Module text |
| --- | --- |
| `Custody.record(duty, ...) -> Duty` (`:413`) | no `record`; `record_native`, `record_delivery`, `record_settle`, `record_ack`, `record_continuation` |
| `Custody.rebuild(attempt, owner, acknowledged, native, delivery, settle) -> Maybe<Duty>` (`:418-419`) | `rebuild(attempt, owner, acknowledged, native, delivery, settle, continuation, errors) -> Maybe<Duty>` |
| `Custody.check_slot(...) -> Result<Refusal,Slot>` (`:406`) | `Result<&1,&1,Refusal,Slot>` |
| `Custody.check_attempt(...) -> Result<Refusal,Duty>` (`:410`) | `Result<&1,&1,Refusal,Duty>` |

C6. Design `:199-202` describes the duty record as carrying "sealed report
identity, native-request delivery channels, and the four tracked results
(delivery, settle, ACK, continuation)". The module's `Duty` type carries
`owner, attempt, results, wake_owed, ack_owed, settle_owed, errors`; `Results`
carries five entries (`native, delivery, settle, ack, continuation`); `Attempt`
carries `id, directory, session, cutoff, generation`. The module has no
sealed-report field and no delivery-channel field, and it tracks five results.

C7. Design `:55-58` qualifies the recovery suppression with "for eager
manifests additionally released or native-start-error attempts". I verified the
single suppression list at `process-spawn.c:1096` (`acknowledged`, `released`,
`native-start-error`, missing `launch`). I found no second, non-eager recovery
reader in this pass, so the eager/non-eager qualifier is unverified here.

### Fixture and runner

`bend2/test/native-instance-owner/custody-tasks.bend` imports only `Base`, the
custody module and `stop.bend`, and defines modes `laws`, `die`, `try`,
`stopped` and `result`. `run.py` requires a fresh output directory, records the
commit, tree, per-file hashes, tool identity and one launch/completion record
per child, streams child stdout and stderr to their own files, asserts
`bend 2.0.25`, and re-checks the owned hashes and tree after the run. Its
mutation verdicts record the observed diagnostic and set
`semantic_verification: "unqualified"`, which matches the repository rule
against ledger-style claims. Its expected exits (`23`, `24`, `2`, `0`) agree
with the numbers my independent probe produced.

## Check 4: runtime-halt claims

The design cites four runtime results at `:144-149`: `IO.try` and `IO.die` halt
the whole process on failure and a forked fiber does not catch that halt, with
`die` exit 23, failed `IO.try` exit 24, the stopped-admission helper exit 2, and
a returned `Fail` exit 0 with the caller surviving.

I reproduced all four with my own probe,
`bend2/test/native-critic-boundary-scope/halt-probe.bend` (commit
`3b185e1212f3d98095822913cf785b4e95ee3868`, SHA-256
`b129ca139af27963400d1f370437bad15262d3f0d0becd76254b03776945d92f`). Each mode
forks exactly one task, prints `probe-ready` before the fork and
`probe-survived` after the join, so the stdout shows which boundary the process
reached. The probe adds two control modes with my own codes (`die-41`,
`try-19`) to show the status is the code argument rather than a constant that
matches the cited numbers.

The probe ran on the Linux remote runner `atari-homelab`, in my own scratch
directory `~/baton-critic-boundary-scope-20261007`. No compilation ran on the
operator laptop.

Exact command:

```
ssh atari-homelab "cd ~/baton-critic-boundary-scope-20261007 && \
  CC=/usr/lib/llvm-19/bin/clang sh bend2/test/native-critic-boundary-scope/run.sh \
  --bend ~/baton2-worker-20261006/toolchain-home/bin/bend \
  --output ~/baton-critic-boundary-scope-20261007/evidence \
  --root ~/baton-critic-boundary-scope-20261007"
```

`run.sh` builds once through `bend2/scripts/build-native.sh` and runs each mode
serially. The first attempt with `CC=gcc` failed: the generated C uses
`__attribute__((musttail))`, which GCC 13 rejects. Clang 19 at
`/usr/lib/llvm-19/bin/clang` built it.

Identity of the run, from `evidence/identity.txt`:

```
bend_path=/home/atari2036/baton2-worker-20261006/toolchain-home/bin/bend
bend_version=bend 2.0.25
bend_sha256=d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693
cc=/usr/lib/llvm-19/bin/clang
cc_version=Ubuntu clang version 19.1.1 (1ubuntu1~24.04.2)
uname=Linux 6.14.0-37-generic x86_64
probe_sha256=b129ca139af27963400d1f370437bad15262d3f0d0becd76254b03776945d92f
src_manifest_sha256=a4066507f3f16f272b6e65c4ee9f65b199a7807fbbdcd456b97d4a2c73fe66d2
src_files=140
```

Observed results, from `evidence/summary.jsonl` (the `|` characters are newlines
in the raw stdout files):

```
mode=die-23 exit=23 stdout=probe-ready||
mode=die-41 exit=41 stdout=probe-ready||
mode=try-24 exit=24 stdout=probe-ready||
mode=try-19 exit=19 stdout=probe-ready||
mode=stopped exit=2 stdout=probe-ready||
mode=result-25 exit=0 stdout=probe-ready||25:probe-result||probe-survived||
mode=done exit=0 stdout=probe-ready||done||probe-survived||
```

Raw per-mode stderr:

```
die-23.stderr  : probe-die
try-24.stderr  : probe-try
stopped.stderr : Session is terminally stopped. Read its session and retained
                 inbox; recruit a new session for new work.
```

`build.stderr` is empty and the build step exited 0. The binary SHA-256 is
`226d5c78ff0799f10231e26e42d86889da85640c893dcc6a6d871efff85364cc`.

Reading:

- `die-23` and `die-41` exit with the code passed to `IO.die`, print
  `probe-ready` and never print `probe-survived`. The halt crosses the fiber
  boundary and ends the process.
- `try-24` and `try-19` exit with the code and text of the `Fail` that `IO.try`
  unwrapped, again from inside a forked fiber.
- `stopped` exits 2 and prints the refusal text from `stop.bend:29`. The
  stopped-admission helper's die halts the process from inside the forked task.
- `result-25` prints the returned `Fail` and `probe-survived` and exits 0, and
  `done` prints `done` and `probe-survived` and exits 0. A returned failure is a
  value the caller survives.

All four cited numbers hold. `IO.try` and `IO.die` halt the process, a forked
fiber does not catch the halt, and a returned `Fail` leaves the caller running.

## Check 5: writing style

The document repeats the pattern the repository forbids: describing a mechanism
by contrasting it with something the project does not do. Locations:

| Line | Text |
| --- | --- |
| `:40-41` | "It carries no history: once a newer attempt updates the row, the row names the newer attempt only." |
| `:51-52` | "so marker writes are not generally idempotent" |
| `:57-58` | "enumeration reads the marker files directly instead of reusing this admission filter" |
| `:160-161` | "an identifier for the record, and does not supply the binding itself" |
| `:164-166` | "they do not establish the one-owner-per-database property by themselves" |
| `:177` | "nothing here qualifies SQLite behavior under hard-link access" |
| `:182-183` | "The owner token rides on every task record and socket frame. A saved PID or native conversation ID establishes nothing." |
| `:206` | "`ProcessChild.recovery_argv` is not the enumeration source" |
| `:274` | "Native requests need no structural change" |
| `:312` | "A result-shaped return type alone is not containment" |
| `:368-369` | "Release and acknowledgment are custody and completion-duty steps, and neither is an object destructor." |
| `:491` | "and are recorded nowhere — not in report logs, not in durable requests" |
| `:524-525` | "The design adds no operation registry, plugin surface, message bus or second messaging path." |
| `:549-550` | "Take grants allocation custody only; it advances no durable interpretation or effect checkpoint and grants no ordinary interpretation permission." |
| `:592-594` | "Successful source disposal establishes neither registry quiescence, settled interpretation or effects, parent delivery nor ACK completion" |
| `:601-607` | "establishes neither all-writer finality nor a sealed extent — only Controls' qualified current observation does"; "neither universal retention nor universal deletion follows from ACK alone" |

The density increases after `:528`: the "Exact API/source boundaries" section and
the paragraphs that follow it (`:541-608`) are built largely out of these
constructions. Each one has a positive form available from the same fact. Two
examples:

- `:206` becomes "`ProcessChild.recovery_argv` returns `None` once the `released`
  marker exists (`process-spawn.c:1096`); enumeration reads the attempt
  directory's marker files."
- `:549-550` becomes "`Take` transfers custody of the offered allocation. Durable
  interpretation and effect checkpoints advance through the Controls wrapper,
  and ordinary interpretation permission comes from task adoption."

One metaphor: "rides on" at `:182`. One heading set uses plain nouns and is
clear.

The last section also states one rule twice. Lines `:594-599` and `:605-608`
both state that a normal ACK attempts the raw unlink and that raw availability
after ACK follows the cleanup outcome. Lines `:592-594` and `:601-604` both open
with the "establishes neither ... nor" construction. Stating each rule once, in
its positive form, removes the repetition and most of the negative constructions
with it.

One item belongs in a ledger rather than the design body: `:343-345` reports
prototype results ("supplies limited observer-savings evidence") with no
artifact, measurement or commit cited anywhere in the reviewed worktree. Either
cite the evidence or move the sentence to the working ledger.

## Limits

- This review covers the four artifact hashes above. Any edit to the design
  document or module invalidates the corresponding verification.
- Check 4 covers the four cited halt results on the toolchain recorded above.
  It makes no claim about the wider runtime semantics of the shared owner.
- Check 3 verified citations against `fca7af87`. The design's own file:line
  references to artifacts absent from `fca7af87` (the module, the event-registry)
  are checked against the owner-worktree files at the hashes above.
- I did not run the owner's `run.py`; the fixture and runner verdicts come from
  reading them. My probe is separate source, so the halt evidence is independent
  of the fixture the design ships.
