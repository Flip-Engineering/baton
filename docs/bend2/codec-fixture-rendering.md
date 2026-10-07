# Codec fixture output

This document defines the output of the `main` entry in `bend2/src/context/codec.bend` and the selector fixture in `operations.bend`. The files beside those entries contain the expected complete UTF-8 output. Changes to fixture inputs or rendering require review of this contract and the expected output before execution.

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

## Verdict spellings

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

## Operations selector output

The selector fixture prints the primary operation, ordered overrides, ordered projections, and engine identifier, separated by `|`. List members are separated by commas. The fixture demonstrates the operation vocabulary used by the engine registry and the subject projection table. An empty operation for a runtime subject represents delegation to intent selection. These partial selector inputs do not establish request admission or runtime execution.

## Review requirements

Expected files are reviewed from the fixture inputs, the specified verdict and effect rules, and this rendering contract before output comparison. A byte mismatch is a fixture failure. Compiler law checks, native byte-reader cases, lifecycle effects, and mutation qualification provide separate validation of behavior.
