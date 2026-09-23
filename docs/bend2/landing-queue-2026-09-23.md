# Landing queue and the publish path, 2026-09-23

This record states the landing queue for `bend2-rewrite` at the target head
`cc1a18766c5284b556d0e8622e3436980761407c`, the measurements that back it, and the reason every
real landing on the served revision refuses `integrate_publish_undeclared`. The seat that lands
next reads this file first.

## The queue

Land one row per lane, always the lane's accepted tip. All four rows carry an accept review.

| order | lane | contribution | tip | changed paths |
|---|---|---|---|---|
| 1 | review | `contribution-20dc89e0651fa4d7c041383599183261` | `a49954d6` | 6 |
| 2 | laws | `contribution-ae84c6ee9c2eefe2b3f4d04b5fe0f1ec` | `c16e8860` | 10 |
| 3 | architecture and prototypes | `contribution-42c611df45d2dcb74a5664f2296a3df2` | `29439f98` | 48 |
| 4 | lead records and evidence | `contribution-337edb7821ee3d228f634a86bbcb9e38` | `14a365f8` | 28 |

Measured at `cc1a1876`:

- `git diff --name-only cc1a1876 <tip>` returns exactly the counts above, 92 paths in total.
- The four path sets are pairwise disjoint. `README.md` appears in the lead row alone, so that row
  is the only one whose changed paths select the wide gate set.
- `git merge --squash <tip>` in a scratch worktree at `cc1a1876` exits 0 for every row and stages
  the count in the table, in this order.

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

- `git ls-remote origin` at 2026-09-23T03:44Z: `refs/heads/bend2-rewrite` is `cc1a1876` and
  `refs/heads/master` is `65c913f0`. Neither ref has moved since.
- The resident serving this deployment started at 2026-09-23T03:43:10Z on `65c913f0`.
- Row 1's real landing for `contribution-20dc89e0651fa4d7c041383599183261` was refused at
  2026-09-23T03:45Z; its dry-run measurements are the queue table above.

## Unpublished work on the lane branches

`baton/bend2-laws-lead6` at `520ef83e`, committed 2026-09-23T03:42:41Z, changes 11 paths over
`c16e8860`: the M-14 refusal laws, the M-18 decision law, the transition witness, and the
per-entry pin boundary, with their evidence files. The commit is not published as a contribution
and its seat is dead. It moves the laws lane's tip, so it does not replace row 2 without its own
review.

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
