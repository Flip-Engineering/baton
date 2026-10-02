# Bend2 design

[MANDATE.md](MANDATE.md) states the current rewrite goal.
[Target architecture](target-architecture.md) describes the parts and data.
[Rewrite plan](rewrite-plan.md) names the requested seats and first working slice.

The coordinator entry imports its operative law modules. Every native build checks
the proofs over the called functions. [Law trace](laws-trace.md) identifies those
functions and their host assumptions; `bend2/scripts/laws-check.mjs` checks proof
removal and implementation mutations. Native tests and real runs measure host effects.

[Shared findings](knowledge-context-2026-09-29.md) describes recording, retrieval,
promotion and destination-owner notification.
[Knowledge acceptance](knowledge-context-2026-10-01.md) records their real use.
[Hierarchy checker repair](hierarchy-checker-2026-10-01.md) records a reviewed
worker landing, native promotion notice and failed Muse launch.
[Coordinator comparison](coordinator-comparison-2026-10-01.md) measures the
current original and rewritten coordination operations.
[Stored status comparison](coordinator-status-comparison-2026-10-01.md) measures
session metadata and pending counts alongside the existing worker roster.

Historical reviews and language experiments remain reference material. The current
mandate and operative implementation determine the work.
[reference/README.md](reference/README.md) identifies the vendored Bend toolchain
and language reference. [language-review.md](language-review.md) and
[examples/](examples/) contain capability experiments that can help implementation.
