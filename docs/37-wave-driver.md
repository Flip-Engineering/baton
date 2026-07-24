# 37 — The shipped wave driver (issue #46)

**Status: v2 spec (post-red-team), 2026-07-24.** Seed: operator AX feedback — *"every wave
cost me a bespoke driver; the wave-driver pattern should be productized."* v1 was red-teamed
**UNSOUND** (R46R, explore seat): the productized default policy could never terminate a
successful wave on the production pausable route family — proven from the machinery and from
the 2026-07-23/24 evidence envelopes themselves (every close ended `paused`/`running`, zero
`work_completed`). v2 folds all twelve findings; the termination law (L6) is new and is the
reason this spec exists at all.

## 1. Laws

- **L1 — One loop, shipped once.** The poll/steer/settle/close skeleton exists exactly once in
  `impl/src/wave-driver.mjs`. Bespoke drivers shrink to member definitions plus a policy
  object (~10 lines of plumbing).
- **L2 — The wave handle stays frozen and pump-free.** `baton.waves.start` keeps returning
  the frozen handle (`wave.mjs:375`) whose pumps never outlive the call that armed them
  (`wave.mjs:221-232`). The multi-hour control loop is a separate blocking `run()` call —
  never parked inside `waves.start`, never detached.
- **L3 — Purely additive.** `createWave`, `baton.waves.start`, and the handle surface are
  untouched; `createWaveDriver` is re-exported beside `createWave` (`index.mjs:185`).
- **L4 — Steering touches turn checkpoints only.** The driver never auto-answers
  `approve_plan`/`answer_question`/`answer_decision` (`attentionFrom`, `wave.mjs:102-116`).
  Nudge dedup is keyed **only** on `checkpoint.requestId` (de818e3; the hand-copied mis-key in
  `run-m1-wave.mjs:146-149` is the anti-pin).
- **L5 — Liveness is the cursor-stripped status view, wave-level.** The stall marker hashes
  `sha256(JSON.stringify(run.status() view WITHOUT cursor)).slice(0,16)` per non-terminal
  member per poll — the store-global `cursor` (`application.mjs:7152`,
  `coordination-store.mjs:11003`) is stripped exactly as `semanticViewDigest` strips it
  (`application.mjs:183-190`), otherwise any event anywhere in the deployment flaps every
  member's hash and "stall" silently means "deployment-wide silence". One status read per
  member per poll. The stall clock is **wave-level** (one live member resets it for all;
  per-member stall *breaks* are deferred, §5). A transient status failure contributes
  `'unavailable'` and resets the clock; **consecutive** unavailable polls count toward stall
  (a member whose status path is persistently broken must stall, not park forever).
- **L6 — Termination law (the v1 hole).** On a `turnCompletion:'pausable'` card with a
  `steering.registered` record (every wave member, `wave.mjs:179` → `coordinator.mjs:1991-1994`),
  a completed turn parks a fresh checkpoint with a fresh `requestId` — so nudge-forever is a
  treadmill that never reaches `work_completed` (only `claim_turn` does, docs/35 §2.2(6)).
  The driver therefore applies a **per-member unproductivity budget**: each checkpoint
  attention entry carries `changedPathsDigest` (`application.mjs:6986-6990`); when a member's
  digest is UNCHANGED across one full nudge cycle (park → nudge → re-park), the member is
  done — the driver stops nudging it and (a) with `finalization: 'claim-on-stall'`, issues one
  `claim_turn` (its live-rechecked admission, 31b5 `:230-261`, resolves the parked
  `workerResult` into `work_completed`); (b) with `finalization: 'none'`, leaves the member
  parked and lets the wave-level stall clock run. Claim fan-out at wave stall: all
  pending-paused members, one claim each, scope-mismatch tolerated and recorded. Claim is
  terminal on a stale checkpoint — hence opt-in, never a default.
- **L7 — Caller owns deployment and semantics.** `openBaton` (incl. `deploymentRoot`
  isolation and `verification`), member definitions, completion *semantics* (expressed in
  objectives), and `baton.close()` stay with the caller.

## 2. Surface

```js
import { createWaveDriver } from './index.mjs';  // re-export beside createWave (index.mjs:185)
const receipt = await createWaveDriver(baton, policy).run(waveStartOptions);
// waveStartOptions === createWave options verbatim ({ repoRoot, members, approve? })
```

`run(options)`: optional preflight → salt + byte-check objectives → `baton.waves.start(options)`
→ poll/steer loop (L4–L6) → `wave.settle` → `wave.close` (guaranteed in `finally`) → assemble
(and optionally write) the evidence envelope → return the receipt.

**Policy — closed field set, all optional, frozen:**

| field | default | meaning |
|---|---|---|
| `steering` | `'nudge-on-checkpoint'` | closed enum; `'none'` disables steering |
| `completionMessage` | `'Continue the current turn.'` | nudge text (semantics default, application-semantics.mjs:359) |
| `pollIntervalMs` | `20_000` | poll cadence |
| `stallTimeoutMs` | `20 * 60_000` | cursor-stripped hash silence (wave-level) before stall break |
| `hardCapMs` | `3 * 3_600_000` | absolute cap; **stall is checked before cap** when both cross in one poll |
| `settleTimeoutMs` | `5_000` | forwarded to `wave.settle` |
| `finalization` | `'none'` | `'none'` \| `'claim-on-stall'` — per L6; opt-in because claim is terminal on a stale checkpoint |
| `unproductiveNudgeBudget` | `1` | unchanged-`changedPathsDigest` nudge cycles before a member is declared done (L6) |
| `saltObjectives` | `true` | prefix `[attempt: <uuid> <role>]` per member — the attempt uuid is minted once per `run()` call and reused across its internal retries (re-attach works, `application.mjs:3892-3903`); a fresh `run()` call mints a fresh attempt id. `false` opts INTO cross-wave run sharing for identical members (the runId spans the full intent+owner digest — sharing is silent) |
| `preflight` | `true` | doctor() route-readiness per member, matching `requestedReadiness` subset semantics (unique-or-null, `application-deployment.mjs:994-1017`); purpose is failing loudly at admission instead of yielding a wave of `start_failed` members (`wave.mjs:181-183`) |
| `evidencePath` | `null` | when set, the driver writes the envelope JSON; write failure fails the run loudly |
| `onProgress` | `null` | `(line, snapshot) => void` log hook; caller renders |
| `signal` | none | `AbortSignal`; abort = break → settle → close |

**Receipt** = the committed envelope (`{ schemaVersion: 1, outcomes, stops, remainingCount,
residueUnknown }` — `wave.mjs:327-353`) plus additive fields: `basis` (`'completed' | 'stall' |
'hard_cap' | 'aborted'` — `'completed'` means *all members exited, in any phase including
failed/cancelled; per-member truth is in `outcomes`*), `nudges: [{ role, requestId, at }]`,
`claims: [{ role, requestId, at, code }]`, `salt`, `pumpDrained` (false on stall paths —
`wave.settle` only drains on completion).

**Admission-time objective ergonomics:** after salting, each objective over 4096 bytes
(`validText`, `application.mjs:225-226`) rejects at driver admission with an error carrying
the byte count. (The machinery's oversize error is `application_intent_invalid`
`application.mjs:1094-1096`; `'Run objective is required'` is the EMPTY-objective client
error, `application-client.mjs:112` — neither names the cap, hence the driver precheck.)

## 3. Red-first tests — `impl/test/wave-driver-policy-red.test.mjs`

Harness mirrors `wave-driver-red.test.mjs:54-124` with the checkpoint conjunction pinned:
BOTH a `turnCompletion:'pausable'` card override (exactly as
`turn-checkpoints-31b5-surface-red.test.mjs:105-113`) AND the `steering.registered` record
(wave membership via `driverKind:'wave'`, `coordinator.mjs:1991-2004`) — a pausable card
alone auto-settles, `driverKind` alone mints nothing. The worker watchdog is neutralized
(`createDriver` `opts.watchdog`, `index.mjs:1398` — long timeout or clearTimeout, the 31b5
`:177-180` pattern) so timer writes never flap the stall marker.

- **D1 — requestId dedup:** two pauses → exactly two nudges, one per distinct `requestId`,
  asserted across polls (same-requestId-across-polls is the durable pin; act latency vs poll
  cadence is backstopped by scope-mismatch, 31b5 `:263-295`).
- **D2 — status-hash liveness (positive misfire pin):** phase pinned while the cursor-stripped
  view keeps changing (staggered `content.file_edit` events) never trips the stall clock;
  `basis === 'completed'`. A sibling-ONLY event (cursor movement) never resets the clock.
- **D3 — true stall:** frozen view for `stallTimeoutMs` breaks with `basis === 'stall'`,
  settles, closes `remainingCount === 0`, outcome per member.
- **D4 — hard cap:** live marker, `hardCapMs` fires, `basis === 'hard_cap'`; stall-before-cap
  precedence pinned when both cross in one poll.
- **D5 — salt semantics:** identical members across two `run()` calls attach to distinct runs
  (attempt id differs); a retry INSIDE one `run()` re-attaches (same recorded salt);
  `saltObjectives:false` with identical members across calls SHARES runs, pinned as opted-in
  behavior. Post-salt >4096-byte objective rejects with the byte count.
- **D6 — termination law (rewritten per R46R-1):** a member that parks twice with an unchanged
  `changedPathsDigest` is nudged exactly `unproductiveNudgeBudget` times, then NOT nudged
  again; with `finalization: 'claim-on-stall'` it receives exactly one `claim_turn` and the
  loop exits on its `work_completed` without waiting for stall or cap; with `'none'` it stays
  parked and the wave ends `basis === 'stall'`.
- **D7 — envelope shape:** receipt and written file match the committed envelope plus
  additive fields on a COMPLETING wave (`pumpDrained === true`); envelope write failure fails
  loudly.
- **D8 — nudge failure tolerated:** `run.act('nudge_turn')` rejection is recorded in
  `receipt.nudges` and polling continues.
- **D9 — claim fan-out at wave stall:** with `finalization: 'claim-on-stall'`, every
  pending-paused member receives exactly one claim at stall (scope-mismatch tolerated,
  recorded in `receipt.claims`); with `'none'`, `claim_turn` is never invoked.
- **D10 — unavailable semantics:** consecutive status-failure polls count toward stall;
  transient single-poll failures reset it.

## 4. Migration and compat

Each evidence driver collapses to `openBaton` + `createWaveDriver(baton, policy).run({
repoRoot, members })` (~10 plumbing lines). The 2026-07-23/24 window holds ten wave drivers —
seven flat-timer (`run-m0-wave.mjs`, `run-m1-wave.mjs`, `run-revise-wave.mjs`,
`run-redteam-wave.mjs`, `run-redteam2-wave.mjs`, `run-redteam3-wave.mjs`,
`run-contract-wave.mjs`) and three status-hash (`run-impl-wave.mjs` ×2, issue45
`run-impl-wave.mjs`) — and the seven gain the cursor-stripped marker AND the termination law
by migrating. All committed `run-*-wave.mjs` drivers (22 repo-wide) remain as historical
receipts — migration optional. No out-of-tree drivers are known; nothing they call is
altered.

## 5. Deferred

Per-member stall *breaks* (cross-member attribution stays wave-level in v1);
policy-on-`waves.start` sugar (remains additive if dogfooding demands it); driver-managed
deployment roots (contradicts the driver evidence — `deploymentRoot` stays an `openBaton`
concern, L7).
