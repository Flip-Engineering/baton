# lang-core-types — evidence

CLAIM: bend 2.0.25's checker enforces affine use and Data-only copying at the type level, verifies
termination by shrinking arguments, and its expressiveness limits are checker rules: a computed
value cannot be a match scrutinee, mutually recursive defs are refused, and Type-kinded values
(closures) cannot be marked reusable.

## Environment

| | |
|---|---|
| Host | macOS 27.0 (Build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` with `BEND_HOME=<worktree>/node_modules/.bend` (this worktree is cut from master, whose `.gitignore` does not carry the `.bend/` lines, so the install lives under the ignored `node_modules/`) |
| Reference pin | `../reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. Refusal variants are throwaway programs under
`node_modules/.bend/scratch-core/` (git-ignored); they are quoted below in full.

## Commands and observed output

### 1. Type check the positive program

```sh
bend docs/bend2/examples/lang-core-types.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run it (main returns a value; the checker normalizes and prints it)

```sh
bend docs/bend2/examples/lang-core-types.bend
```

```
"49 42 2"
```

Exit code 0. `49` is `area(Square{7})`, `42` is the closure `add2(2)`, and `2` is
`length(&1, U32, pair_of(5))` — one `length` def serving a `List<U32>` through the `Kind(a)`
parameter.

### 3. Affine use refused

`node_modules/.bend/scratch-core/neg-affine.bend`:

```python
import Base

def twice(x: U32) -> U32:
  (x + x : U32)

def main() -> U32:
  twice(21)
```

```sh
bend node_modules/.bend/scratch-core/neg-affine.bend --check-only
```

```
Error:
- expected : x
- observed : x (consumed more than once)
Location: twice
2 |
3>| def twice(x: U32) -> U32:
4 |   (x + x : U32)
```

Exit code 1.

### 4. Reusable marker on a Type-kinded parameter refused

`node_modules/.bend/scratch-core/neg-copy-closure.bend`:

```python
import Base

def run(+f: U32 -> U32) -> U32:
  (f(1) : U32)

def main() -> U32:
  run(x => (x + 1 : U32))
```

```sh
bend node_modules/.bend/scratch-core/neg-copy-closure.bend --check-only
```

```
Error:
- expected : Data
- observed : Type
Location: run
2 |
3>| def run(+f: U32 -> U32) -> U32:
4 |   (f(1) : U32)
```

Exit code 1. A `+` parameter requires the `Data` kind; function types are `Type`, so closures are
never copyable (`../reference/upstream/guide/GUIDE.md`, "Reusable variables require `Data`").

### 5. Match on a computed value refused

`node_modules/.bend/scratch-core/neg-match-computed.bend`:

```python
import Base

def bad(n: Nat) -> Nat:
  match Nat.add(n, 1n):
    case 0n:
      0n
    case 1n+p:
      p

def main() -> Nat:
  bad(2n)
```

```sh
bend node_modules/.bend/scratch-core/neg-match-computed.bend --check-only
```

```
Error:
- message  : a parameter or field scrutinee (a match cannot scrutinize a computed value: give it its own def)
Location:
3 | def bad(n: Nat) -> Nat:
4>|   match Nat.add(n, 1n):
5 |     case 0n:
```

Exit code 1.

### 6. Mutual recursion refused

`node_modules/.bend/scratch-core/neg-mutual.bend`:

```python
import Base

def is_even(n: Nat) -> Bool:
  match n:
    case 0n:
      True{}
    case 1n+p:
      is_odd(p)

def is_odd(n: Nat) -> Bool:
  match n:
    case 0n:
      False{}
    case 1n+p:
      is_even(p)

def main() -> Bool:
  is_even(4n)
```

```sh
bend node_modules/.bend/scratch-core/neg-mutual.bend --check-only
```

```
Error:
- expected : a defined name
- observed : is_odd
Context:
- p : Nat
Location: is_even
7 |     case 1n+p:
8>|       is_odd(p)
9 |
```

Exit code 1. A def is not in scope inside its own mutual-recursion group, so the pair cannot be
written as two defs; the guide names the replacements (`../reference/upstream/guide/GUIDE.md`,
"Recursion and Termination": fuel argument, or one def with a selector argument).

## Upstream corroboration

The pinned repository's `tests/check/` holds the checker's own corpus (1853-line listing, cases
from `array_never_copyable.bend` to `capture_soundness.bend`), read at pin `a4952426`.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: the positive program checks
and runs, and the checker refuses affine violation, closure copying, computed scrutinees and
mutual recursion, each with a precise message. The expressiveness limits are checker rules a
programmer meets at write time, not runtime behavior.
