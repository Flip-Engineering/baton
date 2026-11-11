# Review: contribution-3e8ea4cd75da23e9d7fa68bf6cd1167d

| | |
|---|---|
| Author | bend2-orchestrator2 |
| Captured at | `4815c9d8f6687d7c82bd0b5928d393b34a1741af` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626` |
| Items | `bend2-reference-pin`, `toolchain-proof` |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 18601, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat, worktree `baton/ws-3f455e632d1c185eed8661e1b5b1aadf`; toolchain installed under `node_modules/.bend` |

## What was run and what it answered

### Manifest digests

Recomputed sha256 for all eleven files the manifest in `docs/bend2/reference/README.md` lists,
at the captured commit (`git show <commit>:<path> | shasum -a 256`). Every recomputed digest
equals the manifest value:

| File at `docs/bend2/reference/` | Digest (first 16 hex) | Match |
|---|---|---|
| `upstream/guide/GUIDE.md` | `9e4643649b8ce8c8` | yes |
| `upstream/guide/EFFECTS.md` | `4d7178c70e811ad2` | yes |
| `upstream/guide/SHADERS.md` | `5831b0de51f77c2f` | yes |
| `upstream/paper/BendTT.pdf` | `b2a01d179d69be9e` | yes |
| `upstream/paper/BendRT.pdf` | `8b83636cbefae8d5` | yes |
| `upstream/README.md` | `07cc2b846951aabe` | yes |
| `upstream/AGENTS.md` | `0d21a5fa9998d183` | yes |
| `upstream/CHANGELOG.md` | `4d538852596895dd` | yes |
| `upstream/LICENSE` | `0beb288abd3d067e` | yes |
| `upstream/WONTFIX.txt` | `e83f867cece45120` | yes |
| `toolchain/install-2.0.25.sh` | `94b259043a341acb` | yes |

The installer's embedded `SHA_DARWIN_ARM64`
(`c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31`, read from the script at the
captured commit) equals the release-asset digest the manifest claims for
`bend-2.0.25-darwin-arm64.tar.gz`.

### Toolchain install

- Staged the captured installer: `git show 4815c9d8…:docs/bend2/reference/toolchain/install-2.0.25.sh
  > node_modules/.bend/install.sh`; its sha256 is `94b259043a341acbfb11e99559c56b518bfb1d6733227f1e6af595ec954ab29e`,
  the manifest value.
- Ran `BEND_HOME="$PWD/node_modules/.bend" BEND_NO_TELEMETRY=1 sh node_modules/.bend/install.sh`:
  it downloaded `bend-2.0.25-darwin-arm64.tar.gz` from
  `github.com/bendlang/bend/releases/download/v2.0.25/`, the archive passed the installer's
  embedded sha256 gate, and the toolchain installed under `node_modules/.bend`.
- `node_modules/.bend/bin/bend version` prints `bend 2.0.25`.
- The installed `guide/GUIDE.md`, `guide/EFFECTS.md` and `guide/SHADERS.md` hash equal to the
  vendored files' manifest digests, which verifies the reference-README claim that the installed
  guide and the pin are byte-identical.

### Evidence commands (docs/bend2/examples/toolchain-sanity.evidence.md)

Re-ran the recorded commands with the example staged from the captured commit. The evidence
file's environment rows match this host: macOS 27.0.0 arm64, Apple M4; Apple clang 17.0.0
(clang-1700.0.13.5); Node v25.8.0.

| # | Recorded claim | Observed |
|---|---|---|
| 1 | `bend … --check-only` prints `All terms check.`, exit 0 | identical output, exit 0 |
| 2 | `bend …` prints `toolchain sanity: twice(21) = 42`, exit 0 | identical output, exit 0 |
| 3 | native build of 1,126,832 bytes, same line, exit 0 | 1,126,832 bytes, identical line, exit 0 |
| 4 | JS build runs under Node, same line, exit 0 | identical line, exit 0 |
| 5 | affine variant refused: `x (consumed more than once)`, `Location: twice`, exit 1 | identical error text, exit 1 |

For command 5, the checker's location snippet cites different line numbers than the evidence file
(observed `4 |`, `5>|`, `6 |`; recorded `6 |`, `7>|`, `8 |`): the reviewer's variant file carries a
shorter header than the author's. The error text, the location name and the exit code match.

The evidence file's citation to the guide resolves: GUIDE.md line 218 at the pin carries
"Reusable variables require `Data`: functions, arrays and IO handles are `Type`, so they can
never be copied."

### Pin-commit resolution upstream

`gh` is unauthenticated on this host, and the GitHub tool refuses `file_read` for
`bendlang/bend` ("GitHub CLI is not authenticated"). The pinned commit
`a49524265bdfa5753a4bf38e25f0574a705dd868` was therefore resolved against github.com only
indirectly: the release asset `bend-2.0.25-darwin-arm64.tar.gz` served by GitHub passed the
captured installer's sha256 gate, which equals the manifest's claimed archive digest. The pin's
internal consistency (manifest, vendored bytes, installed binary's guide) is fully verified; an
independent read of files at the commit hash needs a seat with GitHub credentials.

## Relation to the other foundation row

contribution-1440bd10c2e224b659dab8fcae4953d2 (seq 8166) names the same commit `4815c9d8…` and
the same file list; it is accepted and integrated onto `bend2-rewrite` (squash
`50dbbe15284bee1e38407eec174f9f29826cfa61`, gate green, seq 9097). Accepting this row records the
independent verification; a second landing of the commit carries nothing, since it is already an
ancestor of the target.

## Decision

accept — the pin, the toolchain and every recorded evidence command reproduce independently.
