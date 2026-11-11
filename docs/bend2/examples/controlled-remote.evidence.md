# controlled-remote — the publication half of a landing against a controlled remote

## Claim

The deployment publishes a landed ref with one command, `git push <declared remote> <squashSha>:<ref>`,
after its local target ref has moved. Against a controlled remote the four cases the external
architecture review names are distinguishable: a local completion leaves the declared remote unmoved;
a push to a wrong destination moves the wrong repository and leaves the declared remote unmoved;
a push to the declared remote moves it to the landed commit; and an attempt whose response is lost is
reconciled by observing the destination, which establishes convergence without establishing that this
attempt caused it.

## Files

| File | Holds |
|---|---|
| `controlled-remote.sh` | the fixture: a bare declared remote, a second wrong destination, a source clone, and the four cases |
| `controlled-remote.evidence.md` | this record |

## The deployment's own path

`landContribution` in `impl/src/worktree.mjs` (master `65c913f0`) is the path this fixture models:

- line 2374: `git push <advanced.integration.publishRemote> <squashSha>:<ref>` — the destination is the
  declared value itself, never a remote name.
- lines 2351-2356: a deployment that declares no remote throws `integrate_publish_undeclared` before
  anything moves, which is the refusal this deployment returns today
  (`swarm.integrate` on `contribution-ae84c6ee9c2eefe2b3f4d04b5fe0f1ec` and
  `contribution-4eee56bac4b8131f1476861aee3b7397`).
- lines 2358-2383: the local target ref moves first under one compare-and-swap, and a failed push rolls
  the local move back and refuses `integrate_publish_failed`.

The fixture runs the same git operations against the same shape of repository, without driving the
runtime. It is the git half of the composed path; `arch-publish-compose.evidence.md` carries the
acceptance and settlement half over a filesystem destination.

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); `git version 2.50.1`.
- The fixture needs no language toolchain: it uses `git init`, `git push`, `git update-ref` and
  `git ls-remote` only.
- The fixture commits carry a fixed author, committer and date, so every run produces the same object
  ids and the output is byte-identical.

## Command and output

```sh
sh docs/bend2/examples/controlled-remote.sh
```

```text
declared_remote=.scratch/controlled-remote/remote.git
base_head=aa573951a310e1a0679461b42bb44b79c60f9d60
squash=54a5a3404aae5df10c6935af754ac16c89d66cc0
### case 1: a local completion with no publication
local_target=54a5a3404aae5df10c6935af754ac16c89d66cc0
declared_remote_head=aa573951a310e1a0679461b42bb44b79c60f9d60
### case 2: publication to a wrong destination
wrong_destination_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
declared_remote_head=aa573951a310e1a0679461b42bb44b79c60f9d60
### case 3: publication to the declared remote
declared_remote_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
### case 4: an attempt whose response is lost, reconciled by observation
observed_head_after_lost_response=54a5a3404aae5df10c6935af754ac16c89d66cc0
reconciliation=observed_convergence_not_this_attempts_effect
```

Exit code 0. Two consecutive runs produced byte-identical output. All state is under
`.scratch/controlled-remote/`, which the repository ignores.

## What each case establishes

| Case | Step | What the output shows |
|---|---|---|
| 1 | Local completion with no publication | the clone's own target ref holds the landed commit while the declared remote still holds the base commit: a local success is not a publication, which is the shape issue #558 reports and the reason a landing now refuses without a declared remote |
| 2 | Publication to a wrong destination | the wrong remote holds the landed commit and the declared remote still holds the base commit: a push that reaches another repository leaves the intended destination unchanged, so a destination must be bound and observed rather than inferred (finding 2, M-18) |
| 3 | Publication to the declared remote | the declared remote moves to the landed commit: the destination the plan named holds the artifact |
| 4 | An attempt whose response is lost | the observed head is the landed commit while the attempt's own outcome was discarded: the observation establishes state convergence, and M-3c still requires an honest claim about what this attempt did |

## Limits

- The remotes are local repositories in a scratch directory. No network, credential or remote service
  is exercised, so this is not evidence about GitHub's behavior or about authentication.
- The fixture does not drive `swarm.integrate`; it models the git operations that path runs and cites
  the source lines for the runtime's own parts (`integrate_publish_undeclared`,
  `integrate_publish_failed`, the rollback after a failed push).
- Case 4 discards a real push's response; it does not make a response unavailable over a transport.
  Ambiguity ordered before an effect (dispatch, then a lost response) needs the process boundary and
  crash injection that `arch-publish-compose.evidence.md` names as missing.
- The landing's target ref here is `refs/heads/main`; the deployment's target is named by the
  contribution's landing, and the push shape is the same.

## Verdict

The claim holds at `git 2.50.1` on this host: the four cases are distinguishable against a controlled
remote, the declared destination is what a publication must bind, and an observation reconciles a
lost response without claiming the effect. The runtime's own half carries the two typed refusals and
the rollback, and its live state is `integrate_publish_undeclared` until the resident declares
`BATON_PUBLISH_REMOTE`.

## Related

- `arch-publish-compose.evidence.md`: the acceptance-and-settlement composition over a filesystem
  destination; this fixture is the git half those increments name.
- `../reviews/codex/architecture/codex-architecture-review.md`: finding 2 and the M-18 disposition.
- `../ledger.md` finding 4: the declaration point and the deployment's live refusal.
