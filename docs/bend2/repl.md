# Bend2 REPL

Bend2 is the supported REPL input language. The contextual `repl` action evaluates Bend2 expressions and retains checked
definitions in a notebook owned by the current actor. The notebook handler,
source composition, result selection and process lifecycle are Bend2 code in
`bend2/src/coordinator/repl*.bend`.

The bundled compiler provides the canonical Bend2 parser, inference,
type and affine checker, normalizer and native code generator. Its frontend
adapter accepts actual Bend2 source. `bend2/compiler/repl.ts` calls those upstream
operations. CLI, MCP and interactive input reach the same Bend2 command handler.

## Commands

```text
baton repl define 'def double(+x: U32) -> U32: U32.add(x,x)' --label arithmetic
baton repl eval 'double(21)' --label answer
baton repl bind saved_answer --cell answer
baton repl eval 'U32.add(saved_answer(),1)'
baton repl eval 'IO.write("complete output\n")' --type 'IO(Unit)'
baton repl define --stdin --notebook analysis
baton repl read --cell answer
baton repl recover
baton repl cite --cell arithmetic
baton repl share --cell arithmetic --to reviewer
baton repl resolve --cell CITATION
baton repl import MESSAGE
baton repl interactive
```

The registered project and actor supply context. `--notebook NAME` selects a
notebook; its default is `main`. Each cell has an immutable reference generated
by Baton. `--label NAME` adds a semantic name; selecting a repeated label returns
its latest cell. `read` without `--cell` returns the complete notebook. `bind`,
`recover`, `cite` and `share` select its latest cell by default.

`define` accepts complete Bend2 declarations, including imports, types and named
functions. Only a declaration cell whose canonical check succeeds enters later
source snapshots. The names `main` and `__baton_repl_expression` are reserved for
evaluation entry points and are refused before a declaration succeeds. `eval`
accepts a Bend2 expression. The compiler infers its type;
`--type` supplies an expected type when the expression needs one. Pure results
use the canonical normal-form renderer. An IO expression produces a native
program whose complete stdout, stderr and actual wait status become its result.

`bind NAME` takes a successful pure result's canonical type and normal form and
submits a named Bend2 definition through the same compiler. Later expressions
call that definition. Its submitted source records the original immutable cell
reference. IO results retain their output and process status in the cell.

Definitions compose in source order. Each cell stores the exact accepted
declaration snapshot and submitted source before compilation starts. Imports
resolve through the canonical loader in the notebook's recorded workspace.
Imported workspace files retain ordinary filesystem semantics. A cell's source
snapshot records their import declarations. Packaged Base and compiler files
have exact dependency hashes.

The cumulative book is checked after each declaration load. A redefinition must
preserve the type and affine validity of that complete book.

The MCP `baton2_repl` tool accepts `define`, `eval`, `bind`, `read`, `cite`, `resolve`,
`recover`, `share` and `import`. Its source field carries a complete Bend2 source string;
`bind` takes the definition name in its name field. The
generic `baton2_action` tool also accepts action `repl` and the same CLI
arguments. `help repl` describes both surfaces.

## Interactive input

Interactive mode reads complete UTF-8 lines. Ordinary lines append to the
current durable draft. Commands occupy a complete line:

| Command | Effect |
| --- | --- |
| `:define` | Select declaration mode for the current draft. |
| `:eval` | Select expression mode for the current draft. |
| `:submit` | Commit and evaluate the draft, then clear it. |
| `:bind NAME` | Check a named definition from the latest pure result. |
| `:read` | Print all source and result records in the notebook. |
| `:clear` | Explicitly clear the draft and select expression mode. |
| `:quit` | End interactive input and preserve the draft. |

EOF also preserves the draft. A later interactive invocation restores it.
Multiline source remains complete in the database. A compiler refusal remains a
cell result, and interactive input continues after its recorded outcome.

## Native custody and recovery

The notebook retains its recorded actor and workspace. An evaluation acquires a
physical notebook guard before choosing accepted declarations and committing its
cell. An unfinished cell is recovered before another submission can compose from
that notebook.

The compiler frontend and a generated IO program are separate attempts under
the existing database owner. Their manifests retain executable arguments,
workspace, complete stdin, source artifact and recovery command. Source artifacts
are derived program inputs. Complete stdout bytes are copied to `stdout.saved`
before custody acknowledges its spool; stderr and actual wait status remain in
the original attempt. UTF-8 or filesystem failures retain their diagnostic and
physical evidence.

Recovery attaches to the original retained attempt, observes its natural result
and continues an unfinished stage. A completed native stage remains recorded.
Actual compiler or native failures remain visible through `read`. Explicit
actor stops refuse new work and signal the actor's retained evaluation through
the existing process API. Removing the observer preserves owner custody and
the notebook guard for recovery.

IO uses the actor's existing native process authority in its recorded workspace.
Foreign C imports and native effects have that process authority. Canonical Bend2
typing and affine checks apply to each program. Live affine resources remain
inside that evaluation. Subsequent cells compose retained declarations. Labels
select saved result records. A pure normal form can supply a new checked named
definition. IO stdout and process outcomes are observable results.

## Context citations

`cite` selects a completed successful cell in the actor's notebook and returns
its immutable citation, cell reference, owner, notebook, label, version and type.
A citation has the form `repl:NOTEBOOK_ID:LABEL@SEQUENCE`; an unlabelled cell uses
its cell reference for the label position. Reusing a label creates a later cell.
An earlier citation continues to select its original cell and source snapshot.

`share` sends that metadata as a `bend-repl` message through ordinary routing.
The message and its recipient's read grant commit in one database transaction.
The stored grant derives its recipient from the admitted message. Citations and
ordinary messages cannot independently create read authority. Each recipient
resolves only its own grants; the cell owner can also resolve its own citations.
Explicitly stopped actors cannot share or resolve cells.

`resolve --cell CITATION` returns the complete submitted source, declaration
snapshot, type, stdout, stderr and process outcomes for that version. Cross-seat
results contain these values and metadata. The separate execution-directory and
argument fields remain in the owner's `read` records. Complete compiler stdout
can include paths in its recorded build provenance. Resolution displays the complete
original citation message through the recipient-owned read path before returning
the cell. Each invocation uses the durable cell and grant records, including
after the receiving process restarts.

`import MESSAGE` selects a shared declaration cell delivered to the current actor
and checks its complete snapshot in that actor's notebook. Earlier complete-cell
share messages remain importable. It prints the original message through the
recipient-owned read path, followed by each checked declaration's result. A
compiler refusal retains its cell and the source message. Pure results can be
retained as declarations with `bind` and then shared and imported.

## Bundled compiler

Standard native archives and normal installations include the Bend2 REPL compiler,
its pinned source and Base/effects, Bun runtime, and distribution notices.
Package creation requires these verified build inputs:

```text
--repl-runtime PLATFORM_BUN_EXECUTABLE
--repl-runtime-sha256 VERIFIED_RUNTIME_SHA256
--repl-runtime-notices COMPLETE_BUN_DISTRIBUTION_NOTICES
```

The compiler lock in `bend2/compiler/repl-upstream.lock.json` records the exact
source/Base/effects and license hashes. The source closure is checked in under
`bend2/compiler/upstream`. `stage-repl-compiler.py` checks
those files, copies the selected Bun executable and its notices, and applies
explicit extensions to the canonical virtual-source loader and native frontend.
Its manifest records every staged file's path, size, mode and SHA256. The package
manifest marks `bend2-repl-compiler` as required and records the compiler manifest
hash. Package creation fails if required inputs are absent. Language context
module selection controls its own provider payloads.

The installed launcher is `libexec/baton2/repl/compiler` beside the existing
adapter payload. It uses its packaged Bun with `--smol` and the established
compiler stack setting. The compiler's native build selects Clang through its
existing frontend and links SQLite for Baton host imports. Actual compiler
commands, statuses and diagnostics remain in the compiler attempt's stderr.
Native IO evaluation requires a C toolchain and SQLite headers and library.
Darwin installation checks Apple Command Line Tools and the macOS SDK before
activation. Linux source installations require Clang 14 or later and SQLite
development files.

The implementation is scoped by [#778](https://github.com/Flip-Engineering/baton/issues/778).
The [qualification record](repl-qualification-20261016.md) records package and
compiler checks and the pending coordinator, installed and native acceptance.
