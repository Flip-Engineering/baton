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
