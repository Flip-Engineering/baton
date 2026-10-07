# Retained verbatim review 69ae6831..7673645a, 2026-10-06

Read-only review of five root commits in
`/Users/wahargis/Development/Experiments/baton-integration-20261006`
(HEAD `7673645a`). No source edits, no builds, no candidate output
bytes read. Runtime qualification is pending on root's runs; this
review declares no runtime qualified.

## Verbatim contract (`273a5257`)

`json_or_null` now quotes the document directly instead of passing it
through SQLite `json()`, so retained text keeps original bytes,
escapes, and order under the schema `json_valid` checks; the law
tracks the implementation. `ref_first_entry` reads the element through
the new `baton_ref_entry(document, index)` with the integer array key
from `json_each`, replacing the normalized `entry.value`.

The C function validates before slicing: `json_valid` on the bound
value, then a length check that rejects NUL-truncated text, then the
hand scan. The escaped refs key is compared by parsing the key text
through SQLite itself, so `\u0066` resolves without C escape logic.
`value_end` skips strings with escape awareness, balances containers
with string exclusion, and terminates scalars at `,`/`}`/`]`; the
added `]` terminator fixes element slicing inside arrays. Statement
ownership is closed on every path: prepare failure returns without a
finalize on a NULL handle, the loop exit finalizes, bindings use
transient copies with per-iteration reset, negative or overrun indexes
yield NULL. Registration happens per connection in the bound-call path
with error propagation. No hunk alters duplicate-entry checks; the
duplicate refusal paths in decoders and laws are untouched.

## Escaped refs fixtures (`7673645a`)

Three live-SQL cases trace cleanly: an escaped `\u0066` key resolving
to `refs` with a nested `a}b` value slicing verbatim whitespace and
braces; a later mixed-type element walk to `{"id":"later"}`; an empty
array returning NULL. Expected hex uses the uppercase SQLite
convention. Query count 7 follows from q1/q2/q3 plus accepted
cq1/cq2/cq3/cq5; cq4 carries the foreign owner and leaves no row.

## Marker law and classifiers (`74bbdb4e`, `690933d1`)

`admit_mark_sql` extraction is text-identical, and the new exact
rendering law covers a marker that previously had none. The lifecycle
mutation payload tracks the current admission expression. Proof
removal deletes exactly one proof (target definition unique) and
asserts the `Error: 1 TODO found.` diagnostic the compiler emits with
no law location. The lifecycle mutation classifier now uses exact
`Location` matching, mirroring the codec lane. The renamed duties
record law exists in `laws.bend`.

## Shared query (`39782324`)

Single linearity marker; no semantics.

## Native evidence and discipline

Reviewed commits: `74bbdb4e`, `273a5257`, `690933d1`, `39782324`,
`7673645a`. Admitted oracle paths unchanged and still match current
mains. Root owns the running lifecycle job at `7673645a`; nothing
was launched or duplicated from this lane. Prior history
(`d4129e49`, `b1e36b90`, `eee67dfd`, `dfc693dd`) is preserved; this
report is the only new commit.
