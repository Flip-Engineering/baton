# Resource availability and optional deployment quotas

The deployment factory imposed an unchangeable 8 GiB / one-million-inode fleet reservation
ceiling. The capacity ledger separately refused more than 10,000 reservations or a 4 MiB state
file. None of those figures measured the machine's available resources. Large legitimate swarms
could therefore be refused on otherwise healthy hosts.

The default byte and inode quotas are now `null`. Admission still compares fresh physical free
space with outstanding reservations plus the proposed worktree and dependency projection. It
still checks integer overflow, authenticated reservation identity, conflicting owners and exact
cleanup custody. The fixed reservation-count and state-file-size caps are removed.

Deployment owners can opt into quotas and tune headroom without replacing observation:

```js
await openBaton({
  repo,
  advanced: {
    capacity: {
      policy: { maxReservedBytes: 32 * 1024 ** 3, minFreeBytes: 2 * 1024 ** 3 },
    },
  },
});
```

`estimate` and `observe` are independently optional host integration functions. A policy
override merges with the defaults; `maxReservedBytes` / `maxReservedInodes` accept positive
safe integers or `null`. Existing host headroom (512 MiB / 100,000 inodes) and per-runtime growth
allowances (64 MiB / 10,000 inodes) remain configurable estimates, not physical guarantees.
Different policies cannot silently reinterpret outstanding reservations; policy changes take
effect after the old ledger is empty.

Validation: 105 focused capacity/readiness tests pass. A synthetic fleet exceeding the former
byte, inode, reservation-count and 4 MiB ledger limits survives reopen. Other cases still refuse
physical exhaustion or an explicit quota before effects. Cross-process contention exposed a
diagnostic bug: a deadline could replace the last observed abandoned-reaper explanation with
generic ownership churn. The refusal now retains its actual last observation.

The old admission audit classified the fixed byte/inode quotas as physical constraints; that
classification was too generous. Available disk is physical; a fixed fleet quota is owner policy.
Dependency projection limits and the broader goal/budget machinery require separate treatment.
