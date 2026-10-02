# Baton2

Baton2 coordinates coding agents in a parent hierarchy. Orchestrators recruit workers,
send tasks and guidance, receive retained reports, review committed changes, run checked
landings, and publish to an explicitly selected Git remote. Agents can record findings
with evidence and promote them into a shared scope for other agents to retrieve.

The coordinator and Git operations compile from Bend2 into a native executable with C
bindings for SQLite and operating-system services. Claude Code, Codex, OMP and Muse run
through their native harnesses. The [implemented architecture](docs/bend2/architecture.md)
describes their process ownership, report delivery and recovery.

Baton2 is in development on `bend2-rewrite`. The
[readiness record](docs/bend2/readiness.md) distinguishes verified capabilities, observed
failures and the work required before release.

## Build and use

Build with Bend 2.0.25, clang and SQLite development headers:

```sh
sh bend2/scripts/build-native.sh
.scratch/bend2/baton2 state.db status
```

Set `BEND` to an installed compiler path when it is outside `.bend/bin/bend` or
`node_modules/.bend/bin/bend`. The [native command guide](bend2/README.md) covers
recruitment, harness configuration, messages, knowledge, review and Git operations.

Conductors direct subordinate Players. Peer messages require membership in an
explicitly designated tight Ensemble; Conductor peers also share a hierarchy depth.
The [messaging contract](docs/bend2/messaging.md) defines the permitted routes and retries.

## Verification

The coordinator entry imports operative laws over the real implementation functions.
Compiling the coordinator entry verifies their proofs. The negative control also removes proofs
and changes implementations to verify that the compiler rejects those changes.

```sh
node bend2/scripts/laws-check.mjs
sh bend2/scripts/check-native.sh
```

The native checks exercise storage, actual subprocesses, harness protocols, recovery,
messages, knowledge and Git operations. Published run records state the source pins,
host conditions and limits of each measurement.

## Design and evidence

- [Implemented architecture](docs/bend2/architecture.md): ownership, commands and recovery.
- [Shared knowledge](docs/bend2/knowledge-context-2026-09-29.md): evidence, scope and promotion.
- [Naming legend](docs/bend2/terminology.md): agent roles and coordinated groups.
- [Approved laws](docs/bend2/laws-proposed.md) and [authorization](docs/bend2/authorization.md): the development contract.
- [Language reference](docs/bend2/reference/README.md): pinned compiler and runtime.
- [Historical migration review](docs/bend2/go-no-go.md): the earlier prototype decision and its evidence.

[CONTRIBUTING.md](CONTRIBUTING.md) describes repository development.
[AGENTS.md](AGENTS.md) defines the writing rules. The retained JavaScript implementation
and its verification instructions are described in [SYSTEM.md](SYSTEM.md).
