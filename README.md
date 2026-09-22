# bend2-rewrite — the issue #539 Bend2 evaluation

This branch carries the evaluation of rewriting Baton in Bend2 (issue #539). It holds Baton's
current code together with the evaluation's deliverables under `docs/bend2/`. Baton itself is
described by master's README, [SYSTEM.md](SYSTEM.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this
page describes what the branch adds.

[docs/bend2/MANDATE.md](docs/bend2/MANDATE.md) is the authority for the work: evaluate the
rewrite, produce what is needed to decide, and keep the work at design, review and audit. The
evaluation does not modify `impl/src`, and nothing from this branch lands on master. Master is
merged into this branch so the evaluation reads current code.

The language and runtime under evaluation are pinned in
[docs/bend2/reference/README.md](docs/bend2/reference/README.md): `bendlang/bend` commit
`a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25, vendored with each file's sha256.

## The four pillars

**1. Bend2 language and runtime.**
[docs/bend2/language-review.md](docs/bend2/language-review.md) reports the type system, the effects
and IO model, the parallelism model, host interop, modules, error handling and the tooling surface,
with per-effect verdicts for what Baton needs. The compiled examples that carry its evidence are in
[docs/bend2/examples/](docs/bend2/examples/), each with a `.evidence.md` sibling recording the
commands and their output; [docs/bend2/examples/index.md](docs/bend2/examples/index.md) indexes
them. State: complete at the pinned reference, corrected after an independent probe pass that
disproved several claimed type-system carriers (see `lang-cap-probes.evidence.md`).

**2. Adversarial architecture review and the target architecture.**
[docs/bend2/architecture-review.md](docs/bend2/architecture-review.md) lists the deletions and
merges the review proposes, each with its evidence and what Baton loses if it is wrong; the two
read-only lanes' findings are preserved as
[docs/bend2/architecture-findings-surface.md](docs/bend2/architecture-findings-surface.md) and
[docs/bend2/architecture-findings-coordination.md](docs/bend2/architecture-findings-coordination.md).
[docs/bend2/target-architecture.md](docs/bend2/target-architecture.md) describes baton2, the
proposed target: its subsystems, ownership, prohibitions and synchronization seams. State: complete
as a proposal; the deletions, merges and the target await the operator's approval, and one
correction that applies the operator's F2, F4 and F16/F17 decisions is held until the current pause
is lifted.

**3. Baton's laws in Bend2.**
[docs/bend2/laws-proposed.md](docs/bend2/laws-proposed.md) is the candidate set: 16 entries, each
one forbidden behavior, the reason it must bind every otherwise-valid implementation, and an honest
status label. [docs/bend2/laws-design-notes.md](docs/bend2/laws-design-notes.md) carries every row
that did not survive the minimality test, with its reason, so no analysis is lost. The lane
inventories are [docs/bend2/laws-ledger-inventory.md](docs/bend2/laws-ledger-inventory.md) and
[docs/bend2/laws-validators-inventory.md](docs/bend2/laws-validators-inventory.md). State: the
candidate set is cleared for the operator's review; `laws.bend` exists as a design artifact only
once approved rows arrive, and it carries no entries today.

**4. Rewrite plan and recommendation.**
[docs/bend2/rewrite-plan.md](docs/bend2/rewrite-plan.md) phases the migration, and each phase names
the subsystems that move, the boundary contract the two halves must agree on while both exist, the
test that proves the phase and its rollback; the final phases remove the JavaScript boundary and
the Node runtime. [docs/bend2/go-no-go.md](docs/bend2/go-no-go.md) carries the decision record and
the recommendation: **Prototype only** — complete the frozen corpus and the shadow decision core,
keep production authority in JavaScript for now, and treat the process-lifecycle effect family and
the JSON implementation as the two prerequisites a production migration rests on. State: complete
as a draft; the recommendation is the orchestrator's, and the per-phase citations of approved
deletions and laws follow the operator's decisions.

## Records

[docs/bend2/ledger.md](docs/bend2/ledger.md) is the operational record: the pin, the toolchain
placements, the routes the seats ran on, the landings, and the findings that outlive the
evaluation. [docs/bend2/reviews/](docs/bend2/reviews/) holds the independent review written for
each contribution, one file per contribution, recording what the reviewer ran and what it
answered.
