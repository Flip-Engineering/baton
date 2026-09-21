# docs/bend2 ledger

The record of how the Bend2 evaluation ran: the revision it read, the toolchain it used, the routes
its seats ran on, the landings on `bend2-rewrite`, and the findings that outlive the evaluation.
The documents themselves are the deliverables; this file is the operational record behind them.

## The pin

`bendlang/bend` at commit `a49524265bdfa5753a4bf38e25f0574a705dd868`, toolchain Bend 2.0.25.
Vendored under [reference/](reference/README.md) with every file's sha256, the installer served by
`bend-lang.com`, and the release archive's own digest. The installed `.bend/guide/GUIDE.md` is
byte-identical to the vendored `guide/GUIDE.md` (sha256
`9e4643649b8ce8c8a066b60741eeec1a3d902c0e1ed86d1e5bf0340b4fede746`).

## Landings on this branch

| Contribution | Landed as | Paths |
|---|---|---|
| `contribution-1440bd10c2e224b659dab8fcae4953d2` | `50dbbe15` | the pinned reference, the toolchain record, the examples convention, `toolchain-sanity` |

## Toolchain placement, and the workspace snapshot

The evaluation installs the pinned toolchain inside its checkout. Two placements work and one does
not:

- `node_modules/.bend` — the repository already ignores `node_modules/`, so the install never
  reaches a workspace capture. The lanes of this evaluation use it.
- `.bend/` at the worktree root with the `.gitignore` lines for `.bend/` and `.scratch/`; those
  lines ride contribution-d2f1daf5 rather than this branch, because a changed `.gitignore` selects a
  wide gate set at landing time.
- An untracked toolchain tree with no ignore line does not work on this host: the capture's
  untracked-file walk feeds `git add` a 61 MB toolchain (plus a 32 MB source archive), and the host
  kills it under memory pressure (`git add` exits 137), which blocks the capture, the check and the
  landing of that seat.

## How the seats got their routes

The four work items ran under one swarm with a review seat. The mandate names Kimi K3 through omp
for orchestration and design; that route is not configured on this host, so the four leads ran on
`codex/gpt-5.6-sol` at high effort and the lanes on `omp/zai/glm-5.3-flash` and
`omp/deepseek/deepseek-flash`, with the review seat on `omp/zai/glm-5.3-flash`. The refusals behind
that substitution, measured by real recruit calls:

- `omp/opencode-go/*` (including `opencode-go/kimi-k3`) answers `authentication_required`: the
  route needs `opencode_go_key.json` at the deployment root, which this host does not carry.
- `omp/deepseek/deepseek-v4-pro[1m]` is listed as a ready served route but answers
  `model_unavailable_in_harness` — the harness catalog defines `deepseek/deepseek-v4-pro`, not the
  bracketed spelling, so a served route can name a model its own harness cannot start.

## Findings that outlive this evaluation

1. **A landing that touches `README.md` or `.gitignore` selects an environment-red test set.** The
   pre-verdict selector (`impl/src/verification-selection.mjs`) treats an unimported changed path's
   basename as a fixture needle, and dozens of tests write `README.md` or `.gitignore` fixtures, so
   one such changed path selects 67 test files. On this host that set contains
   `test/phase78-concise-deployment-factory.test.mjs :: P92-DF10b`, which fails with
   `harness_unavailable`: the test isolates `HOME`, and the Kimi Code executable it needs is not on
   `PATH` or under the isolated home, so the doctor answers `harness_unavailable` where the fixture
   expects `authentication_refresh_required`. A seat whose contribution touches those two names
   therefore cannot land until the machine provides the Kimi CLI or the row is pinned as an
   environment red; a pin must use the bare `environment` class, because attributing it to a native
   `kimi-code` prerequisite would leave the row unjudged on every host (non-omp route families are
   declared, never evaluated).
2. **`test/application-observation.test.mjs`'s AO5 count went stale at `0263e104`** (the
   regeneration after issue #140 added `lastCoordinationEvent`, 174 members to 175) and no
   expected-red row covered it. The same correction landed on `master` as `d943c960`, from the
   backlog lane, together with the `issue144` GP-D re-anchor whose frozen line windows had put that
   row red as well.

3. **A landing with a wide gate set can hit the gate run's deadline.** The landing table derives its
   gate set from the paths a contribution would change, and for a contribution whose set carries
   `README.md` or `.gitignore` that set is 76 test files. The gate run then answers
   `suite-timed-out` with no test verdict at all, so the landing neither passes nor names a failing
   row. Two refusals of this evaluation's own contributions were that timeout, and the root filed it
   as issue #546 with the wide default set and the deadline named. A document whose name no test
   mentions lands in a short gate run.
