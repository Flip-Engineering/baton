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

The Riff, render-fframes and flip-brusharena databases have this Claude order
after the incognito subscription row is recorded:

| Priority | Account | Funding |
| --- | --- | --- |
| 2 | `claude-credit-incognito` | `api_key` |
| 3 | `claude-max-incognito` | `subscription` |
| empty | `claude-credit-normal` | `api_key` |

The older profile records can name `claude-credit-primary`, which has no account
row. The operator's rule leaves `claude-max-primary` unrecorded. If that account
is later recorded, it requires an open live read at every position in the order.

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
| unknown | the usage read could not be read and no hold stands | the seat moves here, unless the account is `claude-max-primary` |

`claude-max-primary` is taken only when its live read says open. An unknown
incognito read permits the move even when incognito is last. The Claude reader
reports an expired OAuth token as unknown; the resumed Claude Code process can
renew its own credentials.

A provider refusal for a Max account's extra-usage limit ("You've hit your monthly
spend limit") is usage exhaustion of that account. The scan treats the account as
refused, and its live read decides whether it is held. Baton never raises the limit,
enables extra usage or buys credit.

The scan starts at the head. A seat whose current label is not a recorded account
still reaches the listed accounts, and an account that a usage read reopens regains
its place ahead of later entries. The scan stops at the first eligible open or unknown entry,
so no usage read runs for later entries.

A move:

1. prepares the native history for the next account's store when the seat has a
   native conversation, using the same helper as the profile handoff;
2. commits the selection notices for the orchestrator and root in one database
   transaction;
3. appends the next account to the session's account record
   (`DATABASE.account-<hex session>`);
4. reads `current_account` and verifies that it names the selected account before
   launch.

A preparation or append failure keeps the input owed and records its cause. A
required move that fails ends the launch attempt. A failed announcement transaction
leaves the binding unchanged and returns the database error. The final launch gate
checks the account in force.

## Holding

When no entry is open or unknown, the seat keeps its current binding, its input
stays owed, and Baton announces the hold. The seat is not stopped. A usage read that
opens any listed account resumes the seat on the first available account.

## Announcements

Each announcement goes to the seat's orchestrator and, under the same identity
with `:root` appended, to the root of the seat's parent chain when that root is a
different session. The selection notices commit before the account binding changes.
They describe the selected move; binding verification determines launch.

- Selection, identity `ATTEMPT:account-move`:
  `account move: seat S (claude-code) selected move from claude-credit-primary to claude-max-incognito, entry 2 of 3 in the operator order. Entry states: .... The binding is verified before owed input resumes on claude-max-incognito.`
- Hold, identity `REFUSAL:account-hold`, one for each refusal identity:
  `account order held: seat S (claude-code) has no available account in the operator order. Entry states: .... Owed input stays queued. A usage read that opens any listed account resumes the seat on it.`

## One-time account rows

The Riff, render-fframes and flip orchestra databases record only the two
`api_key` credit accounts. The operator's standing host rule is that Claude seats
run on `claude-max-incognito` and that no seat is bound to `claude-max-primary`.

At deploy, one row is recorded in each orchestra database:

| id | provider | harness | funding | secret_ref | priority |
| --- | --- | --- | --- | --- | --- |
| `claude-max-incognito` | `anthropic` | `claude-code` | `subscription` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.claude-max-incognito` | 3 |

```
account --action record --id claude-max-incognito --provider anthropic --harness claude-code --funding subscription --secret-ref /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.claude-max-incognito
```

`accounts_priority_ensured` from #1011 writes priority 3 to this id where the
priority is still empty. The unprioritized `claude-credit-normal` row sorts after
incognito. A seat refused on incognito holds when the other entries are
unlaunchable, and a live read that opens incognito resumes it.

The `claude-max-primary` row (priority 4, `secret_ref`
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.claude`) is recorded only after the
operator withdraws the rule. Until then no row names it, so the scan never reaches
it. The fixtures in `bend2/test/account-order-fallback.py` cover the deployed rows,
incognito as the last entry, expired OAuth credentials, primary at different
positions, history and binding failures, and announcement transaction failures.
The release fixture receives a completion frame through a FIFO.
Its focused compiler entry is `bend2/test/account-order-entry.bend`.

## Limits

- The credit accounts stay unlaunchable while the promotional-credit guard is
  false. This change does not alter the guard.
- Native history is not prepared for a seat with no native conversation.
- This branch includes the #1063 Claude reader. Deployment fixtures use its
  credential resolution and response parsing, with a fixture response for the
  HTTP request. They perform no provider network request.
