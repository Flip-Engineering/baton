# Phase 58 — capacity-aware sparse worker checkouts

Phase 57 recursive dogfood reached the host boundary before any provider effect: a clean full
checkout of the repository's retained evidence corpus exhausted free space. Sparse verification was
already truthful, but worker checkouts still materialized every tracked historical artifact.

## SW1 — deployment-owned sparse worker policy

`createDriver({workerSparsePaths})` accepts one bounded array of unique repo-relative literal
paths. Absolute paths, traversal, empty components, pattern metacharacters, duplicate entries,
reserved `.git`/`.baton` roots, overlong paths, and max-plus-one arrays refuse during driver
construction before log, writer, worktree, runtime, or provider effects. An empty array retains the
full-checkout compatibility path. Worker and verifier sparse policies remain independent.

## SW2 — exact Git identity with bounded materialization

`createFromBase(..., {sparsePaths})` creates the ordinary `baton/<task>` branch at the exact pinned
base commit using `--no-checkout`, installs a no-cone literal sparse specification, then populates
that branch. Sparse materialization changes only which tracked files occupy disk; it does not change
base SHA, branch identity, capture semantics, task ownership, or verification authority.

## SW3 — projection and edit truth

Toolchain projection may be combined with sparse workers. Projected dependencies remain untracked,
privately excluded, manifest-bound, and independently materialized into each worker. `git add -A`
and capture preserve skip-worktree entries outside the sparse set, so absent historical files are not
fabricated as deletions. A worker may create its scoped output beneath a selected parent and the
fresh sparse verifier must observe the captured result.

## SW4 — durable metadata and cleanup

Private worktree metadata and `worktree.created` evidence record the exact sparse path list. Any
sparse configuration, checkout, or projection failure removes the partial worktree, task branch,
projection exclude, and Git metadata before returning failure. Ordinary reap, reconcile,
`drainAndClose`, and replay retain their existing ownership contracts.

## SW5 — recursive acceptance

Deterministic tests must cover validation, materialization, capture, toolchain projection,
independent verifier policy, and exact cleanup. Baton-on-Baton then runs Phase 57 through exact
Codex `gpt-5.6-sol`/low, Claude Opus/low, project-key GLM `glm-4.7`/low, and concurrent Grok
4.5/Grok Build routes with sparse workers. Every admission remains provider-governed, provider
failures remain honest, and `drainAndClose` must reap every started process group and owned path.

## SW6 — replayable sparse identity

`worktree.ready`, live session context, replay, and native resume preserve the exact normalized
worker sparse path list. Recovery may borrow that already-created checkout but must not silently
reinterpret it as a full checkout or substitute the independently configured verifier projection.

## SW7 — capture and projection integrity

One canonical sparse identity is bound across deployment policy, private atomic metadata, Git
configuration/index state, worktree readiness, capture, result/base verifier evidence, session
resume, and reconciliation. Capture refuses broadened/disabled sparse state, missing or forged
metadata, omitted-file deletion, staged or committed out-of-view changes, and path-prefix escapes.
Every full-tree diff path must be admitted and every changed path must be visible to the result
verifier. A toolchain projection target or descendant must be absent from the pinned worker, result,
and base-verifier commit trees even when sparse materialization hides it from the filesystem.

## SW8 — physical ownership confinement

Worker owner IDs and verifier labels are bounded NFC single path/ref components. Slash, backslash,
dot-segment, control, reserved, case-fold-colliding, and overlong identities refuse before Git or
filesystem authority. Logical refinement IDs remain separate from the original physical owner ID.
Metadata uses a closed versioned schema and mode-0600 atomic replace; stop never synthesizes
ownership from missing metadata. Reconcile treats an expected-but-invalid checkout as a zombie and
reaps it rather than trusting its task ID.

Sparse checkout remains an integrity/materialization identity, not a hard capacity or security
boundary. Phase 59 owns byte/inode estimation and reservation; isolated filesystem quotas remain a
later deployment boundary.
