# Codec oracle independent review, 2026-10-06

Lane: `integration-codec-oracle-muse-20261006`. Role: independent
oracle/fixture reviewer for the codec lane. The collector
(`bend2/test/context-codec.py`) is owned by
`integration-codec-fix-deepseek-20261006`; `bend2/scripts/check-native.sh`
is owned by root. This note and the approvals recorded in it are the
oracle-review lane output.

## 1. Method and blindness record

No compiler, build, or test ran on the orchestration host. No candidate
output file was read at any point: every retained `*.candidate.txt` on the
validation runner is 0 bytes (section 2), and no proposal below copies one.
Expected values come from fixture input bytes, the specified protocol
semantics in `docs/bend2/semantic-context-spec.md`, and same-tree
law/printer consistency checks that are labeled as such. A same-tree check
detects drift between two artifacts of one tree; it is not independence
from the implementation. Independent means the reviewer is not the
component author and the value is derived without executing the component.

Sources read: `bend2/test/context-codec.py` (HEAD version),
`bend2/src/context/` lane modules, `docs/bend2/semantic-context-spec.md`,
composition commits `63f909c0`, `eef90bcf`, `23b67635`, `7f31dd30`,
`e8a5329e`, the retained root-job evidence at
`/home/atari2036/baton-integrate-recovered-20261006/evidence/` on host
`acp-compute-cluster-001` (read-only), and the lane task messages in the
run database.

## 2. State correction: the retained evidence shows exit 1, not exit 2

The coordination record characterizes the collector as exiting 2
(unqualified: oracles missing). The retained root-job evidence for source
`f2301ff2` shows another state. `evidence/codec/` at the run:

- `candidate-context-codec.exit.json`: `"exit": 1`,
  `"qualification": "failed"`, with failures
  `"--check-only failed for contracts.bend"`,
  `"--check-only failed for request.bend"`,
  `"--check-only failed for operations.bend"`,
  `"--check-only failed for codec.bend"`,
  `"the contracts.bend entry did not exit 0"`,
  `"contracts.bend output differs from its proposed oracle"`,
  `"the operations.bend entry did not exit 0"`,
  `"the codec.bend entry did not exit 0"`.
- Every retained `*.candidate.txt` is 0 bytes. Every retained
  interpreted `*.stdout` is 0 bytes. There is no candidate output to
  bless, and no oracle comparison ran against real output.
- `candidate-context-lifecycle.exit.json` is also exit 1.

`git diff f2301ff2 fb903719 -- bend2/src/context/
bend2/test/context-codec.py` is empty, so this evidence describes the
current integration HEAD exactly. Exit 2 (missing oracles as the governing
gap) is the expected state after the source repairs in section 3, not the
observed state. The missing-oracle work in sections 6-7 still applies, in
that order.

## 3. Blocking source defects

Two source defects fail compilation before any oracle question is reached.
Both are outside this lane's ownership; they are recorded here with the
retained diagnostics so the owning lanes can repair them.

Defect A: `bend2/src/context/contracts.bend:288` calls
`signed_safe_token_ok`, defined at line 400. Line 288 is the only
use-before-definition in the file (remaining uses are at lines 681+).
The retained `check-contracts.stderr`:

```text
Error:
- expected : a defined name
- observed : signed_safe_token_ok
Context:
- token : String
Location: frame_id_ok
287 |     case IdText{value}: True{}
288>|     case IdNumber{token}: signed_safe_token_ok(token)
```

This one error fails `--check-only` for contracts, request, operations,
and codec (all import contracts), fails the contracts/operations/codec
interpreted entries, and fails the lifecycle entry (it imports contracts).
`raw-fixture.bend` passes because its closure does not reach contracts.

Defect B: `bend2/src/context/runtime/cdp-runtime.bend:48` uses a `//`
comment; Bend comments use `#`. The retained `check-codec.stderr`:

```text
Error:
- expected : 'def', 'type' or 'law'
- observed : '/'
Location:
47 |
48>| // Target liveness: whether the owned child is believed alive, exited, or unobserved. This
```

The closure reaches it as
`codec.bend` (imports `snapshot.bend`) -> `snapshot.bend:24`
(imports `./runtime/cdp-runtime.bend`). Any entry whose closure reaches
snapshot fails the same way.

## 4. Module list review against the 63f909 composition

`63f909c0` composes lifecycle submission wiring (`service.bend`,
`laws.bend`; codec, core, and runtime unchanged). It adds no codec-lane
module, so no codec CHECK list change follows from it. The lifecycle
wiring is qualified by `bend2/test/context-lifecycle.py`, not by the codec
collector. Correct separation; `service.bend` and `laws.bend` do not
belong in the codec lane lists.

Lane reality at HEAD (verified by `^def main` scan and import graph):

| Module | Declares main | Imported as library by | Old CHECK | Old ENTRY | Assessment |
|---|---|---|---|---|---|
| `contracts.bend` | yes | request, operations, codec, schema, wire, convert, bound-admission, admission, laws, progress, `tests/context-lifecycle.bend` | yes | yes | library with demo main; carried oracle (section 6) |
| `request.bend` | no | operations, codec, wire, convert, store | yes | no (correct) | pure library; compile-only qualification |
| `operations.bend` | yes | codec (`Ops`) | yes | yes | library with demo main (section 7) |
| `codec.bend` | yes | schema, wire, convert (`Codec`) | yes | yes | library with demo main (section 7) |
| `raw-fixture.bend` | yes | none (native-built) | yes | no (built natively; correct) | true native entry; byte corpus (section 5) |
| `codec-schema.bend` | no | (mutated by payload) | no | n/a | library; the 7 `schema-*` mutation records target it, so compiling it is required |
| `codec-wire.bend` | no | convert | no | n/a | library in the lane closure |
| `codec-convert.bend` | no | none yet | no | n/a | library in the lane closure |
| `raw.bend` / `raw.c` | n/a (host pair) | raw-fixture | no | n/a | the reader; decision order pinned in `raw.c:6-8` |

The old `EXTRA_MODULES = [engines, snapshot, refs]` hashes 3 of many
transitive dependencies and misses schema/wire/convert entirely. The
deepseek collector revision (LANE_MODULES plus import-closure hashing,
declared-entry cross-check, mutation negative control) moves in the
reviewed-correct direction; collector edits stay in that lane. One
consequence of the closure: defect B above enters through snapshot, so
the lane cannot green-gate codec until the runtime comment is repaired
by its owner.

The old ENTRY set exactly matches the modules declaring main
(contracts, operations, codec, raw-fixture with raw-fixture built
natively). No composition change adds or removes an entry.

## 5. Raw byte corpus: approved

The 15 `RAW_CASES` plus the stdin case carry literal input-derived
expectations. Each was recomputed from its input bytes against RFC 3629,
the `raw.c` validator (`baton_raw_utf8_bad`), and the pinned decision
order in `raw.c:6-8` (leading BOM, then UTF-8 validity, then decoded
NUL). All 16 agree:

| Input | Expectation | Ground |
|---|---|---|
| `{"version":1}` | `text 123 34 118 101 114 115 105 111 110 34 58 49 125` | code points of the ASCII bytes |
| astral `{"s":"<U+1F600><U+1F680>"}` | `text 123 34 115 34 58 34 128512 128640 34 125` | 128512 = U+1F600, 128640 = U+1F680 |
| CJK `{"k":"<U+6F22><U+5B57>"}` | `text 123 34 107 34 58 34 28450 23383 34 125` | 28450 = U+6F22, 23383 = U+5B57 |
| `a\x00b` | `nul 1` | valid UTF-8; first NUL at 1 |
| `\xe2\x82` | `invalidUtf8 0` | truncated 3-byte lead at 0 |
| `\xc0\xaf` | `invalidUtf8 0` | lead below C2 at 0 |
| `\xed\xa0\x80` | `invalidUtf8 0` | surrogate half (ED A0) at 0 |
| `\xf5\x80\x80\x80` | `invalidUtf8 0` | lead above F4 at 0 |
| `ok\xff` | `invalidUtf8 2` | FF at 2 |
| BOM + `{"a":1}` | `bom` | BOM first, content unchecked |
| `a\x00\xff` | `invalidUtf8 2` | UTF-8 before NUL: FF at 2 wins over NUL at 1 |
| BOM + `\xff` | `bom` | BOM before content validity |
| empty | `text` | empty text, no code points |
| `\x80` | `invalidUtf8 0` | lone continuation at 0 |
| `\xc1\xbf` | `invalidUtf8 0` | overlong lead at 0 |
| stdin `ab\xe2\x82` | `- invalidUtf8 2` | truncated lead at 2; `-` selects stdin |

The two order-pinning cases (`a\x00\xff`, BOM + `\xff`) agree with the
spec (`Request.read_utf8` checks UTF-8 and NUL; a leading BOM has its own
refusal) and with `raw.c:91-96`. Status: the raw corpus is approved as
independently reviewed. Preserve this coverage; it is the only
input-derived oracle in the lane.

## 6. `contracts.expected.txt`: independently reviewed, approved

Provenance: composed with the component at `7f31dd30` (Codec-Source
`16d687c8`), re-pinned at `23b67635`. It traveled with the component, so
this review re-derived all 80 lines without executing the module:

- Lines 1-46 (class, classification, availability, state, effect,
  subject, tool names): mechanical reads of the `*_name` functions.
- Lines 47-71 (25 token verdicts for the 25-entry `token_corpus`):
  each triple is
  `u32_token_ok / safe_integer_token_ok / strict_number_token_ok`,
  verified against the predicate definitions, the in-source bound laws
  (`4294967295` accepted, `4294967296` refused, `007`/empty refused,
  safe bound `9007199254740991`, `0.5`/`1e400` strict-accepted), and the
  spec number profiles (unsigned U32, unsigned safe-integer
  declaration profile, strict JSON number). All 25 agree, including the
  boundary rows `4294967296 -> false/true/true`,
  `9007199254740993 -> false/false/true`,
  `42949672950 -> false/true/true`, and
  `90071992547409910 -> false/false/true`.
- Lines 72-73 (`["context-result","q7"]`, `empty-next []`): pinned by
  the `next_text` laws.
- Lines 74-76 (engines/query/result success documents): pinned by the
  `codec_success_text` laws and cross-checked against the codec frame
  laws at `codec.bend:2198,2204,2711`, which render the same documents
  through the envelope path.
- Line 77 (admission refusal document): same `refusal_text` renderer
  as the pinned validation-refusal law; canonical key order
  (`command,condition,error,next`) matches the spec code-point ordering.
- Lines 78-79 (`signed ...`, `counter ...`): verified against
  `signed_safe_token_ok`/`counter_token_ok` definitions and their bound
  laws.

One documentation lag, not a behavior finding: the success documents
carry a `scope` member from the reviewed scope-threading change
(`7b3038ef`, law-backed), while the spec sentence "Codec success is one
JSON document: `{version:1,tool,id,query,requestCanonical}`" does not
list it. Status: the contracts oracle is approved as independently
reviewed. It stays byte-stable; any future mismatch against a fixed
compiler is a product finding, not an oracle edit.

## 7. Operations and codec demo mains: no legitimate golden

`operations.bend` and `codec.bend` are libraries (section 4 table):
codec imports `Ops`; schema/wire/convert import `Codec`. Their `main`
functions print sample decisions. A byte-exact golden for these printers
cannot be grounded in the approved semantics:

- The specification supplies input classes and verdict classes but no
  execution result ("These are candidate acceptance requirements; this
  specification supplies no execution result").
- The operation vocabulary (`modelLoad`, `sourceAnalysis`,
  `codeAccessJoin`, `catalogCapture`, `environmentRead`, and the
  secondary/override rules) appears only in implementation. The spec
  pins the effect vocabulary and grant rules, not the subject-to-name
  table.
- The renderers (`render`, `meta_text`, `envelope_text`,
  `admission_text`, `frame_text`) are implementation-defined. The spec
  pins verdict classes (admit/refuse), not their spellings.

Writing goldens by simulating the implementation would invent golden
from code, which root prohibited. The proposals below are therefore
recorded as specified-behavior expectations (verdict classes from the
spec) plus same-tree consistency derivations, explicitly labeled. They
are not oracles.

### 7a. Operations main, proposed lines (same-tree derivation)

`render = request_operation | request_override_operation |
request_projections | entity_database_engine` over the explicit samples:

```text
subject
sourceAnalysis||definition,calls|
codeAccessJoin||codeAccesses|postgres-schema
schemaValidation||structure|
modelLoad||validation|
||state|
environmentRead||dependencies|
override
environmentRead|toolsProbe|dependencies|
schemaValidation||structure|
```

Law cross-checks agree where laws exist (model load, schema,
catalog-not-plan, runtime-empty, ref-empty, override-keeps-subject,
projection order). The value strings themselves have no spec pin:
approval as golden is withheld.

### 7b. Codec main, proposed lines (verdict classes + same-tree pins)

| Line | Spec class | Same-tree pin |
|---|---|---|
| `frame-engines {...engines success, id 7...}` | accept (engines arguments `{}`, valid id) | law `codec.bend:2198` exact text |
| `frame-query {...query success, id -1...}` | accept (valid object request frame) | laws `codec.bend:2204,2711` exact text |
| `metadata` | header | literal |
| `` (empty) | admit (`0.5` admitted by the strict-number profile, spec fractions clause) | law `codec.bend:1963` (`MetaOk`, renders empty) |
| `` (empty) | admit (`1e400` admitted; no host conversion, spec overflow clause) | law `codec.bend:1975` |
| `invalidProgressToken` | refuse (null is an invalid progress token, spec) | `progress_token_ok(Rnull)=False` |
| `envelope` | header | literal |
| engines success doc, id 7 | accept (jsonrpc 2.0, known public tool, closed shapes) | same renderer and args as oracle line 74 |
| query success doc, id "7", q1 | accept | same renderer and args as oracle line 75 |
| `invalidJsonrpc` | refuse (version `1.0`; jsonrpc is checked before tool) | decision order `envelope_decide`; tool order is implementation-defined |
| `dispatch` | header | literal |
| dispatch sample 1 | admit with grant (spec: planning needs `planTargetSql`; grant present) | UNPINNED (see 7c) |
| dispatch sample 2 | refuse (empty composed operation; spec grant/operation rules) | UNPINNED (see 7c) |
| `end` | terminator | literal |

### 7c. Open observation: dispatch sample call shapes

Main lines `j`/`k` call `dispatch_admission` with four arguments
`(request, chain-or-string, grants, grants)` against the three-parameter
definition at line 457; every law call site (e.g. lines 1899, 1905,
1911) uses three arguments with an explicit `Opcons`/`Opnone` chain.
The retained evidence never reaches this question (compilation fails
first at defects A/B), so no execution record confirms or refutes the
call shapes. The scoped re-run in section 9 must show whether the
compiler accepts them; if it refuses, the source owner repairs the two
lines to the law call shapes (`Opcons{"sqlPlan", Opnone{}}` /
`Opnone{}` with single grants), which the laws already pin to
`dispatch:sqlPlan:1` and `refused:validationRefusal:unknownOperation`.

## 8. Specified real test entry (for collector/root adoption)

Golden comparison of demo printers is not behavior qualification (spec:
no count/line-number/output-size pins qualify semantics). The
qualification that already binds the decision functions is `--check-only`
law verification plus the mutation negative control. Removing the
unqualified-golden requirement needs a real test entry that exercises
explicit input semantics with assertions, on the `context-lifecycle.bend`
pattern: a `.bend` module that feeds the spec acceptance corpus
(metadata absent, `{}`, string tokens with astral characters, numeric
tokens `-1`, `0.5`, `1e3`, `4294967296`, `9007199254740993`, `1e400`,
null/boolean/array/object tokens; envelope table of section 7b;
dispatch grant matrix) and asserts verdict classes through laws, with
the driver asserting the printed observations inline. Authoring that
module and its driver invocation belongs to the collector/root lanes;
this review specifies its input set so the oracles above stay out of the
gate. This review lands no new source file.

## 9. Ownership, provenance, and remote proof

Ownership: the deepseek lane owns `bend2/test/context-codec.py`
(its revision is dirty in its worktree; this lane did not touch it).
Root owns `bend2/scripts/check-native.sh` and driver invocation. Source
repairs for defects A/B belong to the semantic source lanes and root
integration. This lane owns this note and the two approvals in sections
5-6.

Provenance preserved: the retained root-job evidence
(`candidate-context-codec.*`, `evidence/codec/*`, exit 1) stays the
record of the f2301ff2 run; nothing here rewrites it. The dirty
collector revision, the `codec/fixture-val-20261006` branch, and the
`semantic-context-20261005` repair reports stay untouched.

Remote proof handle (scoped fixture only; no whole build): from a
checkout of this branch on the Linux runner, with the pinned Bend
2.0.25 binary and `CC` set per the CI workflow:

```sh
python3 bend2/test/context-codec.py \
  --bend /home/atari2036/baton-logging-686/toolchain-home/bin/bend \
  --out /home/atari2036/codec-oracle-scoped-20261006/evidence
```

Expected on current sources: exit 1 with the section 3 failures,
reproducing the retained evidence on `fb903719`. After the source
repairs land through root integration, the same handle is expected to
reach exit 2 (operations/codec unqualified, contracts qualified, raw
corpus passing), at which point sections 7-8 govern the remaining work.
The recorded run output, including `evidence.json` and retained
candidates, is the proof artifact; this note predicts its content in
advance.

Next: commit this note on
`codex/integration-codec-oracle-muse-20261006`, push that branch only
(`bend2-rewrite` publication stays held with root; the primary carries
the b07 models), and execute the scoped handle above.
