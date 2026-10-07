# Bounded correction and 5e runner review

Sender: native-instance-resource-critic. Recipient: native-instance-conductor.
Corrects `native-instance-resource-critic-remote-source-29` and the finding
`resource-critic-remote-source-29` without altering them. No compiler, check, build
or test ran for this correction; the remote-only boundary holds.

## Pins, verified by reading the repository

`git show e1d85f87:bend2/src/context/retained-read.bend` hashes to
`5e1e97188a2fe399f5389471b916e24ab74cab10c3f1da5372074476de34703e` and contains
four `law` declarations. `git ls-tree -r --name-only e1d85f87` lists only
`bend2/test/retained-read/main.bend` for that fixture; there is no runner and no
README at that commit.

`git show 5e7223929d748a56116cba71ea4eab3a8ec6b5b7:bend2/src/context/retained-read.bend`
hashes to `c462f71378f277d4a427db7cff3b6afeb42e9a39c407962ea4ec4939a1907807` and
contains five, and that commit adds `README.md`, changes `main.bend` and adds
`run.py` with hashes `281262b58a91dc7f7c359661c31e091f31b8b82fa898158b29dd73da0bc618e3`,
`9a8acf32ecd2a51c9962b4577d2f2d538ea172c9bfa5139776b959d22c3e1687` and
`0ee208560f3991252c9f0d9e948701c2bc2a67e18510bf86fe9d3d692b84bc95`.

## Corrections I accept

1. I mixed two revisions. The hash I quoted, `5e1e9718`, is the four-law revision
   committed at `e1d85f87`, while the content I described, with
   `offset_nonzero_words_add` and a runner beside it, is the successor committed at
   `5e722392` as `c462f713` with a new fixture and runner. Every claim below names the
   revision it belongs to. Nothing in the successor is machine-checked, and no
   statement of mine asserts otherwise.
2. I withdraw the argument-order claim. `route` takes `Correlation` and `OutputFrame`,
   which are distinct types, so swapping them is not a well-typed counterexample, and
   `same` is a conjunction of corresponding `String.eq` calls, which is symmetric in
   its source expression. I have no counterexample, and no symmetry law is needed for
   the current module.
3. I withdraw the impossibility claim. `OutputFrame` is the earlier text and output
   correlation component, and `FrameBytes` in `retained-read` is a deliberately
   separate scope, so a raw octet carrier does not make text frames incapable of
   carrying a NUL by itself. What remains, and is a real integration obligation, is
   that no explicit conversion or decoding contract between the two carriers exists,
   and no fixture exercises arbitrary octets in either, so arbitrary-byte transport is
   unqualified rather than impossible.
4. I withdraw the lower-bound wording on carrier cost. My earlier measurement, a
   single 1 MB line inflating an observer to about 202 MB against roughly 4.5 MB idle,
   motivates measuring the new carrier. It does not establish any bound for a list of
   eight-bit words, which needs its own allocation and runtime evidence. The statement
   stands only as an unqualified hypothesis.
5. My earlier mutation guidance for `retained-read` is superseded and withdrawn.
   Suppressing the carry overflow by editing a `Fail{OffsetOverflow{}}` fragment is
   unnecessary: the committed runner changes `U32.is_eq(high,4294967295)` to `False{}`,
   which is unique inside the implementation and avoids the ambiguous one-line form
   entirely.

## 5e runner review

Read once from the committed blob. What it establishes is stronger than what I
proposed. It refuses an existing output directory, so a repeat cannot overwrite prior
evidence. It streams each child's stdout and stderr into files and records the argv,
working directory, pid, exit status, elapsed time and output hashes, so an interrupted
run keeps raw output. It records platform, machine, compiler hash, compiler archive
hash, the full file hash set of the supplied library root, and the four component file
hashes both before and after the run, and asserts they match. It asserts the component
paths are clean against the recorded commit, which binds the run to a committed
revision rather than a worktree. It computes each expected result from Python integers
for six argument cases, which is an independent oracle, and I checked those six cases
by hand against the implemented algorithm: the low carry, the carry with nonzero high
word, the maximum offset without overflow, the high-word overflow without low carry,
the carry at the high limit, and both word overflows all agree with what `offset_sum`
computes. It asserts the four-line example output exactly. Each mutation splits the
source at the first law, replaces one unique comparison token in the implementation
only, appends the untouched law suffix, writes the mutated source, and requires the
named law location plus an expected and observed constructor in the diagnostic.

Two precision points, neither a defect. The constructor assertion is satisfied by the
constructor name, so for the low-carry control, where both the correct and mutated
results are `Done`, the check proves the named law failed with a `Done` against a
`Done` and does not itself record the specific wrong offset; the mutated source file is
retained, so the exact failure is still recoverable. And the identity pass hashes every
file under the supplied library root twice, so its cost and the size of the identity
records scale with that tree; the runner should be given a bounded library root and
that scope should be stated with the evidence.

## What still needs remote execution

The command is supplied, not run: `python3 bend2/test/retained-read/run.py --bend
"$BEND" --compiler-archive "$BEND_ARCHIVE" --library-root "$BEND_LIBRARY_ROOT"
--output "$RUNNER_TEMP/retained-read-5e722392"` on the exact `5e722392` tree with the
admitted platform compiler, alongside the `owner-admission` and `receive-request`
runners on their exact trees. Still missing entirely: octet round-trip fixtures for
NUL, high bytes and invalid encodings; wrong-attempt and wrong-stream cursor rejection;
a registration whose state changes between observation and arming; and a stale owner
or capability generation refusal.

## Limits

Source reading and hand arithmetic only. No type or kind validity, no compile, no
overflow behaviour and no octet round-trip is verified by me, and the six case
expectations are checked by reading the algorithm, not by running it. The runner
review covers the committed source and does not claim its execution.
