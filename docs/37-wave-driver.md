# 37 — The shipped wave driver (issue #46)

**Status: v1 spec (pre-red-team), 2026-07-24.** Seed: operator AX feedback — *"every wave
cost me a bespoke driver; the wave-driver pattern should be productized — a shipped
baton.wave()/recipe, not living in evidence dirs."* Six production waves on 2026-07-23/24
ran the same hand-copied driver with two shipped defect classes (the de818e3 nudge-dedup
mis-key, reintroduced by hand-copy in `run-m1-wave.mjs:146-149`; the flat-timer watchdog
that killed two healthy workers and, inverted, a completed one). Design grounding: explore-seat
brief verifying every API claim against `impl/src/wave.mjs`, `index.mjs`,
`application-client.mjs`, `application-semantics.mjs`, and the six committed drivers.

## 1. Laws

- **L1 — One loop, shipped once.** The poll/steer/settle/close skeleton exists exactly once in
  `impl/src/wave-driver.mjs`. Bespoke drivers shrink to member definitions plus a policy
  object (~10 lines of plumbing).
- **L2 — The wave handle stays frozen and pump-free.** `baton.waves.start` keeps returning
  the frozen handle (`wave.mjs:375`) whose pumps never outlive the call that armed them
  (`wave.mjs:221-232`). The multi-hour control loop is a separate blocking `run()` call —
  never parked inside `waves.start`, never detached (docs/31's killed leak class).
- **L3 — Purely additive.** `createWave`, `baton.waves.start`, and the handle surface are
  untouched; `createWaveDriver` is re-exported beside `createWave` (`index.mjs:185`).
- **L4 — Steering touches turn checkpoints only.** The driver must never auto-answer
  `approve_plan`/`answer_question`/`answer_decision` — `attentionFrom` (`wave.mjs:102-116`)
  classifies those separately. Checkpoint nudge dedup is keyed **only** on
  `checkpoint.requestId` (de818e3).
- **L5 — Liveness is the whole status view, never a phase.** Stall detection hashes
  `sha256(JSON.stringify(run.status() view)).slice(0,16)` per non-terminal member per poll; a
  transient status failure contributes `'unavailable'` and is not a stall signal
  (the 2026-07-24 misfire lesson: phase-only markers kill healthy workers mid-turn).
- **L6 — Exit parity.** The loop exits a member on exactly `terminal || phase ===
  'work_completed'` (`wave.mjs:293` resting set) — nothing else, no attention-based exits.
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
→ poll/steer loop → `wave.settle` → `wave.close` (guaranteed in `finally`) → assemble (and
optionally write) the evidence envelope → return the receipt.

**Policy — closed field set, all optional, frozen:**

| field | default | meaning |
|---|---|---|
| `steering` | `'nudge-on-checkpoint'` | closed enum; `'none'` disables steering |
| `completionMessage` | `'Continue the current turn.'` | nudge text (semantics default, application-semantics.mjs:359) |
| `pollIntervalMs` | `20_000` | poll cadence |
| `stallTimeoutMs` | `20 * 60_000` | status-hash silence before stall break |
| `hardCapMs` | `3 * 3_600_000` | absolute cap |
| `settleTimeoutMs` | `5_000` | forwarded to `wave.settle` |
| `finalization` | `'none'` | `'none'` \| `'claim-on-stall'` — per-member `claim_turn` before declaring loss (issue item 7 as ratified: claim is the only orchestrator result path, docs/35 §2.2(6); explicit opt-in, never a timer default) |
| `saltObjectives` | `true` | prefix `[attempt: <iso>]` per member (runs.start is idempotent by objective digest); the salt is recorded in the receipt |
| `preflight` | `true` | doctor() route-readiness derived from member routes (convenience; droppable in v1 if route normalization proves fiddly) |
| `evidencePath` | `null` | when set, the driver writes the envelope JSON; write failure fails the run loudly |
| `onProgress` | `null` | `(line, snapshot) => void` log hook; caller renders |
| `signal` | none | `AbortSignal`; abort = break → settle → close |

**Receipt** = the committed envelope (`{ schemaVersion: 1, outcomes, stops, remainingCount,
residueUnknown }`) plus additive fields: `basis` (`'completed' | 'stall' | 'hard_cap' |
'aborted'`), `nudges: [{ role, requestId, at }]`, `salt`, `pumpDrained`.

**Admission-time objective ergonomics:** after salting, each objective over 4096 bytes
(application-semantics.mjs:25) rejects at driver admission with an error carrying the byte
count — never the misleading `'Run objective is required'`.

## 3. Red-first tests — `impl/test/wave-driver-policy-red.test.mjs`

Harness mirrors `wave-driver-red.test.mjs:54-124` with a pausable card
(`turn-checkpoints-31b5-surface-red.test.mjs:90-107`; `driverKind: 'wave'` mints checkpoints,
`coordinator.mjs:10474-10488`). Small `pollIntervalMs`/`stallTimeoutMs`/`hardCapMs`.

- **D1 — requestId dedup:** two pauses → exactly two nudges, one per distinct `requestId`;
  the dedup key never involves the classification string (pins de818e3 AND the m1 mis-key).
- **D2 — status-hash liveness (positive misfire pin):** phase pinned while the view keeps
  changing never trips the stall clock; `basis === 'completed'`.
- **D3 — true stall:** frozen view for `stallTimeoutMs` breaks with `basis === 'stall'`,
  settles, closes `remainingCount === 0`, outcome per member.
- **D4 — hard cap:** live marker, `hardCapMs` fires, `basis === 'hard_cap'`; closed basis set.
- **D5 — salt + oversize ergonomics:** identical members across two `run()` calls attach to
  distinct runs; post-salt >4096-byte objective rejects with the byte count.
- **D6 — done-but-paused:** a finished-but-paused member is nudged with `completionMessage`;
  on `work_completed` the loop exits immediately.
- **D7 — envelope shape:** receipt and written file match the committed envelope plus
  additive fields; `pumpDrained === true`; envelope write failure fails loudly.
- **D8 — nudge failure tolerated:** `run.act('nudge_turn')` rejection is recorded and polling
  continues.
- **D9 — finalization policy:** `claim-on-stall` issues one `claim_turn` per stalled paused
  member before declaring loss; default `'none'` never invokes `claim_turn`.

## 4. Migration and compat

Each evidence driver collapses to `openBaton` + `createWaveDriver(baton, policy).run({
repoRoot, members })` (~10 plumbing lines); the four flat-timer drivers gain the status-hash
marker by migrating. All 18 committed `run-*-wave.mjs` drivers remain as historical receipts —
migration optional. No out-of-tree drivers are known; nothing they call is altered.

## 5. Deferred

Per-member stall *breaks* (cross-member attribution stays wave-level in v1);
policy-on-`waves.start` sugar (remains additive if dogfooding demands it); driver-managed
deployment roots (contradicts the six-driver evidence — `deploymentRoot` stays an `openBaton`
concern, L7).
