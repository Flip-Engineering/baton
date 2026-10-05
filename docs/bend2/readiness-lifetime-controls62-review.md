# Readiness and lifetime contract review

## Scope

Read the complete Controls62 refinement, Receive agreement and corrected narrow
client mapping in `native-instance-lifetime-critic-controls62-full-29`.
Inspected immutable `e3dd9c588689828f360fdbaa7b14d43aa9fd7a6e` host source,
particularly `br_read_line`, `br_native_exited`, `br_command` and
`baton_process_done`. This is source review. No compiler, native fixture or
test gate ran. Remote-only execution and root admission remain required.

The LF-inclusive frame contract, separate stream finality, original
attempt/stream offsets and synchronized registration resolve the earlier
logical interface questions. The actual byte carrier, checked offset,
registration and capability implementations remain pending owner exports.

## Source implications

At e3dd, `br_read_line` accumulates bytes in the current call, advances the
retained reader's `off_t` offset, and removes one LF from the returned length.
The return uses `io_str` with an explicit length. This source does not establish
arbitrary invalid-encoding preservation through Bend String or subsequent
transport. The current argv fixture cannot carry embedded NUL. Keep the pure
3a output-correlation result scoped separately from the new raw-byte contract.

The allocation check protects `call->length + count + 1` against `SIZE_MAX`
overflow. It does not check the separate addition
`retained->offset += (off_t)count`. The proposed unsigned public offset must
also fit the actual host `off_t` before a read. Checking unsigned addition alone
is insufficient on a host with a smaller signed representable range. Reject
negative conversions, overflow and wrong stream before advancing reader state.

`br_native_exited` records the native child's wait result and sends BR_EXIT.
`br_read_line` treats a zero-length spool read with observed native exit as EOF.
That branch has no separate inherited-writer finality evidence. The new
contract therefore needs a stated and measured writer-lifetime policy before
reusing this EOF decision. A child exit followed by a descendant's later write
is the relevant remote schedule; ordinary exit0 alone does not close it.

The existing ACK branch requires exit and release, records acknowledged,
marks the keeper finishing and removes stdout. Its coordinator-side ACK path
closes the retained spool and receiver resources. The refined historical
contract correctly allows a remaining sealed report delivery after these
resources are gone. That report's responsibility must survive independently
of host attachment; unresolved child status or ACK still needs custody.

## Required type and caller properties

The instance author should return source-pinned types and functions with these
properties through Controls and Receive:

- Raw frame payload preserves byte values and explicit length, including NUL
  and invalid text encodings. Its ownership remains valid through interpretation
  and in-flight output; release cannot recycle the underlying storage early.
- Cursor binds original attempt, retained stream and checked unsigned offset.
  A frame spans `[start,next)` with a byte-length equality. Host conversion
  checks the selected platform's range. Cursor validation must precede state
  mutation and cannot resolve identity through the current session slot.
- Readiness version, registration token and event sink bind owner and child
  capability generations. Validation and acquisition of an in-flight reference
  must serialize with invalidation. Equality followed by an unprotected lookup
  leaves a reuse interval even when both fields exist in the type.
- A registration holds a pending event through consumer recheck. Rechecking
  Waiting cannot clear a later event from the same registration. Unregistration
  and destruction distinguish cancelling a queued event from a callback already
  in flight. Both must settle before storage or tokens are reused.
- Generation exhaustion refuses reuse or establishes a new qualified identity.
  A numeric wrap must not make an old cursor, registration or child token valid.
  This limits representable identity reuse, not the number of connected agents.
- Host scan offset, durable interpretation checkpoint and client output cursor
  retain separate types or explicit tagged meanings. Recovery from zero
  reconstructs the original episode; a lost reader's private offset cannot
  become a checkpoint by renaming the field.

These properties are review conditions for the existing authors. No competing
host, startup mechanism or new production module is introduced here.

## Remote schedules

Use the actual host API and synchronization barriers in an admitted remote
fixture. Retain full outputs and child exits for:

| Schedule | Required observable result |
| --- | --- |
| Split NUL/invalid-encoding line across Waiting | Exact raw bytes and original start cursor survive; no partial output or durable checkpoint advancement |
| Empty LF, CRLF and final unterminated suffix | LF-inclusive frames with exact byte spans; suffix precedes EOF; no synthetic final empty frame |
| State changes immediately before and after registration | Immediate Ready or one retained pending event; consumer remains able to make progress |
| Unregister/teardown races an in-flight event | Old callback is settled or rejected with original identity; reused sibling capability remains unaffected |
| Native child exits before inherited writer appends | Result follows the explicitly chosen writer policy; no unsupported finality claim |
| Boundary offset and host-range conversion | Overflow is refused before read/advance, with original cursor retained |
| Owner replacement while old event is pending | Old capability cannot act on replacement work; original duty remains discoverable |
| Child ACK and cleanup precede failed parent delivery retry | Original report is retried without requiring a live child; actual delivery result stays distinct |

The earlier critic fixture candidate `842a3ae5` remains an unexecuted
root-admission request for pure 3a correlation/wake checks. It cannot qualify
this new arbitrary-byte or host-concurrency contract. Linux and remote Darwin
results need their respective source, toolchain and platform attribution.

## Narrow Receive disposition

The agreed C.Receive-only mapping is coherent as an explicit early durable
queued acknowledgement. The task channel and exact request/session failures
remain owned after that reply, including failures before any attempt exists.
`CommitOutcome` names its stage and transaction; a failed wake registration
does not erase the sender's already committed message. The retained wake can
be reconciled after owner replacement without changing its semantic identity.

Actual Delivery owner agreement, the busy-release registration race,
post-reply task failure and actual parent wake remain implementation and remote
qualification requirements. No routing, shared runtime or component-wide
acceptance is claimed by this review.
