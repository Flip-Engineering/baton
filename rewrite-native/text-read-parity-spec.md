# U1 Text.read backend parity: vector specification and repair proposals

Author: rewrite-native (GLM 5.3 Flash, omp harness). Baseline:
`review-muse/text-read-parity.md` at `2a48dbc`. Review criteria:
`review-muse/adversarial-review.md` (A2, B2, B4, E1-E6). Source pin:
`81880bc` (published integration tree), branch `rewrite-native`.

## E1 - original behavior with source references

Two implementations of one effect, attached by the dual import in
`bend2/src/host/text.bend` (`import "./text.c"` and
`import "./text-read.js"` inside `def Text.read`), the only `.bend` file
in `bend2/src` with a `.js` import:

- Native: `bend2/src/host/text.c` `baton_read_run` (lines 56-72) rejects
  a NUL path with `io_fail(e, EINVAL, "path contains NUL")` before any
  host call; `baton_read_call` opens `stdin` for `-`, otherwise
  `fopen`/`fread`; `baton_read_pack` reports `io_fail(e, error, NULL)`.
  With NULL text, the canonical `io_fail` falls back to
  `strerror(code)` (C template, `bend2/compiler/upstream/comp.ts:5765`):
  every failure carries `(positive errno, strerror(errno))`.
- Node: `bend2/src/host/text-read.js` reads
  `readFileSync(path === '-' ? 0 : path, 'utf8')`; on any exception it
  returns `io_tup(Math.abs(error.errno || 5) >>> 0, String(error.message))`.
  A missing errno becomes code 5; the message embeds the path.

Canonical reference pair for one effect on both backends:
`bend2/compiler/upstream/effs/file_read.c` (`io_fail(e, w->code, NULL)`)
and `file_read.js` (`io_fail(sys.errno())`, `io_text` decoder). The
lowering `eff_name` (`comp.ts:1247`) turns `Text.read` into `text_read`,
which is the hook the dual-import question turns on.

Success semantics are already identical by construction: the C `io_str`
(`comp.ts:5709-5712`) decodes UTF-8 with WHATWG replacement rules and
keeps a leading BOM; Node's `utf8` decoding applies the same rules.
`io_text` (`comp.ts:6516`) is the same decoder expressed as a runtime
helper (`TextDecoder("utf-8", { ignoreBOM: true })`).

## The mapping (one contract, two backends)

Failure carries `(code: U32, message: String)`; the code is the positive
errno on both backends; the message is backend detail (B4: opaque).

- Native: code = errno from `fopen`/`fread`/`fclose`; message =
  `strerror(code)`.
- Node: code = `Math.abs(error.errno)` (Node negates syscall codes);
  a failure with no errno is refused EINVAL 22, the canonical
  program-shaped refusal (`tcp_connect.js:10` uses `io_fail(22)`);
  message = Node's `error.message`, unmatched by callers.

Named remaining divergence (E2): the Node half observes `node:fs` error
objects, not the `BEND_SYS` syscall layer the canonical pair uses
(`file_read.js` reads `sys.errno()`). The bridge is at the error object
and introduces no third code source.

## The seven vectors

Harnesses assert the exact code for failures and the exact value for
successes; they never compare messages (B4 opacity, enforced by the
harness itself dropping the message).

| # | Input | Native | Node | Today |
|---|-------|--------|------|-------|
| 1 | absent file | fail 2 | fail 2 | agree |
| 2 | directory as path | fail 21 | fail 21 | agree |
| 3 | NUL in path (`"cases/nul\0"`) | fail 22 ("path contains NUL") | fail 5 (TypeError, no errno) | **fails** |
| 4 | invalid UTF-8 `41 C0 AF E2 82` | ok `"A\uFFFD\uFFFD\uFFFD"` | ok `"A\uFFFD\uFFFD\uFFFD"` | see note |
| 5 | `-` with payload `caf\u00e9 \u03bb\n` on stdin | ok, exact bytes | ok, exact bytes | agree |
| 6 | empty file | ok `""` | ok `""` | agree |
| 7 | chmod 000, non-root | fail 13 | fail 13 | agree |

Vector 4 note (E6, claim kept separate from checks): the parity spec
says the JS side throws. Per source, `readFileSync(..., 'utf8')` decodes
by Node's WHATWG rules and does not throw on content; both backends
should already return `"A\uFFFD\uFFFD\uFFFD"` (C0 invalid lead, AF
orphan continuation, E2 82 truncated at EOF - one U+FFFD each). The
vector locks the agreement; execution evidence is gated below. If the
reviewer's observation came from a different backend path, the vector
will expose it.

Vector 7 runner caveat: as root both backends succeed reading a 000
file; the harness skips the vector when `euid == 0` (vector 2 already
covers a root-proof refusal).

## Repairs (proposals; implementation after spec review)

- Vector 3: `text-read.js` checks `path.indexOf('\0') !== -1` before any
  host call and returns `io_tup(22, 'path contains NUL')`. This
  transplants the C refusal (`baton_read_run`) verbatim; it is not a new
  mapping.
- Vector 4: `text-read.js` reads bytes (`readFileSync` without an
  encoding argument) and decodes with the canonical `io_text` runtime
  helper, exactly the `file_read.js` pack decoder, replacing reliance on
  `readFileSync`'s built-in decode. Failure path untouched.

## Law (one, in `bend2/src/host/laws.bend`; no coordinator law changes)

```bend
# A Text.read failure carries the positive errno as its code on both
# backends; the message is backend detail and no caller may branch on it.
def text_read_code(result: Result<&1,&1,U32 & String,String>) -> U32:
  match result:
    case Fail{(code, message)}: code
    case Done{value}: 0

law text_read_backends_agree_on_code_and_messages_stay_opaque:
  for +code: U32
  for +native_message: String
  for +node_message: String
  {text_read_code(Fail{(code, native_message)}) ==
   text_read_code(Fail{(code, node_message)}) : Bool}

def text_read_backends_agree_on_code_and_messages_stay_opaque(code, native_message, node_message):
  {==}
```

Compile risk flagged: unused pattern bindings (`message`, `value`) are
unproven against the Bend2 checker; if rejected, the repair is mechanical
and stays within this one law.

## Executable checks (authored at implementation, execution gated)

- `bend2/test/text-read.test.mjs` (Node backend): loads the shipped
  `text-read.js` source with `new Function`, supplying the runtime
  helpers verbatim from `comp.ts` (`io_tup`, `io_done`, `io_text`) and
  `createRequire`; vectors 1-4, 6-7 against temp fixtures; vector 5 in a
  child process with the payload piped to stdin.
- `bend2/test/text-read.bend` (native backend, `control-output.bend`
  style): seven fixed `Text.read` calls - the NUL name constructed as
  `"cases/nul" ++ SCon{Char.from_u32(0), SNil{}}`, vector 5 reading `-` -
  appending `ok:<value>` / `fail:<code>` lines to `results`, message
  dropped at the harness. Driver `bend2/test/text-read.py` prepares
  fixtures, pipes the payload, compares exact expected lines with
  independent (hardcoded) expectations. Registration in
  `bend2/scripts/check-native.sh` belongs to the drivers rewrite;
  coordinated at landing, not edited unilaterally.

## Gates (E5)

1. Compiler-track confirmation of dual-import resolution semantics
   (question sent to rewrite-compiler; landing blocked, authoring not).
2. C-cap remote execution admission for both harnesses; no local builds
   or tests. Implementation commits follow this spec's review.
