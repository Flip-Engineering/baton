# Provider usage holds from live reads (#1025)

A provider-held seat is held and released only by a live read of that
provider's usage API. This document defines the read interface that each
provider reader implements and the core that records reads, decides holds and
announces them.

## Observed failure

On 2026-10-23 Baton stored z.ai's UTC+8 reset time from 429 error text as
08:03:26Z instead of 00:03:26Z. Four GLM seats stayed held about 8 hours after
the quota had returned. A live read at that time reported 3% of the 5-hour
window and 20% of the weekly window used. The operator also spent z.ai reset
cards and Codex applied a reset on its own; no recorded timer could observe
either change.

## Decision inputs

The hold decision reads one source: the `usage_reads` rows written by live
reads. The following are evidence only and never hold or release a seat:

- reset times parsed from provider error text (`usage_windows`
  `reset_source='provider-message'`);
- the 5-hour and 7-day window bounds and the one-hour re-probe instant;
- operator-entered reset times (`usage-window-observe`, `usage-window-reset`);
- a successful attempt (`provider-success` rows).

## Read interface

A reader has two parts.

1. A pure parser `def <provider>_windows_sql(+response: String) -> String`. It
   returns one SQL `SELECT`, without a trailing semicolon, whose single value is a
   JSON array of window objects taken from the provider's response text:

   ```json
   {"window":"5-hour","usedPercent":3,"resetsAt":1792820715847,"exhausted":false}
   ```

   `window` is the provider's window name normalized to `5-hour`, `7-day`,
   `monthly` or `balance`. A window that limits only some models carries the model
   scope after a colon, for example `7-day:opus`; it holds only seats whose recorded
   model contains the scope. `usedPercent` is the provider's number, or null.
   `resetsAt` is the provider's reset instant in UTC milliseconds, or null.
   Convert seconds to milliseconds in the parser. `exhausted` is the provider's
   own statement where one exists (Codex `rateLimitReachedType`, a balance at or
   below zero), otherwise `usedPercent >= 100`. The core uses `exhausted` as the
   exhaustion decision, including an explicit `false` at 100 percent. A focused
   fixture runs the parser through the sqlite host over a recorded response. A second function
   `<provider>_problem_sql(+response)` answers the reason a response cannot be read,
   or the empty text.

2. The effect. `usage-read PROVIDER CREDENTIAL_REF` (`bend2/harness/usage-read.bend`)
   is a native helper that is installed beside `api-key-exec`. Each provider is one
   branch of `read_provider`. It performs one read and prints one JSON line, built
   with `UR.read_document_sql` and `UR.unreadable_document` from
   `bend2/src/coordinator/usage-reads.bend`:

   ```json
   {"schema":"baton2-usage-read-v1","provider":"zai","source":"GET https://api.z.ai/api/monitor/usage/quota/limit","observedAt":1792812155000,"state":"read","windows":[...]}
   {"schema":"baton2-usage-read-v1","provider":"muse","source":"...","observedAt":1792812155000,"state":"unreadable","reason":"..."}
   ```

   The helper reads the credential from the named reference inside the request
   and never prints it. `CREDENTIAL_REF` forms: `omp-models:BLOCK` (the `apiKey`
   field of provider block `BLOCK` in `~/.omp/agent/models.yml`), `omp-auth:PROVIDER`
   (the `key` field of the provider's newest enabled row in `~/.omp/agent/agent.db`
   table `auth_credentials`, opened read-only; a disabled row answers its
   `disabled_cause`), `claude-oauth:PATH` (`claudeAiOauth.accessToken` of a Claude Code
   credentials file, `~/.claude/.credentials.json` when `PATH` is empty; an expired
   token is reported and never refreshed, because a refresh writes the account's
   credentials. The account's own Claude Code login renews the token, and the
   unreadable report names it. Until then the read is unknown and the seat is not
   held), `file:PATH` (the first line of `PATH`) and
   `codex-home:PATH` (Codex app-server
   `account/rateLimits/read` with that `CODEX_HOME`; an empty `PATH` inherits the
   environment). The coordinator chooses the reference: an `accounts` row with
   `api_key` funding passes its `secret_ref`, a Codex subscription account passes
   `codex-home:` with its store, a Claude Code subscription account passes
   `claude-oauth:` with the store's `.credentials.json`, and otherwise the provider's
   default applies (`zai` and `kimi-code` use `omp-models:` with the provider name,
   `deepseek` uses `omp-auth:deepseek`, `codex` uses `codex-home:` and `claude` uses
   `claude-oauth:`).

   An HTTP reader plugs into the helper as four functions: `source()`, `request(key)`
   (one `Http.request` with the credential in its headers), `windows_sql(response)`
   (whose value is NULL for a response it cannot read) and `problem_sql(response)`.
   `read_http` in the helper resolves the credential, makes the request, checks the
   HTTP status and builds the document. The helper answers unreadable for an
   Anthropic API-credit account (no documented endpoint for the remaining API credit
   balance was found) and for Muse (no authenticated usage endpoint was identified
   for the configured API key). A transport failure, an HTTP status other than 2xx, or a
   response the parser cannot read prints `state:"unreadable"` with the exact
   reason. The helper exits 0 for both states and exits 2 only for a bad
   invocation.

The schema name and the document builders are in
`bend2/src/coordinator/usage-reads.bend`.

## Recording and the hold decision

Each read inserts one `usage_reads` row: the provider, the account label, the seat
whose event started it, the trigger, the state (`read` or `unreadable`), the source,
the reason of an unreadable read, and the helper's document. The windows stay in the
document. `observed_at` records the helper's `observedAt` clock; a helper failure
without a document records the coordinator clock. Reads are serialized per provider
and account through the physical database lock. Each decision orders observations
by `observed_at`, then row identity. An insert failure propagates its database
cause and ends the admission. A row never expires.

The seat's gate derives its state from these rows for the seat's provider and
account:

- `Held` when the newest `read` row has an exhausted window that applies to the
  seat's model. An `unreadable` row
  after it keeps the hold, because only a readable read releases it;
- `Unknown` when the newest row is `unreadable` and no hold stands. The input is
  admitted and the orchestrator receives the reason. Baton does not hold on an
  unknown;
- `Open` otherwise.

## Read triggers

One read serves every seat on a provider account: several seats on one z.ai plan
share each read. A read runs on these events:

- a provider exhaustion terminal (a 429, a quota message or a balance error) reads
  the refused account at once;
- every admission reads the seat's own provider and account;
- a held wake starts a detached continuation when the provider reports a reset of
  the held window strictly in the future. It sleeps until that instant and enters
  the wake path, which reads the provider again. A passed or absent reset is
  reported to the orchestrator with the owed message; the orchestrator can request
  `usage-window-refresh` or deliver further input;
- `usage-window-refresh SESSION`.

## Announcements and admission

A hold episode starts at the first exhausted readable read after the last open one.
When a seat's gate finds the seat `Held`, Baton reports the hold to the seat's
orchestrator and, as a second message, to the root of the seat's parent chain:
`usage-read:EPISODE:hold:SEAT` and the same identity with `:root`. An unreadable read
is reported the same way as `usage-read:READ:unreadable:SEAT`.

A read that ends a hold reports `usage-read:EPISODE:release:SEAT` for every seat that
reported that hold on the provider and account being read. It launches each other
seat's first owed input through the wake entry in a detached process before
recording the release. A failed launch reports its cause and leaves the hold
eligible for another release attempt. A crash after launch can repeat the wake.
The input is admitted on its retained assignment (#1020). A seat whose gate finds
no hold also reports any of its holds on that account that have no release, so a crash between the read and the announcement is repaired at the seat's
next gate. The identities derive from the read rows and the seat, so a repeated gate
adds no second message.

A read never stops, pauses or truncates a running agent. It only decides whether
owed input starts a new turn.

## Provider readers

| Provider | Live usage API | Owner |
|---|---|---|
| z.ai | `GET https://api.z.ai/api/monitor/usage/quota/limit`, Bearer key. `data.limits[]` with `type` `TOKENS_LIMIT`, `unit` 3 (5-hour, `number` 5) and 6 (weekly), `percentage`, `nextResetTime` (UTC ms). Also `TIME_LIMIT` unit 5 for tool calls (`usage`, `currentValue`, `remaining`). `data.level` names the plan. | lead |
| Codex | `codex app-server` JSON-RPC `account/rateLimits/read` after `initialize`. `rateLimits.primary` and `secondary` carry `usedPercent`, `windowDurationMins` (10080 = 7-day, 300 = 5-hour) and `resetsAt` (Unix seconds). Also `rateLimitReachedType`, `ordinaryUsageAllowed`, `credits` and `rateLimitResetCredits.availableCount`. | lead |
| DeepSeek | `GET https://api.deepseek.com/user/balance`, Bearer key from `omp-auth:deepseek`. `is_available` and `balance_infos[].total_balance`; one `balance` window, exhausted when unavailable or every balance is zero. | provider seat |
| Kimi Code | `GET https://api.kimi.com/coding/v1/usages`, Bearer key from `omp-models:kimi-code`. `usages.limit_5h` and `usages.limit_7d` with `used_ratio` and `reset_time`. | provider seat |
| Claude Max | `GET https://api.anthropic.com/api/oauth/usage` with the OAuth access token and `anthropic-beta: oauth-2025-04-20`. `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` with `utilization` and `resets_at`. | provider seat |
| Claude API credit | No documented endpoint for the remaining API credit balance was found; unreadable. | helper |
| Muse | No authenticated usage endpoint was identified for the configured API key; unreadable. | helper |
