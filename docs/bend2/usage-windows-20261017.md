# Usage windows and reset times

`bend2/src/coordinator/usage-windows.bend` tracks provider subscription quota
windows and the reset times observed for them (#797). The named failure is the
Kimi Code 5-hour rolling window: the provider's 403 message
("You've reached your 5-hour usage limit.") names no reset timestamp, the Kimi
Console web UI shows one, and the client's usage report carries one when a live
credential can fetch it. Baton records what was observed, refuses new turns
for a held window, and admits owed input again after the recorded reset.

These are subscription quota windows. Claude monthly promotional API credits
(#793) are a separate funding source with a separate Console organization pool
and are not tracked here.

## The store

The coordination database owns the observations in the `usage_windows` table
(created by `schema()` in `bend2/src/coordinator/commands.bend`, so existing
databases self-upgrade on the next commit). Each row records:

- `harness`, `model`, `provider`: the session's harness and recorded model;
  `provider` is the model's provider prefix (`kimi-code` for
  `kimi-code/kimi-for-coding`).
- `account`: the subscription profile label in force (empty means
  account-wide for that harness and provider).
- `window`: `5-hour`, `7-day`, `monthly`, or empty when the wording is
  unrecognized.
- `resets_at`: milliseconds epoch, or NULL. NULL is the explicit unknown; the
  store never invents a reset time.
- `reset_source`: `provider-message`, `provider-report`, or
  `operator-observation`.
- `receipt`, `message`: what was observed, and the message id that carried the
  exhaustion when there is one.

## Recording

Three sources write observations:

1. Exhaustion handoff: `advance_profile` in
   `bend2/src/coordinator/subscription-fallback.bend` inserts one observation
   from the provider's exhaustion cause before any account advance, so the
   refusal fact survives even when the advance itself fails. The window kind
   is extracted from the cause text; an embedded ISO-8601 reset time is
   converted to milliseconds, and a missing one stays NULL.
2. Operator observation: `usage-window-observe SESSION WINDOW RESETS_AT
   SOURCE` records a reset time read from the provider's own console (for
   Kimi Code, the Console web UI, as in the #797 observation "Resets 10-16
   20:41"). `RESETS_AT` is ISO 8601 with an explicit offset or `unknown`;
   anything unparseable refuses the command rather than recording a guess.
3. Provider report: `usage-window-refresh SESSION` runs the session's
   recorded harness command with `usage --json` (OMP only, reusing the
   observed-usage query) and records every reported limit. For Kimi Code the
   client reports `5h` and `7d` windows with an absolute `resetsAt` when the
   endpoint returns one; a limit without `resetsAt` keeps the NULL unknown.

## The wake gate

The wake driver asks the gate for the session's harness, provider prefix, and
account label. The gate reads the latest row per window for state and reset and
the latest provider row per window for exhaustion evidence:

- A window is exhausted when its latest provider row is a limit message or
  reports `usedFraction` at or above 1. A partial provider report with a
  future reset is not exhaustion.
- An operator-observed reset keeps the window's provider exhaustion and
  supplies the reset time; this is the Kimi Code Console path.
- Held: an exhausted window's reset is in the future. The wake reports
  `usage-window-held` to the session and its conductor with the window, reset
  time, source, and receipt, releases the lock, leaves the input owed, and
  schedules one detached single-shot continuation at the earliest held reset.
  Eligible work routes to an available configured account or model through the
  existing handoff and route machinery.
- Elapsed: no window is held and an exhausted window's reset has passed. The
  wake reports `usage-window-restored` once per message and admits the owed
  input on the retained assignment and account.
- Unknown: the only exhausted evidence is a limit message with no reset. The
  wake proceeds; an unknown reset never blocks.
- None: no exhausted window. Partial reports stay visible in the query and do
  not hold.

The continuation sleeps until the recorded reset and re-enters the wake driver
(`--wake-message`, which calls `Wake.drive_id`) with no new input, so the gate
is evaluated again when it fires. A still-held window reports and schedules the
next segment; an elapsed one admits the owed input; a message that already has
a receipt is a no-op. The delay is capped at one day, so a far reset re-checks
in bounded segments. It is one detached process, not a daemon, and it does not
poll. Delivery stays receipt-gated, so a handled message gains no second
delivery; two continuations for the same message leave one delivery and one
held report.

## Query

`usage-windows SESSION` prints the newest observation per window with its
current state: `held`, `elapsed`, and `unknown` for exhausted windows, and
`open` for a window without exhaustion evidence (a partial report or an
operator-only record). The state uses the same per-window provider-exhaustion
projection as the gate, so an operator-observed reset after a provider limit
message reports `held` before the reset and `elapsed` after it, matching the
gate verdict. Each row carries `source` (the reset's provenance, for example
`operator-observation`), `exhausted`, and `exhaustionSource` (the latest
provider row's source), so the reset fact and the exhaustion fact stay
separate. The reset time is printed in milliseconds and UTC text with its
receipt. No matching row reads back `none recorded`; a model without a
provider prefix reports `noProviderQualifiedModel`.

## Verification

`bend2/test/usage-windows.bend` drives the real extraction functions over the
observed Kimi, ZAI, and Claude wordings. `bend2/test/usage-windows-store.bend`
drives the store, gate, reports, refresh, and multiwindow state over a
temporary database. `bend2/test/usage-windows-long.bend` bounds the reset scan
on a long provider message. `bend2/test/usage-windows-wake.bend` proves the
post-reset continuation, handled-message idempotence, duplicate continuations,
and the one-day segment cap. `bend2/test/usage-windows.py` exercises the
command surface against a recruited session fixture on remote validation
runners.
