# Configured provider-route change for an existing Player (#678, #681)

Date 2026-10-06. `baton2 configure` moves one registered Player's configured
provider harness, model and effort for its next admitted turn. The operation
keeps the Player's identity, parentage, workspace, branch, base, native
conversation, messages, turns, attempts and stops, and rebuilds the stored
receiver endpoint from the selected model key.

## Surface

| Surface | Form |
| --- | --- |
| CLI | `configure ID HARNESS MODEL EFFORT HARNESS_CMD OUTPUT_LOG EXPECTED_HARNESS EXPECTED_MODEL EXPECTED_EFFORT` |
| MCP | `baton2_configure` with `player`, `harness`, `model`, `effort`, `command`, `log`, `expectedHarness`, `expectedModel`, `expectedEffort` |
| Help | the verb line and its explanation in `bend2/src/coordinator/main.bend` `usage()` |

The three expected-route arguments are the route the caller read before the
change. They make the write a compare-and-swap: a delayed or repeated
continuation that still names the old route cannot reconfigure a session whose
route already moved, and a duplicated call is refused rather than applied twice.

## Admission

`C.configure_admitted` (`bend2/src/coordinator/commands.bend`) admits the change
only when all of these hold:

- the stored session's `id`, `harness`, `model` and `effort` equal the caller's
  expected route (`C.configure_matches`);
- the new harness is one a Player is launched with: `codex`, `omp`, `muse` or
  `claude-code`;
- the new model is non-empty;
- the session has no `session_stops` row;
- the session has no `executions` row in a phase other than `exited`, which is
  where `receive` and `turn` publish the one current attempt;
- the endpoint being stored is an admissible text argv.

`C.configure_update_sql` writes `harness`, `model`, `effort` and `endpoint` on
that one row and nothing else. The refusal answer is built only when the guarded
update changed no row, and the answer is the stored row only when it changed one,
so a refused change cannot answer with the row it refused to write.

The changed row is the record of the provider change: every reader of the
session, its route and its endpoint reports the selected provider, and the
`session` answer names the new route. The previous provider's failure frames stay
in `messages` as history, so a later reader still has the attempt that failed and
the retained input that the continuation will execute.

Authority comes from the same boundaries the other session-configuration verbs
use: the verb runs against the coordinator's database, and the owned-attempt
guard makes the session's single current owner the party that fences a mid-turn
change. Hierarchical authorization of native configuration verbs by the caller's
place in the Orchestra is not implemented; it is absent for `receiver`, `bind`
and `attach` as well, and remains open for the control surface as a whole.

## Receiver endpoint

`Control.configure` (`bend2/src/coordinator/control.bend`) rebuilds the endpoint
through `Control.configured_endpoint` when the selected harness is `codex` or
`omp`, which is the pair the receiver launches. That path resolves the selected
model key through the configured Git-series registry before any row is written,
so an unmapped or empty key refuses with the model-key diagnostic and the stored
endpoint keeps its previous value.

A Player moved to `muse` or `claude-code` keeps no receiver endpoint: those
harnesses are launched by `dispatch-turn`, which reads the recorded route at
dispatch time, so the stored endpoint becomes empty.

## Laws

Five operative laws cover the added path:

| Law | Module | Claim |
| --- | --- | --- |
| `configure_parser_keeps_the_requested_and_expected_route` | `bend2/src/coordinator/commands.bend` | the verb keeps the session, requested route and expected route in the declared positions |
| `m8_configure_compares_the_expected_route` | `bend2/src/coordinator/laws.bend` | the admission predicate is the stored row's own route |
| `m8_configure_writes_only_the_named_route_row` | `bend2/src/coordinator/laws.bend` | the guarded update writes the four route columns, and the refusal and answer are gated on its change count |
| `m8_configure_admits_only_a_free_expected_route` | `bend2/src/coordinator/laws.bend` | the admission requires the expected route, no stop, no owned attempt, a launchable harness, a named model and an admissible endpoint |
| `configure_entry_executes_the_native_control` | `bend2/src/coordinator/main.bend` | the entry dispatches the verb to `Control.configure` |

`docs/bend2/laws-trace.md` records these under M-8 (authority and effect
boundaries).

## Tests

`bend2/test/configure.py` drives the compiled coordinator against the shared
control fixture and the packaged Git-series registry:

- a route change rebuilds the endpoint with the selected model key and keeps the
  Player's `id`, `parent`, `native`, `workspace`, `branch` and `base`, the whole
  `messages` table, the pending inbox and the full retained message body;
- a stale expected route and a repeated call are refused with `configure-refused`
  and leave the row and the messages untouched;
- an owned attempt, a terminal stop and an unregistered session are refused;
- an unmapped model key, an unsupported harness and an empty model are refused;
- a move to a harness without a receiver stores an empty endpoint;
- after the change, the next dispatched delivery launches the harness with the
  new model and effort, executes the retained input, acknowledges it and reports
  through the recorded parent.

`bend2/test/mcp-command.py` covers the `baton2_configure` schema and its CLI argv
translation.

## Validation

Compilation and tests ran on the remote Linux validation runner `atari-homelab`
(x86_64, 64 cores) with Bend 2.0.25, clang-19 and Node 22.23.2, in the owned
directory `~/baton2-worker-20261006`. The operator host has no compiler and ran
nothing.

| Gate | Result |
| --- | --- |
| `bend bend2/src/coordinator/main.bend --check-only` | pass, including every operative law and its proof |
| `sh bend2/scripts/build-native.sh` | pass |
| `python3 bend2/test/configure.py` | 6 passed |
| `python3 bend2/test/mcp-command.py` | 16 passed |
| `node bend2/scripts/laws-check.mjs` | green: 583 laws, 173 mutations, 757 compiles, 0 failures |
| every `bend2/test/*.py` | no new failure identity against the unmodified tree |

The last row is the landing criterion: a selected file's failure identity on the
changed tree must not be absent on the target tree. A second tree was extracted
from `git archive HEAD` (commit `2cc57690`, which contains no part of this
change) and built the same way. Every failing file produced the same identities
in both trees:

| File | Identical failure identities on both trees |
| --- | --- |
| `accept-kimi-hierarchy.py` | 5, the generated-check cases |
| `control.py` | 3, `test_pretty_*` reads |
| `native-cli.py` | 11, help and pretty-read cases |
| `receive.py`, `receive-terminal-boundary.py`, `recovery-drivers.py` | 1 each, `test_replayed_turn_wakes_input_queued_while_returning_saved_report` and its callers |
| `retained-control.py` | 1, `test_native_waiter_keeps_exited_identity_until_keeper_reaps` |

Every one of those failures is present on the target tree with the same
identity. Two causes account for them: a report body of 480 KiB passed as one
argv element exceeds the Linux per-argument limit (the case and its generated
check are #679, and they pass on the macOS runner where the limit does not
exist), and clang-19 rejects one generated C fixture during register allocation
(`retained-control.py:364`).

`bend2/scripts/laws-check.mjs` ran to completion on the same Linux runner against
the same tree: `laws-check: green - 583 laws, 173 mutations, 757 compiles, 0
failures` (exit 0). That is the summary the packaged gate reads, so the
proof-removal control over every law in the tree, including the five laws this
change adds, is discharged here rather than claimed from the CI runner. The
registered mutation `configure-parser-drops-expected-harness` is one of the 173
controls; its row reports `"mutation":"configure-parser-drops-expected-harness"`,
`"gate":"refuses"`, `"passed":true`.

## Remaining

`#678` and `#681` also require an original recorded conversation resumed through
the selected available provider, remote qualification of a Codex quota failure
followed by an OMP continuation, and native landing. This operation supplies the
configuration step those gates need; it does not claim them.
