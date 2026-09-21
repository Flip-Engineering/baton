## Mandate
Evaluate rewriting Baton in Bend2 (HigherOrderCO's Bend, second generation, on the HVM runtime),
and produce everything needed to decide and then execute that rewrite. Work lands on the
`bend2-rewrite` branch, never on `master`, until the operator decides.

The work has four parts. They run under one orchestrated swarm with sub-orchestration; the
split below is the mandate, not an assignment list.

### 1. Bend2 language and runtime review
- The canonical source is https://bend-lang.com (the language site) and the HigherOrderCO
  repositories it links. Obtain the current Bend2 language reference and the HVM runtime
  documentation from there, and vendor a copy under `docs/bend2/reference/` on the branch so every lane reads the same source at the
  same version (record the upstream commit).
- Install the toolchain on the deployment host if it can be installed; every claim about what
  Bend2 can or cannot express must be backed by a compiled, run example checked in under
  `docs/bend2/examples/`, not by reading alone.
- Report, concretely: the type system, effects and IO model, concurrency and parallelism model
  (what HVM parallelizes automatically and what it does not), interop with the host (process
  spawning, sockets, filesystem, JSON), the module and package story, error handling, and the
  maturity of tooling (build, test, debug). Name what Baton needs that Bend2 does not provide
  today, and what Bend2 provides that Baton's current JavaScript implementation had to build by
  hand.

### 2. Adversarial architectural review of Baton
- Review Baton as it is today (`impl/src`, `docs/*.md`) with the goal of simplification: which
  subsystems exist because of JavaScript, Node, or history rather than because the coordination
  problem requires them; which abstractions duplicate each other; which seams in
  `impl/scripts/seam-inventory.json` would collapse under a language with first-class
  parallelism and affine types.
- This review is adversarial: it argues against the current design, names what it would delete,
  and states what Baton would lose if that deletion were wrong. Findings that do not name a
  concrete deletion or merge are not findings.
- Produce a proposed target architecture for the rewrite -- call it baton2 -- with the
  subsystem list, what each owns, and what each is forbidden from owning. baton2 is the
  simplified and refined architecture this review arrives at, not the current subsystem list
  ported one for one. The rewrite plan (part 4) targets baton2; every phase of the plan names
  the deletions and merges from this review it carries out.

### 3. Baton's laws in Bend2
- Extract the invariants Baton actually enforces today (the closed-shape validators, the
  authorization boundaries, the custody and capacity rules, the wake and coordination-ledger
  semantics, the swarm permission model, the contribution and landing contract) into one laws
  file written in Bend2, `laws.bend`, on the branch.
- Every law must be traced to the current source that enforces it and the test that pins it.
  A law with no current enforcement is stated as proposed, not as extracted.
- Where Bend2's type system can make a law unrepresentable-as-violated (a forged principal
  field, an unowned capture path, an unbounded ledger read), state the law that way rather
  than as a runtime check.
- The laws file carries two kinds of law, marked as such. Runtime laws are the invariants
  above. Development laws are the rules Baton is built under, extracted from AGENTS.md,
  CONTRIBUTING.md, the docs/ design documents, and the operator rulings recorded on issues
  #541, #543, #529 and #539 -- among them: no cutoff of any kind on an agent control flow or an
  input (no deadline, queue wait, size, count or buffer limit that stops work; a bound derived
  from a physical resource carries its derivation); a verb records a durable intent and answers
  its receipt at once, never a synchronous wait; wake is native and always on, never a verb a
  model invokes; every refusal is typed and names its rule, its field and its remedy; a
  contribution lands red-first, through review and integrate, never by hand; orchestration
  gives a seat whole scope and full authority, never a slice; prose is plain technical English.
  Each development law traces to the document or ruling it comes from.
- Approval. No law is written into `laws.bend` as law until the operator has approved it. The
  laws pillar delivers its candidates as a document on the branch
  (`docs/bend2/laws-proposed.md`): one row per candidate law, its kind (runtime or
  development), its statement, and its trace. The root presents that document to the operator;
  the operator approves, edits, or rejects each row; only approved rows enter `laws.bend`, each
  carrying the operator's decision. The same applies to the baton2 architecture's deletions and
  merges (part 2): they are presented to the operator for approval before the rewrite plan
  builds on them.

### 4. Rewrite plan
- The end state is a Baton written entirely in Bend2: no JavaScript, no Node runtime, no
  JavaScript host for transport, process, socket, filesystem or git effects. A coexistence
  boundary may exist only while a migration is in progress, and the plan deletes it in its final
  phase. No phase is "conditional" on keeping JavaScript: if the language review finds that Bend2
  cannot perform a host effect Baton needs, that finding goes to the go/no-go (a No-go, or a
  named prerequisite Bend2 must gain first), never into a permanent JavaScript layer.
- A phased plan that names, per phase, which subsystems move, what the two halves must agree on
  at the boundary while the migration is in progress, and the test that proves each phase before
  the next starts.
- An honest go/no-go recommendation with the specific findings from parts 1 to 3 that support
  it.

## Deliverable form
Every pillar's output is a file on the branch: `docs/bend2/language-review.md`,
`docs/bend2/architecture-review.md` (the adversarial review and the baton2 target
architecture), `laws.bend`, `docs/bend2/rewrite-plan.md`, `docs/bend2/go-no-go.md`, and the
examples. A contribution whose body carries findings but whose `commit` is null has delivered
nothing to the branch: it cannot be reviewed against the tree or integrated. A lane commits its
document on its own branch and records the commit in the contribution; the pillar lead reviews
and integrates it onto `bend2-rewrite`.

## Constraints
- Plain technical English throughout (AGENTS.md).
- No orchestrator or lane on claude-code or native kimi-code. Kimi K3 through omp for
  orchestration and design; GLM, DeepSeek, and muse for lanes.
- The swarm integrates its own verified work onto `bend2-rewrite` with
  `baton swarm integrate --onto bend2-rewrite`. Nothing from this issue lands on `master`.


## Scope at this time

Design, review, engineering ideation, and audit/critique only. No rewrite implementation. impl/src is not modified on this branch. Deliverables are documents under docs/bend2/, laws.bend as a design artifact, and small compiled examples under docs/bend2/examples/ that exist only to prove or disprove one specific language-capability claim each.
