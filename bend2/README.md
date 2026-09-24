# bend2

Production Bend2 source tree on the `bend2-rewrite` branch.

## Module protocol

Every module under `bend2/src/` is a Bend program with `def main() -> IO(Unit)`.

`main` runs the module's own checks over its frozen corpus and prints one deterministic
line per check. The module stdout is identical when run interpreted (`bend <file>`) and
native (`bend <file> -o <out>`, then `<out>`), and byte-identical to the committed
`<name>.expected.txt` alongside each module.

Each module carries a header block:

- **CLAIM** in one sentence.
- The approved law entries and correction rows the module serves (`LANG-CAP-nn`,
  `ARCH-CLOSE-nn`).
- The fixture it reads (or a note that it uses an inline corpus).
- The reference pin: bend 2.0.25, `bendlang/bend@a4952426`.
- The `docs/bend2` record documenting the corpus it was promoted from.

A module that reads an external corpus path accepts it from `IO.args()` when given and
otherwise uses the repo-root-relative default recorded in its header.

Modules honour `docs/bend2/laws.bend`: no module encodes behaviour that contradicts an
approved entry, and its header names the entries it serves.

## The one command

```
node bend2/scripts/run-checks.mjs
```

Run from the repository root. The runner:

1. Resolves `node_modules/.bend/bin/bend` (or `.bend/bin/bend`); if absent, installs
   bend 2.0.25 via `docs/bend2/reference/toolchain/install-2.0.25.sh`.
2. Asserts `bend version` reports `bend 2.0.25`.
3. Discovers every `bend2/src/**/*.bend`, sorted.
4. Per module: runs `--check-only`, the interpreted run, and the native build into
   `.scratch/bend2/<name>` followed by that binary's run.
5. Compares both stdouts to `<name>.expected.txt`.
6. Prints one JSON line per module and a final summary line.
7. Exits 0 when every module is green.

No network access, no npm dependencies; node stdlib only. Build scratch lives under
`.scratch/bend2/`.

## Laws relationship

Each module header names the law entries and correction rows it serves. Modules do not
import example models from `docs/bend2/`; they read frozen corpus files at run time when
a corpus path is documented in the header.
