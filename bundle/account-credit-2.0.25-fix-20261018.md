# Pinned 2.0.25 correction receipt: account modules

Status: source fix and host check receipt, 2026-10-18. Focused branch
`flash-account-credit-2.0.25-fix`, based on `daf7f4d6`. The review branch
`baton/flash-account-credit-1017` is unchanged at `3db1098`.

The claim that `daf7f4d6` passed the pinned compiler is false. The supplied host
check recorded `accounts.bend` line 259 `do IO(Unit)` RED and
`account-credits.bend` RED on the same import; `subscription-fallback.bend` was
green. The correction commit is `2e1abdc3`.

## Source correction

`accounts.bend`:

- `do` headers use the `IO<Unit>` form the 2.0.25 compiler requires; signatures
  keep the arrow `IO(Unit)` form.
- The `where` parameter is renamed `clause`; `where` is a compiler keyword.
- `decimal_tail` and `organization_blocked` no longer call helper defs defined
  later, and no longer form a mutual recursion. The copyable `seen_dot` and
  `seen_digit` parameters replace the two-branch consumption.
- Selection consumes each fixture account list once. The blocked set is a
  newline-separated string from `blocked_organizations_sql`; `select_scan`
  carries the first preferred and first matching candidates in one pass.
- The `send`-boundary helpers mark reused scalar parameters copyable; the
  migration, observation and import helpers use the required `IO.try(String,...)`
  result type; direct prints have do blocks.
- `observation_object_sql` is called with no argument; the extra `"1"` applied a
  String as a function.
- `List.head` is called with its explicit level and element type where the
  fixture inspects a binding list.

`account-credits.bend`:

- Function signatures use arrow `IO(Unit)`; do headers use `IO<Unit>`.
- The fixture keeps decimal, vocabulary, operation-to-fact, launch-binding,
  state, selection-predicate and authority checks. Selection order itself is
  covered by `bend2/test/account-credits.py`; the fixture checks the predicates
  that order consumes.

## Pinned compiler checks

Compiler:
`/run/baton2-native-homelab/retained/baton-compiler-776-packaged-smol-20261016/bend-2.0.25-baton776-smol-diagnostics/bin/bend`
(`bend 2.0.25`). Worktree:
`/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/worktrees/flash-account-credit-1017`.

Commands, run from the worktree:

```
/usr/bin/time -v <compiler> --check-only bend2/src/coordinator/accounts.bend
/usr/bin/time -v <compiler> --check-only bend2/test/account-credits.bend
/usr/bin/time -v <compiler> --check-only bend2/src/coordinator/subscription-fallback.bend
```

| Source | Exit | Peak RSS (KiB) | Swaps | Verdict line |
| --- | --- | --- | --- | --- |
| `accounts.bend` | 0 | 2786220 | 0 | `All terms check, but 43 defs rely on unsafe or foreign code:` |
| `account-credits.bend` | 0 | 3403548 | 0 | `All terms check.` |
| `subscription-fallback.bend` | 0 | 2753488 | 0 | `All terms check, but 43 defs rely on unsafe or foreign code:` |

Raw output: `.scratch/account-credit-2.0.25-fix/{accounts.bend,account-credits.bend,subscription-fallback.bend}.{stdout,stderr}`.

## Bounded scope

`systemd-run --scope` is not available to this seat. The attempt:

```
systemd-run --scope --slice=baton2-build.slice -p MemoryMax=16G -p MemorySwapMax=0 \
  -- sh -c 'cd <worktree> && <compiler> --check-only bend2/src/coordinator/accounts.bend'
```

Exit 1; stderr: `Failed to start transient scope unit: Interactive authentication required.`

`/proc/self/cgroup` is `0::/user.slice/user-1000.slice/session-40.scope`. The
slice reports `MemoryMax=17179869184` and `MemorySwapMax=0`; its directory is
root-owned and not writable by uid 986. The three checks above ran outside that
scope; their peak RSS and `Swaps: 0` are observed, not enforced by the cgroup.

Root command for the same bounded run:

```
systemd-run --scope --slice=baton2-build.slice -p MemoryMax=16G -p MemorySwapMax=0 -- \
  sh -c 'cd /run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/worktrees/flash-account-credit-1017 && \
  for f in bend2/src/coordinator/accounts.bend bend2/test/account-credits.bend bend2/src/coordinator/subscription-fallback.bend; do \
    /usr/bin/time -v /run/baton2-native-homelab/retained/baton-compiler-776-packaged-smol-20261016/bend-2.0.25-baton776-smol-diagnostics/bin/bend --check-only "$f" || exit $?; \
  done'
```

## Focused fixture build and run

```
env BEND=<compiler> CC=clang-19 sh bend2/scripts/build-native.sh \
  bend2/test/account-credits.bend .scratch/bend2/account-credits-test
.scratch/bend2/account-credits-test
```

Build exit 0; peak RSS 3526344 KiB; `Swaps: 0`. Run exit 0; peak RSS 2132 KiB;
`Swaps: 0`; 45 `fixture-account ...: ok` lines and `fixture-accounts-ok`.

Raw output: `.scratch/account-credit-2.0.25-fix/{build,run}.{stdout,stderr}`.

No full Main generation was started.

## Git and handoff

`git remote -v` is empty. The focused branch and commit are in the shared
worktree repository:

- Worktree: `/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/worktrees/flash-account-credit-1017`
- Branch: `flash-account-credit-2.0.25-fix`
- Commit: `2e1abdc3389e9dfed750797a7370945ccbc08eda`
- Tree: `4801c81d9b2a7014d1c9466e97b55ede58bac6c0`
- `sha256(accounts.bend)` = `b5d7ab873be4d41a7f52bc14f4ae010e2db89fe8f3feff9f9fccb28d9f8a3c0c`
- `sha256(account-credits.bend)` = `93a0cc7c6dedf48ad6ac1b6c5cd806b3d1d4adb4960f4308446d0aded6abd7a5`
