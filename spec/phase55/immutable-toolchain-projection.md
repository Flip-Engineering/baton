# Phase 55 — immutable bounded dual-root toolchain projection

## Why this phase exists

Recursive Phases 53 and 54 repeatedly needed a clean exact-SHA target checkout while Baton's
runtime itself depended on packages installed only in a separate source checkout. The evidence
runners worked around that by manually copying `impl/node_modules` into a staged target before
constructing the driver. Baton's existing `workerDependencyDirs` and `verifyDependencyDirs` can
copy only from `repoRoot`; the copy is unbounded, dereferences links, has no content identity, and
relies on repository ignore rules to keep the copied tree out of result commits.

Phase 55 makes target identity and toolchain identity separate, immutable inputs. A deployment
attests a bounded source projection once, pins its manifest digest in driver configuration, and
materializes isolated byte copies into worker and verifier sandboxes. The public evidence carries
only the closed projection identity, never its host source root. This is a runtime-integrity slice;
it adds no worker authority, no dependency installer, no network fetch, and no homelab integration.

## Contracts

### TP1 — closed deployment configuration and public identity

The new `toolchainProjection` driver option has exactly:

- `schemaVersion: 1`;
- an absolute private `sourceRoot`;
- a bounded stable `sourceId` containing no path separators;
- one or more `{sourcePath,targetPath}` mappings;
- exact deployment limits for mappings, files, directories, aggregate bytes, per-file bytes,
  relative-path bytes, and traversal depth; and
- `expectedManifestDigest`, a lowercase SHA-256 digest obtained from the exported inspection helper.

Unknown fields, missing bounds, duplicate/overlapping source or target mappings, unsafe relative
paths, targets under `.git` or `.baton`, a non-directory source root, and a digest mismatch refuse
before driver authority or a worktree is created.

The immutable public identity is exactly schema version, source ID, manifest digest, projection
digest, mapping/file/directory/byte counts, and the deployment limits. It contains no source root,
resolved host path, source path, executable path, environment, credential, file content, inode, or
timestamp. `manifestDigest` binds the sorted closed file/directory manifest; `projectionDigest`
also binds the source ID, target mapping, and limits.

### TP2 — safe, complete source traversal

Inspection and every materialization independently walk each mapped source with `lstat`/descriptor
checks. Only ordinary directories and regular files are supported. Symlinks at any depth, hardlinked
files, sockets, FIFOs, devices, setuid/setgid files, path escape, control-character names, and
canonical path collisions refuse. Traversal never follows a link and never silently omits an entry.

The manifest deterministically records each mapping, relative directory, regular file, normalized
executable bit, byte length, and content SHA-256. It does not record host metadata. Empty directories
are represented. Source mappings and target mappings are each non-overlapping so a byte has one
unambiguous source and destination identity.

### TP3 — independent deployment bounds

The closed limits are `maxMappings`, `maxFiles`, `maxDirectories`, `maxBytes`, `maxFileBytes`,
`maxPathBytes`, and `maxDepth`. Every value is a positive safe integer within implementation
ceilings; per-file bytes cannot exceed aggregate bytes. Each independent exact-limit case succeeds
and each max+1 case refuses with typed `toolchain_projection_oversize` before a public identity or
usable copy is returned. There is no truncation, sampling, default, or caller-supplied post-hoc
override.

### TP4 — immutable source and exact byte materialization

Before copying, Baton rescans the complete source and requires the configured manifest digest.
Materialization writes newly allocated regular files and directories into previously absent target
paths. It never creates a symlink or hardlink and normalizes modes to ordinary readable data or an
executable file without privileged bits. Every target file is re-read and matched to the manifest.

After copying, Baton rescans the source and requires the same manifest. A mutation between initial
inspection, pre-copy scan, copy, or post-copy scan refuses `toolchain_projection_changed`, removes
all newly created projection targets, and yields no usable worktree/sandbox handle. Copy failure,
destination collision, or target verification failure is equally atomic.

### TP5 — clean target and result-commit isolation

The target Git commit remains the sole source-code identity. Projection targets must be absent and
untracked in that commit/worktree before materialization. Worker mutations to projected bytes can
affect that worker's execution but cannot affect the source host, another worker, or a verifier.

Worker capture reads the private worktree metadata and excludes every projection target and its
descendants from dirty detection and `git add`. Projected dependencies therefore never enter the
snapshot/result commit even when the target repository has no matching `.gitignore`. Ordinary
worker changes remain captured exactly. Verification projections are destroyed with their detached
sandbox.

### TP6 — worker/verifier byte separation

Every worker, result verifier, and optional red/green base verifier receives a separate materialized
copy with the same projection identity. No destination path or inode is shared. Mutating one copy
cannot alter the source, sibling copies, or the bytes subsequently supplied to verification. A
source change after worker creation prevents verifier creation rather than verifying under a
different toolchain.

### TP7 — worktree, session, and verification evidence binding

`worktree.ready` session context binds `baseSha` and the public toolchain projection identity.
Private metadata persists that same identity and the target exclusions without the source root.
Session validation requires the configured identity, recorded context, and private metadata to
agree before native resume/recovery.

`verify.reverified.payload.capture` binds result SHA, base SHA, exact route attribution, and the
same public projection identity materialized into the result verifier. When red/green verification
is enabled, result and base verifier identities must also agree. Missing, changed, forged, or
substituted identity fails the trust gate; it cannot be accepted merely because the command exits
zero.

### TP8 — restart and replay honesty

Operational replay folds the complete closed `worktree.ready` and `verify.reverified` projection
subdocuments. A restarted driver may rejoin a session only when its newly configured projection
identity equals the durable session context and private worktree metadata. Host relocation with
byte-identical contents is allowed because host paths are not identity; content, mappings, source
ID, or limits drift is refused. Replay never reconstructs or reveals `sourceRoot` from evidence.

### TP9 — failure cleanup and reconciliation

Configuration/inspection refusal creates no worktree, branch, runtime, writer, or partial target.
Worker materialization failure removes its Git worktree, branch, metadata, and every partial target.
Verifier materialization failure removes and prunes its detached sandbox. Ordinary reap and restart
reconciliation remove projection bytes as part of their owned directory; they require no external
garbage collector. Cleanup is idempotent and does not modify the source host or target main checkout.

### TP10 — compatibility and ambiguity refusal

When `toolchainProjection` is absent, the existing same-root `workerDependencyDirs` and
`verifyDependencyDirs` behavior remains supported and its existing tests remain green. When the new
projection is present, either legacy dependency option is rejected as ambiguous. The same target
and source checkout remains supported by configuring `sourceRoot: repoRoot`; the dual-root model
does not require two physical repositories.

No existing task brief, route tuple, adapter card, verification command, integration contract, or
public control command changes. `toolchainProjection` is deployment authority, never a worker-
selected task field.

### TP11 — typed refusal, cancellation boundary, and non-disclosure

Invalid configuration/path/type uses `toolchain_projection_invalid`; exceeded bounds use
`toolchain_projection_oversize`; configured/source drift uses `toolchain_projection_changed`; and
destination/copy/integrity failure uses `toolchain_projection_materialization_failed`. Error text and
events do not include `sourceRoot`, source absolute paths, content, or credential-like values.

Projection inspection and materialization are bounded synchronous deployment/worktree prerequisites.
Cancellation after task admission still follows existing worktree-readiness cancellation and late-
cleanup authority; no adapter can fall through to the orchestrator cwd when projection work fails.

### TP12 — recursive proof and retained system scope

Zero-quota tests use temporary repositories and source hosts to prove every contract, including
exact-limit/max+1 cases, nested links and special files, source drift, no-result-commit contamination,
isolated worker/verifier bytes, cleanup, resume/replay, evidence shape, host relocation, and legacy
same-root compatibility. Focused, adjacent lifecycle/trust, and canonical suites remain green.

Recursive evidence then uses this feature rather than a runner-staged dependency copy. Baton routes
exact project-key GLM `glm-4.7`/low, exact Codex `gpt-5.6-sol`/low, and concurrent Grok 4.5/Grok Build
attempts against one clean pinned target, records current provider-authentication truth, and proves
exact close/reap for every started process. A red route or budget disposition remains red.

Phase 55 does not claim provider-side strict spend preauthorization, mechanically enforced tool-call
limits, public `drainAndClose`, live provider-backed in-flight continuation, generic ACP/Gemini/
OpenCode adapters, WebSocket/operator takeover, Scratch Board/Bench, executable Skill/Playbook
promotion, deployment/federation, or any additional AST/CST/SCIP/CPG/IR/behavior/semantic-merge/
e-graph capability. Those retained goal items remain explicit, and no homelab integration is added.

## Red tests

1. Inspection produces one deterministic host-path-free identity; exact relocation is identical and
   content/mapping/source-ID/limit changes differ or refuse the configured digest.
2. Missing/unknown configuration, unsafe/overlapping paths, `.git`/`.baton` targets, source escape,
   nested symlinks, hardlinks, special files, privileged bits, and destination collisions refuse.
3. Every independent ceiling accepts exact-limit input and rejects max+1 without partial identity or
   target materialization.
4. Worker and two verifier copies are byte-identical but path/inode-independent; mutation of any one
   leaves source and siblings unchanged.
5. Mutation after attestation or during materialization refuses and removes all created target paths.
6. Worker capture excludes projected trees without `.gitignore`, captures ordinary changes, and the
   result commit contains no projected object.
7. Worker/verify creation failures restore Git worktree, branch, metadata, and directory baselines.
8. `worktree.ready`, session validation/recovery, replay, and `verify.reverified` bind one exact
   projection identity while exposing no source host path.
9. Result/base verifier identity mismatch cannot reach an accepted verdict even when the verification
   command exits zero.
10. Legacy same-root dependency copying remains green; mixed legacy/new configuration refuses before
    driver authority.

## Acceptance gate

Phase 55 closes only when TP1–TP12 are executable, the focused/adjacent/canonical suites pass, and
recursive Baton evidence uses the shipped dual-root configuration with honest exact-route,
authentication, budget, verification, kill, close, reap, and cleanup dispositions.
