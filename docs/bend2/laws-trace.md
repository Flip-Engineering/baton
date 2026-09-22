# Baton's laws: trace from `laws.bend` to source, tests, and the operator's decisions

Status: DRAFT for the operator approval loop. This document carries only the rows the operator
has approved — none yet — and the seven development laws, which are presented for approval
alongside them. It is not published until the decisions arrive.

Provenance: work-bend2-laws, pillar 3 of issue #539, per the approval clause of
`docs/bend2/MANDATE.md` part 3. The candidate register is `docs/bend2/laws-proposed.md` (landed
on `bend2-rewrite`; 138 rows: 131 runtime candidates restated from the two landed lane
inventories — `docs/bend2/laws-ledger-inventory.md`, `docs/bend2/laws-validators-inventory.md`,
commit `6a00a7a4` — plus 7 development laws). Every candidate's trace was verified at base
`bc2e4fcd` before it was written down: each cited source file exists, each cited line is in
range, and each quoted test name occurs in its cited test file — 131/131 rows hold, no law was
dropped for source drift. The four host-capacity comment blocks the ledger lane flagged are
documentation drift; the enforcement matches CAP-2, CAP-3 and CAP-5.

## Marking

Every row in `laws.bend` and in this document carries its status in the row header, uniformly:

- `status: for approval` — presented to the operator, no answer yet.
- `status: approved (decision: yes, relayed at <seq>)` — enters `laws.bend`.
- `status: amended (decision: <text>, relayed at <seq>)` — the amended wording enters.
- `status: rejected (relayed at <seq>)` — recorded here, never written into `laws.bend`.

Runtime rows additionally carry their proof method in the header: `type-level` (the violation is
unrepresentable — no term of the type can carry it), `total-function` (a total def over a closed
enum; a new case breaks the check), `law-proof` (a Bend `law` claim proven by a def of the same
name — a compile-time guarantee), `runtime-residue` (the check needs the world outside the type;
the type carries the refusal or verdict shape), or `claim-open` (stated as an open claim the
pin's type system cannot yet prove).

Reference pin: `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`, bend 2.0.25). The
compiler session is recorded in `docs/bend2/examples/laws-check.evidence.md`.

## Development laws (presented for approval)

All seven carry `status: for approval` and live in Part I of the draft `laws.bend`.

| ID | Law | Source (document or ruling) | Proof method, encoding |
|---|---|---|---|
| DEV-1 | No cutoff of any kind on an agent control flow or its input; a bound derived from a physical resource carries its derivation | Operator ruling on #541, commit `bc2e4fcd`; `docs/bend2/MANDATE.md` §3 | `type-level` + `law-proof`: `Admission = Admitted{token} \| Queued{position, ahead} \| Degraded{shortfall}` has no timeout variant, so a cutoff on the wait is unrepresentable; the proven law `worker_admitted_at_any_load` discharges the admission shape |
| DEV-2 | A verb records a durable intent and answers its receipt at once; never a synchronous wait | Operator rulings on #529 (`30cdb282`, `84357e4b`) and #543 (`25856479`); `docs/54-native-wake.md:1-27` | `type-level`: `Receipt = ReceiptRow{recorded: Nat}` is all a verb answers |
| DEV-3 | Wake is native and always on, given at the boundary; not a verb a model invokes | `docs/54-native-wake.md:1-7`; operator rulings on #529 and #543; `docs/bend2/MANDATE.md` §3 | `type-level`: the `Command` enum is the whole command surface and carries no wake constructor; `WakeClass` is the delivered vocabulary |
| DEV-4 | Every refusal is typed, naming its rule, its field and its remedy | `docs/bend2/MANDATE.md` §3 | `type-level`: `Refusal = Refused{rule, field, remedy}` — a refusal missing any of the three is unrepresentable |
| DEV-5 | A contribution lands red-first, through review and integrate, never by hand | `docs/bend2/MANDATE.md` "Deliverable form"; `CONTRIBUTING.md` steps 4–5; `docs/42-suite-legitimacy.md:112-115`; rulings on #539 (`58d0814e`, `13b104bc`) | `type-level` over a `runtime-residue` CAS: `Landing` reaches `Integrated{accept: Acceptance}` only through an `Acceptance` value, which only an accept review row builds |
| DEV-6 | Orchestration gives a seat whole scope and full authority, never a slice | `docs/bend2/MANDATE.md` §3; `docs/39-swarm-runtime.md:1175-1178` | `claim-open`: `SeatGrant` carries the whole declared scope as one value |
| DEV-7 | Prose is plain technical English | `AGENTS.md` at the repository root | `claim-open` (a prose property; review-enforced) |

## Runtime laws (none approved yet)

`laws.bend` Part II is empty by design and states the exact format an approved row takes. When
decisions arrive, each approved row is added there with its source and test trace copied from its
`laws-proposed.md` row, and this document's table below gains one row per decision.

| ID | Status (decision, relayed seq) | Proof method | Trace (source · test) |
|---|---|---|---|
| — | awaiting the operator | — | candidates: `laws-proposed.md`, families CUST-1..12, CAP-1..17, WAKE-1..13, LEDG-1..19, CS-01..20, AB-01..14, PM-01..11, CL-01..17 |

Status context the operator's answers land on:

- **Enforced but unpinned (12):** CAP-8, WAKE-10, LEDG-2 (`invalid_utf8` half), LEDG-15, CUST-3,
  CS-19, AB-02, PM-01 (refusal arm), PM-03, PM-08, CL-10 (empty-range arm), CL-13 (CAS race arm).
  An approved row from this list still enters `laws.bend`; its unpinned marking travels with it so
  the rewrite knows the test pin is still owed.
- **Proposed, not enforced (8):** PROP-1..3, PR-01..05. An approved row from this list enters as a
  law the rewrite adopts, with `proposed` recorded in its decision line.

Prepared encodings for the runtime families sit in this lane's staged draft and are ready to
paste in as rows are approved: closed vocabularies as enums (`SwarmEvent`, `Permission`,
`RecruitMode`, `GuidancePriority`, `WorkStatus`, `AssignmentStatus`, `ReviewDecision`,
`ItemStatus`, `WakeClass`, `HolderStatus`), closed shapes as exact records and tagged unions
(`Claim`, `Glob`, `Refusal`, `WakePage`, `Recorded`, `ReleaseVerdict`, `Admission`), derivations
as total functions (`event_permission`, `command_permission`, `review_state_of`, `attachable`,
`append_once`, `release_mine`, `floor_bytes`), and the law proofs for the rows that carry one.
