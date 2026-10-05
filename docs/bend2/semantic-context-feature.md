# Native semantic context

## Purpose

Baton2 gives agents structured context about the external code, software, data
and environment they are working on. Agents obtain that context through normal
Baton2 operations. Agent experience means how easily an agent discovers, requests,
understands and uses those capabilities.

This document describes the intended feature. The implementation specification
defines the supported backends and qualifications.

## Capabilities

Code context resolves symbols, types, references, callers, dependencies, control
flow, exception paths and compiler diagnostics to the examined source.

Debug context exposes source-mapped stack frames, variable values, exceptions,
thread state and available runtime observations from supported debugging backends.

Data-model context exposes entities, relationships, constraints, migrations,
serialization and validation, with links to the code that reads or modifies data.

Security context exposes authentication and authorization predicates, privilege
requirements, trust boundaries and supported input paths to sensitive operations.
Analysis identifies its scope and distinguishes observed behavior, static
possibilities and checked properties.

Environment context exposes resolved dependencies, toolchain and build
configuration, applicable runtime configuration and available service facts that
affect the examined program. Automatic environment context excludes credential
values. Explicit source and runtime inspection has a stated access and output
policy; adapters receive no harness credential material.

General-purpose work can use structured context from supported documents,
datasets, files and service results. Code and runtime capabilities describe their
availability for the current subject.

## Language support

Bend2 is the first language target. Elixir, Rust, Go, Python and TypeScript are
preferred modular targets after Bend2. Language modules use the same native
query and result contracts. Project context and available module capabilities
determine the applicable analysis and debugging support.

Each module supplies language-specific facts and their evidence through a
common interface. Adding a language module preserves the shared query surface,
result relationships, provenance and access rules. Capability discovery states
which requested facts the selected module can actually provide.

## Native use

A task receives relevant context orientation through its existing native harness
briefing. An agent can request deeper context for a source location, symbol,
diagnostic, data entity or supported runtime subject through one consistent native
query interface. Existing command and MCP surfaces return the same result model.
Backend command sequences and protocol transcripts are handled by the integration.

For a request handler, a query can connect parameter types, resolved callees,
database accesses, authorization predicates and applicable diagnostics. For an
exception, a query can connect the source expression, stack, available values and
relevant environment facts. Returned relationships come from the selected
backend's actual analysis or observations.

Each result identifies its subject, examined source or runtime snapshot, facts,
relationships, evidence locations and limitations. Agents can expand referenced
details through the same native interface. Source changes make an earlier result's
applicability explicit.

## Integration and acceptance

Language, debugger, schema and environment adapters supply programmatic facts.
Baton2 resolves task context and presents those facts consistently. Existing task
execution, reports, files and reviewed findings retain their responsibilities.

Acceptance requires useful semantic relationships and diagnostic context on real
external subjects; source locations and values must be correct and inspectable.
Unavailable capabilities and incomplete analysis remain explicit. Native use must
work through the installed package and supported harnesses, with the operative
Bend laws and host-effect checks required by Baton2's existing build.
