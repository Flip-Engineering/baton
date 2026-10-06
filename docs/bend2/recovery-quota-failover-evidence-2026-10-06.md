# Retained provider quota-failure and continuation evidence (#678, #680, #681)

Read 2026-10-06 from
`/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/baton2-audit-followups-20261004/orchestra.db`
as `sqlite3 -cmd ".timeout 15000" "file:<db>?mode=ro"`. Read-only; no writes.

## Store limits that shape this evidence

`messages` and `turns` have no time column. The only times are the reset times the
provider text states and the timestamps embedded in retained artifact names. Ordering
below uses `messages.seq`, which is monotonic in acceptance order.

The coordinator stores no error field. A provider failure is retained as the native
terminal text inside a completion frame, or as quoted provider text inside a report.

## 1. Provider-failure records

Three distinct provider signatures appear.

| Provider | Retained text | Retention form |
| --- | --- | --- |
| Codex (gpt-6-astra) | `{"type":"result","is_error":1,"nativeEvent":{"type":"turn.failed","error":{"message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 9th, 2026 2:13 PM."}}}`, and the variant prefixed `Error running remote compact task:` | native completion frames in `messages` (`id` shape `receive:<seat>:<cursor>:<hex>`, kind `report`) |
| Kimi (omp, kimi-code/k3) | HTTP 403 `{"error":{"type":"permission_error","message":"You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends. To continue now, purchase extra usage ..."}}`, with `errorId=17321984`, `provider=kimi-code`, `model=k3` | native completion frames in `messages` |
| ZAI (omp, zai/glm-5.3-flash) | `HTTP 429`, `Usage limit reached for 5 hour`, `type1308`, provider reset text `2026-10-06 07:12:52` with no timezone | reports that quote the provider response (§1.3); no raw frame in `messages` |

### 1.1 Codex usage-limit frames by seat

| Seat | Frames | First seq | Last seq |
| --- | --- | --- | --- |
| semantic-impl-models | 5 | 13187 | 13384 |
| semantic-impl-native | 17 | 13193 | 13386 |
| semantic-synthesis | 37 | 13195 | 13392 |
| semantic-impl-code | 7 | 13200 | 13382 |
| native-receive-conductor | 2 | 13226 | 13388 |
| native-ci-conductor | 3 | 13424 | 13552 |

First frames: `receive:semantic-impl-models:13176:b63b8d68f7266fd61c74a686e97b7c18` (seq
13187), `receive:semantic-impl-code:13158:dfbf2c60bcc849f0edd9a8a157e6bce2` (seq 13200),
`receive:semantic-impl-native:13380:ef8a491f6eae4345b45707a63495bf86` (seq 13386).

### 1.2 Kimi 5-hour-window frames by seat

| Seat | Frames | Seq range |
| --- | --- | --- |
| semantic-review | 35 | 1004–1158 |
| semantic-models | 13 | 967–13951 |
| audit-kimi | 13 | 881–1125 |
| semantic-integration | 11 | 933–13937 |
| semantic-runtime | 8 | 949–13965 |
| semantic-lead | 6 | 882–973 |
| semantic-controls | 3 | 884–960 |
| audit-native | 2 | 930–1174 |
| semantic-code | 2 | 1185–1291 |
| native-receive-conductor | 2 | 13947–13949 |
| logging-conductor-20261006 | 2 | 13934–13955 |
| recovery-kimi-20261006 | 1 | 13946 |
| native-ci-conductor | 1 | 13967 |

### 1.3 ZAI 429 records

| Seq | Message id | Sender → recipient | Retained text |
| --- | --- | --- | --- |
| 9973 | `native-instance-provider-impediment-107` | native-instance-conductor → semantic-synthesis | ZAI 429 for the original Instance author |
| 9985 | `code-critic-quota-blocker-67` | semantic-impl-code → semantic-synthesis | "Both original ZAI GLM critics returned provider 429 Usage limit reached for 5 hour, type1308; provider reports reset at 2026-10-06 07:12:52 without an explicit timezone." |
| 10124 | `native-ci-parent105-late` | native-ci-conductor → semantic-synthesis | "Controls continuation produced two retained native terminal provider errors 429 usage limit type1308, reset text 2026-10-06 07:12:52 (timezone not supplied)." |
| 10216 | `synthesis133-root-capacity-and-674` | semantic-synthesis → audit-root | Provider capacity blocking the original Instance author, Code, Models, Native and Quality critics |

## 2. Affected seats and continuation outcome

| Seat | Route when it failed | Route recorded now | Continuation record | Pending input at read | Identity, parent, worktree, branch |
| --- | --- | --- | --- | --- | --- |
| semantic-impl-code | codex/gpt-6-astra (7 frames, 13200–13382) | muse/muse-spark-1.3-contributor | notice `root-provider-fallback-semantic-impl-code` (seq 13378, unacknowledged); completion `provider-fallback-semantic-impl-code` (seq 13422) | guidance 5, report 17 | parent semantic-synthesis; worktree `…/worktrees/semantic-impl-code`; branch `codex/baton2-semantic-impl-code-20261005`; base `8a26bc3e` |
| semantic-impl-models | codex/gpt-6-astra (5 frames, 13187–13384) | muse/muse-spark-1.3-contributor | notice `root-provider-fallback-semantic-impl-models` (seq 13379); completion `provider-fallback-semantic-impl-models` (seq 13489) | guidance 1 | parent semantic-synthesis; worktree `…/worktrees/semantic-impl-models`; branch `codex/baton2-semantic-impl-models-20261005`; base `8a26bc3e` |
| semantic-impl-native | codex/gpt-6-astra (17 frames, 13193–13386) | muse/muse-spark-1.3-contributor | notice `root-provider-fallback-semantic-impl-native` (seq 13380, unacknowledged); completion `provider-fallback-semantic-impl-native` (seq 13452) | guidance 5, note 2, report 25 | parent semantic-synthesis; worktree `…/worktrees/semantic-impl-native`; branch `codex/baton2-semantic-impl-native-20261005`; base `8a26bc3e` |
| semantic-synthesis | codex/gpt-6-astra (37 frames, 13195–13392) | omp/kimi-code/k3 | notice `root-provider-fallback-semantic-synthesis` (seq 13381) | note 1, question 3, report 16 | parent audit-root; worktree `…/worktrees/semantic-synthesis`; branch `codex/baton2-semantic-synthesis-20261005`; base `98fbfe03` |
| native-receive-conductor | codex/gpt-6-astra (2 frames, 13226 and 13388) | omp/kimi-code/k3 | notice `root-provider-fallback-native-receive-conductor` (seq 13377) | report 4 | parent audit-root; worktree `…/worktrees/native-receive-conductor`; branch `codex/baton2-native-receive-conductor-20261005`; base `98fbfe03` |
| native-ci-conductor | codex/gpt-6-astra (3 frames, 13424–13552) | omp/kimi-code/k3 | none recorded | none | parent semantic-synthesis; worktree `…/worktrees/native-ci-conductor`; branch `codex/baton2-native-ci-conductor-20261005`; base `fca7af87` |

The notice text is
`root-provider-fallback-*` (seq 13377–13381):

> Provider continuation notice. The prior Codex/Astra attempt ended with a usage-limit
> error. This existing seat keeps its player identity, parent, worktree, branch, and
> pending inputs. Root is continuing the pending work through the OMP provider selected
> for this seat. The prior native conversation remains retained in its execution history;
> this turn starts a fresh provider conversation.

Checks against the retained evidence:

- Player identity, parent, worktree, branch and base are unchanged for every seat in the
  table (session rows above).
- Pending inputs are retained (§2 column; the guidance and report kinds are unacknowledged).
- The notice names OMP. Three of the five notified seats record `harness=muse`
  (semantic-impl-code, semantic-impl-models, semantic-impl-native); two record `omp`.
- The prior Codex conversation survives on disk for all five notified seats:

  | Seat | Retained Codex rollout | Conversation now recorded |
  | --- | --- | --- |
  | semantic-impl-code | `~/.codex/sessions/2026/10/05/rollout-2026-10-05T10-23-10-01a10d17-427d-79e0-baab-ddb81d7b105c.jsonl` | `01a10fb4-16d3-7343-b2e2-8b02fee4ac58` |
  | semantic-impl-models | `~/.codex/sessions/2026/10/05/rollout-2026-10-05T10-23-10-01a10d17-426b-7882-8e3f-facf12538832.jsonl` | `01a10fb4-1d75-75f1-b503-78b263b4ad3b` |
  | semantic-impl-native | `~/.codex/sessions/2026/10/05/rollout-2026-10-05T10-23-10-01a10d17-4263-75b2-a113-b86ea6f0f9c1.jsonl` | `01a10fb4-1f2b-7b43-9ac2-f7667d2b5c7a` |
  | semantic-synthesis | `~/.codex/sessions/2026/10/05/rollout-2026-10-05T02-35-17-01a10b6a-e781-7b22-92b7-048b9a14960e.jsonl` | `01a10fb3-cee8-7260-89ad-16da3f8ba81f` |
  | native-receive-conductor | `~/.codex/sessions/2026/10/05/rollout-2026-10-05T02-35-17-01a10b6a-e781-76a2-b01e-c3c73248117f.jsonl` | `01a10fb3-b76e-701c-ab51-f8a8a6b26df4` |

  The store keeps no identifier for the prior conversation. `sessions.native` holds the
  new provider conversation, and the failure frames carry no thread id (`turns` holds 26
  events containing `thread.started` overall and none for these seats' failures). No
  coordinator read returns the prior conversation.
- For semantic-impl-models the Muse era is recorded in `turns`: the event carries
  `"stream":{"kind":"session","id":"01a10fb4-1d75-75f1-b503-78b263b4ad3b"}`, which equals
  `sessions.native`.
- Seat continuation was not uniform in time: native-receive-conductor recorded a Codex
  frame at seq 13388 after its notice at seq 13377.

## 3. Control-surface gaps against the retained evidence

| Gap | Retained evidence |
| --- | --- |
| `recruit` refuses a same-ID model-only change | `native127-provider-recovery-refusal` (seq 11238, id above): requested route `omp deepseek/deepseek-flash high`, "Exact same-actor recruit changing only model returned exit2 error player-assignment-conflict for BOTH: 'The session ID is already registered with a different assignment.'" Also `models73-provider-route-refusal` (11254), `code-provider-recovery-gap-70` (11253), `native-instance-route-refusal-report-109` (11246), `runtime157-provider-recovery-gap` (11272) |
| `receiver` builds the endpoint from the recorded model | `controls128-native-route-recovery-interfaces` (11273): "Its registered endpoint wraps git-series launch --model-key zai/glm-5.3-flash around receive with blank model override." |
| `bind` records observed metadata only | 11273: "bind is explicitly not a declared-model switch"; `root-failover-681-kimi` (13355): "bind only records observed metadata" |
| `connect` writes the native id and endpoint only | 11273 lists the inspected surface: "player_sql preserves assignments and reports player-assignment-conflict; connect only writes native/endpoint" |
| `attach` and `start` cannot serve a parented seat | 11273: "attach is parentless and does not update model; start requires a compatible parentless assignment. No existing safe child-route change was found." |
| No stored failure is distinguishable from a current one | 13355: "Current receive uses the stored harness; bind only records observed metadata; no native operation can switch the existing seat to OMP while preserving its identity and worktree. Do not retry those Astra receives or create duplicate seats." |
| The continuation that occurred has no coordinator verb | `baton2 help` lists no route-change verb in the installed `1.1.0-fca7af87` build, the `dev-prefix` build, and the frozen build at `…/671-frozen-stable98/baton2`. `observed_harness` and `observed_effort` are empty on all 113 sessions. |
| Missing provider facts | No `quota`, `reset`, `capacity` or observation-time field exists in the coordinator schema or in any read; `observed-usage` projects the recorded conversation only. |

## 4. Stale failure against current capacity

| Provider | Stored failure | Current use at read | Consequence recorded |
| --- | --- | --- | --- |
| Kimi k3 | Four `session_stops` rows reading `K3 subscription quota exhausted; assignment superseded by <seat>`, with no observation time | 14 sessions record omp/kimi-code/k3; semantic-synthesis and native-receive-conductor failed over onto it, and native-ci-conductor, semantic-synthesis and several recovery seats run on it | 1,236 unacknowledged inputs are held at the four stopped seats (`audit-kimi` 203, `semantic-controls` 279, `semantic-lead` 110, `semantic-review` 647). The store holds no read that reports whether each stop reason still applies. |
| ZAI glm-5.3-flash | The 429 records of §1.3, reset stated as `2026-10-06 07:12:52` | 38 sessions record zai/glm-5.3-flash with `exec=exit 0`, including seats that recorded the 429 (semantic-impl-code-semantics-critic, semantic-impl-code-package-critic, semantic-impl-package, semantic-impl-models-production-critic) | The stored failure is historical; nothing in the store marks it superseded. |
| Codex gpt-6-astra | The `turn.failed` frames of §1.1, reset stated as `Oct 9th, 2026 2:13 PM` | 15 sessions record codex/gpt-6-astra; semantic-controls-next is recorded `running` | Five seats were continued to another provider while the same route remained in use, and native-receive-conductor failed on Codex again immediately after its own continuation notice. |

`semantic-models-provider-status-1` (seq 13782, semantic-models → semantic-lead) records
the correct treatment: route rows marked "PROVEN CURRENT" from live sessions, and
historical ZAI 429, Kimi quota and Codex usage-limit failures stated to be superseded as
current-state evidence. Its muse row rests on an operator note.

## 5. Reproduction

```sql
-- failure frames per signature and seat
SELECT sender, SUM(body LIKE '%"turn.failed"%') AS codex_limit,
       SUM(body LIKE '%permission_error%') AS kimi_403,
       min(seq), max(seq), count(*)
FROM messages WHERE id LIKE 'receive:%' GROUP BY sender;

-- continuation notices
SELECT seq, id, sender, recipient, receipt FROM messages
WHERE id LIKE '%provider-fallback%' OR body LIKE 'Provider continuation notice%' ORDER BY seq;

-- route-change gap reports
SELECT seq, id, sender FROM messages WHERE seq IN (11238,11246,11251,11252,11253,11254,11272,11273,13355,13356) ORDER BY seq;

-- retained pending input at stopped seats
SELECT m.recipient, m.kind, count(*) FROM messages m
JOIN session_stops s ON s.session = m.recipient
WHERE m.receipt IS NULL GROUP BY m.recipient, m.kind ORDER BY m.recipient, m.kind;

-- prior Codex conversation lookup (no store link exists)
grep -rl "You are session <seat> in a Baton2 Orchestra" ~/.codex/sessions
```
