# Stall detection and wake in Bend2 core

Design and implementation note for the pending-message-stall issue, restated under the operator
directive `message:operator:9dd22aa2653e3238a0fa9345dd4fbb8d`.

| | |
|---|---|
| Owner | rewrite-tooling |
| Rescinded | `bend2/scripts/pending-stall.mjs` and `bend2/test/pending-stall.mjs`, delivered at `1012c2c`/`20b7399` and removed in this commit |
| Delivered | this note; the module `bend2/src/coordinator/stall.bend` and its laws follow as the next commit |

## Why the earlier deliverable is rescinded

A new JavaScript product implementation contradicts the pure Bend2 requirement, whatever it is
named. The two `.mjs` files are deleted from the branch rather than kept beside the Bend2 module: a
rescinded implementation that stays in the tree is the second maintained implementation the rules
forbid. An ephemeral inspection script may be rebuilt at any time and excluded from the contribution;
none is checked in.

## What the detector derives, and from where

Everything comes from the recorded database the coordinator already carries. No new durable store
exists; the state is derived again on each invocation, which is the derive-after-crash rule.

| Field | Source |
|---|---|
| pending count | `messages` rows with `recipient = session` and `receipt IS NULL` |
| attempt reference | `executions.id` for the session, with `executions.phase` |
| no progress | `executions.phase <> 'exited'`: the attempt is still recorded as live |
| endpoint present | `sessions.endpoint`, using the same `json_valid` / `json_type` / `json_array_length` expression the coordinator already uses for endpoints |
| wake claim | `wake_claims` presence for the session, reported as a field |

A player is stalled when its pending count is positive, its attempt phase is not `exited`, and its
endpoint is present. Nothing about time is invented: the database records no clock, so the detector
is structural. The earlier `--stale-seconds` threshold is not carried over, because a threshold over
an unrecorded clock would be a fact the database cannot support.

## The wake route

`stall_wake` reuses the existing route rather than adding a second one: for each stalled session
with no outstanding wake claim it calls `Wake.drive_session(db, session, id)`, the same driver the
message admission uses. A session with a claim is reported and skipped, so a repeated invocation is
idempotent and cannot double-deliver.

## Boundaries

| Module | Reads | Writes |
|---|---|---|
| `stall.bend` | the database through `Sql.query`; `IO.now()` for `observedAt` | none to player state; `stall_wake` drives the existing wake route, which writes only through that route |
| `stall-laws.bend` | fixtures | none |

No signals, no restarts, no writes outside the existing wake path, and no service contact.


## State of the implementation

Landed at `4e416cd`: `bend2/src/coordinator/stall.bend` with `bend2/src/coordinator/stall-laws.bend`.

The row transport is tab-separated, not JSON, which removed the dependency on the decoder: the
first draft needed `bend2/src/json/decode.bend` only because it asked SQL for a JSON array. Rows now
arrive as the coordinator's existing tab lines, `Tx.split_tabs` and `Tx.split_lines` carry them, and
the report object is assembled with `J.string_literal`. The decoder stays on this line for
`main.bend`, but the stall module no longer waits on it.

One shape change the compiler forced, worth recording because it is the rule rather than a
workaround: a match cannot scrutinise a computed value, so `match Tx.split_tabs(line)` is refused
with "a match cannot scrutinize a computed value: give it its own def". Both places were split into
`row_fields` and `owed_fields`, which match their own parameter, with the split happening in the
caller.

## Adversarial targets for the independent check

Two decisions in the module are judgement calls rather than consequences of the contract, and they
are the ones to attack:

1. **A row with no owed message id is skipped, not reported.** It contributes nothing to the wake and
   is omitted from the report. The alternative — reporting it with an empty address — would surface a
   player the wake cannot reach, which may be the more useful fact.
2. **The wake drives only the oldest owed message per stalled player.** `Wake.drive_id` resolves the
   recipient from that message and drives the cursor from its position, so one call re-enters the
   existing delivery path at the right place. Whether one call per player is enough when a player
   holds many owed messages is a claim about `Receive.wake_due`, not about this module, and it should
   be checked against that function rather than assumed.

## Verification

`bend --check-only` on the touched files under the standing constraints (timeout 300, `ulimit -v`
as admitted), never a full Main generation.

| Run | Result |
|---|---|
| `--check-only bend2/src/coordinator/stall-laws.bend`, `ulimit -v 8388608` | exit 1, the scrutinee error quoted above; fixed by the `row_fields` / `owed_fields` split |
| the same after the fix | exit 134, `ASSERTION FAILED: MemoryExhaustion` in JSC's `LocalAllocator` after 33 s |
| `--check-only bend2/src/coordinator/stall.bend`, `ulimit -v 25165824` | exit 0, `check-receipts/rowsjson-attempt-12.out`, max RSS 7,345,904 kB |
| `--check-only bend2/src/coordinator/stall-laws.bend`, `ulimit -v 25165824` | exit 0, `check-receipts/rowsjson-attempt-13.out`, max RSS 7,335,940 kB |

The 24 GiB profile is the admitted scoped profile for this coordinator-tail chain
(knowledge-record:cfc7591b). The earlier 8 GiB failure was the cap, not the module.
The malformed-row blocker is covered by three laws added with the `rows_json` fix:
a malformed row before, between and after valid rows renders no leading, doubled
or trailing comma.

## Current-main port

The candidate is parented on local `rewrite-tooling` `7ff721b`, not on `origin/main`.
This port is based on `385f1a41` ("Merge pull request #840 from
Flip-Engineering/codex/compiler-consumer-27629713-20261018"). Its tree has no
`bend2/src/coordinator/stall.bend`, `stall-laws.bend` or
`docs/pure-bend2/pending-stall-bend2.md`.

The imports the module needs are present on that main: `json/canonical.string_literal`,
`host/sqlite.Sql.query`, `git/text.split_lines`, `split_tabs`, `trim_nl`, and
`coordinator/wake.drive_id` with the same signature. The `base.bend`, `canonical.bend`,
`sqlite.bend` and `text.bend` blobs match the candidate's copies. The tooling `wake.bend`
differs from main's (it adds the `codex-route` import and the detached-endpoint
functions); the stall module calls only `Wake.drive_id`, so the two stall files are
portable without those additions.

This branch adds this note and the two stall files from `5863580` at the `385f1a41`
base. Do not merge the tooling-based branch directly: it carries the whole tooling
line and a different `wake.bend`.
