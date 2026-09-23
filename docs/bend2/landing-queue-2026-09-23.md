# Bend2 landing queue, 2026-09-23

This record identifies the six-row queue based on
`62964e48c1dd15c26b3bd95d91055753b6fe82bd`. Every landing targets
`bend2-rewrite`. The live contribution IDs, immutable tips, review decisions and
assembled queue tip are recorded in the shared context `recovery:landing-plan`.
Check those coordinates immediately before landing.

## Rows

Land one current accepted contribution per row, in this order. Each row needs an
unrevoked independent accept. A replacement of this record needs its own accept.

| Order | Lane | Contribution | Tip | Changed paths |
|---|---|---|---|---:|
| 1 | Review | `contribution-20dc89e0651fa4d7c041383599183261` | `a49954d6` | 6 |
| 2 | Laws increment 2 and revision-10 proposal | `contribution-a3472f8af113fbc03ab3cc8794dac9fb` | `ea0bfbeb` | 17 |
| 3 | Architecture and prototypes | `contribution-9638c63e55af2a878cfe4d9c05ba24c7` | `3f5b22f8` | 48 |
| 4 | Lead records and evidence | `contribution-4427d906ccc48db8d2475d5c01040a40` | `311a4216` | 21 |
| 5 | This record | Current reviewed contribution in `recovery:landing-plan` | Published tip of `baton/bend2-record7` | 1 |
| 6 | B2-JSON encoder | `contribution-725aef0d0ec91928bdef59e06305b084` | `2a7daeec` | 2 |

The changed-path sets contain 95 paths, with all fifteen pairwise intersections
empty. A row's path count is its complete landing range from the merge base with
the target. The latest encoder contribution lists only its one-file evidence
edit; its landing range includes the program and evidence file.

The prior record contribution was `contribution-2da8b303d1721a596bdb4f7c104f1649`
at `5ba8fb8d`. The publication of this replacement records its own immutable tip
and contribution ID in shared context after the commit exists. The queue builder
then incorporates exactly that reviewed record tip. This avoids a self-referential
commit hash inside the file being hashed.

Row 4 alone changes `README.md` and selects the broad landing gates. Rows 1, 2, 3,
5 and 6 touch documentation and examples under `docs/bend2`. The landing tool
derives the actual gate set on its assembled checkout. Earlier measurements
selected no tests for those five rows; their executable examples still require
the targeted checks recorded in their evidence. A pinned expected-red result
does not count as an unexpected gate failure.

## Queue verification

`bend2-reviewer3` independently verified the predecessor queue
`4d4f7ccf13d2008fdf0c793924d5a9352b81b38e` on `baton/bend2-queue-r1`: six commits
with 6, 17, 48, 21, 1 and 2 changed paths. Every path matched its accepted row tip
by Git blob ID. The review identified stale instructions in the prior version of
this record; those are the changes this replacement makes.

The rebuilt queue is published on `baton/bend2-queue-r2-7`. Its exact tip belongs
in `recovery:landing-plan` after construction. Verify the six row ranges, their
disjoint path sets, and every destination blob against the accepted row tip.
Resolve relative Markdown links against the assembled tree, including directory
targets. A branch name alone does not establish the reviewed artifact.

The historical chain `b97e3626` contains five rows and was rebuilt before the
encoder row was added. It is not a landing instruction. The wake-delivery witness at
`1be5c81f` and the unsigned-integer decoder at `d67feebf` are separate review items;
neither is part of this six-row queue. The wake witness was rejected for an
unenforced adapter comparison and is being revised.

## Landing procedure

The deployment owner first serves a revision containing the published landing
fix, supplies the designated publication remote to that process, and establishes
write access in the landing process's Git environment. Then:

1. Read the current target from the designated remote and the accepted row tips
   from `recovery:landing-plan`.
2. Integrate the six current contributions in row order with `target` explicitly
   set to `bend2-rewrite`.
3. After each result, observe `refs/heads/bend2-rewrite` at the designated remote
   and confirm that it contains the intended landed content.
4. On refusal, preserve the code and evidence, then resolve that specific cause.
   Recompute remaining ranges after any target movement.

Row 1 has a historical dry-run receipt at seq 115413. The published landing fix
admits a real landing after a dry run by checking whether the earlier receipt
actually moved the target. The old served revision lacks that correction.

The operator may explicitly select direct publication of the assembled queue.
For that route, resolve `baton/bend2-queue-r2-7`, compare it with the immutable tip
recorded in shared context and its independent review, verify the required gates,
and confirm the designated remote target is an ancestor. Publish that exact SHA
to `refs/heads/bend2-rewrite`, then independently read the designated destination.
Direct publication does not create swarm integration receipts. Reconcile the
remaining swarm records with the observed publication before attempting further
landings of the same content.

## Deployment observations

Successor measurements on 2026-09-23:

- `swarm.view` reports served revision `65c913f0`.
- `git ls-remote origin refs/heads/bend2-rewrite refs/heads/master` reports
  `62964e48c1dd15c26b3bd95d91055753b6fe82bd` and
  `3d851f9f6e60bdb0e4a8b3ae632692ec56fe225d`, respectively.
- The publish fix is present in the latter master revision. Its earlier landing
  at `e501507a` exposed `integrationPublishRemote` on the driver return object
  consumed by `application.mjs`.
- The old served revision omits that member. Earlier real landing attempts
  returned `integrate_publish_undeclared`. Setting a variable only in a worker's
  environment does not change the serving deployment's configuration.

The predecessor's report records the root's selected SSH destination as
`git@github.com:Flip-Engineering/baton.git`. The successor has not independently
tested a push through that credential path. The serving process must receive its
declaration and retain working credentials under the landing Git environment,
which excludes global and system Git configuration. Credential material belongs
in the deployment's credential mechanism. No resident restart, credential change,
or remote publication is performed by this document change.

## Laws and remaining verification

Row 2 lands `ea0bfbeb`, including increment 2 and the revision-10 proposal in the
operator's shape: Baton wakes the seat's orchestrator with the turn report, and
the orchestrator decides whether work continues. `20a5c8ae` and its contribution
`contribution-1d7aadaec318a6be114a9ea4ee5bb46f` are superseded; the latter's accept
was revoked. They must not replace row 2.

Revision 10 remains proposed. The encoded law checks the closure of the model's
waiter tables. Actual report delivery remains a separate conformance obligation.
Routing metadata alone establishes neither delivered nor absent delivery.

This record provides no full-suite or deployment-verification result. The root
owns assembled verification with `npm test --prefix impl`. Work on this host
currently uses targeted checks under the memory constraint.
