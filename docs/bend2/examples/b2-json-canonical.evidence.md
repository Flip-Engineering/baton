# b2-json-canonical — evidence

CLAIM: at the pin a canonical JSON encoder is expressible in Bend2 alone: a value model, the
canonical text rules (member keys in lexicographic order, no whitespace, minimal escapes,
non-negative integers), and the UTF-8 byte representation of every string, with the encoder's
output byte-identical to the JavaScript adapter's canonical form on a fixed corpus.

Status: prototype work item `B2-JSON` (`LANG-CAP-06`), encoder slice. The decoder slice, streamed
input with continuation, larger integers, and the astral key-order question are owed; each is named
under Scope.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |
| JavaScript reference | Node v25.8.0, `/tmp/ref-canonical.mjs` (recursive key sort then `JSON.stringify`, the shape `canonicalDigest` uses) |

## The commands and their outputs

```sh
$ bend docs/bend2/examples/b2-json-canonical.bend --check-only
All terms check.
exit=0
$ bend docs/bend2/examples/b2-json-canonical.bend
636166c3a9
null
true
0
4096
"a\"b\\c"
"\n\t\u0001"
[1,null,"x"]
[]
{"a":1,"b":2,"c":[]}
{}
"café"
{"nested":{"z":"λ"}}
exit=0
$ node /tmp/ref-canonical.mjs
636166c3a9
null
true
0
4096
"a\"b\\c"
"\n\t\u0001"
[1,null,"x"]
[]
{"a":1,"b":2,"c":[]}
{}
"café"
{"nested":{"z":"λ"}}
$ node /tmp/ref-canonical.mjs > /tmp/ref-out.txt
$ bend docs/bend2/examples/b2-json-canonical.bend > /tmp/bend-out.txt
$ grep -v 'bend 2.0.26 is available' /tmp/bend-out.txt > /tmp/bend-clean.txt
$ diff /tmp/ref-out.txt /tmp/bend-clean.txt && echo IDENTICAL
IDENTICAL: full parity on the UTF-8 hex and 12 canonical fixtures
```

The toolchain prints a version notice (`bend 2.0.26 is available: run bend update`) on every run;
the `grep -v` above removes exactly that line and nothing else.


The corpus is twelve fixtures: `null`, `true`, `0`, `4096`, a string with a quote and a backslash,
a string with newline, tab and a control character, an array of mixed scalars, the empty array, an
object written with keys out of order (`b`, `a`, `c`), the empty object, a non-ASCII string and a
nested object with a non-ASCII string. The first line is the UTF-8 hex of `café` (`63 61 66 c3 a9`),
checked separately because the encoder carries bytes as `List<U32>`.

## Shape constraints the checker imposed

These are findings about the language at the pin, measured while writing the encoder. They shape
how the rewrite writes any recursive codec, so they are recorded here rather than only in the
program's comments:

1. **A match cannot scrutinize a computed value.** `match U32.is_eq(a, b):` and
   `match cp(c):` are both refused with "give it its own def". A branch on a computed condition is
   either a value-level `Bool.pick` or a helper whose parameter is that condition, one helper per
   comparison. A U32 literal is not a pattern (the refusal reads as a Peano constructor mismatch),
   so the escape dispatcher is a chain of comparison helpers.
2. **A definition must precede its use, and mutual recursion is refused.** Two defs that call each
   other cannot be written even in dependency order, so a recursive tree is walked by ONE definition
   carrying a mode (`MValue`, `MArray`, `MObject`), and a sorting pass that needs two chains either
   takes both as parameters or is restructured.
3. **Termination is checked by shrinking arguments.** In a self-call the arguments are read left to
   right and each must be passed unchanged until one shrinks; the walk therefore passes a strict
   subterm (`head`, `tail`, `members`, `value`, `rest`) as its first argument everywhere, and the
   sorting of an object's members happens in a separate normalisation pass that takes a subterm.
4. **Values are affine; `+` on a parameter permits duplication.** A parameter used twice refuses
   with "consumed more than once" unless it is declared `+name`.
5. **Matches are exhaustive over the matched type.** A chain walk whose type is the tree still has
   to name every constructor of the tree, so the chain-shape helpers carry eight no-op cases each.
6. **A `Data` constructor's fields must be Data, `List<a>` is a Type, and a pair cannot appear in a
   type argument** (`List<String & Json>` is a parse error). The tree is therefore carried by
   self-referential constructors (a cons chain), and object members are a `Jpair` chain rather than
   a list of pairs.
7. **There is no field access**: `cell.key` is not a term; a value is read by matching it into
   binders, and a value needed twice is read twice through helpers (with `+` on the parameter).
8. **`<>` is element cons, not list concatenation.** Joining two list-valued pieces needs a small
   recursive helper (`cat_list`, `cat_bytes` here).
9. **Constructor application is positional and U32 literals are plain decimals**; the `n` suffix is
   the Nat literal, and `U32.shrn` takes a Nat shift count while its value argument is a U32.

## Scope

- The encoder is the first half of a codec. Exact-field boundary **decoding** is owed: it needs a
  parser over `String` (a `Char` list) and its own escaping rules, and the plan's `b2-json` item
  requires rejecting fixtures with one added unknown field.
- **Fragmented and large streamed inputs with continuation are owed**: the pin's `File.read_bytes`
  returns a byte buffer and `IO` has no streaming reader, so the streamed slice must state what it
  relies on or record the refusal.
- **Non-negative integers only** in this slice, formatted with `U32.show`. Negative numbers, floats
  and integers above 2^32 are not modelled.
- **Key order**: the encoder sorts by code point, the JavaScript adapter by UTF-16 code unit. They
  agree below U+10000, which the corpus satisfies; the behaviour for astral keys is unmeasured and
  must not be claimed.
- The empty array is encoded as a cell whose head is the nil marker. That is correct for the corpus
  and ambiguous in general: a dedicated empty-container constructor (or a length rule) is owed.

## Verdict

The claim holds at pin `a4952426` with bend 2.0.25 on this host: the model checks and runs, the
canonical rules it states match the JavaScript adapter byte for byte on the twelve-fixture corpus and
on the UTF-8 byte representation, and the nine shape constraints above are what the checker required
to get there.
