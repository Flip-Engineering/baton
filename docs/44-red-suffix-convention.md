# The `-red` test-suffix convention

`*-red.test.mjs` names a test file written before the implementation it describes: a spec clause,
an audit finding, or a deferred part of a design. The suffix records where the file came from. It
has no effect on the suite verdict or on a landing gate.

## Rules

1. **A red file cites the issue that tracks its work.** The issue, not a list in the repository,
   records that the work is unfinished.
2. **A red file fails on the target until its implementation lands.** A landing gate re-runs a
   change's failing files on the target and blocks only on failures the target does not share
   ([42-suite-legitimacy.md](42-suite-legitimacy.md) §3), so a red file never blocks an unrelated
   landing. A new red file fails with the change and is absent on the target, so it blocks the
   landing that adds it: land it together with its implementation, or keep it on the branch that
   implements it.
3. **The suffix is removed when the file's tests pass.** Renaming the file is part of the change
   that makes it green.
