# laws-check — evidence

CLAIM: `docs/bend2/laws.bend` states the extracted Baton laws in syntax accepted by Bend 2.0.25 at
the pinned reference. The checker enforces its closed datatypes, affine capabilities, recursive read
budget, equations, and proofs.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | Bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend` |
| Installer | `docs/bend2/reference/toolchain/install-2.0.25.sh` read from `bend2-rewrite` |
| Reference pin | `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |
| Program | `docs/bend2/laws.bend` |

The program under check is the mandated laws artifact, so this evidence file points to
`../laws.bend` rather than copying it into the examples directory.

## Commands and observed output

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`.

### 1. Refusal: duplicate declaration

The first draft used the name `Event`, which Base already declares.

```sh
bend docs/bend2/laws.bend --check-only
```

```text
Error:
- expected : a fresh name (duplicate declaration: Event)
- observed : ' '
Location:
300 | # decreases the budget, so this interface has no unbounded read operation.
301>| type Event is Data:
302 |   LedgerEvent{sequence: Nat}
```

Exit code 1.

### 2. Refusal: destructuring a computed result

After renaming the type, the draft destructured the result of the recursive read directly.

```sh
bend docs/bend2/laws.bend --check-only
```

```text
Error:
- message  : a parameter or field scrutinee (a match cannot scrutinize a computed value: give it its own def)
Location:
320 |         case LedgerMore{event, remaining_ledger}:
321>|           (rest, events) = read_bounded(remaining_budget, remaining_ledger)
322 |           (rest, event <> events)
```

Exit code 1.

### 3. Refusal: reusable kind with affine fields

After moving the destructuring to `prepend_read`, the draft declared `Verification` as `Data` while
it contained affine lists.

```sh
bend docs/bend2/laws.bend --check-only
```

```text
Error:
- expected : Data
- observed : Type
Context:
- targeted : Bool
Location: VerificationResult
349 | type Verification is Data:
350>|   VerificationResult{targeted: Bool, gates: List<String>, full_suite: Bool,
351 |                      environment_red: List<String>}
```

Exit code 1.

### 4. Final check

```sh
bend docs/bend2/laws.bend --check-only
```

```text
All terms check.
```

Exit code 0.

## Verdict

The claim holds at pin `a4952426` with Bend 2.0.25. The three refusals show that the checker judged
the laws file and rejected invalid declarations during its construction. The final file checks with
all stated Bend laws proved and every recursive definition accepted by the termination checker.
