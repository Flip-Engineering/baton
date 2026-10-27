# Riff-family repository branch audit (2026-10-27)

Session `repository-audit-glm2-20261027`. Audit date: 2026-10-27 (refs read between
2026-10-27T04:00Z and 2026-10-27T05:30Z). Scope: the four repositories the root operator assigned
to this session that the Codex-native helpers are not inventorying: `Flip-Engineering/riff`,
`Flip-Engineering/Riff-ChatGPT-Plugin`, `Flip-Engineering/baton-cli` (private), and
`Flip-Engineering/automated-content-pipeline-video-studies-archive`.

Method: `git ls-remote` per repository; blobless bare clones
(`git clone --bare --filter=blob:none`); `git merge-base --is-ancestor` per branch against `main`;
`git cherry` patch-id comparison and direct content diff for unmerged branches; GitHub REST API v3
(anonymous) for pull-request state and `flip-baton-glm` installation token for private
repositories. All counts are measurements at the listed heads.

## riff

- `main` = `2886e1dc3cfddaba130ea017d42afeca85011d79`
- 42 branch heads, 50 tags, 57 `refs/pull/*` refs, 56 API pull requests, exactly 1 open (#90)

### Branch classification

36 of the 41 non-main heads are ancestors of `main`:

```
ci/riff-own-runner-20261023            ci/runner-isolation-deadlines-20261024
codex/riff-issue10-families-20261023   codex/riff-issue11-sonnet-20261023
codex/riff-issue15-lease-20261025      codex/riff-issue15-timings-20261024
codex/riff-issue16-sonnet-20261023     codex/riff-issue20-sol-20261023
codex/riff-issue24-metal-20261024      codex/riff-issue31-hosted-apple-20261024
codex/riff-issue33-sonnet-20261023     codex/riff-issue48-acoustics-flake-20261024
codex/riff-issue50-retained-bytes-20261024
codex/riff-issue55-artwork-geometry-20261024
codex/riff-issue59-port-await-20261024 codex/riff-issue60-pin-cost-20261024
codex/riff-issue60-sha-lifecycle-20261025
codex/riff-issue60-system-sha-20261025
codex/riff-issue66-inspection-race-20261025
codex/riff-issue76-metal-device-20261025
codex/riff-metal-workflow-env-20261024 codex/riff-review-nits-20261024
codex/riff-video-liveness-20261024     codex/saved-sound-determinism-20261023
fix/desktop-restart-test-receive-race-20261024
fix/native-cache-unique-tmpdir-20261024
fix/riff-cuda-host-compiler-20261026   fix/riff-family-selection-eligibility-20261025
fix/riff-linux-source-release-20261026 fix/riff-managed-update-queue-20261025
fix/riff-review-owner-transport-20261026
fix/riff-self-hosted-apple-validation-20261025
release/v0.6.31-20261025               release/v0.6.32-20261026
release/v0.6.33-20261026               research/riff-daw-integration-20261025
```

### The 5 unmerged heads

| Branch | Head | Status | Evidence | Recommendation |
|---|---|---|---|---|
| `feature/riff-ardour-composition-20261026` | `f076b669b683b9ef57918ffbbb156d21349d` | Open PR #90; the designated DAW composition target | PR body pins the head; last commit 2026-10-27T00:14-0700 | Keep under its current conductor |
| `codex/riff-artwork-flake-20261024` | `f4353828c8adfe577b4fe96a27d37d79985cf0fd` | PR #53 merged 2026-10-25 (squash); branch commits are not ancestors | `git diff --stat main <branch> -- web/artwork.js tests/artwork-webgl.mjs tests/video.mjs` is empty: branch content is byte-identical to main | Delete remote branch (post-merge residue) |
| `codex/riff-issue31-routing-20261021` | `9ffe6e3d0a8258a9cd63cef470e0bbe9e30d76` | PR #40 merged 2026-10-23 | All 13 touched files exist on main; `merge-base..main` on those files adds 573 lines, so main carried the content forward and iterated (`docs/self-hosted-runners.md` -224 lines of evolution, `scripts/run_native_build_queued.sh` present) | Delete remote branch (post-merge residue, superseded evolution) |
| `codex/riff-issue60-sha-options-20261025` | `5ed5955c89a2b85802cb0d0599bf107c18944ea8` | PR #71 closed unmerged | `git cherry` marks the single commit `-` (patch-equivalent present in main); `main:docs/acoustic-source-pinning.md` exists via the merged `issue60-sha-lifecycle`/`issue60-system-sha` work | Delete remote branch (superseded documentation) |
| `codex/saved-sound-determinism-20261019` | `a520a3bc5064a9366cb4543b9cb3ca4e96f8a06c` | Not submitted as a PR; reworked and merged as `codex/saved-sound-determinism-20261023` | Same commit subject and same three files as merged `183e5fc`; the merged version hardens the test hold to `args[0].startsWith("/api/state")` where this branch used `args[0] === "/api/state"` | Delete remote branch (superseded first attempt) |

No unmerged branch carries work that main lacks. The two squash-merged residue branches were
verified by content equality, not commit ancestry.

### Tags

All 50 tags point at commits that are ancestors of `main` (`v0.2.0` 2026-09-11 through
`v0.6.33` 2026-10-26). Release branches `release/v0.6.31`, `release/v0.6.32`, `release/v0.6.33`
are merged and their identities are carried by tags `v0.6.31`, `v0.6.32`, `v0.6.33`. The tags are
release provenance and should stay.

### Pull requests

56 total; only #90 is open. Closed-unmerged PRs: #1-#6 (dependabot action bumps, closed),
#29/#32 (plugin extraction, superseded by the separate `Riff-ChatGPT-Plugin` repository),
#71 (superseded documentation above).

## Riff-ChatGPT-Plugin

- `main` = `fe33c5c3085051f918c55e6021dc31a0d22d9fae`, last push 2026-10-20; single branch, no tags

Continued-existence justification (from the repository's own record): deliberate downstream
extraction of the ChatGPT packaging from Riff PR #32 at source commit `cd98f3f4191c2b1356d6048bf
e44b3848d31cb2d`, with full ancestry preserved. The repository owns MCP tools, the ChatGPT bridge
and UI integration, packaging and host acceptance tests; Riff is a Git submodule locked in
`upstream.lock.json` to `b7ab93cf22ffd9e95a7718aca2e0d451578411b1` (merge of Riff PR #28). The
final commit records installed Riff 1.1.1 description verification, and `docs/chatgpt-cloud.md`
records in-Chat acceptance runs. This is a live distribution surface, not an abandoned fork.

Observation for the owner: the submodule pin `b7ab93cf` predates current `riff` main `2886e1dc`
by roughly one week of merges (#87-#94, releases 0.6.31-0.6.33). Whether and when to advance the
pin is the owner's release decision; no branch debris exists here to clean.

## baton-cli (private)

- `main` = `35933364d59ddec124c77d183b6d26a6514befbf` = merge of PR #11 (2026-10-26); only `main`
  exists on the remote

Pull requests: #8 (`research/unii-chat-prior-art`) merged 2026-10-20; #10
(`research/harness2-executor-contracts-20261020`) merged 2026-10-20; #11
(`research/anvaya-agent-harness-20261026`) merged 2026-10-26; #6 (`docs/uniichat-research-20261019`)
closed unmerged and superseded by the merged #8. Nothing to review, merge, or delete.

## automated-content-pipeline-video-studies-archive

This deployment cannot reach the repository. Evidence, in order attempted on 2026-10-27:

1. `git ls-remote https://github.com/Flip-Engineering/automated-content-pipeline-video-studies-archive.git`
   fails: "The GitHub App flip-baton-glm is not installed for Flip-Engineering" for this
   repository.
2. REST `GET /repos/Flip-Engineering/automated-content-pipeline-video-studies-archive` with the
   installation token returns 404.
3. Anonymous REST returns 404; the LFS batch API returns 401 (also recorded in root's
   `ACP_ARCHIVE_AUDIT_20261018.md`, which states this host has no GitHub credentials for the
   archive).

No branch or tag inventory is possible from here. Recommendation: the root grants the
`flip-baton-glm` installation access to this repository, or performs the inventory from a host
that holds credentials; until then the archive remains un-inventoried by every recorded session
in this ensemble.

## Canonical ownership and adjacent findings

- All named repositories resolve to owner `Flip-Engineering` (`flip-engineer/...` paths redirect;
  REST requires the exact case).
- The `flip-baton-glm` installation is granted to exactly 7 repositories: `baton`, `riff`,
  `Riff-ChatGPT-Plugin`, `baton-cli`, `flip-client` (private, active 2026-10-27), `flip-platform`
  (private, last push 2026-09-22), and `riff-private-archive-20260911` (private snapshot of riff
  at 2026-09-11). `automated-content-pipeline`, `acp-fframes`, `bend`, `bend-kit`, and the
  video-studies-archive are outside the grant and return 404 even with the token.
- `riff-private-archive-20260911` and the September-dormant `flip-platform` need an ownership or
  archive decision from root; neither is covered by this session's assignment or by the recorded
  helper scopes as stated.

## Recommended actions for root

1. riff: delete the four superseded/residue remote branches (`codex/riff-artwork-flake-20261024`,
   `codex/riff-issue31-routing-20261021`, `codex/riff-issue60-sha-options-20261025`,
   `codex/saved-sound-determinism-20261019`); the evidence above rules out content loss. Keep
   `feature/riff-ardour-composition-20261026` (open PR #90).
2. riff: after conductor confirmation, delete the 36 fully merged remote branches; every release
   identity is preserved by an on-main tag. This mirrors the 33 baton branch removals root already
   performed.
3. riff tags: keep all 50 (all are main-ancestors; release provenance).
4. Riff-ChatGPT-Plugin: keep; the owner decides when to advance the Riff submodule pin from
   `b7ab93cf`.
5. baton-cli: no action.
6. video-studies-archive: grant app access or inventory from a credentialled host.

## Addendum: adjacent granted repositories (2026-10-27T05:40-05:55Z)

### flip-platform

`main` = `e7d7ce8` ("Align general runner source with existing twelve-CPU limit (#18)"), last push
2026-09-22 — the repository is dormant. 13 heads:

- 9 merged: `main`, `agent/fleet-canary-admission-20260831` (PR #3), and 8 squash-merged residues
  with PR receipts: #6 `agent/runner-authority-migration-20260831`, #9
  `agent/general-v2-reusable-canary-20260831`, #10 `agent/android-kvm-source-authority-20260831`,
  #12 `agent/capability-routing-inventory-20260831`, #13
  `agent/android-build-package-capability-20260831-aurora`, #15
  `feat/apple-hosted-capabilities-20260831`, #16 `agent/capacity-authority-import-v2-20260901`,
  #18 `fix/general-v2-existing-cpu-quota-20260922`. All are based on pre-cleanup main (a later
  ~65k-line deletion), and each adds only a small delta. Deletable as residue after owner
  confirmation.
- 2 heads with no pull request carrying real unmerged work:
  `agent/adaptive-admission-consumer-issue4-20260901` (15 files, +4733, includes a 160-line test)
  and `agent/capacity-authority-migration-issue7-20260901` (5 files, +497, includes a 131-line
  test). Whether the issue #4 and #7 work is still wanted is an ownership decision; this
  deployment records no active conductor for the repository.
- 1 explicit backup branch: `backup/20260901/capacity-authority-import-20260901` (+427), an
  earlier variant of the capacity-authority import line.

### riff-private-archive-20260911

Exactly one head `cd97c2393f0511fb0f4f8a7bf876a587f936a1a2`, no tags, no other branches: a dated
provenance snapshot of riff at 2026-09-11 (riff's earliest published tag `v0.2.0` is the same
date). No debris.

### flip-client

Pushed 2026-10-27 (active): 527 heads, 17 tags — the largest branch backlog in the set and well
above the user-reported 205 for "Flip". Classification pending a scope claim.

### baton fresh counts

`git ls-remote --heads --tags` recount at 2026-10-27T08:05Z: 182 heads, 267 real tag refs plus 153
peeled `^{}` lines (420 tag-ref lines total), 242 pull refs. An earlier line in this audit
reported "420 tags, no peeled duplicates"; that was a grep error — the pattern `\^{}` never
matched in basic regular expressions, so the peel filter selected nothing. Root's independent
count (182 / 267 / 153) is authoritative. Branch arithmetic: 213 reported − 33 removed by root +
2 audit-ensemble branches = 182. Tag composition of the 267: 160 `archive/2026-10-05/*`, 102
`recovery/*`, 4 `baton2-v*` release tags, 1 `stall-qualified-*`. The user-reported 305-tag
baseline predates these namespaces; the peer session's 267 was correct.

## Addendum 2: flip-client classification (2026-10-27T06:20Z)

`main` = `7c0d858b` ("fix(native): await the owned D-Bus readiness announcement", 2026-10-26).
527 heads, 17 tags, 733 pull requests: 612 merged, 60 open, 61 closed unmerged.

- No merged-PR residue heads survive: every one of the 526 non-ancestor heads is an open-PR head
  (60), a closed-unmerged-PR head (51), or has no pull request (415).
- The 60 open PRs are the live review surface. Newest cluster (2026-10-26): #1117 native state
  volume, #1112/#1111/#1110 My Flip topics/memory/owner-connection ensemble. Stale open tail:
  #1108/#1107 (2026-09-22), #1088/#1086/#1077 (2026-09-12/13), and open PRs from 2026-08-15
  through 2026-09-06.
- The 415 PR-less heads split by namespace: 237 `backup/*` (dated safety copies of other work
  branches, almost all `backup/20260901/<type>/<name>` mirroring work as of 2026-09-01), 17
  `archive/*` (pre-rebase snapshots around merged PRs #1000-#1002), and 161 unclassified (55
  codex, 50 agent, 22 fix, 18 wip, 5 feat, 2 rescue, 2 docs, 1 test). Per-branch content
  classification for the unclassified set and uniqueness checks for the backups are the next
  pass; backups may be the only refs of pre-merge states, so deletion follows a per-branch
  comparison against the mirrored branch and main.

### Credential finding

The `flip-baton-glm` installation grant covers exactly: baton, riff, Riff-ChatGPT-Plugin,
baton-cli, flip-client, flip-platform, riff-private-archive-20260911.
`automated-content-pipeline`, `acp-fframes`, `bend`, `bend-kit`, and
`automated-content-pipeline-video-studies-archive` return 404 with the installation token and are
unreachable anonymously. No recorded session in this ensemble can inventory those five
repositories until root changes the grant or supplies other credentials.

### Baton count reconciliation

Resolved by recount: 267 real tag refs plus 153 peeled `^{}` lines (420 tag-ref lines total), 182
heads, 242 pull refs at 2026-10-27T08:05Z. The peer session's 267 was correct; this audit's
earlier "420 real tags" came from a grep pattern that never matched `^{}` in basic regular
expressions. Root independently verified the same numbers.

## Addendum 3: flip-client content verdicts (2026-10-27T07:30Z)

Tip-tree membership against main's full history, plus per-file byte comparison against main for
the 212 PR-less and closed-unmerged heads, gives:

- 91 heads whose tip tree exists exactly in main's history: 66 `backup/*`, 12 PR-less, 9
  closed-unmerged, 4 `archive/*`. Content landed exactly; deletable as residue after owner
  confirmation.
- 2 more heads whose every changed file is byte-equal to main: `fix/macos-unattended-gui-20260922`
  and `fix/macos-worker-ancestor-20260922`.
- 60 open-PR heads: live. The My Flip ensemble (#1110-#1112, #1117, 2026-10-26) and its source
  branch `ensemble/flip-myflip-luna3-2212-cards-client-20261023` (49 commits, +6643, tree absent
  from main) are active work, not residue.
- 375 heads whose exact state exists nowhere in main: 42 closed-unmerged (rejected work), 149
  PR-less unclassified, 13 `archive/*`, 171 `backup/*`. These hold pre-rebase intermediates and
  abandoned states; deletion is an owner decision branch by branch. Two twin 4-line test-mock
  branches (`fix/enrichment-mocks-20261022`, `fix/thread-enrichments-mock-b46f5ece`, the latter
  closed as PR #1109) are the smallest of these.

Tag correction: flip-client has 11 real tags (17 tag refs include 6 `^{}` peel duplicates), all
pointing at main ancestors.

Verdict data: `fclient-verdicts.tsv` shape (branch, commits-ahead, last-commit-date, files,
insertions, deletions, files-byte-equal-to-main) covers the 212; the tree test covers all 526.
Both derive from `Flip-Engineering/flip-client` clones at main `7c0d858b`.

## Addendum 4: PR90 readiness, superseded-head proofs, flip-client final buckets, flip-platform (2026-10-27T08:45Z)

### Riff PR90 readiness

PR #90 (open, draft): head `f076b669b683b9ef57918ffbbb156d21349d`, base `main@2886e1dc`, 25
commits, 54 changed files, `mergeable=true` (no conflicts), `mergeable_state=unstable`. Check runs
on the head: control, browser, application (3.9), application (3.14), and native (riff-linux,
cpu) succeed; `native (riff-linux, metal)` fails — the same check fails on `main@2886e1dc`, so
the failure is inherited from main and not introduced by the branch. The PR body states the
consolidation target is `feature/riff-ardour-composition-20261026` and that a merge to main is
not authorized. Content: `daw.compose`/`daw.render` (ABC to session build, Lua
instrument/tempo/reopen chain on the hash-verified pinned Ardour 9.8 runtime), `riff-arrangement-v1`
artifacts, per-track stem render with a stems-reconstruct-mix guard (1 LSB) and fail-closed
runtime gate. Recorded validation: Q1-Q10 battery pass with receipt
`docs/evidence/ardour-qualification-20261026/qualification-unified-20261026.json`
(SHA-256 `0af9434155cb8a69869b6c0c5abc6a5636ad1867afa0ede0d01ef81ef597da47`); focused tests
(`test_daw_runtime.py` 14 cases, `test_daw_operations.py`, `test_studio.py`) pass on Python 3.12;
35-test integration pass on the PR #94 merge commit `c38f16e`; review history: root review fixes
(`1766de4`, `4617c53`), DeepSeek-seat fix `0c64f1a`. Residual non-blocking observation: the
packaged `tools/daw` qualification scripts expect a `probes/` tree that the curated release
package does not ship. Readiness for consolidation into the DAW feature branch: no conflicts, no
new check regressions; the open gates are the draft policy itself and the inherited metal check.

### Four superseded riff heads (fresh proofs against current main `2886e1dc`)

1. `codex/riff-artwork-flake-20261024` @ `f4353828` — PR #53 squash-merged 2026-10-25;
   `git diff --stat main <head> -- web/artwork.js tests/artwork-webgl.mjs tests/video.mjs` is
   empty: byte-equal to main.
2. `codex/riff-issue31-routing-20261021` @ `9ffe6e3d` — PR #40 merged 2026-10-23; all 13 touched
   files exist on main (0 missing); main evolved those files +850/-80 since the merge base.
3. `codex/riff-issue60-sha-options-20261025` @ `5ed5955c` — PR #71 closed unmerged; `git cherry`
   reports the patch present in main; `main:docs/acoustic-source-pinning.md` exists via the
   merged issue60 work.
4. `codex/saved-sound-determinism-20261019` @ `a520a3bc` — superseded by `183e5fc` (merged on
   `codex/saved-sound-determinism-20261023`, an ancestor of main); same three files; the merged
   version hardens the test hold to `startsWith("/api/state")`.

### flip-client final buckets

Corrections to Addendum 2/3: an early pull-request lookup ran `jq` against raw API array pages
and silently returned nothing, so the first backup mapping undercounted PR links. Corrected
against the flat PR dataset:

- 66 `backup/*` heads: tip tree already in main history — delete.
- 12 `backup/*` with a still-live mirror branch: 1 tree-identical (`agent/macos-desktop-release-v1-20260831`),
  11 older divergent snapshots (backup tip date earlier than the live mirror in every case) —
  delete as stale snapshots; the live branch is authoritative.
- 27 `backup/*` whose mirror name is exactly a merged PR head (e.g. `agent/about-updater-apply-20260831`
  to PR #1024, `fix/562-scoped-release-refresh-token` to PR #757, `spec/726-access-refresh-authority`
  to PR #842; full list in the session record) — content landed by squash merge — delete.
- 5 `backup/*` snapshots of open-PR branches (`#1017`, `#1015`, `#1028` families) — stale
  snapshots of live work — delete; the open branch is authoritative.
- 5 `backup/*` whose mirror name is a closed-unmerged PR head — rejected work, diff preserved by
  the PR record — delete unless the owner wants pre-close states.
- 122 `backup/*` with no pull request under any name variant — snapshots of never-submitted work
  branches, all dated 2026-08-27..09-01. Genuine unique-state set; owner decision (default:
  delete after an owner-objection window, or keep as cold history — repository size impact is
  small either way).

- 17 `archive/*`: 5 snapshot merged PRs #998/#1002 (4 already tree-in-main) — delete; 8 snapshot
  closed-unmerged PRs #999/#1001/#1003 — delete unless the owner wants pre-rebase states; 4
  snapshot open PRs #1000/#1004 — retain until those PRs resolve, then delete with them.

- 51 closed-unmerged heads: 41 have every changed file byte-equal to current main (including all
  sixteen 2026-09-22 same-day closures), 9 have exact tip trees in main, and 1 remains:
  `feat/remote-ios-x64-runner-20260911` (PR #1079, 53 commits, +3991/-206, 31 of 71 files matching
  main) — the single reviewable-completed-work candidate in the closed set: return to a conductor
  for re-review or explicit rejection.

- 161 PR-less heads: 12 exact trees in main plus 2 all-file matches (`fix/macos-unattended-gui-20260922`,
  `fix/macos-worker-ancestor-20260922`) are landed — delete. The My Flip cluster
  (`ensemble/flip-myflip-luna3-2212-cards-client-20261023`, `fix/native-app-admission-1115-20261026`,
  `fix/enrichment-mocks-20261022`) is live or near-live work — keep with its conductor. The
  remainder are dated August WIP (`ci/864-bundle-selfhosted` +9290, `ci/849-linux-core` +8745,
  `ci/942-kvm-research-a1` +8375, `fix/native-gallery-metadata-20260922` 76 commits +4769 are the
  largest) — per-branch conductor decisions; none is protected by an open PR.

### flip-platform issue branches against the deployed runner configuration

Deployed evidence on this host (read-only, 2026-10-27T08:30Z): live `Runner.Listener` processes at
`flip-client-general-v2-1/2/3` and `flip-android-kvm-ephemeral-1/2` plus
`/home/atari2036/actions-runner-flip-client/runsvc.sh` — matching exactly the listener groups
recorded in `config/capacity/acp-compute-cluster-001.json` (client-general-v2 runners 22-24,
client-android-kvm-v1 runners 27-28, client-legacy-atari-v1 runner 21, client-windows-guest-v1
runner 26, plus `wahargis/flip` server-build runners 21-28). The deployed fleet is direct-registered
GitHub runners; no flip-platform code is in the live path, exactly as main's README requires
("installed listeners remain unchanged"; imports stay inactive until a paired-client cutover).

- `agent/capacity-authority-migration-issue7-20260901`: its
  `config/capacity/acp-compute-cluster-001.json` is byte-identical to main's (landed via merged
  PR #16); main's version of the test file is 274 lines larger, and the spec/source-transfer docs
  were further edited on main. Superseded by merged #16 — delete.
- `agent/adaptive-admission-consumer-issue4-20260901`: unique inactive build-ahead for issue #4
  (fleet-canary consumer/production authority; 15 files, +4733). Its own spec records activation
  as blocked on an organization-scope pool cutover that has not occurred; the deployed listeners
  do not use it and do not conflict with it. Not superseded. Recommendation: keep until the flip-platform
  owner decides issue #4's fate; deletion would discard the only ref of that design. On repository
  retirement: main carries the observed-capacity record and the general-v2 source authority pinned
  to flip-client main `870abd8d`; retiring the repository would orphan records the deployed
  migration path references, so retirement should preserve `config/`, `docs/`, and the runner
  authority manifests even if the code is never activated.
