# Retained report: resource and ordinary CLI/MCP compatibility critique

Sender: native-instance-resource-critic. Recipient: native-instance-conductor.
Task messages: `native-instance-resource-critic-task-1`,
`native-instance-resource-critic-continuation-12`,
`native-instance-resource-evidence-correction-14`.

## Identity and artifacts

Source `fca7af876c8260c32d17f95f3e19bc68ee1bf561`; installed executable
`~/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2`,
sha256 `972d620ce6209193cb91273350a9c1ea2713cac6b4b2bcf692a6303df75c766c`. Runtime
citations come from the generated C at `.scratch/semantic-context-20261005/baseline/baton2.c`,
built beside a binary with the same sha256. Host macOS 27.0 (26A428), arm64, boot
Mon Oct 5 10:46:16 PT. Live Orchestra read only.

Artifacts in the resource-critic worktree, all untracked under `fixtures/`:
`fixtures/resource-critic/CRITIQUE.md` (seven sections), `measure.py`, `fx/harness.sh`,
and raw samples `fx/evidence/{idle-k1,idle-k4,active-k1,active-k4,big-1000000,big-5000000,big-k1,big-k1-contaminated-run-overlap}`
with `footprint` and `vmmap` dumps for observer, keeper and harness. No production
source was edited.

## Measurement method

One idle observer reports `ps` RSS 6.4 MB, `footprint` private footprint 4.4 MB, and
`vmmap` total resident 83.4 MB, of which 76.2 MB is read-only shared text (`__TEXT`
8.7, `__LINKEDIT` 25.3, `__OBJC_RO` 42.2). Summed RSS overstates private footprint
1.09 to 1.53 times; summed shared resident pages overstate it 17 to 34 times.
`ps` RSS also falls below the private footprint under memory pressure. Report each
process's private footprint and count shared pages once.

## Controlled results

Per-agent Baton-fixed private footprint: observer about 4.5 MB plus keeper about
2.3 MB, flat from one to four sessions and from no output to 4 MB of inert output
(observers 4.50 to 4.52 MB idle, 4.72 to 4.80 MB active). CPU 0.0 percent idle and at
most 9.0 percent sampled during a 4 MB drain. Ordinary CLI `status`: 19 to 30 ms wall,
at most 5.2 MB maximum RSS, five runs, each exit 0.

Single-frame amplification: one inert stdout line of 1 MB, 5 MB or 20 MB inflated that
observer to 202 MB, 593 MB and 870 MB private footprint, while the retained log held
exactly 1 000 117, 5 000 025 and 20 000 117 bytes. Forty thousand small inert lines
totalling 4.26 MB left the observer at 4.55 MB. A per-frame-byte ratio is therefore
not stable; candidate comparison must fix the frame size distribution.

## Source-verified compatibility facts

`IO.die` is a process-global HALT (`base.bend:194`), `IO.try` re-raises and catches
nothing (`:204`), and the generated `io_step` and `io_loop` return that code as the
process exit status (`baton2.c:201252`, `:201307`), so a halt from any spawned task
ends the process. A short `fwrite` reaches `err_fail` and `_exit(1)`
(`baton2.c:200803`, `:5582`), so a client disconnect on fd 1 kills the owner.
`host/text.c` writes control output to fd 1 with no request destination, and
`IO.write` does not take that same lock. Child environment is the global `environ`
(`process-spawn.c:84`, `:392`) while `git-series.mjs` builds a scoped copy and
`execve`s it (`:181`, `:203`). `baton_children` slots are process-local, monotonic and
never reused (`:1250`), cleared only on error (`:1227`), and a retained child keeps its
struct, directory string and slot after ACK (`:612`, `:725`). Keeper release requires
native exit and closes the session lock (`:719`); ACK requires exit and release
(`:725`); attach and recovery refuse a released or acknowledged directory (`:1096`).
`br_keeper` exits the process on any keeper error (`:1033`), the correlated-loss
boundary. `IO_HELP` is 64 (`baton2.c:267`) and `br_read_line` waits with no deadline
(`process-spawn.c:531`). Delivery appends endpoint output to one `db.root.log` per
database with no session field (`delivery.bend:completed`), and the MCP server runs
`execFileSync` per call (`mcp-conductor.mjs:114`).

Observed exits: twelve fixture observer attempts each exited 1 while their harness
exited 0, with the fd 1 status line naming exit 0 and the failure text on stderr.

## Owner-admission module review

Reviewed `bend2/src/coordinator/owner-admission.bend`,
`bend2/test/owner-admission/main.bend` and `bend2/test/owner-admission/run.py` at
commit `bea247cc523271f2eab4199febcc47262aca8574`. The module and test bytes are
identical to the version first reviewed beside draft `94d7ec58`; `bea247cc` adds the
runner and the draft paragraph. The runner pins the compiler version, records sha256
for module, entry, runner and compiler, runs `--check-only`, generates the entry,
builds it natively, asserts exact stdout for its argument cases, and then applies
intended implementation mutations that must make the compile report a named law
diagnostic. That is a real proof-removal control shape, and it binds the decision
function and its laws rather than pinning counts. Neither the laws, the argument cases
nor the mutations cover owner-instance staleness, admission capacity or the durable
payload copy, which is the sense in which the module is not yet the contract.

What holds: the module is pure and data-only; it separates absent, replay, conflict
and invalid decisions; it keeps owner-process identity outside durable request
identity; and its seven laws pin the absent, retry, committed-replay, changed-payload,
changed-database, missing-attempt and missing-request cases. The
`missing_attempt_does_not_authorize_new_grant` law is the strongest part: a stored
record with an empty attempt decides `Invalid`, which blocks the duplicate-grant path
that a naive "record exists, therefore a child exists" reading would allow. The test
driver at `bend2/test/owner-admission/main.bend` exercises fresh, replay, conflict and
invalid through argv with a fixed stored identity, and the conflict branches are
reachable by changing the expected database.

Resource and ordinary CLI compatibility concerns:

1. Owner-instance staleness sits with the caller. Because durable identity excludes
   the owner instance, a superseded owner that still holds its record decides
   `Replay{attempt}` for the same bytes. At-most-one grant then rests on the
   caller's "revalidate storage authority" step, which the module does not express
   and no law pins. A generation or owner-instance field, or a decision variant that
   refuses an unqualified caller, would make the property checkable here.
2. `Fresh` means only that no durable record exists for these bytes. It does not mean
   the session has an admission slot free. A second, different request for a session
   whose attempt is active therefore decides `Fresh`, and capacity is entirely the
   caller's. No variant carries slot occupancy, which the shared-owner contract needs
   alongside the pre-admission and post-admission split.
3. `Conflict{}` and `Invalid{}` carry no detail. The existing CLI contract answers a
   refusal with the exact rule and the retained work to inspect. These variants cannot
   name the conflicting attempt or the violated field, so a shared owner's client
   answer loses the next-step instruction unless the caller reconstructs it.
4. `valid` checks only non-emptiness. Operation membership, session or database
   canonicalization, and payload encoding are unchecked, so two encodings of the same
   logical request (for example a trailing newline) decide `Conflict` rather than
   `Replay`. Payload equality also compares full strings, which makes each retry cost
   linear in payload size; my probes show single payloads can reach 20 MB.
5. `Record` stores the whole `Request`, including the payload. Request identity is
   therefore also a durable payload copy, which puts reply bodies and any reply-borne
   secret under the identity row's retention rules. A digest field would decouple
   identity from payload retention.
6. `decide` receives the durable record as a `Maybe<Record>` snapshot, so correctness
   depends on the caller reading it atomically with admission and persistence. The
   module comment states that the caller owns atomic persistence, and no law covers
   the read-decide-persist sequence. A mutation control that inserts a read between
   decide and persist would show duplicate admission, and that control does not exist
   yet.

Verdict: a sound pure replay decision over request identity, with one law that already
protects the duplicate-grant path. It does not express owner-instance qualification,
admission capacity, refusal detail, payload retention or the pre-admission and
post-admission split, and it has no law for decision stability across owner
replacement or for atomic read-decide-persist. Those clauses of the shared-owner
contract are not yet carried by this module.

## Limits

Single host and single-instant snapshots; my harness is not a provider, so
provider-frame retention is not reproduced and the frame classes that retain heap are
not isolated; the 20 MB contaminated sample from two runs sharing one database path is
retained separately from the clean re-run; stale-handle behaviour is read from source
only; no shared keeper or shared owner exists so correlated loss is argued from the
single-attempt keeper; live Orchestra figures are uncontrolled and support no saving
claim; the owner-admission module was reviewed by reading only, its check, native,
runtime and mutation runs were not repeated; guard-alias hard-link behaviour belongs
to review `5fea8d62` and was not probed here; the sibling measurement baseline was read
and compared, not rerun.
