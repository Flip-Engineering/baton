# Release gate evidence packet, 2026-10-17

Consolidation and release-gate evidence for [#774](https://github.com/Flip-Engineering/baton/issues/774)
and the release pull requests #772, #751 and #761, ensemble
`required-repl-release-product`, recorded by `release-repl-glm` on branch
`release-repl-glm-778`. Every claim cites checked delivery evidence; local
measurements state their exact command, scope and time.

## Gate state

No merge, close, publish or install is authorized by this packet.

- The independent review gate for the REPL line is the committed critique
  [`repl-critique-2026-10-17.md`](repl-critique-2026-10-17.md); findings F1
  through F3 are acceptance-relevant for
  [#778](https://github.com/Flip-Engineering/baton/issues/778).
- The full Main-v13 C-generation run ended in SIGTRAP (raw wait status 133,
  kernel `int3` in `bun[110881]`, original wait completed after 3071.617683 s,
  maximum RSS 139,774,760 KiB, cgroup and kernel OOM counters zero). No
  candidate executable exists. Evidence root:
  `/run/baton2-native-homelab/retained/baton-combined-main-v13-20261016T193951Z`
  (`c-generation/result.json`, `failure.json`); original result SHA256
  `2f5d9b5d3fbb0c5c8f7ba6d3f04c961fbb5462ba62e9b80caa80053d0b87ccef`; retained
  stderr 24,710,137 bytes, SHA256 `cd260293c1f510bef4457c82b63f2a0dc62388f96e
  64c8be623a1ecd5a831b22`. Source: the qualification record
  [`repl-qualification-20261016.md`](repl-qualification-20261016.md).
- A new full Main build requires a concrete qualified compiler and source pin
  and coordinated admission by the release conductor. The recorded runs
  marked `coordinator_runtime_qualified: false`
  ([`repl-qualification-20261016.md`](repl-qualification-20261016.md)).
- The candidate C/object/link build, candidate validation, installed Darwin
  qualification and the multi-Conductor native acceptance listed under
  "Remaining acceptance" in the qualification record remain open.

## Recorded release facts

- PR #772 is recorded at `cc6fddff` with composed build and native acceptance
  active (release conductor audit, 2026-10-17).
- The advertised `main` at audit is `b5b4c61a`; its production inputs match
  the released 2.0 source, and the exact remote target build and transfer
  verification passed with generated C `ca552285` and executable `b27bf926`
  ([`todo.md`](todo.md) #771 entry, proof link therein).
- Census at the conductor audit: 15 remote branches, 142 local branches, 347
  worktrees of which 299 exist and 32 are dirty. Active dirty worktrees,
  retained evidence and immutable build sources are preserved
  ([#774](https://github.com/Flip-Engineering/baton/issues/774) rules).
- Completed-reference cleanup and its archive tags are recorded in
  [`branch-consolidation-2026-10-05.md`](branch-consolidation-2026-10-05.md);
  its preservation branches and archive tags remain the incorporation
  evidence for the removed references listed there.

The commits `b5b4c61a` and `cc6fddff` are absent from this worktree's object
store; `git cat-file -t` fails for both here. Ancestry checks against them
execute where the advertised tip is fetched (root or origin), not in this
forest.

## This forest's exact inventory

Measured 2026-10-17 in
`/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z`:

- `git for-each-ref refs/heads` lists 25 local branches;
  `git worktree list` lists 25 worktrees; `git worktree list --porcelain`
  records no dirty worktree. Every branch is checked out in exactly one
  registered worktree.

Branch tips by group (exact heads from
`git for-each-ref refs/heads --format='%(refname:short) %(objectname)'`):

| Tip | Branches |
|---|---|
| `1658d4543bd57b984d58ce968f0b109e32abc6ec` | `account-credit-base`, `codex/observer-only-transfer-20261017` |
| `20fe9e9e7114d6a055f2565415e34dcaa6a019fc` | `release-qual-deepseek-775-747`, `release-repl-deepseek-778`, `release-repl-glm-778`, `runtime-deepseek-769-786` |
| `a5ecbfa8e0a259811de83700071e9bc5d5798f26` | `accounts-mac-browser-793`, `logging-deepseek-769`, `logging-glm-769` |
| `895f9955cd339207688e7747110807f17b2105e6` | `baton/flash-knowledge-semantics-1017`, `baton/flash-repl-release-1017`, `baton/flash-runtime-recovery-1017` |
| `c1cfde6cd35c2831bb13f9748ffffd60ca565631` | `codex/runtime-span-focused-build-20261017`, `runtime-span-implementation-20261017` |

Unique-tip branches: `accounts-deepseek-793-702` (`393cf9d6…`), `accounts-glm-
793-702` (`2b35f005…`), `baton/flash-776-memory` (`db774746…`),
`baton/flash-account-credit-1017` (`3db10987…`), `baton/luna-776-frame-span`
(`f4f0a547…`), `codex/receive-span-regression-20261017` (`3ccbaa0d…`),
`knowledge-deepseek-782-785` (`2d038927…`),
`knowledge-elevation-sharing-20261017` (`ce140869…`),
`knowledge-glm-779-critic` (`c17df03b…`),
`knowledge-storage-traversal-20261017` (`c2fe1afd…`),
`runtime-glm-critic` (`b7ac91eb…`).

## Deletable-branch classification

No deletion is executed or authorized by this packet. A branch becomes
deletable when all three conditions hold:

1. Its exact tip is an ancestor of the advertised tip `b5b4c61a`, or its
   outstanding commits carry exact incorporation evidence (equivalent patch
   integration or an archive tag), verified where the advertised tip is
   fetched.
2. Its registered worktree is retired by its owner with no dirty or untracked
   files.
3. The owner's active assignments no longer reference it.

Against those conditions in this forest:

- Same-tip groups carry no unique commits relative to each other. Their tips
  still require the ancestry check against `b5b4c61a` at the root/remote
  holder before condition 1 is met. All five groups above are candidates once
  conditions 2 and 3 hold; `release-repl-glm-778` additionally carries this
  packet's commits until the conductor confirms their landing target.
- Every unique-tip branch is preserved until its owner records incorporation
  evidence. `accounts-deepseek-793-702` is a recorded worker checkpoint for
  [#793](https://github.com/Flip-Engineering/baton/issues/793)/[#702](https://github.com/Flip-Engineering/baton/issues/702).

## CONTRIBUTING delivery responsibility

The Publication section of [CONTRIBUTING.md](../../../CONTRIBUTING.md) now
states the delivery rule for this window: merges into the advertised target,
issue closure, publication and installation follow independent review plus
passing validation gates on the self-hosted homelab runners, and the release
conductor coordinates admission of full native builds. No hosted aggregate
result authorizes a gate in this window; recorded hosted runs, such as the
Darwin dependency preflights, remain source and dependency evidence. The rule
operationalizes the [#774](https://github.com/Flip-Engineering/baton/issues/774)
entry in [`todo.md`](todo.md) for every agent in this delivery.
