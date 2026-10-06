# Provider change, quota state and failover: review of #678, #680, #681, #683

Date 2026-10-06. This review covers the native coordinator's provider-selection and
continuation behaviour against issues #678, #680, #681 and #683. It records what the
source does, the evidence behind each acceptance gap, and scoped findings. `bend2/src`
is untouched by this review.

## Pins

| Item | Value |
| --- | --- |
| Installed coordinator | `/Users/wahargis/.local/bin/baton2` → `1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561` |
| Reviewed source | `bend2/` at `2cc57690ac159db6f2077b4881352a8976add2c2` |
| Source equivalence | `git diff fca7af87 2cc57690 -- bend2/src` is empty; the two commits differ only in `bend2/trial/associate-conductor-instructions.md` and `bend2/trial/principal-conductor-instructions.md` |
| Live database | `/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/baton2-audit-followups-20261004/orchestra.db`; the running coordinator writes to it, so counts move between reads |
| Compiler | `bend2/scripts/run-checks.mjs:9,35` requires `bend 2.0.25`; compiler checks run on the remote validation runners; `bend` is not on this host's `PATH` |
| Model-key registry | `$HOME/.config/baton/github-apps/series.json`, resolved by `bend2/src/host/control.c:38-64` |

All `bend2/...` line numbers below are from the reviewed source at `2cc57690`.

## 1. Writes to an existing session

| Operation | Columns written on an existing row | Admission |
| --- | --- | --- |
| `recruit` (`Player`) | none: `ON CONFLICT(id) DO NOTHING` (`commands.bend:139`) | refuses when the row exists and any of `parent`, `harness`, `model`, `effort`, `workspace`, `branch`, `base` differs → `player-assignment-conflict` (`commands.bend:136-142`) |
| `attach` | `harness`, `native`, `endpoint`, and only while `parent IS NULL` (`commands.bend:276`) | a row with a parent fails `id TEXT PRIMARY KEY NOT NULL` through `id=CASE WHEN sessions.parent IS NULL THEN sessions.id ELSE NULL END` |
| `connect` | `native`, `endpoint` (`commands.bend:149-150`) | `endpoint_admitted` |
| `bind` | `native`, `observed_harness`, `observed_model`, `observed_effort` (`commands.bend:282-283`) | none |
| `start` (Principal) | `model`, `effort`, `workspace`, `endpoint` (`control.bend:132-140`) | `principal_matches`: `parent IS NULL`, harness equal, and each of `model`/`effort`/`workspace` empty or equal (`control.bend:126-127`) |
| `receiver` | `endpoint` (`control.bend:104-105`) | `harness IN ('codex','omp')`, not stopped, argv admitted; the endpoint embeds the **recorded** model (`control.bend:101-122`) |
| `receive` | none (`receive.bend:183-205`) | `harness IN ('omp','codex')` (`receive.bend:191-192`); a stopped session is refused (`receive.bend:252`) |
| `turn` | none (`turn.bend:355-361`) | `parent IS NOT NULL`, `workspace<>''`, `harness IN ('codex','omp','muse','claude-code')` (`turn.bend:477-480`) |
| `stop` | inserts `session_stops`; no statement deletes that row (`stop.bend:41-44`) | — |
| `ack` | `messages.receipt` only | — |

`model` and `effort` have no writer on an existing session that has a parent. `harness`
has one writer there, `attach`, which refuses a parented row. `start` writes
`model`, `effort` and `workspace` for a parentless session while each column is empty or
equal.

`observed_harness`, `observed_model` and `observed_effort` are read only by the
`session`/`status`/`players` projections (`commands.bend:130-133`, `:266-268`,
`:300-302`).
No launch path reads them.

## 2. Live evidence

### 2.1 Observed identity is unpopulated

```sql
SELECT count(*) AS total,
       SUM(COALESCE(observed_harness,'')='') AS obs_harness_empty,
       SUM(COALESCE(observed_effort,'')='')  AS obs_effort_empty,
       SUM(model<>'' AND COALESCE(observed_model,'')='') AS model_no_obs,
       SUM(model<>'' AND observed_model<>model) AS differing
FROM sessions;
-- total=113 | obs_harness_empty=113 | obs_effort_empty=113 | model_no_obs=20 | differing=0
```

`baton2 "$DB" session recovery-quota-failover-review-20261006` prints
`"observedHarness":"","observedModel":"deepseek/deepseek-flash","observedEffort":""` for
the seat that wrote this review. `observed_model` matches `model` on every row where it is
present; no row records an observation that differs from the configured value.

### 2.2 A per-attempt route override is used but not recorded

`receive` and `turn` accept `MODEL` and `EFFORT`, and a non-empty value replaces the stored
one for that launch: `field` (`receive.bend:14-16`) feeds `route`/`thinking`
(`receive.bend:191-196`), which reach `Turn.retained` (`turn.bend:355-361`) and the adapter
argv (`src/harness/omp-player.bend:21-22`, `src/harness/codex-player.bend:5-6`). `receive`
issues no `UPDATE sessions`. Automatic endpoint deliveries pass empty model/effort/cwd
(`control.bend:26-27`), so they keep the stored route.

### 2.3 The model-key registry maps Git identities

`bend2/harness/git-series.mjs` `selected_identity` requires `registry.models` and
`registry.series` (`:40-43`); `check` (`:215-217`) is what `control.bend:44-45` runs before
an endpoint is built.

```console
$ node bend2/harness/git-series.mjs check --registry ~/.config/baton/github-apps/series.json --model-key zai/glm-5.3-flash
$ echo $?
0
$ node bend2/harness/git-series.mjs check --registry ~/.config/baton/github-apps/series.json --model-key zai/glm-5.3
Series Git operation refused: Select an explicitly configured model mapping or registered series.
$ echo $?
1
```

The registry holds five model keys (`gpt-6-astra`, `kimi-code/k3`,
`deepseek/deepseek-flash`, `muse-spark-1.3-contributor`, `zai/glm-5.3-flash`) over six
series; `zai/glm-5.3` has no entry. The refusal names a missing Git identity mapping.

### 2.4 The harness reports model metadata that the coordinator discards

A recorded live OMP `get_state` response
(`.scratch/semantic-context-20261005/logs/acceptance-research.jsonl`) carries a full model
object:

```json
{"type":"response","command":"get_state","success":true,"data":{"model":{"id":"glm-5.3-flash","name":"GLM-5.3-Flash","api":"openai-completions","provider":"zai","baseUrl":"https://api.z.ai/api/coding/paas/v4","reasoning":true,"input":["text","image"],"cost":{"input":0.15,"output":0.5,"cacheRead":0.03,"cacheWrite":0},"contextWindow":1000000,"maxTokens":131072,"thinking":{"mode":"effort","efforts":["low","high","max"]},"identity":{"class":"glm","family":"flash","revision":"5.3.0"},"supportsTools":true,"compat":{...}},"thinkingLevel":"high","sessionId":"01a10b28-1256-77ba-949d-d26293472f73"}}
```

`observe_identity_sql` (`commands.bend:175-176`) extracts `$.data.sessionId` and the
provider/id pair only. `cost`, `contextWindow`, `maxTokens`, `thinking.efforts`, `identity`
and `compat` are dropped. The object contains no quota or reset value.

### 2.5 Retained input at the four quota stops

```sql
SELECT m.recipient, m.kind, count(*) FROM messages m
JOIN session_stops s ON s.session=m.recipient
WHERE m.receipt IS NULL GROUP BY 1,2 ORDER BY 1,2;
-- audit-kimi        report 200
-- semantic-controls question 2, report 277
-- semantic-lead     note 1, question 7, report 102
-- semantic-review   question 61, report 586
```

The same query returned 1,236 unacknowledged inputs in total, held across `audit-kimi`,
`semantic-controls`, `semantic-lead` and `semantic-review`. The running coordinator
writes to this database, so the counts move between reads; the query above is the
reproduction. Each `session_stops.reason` begins `K3 subscription
quota exhausted;` and names a successor (`native-receive-conductor`, `semantic-controls-next`,
`semantic-synthesis`, `semantic-quality`). No message in the database records the K3
subscription becoming usable again: probes for `now usable`, `became usable`, `found
usable`, `provider recovered`, `usable again` all return zero rows. The only explicit
failure records are `messages.seq 911` (`"error":{"message":"quota exceeded"}` with
`errorStatus:403`) and `seq 9977` (`provider quota limit (HTTP 429)`).

## 3. Acceptance gaps

**G1 — #678: no operation changes the configured route of an existing Player.**
`recruit` refuses a model-only change; `connect` writes `native`/`endpoint`; `bind` writes
`observed_*`; `attach` refuses a parented row and never writes `model`/`effort`; `start`
requires `parent IS NULL` and empty-or-equal values.
*Reproduction:* `bend2/test/recruit.py:112-127` pins `model` → `player-assignment-conflict`
with the session state unchanged.

**G2 — #678/#681: a route override is consumed but never recorded.**
`receive`/`turn` accept `MODEL`/`EFFORT` and launch with them (§2.2) while writing no
`sessions` column, so the next automatic delivery returns to the stored route and no
transition record exists.
*Reproduction:* `receive.bend:14-16` and `:191-196` against the sole `UPDATE sessions` sites
(`commands.bend:150,176,283`; `control.bend:105,134,138`; `receive.bend:113`).

**G3 — #681: no failover; a stopped seat cannot execute its retained input.**
The verb list (`bend2/src/coordinator/commands.bend:355-389`, confirmed by
`baton2 "$DB" help`) contains no failover or continuation verb. `session_stops` has no
delete path (`stop.bend:10-16`; grep for `DELETE FROM session_stops` over `bend2/src`
returns none), and `Stop.admit` returns false once a row exists
(`receive.bend:204`, `:252`). `task`, `guidance` and `recovery` inputs to a stopped
recipient are refused with `session-stopped` (`commands.bend:97-98`, `:218-221`);
`report` and `question` are re-addressed to the parent as `stopped-input:<hex>`
(`delivery.bend:39-41`). Pending input stays in the stopped seat's inbox, and `wake_sql`
excludes stopped seats (`delivery.bend:97`).
*Reproduction:* the pending rows in §2.5 (1,236 at the read), and
`SELECT session,outcome FROM session_stops;` → four `stopped` rows.

**G4 — #680/#683: no capacity, quota, reset or observation-time value exists.**
`ObservedUsage` (`commands.bend:43,363`; `main.bend:122-123`) is implemented by
`usage.bend`, whose stated contract is a projection of the session's recorded conversation
file (`usage.bend:1-5`, `:269-283`); it projects token and cost components
(`usage.bend:91-101`, `:196-233`). A case-insensitive search for
`quota|reset|capacity|window|subscription` over `bend2/src` returns no provider-capacity
field. The schema (`commands.bend:86-92`) has no capacity, probe or transition table.
*Reproduction:* `baton2 "$DB" observed-usage recovery-quota-failover-review-20261006`
returns keys `session, harness, native, source, shape, records, observations,
duplicates, conflicts, malformed, routes, observed, cost` (plus `absent`, `invalid`),
with `routes:[{"provider":"deepseek","model":"deepseek-flash","api":"openai-completions","observations":52}]`
and no capacity, quota, reset or observation-time key.

**G5 — #683: the only model registry is a Git-identity map, and live capability metadata is discarded.**
The registry lookup of §2.3 answers "does a configured Git identity exist for this model
key", and its refusal is a configuration refusal. The live `get_state` model object of §2.4
is the only harness-supplied model metadata recorded on this host, and
`observe_identity_sql` keeps two fields of it.
*Reproduction:* the two `git-series.mjs check` invocations in §2.3, and
`commands.bend:175-176` against the recorded `get_state` payload.

**G6 — #680: a stored provider failure and a current one are indistinguishable.**
No error-classification token (`quota`, `429`, `rate_limit`, `provider_unreachable`) exists
in `bend2/src`. The single attempt-local freshness rule is the OMP conversation-gone text:
`refusal_body` (`turn.bend:408-410`) matched against the current attempt's
`log ++ ".stderr"` (`turn.bend:417-422`; `receive.bend:145-147`), pinned by
`bend2/test/receive.py:765-789`. A quota frame does not match it and takes the
complete-attempt path with the raw event retained.
*Reproduction:* §2.5's zero-result probes for a recorded return to usability.

**G7 — the candidate `delivery.bend` refactor fails the pinned entry check.**
Branch `codex/baton2-audit-native-20261004` at `788ca1f8` (working tree
`.../baton2-audit-followups-20261004/worktrees/native`, not pushed) adds two types that
each declare a constructor named `Refused`:

```bend
type ReportOutcome is Data:
  Refused{code: U32, selected: String, recipient: String, disposition: String, detail: String}
  Reached{...}

type ReportRouting is Data:
  Accepted{}
  Refused{}
  Retained{}
  Stopped{}
```

Recorded compiler output (`/tmp/item1-compile.log`):

```
Error:
- expected : a fresh constructor name (duplicate declaration: delivery.Refused)
- observed : '{'
Location:
21 |   Accepted{}
22>|   Refused{}
23 |   Retained{}
```

The base `bend2/src/coordinator/delivery.bend` at `2cc57690` contains no `Refused`.
*Reproduction:* run the coordinator entry check with the pinned toolchain
(`bend2/scripts/run-checks.mjs`, `bend 2.0.25`) inside that worktree.

**G8 — the candidate designs are documents.**
`integration-failover-681.md`, `integration-683-design.md`, `integration-683-adapters.md`,
`integration-683-surface.md`, `integration-683-usability.md`, `integration-683-verify.md`
and the #682 plan/view/verify set under
`.../semantic-context-20261005/reports/` contain no implementation: a grep of `bend2` for
`failover|session_transitions|provider_probe|provider-probe|continuation-capacity` returns
zero hits, and the `commands.bend` verb table has no such verb. The #681 document cites
line numbers that map to a different revision of the same file (for example `player_sql`
is at `:139`, cited as `:129`; `observe_identity_sql` at `:175`, cited as `:186`;
`Bind` at `:282`, cited as `:277`). The #683 documents cite `2cc57690` lines that match this
tree. `integration-682-verify.md` states that `observe_identity_sql` writes
`observed_harness`/`observed_effort`; `bind` is the sole writer (`commands.bend:283`) and
§2.1 shows both columns empty on every session.

## 4. Scoped findings

| # | Finding | Scope | Done when |
| --- | --- | --- | --- |
| F1 | Add one guarded configured-route operation for an existing session: `UPDATE sessions SET harness,model,effort[,native][,observed_*][,endpoint] WHERE id AND harness=<expected> AND model=<expected> AND effort=<expected>` in the `player_matches` style, with the endpoint rebuilt through `Control.configured_endpoint` so `identity_check` (`control.bend:44`) and `endpoint_admitted` (`commands.bend:146`) still hold. Keep the statement set free of `messages`/`turns`/`executions`/`session_stops` so retained input survives. | #678 (configuration) and #681 (post-failure) share the core; #681 adds the exited-attempt precondition | a Player with a parent changes `model` and the next `receive` launches the new model; `inbox` is unchanged |
| F2 | Persist the per-attempt route so a change is a recorded fact, or refuse a non-empty `MODEL`/`EFFORT` on `receive`/`turn` while the route is unchanged. Today the override is applied and discarded. | `receive.bend:14-16`, `:191-196` | a `session` read after a `receive`-override shows either the new route or a refusal |
| F3 | Decide the resumption path for a stopped seat. `session_stops` is terminal by construction, so retained input at a stopped seat executes only through a new seat. State the rule: either an operation clears the stop for the same identity, or the successor seat's route is the only path and pending input is explicitly handed to it. | #680/#681; affects the retained input measured in §2.5 | one quota-stopped seat's retained input executes without a manual `DELETE` |
| F4 | Extend the identity observation to retain the harness-supplied model object already present on OMP `get_state`: `cost`, `contextWindow`, `maxTokens`, `thinking.efforts`, `identity`, `compat`, with the observation time and an explicit unknown state. This is the only live provider metadata on the host. | #683; `commands.bend:175-176` | a stored observation carries fields the configured model key does not |
| F5 | Keep four facts separate in any discovery read: harness capability (adapter exists), configured model key (registry/`recruit`), configured alias (Git identity), and account access/capacity (harness report). A registry refusal states a missing Git identity, and no more. | #680/#683 | a read distinguishes the four; `zai/glm-5.3` reports a missing identity mapping and no availability claim |
| F6 | Add a current-versus-historical rule for provider failures. `refusal_body` reads the current attempt's stderr only for `Error: Session`; a quota frame has no equivalent. Anything derived from a failed attempt carries its attempt and time. | #680 | a stored quota failure does not block an available route |
| F7 | Fix the duplicate constructor name in the `delivery.bend` candidate (`ReportOutcome.Refused` / `ReportRouting.Refused`) and gate the commit on the coordinator entry check under `bend 2.0.25`. | branch `codex/baton2-audit-native-20261004` | the entry check builds and the delivery tests pass |
| F8 | Re-anchor the #681 design's file:line citations to `2cc57690` before implementation, and remove the `observe_identity_sql` provenance claim from `integration-682-verify.md`. | `.../semantic-context-20261005/reports/` | cited lines resolve to the named definitions |
| F9 | Reconcile the two capacity representations (`unknown|observed` in `integration-683-adapters.md`; `known|expired|unknown|error` with a `provider_probes` table in `integration-683-design.md`/`-surface.md`) into one shape before implementation. | #683 | one representation is recorded in a single document |

## 5. Verification performed

- Source reads and greps over `bend2/` at `2cc57690`, plus `git diff fca7af87 2cc57690 -- bend2/src` (empty).
- Read-only SQL against `orchestra.db` (§2.1, §2.5).
- `baton2 "$DB" session …` and `baton2 "$DB" help` against the live database.
- `node bend2/harness/git-series.mjs check` for three model keys (§2.3).
- `/tmp/item1-compile.log` read directly (§G7).

## 6. Verification not performed

- No coordinator build or compiler check on this host; `bend 2.0.25` is absent and
  compilation belongs to the remote validation runners.
- No provider invocation, quota observation or subscription check.
- No acceptance run of any kind; the installed binary was used for read-only reads only.
