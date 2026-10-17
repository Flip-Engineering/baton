# Semantic context language modules

## Scope

The operator requires Bend2 as the first target for native code and debugging
context. Elixir, Rust, Go, Python and TypeScript are preferred modular targets
after Bend2. The implementation uses a language-independent native context
interface and language-specific providers.

This requirement supersedes the fixed language/provider scope and whole-feature
acceptance in specification `8a26bc3e7f9d5355b72f1291d95620b218b5c8e2`.
That specification remains a retained source and review reference. Its common
result, provenance and lifecycle descriptions provide historical context.
Individual module implementations report their actual capabilities and tested
limits.

## Common native integration

Keep the existing context discovery, query, result and reference-expansion
operations and their CLI/MCP parity. Task orientation presents capabilities for
the actual target project. Project configuration and enabled module declarations
identify applicable providers; selection records its inputs and chosen provider.
An explicit provider selector remains available through the same query.

`context-engines` and the corresponding MCP discovery operation return installed
modules with their declared `tools`. Each tool includes its operation,
projections, effects, provider-authored option schema and example native request.
Module declarations provide `optionsJsonSchema` and `requestExample` on each
operation; discovery exposes these as `optionsSchema` and `requestExample`.
An omitted schema or example is returned as `null`. Session discovery also
includes the recorded workspace and project module settings. Set an example's
`cwd` to that workspace and submit it through `context-query-file` or MCP.

## Project detection and loading

Baton2 automatically detects applicable modules from project manifests,
configuration and examined source. Selection covers the requested subject and
the related facts needed to answer the query. Mixed-language projects can
activate several modules. Explicit project configuration can resolve ambiguous
detection through the same native operations. Detection reads target inputs
under existing access rules; execution and package effects require admission.

Lightweight trusted module descriptions provide recognition rules, capabilities,
package identity and dependency requirements. Discovery reads this metadata
without importing provider implementations or starting their tools. It reports
applicability, installation and readiness separately. Project detection and
module selection record their actual inputs and source identity.

Provider implementations and language-specific compiler, language-server,
debugger and framework dependencies are separately packaged. The baseline
installation contains the common native runtime and the small discovery
metadata needed for supported modules. A project's selected modules load their
required dependency closure through existing package and lifecycle ownership.
Ordinary context use resolves admitted available modules automatically; missing
dependencies have a concrete native resolution path. Module retrieval and
installation follow existing package authority and integrity requirements.

Unused languages require no installed provider payloads, loaded implementation
libraries, dependency probes or running helpers for that project. A provider
already present for another project may remain on disk; its lifecycle retains
that project's ownership. Changes to project inputs update applicability and
reference freshness through the existing context rules. Activation shares
compatible owned resources and preserves other projects' active work.

## Module contracts

Native validation covers the common request, subject identity, effects and result
contract. Provider selection uses the trusted modules declared by the installed
package and its existing configuration. A provider's own schema and negotiated
capabilities govern its language-specific options. An unavailable module returns
its actual cause and the native discovery or configuration operation that can
resolve it. No target effect starts before required admission succeeds.

The core must accept a new declared module without adding a language-specific
engine enumeration, filename switch, option profile or result parser to shared
code. Use the existing package manifest and execution/lifecycle boundaries for
module identity and ownership. The typed provider declaration and invocation
contract describe the fields these callers consume.
A module build adds its normal Bend imports, typed declaration and package
payload. Shared validation, selection and result algorithms consume the common
declarations. Module composition must preserve separate installation and
activation. Module documentation states the actual load boundary;
importing every provider into the baseline executable violates this requirement.
The common runtime reads declarations, selects providers and constructs their
invocations. Existing provider and installed-package tests exercise those paths.

Modules normalize actual facts into the common source/runtime subjects,
relationships, diagnostics and evidence model. A fact identifies its producer,
source or runtime snapshot, applicable language semantics and limits. Supported
protocol capabilities and provider-specific extensions are explicit. Static
possibilities, runtime observations and compiler-checked properties keep their
distinct meanings. An absent fact is represented with its actual availability.

## Bend2 module

Bind analysis to the actual pinned Bend2 frontend, imports and examined source.
Use its parser, name resolution and checker outputs where they provide the
requested facts. Document the compiler interface the module uses. Preserve
declaration order, linear-use semantics,
dependent types and operative law meaning in returned relationships.

The module must qualify useful definitions, resolved references and imports,
type/checker context and source-bound diagnostics. It must state which call,
control-flow, proof and runtime/debug facts the actual backend supports.
Compiler diagnostics retain their original output and location; enriched
relationships identify the source or checker result that produced them. A
reported law result includes the statement and actual checker outcome.

Analysis of a target Bend2 program returns context through ordinary native
queries. Compiler checks, builds and existing tests execute on remote validation
runners. The operator's laptop hosts orchestration, edits and evidence review.

## Additional modules

Elixir, Rust, Go, Python and TypeScript modules extend the same boundary.
Language servers, compiler APIs, debugger protocols and framework-aware analyzers
are provider mechanisms chosen for actual useful facts. Each module declares
its dependencies, schema, capabilities, provenance and required effects.
Framework and data/security relationships use resolved program semantics and
actual target configuration. Context for an Elixir/Phoenix or Ash application
must preserve its applicable code, framework and data-model relationships.

The specification must keep language support extensible beyond these preferred
targets. Existing C/C++ and CDP work can be retained as optional modules whose
qualification does not establish Bend2 support or whole-feature completion.

## Build, package and installed use

Remote builds check the common runtime and selected module sources. Existing
provider and installed-package tests exercise useful requests, returned facts,
diagnostics, references and query lifecycle. Completed runs retain their source,
provider and toolchain versions, full output and process results.

Package staging copies each selected module's declared files and dependencies
into the installed payload. Discovery reads its declaration. Ordinary installed
CLI and MCP calls use the recorded project workspace and submit the provider's
request through the common native interface. Their retained query results show
the actual provider output or failure.

Module delivery includes the useful existing fixtures affected by a change.
Installed use checks discovery, selected dependencies and the returned source
or runtime facts. Cross-language results name their actual producers and report
unsupported relationships. Source publication, completed remote checks, package
installation and actual installed calls each have their own recorded outcome.
