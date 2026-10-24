# Account order fallback (#1059)

When a provider refuses a seat's account with usage exhaustion, Baton moves the
seat to the next available account in the operator's account order and resumes the
seat's retained input on it. When no account in the order is available, the seat
holds with its input owed, and the hold is announced.

## Observed failure

On 2026-10-24 the Riff conductor `riff-backlog-conductor-20261019` ended its turn
on `claude-credit-primary` with "Credit balance is too low". The orchestra's
operator profile list (`orchestra.db.profiles`) named `claude-max-primary` and then
`claude-max-incognito`. The seat's profile record named `claude-credit-primary`,
which the list did not contain. `next_profile_available` scans only the list
entries after the current label, and for an unlisted label there are none. Baton
reported `profile-exhausted`, then `route-unavailable` because no `.routes` file
exists, and the turn settled as a failure with exit 1. The record still named the
credit account, and the usage gate did not hold an account refused without a reset
time. Each later input relaunched the seat on the credit account, which refused
again. The Riff database holds 75 such reports. `riff-issue33-sonnet-20261023` and
`acp-ax-fresh-haiku-20261023` were bound the same way.

## The order

The order is the `accounts` table of the orchestra database, read through
`account_row_sql` (by `priority` from #1011, then by recording order). For a harness
with recorded accounts this is the only order. A harness with no recorded accounts
(codex, omp and muse today) keeps the operator profile list `DATABASE.profiles`.

The operator's Claude order is:

| Priority | Account | Funding |
| --- | --- | --- |
| 1 | `claude-credit-primary` | `api_key` (promotional credit) |
| 2 | `claude-credit-incognito` | `api_key`, used only after its auto-reload is confirmed off |
| 3 | `claude-max-incognito` | `subscription` |
| 4 | `claude-max-primary` | `subscription`; the root uses it, so it is last |

Credit expiry dates are recorded as information. They are not an input to the
order or to admission.

## Selecting the next account

On a refusal, Baton scans the order from its head and gives each entry one state:

| State | Meaning | Effect |
| --- | --- | --- |
| refused | the account that just refused | skipped |
| not launchable | an Anthropic `api_key` account while the promotional-credit guard is false | skipped |
| held | the account's usage gate is held | skipped |
| open | no hold | the seat moves here |
| unknown | the usage read could not be read and no hold stands | the seat moves here |

The scan starts at the head. A seat whose current label is not a recorded account
still reaches the listed accounts, and an account that a usage read reopens regains
its place ahead of later entries. The scan stops at the first open or unknown entry,
so no usage read runs for later entries.

A move:

1. prepares the native history for the next account's store when the seat has a
   native conversation, using the same helper as the profile handoff;
2. appends the next account to the session's account record
   (`DATABASE.account-<hex session>`), which the next launch binds;
3. announces the move.

When the preparation or the append fails, the account is not advanced and the
failure is reported with its cause.

## Holding

When no entry is open or unknown, the seat keeps its current binding, its input
stays owed, and Baton announces the hold. The seat is not stopped. A usage read that
opens any listed account resumes the seat on the first available account.

## Announcements

Each announcement goes to the seat's orchestrator and, under the same identity
with `:root` appended, to the root of the seat's parent chain when that root is a
different session.

- Move, identity `ATTEMPT:account-move`:
  `account move: seat S (claude-code) moved from claude-credit-primary to claude-max-incognito, entry 3 of 4 in the operator order. Entry states: 1 claude-credit-primary refused: provider-reported usage exhaustion: Credit balance is too low; 2 claude-credit-incognito not launchable: promotional-credit guard is false; 3 claude-max-incognito open: .... Owed input resumes on claude-max-incognito.`
- Hold, identity `REFUSAL:account-hold`, one for each refusal identity:
  `account order held: seat S (claude-code) has no available account in the operator order. Entry states: .... Owed input stays queued. A usage read that opens any listed account resumes the seat on it.`

## One-time account rows

The Riff, render-fframes and flip orchestra databases record only the two
`api_key` credit accounts. The fallback needs one row for each account in the
order, with its priority:

```
account --action record --id claude-max-incognito --provider anthropic --harness claude-code --funding subscription --secret-ref STORE
account --action record --id claude-max-primary --provider anthropic --harness claude-code --funding subscription --secret-ref STORE
```

The `priority` value for each row is written as #1011 defines it.

The store is the `CLAUDE_CONFIG_DIR` directory already named for that label in the
orchestra's `.profiles` file. These rows are operator data. They are recorded once
per orchestra database, and a seat move needs no further configuration.

## Limits

- The credit accounts stay unlaunchable while the promotional-credit guard is
  false. This change does not alter the guard.
- Native history is not prepared for a seat with no native conversation.
