# Issue #1236 parser patch

`ctor-shadow.patch` is the narrow parser change from Lorenzo Battistela's
`flip-engineer/bend` commit `da49ccd09f68cff69fefecd7a59aa2be94c897fd`.
It changes term-variable and named-call resolution so an unqualified constructor name does
not redirect a variable reference away from the current module's definition.
Constructor lookup remains enabled for other resolver callers, including
constructor calls and patterns.

The source selected by Baton is `bend2/compiler/upstream/bend.ts`, whose
contents are locked by `bend2/compiler/repl-upstream.lock.json` and included
in the archive named there. The patch targets that tracked source. The vendored
source applies the adaptation in this branch. A released archive
must contain the same updated `bend2/bend.ts` bytes. Compiler selection updates
the archive hash, lock, provenance and runtime pin together.

The regression inputs are in `bend2/test/compiler/fixtures/ctor-shadow/`.
`bend2/test/compiler/ctor_shadow.ts` loads the importing module and checks that
the law's type refers to the imported module's `Done` definition and that its
proof checks. The loader's recorded namespace identifies the module internally;
`M` is its alias in the entry file. The reproducer uses the same module and entry
split as upstream issue #1236.

The 2.0.25 call parser resolves an unbound variable again before constructing a
named call. That resolver call also excludes constructor lookup so it preserves
the module reference selected by `parse_var`.
