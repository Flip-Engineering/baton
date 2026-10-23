# Reopening an exhausted 7-day window with a banked reset

Status: design for review (#1037). No code is written for this design. Step 2 of
#1036 (reading and storing a banked balance) is not part of this design and stays
open until the root names a source for the count.

Scope: 7-day usage windows only. 5-hour windows are out of scope.

## Problem

A provider can refuse a seat because a 7-day window is exhausted. Some providers
let the operator spend a banked reset, which restores the exhausted allowance.
Baton has no way to spend one. Held work waits for the window's recorded reset,
which for some providers is weeks away, and the held input is not admitted when
a banked reset would have restored the allowance earlier.

## Principles

- A spend happens only when the operator has enabled it for the account. The
  setting authorizes the spend. It is not a budget, and it does not refuse,
  pause or truncate any work.
- Baton spends only free or banked resets. A paid instant reset is a purchase.
  Baton does not buy resets, and no spend action may complete a purchase.
- The provider's answer to a spend decides the result. Baton does not treat a
  spend as successful until the provider confirms it or a later usage read shows
  the window reopened.
- A spend is recorded before the provider is called, and its result is recorded
  after. A spend is never repeated automatically after a crash, because each
  successful spend consumes a banked reset.
- A spend is attempted only when all three conditions hold: the account's setting
  is on, held work is waiting on that account, and the 7-day window is exhausted.

## Spend actions by provider

The table lists what the operator can do today in each provider's own product.
"Route verified" means the action is documented with a command, endpoint or
request shape that Baton could call. A row without a verified route is not
implemented.

| Provider | Spend action in the provider's product | Route verified | Confirmation source | Notes |
|---|---|---|---|---|
| Codex / ChatGPT | "Redeem reset" in Codex CLI `/usage`, and in the desktop or web Settings > Usage & billing | CLI route is documented as an interactive menu selection. No non-interactive command or API is documented. | Codex rollout `rate_limits` (`primary.used_percent` for the weekly window, `resets_at`), read after the spend | Paid "instant reset" is a separate offer and is excluded. A banked reset is used only when it restores at least one allowance below 100%. |
| z.ai GLM Coding Plan | Quota reset card (weekly type). The FAQ does not state where a card is used. | No | Quota progress on the z.ai subscription page. No API is documented. | The weekly card also restores the 5-hour quota. Card count and expiry are not readable from public docs. |
| Claude Max | "Reset for free" in Settings > Usage (web and Claude Desktop) | No. Not available in Claude Code in a terminal or IDE, or on Claude Mobile. | Settings > Usage only | Expiry is shown in the same settings area. |
| Kimi Code | None documented | Not applicable | Not applicable | Legacy weekly limit resets every 7 days from subscription start. That is a fixed schedule, not a banked reset. |
| DeepSeek | None. Billing is balance-based and has no 7-day window. | Not applicable | Not applicable | Balance exhaustion is covered by #1013. |
| Muse | Unknown | Unknown | Unknown | Usage data is an SSE frame on live turns (third-party report, not Meta documentation). |

Result: no provider has a spend action that Baton can verify end to end today.
The Codex CLI menu is the only documented spend route, and it is interactive.
Implementation therefore waits for a verified route for each provider. The design
below applies to any provider with one.

## Operator setting

- One setting per account: `reset_spend` with values `off` (default) and `on`.
- The setting is stored in the account record of the coordination database, next
  to the account label. The operator sets it through the operator command surface.
  Baton never changes it.
- Turning the setting on does not spend a reset. It only allows the spend path
  described below.

Open question for the root: whether the setting belongs on the account record or
on the provider and account pair, since one account may serve several providers.

## Spend path

1. A held wake for an account reports `usage-window-held` with window `7-day`
   (existing path, unchanged). Held work for that account is now known.
2. If the account's setting is `on` and the 7-day window is exhausted, the
   reopen check runs once for that exhaustion event. An exhaustion event is
   identified by the refusal row that recorded it. One spend is attempted per
   event.
3. The spend attempt is recorded with status `requested` before the provider is
   called. The record names the account, the provider, the window, the refusal
   row, and the time.
4. The provider action runs. The result is recorded as `confirmed`, `refused`, or
   `unknown`, with the provider's response text as the receipt.
5. The reopen is confirmed by a usage read after the spend. For Codex, this is
   the next rollout `rate_limits` read for the account. For a provider with no
   readable usage source, the result stays `unknown` until a later turn succeeds.
6. On `confirmed`, the path in "Reopen announcement" runs.

If a spend is refused, the held work stays held until its recorded reset. The
refusal is reported to the root and the conductors holding seats on the account.

## Crash and replay

A spend record that is `requested` with no result after a restart means the
provider call may or may not have happened. Baton does not call the provider
again for that record. The next step is a usage read:

- If the usage read shows the window reopened, the record becomes `confirmed`.
- If it does not, the record becomes `unknown`, and the root is told. No further
  spend runs for that refusal.

This differs from the general rule that a repeated operation is an acceptable
crash result. A repeated spend consumes another banked reset, so it is not
acceptable here.

## Record

A new table `usage_reset_spends` records each spend attempt. It is separate from
`usage_windows`, which records observations. The wake gate reads
`usage_windows`, and a spend result must not change that read except through a
provider observation.

Columns: `id`, `requested_at`, `account`, `harness`, `provider`, `window`,
`refusal_id` (the `usage_windows` row of the exhaustion), `status`
(`requested`, `confirmed`, `refused`, `unknown`), `receipt` (provider response
text or an error), `resolved_at`.

A new table is needed because a spend is an action with an outcome and a receipt.
Each attempt has one `requested` row, and the result is written to that row.

## Reopen announcement

On a `confirmed` spend, Baton does the following, in order:

1. Writes a coordination event for the account and window.
2. Sends a guide to the root and to every conductor with a held seat on the
   account.
3. Admits the held inputs for the account (#1020). Each admitted input runs on
   its retained assignment and account.

Steps 2 and 3 use the existing held-report and continuation paths. The new code
is the trigger on `confirmed` and the event row.

## Failure cases

| Case | Result | Next step |
|---|---|---|
| Setting off | No spend | Held work waits for the recorded reset |
| No held work on the account | No spend | None |
| Window not exhausted | No spend | None |
| Provider refuses the spend | `refused`, receipt kept | Reported to root; no retry for that event |
| Provider response not parsed | `unknown` | Reported to root; no automatic retry |
| Crash after `requested` | Usage read decides | See "Crash and replay" |
| Confirmation read fails | `unknown` | Reported to root |

## Evidence needed before implementation

1. A verified spend route for at least one provider, with a command or endpoint
   and a sample response. For Codex this means a non-interactive form of
   `Redeem reset`, or a documented API.
2. Evidence that a 7-day exhaustion occurred for that provider while the banked
   reset could restore it. Nothing in the four orchestra databases records a
   banked reset, so this is not yet established.
3. The root's decision on the setting's scope and on whether the step 2 count
   source is needed for the spend decision. The spend decision above does not
   read the count.

## Limits

- The count of banked resets is not readable from any source found so far (see
  #1036). The design does not depend on it: a spend is attempted, and the
  provider's answer decides.
- Spend availability and expiry are provider decisions. This design does not
  assume a reset is available when a spend is attempted.
- Confirmation through rollouts reads the provider's own usage fields. It does
  not show whether the provider applied the reset to all covered allowances.
