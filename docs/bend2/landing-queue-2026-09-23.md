# Landing queue and the publish path, 2026-09-23

This record states the landing queue for `bend2-rewrite`, the measurements that back it, and the
two reasons a real landing was refused on the served revision. It was written at the target head
`cc1a18766c5284b556d0e8622e3436980761407c` and refreshed at
`62964e48c1dd15c26b3bd95d91055753b6fe82bd`, where the operator's Codex review record landed. The
seat that lands next reads this file first.

## The queue

Land one row per lane, always the lane's accepted tip. Every row carries an accept review from a
seat other than the row's author; the review seqs are in the shared context key
`recovery:landing-plan`.

| order | lane | contribution | tip | changed paths |
|---|---|---|---|---|
| 1 | review | `contribution-20dc89e0651fa4d7c041383599183261` | `a49954d6` | 6 |
| 2 | laws | `contribution-1d7aadaec318a6be114a9ea4ee5bb46f` | `20a5c8ae` | 17 |
| 3 | architecture and prototypes | `contribution-9638c63e55af2a878cfe4d9c05ba24c7` | `3f5b22f8` | 48 |
| 4 | lead records and evidence | `contribution-4427d906ccc48db8d2475d5c01040a40` | `311a4216` | 21 |
| 5 | this record | branch `baton/bend2-orchestrator6f`, tip in `recovery:landing-plan` | 1 |

Measured against `62964e48`:

- The five changed-path sets are 6, 17, 48, 21 and 1: 93 paths in total, pairwise disjoint, and
  disjoint from the fourteen paths the Codex record landed under `docs/bend2/reviews/`.
- `README.md` appears in the lead row alone, so that row is the only one whose changed paths select
  the wide gate set, and the gate refuses only on unexpected rows (a pinned expected-red row lands).
- Rows 1, 2, 3 and 5 touch documentation only, so their gate selection is empty.
- Row 2 carries the laws lane's accepted tip: `bend2-laws-verify6f` re-ran the dead lane's
  increment 2 and this record's lane added the revision-10 law proposal beside it; landing
  `c16e8860` or `520ef83e` alone would carry the pre-increment or pre-proposal content.
- Rows 3 and 4 carry repaired references: the worked record's own files cite the Codex record at
  the paths it landed under.

## Two ways to land

- **Path A, with swarm receipts.** Replace the resident (stop it, serve a checkout carrying
  `c1720823` with the declaration delivered to that process, and make the declared remote writable
  from the landing's own git environment), then run the five `swarm.integrate` calls in order,
  each naming `target: bend2-rewrite`. The first row's pre-existing dry-run receipt is admitted by
  that commit's corrected guard.
- **Path B, one push.** The same content exists as one chain on the target:
  `baton/bend2-queue-r1` at `b97e3626428addaf756eef1bf0413695d7d39f52`, five landing-shaped
  commits (6, 17, 48, 21 and 1 paths) whose every path is byte-identical to its row tip, with 225
  relative links across 40 markdown files and none unresolved. Push it as a fast-forward from
  `62964e48`. This path runs no gate and leaves no swarm receipts, so a later `swarm.integrate` of
  the same rows refuses because the content is already there. Choose one path, not both.

## The publish path on the served revision

A real landing of row 1 refused `integrate_publish_undeclared` at 2026-09-23T03:45Z from a seat
whose environment carried `BATON_PUBLISH_REMOTE=https://github.com/Flip-Engineering/baton.git`.
On master `65c913f0`, the declaration cannot reach the landing authority at any value of that
variable:

- `impl/scripts/baton.mjs:319-329` reads `BATON_PUBLISH_REMOTE` and passes it as
  `advanced.integration.publishRemote`. It is the only reader of that variable in the tree.
- `impl/src/application-deployment.mjs:6255-6260` normalizes it, and `:6676-6677` forwards it into
  the `createDriver` options.
- `impl/src/index.mjs:1249` normalizes it into a local and `:1647` passes that local into the
  Coordinator options. Neither the Coordinator nor any other module reads it back.
- The object `createDriver` returns (`impl/src/index.mjs:1882-1885`) carries no
  `integrationPublishRemote` member, and `impl/src/application.mjs:2276-2282` builds the swarm
  runtime's landing authority by reading exactly `this.driver.integrationPublishRemote`. That read
  produces `undefined`, `:2281` writes `publishRemote: null`, the runtime hands `null` to
  `landContribution` (`impl/src/swarm-runtime.mjs:7642`), and `impl/src/worktree.mjs:2351-2356`
  refuses the landing.

Two measurements confirm the reading:

- `node --test impl/test/create-driver-wiring.test.mjs` fails at CDW5 on the served revision:
  `integrationPublishRemote` is read by the composition root and appears in neither classification
  table. The in-flight landing of `contribution-83d51bcddf0467f3a92bec2108f724aa` (commit
  `a11608c8`, one line in that test file) adds the missing classification. CDW5 turns green with
  it, and the option still has no consumer.
- A driver opened over a temporary git repository with
  `integrationPublishRemote: 'https://github.com/Flip-Engineering/baton.git'` among its options
  does not expose the member: the probe prints
  `{"driverHasOwnProperty":false,"driverValue":null}`. The probe mirrors the fixture in
  `impl/test/create-driver-wiring.test.mjs` and reads the member `impl/src/application.mjs` reads.

The fix has two parts, both on `master`, outside this swarm's write authority:

1. Expose the declared remote on the value the swarm runtime reads: add `integrationPublishRemote`
   to the object returned at `impl/src/index.mjs:1882`, or have the runtime read it where
   `createDriver` carries it.
2. Classify the option for CDW5; commit `a11608c8` carries this half.

Until part 1 is on the revision the resident serves, no row of this queue can land.

## Observed state

- `git ls-remote origin` at 2026-09-23T13:29Z: `refs/heads/bend2-rewrite` is `62964e48` (the Codex
  review record, landed by the operator) and `refs/heads/master` is `80e07683`. Both moved by
  direct push: no real landing has succeeded in this deployment, and the last
  `swarm.contribution_integrated` rows before this record were dry runs from 02:52-03:32Z.
- The resident serving this deployment is still the process started at 2026-09-23T03:43:10Z, and
  the served checkout is still detached at `65c913f0` without the driver member.
- Real landings of rows 1 and 2 refused `integrate_publish_undeclared` at 03:45Z, 05:52Z, 06:03Z
  and 13:29Z, each with the derived gate selection skipped (`no_affected_tests`).
- A checkout at `62964e48`: the two rows in `test/phase72-kimi-orchestrator-mcp.test.mjs` that
  fail are pinned in `impl/scripts/expected-red-tests.json`, so the gate reports them as expected
  red rather than unexpected, and the gate refuses only on unexpected rows
  (`impl/src/worktree.mjs:2338-2342`).

## The laws lane: the carried increment and the revision-10 proposal

`baton/bend2-laws-lead6` at `520ef83e`, committed 2026-09-23T03:42:41Z, changes 11 paths over
`c16e8860`: the M-14 refusal laws, the M-18 decision law, the transition witness, and the
per-entry pin boundary, with their evidence files. Its seat died before publishing it.
`bend2-laws-verify6f` re-ran its checks from a scratch checkout at that commit (pinned toolchain
by digest, the lane's 24-row driver, the models check and run, and the transition witness in both
lanes) and published it as `contribution-041576d985d70f6c6ecb9185740523bd`; `bend2-reviewer3`
accepted it at seq 131333.

The lane's accepted tip then moved once more. By operator direction of 2026-09-23, revision 10
proposes the no-park law - the runtime never deliberately pauses, idles or truncates an agent's
work, and no transition may move live work into a state whose only exit is an explicit act by
another party - beside the approved 16. The statement, the Baton evidence (commit `89661c1f`, the
18 seats parked seven hours, issue #572, the AGENTS.md ban), the rewrite shape and three review
questions are in [laws-proposed.md](laws-proposed.md); [laws-trace.md](laws-trace.md) records the
entry as proposed; [examples/laws-no-park.bend](examples/laws-no-park.bend) states the model and
the law at the pin with both controls in its evidence file. It is not approved: the revision for
review is staged on the operator's exchange as `laws-proposed-r10.md`. Row 2 therefore lands
`20a5c8ae` (`contribution-1d7aadaec318a6be114a9ea4ee5bb46f`, 17 paths), which carries the accepted
increment and the proposal together.

## The fix, committed and verified elsewhere

The measurement of the missing member was independently reproduced by `wake-lead6`
(swarm-wake-20260921), which committed the wiring half on `baton/ws-558-publish-wiring`: one
member added to the object `createDriver` returns, plus
`impl/test/issue558-publish-remote-reaches-driver-red.test.mjs`. The branch's tip is
`7a92cfd59d91c55379ce5469278ee494d82a94fc`; it carries the same `impl/src/index.mjs` change as its
predecessor `bdca3dca7ae86c7a4514646b65fca1f7e66fbf56`, with one more test line. Both were
verified here with the same probe that found the defect:

```sh
node <probe> /private/tmp/baton-resident-20260921  # driverHasOwnProperty false, landingReceives null
node <probe> <checkout of 7a92cfd5>                # driverHasOwnProperty true,  landingReceives the declared URL
node --test test/issue558-publish-remote-reaches-driver-red.test.mjs  # pass 2, fail 0
```

The classification half for CDW5 is `a11608c8` (the pending landing of
`contribution-83d51bcddf0467f3a92bec2108f724aa`). Neither commit can land through
`swarm.integrate` while the publish path refuses, so the served checkout receives the wiring half
directly, as a cherry-pick or a patch, before the resident restarts with `BATON_PUBLISH_REMOTE`
set.

## The push credential the landing needs

With the member in place, a landing publishes by running
`git push <declared remote> <squash>:refs/heads/<target>` from `impl/src/worktree.mjs:2374`,
under the git environment `localGitEnv` builds (`impl/src/worktree.mjs:126-130`): every `GIT_*`
variable is dropped, and `GIT_CONFIG_NOSYSTEM=1` with `GIT_CONFIG_GLOBAL=/dev/null` are set. On
this host that environment carries no credential: the system config's
`credential.helper=osxkeychain` and the user's `!/opt/homebrew/bin/gh auth git-credential` helper
are both disabled there, and `SSH_ASKPASS=/usr/bin/false` answers the prompt. The same push, run
with that environment against the declared remote, fails:

```sh
$ env -u GIT_ASKPASS GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    git push --dry-run https://github.com/Flip-Engineering/baton.git \
    refs/heads/bend2-rewrite:refs/heads/bend2-rewrite
error: unable to read askpass response from '/usr/bin/false'
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

A landing that reaches this point refuses `integrate_publish_failed` and rolls the local
fast-forward back (`impl/src/worktree.mjs:2377-2383`), so the queue stays unlanded. The
declaration therefore needs a credential path the landing's own environment can use: a
repository-local `credential.helper`, a remote URL carrying a token, or a local shared mirror
named as the declared remote. Which of these the deployment uses is the deployment owner's
decision.

## Reproductions

From a checkout of the served revision:

```sh
git diff --name-only cc1a1876 a49954d6 | wc -l     # 6
git diff --name-only cc1a1876 c16e8860 | wc -l     # 10
git diff --name-only cc1a1876 29439f98 | wc -l     # 48
git diff --name-only cc1a1876 14a365f8 | wc -l     # 28
node --test impl/test/create-driver-wiring.test.mjs # CDW5 fails: integrationPublishRemote unclassified
git ls-remote origin refs/heads/bend2-rewrite refs/heads/master
```
