# Compile queue scheduling priority

`compile-queue-runner run --priority N` states the priority of one request. A
request with the same key as an execution that has not started joins that
execution. The execution schedules at the largest priority requested by a live
owner of the key.

## Owners and priority

Each owner token under `keys/KEY/owners/` records the requested priority
(`priority=`). A token written by an earlier executable has no `priority=` line
and counts at the priority of the first request, which `runs/ATTEMPT/meta`
records. A token whose process no longer exists does not count.

A supervisor that waits for admission derives the effective priority again on
every pass of its admission loop. The scan holds `owners.lock`, the lock that
publication, cancellation and pruning of tokens hold. When the effective priority
differs from the priority of its tickets, the supervisor replaces both tickets
(`waiters/TOKEN` or `waiters/cc/TOKEN`, and `admission/waiting/TOKEN`) with a
complete file. The ticket keeps its name, its process identity and its position
among tickets of equal priority.

- A later request at a higher priority raises the tickets within one pass of the
  admission loop (at most one second).
- Cancellation of that owner with `cancel`, or the end of its process, lowers the
  tickets again on the next pass.
- Same-key deduplication, the execution identity, the owner custody rules, the
  capacity check and the order among tickets of equal priority are unchanged.

Every priority from 0 through 4294967295 is supported; each owner is read with its own
live flag, so no priority value doubles as an absent owner.

## What the caller sees

After `owner=TOKEN`, a requester prints one line on standard error:

    priority=REQUESTED effective=EFFECTIVE

`effective` is the largest priority among the live owners of the key, which is the
value the waiting supervisor schedules with from its next pass. A request that is
served from a finished result reports the same value; it does not change any
ticket.

An execution that is already admitted, running, or owned by a supervisor of an
earlier executable keeps the priority it has. The supervisor loop of the earlier
executable does not derive the priority again; no ticket is edited by hand.
A supervisor without readable memory information waits for the exclusive lane
(`admission_fallback`) with the priority it started with.
