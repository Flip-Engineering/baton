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

The wake driver (`wake_fenced` in `bend2/src/coordinator/receive.bend`) asks
for the newest observation matching the session's harness, provider, and
account label (an empty label also matches account-wide rows):

- No row, or a NULL reset: the wake proceeds. An unknown reset never blocks.
- A future reset: the wake reports `usage-window-held` to the session and its
  conductor with the window, reset time, source, and receipt, releases the
  lock, and leaves the input owed. Eligible work routes to an available
  configured account or model through the existing handoff and route
  machinery.
- A past reset after a hold: the wake reports `usage-window-restored` once per
  message and admits the owed input on the retained assignment and account.

Restoration needs no timer: the next wake after the reset admits the work
automatically, and the held report tells the conductor exactly when that is.

## Query

`usage-windows SESSION` prints the newest observation per window with its
current state (`held`, `elapsed`, `unknown`), the reset time in milliseconds
and as UTC text, the source, and the receipt. No matching row reads back
`none recorded`; a model without a provider prefix reports
`noProviderQualifiedModel`.

## Verification

`bend2/test/usage-windows.bend` drives the real extraction functions over the
observed Kimi, ZAI, and Claude wordings. `bend2/test/usage-windows.py`
exercises the command surface against a recruited session fixture. The wake
gate's held and restored branches run in the receive integration fixtures on
remote validation runners.
