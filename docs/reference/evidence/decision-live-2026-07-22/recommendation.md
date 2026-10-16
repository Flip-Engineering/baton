framing: detailed

We recommend the sister project adopt baton's REPL layer (docs/33), but with eyes open that it
is design groundwork, not shipped infrastructure — REPL-1..3 ship red-first, one
`impl/test/replN-*-red.test.mjs` suite per issue, before any implementation wave. The core value
is a read-eval-print loop over closed, content-addressed objects rather than an arbitrary-code
REPL (a permanent constraint the design explicitly preserves, spec/phase93-closed-program-ir.md
§93.1(1)): cells are immutable JSON up to 64MB computed through the closed Bench (14 pure ops +
4 predicates) and cited by digest. REPL-1's `ReplManifest` gives a Workflow-free manifest shape
with its own admission authority (`repl.manifest_admitted`, disjoint digest basis
`baton.repl_manifest`), so orchestration doesn't need a live Workflow dispatch just to compute
context objects. REPL-2's named bindings — `repl.binding_set`/`repl.binding_dropped`, scoped to
`shared` or `worker:<workerId>`, each with its own replay-derivable `bindingFence` and
version-pinned citation grammar (`repl:<scope>:<name>@<version>`) — replace N hand-assembled,
duplicated packages with one bind-once, read-by-name object every wave member can cite. REPL-3's
`cell:` branch refs (resolved once at manifest admission, never inside the pure evaluator) enable
multi-step composition — e.g., a partition cell feeding per-partition summary cells feeding a
collect cell — with every step replay-exact and citable from boards, packages, and decision
requests. For a sister project already running wave-style orchestration, the practical payoff is
concrete: replacing whole-body context injection into every brief with sliced, named, cached
reads, and letting workers promote their own intermediates into shared scope with a single
rebind instead of a hand-rolled hand-off channel — but adoption should wait for the fold-surface
guarantees (event-kind inventory test, run-stop write guard, checkpoint field-set migration
discipline) to land, since those are what keep the object layer replay-safe under real failure
and restart conditions.
