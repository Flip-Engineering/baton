# Proposed codec fixture rendering contract, 2026-10-06

Status: PROPOSAL for root explicit review. This contract is not
previously spec-pinned: `docs/bend2/semantic-context-spec.md` defines
verdict classes and input classes, not printer spellings. Admitting this
contract (possibly via the spec) is the step that makes byte-exact
comparison of the codec demo main legitimate. Until admitted, the byte
file beside it stays a proposal, not an oracle.

Scope: the `main` entry of `bend2/src/context/codec.bend` only. Bound to
root source `642d30ca`. Any change to `main`, its samples, the
renderers below, or the cited laws invalidates the proposal.

## Line framing

Output is UTF-8 text. One decision per line. Fields within a line are
joined by single spaces or the renderer below. Every line, including the
last, ends with `\n`. No trailing spaces. An admitted metadata verdict
renders as an empty line (a bare `\n`); the two empty lines in the
proposal record admitted metadata verdicts.

## Fixed headers

`main` prints the literal headers `metadata`, `envelope`, `dispatch`,
and the terminator `end`, each on its own line. The `frame-engines` and
`frame-query` lines prefix the decision document with the literal
source name and one space.

## Verdict spellings (implementation-defined, proposed for admission)

- Metadata: `MetaOk` renders empty; `MetaNotObject` renders
  `metadataNotObject`; `MetaBadProgressToken` renders
  `invalidProgressToken`. The admitted token profile is the spec
  strict-JSON-number rule: strings and strict numbers admit (including
  fractions, exponents, and above-U32 magnitudes such as `0.5`,
  `1e400`, `9007199254740993`); null, booleans, arrays, and objects
  refuse.
- Envelope: `EnvAccepted` renders through `codec_success_text` (next
  rule); `EnvRefused` renders the bare condition (`invalidJsonrpc`,
  `invalidMethod`, `unknownFrameField`, `invalidFrameId`,
  `unknownTool`, `unknownParamsField`, `invalidArguments`, or the
  request condition). The check order is jsonrpc, method, root closure,
  frame id, tool, params closure, arguments; the first refusal wins, so
  a frame can carry several defects but prints one.
- Admission: `ADispatch` renders
  `dispatch:<primary-operation>:<chain-count>` with the count in
  decimal; `ARefused` renders `refused:<class>:<condition>` with
  `RfValidation` as `validationRefusal`. The refusal speaks the
  missing element (`unknownOperation` for an empty or unmapped chain,
  `effectNotGranted` for a missing grant).

## Canonical success document

`{"id":<id>,"query":<q>,"requestCanonical":<r>,"scope":<s>,"tool":<t>,"version":1}`.
Key order is fixed code-point order. Strings use canonical JSON
escaping (`\"` for quotes). Absent optionals render `null`. A numeric
frame id renders unquoted from its checked token (`7`, `-1`); a text id
renders quoted (`"7"`). `tool` is the native name (`context-engines`,
`context-query`, `context-result`).

## Stability

The contract version is the source commit it is derived from. Re-derive
on any renderer, sample, or law change; admitted bytes stay fixed once
admitted. A mismatch between admitted bytes and execution is a product
finding.
