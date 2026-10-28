# Module C emission prototype

This implementation is an unfinished prototype. It retains whole-program
front-end checking and module snapshots and has not been qualified for release.
PR #1189 defines the checked-program store and per-unit isolation required for
the next implementation. The compiler pin still selects the #1186 release;
the #1188 type-sharing repair must be integrated before this compiler is used.

The compiler CLI checks the loaded book, prepares its runtime source graph,
and writes one input snapshot for each module that owns runtime definitions.
`modules.ts` generates C units in separate Bun processes. The coordinator links
their symbolic references and streams the requested C file. The synchronous
`Comp.compile_book` API remains available for callers that already hold a
checked book.

## Inputs and ownership

The loader records the file that supplied each declaration. A definition that
fills an imported law belongs to its implementation file. Generated template
instances inherit their definition's file or namespace.

A snapshot contains local checked bodies, imported signatures, constructor
telescopes and the parsed bodies required for type reduction. Imported runtime
bodies are absent. Local call-site counts determine inlining within the unit.
Calls across module boundaries use the existing segment argument and return
layouts. This can introduce continuations at calls that the whole-book emitter
inlines.

Snapshots encode terms and layouts as shared graph nodes. Source strings occur
once in each message. Source spans remain available for compiler diagnostics
and arm sharing. The cache fingerprint excludes spans and includes the module's
source bytes, foreign C inputs, signature closure and compiler implementation.

The coordinator releases checked bodies, constructor tables and compiler memo
tables after writing the snapshots. Each worker writes a definition's C before
releasing its temporary emission state. The worker retains the module's input
and output metadata through its process exit.

## Facts and references

The coordinator starts with `main` and bang targets. A worker follows references
to local definitions and returns references to imported definitions. The next
round requests the imported entries. Closure construction records its target
in the same reference graph.

Workers record external ownership, sharing and static-fact reads and return
the facts and lending relations they produce. The coordinator closes lending
after the referenced definitions have emitted. A newly added fact invalidates
units whose recorded read changes. Rounds continue until the referenced entries
exist and each unit's fact reads agree with the current facts.

Foreign names retain the loader's local-name mapping through snapshot creation,
worker emission and linking. Definition identities used by the coordinator are
fixed before checker state is released.

## Cache and C linking

The default cache is `~/.cache/bend/modules`. A source and interface hash selects
a module directory. Requested entries and observed fact values select the C
variant. The C payload has its own content hash. Complete metadata is published
after the worker exits successfully. Execution records retain worker arguments,
source identity, output, exit code and signal.

Each module C file contains image data, local tables, native functions and
segments. Metadata records their byte ranges and symbolic references. The linker
selects reachable entries, assigns constructor and function IDs, assigns static
image offsets, and reads the selected ranges into the final C stream. Foreign
C text is read during this link with its namespace mappings.

An unchanged build reuses C variants throughout convergence. A source edit
rebuilds the affected module and units whose imported interface or fact reads
change. The existing native build consumes the linked C output. Source loading,
checking and initial runtime-graph preparation still execute in the coordinator.
