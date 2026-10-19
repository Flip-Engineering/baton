# Amendment to PR869 final16 critique 4ad2924df: lineage correction

## Correction

4ad2924df approved final16/ad9ee93a as PR869 qualification. That scope was
wrong. final16/ad9ee93a is retained PR835 legacy-reopen coverage. It is not
PR869 Codex-span product qualification, and the ad9ee93a tests do not
qualify the PR869 product. The PR869 product is not approved.

The valid final16 evidence is preserved under its correct scope: PR835
legacy-reopen coverage (large success and failure terminals reopening from
a legacy checkpoint, held flushed once, receipt and cursor outcomes as
recorded in pr869-final16-critique-20261019.md). Nothing in that evidence
changes; only its product attribution is corrected.

## Self-verified lineage (account repo, explicit git-dir, read-only)

Repo: /mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/
baton-account-credits-793-702-20261017T0106Z/repo/.git

- refs/root-review/pr869-20261019 = d461a5611b2b2819e1e7803c8b92ff0da5f9c9c9
  (PR869 head). Its bend2/src/coordinator/turn.bend blob is
  0433182ddd00416be2209b67d3fdf06acbbf3d7f and contains CodexSpanState /
  codex_span_observe_fields (8 matches). Recent commits: "Bound legacy
  failure fixture lifetime", "Keep failed Codex span state tagged",
  "Keep Codex large frames in retained spool".
- refs/root-review/pr869-qualified-20261019 =
  788b806db8aefbe8453511bf19c615a1efa48bc1 (the source this critic
  qualified in 4ad2924df). Its turn.bend blob is
  8cf8fbe16e2583f4558de9c75f29dabed48c5b50 and contains no CodexSpanState /
  codex_span_observe_fields (0 matches).
- d461a561 is not an ancestor of 788b806. The two heads are divergent.

Root states the ad9ee93a build receipt source is
3fe6380de75432442b179987324fab2f7084fadc with parent 788b806. This critic
verified 3fe6380 as HEAD of the retained incoming-g5-pr835/io-try.bundle
(git bundle list-heads). The object itself is not in the account repo, so
the parent claim is root-verified, not independently re-derived here.

## Amended verdict

- PR835 legacy-reopen coverage (final16, binary ad9ee93a, source lineage
  788b806/3fe6380): approved. The two legacy tests, receipt/cursor
  outcomes, held-once publication and fixture exclusion recorded in
  4ad2924df stand under this scope.
- PR869 Codex-span product (head d461a561): not approved and not qualified
  by any evidence reviewed here. No deployment claim is made.

## What PR869 product qualification still requires

1. A build from current main with the PR869 Codex source actually included:
   CodexSpanState / codex_span_observe_fields present in the built
   turn.bend lineage, with source and binary hashes recorded. Root states
   the normal entry 6a2c7a2ed does not include PR869 yet; that object was
   not present in the account repo, so this is root-stated and must be
   confirmed at build time.
2. An actual 8 MiB Codex-span test run against that binary, covering the
   spanned large-frame success and failure paths, terminal reopen,
   receipt/cursor outcomes and held-once publication, with a recorded
   passing log. The PR835 legacy tests at about 1 MiB do not substitute.
3. A fresh independent critique of that run before any approval or
   deployment statement.

## History

4ad2924df is left in place. This amendment supersedes its product
attribution and its PR869 approval scope. No other history was rewritten.
