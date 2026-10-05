# Semantic context language modules

## Scope

The operator requires Bend2 as the first target for native code and debugging
context. Elixir, Rust, Go, Python and TypeScript are preferred modular targets
after Bend2. The implementation uses a language-independent native context
interface and language-specific providers.

This requirement supersedes the fixed language/provider scope and whole-feature
acceptance in specification `8a26bc3e7f9d5355b72f1291d95620b218b5c8e2`.
That specification remains a retained source and review reference. Its common
result, provenance, freshness, access, lifecycle and law requirements remain
applicable. Existing backend implementations remain candidates for individual
modules, with their actual qualification limits preserved.

## Common native integration

Keep the existing context discovery, query, result and reference-expansion
operations and their CLI/MCP parity. Task orientation presents capabilities for
the actual target project. Project configuration and enabled module declarations
identify applicable providers; selection records its inputs and chosen provider.
An explicit provider selector remains available through the same query.

Native validation covers the common request, subject identity, effects and result
contract. Provider selection uses the trusted modules declared by the installed
package and its existing configuration. A provider's own schema and negotiated
capabilities govern its language-specific options. An unavailable module returns
its actual cause and the native discovery or configuration operation that can
resolve it. No target effect starts before required admission succeeds.

The core must accept a new declared module without adding a language-specific
engine enumeration, filename switch, option profile or result parser to shared
code. Use the existing package manifest and execution/lifecycle boundaries for
module identity and ownership. The implementation spec must define the smallest
typed provider declaration and invocation contract needed by these callers.
An extension may add its normal Bend imports, composition declaration and
package payload. Shared validation, selection and result algorithms consume
those declarations. Each module's operative laws enter the composed build.

Modules normalize actual facts into the common source/runtime subjects,
relationships, diagnostics and evidence model. A fact identifies its producer,
source or runtime snapshot, applicable language semantics and limits. Supported
protocol capabilities and provider-specific extensions are explicit. Static
possibilities, runtime observations and compiler-checked properties keep their
distinct meanings. An absent fact is represented with its actual availability.

## Bend2 module

Bind analysis to the actual pinned Bend2 frontend, imports and examined source.
Use its parser, name resolution and checker outputs where they provide the
requested facts. Investigate and document the concrete compiler integration
before choosing its API. Preserve declaration order, linear-use semantics,
dependent types and operative law meaning in returned relationships.

The module must qualify useful definitions, resolved references and imports,
type/checker context and source-bound diagnostics. It must state which call,
control-flow, proof and runtime/debug facts the actual backend supports.
Compiler diagnostics retain their original output and location; enriched
relationships must have their own source or checker evidence. A claimed checked
law is bound to its real statement, proof, source and completed checker result.

Formal law verification remains a required compilation gate for Baton2 itself.
Analysis of a target Bend2 program returns context through ordinary native
queries. Compiler checks, builds and qualification execute on remote validation
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

## Acceptance

The revised specification receives independent domain and whole-feature review,
then root comparison against the feature document before affected shared
implementation is accepted. Existing compatible pure modules and repairs can
continue through their original owners while that review proceeds.

Qualify Bend2 first through actual installed CLI and MCP calls on real source,
with independent expectations for definitions, imports, checker diagnostics and
claimed types or relationships. Include positive, invalid and changed-source
subjects. Preserve full source, provider, toolchain and completed-process evidence.
Unavailable-only answers do not qualify the feature.

Then qualify the preferred language modules independently through the same
operations. A module extension must pass a meaningful test showing that shared
admission and result consumption work without editing core language cases.
Cross-language projects must keep exact source and producer attribution and
refuse unsupported joins truthfully. Effectful debugger/model operations require
the existing grants and lifecycle qualification.

Operative laws cover the real native selection, admission, normalization and
reference functions. Host/provider fixtures establish foreign facts. Whole-tree
law controls, native checks, safe landing and installed use remain acceptance
requirements on the exact composed source.
