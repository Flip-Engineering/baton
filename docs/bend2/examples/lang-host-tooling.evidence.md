# lang-host-tooling — evidence

CLAIM: the toolchain is the single `bend` command, whose surface is check, run, native build,
JavaScript build, page bundle and publish; it has no test, debug, repl or format subcommand. The
project's own tests under `tests/` are run by `gates/test.ts`, which compares each program's
standard output against the `#|` lines in its own source, and this program is written to that
convention. The one tool beside the binary is `tools/bend-fmt-lsp`, a formatting-only language
server.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0 (build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| bun | 1.3.8 |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. Build artifacts went to `<worktree>/node_modules/.bend/scratch-host`.

## Commands and observed output

### 1. The whole command surface

```sh
bend --help
```

```
Bend 2.0.25: check, run, build and publish Bend programs.

usage:
  bend <file.bend> [args]       check the file, then run main with args
  bend <file.bend> -o <out>     build a binary; <out>.c emits C, <out>.js JS
  bend <file.bend> --check-only check the file and its imports; run nothing
  bend <file.bend> --publish    publish the file and its imports to the hub
  bend <page.html> -o <dir>     bundle a page that imports .bend files
  bend base [--types|<name>]    print Base, its types, or a name and subnames
  bend guide                    print the Bend guide
  bend update                   install the latest bend (curl | sh, shown first)
  bend version                  print the version

Read the guide (`bend guide`) before writing Bend code.
```

`-o <out>.c` also emits the C source, and the built binary takes `--threads N` and `--gpu <off|NGB>`
(`upstream/guide/GUIDE.md`, "Tooling").

### 2. Type check

```sh
bend docs/bend2/examples/lang-host-tooling.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 3. Run

```sh
bend docs/bend2/examples/lang-host-tooling.bend
```

```
lang-host-tooling: these two lines are also this file's #| lines
42
```

Exit code 0.

### 4. The `#|` convention, checked

```sh
bend <file> 2>/dev/null > <scratch>/tooling.out
awk '/^#\|/{sub(/^#\|/,""); print}' <file> > <scratch>/tooling.want
diff -u <scratch>/tooling.want <scratch>/tooling.out
```

`diff` reports no difference: the program's standard output is byte-identical to the two `#|`
lines at the end of its own source.

`gates/test.ts` at the pin reads those lines the same way and is the project's harness for
`tests/`: it collects `#|` lines as the expected output, then runs each program on the check lane,
the interpreted lane, the JavaScript lane and the native C lane, under a 5-second alarm, and fails
the test when any lane's output differs (`gates/test.ts`, the header comment and `test_judge`).
`gates/` holds six files in all: `test.ts`, `_lib.ts`, `_run.ts`, `perf.ts`, `ping.ts`, `repo.ts`.

### 5. Native build and run, JavaScript build and run

```sh
bend docs/bend2/examples/lang-host-tooling.bend -o <scratch>/lang-host-tooling
<scratch>/lang-host-tooling
bend docs/bend2/examples/lang-host-tooling.bend -o <scratch>/lang-host-tooling.js
bun <scratch>/lang-host-tooling.js
```

Both print the two lines and exit 0. The native build of this small program takes about 1 s and
writes 1,126,848 bytes; the JavaScript build writes 13,025 bytes.

### 6. The subcommands that do not exist

```sh
bend test
bend debug
bend repl
bend fmt
```

Each answers the same way, taking the word as a file name:

```
Error:
- message  : no such file: test
```

Exit code 1. The same output appears for `debug`, `repl` and `fmt`.

### 7. The upstream test and tool inventory at the pin

Counted from the pinned tree (`https://api.github.com/repos/bendlang/bend/git/trees/a4952426?recursive=1`):
1,428 `.bend` files under `tests/`, across 24 directories, 1,488 files in all.

| tests/ directory | files | | tests/ directory | files |
|---|---|---|---|---|
| flatten | 240 | | reg | 93 |
| check | 230 | | run | 83 |
| parse | 148 | | proof | 80 |
| compile | 119 | | comptime | 50 |
| io | 116 | | eval | 39 |

The remaining directories hold 35 or fewer each: halt, import, base, stuck, page, grade, state,
spec, rfc, printer, show, stats, cost, gfx.

`tools/` holds one tool, `bend-fmt-lsp`, and its README states its scope: "formatting-only language
server for Bend 2. It supports full-document formatting over stdio and intentionally exposes no
diagnostics, completion, hover, range-formatting, or on-type-formatting features." Its `src/test/`
holds two test files for the formatter and the server.

The pinned `README.md` names what the tooling does not have: "No test framework and no
documentation beyond the guide"; "Error messages are terse; no debugger, profiler or REPL"; "Editor
support is limited to formatting; there is no completion, hover or diagnostics LSP"; "One C file
per program: no separate compilation, no incremental builds"; "Compiling to native is slow
(clang/CUDA/Metal). For fast development, use JS"; "The hub has no names, versions, accounts or
search yet. Packages are hashes."

`bend --publish` sends a file and its imports to that hub. A separate `bend test` for a user's own
program does not exist: `tests/` and `gates/test.ts` are the project's harness for the language
itself, and they run from the checkout.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. One command covers check,
run, native build, JavaScript build, page bundle and publish, and it answers `test`, `debug`,
`repl` and `fmt` with "no such file". The `#|` convention is real and mechanical: this program's
standard output is byte-identical to its own `#|` lines, which is how `gates/test.ts` judges 1,428
upstream test programs on four lanes. The toolchain ships one companion tool, a formatting-only
language server, and the pinned README states there is no debugger, profiler, REPL, incremental
build or test framework beyond the language's own harness.
