# 43 — Toolchain projection executable-link review

Reviewed commit: `ad1605079a67364bf3fadf06c635e26475d1ca81` ("fix: preserve confined npm
executable links in worker toolchains"), parent `56139da751141f4cd9739b3f7ffbadf1eb508e08`
(this worktree's base). The commit is **not** an ancestor of this worktree, so it was reviewed
with `git show ad160507` and `git show ad160507:<path>`. Line references below are the commit's
line numbers for `impl/src/toolchain-projection.mjs` (290 lines at that revision); every other
file is untouched by the commit, so worktree line numbers are valid for those.

Method: static review of the commit and its parent, plus the repository execution check
`node --test impl/test/credential-projection.test.mjs` (exit 0, 5/5). Per dispatch, that check is
a basic repository execution gate, not proof of link code. Link behaviour claims below are
source-level; the commit's own phase-55 tests encode the intended behaviour but were not executed
here because `ad160507` is not checked out in this worktree.

## Verdict

PASS — no P0/P1 defect. The change is a narrowly scoped relaxation: it admits *relative,
confinement-checked links to regular files inside the same mapping* and continues to refuse
absolute links, escaping links, directory links, cycles, dangling links and special files. For
symlink-free sources the manifest, counters and identity are byte-identical to the parent
revision, so existing identities and consumers are unaffected.

## P0-P1 findings

None. Confinement, link identity, target-side verification, accounting and cleanup were each
traced to a specific function and hold under the stated assumptions (see "Invariants verified").

## What changed

- `scanProjection`'s `walk` gained a `mappingRoot` parameter and a `symlink` branch
  (`impl/src/toolchain-projection.mjs:122`, `:129-155`; recursive call `:175`; mapping root
  supplied at `:188`).
- A symlink node is recorded as `{ path, type: 'symlink', target }` in the manifest
  (`manifestRows`, `:190-193`).
- `writeTree` recreates the link rather than writing bytes
  (`symlinkSync(tree.target, target)`, `:236`).
- The parent revision refused *every* symlink (`if (before.isSymbolicLink() || ...) invalid();`
  at parent `impl/src/toolchain-projection.mjs:125`). Because deployment preflight maps
  `node_modules` / `impl/node_modules` through this module (`dependencyProjection`,
  `impl/src/application-deployment.mjs:586-610`, called at `:1852`), any npm install with `.bin`
  symlinks failed as an unattestable dependency tree. That is the regression this commit fixes.

## Invariants verified

1. **Directory links are refused and never traversed.** After the symlink branch returns, the
   only recursion is on `before.isDirectory()` from `lstatSync` (`:171`, `:175`), and a link whose
   `realpathSync` result is not a regular file is rejected (`:143`). The source scan therefore
   never follows a symlinked directory.
2. **Confinement uses both the lexical and the physically resolved path.** `lexical =
   resolve(dirname(absolutePath), target)` and `resolved = realpathSync(lexical)` are each checked
   with `relative(mappingRoot, path)` (`:137-142`). Absolute targets are rejected up front
   (`:136`), so escaping links, links through escaping intermediate symlinks, and outside-then-back
   chains all fail closed.
3. **Pointee bytes and mode are identity-bound.** The pointee must resolve *inside the same
   mapping root*, which means it is also walked as a file node and contributes its content digest
   and executable bit to the manifest (`:156-169`). A link can therefore never attest bytes it
   does not cover, and `executable` materialization (`:237`) makes `.bin` entries runnable.
4. **Link stability re-check.** After reading the target, the branch compares the recorded node
   signature and re-reads the target string (`:143-145`), so retargeting or replacement during a
   scan is detected.
5. **Target-side verification.** `verifyMaterialization` re-scans the materialized tree with the
   same rules (`:253-262`); a worker that replaces a link with a file, retargets it, or points it
   outside the mapping fails with `toolchain_projection_materialization_failed`. The commit's test
   at `impl/test/phase55-toolchain-projection.test.mjs:161-164` asserts exactly this.
6. **Compatibility.** For symlink-free trees `manifestRows`, `counters` and `publicIdentity` are
   unchanged, so `manifestDigest`, `projectionDigest`, `fileCount`, `byteCount` and
   `directoryCount` are stable. Legacy `dependencyDirs` copies and the mixed-configuration
   refusal are untouched (`impl/src/worktree.mjs:1101-1104`, `impl/src/index.mjs:1217`).

## Findings

| # | Severity | Finding |
|---|----------|---------|
| F1 | resolved | Motivating failure fixed: confined relative file links admitted, identity binds target + pointee digest + mode. |
| F2 | P2 (limitation) | Workspace/absolute links remain refused; the resulting preflight error is misattributed to "reinstall dependencies". |
| F3 | Low (defect) | Source-side I/O failures in the link branch map to `invalid` instead of `changed`, unlike every sibling branch. |
| F4 | Low (coverage) | No test exercises cleanup after a symlink has already been materialized. |
| F5 | Low (semantics) | `byteCount`/`maxBytes` now include link-target string length, not only file content bytes. |
| F6 | Info | New `symlink` manifest row under `schemaVersion: 1` without a version bump — safe, but undocumented. |
| F7 | Info (hygiene) | 47 lines of unrelated Flash-effort tests are bundled into this commit. |
| F8 | Low (docs) | The phase-55 evidence contract still states "ordinary directories/files only" and "links … refusal". |

**F1 — the fix works as scoped.** `scanProjection`'s symlink branch (`:129-155`) plus
`writeTree` (`:236`) admit npm `.bin`-style relative links and preserve package-relative imports.
The commit's test (`impl/test/phase55-toolchain-projection.test.mjs:145-165`) demonstrates the
materialized link resolving to an independent copy of the package (`node <projected link>` prints
`1`; after mutating the target copy's `index.mjs`, prints `2`; the source copy is unchanged). This
is the correct confined shape for a projection: the link is a *relationship*, and the relationship
is only allowed when both endpoints are inside the same attested mapping.

**F2 — residual limitation, intentionally not a regression.** `isAbsolute(target)` (`:136`), the
`mappingRoot` confinement check (`:139-142`) and `lstatSync(resolved).isFile()` (`:143`) reject
workspace links (`node_modules/@scope/pkg -> ../packages/pkg`, a directory link outside the
mapping) and absolute-link installs. These installs failed before this commit too, so the change is
not a regression — but the whole projection is refused, and `dependencyProjection`
(`impl/src/application-deployment.mjs:605-609`) collapses the cause into "Installed dependency
trees could not be attested … reinstall dependencies", which is the AX gap already recorded in
`docs/26-full-system-goal.md` ("dependency projection collapsed to the generic
`worktree_unavailable` terminal"). Recommendation for the owner: keep the refusal, but classify
the cause (outside-mapping link vs unsupported directory link vs special file) so remediation is
self-describing. Flat/hoisted npm and pnpm layouts are covered; npm/yarn *workspaces* are not.

**F3 — error taxonomy defect (race-only, low).** The link branch's `catch` maps every
non-`ToolchainProjectionError` throw to `invalid()` (`:146-149`), which for the source side is
`toolchain_projection_invalid`. That includes the stability re-check at `:143-145` — a link
removed or replaced between the initial `lstatSync` (`:124`) and `readlinkSync`/re-check throws
`ENOENT` and is reported as an invalid *configuration* rather than `toolchain_projection_changed`
(retryable source drift). Sibling branches are consistent the other way: top-level `lstatSync`
(`:124`), file open/read (`:164`) and directory re-stat (`:177-180`) all map source-side I/O
failure to `changed()`. Repro logic (requires a concurrent unlink between the first `lstatSync`
and the branch re-read; not deterministically reachable without instrumentation): create a mapped
tree containing one confined link, unlink it from another thread after the first stat, and observe
`toolchain_projection_invalid` where the same race on a regular file yields
`toolchain_projection_changed`. Confinement is unaffected; this only mislabels retryable drift.
Fix direction: scope `changed()` to the stability re-read, keep dangling/absolute/escape as
`invalid()`.

**F4 — cleanup coverage gap.** `removeCreated` (`:217-220`) removes created targets with
`rmSync(..., { recursive: true, force: true })`, which unlinks symlinks and does not follow them,
and `materialize` always passes every `targetPath` to cleanup (`:283`, including the mapping whose
`writeTree` threw mid-tree). That is correct by construction, but neither link test reaches it:
`materialize` refuses source drift *before* `writeTree` (`:270-271`) and the link-retarget test
(`impl/test/phase55-toolchain-projection.test.mjs:167-184`) likewise fails pre-write, so no test
proves partial trees containing a created symlink are removed. Suggested test: two mappings where
the first tree contains a link and the second mapping's materialization fails, then assert the
first target (link included) is gone and nothing outside it was touched.

**F5 — accounting semantics.** `counters.bytes` for a link adds `Buffer.byteLength(target)`
(`:150-153`), so `byteCount` and the `maxBytes`/`maxFileBytes` gates now cover link-target strings
in addition to file content. Source and target scans agree, so identity and verification are
unaffected, and symlink-free trees are unchanged. `worktree-capacity.defaultEstimate`
(`impl/src/worktree-capacity.mjs:164-165`) uses `byteCount` as an estimate and counts each link as
one inode (`fileCount`), which is correct for inodes and a negligible overcount for bytes.
Worth a one-line note where `byteCount` is defined as a policy quantity.

**F6 — schema versioning.** A `symlink` row type now appears under `schemaVersion: 1`
(`:190-193`); only `manifestDigest` is public (`publicIdentity`, `:198-210`), and no other module
parses manifest rows, so no consumer can silently diverge. Sources containing links previously
threw, so no stored identity changes meaning. Acceptable; document the type in the projection
contract next time the schema is touched.

**F7 — commit hygiene.** `impl/test/omp-native-features.test.mjs` gains two tests about Flash
effort selectors and concurrent worker model identity (`+47` lines, commit diff). They are
unrelated to link projection; `impl/src/omp-rpc.mjs` is unchanged by this commit and already
contains the corresponding defaults (`modelCatalog` default, `impl/src/omp-rpc.mjs:388-394`) and
`effort_unavailable` path (`:804`), so they conceptually belong to parent `56139da7`. Their
presence is not evidence about the link code and they should not be cited as such.

**F8 — contract documentation drift.** `docs/handoff/evidence/phase55-toolchain-projection-2026-07-13.md`
still states "Materialization accepts ordinary directories/files only" and lists "links …
refusal" among covered tests. After this commit both statements are false (links to confined
regular files are accepted). Update that contract text (or supersede it) so the audit trail
matches the code.

## Pre-existing limitations (not regressions)

- `ensureParents` (`:222-227`) uses `existsSync` and `mkdirSync(dirname, { recursive: true })`,
  which follow a pre-existing symlinked parent. A caller that hands `materialize` a non-empty,
  attacker-controlled `targetRoot` could have writes redirected; `materialize` only pre-checks the
  mapping roots themselves (`:269`). This predates the commit and applies identically to regular
  files. Current callers pass freshly created worktrees.
- Confinement is path-based and does not detect bind mounts or other namespace tricks inside a
  mapped subtree.
- Same-UID adversaries with source write access during check-and-use are out of scope; this review
  makes no secrecy or anti-tamper guarantee against them, consistent with the project's stated
  same-UID posture.

## Required corrections

None required for correctness. Optional follow-ups for the owning change: fix F3's error taxonomy,
add the F4 cleanup test, classify the F2 refusal cause, and update the phase-55 contract text (F8).

## Verification

- `node --test impl/test/credential-projection.test.mjs` → exit 0, `# tests 5 / # pass 5 / # fail 0`
  (repository execution check, not link proof).
- Link behaviour assessed statically from `git show ad160507` against the parent revision; the
  commit's own tests were not executed in this worktree because the commit is not checked out here.

## Integration follow-up (2026-09-13)

The parent addressed F3 with distinct source-drift handling for link reads/rechecks, and F4 with
a deterministic failure after a link has been created in the first mapping. The new regression
asserts that all created mappings/parents are removed while the original source link and content
remain intact. A separate regression removes a link after its first stat and expects
`toolchain_projection_changed`.

F2's deployment message now names changed files, unsupported links and special files rather than
suggesting reinstalling alone. F5/F6/F8 are reflected in the updated
`spec/phase55/immutable-toolchain-projection.md`; historical evidence describes its original head.
Correction to F2: pnpm layouts using directory links remain unsupported. Only confined relative
file links are admitted; this is not general pnpm/workspace support. F7 is commit organization,
not a runtime defect. All 15 phase-55 tests pass after these follow-ups.
