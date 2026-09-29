# lang-cap probes — evidence

CLAIM: five mechanisms at the pin: an exported affine constructor is forgeable from an importing
module; an affine value can be dropped without its release path; a pure fold returning a
fixed-shape result preserves nothing about history while a stated law separates the two; a
receipt-shaped result establishes no durable write before acknowledgment; and a shared return type
forces no single derivation.

Provenance: this file reproduces, in this checkout, the independent reviewer's probe table (Codex
review r3, `/private/tmp/baton-resident-20260921/codex-context-and-review-r3.md`, "Findings
requiring revision" items 2–6 and "Probe results"), under the orchestrator's verification
assignment of 2026-09-22. Programs: `lang-cap-lease.bend` (the shared Lease module),
`lang-cap-forge.bend`, `lang-cap-drop.bend`, `lang-cap-history.bend`,
`lang-cap-history-law.bend`, `lang-cap-receipt.bend`,
`lang-cap-second-predicate.bend`. The scratch variants quoted below live under
`node_modules/.bend/scratch-cap/` (git-ignored) and are quoted in full.

## Environment

| | |
|---|---|
| Host | macOS 27.0 (Build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`; its guide files sha256-match `../reference/README.md` (`9e464364…`, `4d7178c7…`, `5831b0de…`) |
| Reference pin | `../reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. The programs sit on `bend2-rewrite` at `23d3b857`.

## Commands and observed output

### (a) An exported affine constructor is forgeable from an importing module

`lang-cap-lease.bend` declares `type Lease is Type:` (affine: no `is Data`) with `acquire`,
`release`, and no private-constructor mark of any kind. `lang-cap-forge.bend` imports it as `L`
and builds the lease directly:

```python
forged : L.Lease = L.Lease{999}
out : String = L.release(forged)
IO.print("forged lease in, release says: " ++ out)
```

```sh
bend docs/bend2/examples/lang-cap-forge.bend
```

```
forged lease in, release says: released 999
```

Exit code 0. `acquire` is never called; the checker admits `L.Lease{999}` in the importing module
(its context names the type `lang-cap-lease.Lease`), and `release` answers the forged field.

### (b) An affine value can be dropped without its release path

```sh
bend docs/bend2/examples/lang-cap-drop.bend
```

```
leak answers 42 and no release ran
```

Exit code 0. `leak(l: L.Lease)` answers 42; `release` never runs, and nothing refuses the drop.

Negative control (`node_modules/.bend/scratch-cap/withmod/duplicate-lease.bend`, which reuses the
same lease twice):

```sh
bend node_modules/.bend/scratch-cap/withmod/duplicate-lease.bend --check-only
```

```
Error:
- expected : l
- observed : l (consumed more than once)
Location: twice
3 |
4>| def twice(l: L.Lease) -> String:
5 |   L.release(l) ++ L.release(l)
```

Exit code 1. Affinity enforces at-most-once use; the drop path is free and runs no cleanup.

### (c) A fixed-shape result does not prove history is preserved; a stated law does

The discarding implementation (`lang-cap-history.bend`):

```python
def add_review(history: List<U32>, r: U32) -> List<U32>:
  [r]
```

```sh
bend docs/bend2/examples/lang-cap-history.bend
```

```
add_review([1,2], 3) answers [3]
```

Exit code 0. The type checks and the program runs; the answer is `[3]` and the history argument
is gone.

The same obligation as a concrete law over `[1, 2]` plus 3, with the appending implementation
(`lang-cap-history-law.bend`):

```python
law add_review_keeps_history:
  {add_review([1, 2], 3) == [1, 2, 3] : List<U32>}
```

```sh
bend docs/bend2/examples/lang-cap-history-law.bend --check-only
```

```
All terms check.
```

Exit code 0.

The discarding implementation under the same law
(`node_modules/.bend/scratch-cap/history-law-neg.bend` — the same file with `[r]` as the body):

```sh
bend node_modules/.bend/scratch-cap/history-law-neg.bend --check-only
```

```
Error:
- expected : [3]
- observed : [1, 2, 3]
Location: add_review_keeps_history
 9 | def add_review_keeps_history():
10>|   {==}
11 |
```

Exit code 1. The concrete equality is a checkable mechanism that separates the two
implementations; the law that binds Baton2 must take the quantified form over every history.

### (d) A receipt-shaped result does not establish a durable write

```sh
rm -f node_modules/.bend/scratch-cap/durable.txt
bend docs/bend2/examples/lang-cap-receipt.bend
ls node_modules/.bend/scratch-cap/durable.txt
```

```
acknowledged receipt 1
ls: cannot access 'node_modules/.bend/scratch-cap/durable.txt': No such file or directory
```

`commit_receipt` returns `Receipt{1}` after a sleep and no write; the program acknowledges and
exits 0, and the named path was never created.

### (e) A shared return type forces no single derivation (review finding 6)

```sh
bend docs/bend2/examples/lang-cap-second-predicate.bend
```

```
holder_view then second_view answers Custody{0}
```

Exit code 0. Two defs both taking and returning `Custody` check and run; the second builds
`Custody{0}` directly.

## Match against the reviewer's probe table

| Probe | Codex r3 observed | This reproduction |
|---|---|---|
| Construct exported affine lease in an importing module | Success; returns 999 | Success; `released 999`, exit 0 |
| Drop an affine lease | Success; returns 42 | Success; `42`, exit 0 |
| Reuse the same affine lease twice | Rejected: consumed more than once | Same refusal, exit 1 |
| Discard earlier reviews in a pure function | Success; returns `[3]` | Success; `[3]`, exit 0 |
| Define another function returning the same custody type | Success; returns `Custody{0}` | Success; `Custody{0}`, exit 0 |
| Wait and return a receipt with no durable write | Success | Success; `acknowledged receipt 1`, file absent |
| Assert history preservation for the discarding function | Rejected: `[3]` differs from `[1, 2, 3]` | Rejected: expected `[3]`, observed `[1, 2, 3]`, exit 1 |
| Assert the same concrete property for the appending function | All terms check | `All terms check.`, exit 0 |

## Checker facts the probes had to learn

- A `type` declaration must state its kind: `type Lease:` alone is refused with
  `expected : 'is'`; the affine form is `is Type`.
- A law body sees only names defined above it in the same file; a law placed before the def it
  quantifies over is refused with `expected : a defined name`.
- A `match` heads a def body; a `match` as a step inside a `do` block is refused with
  `a match heads a def body, not a term`.
- A def returning a plain type is bound with `=` inside a `do` block; `<-` expects the IO
  operation shape.

## Verdict

Every row of the reviewer's probe table reproduces at pin `a4952426` with toolchain 2.0.25 on
this host, and the five mechanism findings hold: exported affine constructors carry no provenance;
affinity bounds use and enforces no cleanup; a list-shaped result preserves nothing about history
while a stated law separates the two; a receipt variant pins no write ordering or persistence; a
shared return type constrains no reader. The scope corrections to
`../language-review.md` (LANG-F-26..29) land with this evidence.
