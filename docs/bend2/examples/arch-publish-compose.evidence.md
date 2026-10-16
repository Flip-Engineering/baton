# arch-publish-compose — the composed durable-acceptance-to-canonical-publication path

## Claim

Four separate processes of `arch-effect-publication.bend` compose one durable-acceptance-to-canonical-
publication path over a shared fixture tree and a real process boundary between each step: an attempt
whose destination is absent settles nothing and retries nothing; a fresh process admits the operation,
journals the accept intent, dispatches once to the destination that is now reachable, and settles it
from the destination; a third process settles the same attempt from the destination alone without
dispatching again; and a fourth reads back what the destination holds.

This is the composition the external architecture verdict asks for in review track 2, at the scale the
pin supports: M-1 (acceptance ordered before acknowledgement), M-2 and M-3c (an unsettled attempt and
an honest new-effect claim), M-3a/M-3b (the attempt's identity and one effect per operation), M-12
(asynchronous acceptance) and M-18 (completion evidence for the actual destination).

## Files

| File | Holds |
|---|---|
| `arch-publish-compose.sh` | the four stages, each a separate process |
| `arch-effect-publication.bend` | the program every stage runs, with its mode selected by `ARCH_EFFECT_MODE` |
| `arch-publish-compose.evidence.md` | this record |

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4).
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- All state is under `.scratch/arch-effect/`, which the repository ignores. The destination's identity
  file is written by the script, because Base supplies no directory creation.

## Command and output

```sh
sh docs/bend2/examples/arch-publish-compose.sh
```

```text
### stage 1: an attempt whose destination is absent
dispatch=False
unsettled=no_evidence
retry=none
fixture after stage 1:
### stage 2: admit and dispatch to a destination that is reachable
intent_appended=True
journal_lines=1
durability_receipt=none
dispatch=issued
settled=observed
dispatch_count=1
journal after stage 2:
accept:op-1
### stage 3: settle the attempt from the destination, in a fresh process
settled=observed
dispatch_count=1
### stage 4: ask a fresh process what the destination holds
destination after stage 4:
artifact.op-1
dispatches.log
identity
op-1
op=op-1|payload=canonical-v1
```

Exit code 0.

## What each stage establishes

| Stage | Step of the path | Evidence |
|---|---|---|
| 1 | An attempt with an absent destination | `dispatch=False`, `unsettled=no_evidence`, `retry=none`, and the tree stays empty: the failure is a value, the attempt is not claimed as delivered, and nothing is retried. |
| 2 | Durable acceptance, then one dispatch | The accept intent is on disk before the acknowledgement line is printed (`intent_appended=True`, then `journal_lines=1`, `accept:op-1` in the journal); the dispatch reports issued and the settlement observes the artifact; `dispatch_count=1`. |
| 3 | Recovery in a fresh process | `settled=observed` with `dispatch_count` still `1`: the process settled from the destination's own bytes and dispatched nothing. |
| 4 | The destination's state | One dispatch line `op-1` and the artifact `op=op-1|payload=canonical-v1`: one attempt, one canonical payload, at the destination the plan named. |

The process boundary is what makes stage 3 meaningful: it holds no in-memory result of stage 2's
dispatch, so its settlement can only come from reading the destination. A second dispatch there would
have raised `dispatch_count` to 2, which is the number the `publish` mode produces when it is run
twice against the same destination (`arch-effect-publication.evidence.md` records that run).

## What this composition still lacks

- **The attempt is not journaled before the dispatch.** Only the accept intent is. The program records
  the attempt by appending to the destination's own `dispatches.log`, which is evidence *at the
  destination*, not local intent recorded before the effect. Recording local intent first needs a
  journal write path in the same program, and that path inherits the next gap.
- **No durability receipt.** `durability_receipt=none` is printed by the program because Base has no
  synchronization operation: `bend base File.fsync` exits 1 and `bend base File.rename` exits 1. The
  acceptance ordering is real at the level of the write call returning; it is not evidence that the
  line survives a power loss (ARCH-CLOSE-04, `B2-FS-DURABILITY`).
- **No crash injection.** The restart is a new process over the same files, not a kill at a chosen
  point. `B2-FS-DURABILITY` and `B2-PROCESS` carry the fault-injection work.
- **One destination, one transport.** The destination is a directory; the only transport is the
  filesystem, and the destination's identity is a file it holds (`B2-DESTINATION`, `B2-HTTP-TLS`). The
  controlled-remote fixture named in the increment's contribution carries the git half.
- **Operation identity is a fixed string** (`op-1`) rather than a derived identity with a digest, since
  `B2-JSON` and `B2-CRYPTO` are open prerequisites.

## Verdict

The claim holds: the four stages ran at the pinned compiler, each in its own process, and the outputs
are the ones recorded above. The path's shape is demonstrated; its durability, crash and transport
halves rest on the named missing primitives.

## Related

- `arch-effect-publication.evidence.md`: the single-process prototype and the missing-primitive table.
- `../target-architecture.md`: ARCH-CLOSE-04/05, M-1, M-2, M-3a, M-3b, M-3c, M-12, M-18.
- `../rewrite-plan.md`: `B2-DESTINATION`, `B2-FS-DURABILITY`, `B2-PROCESS`, `B2-JSON`, `B2-CRYPTO`.
