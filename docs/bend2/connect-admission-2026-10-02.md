# Connect endpoint admission

## Observed failure

The [native comparison](native-workflow-comparison-2026-10-02/README.md) at
`ec0e144d` passed an endpoint filename to `connect`. The command returned success
and replaced the stored binding. Retrying the retained task left it pending and
started no lead. A later explicit correction supplied the JSON argv itself and
continued the same native root. Issue #648 records this failure.

A separate native CLI probe reproduced the filename admission, binding change
and missing delivery. It also admitted a JSON argument containing NUL, which
failed at the host process boundary. The before receipt has SHA256
`80c2d778fad69655c7bdfa18e9bda8c4257d44ebec1b16736973183fb52aa134`.

## Repair and verification

`Commands.endpoint_admitted` accepts an empty endpoint for disconnection or a
nonempty JSON array containing only text arguments, a nonempty executable and
no NUL characters. `Commands.connect_sql` applies that predicate before updating
the native identity and endpoint or returning the binding. Invalid input returns
the structured `invalid-endpoint` error. `Store.committed` classifies that refusal
before endpoint delivery and returns exit status 2.

The entry imports six [connection laws](../../bend2/src/coordinator/connect-laws.bend)
over the real admission, SQL construction and refusal functions. Negative controls
remove the update guard, admit non-text arguments and remove refusal classification.
SQLite executes the predicate; the [native tests](../../bend2/test/connect.py)
verify its stored effects and actual endpoint process.

The isolated repair at `45db01a51952d4336a66489c43ed98d065064b17` built with
Bend 2.0.25 and passed four connection tests and 19 coordinator compatibility
tests. Its native binary has SHA256
`1dffc4aa1bf58c5ebbd9c780e54471b2528e199ae27de2ed26e0e8d37edc4091`.
The actual CLI probe returned exit 2 for filename and NUL input, retained the
previous native identity, endpoint and pending input. An exact retry through the
preserved valid endpoint delivered and acknowledged the original message once.
A later explicit reconnect and accepted-message retry added no duplicate delivery.
Unicode, whitespace and empty text arguments reached the endpoint unchanged.

The final isolated evidence binding has SHA256
`86886f9ae0efedbdccefad1f00a05d55313eaf868a794d3f0088ee59aa03cd8b`
and remains at
`baton-bend2-connect-admission-648-20261002/.scratch/connect-648-after/final-binding.json`.
It binds source, executable and complete build, test and probe output hashes.
The initial declaration-order compile failure and corrected fixture expectation
remain retained. Canonical publication requires the build, complete law negative
controls and native checks on the composed tree.

## Boundary

Admission validates the native argv representation. A well-formed endpoint can
still name an unavailable executable; delivery then fails and retains the input.
An empty endpoint explicitly disconnects delivery. The caller inspects `session`
and `inbox`, connects valid argv, and retries the retained message ID. This repair
covers `connect`; caller authentication and other session-creation commands keep
their existing contracts.
