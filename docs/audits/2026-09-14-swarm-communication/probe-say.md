# probe-say — what a swarm participant can SAY (swarm `audit-comm`, 2026-09-14)

Author: `probe-say`, participant of swarm `audit-comm` (parent: `suborchestrator`).
Caller permissions at probe time: `read`, `communicate`, `contribute`, `organize` — notably **no** `recruit`, no `review`.

Method: `node "$BATON_SWARM_CLIENT" <command> '<json-args>'` where `$BATON_SWARM_CLIENT` = `impl/src/swarm-native-bridge.mjs`.
One exercise per channel per the brief; timestamps quoted are server `ts` values from the authoritative view (canonical) plus my local wall clock at command issue (UTC). Every call — success or refusal — returned `commandReceipt.idempotencyKey` (a fresh key minted per call, replayable on retry).

---

## 1. `swarm.work_updated` — open a unit of work

Issued 04:36:28.850Z:

```json
{"event":"swarm.work_updated","payload":{"workId":"work-say-probe","objective":"Probe from probe-say: exercise swarm.work_updated by opening one unit of work","status":"open"}}
```

Result: success. New row, verbatim from the response view:

```json
{
  "workId": "work-say-probe",
  "objective": "Probe from probe-say: exercise swarm.work_updated by opening one unit of work",
  "status": "open",
  "version": 1,
  "actor": "swarm-native:audit-comm:probe-say",
  "seq": 1789,
  "ts": "2026-09-14T04:36:29.850Z",
  "evidence": { "contributions": [], "accepted": [], "derivedComplete": false }
}
```

Wake: **YES** — suborchestrator watch#1 woke (see §9).
Echo shape: on success `swarm.update` returns the **entire** authoritative inspect view (participants, work, assignments, context, the full `updatePayloads` catalog — hundreds of lines) plus `cursor` and `commandReceipt`. Refusals return a compact `{ok:false,error:{...}}`. Steep asymmetry; a chatty participant must filter (I piped later calls through `node -e` JSON extracts).

## 2. `swarm.work_updated` — evolve, status-only (objective omitted)

Issued 04:37:58.574Z batch, after the refusal in §3. Payload `{"workId":"work-say-probe","status":"open"}` (no `objective`).

Result: success, verbatim row:

```json
{
  "workId": "work-say-probe",
  "objective": "Probe from probe-say: exercise swarm.work_updated by opening one unit of work",
  "status": "open",
  "version": 2,
  "actor": "swarm-native:audit-comm:probe-say",
  "seq": 1895,
  "ts": "2026-09-14T04:37:59.606Z"
}
```

Objective was kept from the existing row — confirms the documented `optionalWhenExisting` behavior. Version bumped 1 → 2. Wake: **YES**.

## 3. `swarm.work_updated` — optimistic-concurrency guard (stale `expectedVersion`)

Same batch; payload `{"workId":"work-say-probe","status":"open","expectedVersion":0}` while the row was at version 1. Verbatim refusal, exit code 1:

```json
{
  "ok": false,
  "error": {
    "message": "swarm work work-say-probe version conflict: expected 0, current 1",
    "code": "version_conflict",
    "detail": {}
  },
  "commandReceipt": {
    "idempotencyKey": "91d10358-88bf-4725-a094-b298203631c7"
  }
}
```

Wake: **NO** — refused calls emit no swarm event (§9). The failed call still minted and returned an idempotency key.

## 4. `swarm.assignment_updated` — bind a participant to work

Issued 04:36:58.743Z:

```json
{"event":"swarm.assignment_updated","payload":{"assignmentId":"assignment-say-probe","participantId":"probe-say","workId":"work-say-probe","status":"active"}}
```

Result: success, verbatim row:

```json
{
  "assignmentId": "assignment-say-probe",
  "participantId": "probe-say",
  "workId": "work-say-probe",
  "status": "active",
  "version": 1,
  "actor": "swarm-native:audit-comm:probe-say",
  "seq": 1814,
  "ts": "2026-09-14T04:36:59.305Z"
}
```

Side effect observed in the same response view: the suborchestrator's `delegation.work` already listed `["work-say","work-say-probe"]` — a child's self-assignment mutates the parent's delegation bookkeeping immediately, within the same seq. Wake: **YES**.

## 5. `swarm.assignment_updated` — release (assignment lifecycle)

Same 04:37:58.574Z batch; payload `{"assignmentId":"assignment-say-probe","participantId":"probe-say","workId":"work-say-probe","status":"released"}`. Verbatim row:

```json
{
  "assignmentId": "assignment-say-probe",
  "participantId": "probe-say",
  "workId": "work-say-probe",
  "status": "released",
  "version": 2,
  "actor": "swarm-native:audit-comm:probe-say",
  "seq": 1897,
  "ts": "2026-09-14T04:38:00.119Z"
}
```

Follow-up: my next filtered `swarm.view` (04:39:52Z) showed my `delegation.work` back to `["work-say"]` — releasing the assignment removed the work from my delegation view. Wake: **YES**.

## 6. `swarm.holder_released` — expected refusal while a live participant holds seats

Issued 04:37:10.434Z, targeting live participant `probe-see` (holds `assignment-probe-see`, runtime `working`):

```json
{"event":"swarm.holder_released","payload":{"participantId":"probe-see","reason":"probe-say audit: attempt to release seats of a live participant while it holds assignment-probe-see"}}
```

Verbatim refusal, exit code 1:

```json
{
  "ok": false,
  "error": {
    "message": "The holder is still live: stop it or record its leave before releasing its seats",
    "code": "swarm_holder_live",
    "detail": {
      "participantId": "probe-see",
      "runtimeState": "working"
    }
  },
  "commandReceipt": {
    "idempotencyKey": "499d3a18-0dc9-4948-b1d4-68aac8a2fdbc"
  }
}
```

Wake: **NO**. `detail` helpfully names the blocking participant and its `runtimeState`. Key still minted for the failed call.

## 7. `swarm.context_updated` — shared-context entry

Issued 04:37:21.377Z; payload `{"key":"notes:say-probe","body":{"note":"probe-say exercised swarm.context_updated at this timestamp; whole-swarm scope (no groupId)"}}`. Verbatim stored row:

```json
{
  "key": "notes:say-probe",
  "body": { "note": "probe-say exercised swarm.context_updated at this timestamp; whole-swarm scope (no groupId)" },
  "groupId": null,
  "version": 1,
  "actor": "swarm-native:audit-comm:probe-say",
  "seq": 1846,
  "ts": "2026-09-14T04:37:22.213Z"
}
```

Context rows are keyed `[groupId,key]` internally (`[null,"notes:say-probe"]`). Wake: **YES**.

## 8. `swarm.contribution_recorded` — published findings (after this file was written)

Two attempts, both verbatim-quotable, because the first exposed a real gap:

**(a) Plain-text payload form** (the brief's `"payload":"your finding"` shape), issued 04:42:09.669Z. Recorded successfully but with **`workId: null, refs: null`** — the plain-text form carries no work linkage, so this contribution cannot serve as `work-say` completion evidence:

```json
{
  "id": "contribution-874d5e49bf054aed0873ece80504e3ef",
  "participantId": "probe-say",
  "workId": null,
  "refs": null,
  "seq": 2094,
  "ts": "2026-09-14T04:42:10.191Z"
}
```

(Full body as sent: the say-channel audit summary naming `docs/audits/2026-09-14-swarm-communication/probe-say.md`; receipt key `4611fdac-1ced-4a8e-ab5a-aaad8a61590a`.)

**(b) Structured payload form** `{body, workId, refs}` to restore the work linkage:

```json
{
  "id": "contribution-ad258239e97c4d2500ff529461b2418e",
  "participantId": "probe-say",
  "workId": "work-say",
  "refs": ["work-say", "docs/audits/2026-09-14-swarm-communication/probe-say.md"],
  "seq": 2119,
  "ts": "2026-09-14T04:42:33.173Z"
}
```

(Same body text; receipt key `ea37902e-2cce-4cc3-a034-f3dbb4cb981d`.) Both accepted by the server without warning about the missing linkage in (a) — the mismatch between the catalog's `workId`/`refs` fields and the plain-text shortcut is silent. Companion probe-see used the structured form from the start (`contribution-d509edb8a67faf71e6ef553f2ffa2e20`, seq 2040, ts 04:40:39.446Z, refs `["work-see","docs/audits/2026-09-14-swarm-communication/probe-see.md"]`), which is how I noticed the difference.

## 9. Wake inventory — which utterances woke the watching suborchestrator

I sent the suborchestrator a `swarm.guide` (04:39:03.953Z, receipt key `90b21c94-9361-4d5f-a065-4177233d0b56`, compact `{ok:true,receipt,...}` response) asking it to log wakes. Its reply arrived via my `swarm.watch {"afterSeq":1986,"timeoutMs":45000}` (returned 04:39:52Z) as an attention row — note my plain `swarm.view` seconds earlier had shown `"attention": []`; guidance surfaces through watch and is transient. Verbatim row (trimmed only where the transport truncated the embedded message; full message text follows from the delivery):

```json
{
  "kind": "operation_unconfirmed",
  "command": "swarm.guide",
  "request": {
    "participantId": "probe-say",
    "message": "Wake inventory from my watches (verbatim quotable): … [full text below]",
    "swarmId": "audit-comm",
    "idempotencyKey": "c331fe94-565d-4add-8e65-cf3c08e49f86"
  },
  "state": "in_progress",
  "code": null
}
```

Suborchestrator's reply, verbatim:

> Wake inventory from my watches (verbatim quotable): your (1) work_updated open work-say-probe 04:36:29Z — woke watch#1 returned 04:36:58Z (afterSeq 1745, replay-instant, delta: work-say-probe row + probe-see guide-request note). Your (2) assignment_updated assignment-say-probe active 04:36:59Z — delta observed in watch#2 returned 04:37:41Z (afterSeq 1809). Your (3) holder_released refusal 04:37:10Z — NO wake, NO view delta; I only learned of it from your message. Your (4) context_updated notes:say-probe 04:37:22Z — woke watch#2 (delta: context row). Your (5) work_updated version_conflict refusal 04:37:58Z — NO wake/delta. Your (6) work_updated status-only v2 04:37:59Z — delta observed at watch#3/#4 boundary (cursor 1895→1915). Your (7) assignment_updated release 04:38:00Z — delta observed in watch#4 returned 04:38:29Z. Your (8) recruit refusals — NO wake/delta (refusals emit no swarm event). Additionally: your swarm.guide TO me created a transient attention row kind operation_unconfirmed command swarm.guide, visible in my watch#5 returned 04:39:04Z (first blocking wake, ~29s wait) and delivered to me as a queued user message; the row was already gone when I read view seconds later. Quoted timestamp pairs are my wall clock at command issue, UTC.

Summary: every **committed** mutation woke the watcher; every **refusal** (`swarm_holder_live`, `version_conflict`, both `swarm.recruit` refusals) produced no wake and no view delta. Failures are invisible to watchers except out-of-band (I had to guide the suborchestrator to tell it about refusals).

## 10. Outside permissions: `swarm.recruit` — two refusal layers, verbatim

First attempt used an invented field (`purpose`). Verbatim refusal, exit code 1 — **schema validation fires before the permission gate**:

```json
{
  "ok": false,
  "error": {
    "message": "swarm.recruit request is invalid: unknown field purpose",
    "code": "swarm_command_invalid",
    "detail": { "field": "purpose" }
  },
  "commandReceipt": {
    "idempotencyKey": "c2f9315e-6ba4-4297-900b-116dc1d278ed"
  }
}
```

Second attempt, valid shape per `swarm.recruit --help` (`{"participantId":"probe-say-recruit","objective":"probe-say audit: recruit attempt outside my permissions"}`), issued 04:39:03.953Z. Verbatim permission refusal, exit code 1:

```json
{
  "ok": false,
  "error": {
    "message": "This swarm has not granted recruit authority to this participant",
    "code": "swarm_permission_required",
    "detail": {
      "permission": "recruit",
      "participantId": "probe-say"
    }
  },
  "commandReceipt": {
    "idempotencyKey": "53e48242-45cb-4358-9755-868760e2d88f"
  }
}
```

Wake: **NO** for both (refusals emit no swarm event).

## Appendix A — refusal taxonomy observed

| code | message (verbatim) | layer |
|---|---|---|
| `swarm_command_invalid` | `swarm.recruit request is invalid: unknown field purpose` | request schema |
| `swarm_permission_required` | `This swarm has not granted recruit authority to this participant` | authorization |
| `swarm_holder_live` | `The holder is still live: stop it or record its leave before releasing its seats` | domain rule |
| `version_conflict` | `swarm work work-say-probe version conflict: expected 0, current 1` | optimistic concurrency |

All share shape `{ok:false, error:{message, code, detail}, commandReceipt:{idempotencyKey}}`, exit code 1, and emit **no** swarm event.

## Appendix B — gaps and observations

1. **Refusal blindness for watchers:** failed mutations emit no event, so a watching orchestrator cannot see a participant's failed say-attempts; coordination of failures requires out-of-band channels (`swarm.guide`). An attention/log row for refusals (even rate-limited) would close this.
2. **Echo volume:** every successful `swarm.update` returns the full inspect view including the entire `updatePayloads` catalog — hundreds of lines per call. A `?dryRun`/`?diff` or delta-only return would cut context cost sharply.
3. **Idempotency on failures:** refusals still mint and return a key — replay-safe, but a refused call's key has nothing to replay to; harmless, just notable.
4. **Guide delivery is transient:** my received guide appeared as an attention row `operation_unconfirmed` / `state:"in_progress"` visible via `swarm.watch` but absent from an earlier `swarm.view` snapshot and (per the sender) gone from view seconds after delivery — if a participant is not watching at delivery time, the row's persistence is unclear.
5. **Delegation bookkeeping coupling:** a child's self-`assignment_updated` immediately mutates the parent's `delegation.work` list (observed within the same response seq); releasing it removes the work again. Implicit, undocumented coupling worth documenting.
6. **Channels present in the catalog but outside my brief's scope (not exercised):** `swarm.group_updated`, `swarm.participant_left`, `swarm.closed` — org-level/destructive; the brief's enumeration excluded them.
6b. **Plain-text contribution payload silently drops linkage:** the brief's documented shortcut `{"event":"swarm.contribution_recorded","payload":"your finding"}` records the body but leaves `workId`/`refs` null with no server warning (§8b) — such a contribution is invisible to work-completion evidence (`basis.contributionIds` matches by workId or refs).
7. **Attribution is consistent:** every committed row carries `actor: "swarm-native:audit-comm:probe-say"` — authorship is unforgeable from the participant side (`participantId` auto-filled, contributions must name their actual author).
