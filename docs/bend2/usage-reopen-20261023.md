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
- A spend is recorded before the provider is called, with an idempotency key,
  and its result is recorded after. A replay after a crash reuses that key, so the
  provider does not spend a second reset for the same attempt (Codex, verified
  above). A provider without a key-based replay is never replayed.
- A spend is attempted only when all three conditions hold: the account's setting
  is on, held work is waiting on that account, and the 7-day window is exhausted.

## Spend actions by provider

The table lists what the operator can do today in each provider's own product.
"Route verified" means the action is documented with a command, endpoint or
request shape that Baton could call. A row without a verified route is not
implemented.

| Provider | Spend action in the provider's product | Route verified | Confirmation source | Notes |
|---|---|---|---|---|
| Codex / ChatGPT | Codex app-server methods `account/rateLimits/read` (count and state) and `account/rateLimitResetCredit/consume` (spend). The CLI `/usage` "Redeem reset" uses the same backend. | Verified in codex-cli 0.163.0: both methods and their types are in the binary's generated schema (`codex app-server generate-json-schema`). Transport is JSON-RPC over stdio after `initialize`. The read was run once on the operator account and returned `availableCount: 0` and a weekly window (`windowDurationMins` 10080). | `account/rateLimits/read` result: `rateLimitResetCredits.availableCount`, `credits[]` (`id`, `resetType`, `status`, `expiresAt`), and `rateLimits.primary` (`usedPercent`, `resetsAt`, `windowDurationMins`) | Paid "instant reset" is a separate offer and is excluded: Baton consumes only credits in `rateLimitResetCredits`. Consume outcomes: `reset`, `nothingToReset`, `noCredit`, `alreadyRedeemed`. `ordinaryUsageAllowed` null means unavailable and is never inferred from percent or time. |
| z.ai GLM Coding Plan | Quota reset card (weekly type). The FAQ does not state where a card is used. | No | None readable. No API is documented. | Count and state recorded as not readable; no operator-entered count. |
| Claude Max | "Reset for free" in Settings > Usage (web and Claude Desktop) | No. Not available in Claude Code in a terminal or IDE, or on Claude Mobile. | Settings > Usage only | Count and state are not readable by any source found. Recorded as not readable; no operator-entered count. |
| Kimi Code | None documented | Not applicable | Not applicable | Legacy weekly limit resets every 7 days from subscription start. That is a fixed schedule, not a banked reset. |
| DeepSeek | None. Billing is balance-based and has no 7-day window. | Not applicable | Not applicable | Balance exhaustion is covered by #1013. |
| Muse | Unknown | Unknown | Unknown | Usage data is an SSE frame on live turns (third-party report, not Meta documentation). |

Result: Codex is the only provider with a verified read and spend route. Claude
Max and z.ai have no readable count and no verified spend route, so they stay
unimplemented and are recorded as not readable. The design below applies to any
provider with a verified route.

## Operator setting

- One setting per account: `reset_spend` with values `on` and `off`.
- The setting is stored on the account record of the coordination database, next
  to the account's provider and label.
- Default: `on` for an account whose provider has a verified route (currently
  Codex). The operator asked that banked resets be spent on exhausted 7-day
  windows, so the default follows that request.
- The operator can set `off` for any account. Baton never sets `on` or `off`
  itself, and it does not change the setting after a spend.
- Turning the setting on does not spend a reset by itself. It only allows the
  spend path described below.

The setting scope is per account, as the root decided.

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

A spend record that is `requested` with no result after a restart is replayed
with the same `idempotencyKey` for providers that document key-based replay
(Codex: `account/rateLimitResetCredit/consume` takes `idempotencyKey`, and the
"reuse the same value when retrying that attempt" rule is in the generated
schema). The replay outcome decides the record:

- `reset` on replay: the spend completed in this replay. Record `confirmed`.
- `alreadyRedeemed` on replay: the earlier call completed. Record `confirmed`.
- `nothingToReset` or `noCredit`: record `refused`.
- No answer or a transport error: record `unknown`, report to root, and do not
  replay again for that event without a new decision.

A provider with no key-based replay keeps the rule that a `requested` record is
never replayed. Its record is resolved by a usage read, or it is reported to root
as `unknown`.

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
| Provider returns `nothingToReset` | `refused` | Reported; no retry for that event |
| Provider returns `noCredit` | `refused` | Reported; no retry for that event |
| Provider returns `alreadyRedeemed` on a replay | `confirmed` | The earlier call completed |
| Provider response not parsed | `unknown` | Reported to root; no automatic retry |
| Crash after `requested` (Codex) | Replay the consume with the same key | See "Crash and replay" |
| Crash after `requested` (no keyed replay) | Usage read decides; no replay | Reported to root if unresolved |
| Confirmation read fails | `unknown` | Reported to root |

## Evidence needed before implementation

1. Done for Codex: a verified read route (`account/rateLimits/read`) and a
   verified spend route (`account/rateLimitResetCredit/consume`), both in the
   installed binary's generated schema. A live consume has not been run, so the
   response shape and idempotent replay are verified from the schema only.
2. Evidence that a 7-day exhaustion occurred for Codex while `availableCount`
   was above 0. The read shows 0 on the account checked. The four orchestra
   databases do not record `availableCount`.
3. The root's decision on whether the banked count, read per cycle, goes into
   `usage_windows` or into a new column beside the account.

## Limits

- For Codex the count is readable (`availableCount`). For the other providers no
  count is readable, so the design does not depend on a count there: a spend is
  attempted only where a route is verified, and the provider's answer decides.
- Spend availability and expiry are provider decisions. This design does not
  assume a reset is available when a spend is attempted.
- Confirmation through rollouts reads the provider's own usage fields. It does
  not show whether the provider applied the reset to all covered allowances.
