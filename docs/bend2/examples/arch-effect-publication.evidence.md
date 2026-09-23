# arch-effect-publication — the native effect prototype

## Claim

At the pin, a Bend2 program validates an issued capability record before use, records a durable accept
intent in an append-only journal, dispatches a canonical publication to a target whose identity it
read first, and settles a lost-response attempt from the target's own evidence without dispatching a
second effect. The same program records where the native surface runs out: the accept intent gets no
durability receipt, an absent destination is a value rather than an exception, and the only transport
for the publication is the filesystem.

This is review track 2 of the external architecture verdict, at the scale the pin supports: it tests
capability construction and validation, durable acceptance, canonical publication to a controlled
target, and the no-automatic-repeat rule for external effects, and it names the primitives the rest
of the track still needs.

## Files

| File | Holds |
|---|---|
| `arch-effect-publication.bend` | the program: five modes selected by `ARCH_EFFECT_MODE` |
| `arch-effect-publication.evidence.md` | this record |

The program creates nothing: Base supplies no directory creation, so the fixture tree is made by the
commands below and a missing directory is one of the failures the program has to answer. All working
state is under `.scratch/arch-effect/`, which the repository ignores.

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4).
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- Commands run from the worktree root with `export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1`.

## Commands and output

### Type check

```sh
bend docs/bend2/examples/arch-effect-publication.bend --check-only
```

```text
All terms check.
```

### Capability validation

```sh
ARCH_EFFECT_MODE=validate bend docs/bend2/examples/arch-effect-publication.bend
```

```text
valid=accepted:stop_run
forged_generation=refused:capability_generation_zero
forged_operation=refused:capability_operation_mismatch
forged_resource=refused:capability_resource_missing
```

Exit code 0. The valid record passes; a record naming another operation, a record with an empty
resource, and a record whose generation is zero are each refused before use. What the check cannot
establish is provenance: at this pin any module that imports the type constructs a record directly
(LANG-F-28), which is why the target architecture keeps runtime validation until a proof-indexed
encoding exists (ARCH-CLOSE-02).

### Durable acceptance, publication and settlement

```sh
rm -rf .scratch/arch-effect
mkdir -p .scratch/arch-effect/target
printf 'target-A' > .scratch/arch-effect/target/identity
ARCH_EFFECT_MODE=publish bend docs/bend2/examples/arch-effect-publication.bend
```

```text
intent_appended=True
journal_lines=1
durability_receipt=none
dispatch=issued
settled=observed
dispatch_count=1
```

Exit code 0. The accept intent is one line of `.scratch/arch-effect/journal.log`; the dispatch appends
one line to `.scratch/arch-effect/target/dispatches.log` and writes
`.scratch/arch-effect/target/artifact.op-1`; the settlement then reads that artifact back and reports
what it observed. The fixture tree after the run:

```text
.scratch/arch-effect/journal.log
.scratch/arch-effect/target/artifact.op-1
.scratch/arch-effect/target/dispatches.log
.scratch/arch-effect/target/identity
```

`dispatches.log` holds `op-1`; `artifact.op-1` holds `op=op-1|payload=canonical-v1`.

`durability_receipt=none` is the observed state of the native surface, not a choice: `File.write` and
`File.close` are the whole write path (LANG-CAP-01), `bend base File.fsync` exits 1 with
`bend: Base has no File.fsync (see bend --help)`, and `LANG-F-29` records that a receipt-shaped return
pins no write ordering (see `lang-cap-durability.evidence.md`).

### Recovery from a lost response

A second run in `recover` mode reads the destination and nothing else: no in-memory result of the
attempt reaches it.

```sh
ARCH_EFFECT_MODE=recover bend docs/bend2/examples/arch-effect-publication.bend
```

```text
settled=observed
dispatch_count=1
```

Exit code 0. The attempt settles as observed, and `dispatch_count` is still 1: the recovery
established convergence from the destination's own bytes and dispatched nothing. Recording the
attempt's own outcome rather than re-deriving it would have made this indistinguishable from a second
effect, which is the case M-3c excludes.

Running the publication again instead of recovering from it is a second effect, and the count says
so: a repeated `ARCH_EFFECT_MODE=publish` against the same target reports `dispatch_count=2`. Two
clean runs from an emptied fixture tree produce identical output, so the count is a fact about the
attempts and not about the run order.

### Destination identity before dispatch

```sh
rm -rf .scratch/arch-effect
mkdir -p .scratch/arch-effect/target
printf 'target-B' > .scratch/arch-effect/target/identity
ARCH_EFFECT_MODE=publish bend docs/bend2/examples/arch-effect-publication.bend
```

```text
intent_appended=True
journal_lines=1
durability_receipt=none
dispatch=refused:destination_identity_mismatch
```

Exit code 0. The target's identity file named `target-B` where the plan named `target-A`, so the
dispatch never ran: the tree holds `identity` and nothing else, no `dispatches.log` and no artifact.
An alias that resolves elsewhere is the case the architecture review reports from the deployment
(`../reviews/codex/codex-architecture-review.md`, finding 2), and this is the local shape of the
guarded version.

### An absent destination is a value

```sh
ARCH_EFFECT_MODE=ambiguous bend docs/bend2/examples/arch-effect-publication.bend
```

```text
dispatch=False
unsettled=no_evidence
retry=none
```

Exit code 0. The destination directory does not exist, the open fails, and the program answers with a
value: the attempt is unsettled, no evidence of delivery exists, and nothing is retried. The absent
directory is still absent afterwards, so no effect was attempted around the failure.

## Verdict

The claim holds. Every step ran at the pinned compiler, and each mode's output is the one recorded
above.

## Where the rest of the track rests on a missing primitive

| Track item | State at the pin, with the check that shows it |
|---|---|
| Capability construction restrictions | Absent. A user-declared record is constructible by any importing module, so the program validates fields instead; the provenance half needs a proof-indexed encoding or a language extension (ARCH-CLOSE-02). |
| Durable acceptance | Partial. The intent reaches the file, and no durability receipt exists for it: `bend base File.fsync` exits 1 and `File.rename` exits 1, so append-only journaling, atomic replacement and directory persistence are not available (ARCH-CLOSE-04, `B2-FS-DURABILITY`). |
| Asynchronous child lifecycle, cancellation acknowledgement, reap, process identity | Absent and not exercised here. `bend base Process` and `bend base exec` each exit 1, and `bend base IO.cancel` exits 1: Base supplies no process surface and no way to cancel another computation, so the program starts no child (ARCH-CLOSE-03/05). The language lane's `lang-cap-dropped-child.evidence.md` shows what a dropped `IO.fork` channel does instead. |
| Recovery after lost responses | Demonstrated for a filesystem destination: the recovery path re-derives the outcome from the destination and dispatches nothing. |
| Canonical publication to a controlled target | Demonstrated for a filesystem destination, with the destination identity checked before the dispatch. No other transport exists at the pin: `B2-HTTP-TLS` and `B2-PROCESS` are both open prerequisites. |

## Limits

- One process, one destination, one operation identity. The "restart" is modelled by a mode whose
  settlement path reads only the destination; no OS process is restarted and no crash is injected.
- The journal is a file the program appends to; nothing here proves the append survived a power loss.
- The publication payload is a fixed canonical string; no codec, digest or signature is exercised
  (`B2-JSON`, `B2-CRYPTO`).
- The absent-destination case is a missing directory, not a network or remote failure.

## Related

- `../target-architecture.md`: ARCH-CLOSE-02 through ARCH-CLOSE-05, M-2, M-3a, M-3c, M-18.
- `../rewrite-plan.md`: the host and proof prerequisites, `B2-DESTINATION` and `B2-FS-DURABILITY`.
- `lang-cap-durability.evidence.md`, `lang-cap-dropped-child.evidence.md`: the primitive-level records
  this program builds on.
