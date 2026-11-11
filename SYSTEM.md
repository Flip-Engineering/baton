# Baton2 system

The [Bend2 architecture](docs/bend2/architecture.md) defines the coordinator,
native harness sessions, retained messages, knowledge and Git landing.
Development uses `bend2-rewrite`.

The coordinator entry imports
[`bend2/src/coordinator/laws.bend`](bend2/src/coordinator/laws.bend). Its laws
state invariants over the implementation functions. Compilation verifies their
proofs; native tests exercise host effects.
[Contributing](CONTRIBUTING.md) describes the complete acceptance gates.

The [command guide](bend2/README.md) describes the public interface,
[terminology](docs/bend2/terminology.md) defines responsibilities and groups, and
[readiness](docs/bend2/readiness.md) records measured capabilities and release
requirements.

The [original system design](https://github.com/Flip-Engineering/baton/blob/f85647ccd6990d19b0aabdb2c834cab203d9b91d/SYSTEM.md)
remains available at its recorded historical revision.
