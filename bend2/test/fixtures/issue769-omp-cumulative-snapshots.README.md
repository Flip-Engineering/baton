# Issue #769 OMP cumulative snapshot fixture

`issue769-omp-cumulative-snapshots.jsonl` is a fixture, not a captured log. The frame shapes come
from the OMP 17.4 observations in issue #769: `set_event_filter` answered with `success:false`
and the error text `Unknown command: set_event_filter` without an `id`; `message_start`,
`message_update` and `message_end` frames carrying none of `toolCallId`, `messageId` or
`message.id`; cumulative `message.content[0].thinking` and
`assistantMessageEvent.partial.content[0].thinking`; and a tool call identified by `toolCallId`.
The payload strings are synthetic and contain Unicode to exercise byte and codepoint handling.

The stream has one open message with four cumulative snapshots, one complete tool call with two
cumulative partial updates, one error `message_end`, and one `agent_end` terminal. Truncating the
fixture before the `message_end` line gives the interrupted-stream case.

`bend2/scripts/check-issue769-baseline.py` reads this fixture and the `frame_id_sql` and
`filter_mode_sql` expressions from a source tree. It mirrors the `logs.bend` default-level step
functions, reports raw and public snapshot bytes, and exits 1 while the source still reproduces
the #769 growth path. The script needs only Python 3 and its sqlite3 module; it does not need the
Bend compiler or a built coordinator.
