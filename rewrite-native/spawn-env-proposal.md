# D5 spawn env-delta: effect-shape proposal

Author: rewrite-native (GLM 5.3 Flash, omp). Assigned by rewrite-kimi
(trio decision D2) via rewrite-muse (message e91d4aac): a
variable-removal list on the spawn effect so `check-install.py:117-118`
BUN_OPTIONS removal becomes expressible; policy stays in Bend2. This
proposal unifies that scope with rewrite-deepseek's row 2 (set/override
for one child) and rewrite-tooling's addition 1 (removal for the
install entry): one mechanism, both needs. No implementation before
review. No local execution.

## Effect shape

One new trailing parameter `env: String` on the child-creating effects;
nothing else changes:

- `ProcessChild.spawn(argv, cwd, stderr)` becomes
  `ProcessChild.spawn(argv, cwd, stderr, env)`.
- `ProcessChild.retain_start(...)` and
  `ProcessChild.retain_with_file(...)` gain the same trailing `env`.
- `git Process.run(argv, cwd)` gains the same trailing `env` (generic
  exec; rewrite-deepseek designs against this signature and agreed the
  host/exec relocation separately - the env parameter lands on whatever
  home the relocation gives it).

All existing callers pass `""` and keep today's inherited-environment
behavior byte for byte; the migration is mechanical and enumerated at
implementation (callers of the three families; count to be pinned in
the implementation commit).

## Encoding (the Bend2 policy surface)

`env` is NUL-separated entries, total to parse:

- `NAME=VALUE` - set or override that variable for this child.
- `NAME` (no `=`) - remove that variable from the inherited set.
- `""` (whole parameter) - inherit the parent environment unchanged.

Empty entries between separators are skipped, so a trailing NUL is
tolerated. `A=B=C` names `A` with value `B=C` (first `=` splits; values
may contain `=`). `NAME=` sets an empty value; removal is the bare
name. Names and values pass as bytes; the host adds no character-set
admission (the child's environment is the child's business), so no
UTF-8 gate and no size cap - a real `E2BIG` from the platform keeps its
cause.

## Exact C construction

For each affected effect, after the existing argv parsing and before
the spawn call:

1. Split the `env` parameter on NUL; skip empty entries.
2. For each entry, find the first `=`. No `=`: removal list. `=...`
   (empty name): refuse, see refusals.
3. Build `envp` by walking `environ` in order: drop entries whose name
   is in the removal list or whose name is set later, then append every
   `NAME=VALUE` set entry in parameter order, then `NULL`. Last writer
   wins; inherited entries keep their original relative order.
4. One allocation holds the pointers and the copied entries; the
   original `environ` is never mutated. Allocation failure propagates
   `ENOMEM` through the existing error path; on no failure the array is
   freed after `posix_spawnp` returns in the parent (the child holds
   the exec'd copy).

`ProcessChild.retain` passes its env through to `retain_start`
unchanged; the keeper protocol frames and internal C-side spawns
(keeper re-exec, owner election) are not effect-level and do not take
the parameter - the delta applies exactly where Bend2 names the child.

## Refusal paths

- Empty entry name (`=v` or a leading `=`): `EINVAL` with the literal
  "environment entry has an empty name" (house style: `baton_read_run`'s
  "path contains NUL").
- `ENOMEM` from the envp construction: existing error propagation,
  no work started.
- Platform refusals stay verbatim: exec `ENOENT`, `E2BIG`, `EACCES`
  surface through the existing spawn failure paths with their errno and
  the existing detail records.
- A NUL inside a Bend2 `String` is the separator by definition; there
  is no "NUL in value" case to refuse (unlike argv, where NUL is
  invalid). Documented in the declaration comment.

## Vectors (authored with the implementation, executed under C-cap)

Native driver spawning `/usr/bin/env` with controlled parent cases:

1. Removal: parent has `FOO=1`, child env delta `FOO` - child output
   lacks `FOO=`.
2. Set: delta `BAR=2` - child output contains `BAR=2`.
3. Override: parent has `FOO=1`, delta `FOO=9` - child shows `FOO=9`.
4. Inherit: empty delta - child output equals the parent's environment.
5. Refusal: delta `=bad` - the effect answers `EINVAL` with the exact
   literal.
6. Value containing `=`: delta `K=V=W` - child shows `K=V=W`.

The install-check consumer (rewrite-tooling) expresses
`check-install.py:117-118` as delta `BUN_OPTIONS` plus whatever set
entries its policy names; the which-names decision stays in Bend2.

## Gates

Landing needs the standing review gates: remote execution admission for
the vectors, compiler-track answer on the U1 dual-import question is
independent of this slice, and one concern per commit (declaration+C
half+vectors in one commit, callers migrated in the same commit).
