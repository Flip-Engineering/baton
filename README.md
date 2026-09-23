# Baton2

Baton2 is the Bend2 rewrite of Baton, a system for coordinating coding agents, preserving their
work, reviewing contributions, and publishing verified changes. Development takes place on the
`bend2-rewrite` branch.

The target is a native application written in Bend2 with C host effects for operating-system
services. The migration plan covers the decision core, durable state, worker lifecycle,
verification, publication, and CLI, MCP, and web interfaces. Its final phase removes the temporary
JavaScript boundary and the Node runtime.

The rewrite is in development. This branch contains the current JavaScript implementation,
the target design, and compiled language examples. Production migration depends on the evidence
gates in the [rewrite plan](docs/bend2/rewrite-plan.md).

## Development contract

The [16 approved prohibitions](docs/bend2/laws-proposed.md) are Baton2's development contracts.
They cover recoverable acceptance, uncertain external effects, truthful evidence, work
preservation, authorization, continuation responsibility, and publication to the designated
shared destination. The [approval record](docs/bend2/authorization.md) identifies the reviewed
revision and its binding entries.

The [language review](docs/bend2/language-review.md) records what the pinned compiler and runtime
establish. Filesystem durability, process supervision and cancellation, JSON, HTTP/TLS, and
cryptography have named prerequisites. Architecture changes and migration phases must satisfy
their recorded proofs before taking production authority.

## Design and evidence

- [Rewrite plan](docs/bend2/rewrite-plan.md): migration phases, entry conditions, verification, and rollback.
- [Target architecture](docs/bend2/target-architecture.md): subsystem ownership and interfaces.
- [Architecture review](docs/bend2/architecture-review.md): proposed changes and their consequences.
- [Migration readiness](docs/bend2/go-no-go.md): evidence available and remaining prerequisites.
- [Language reference](docs/bend2/reference/README.md): vendored `bendlang/bend` commit
  `a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25.
- [Compiled examples](docs/bend2/examples/index.md): capability probes with commands and observed results.

## Working with this branch

[CONTRIBUTING.md](CONTRIBUTING.md) describes the repository workflow.
[AGENTS.md](AGENTS.md) defines its writing rules.
[SYSTEM.md](SYSTEM.md) describes the current Baton implementation.

Run the current implementation's verification from the repository root:

```sh
npm test --prefix impl
```

Language probes follow the [example convention](docs/bend2/examples/README.md).
Each records its toolchain, commands, output, and the scope of its conclusion.
