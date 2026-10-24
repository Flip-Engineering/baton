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
   returns one SQL `SELECT` whose single value is a JSON array of window objects
   taken from the provider's response text:

   ```json
   {"window":"5-hour","usedPercent":3,"resetsAt":1792820715847,"exhausted":false}
   ```

   `window` is the provider's window name normalized to `5-hour`, `7-day`,
   `monthly` or `balance`. `usedPercent` is the provider's number, or null.
   `resetsAt` is the provider's reset instant in UTC milliseconds, or null.
   Convert seconds to milliseconds in the parser. `exhausted` is the provider's
   own statement where one exists (Codex `rateLimitReachedType`, a balance at or
   below zero), otherwise `usedPercent >= 100`. A focused fixture runs the parser
   through the sqlite host over a recorded response.

2. The effect. `usage-read PROVIDER CREDENTIAL_REF` is a native helper that
   is installed beside `api-key-exec`. It performs one read and prints one JSON
   line:

   ```json
   {"schema":"baton2-usage-read-v1","provider":"zai","source":"GET https://api.z.ai/api/monitor/usage/quota/limit","observedAt":1792812155000,"state":"read","windows":[...]}
   {"schema":"baton2-usage-read-v1","provider":"muse","source":"...","observedAt":1792812155000,"state":"unreadable","reason":"..."}
   ```

   The helper reads the credential from the named reference inside the request
   and never prints it. `CREDENTIAL_REF` forms: `omp-models:BLOCK` (the `apiKey`
   field of provider block `BLOCK` in `~/.omp/agent/models.yml`), `file:PATH`,
   `keychain:SERVICE/ACCOUNT` (the forms `claude-credit-observe` resolves), and
   `codex-home:PATH` (Codex app-server `account/rateLimits/read` with that
   `CODEX_HOME`). A transport failure, an HTTP status other than 2xx, or a
   response the parser cannot read prints `state:"unreadable"` with the exact
   reason. The helper exits 0 for both states and exits 2 only for a bad
   invocation.

The Bend types for the decoded read are in
`bend2/src/coordinator/usage-reads.bend`.

## Recording and the hold decision

Each read inserts one `usage_reads` row per window, or one row with
`state='unreadable'`. The rows carry the provider, the account label, the
window, `used_percent`, `resets_at` from the provider, `exhausted`, the source,
the trigger and the reason. A row never expires.

The seat's gate reads the newest read for the seat's provider and account:

- some window `exhausted`: `Held`;
- `unreadable`: `Unknown` with the reason. The input is admitted and the
  orchestrator receives the reason. Baton does not hold on an unknown;
- otherwise: `Open`.

## Read triggers

A read runs on these events and on no schedule:

- a provider exhaustion terminal (a 429, a quota message or a balance error);
- an input addressed to a seat whose newest read is `Held`;
- the `resetsAt` of the newest exhausted read passing. A held wake starts one
  detached continuation that sleeps until that instant and then runs the wake.
  The wake performs a read. The continuation has no fixed cap. A read without
  `resetsAt` starts no continuation;
- `usage-window-refresh SESSION` (the operator or a resumed coordinator asks for
  a read).

## Announcements and admission

A read that changes a seat from `Open` or `Unknown` to `Held` reports the hold
to the seat's orchestrator and to the root. A read that changes a seat from
`Held` to `Open` reports the release to both and wakes every seat on the same
provider and account that has owed input. The input is admitted on its retained
assignment (#1020). Message identities derive from the read row and the seat,
so a repeated wake after a crash adds no second message. A duplicate is
acceptable.

A read never stops, pauses or truncates a running agent. It only decides
whether owed input starts a new turn.

## Provider readers

| Provider | Live usage API | Owner |
|---|---|---|
| z.ai | `GET https://api.z.ai/api/monitor/usage/quota/limit`, Bearer key. `data.limits[]` with `type` `TOKENS_LIMIT`, `unit` 3 (5-hour, `number` 5) and 6 (weekly), `percentage`, `nextResetTime` (UTC ms). Also `TIME_LIMIT` unit 5 for tool calls (`usage`, `currentValue`, `remaining`). `data.level` names the plan. | lead |
| Codex | `codex app-server` JSON-RPC `account/rateLimits/read` after `initialize`. `rateLimits.primary` and `secondary` carry `usedPercent`, `windowDurationMins` (10080 = 7-day, 300 = 5-hour) and `resetsAt` (Unix seconds). Also `rateLimitReachedType`, `ordinaryUsageAllowed`, `credits` and `rateLimitResetCredits.availableCount`. | lead |
| DeepSeek, Kimi, Claude Max, Claude API credit, Muse | Researched and probed by the provider seat. | provider seat |
