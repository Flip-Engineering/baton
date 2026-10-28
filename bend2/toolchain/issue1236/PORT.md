# Issue #1236 parser patch

`ctor-shadow.patch` is the narrow parser change from Lorenzo Battistela's
`flip-engineer/bend` commit `da49ccd09f68cff69fefecd7a59aa2be94c897fd`.
It changes term-variable resolution so an unqualified constructor name does
not redirect a variable reference away from the current module's definition.
Constructor lookup remains enabled for other resolver callers, including
constructor calls and patterns.

The source selected by Baton is `bend2/compiler/upstream/bend.ts`, whose
contents are locked by `bend2/compiler/repl-upstream.lock.json` and included
in the archive named there. The patch targets that tracked source. When a new
archive is prepared, apply the same hunk to its `bend2/bend.ts` source. It is
kept as a reviewable source proposal until a compiler release is prepared.
Selecting it requires adding the updated source to the release archive and
updating the lock, provenance, runtime pin and release selection together.

The regression inputs are in `bend2/test/compiler/fixtures/ctor-shadow/`.
`bend2/test/compiler/ctor_shadow.ts` loads the importing module and checks that
the law's type refers to `M.Done`. The issue reproducer uses the same module
and entry split as upstream issue #1236.
