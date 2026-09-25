# Baton2 design and evidence

[MANDATE.md](MANDATE.md) and the current [authorization](authorization.md) define the scope.
The operator approved the 16 revision 9.1 prohibitions and authorized the rewrite on
`bend2-rewrite`. The architecture review and the plan record the evidence required for each
migration phase.

## The source of truth

[reference/README.md](reference/README.md) pins the language and the runtime this evaluation reads:
`bendlang/bend` at commit `a49524265bdfa5753a4bf38e25f0574a705dd868`, with the guide, the two papers
and the repository documents mirrored byte for byte under `reference/upstream/`, and the `bend`
2.0.25 install recipe with the archive digests. A claim about what Bend2 can or cannot express cites
that pin and is backed by a compiled, run example.

## Documents

The documents describe the design, its evidence, and the remaining work:

| Document | Answers |
|---|---|
| `language-review.md` | What Bend2 is at the pin: the type system, the effects and IO model, what the runtime parallelizes and what the programmer writes to get it, host interop for processes, sockets, the filesystem and JSON, the module and package story, error handling, and the maturity of build, test and debug tooling. It closes with what Baton needs that Bend2 does not provide at this pin and what Bend2 provides that the JavaScript implementation built by hand. |
| `architecture-review.md` | Which subsystems exist because of JavaScript, Node or history; which abstractions duplicate each other; which seams in `impl/scripts/seam-inventory.json` collapse under first-class parallelism and affine types; and what Baton would lose if each named deletion or merge were wrong. |
| `target-architecture.md` | The proposed subsystem list for a rewrite: what each subsystem owns and what each is forbidden from owning. |
| `laws-proposed.md` | The 16 approved prohibitions and their rationale; the filename retains the proposal history. |
| `laws.bend` | Baton's invariants written in Bend2: the closed-shape validators, the authorization boundaries, the custody and capacity rules, the wake and coordination-ledger semantics, the swarm permission model, and the contribution and landing contract. |
| `laws-trace.md` | Every law traced to the source that enforces it and the test that pins it, with unenforced laws marked proposed and the laws Bend2 could make unrepresentable stated as types. |
| `rewrite-plan.md` | The phases of the rewrite: which subsystems move per phase, what the JavaScript and Bend2 halves must agree on at the boundary while both exist, and the test that proves each phase before the next starts. |
| `go-no-go.md` | The recommendation and the specific findings it rests on. |
| `arch-close-status.md` | What each `ARCH-CLOSE-01`..`12` correction has on this branch today, and which evidence file carries it. |

## Records

[reviews/](reviews/) holds the independent review written for each contribution, one file per
contribution, recording what the reviewer ran and what it answered.
[reviews/codex/](reviews/codex/) holds the external Codex architecture review, its manifest and
its probe evidence; [reviews/codex/codex-final-law-review-r9.1.md](reviews/codex/codex-final-law-review-r9.1.md)
is the final law approval record. [ledger.md](ledger.md) is the operational record.
[recovery-2026-09-22.md](recovery-2026-09-22.md) and
[recovery-2026-09-23.md](recovery-2026-09-23.md) record the two cold-restart recoveries with the
retained-branch census and the state of every unlanded work item.

## Examples

[examples/README.md](examples/README.md) fixes the convention: a `<claim-slug>.bend` file with a
`# CLAIM:` header, and a `<claim-slug>.evidence.md` sibling recording the host, the toolchain, every
command with its verbatim output, and a verdict. Examples exist to prove or disprove one capability
claim each; a refusal is as usable a result as a success.
