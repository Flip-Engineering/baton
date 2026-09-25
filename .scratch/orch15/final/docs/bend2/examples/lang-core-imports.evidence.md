# lang-core-imports — evidence

CLAIM: a module is a file imported by relative path under a file-local alias; a law left open in
one file is proven in another file as `def M.name`; a package import
(`import 0x<hash>/main.bend as P`) names content the Hub serves at check time, so a checked-in
local module is the form that works offline (vendoring).

## Environment

| | |
|---|---|
| Host | macOS 27.0 (Build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` with `BEND_HOME=<worktree>/node_modules/.bend` (this worktree is cut from master, whose `.gitignore` does not carry the `.bend/` lines, so the install lives under the ignored `node_modules/`) |
| Reference pin | `../reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. The missing-file and Hub variants are throwaway programs under
`node_modules/.bend/scratch-core/` (git-ignored), quoted below where short.

## Commands and observed output

### 1. The library alone is refused while its law is open

```sh
bend docs/bend2/examples/lang-core-imports-lib.bend --check-only
```

```
Error: 1 TODO found.
The code is incomplete, and not a valid proof yet.
```

Exit code 1. The open `law plus_zero` is a tracked TODO, so the claim is enforced wherever the
file is checked.

### 2. An unproven fill is refused

The first draft proved the law for `U32` with bare reflexivity, `def L.square_zero(x): {==}`:

```
Error:
- expected : U32.add(U32.mul(x, 0), x)
- observed : x
Context:
- x : U32
Location: lang-core-imports-lib.square_zero
15 | def L.square_zero(x):
16>|   {==}
17 |
```

Exit code 1. Word arithmetic over a symbolic `x` does not normalize, so `{==}` does not close it;
the shipped example instead states the law over `Nat` and proves it by induction with a rewrite.

### 3. The importer checks and runs: law proven in a second file, def called under its alias

```sh
bend docs/bend2/examples/lang-core-imports.bend --check-only
```

```
All terms check.
```

Exit code 0. The proof `def L.plus_zero` in `lang-core-imports.bend` fills the law opened in
`lang-core-imports-lib.bend`. Then:

```sh
bend docs/bend2/examples/lang-core-imports.bend
```

```
L.square(7) = 49
```

Exit code 0.

### 4. An import naming an absent file is refused at check time

`node_modules/.bend/scratch-core/imports-missing.bend`:

```python
import Base
import ./nope.bend as X

def main() -> U32:
  X.seven()
```

```sh
bend node_modules/.bend/scratch-core/imports-missing.bend --check-only
```

```
Error:
- message  : no such file: node_modules/.bend/scratch-core/nope.bend
Location:
1 | import Base
2>| import ./nope.bend as X
3 |
```

Exit code 1.

### 5. A package import fetches from the Hub at check time and verifies the hash

`node_modules/.bend/scratch-core/imports-hub.bend` names a syntactically valid but nonexistent
content hash:

```python
import Base
import 0x1111111111111111111111111111111111111111111111111111111111111111/main.bend as P

def main() -> U32:
  7
```

```sh
bend node_modules/.bend/scratch-core/imports-hub.bend --check-only
```

```
Error:
- message  : a file at https://hub.bend-lang.com/0x1111111111111111111111111111111111111111111111111111111111111111/manifest hashing to 1111111111111111111111111111111111111111111111111111111111111111
Location:
1 | import Base
2>| import 0x1111111111111111111111111111111111111111111111111111111111111111/main.bend as P
3 |
```

Exit code 1. The refusal names the URL the checker fetches (`https://hub.bend-lang.com/0x<hash>/manifest`)
and the hash it demands, so a Hub import pins content by hash. The fetch happens only when the
hash is absent from the loader's local cache (`BEND_LIB`), which holds files already verified
against their manifest hash; a hash seen before checks from the cache. The `--publish` flow that
mints such a hash line was not exercised: it uploads to the third-party Hub, which is outside a
design lane's authority.

## Upstream corroboration

At pin `a4952426`: `tests/import/cross_file_proof.bend` records the same missing-file refusal
shape for a leading-line import; `tests/import/` holds the module corpus (`shadow_base`,
`diamond_dedup`, `parent_segments`); `tools/bend-fmt-lsp` is the formatter/LSP package shipped in
the same repository.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: modules are files with
file-local aliases, laws ship open and are filled cross-file under the `def M.name` name, the
checker enforces an open law everywhere the file is checked, and Hub imports resolve at check
time against hash-pinned content, fetched only on a `BEND_LIB` cache miss. A checked-in local
module (as `lang-core-imports-lib.bend` is vendored beside its importer) is the form that checks
with no network.
