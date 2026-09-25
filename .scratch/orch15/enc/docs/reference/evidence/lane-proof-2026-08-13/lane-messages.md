# LANE-MESSAGES — row-lane-messages evidence (lane-proof-2026-08-13-wave-a)

[attempt: 9ab83d7f-a20a-40f3-acfd-7550ed95bfa4 row-lane-messages]

Every lane below was exercised from MY seat (worker w-264, run-2ce57d3dd6bfea5f192677afca31a02b, task baton-16b782d78b031d9f8de3d87e-work) against the coordinator (worker w-262, run-ec38209dbb2f61fd908a7f67e094f215) in wave:31c3d897b1393c937d89a1d4232a3ce7. Evidence is store events/messageIds from my own run; refusals are verbatim.

## Identity

- **Me (row-lane-messages):** run `run-2ce57d3dd6bfea5f192677afca31a02b`, worker `w-264`, task `baton-16b782d78b031d9f8de3d87e-work`
- **Coordinator:** run `run-ec38209dbb2f61fd908a7f67e094f215`, worker `w-262`
- **Wave:** `wave:31c3d897b1393c937d89a1d4232a3ce7` (idempotencyKey `lane-proof-2026-08-13-wave-a`)
- **My spawn brief (the parent message I reply to):** `message:0d3f682eb50c8a7d3ed344bf9d1dd35eeac49e9aeaa2303e5412cd185134f046` (seq 74333 sent / 74334 delivered)

## Lane 1 — message kinds: query / inform / steer → **GAPPED**

Attempted `run.message.send` to the coordinator run for each kind over the resident serve's web surface (unix socket `/private/tmp/baton-501/4421cf2925043322-6e6e92415507.sock`, POST `/v1/commands`, authenticated with the deployment token, full valid envelope). All three draw the same verbatim refusal:

```
{"ok":false,"error":{"code":"invalid_command","message":"unsupported command"}}
```

- kind=`query` ("Which report sections do you want first?") → refusal above
- kind=`inform` ("My lane-evidence draft is underway") → refusal above
- kind=`steer` (suggestion about the QA's structure) → refusal above

Control proving the envelope is otherwise valid: the web-exposed `waves_list` passes envelope validation and is only capability-refused — `{"ok":false,"error":{"code":"forbidden","message":"forbidden"}}` — while `run.message.send` is refused at the capability table ("unsupported command"). `run.message.send` is not in the web-enabled command set (`application.mjs` `APPLICATION_COMMAND_DEFINITIONS` advertises surfaces embedded/mcp/cli only — no `web: true`).

The other two member-facing surfaces were also unreachable from this seat: the CLI shares the web-northbound gate (its local-socket doctor/session handshake failed here: "Baton Web connection failed"), and the member baton MCP (homecloud-collab) timed out at session start. A supplementary `waves_send` wave-lane attempt produced no `message.sent`/`message.delivered` event at all (no output, no audit row).

**Verdict: GAPPED** — no query/inform/steer message was admitted, delivered, or carried a messageId. The bidirectional message-kind lane has no reachable member-facing path from this seat.

## Lane 2 — the reply chain → **reply-lane mechanic PROVEN; query-answer thread UNEXERCISED**

- **Reply-lane mechanic (BD3-C worker reply, issue #86):** I emitted the closed `MESSAGE_SEND: {inReplyTo, body}` frame in my session text replying to my spawn brief. The coordinator admitted it and minted a reply — durable record:
  - `message.delivered` **seq 75985**, messageId **`message:5cf7db006dad316754667c44390a2be7cf8e87bb29a6d1f8dc1e8b759be02ea7`**, `inReplyTo: message:0d3f682eb50c8a7d3ed344bf9d1dd35eeac49e9aeaa2303e5412cd185134f046`, `from: w-264`, `depth: 1`, `budget: 1`, `remaining: 0`.
  - This round-tripped the worker→orchestrator reply lane: a worker reply to a coordinator message is admitted, thread-linked via `inReplyTo`, and durably audited.
- **The query-answer thread (brief item 2):** because Lane 1 is GAPPED, my query never reached the coordinator, so no answer arrived, so there was no answer to reply to. The coordinator sent me no answer messages (zero `message.sent` from `w-262` to my run). The reply-TO-AN-ANSWER chain is **UNEXERCISED** — the absence is the finding.

**Verdict: PROVEN (reply-lane mechanism) / UNEXERCISED (the query→answer→reply thread).**

## Lane 3 — note elevation: doubt + plan → **notes PROVEN in worker partition; elevation event NOT fired**

Published one doubt and one plan note via the `SCRATCHPAD_WRITE` up-channel grammar (closed `{entry, expectedFence, idempotencyKey}` shape; no scope field exists on the wire):

- **doubt** — `scratchpad.entry_written` **seq 75173**, scope `worker:w-264`, ordinal 1, kind `doubt`, idempotencyKey `row-lane-messages.doubt.1`
- **plan** — `scratchpad.entry_written` **seq 75205**, scope `worker:w-264`, ordinal 2, kind `plan`, idempotencyKey `row-lane-messages.plan.1`

The wave spec's `elevateWhenNotes` policy (`kinds: [doubt, plan]`, maxEntries 20) targets exactly these kinds. **As of this report's store verification, no elevation event has fired for my run or wave:** zero `scratchpad.entry_elevated` rows carry my runId or waveId (the only five in the store belong to an unrelated earlier run `run-101fcd1868ef668e0f6590f7e602f11c` at seq 48063-48066), and no `elevateWhenNotes` steering trigger appears in the wave's event trail. Per `workflow-interpreter.mjs` `tryElevate`, elevation is refused mid-flight (`scratchpad_settlement_not_ready`) until the member's task settles — my task `baton-16b782d78b031d9f8de3d87e-work` was still `working` at verification time, so the policy's elevation is gated on settlement. Whether it fires post-settlement is the coordinator's QA to confirm.

**Verdict: notes GAPPED-as-elevated (landed worker-scoped, no elevation event fired); PROVEN as worker-partition publish.**

## Lane 4 — the shared publish → **GAPPED (#158), landed `worker:w-264`**

Attempted to publish my findings summary to the `shared` scratchpad partition via `SCRATCHPAD_WRITE` (idempotencyKey `row-lane-messages.shared-publish.1`). The wire grammar carries no scope field, and the kernel hardcodes worker scope — the exact landing, verbatim:

```
scratchpad.entry_written seq 76159
  scope: "worker:w-264"        <- NOT "shared"
  ordinal: 3
  kind: note
  entryId: scratchpad-entry:54d567b4eda1010db9bb503744dfef9b843b64eb8003f483629da66b234b767d
```

There is **no refusal** — the kernel silently scopes every member write to `worker:<id>` (`coordination-store.mjs` `writeScratchpad`: `const scope = \`worker:${fields.workerId}\``, the #158 gap). Only the orchestrator's `elevateTaskScratchpad` can write `shared`. This is the campaign's load-bearing negative test and it fails as documented: a member cannot publish to `shared`.

**Verdict: GAPPED** — exact landing `worker:w-264` (seq 76159), no `shared` write possible from a member seat.

## Verdict table

| Lane | Attempt | Result | Evidence |
|---|---|---|---|
| 1. message kinds (query/inform/steer) | 3× `run.message.send` (web, authenticated) | **GAPPED** | verbatim `invalid_command`/`unsupported command`; control `waves_list` → `forbidden` (envelope valid) |
| 2a. reply-lane mechanic (BD3-C) | `MESSAGE_SEND` reply to spawn brief | **PROVEN** | `message:5cf7db…` seq 75985, inReplyTo the spawn brief |
| 2b. query→answer→reply thread | awaited coordinator answer | **UNEXERCISED** | no query delivered (L1 gap), zero answer messages from w-262 |
| 3. note elevation (doubt/plan) | 2× `SCRATCHPAD_WRITE` | **notes PROVEN (worker-scoped); elevation NOT fired** | seq 75173 (doubt), 75205 (plan); zero `entry_elevated` for this wave |
| 4. shared publish | `SCRATCHPAD_WRITE` findings summary | **GAPPED (#158)** | seq 76159 landed `worker:w-264` (ordinal 3), no `shared` |

## Method note

Evidence = events/messageIds from my own run in `.git/baton/application-v3/state/coordination/events.jsonl`, per the lane laws. The web refusals were captured with the deployment token over the resident serve socket so they are the real surface's answers, not guesses. Deployment verification command (`true`) exits 0.
