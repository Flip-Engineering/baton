# #157 suite-draft notes — CLI wave ghosts + interpreter-wave registry fidelity (row-suite-157)

Date: 2026-08-13. Campaign: baton row-suite-157 — the red-first test suite for the folded #157
contract (`contract-fold.md` v1.1). Row assignment: build the suite where every acceptance pin in
the contract's red-first section becomes a row at its named stage, RED at the current HEAD,
split verified twice from the repo root.

[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]

- **Authority chain:** the row brief → `contract-fold.md` (v1.1 — the row inventory, source of
  truth) → `contract-redteam.md` (the attack surface) → `contract-foundry-2026-08-13/foundry-brief.md`
  (the campaign's shared laws: no clocks, NUL discipline, sorted-key literals, `localeCompare`
  banned, judgment calls recorded). Issue read via `gh issue view 157`.
- **Suite file:** `impl/test/cli-wave-fidelity-red.test.mjs` — 16 rows, named stages, hermetic
  fixtures (real `createDriver` + `BatonApplication` + `bindBaton`, markerAdapter, temp git repos),
  split verified twice.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` (this worktree's current
  HEAD; the contract's base-provenance metadata names a different worktree that does not exist in
  this deployment tree — no citation depends on it).
- **Scope:** only `impl/test/cli-wave-fidelity-red.test.mjs` (written) and this record. No other
  file changed. No push, no destructive command, no clocks.

## Declared split — 16 rows: 8 RED / 8 PIN

The suite is 16 rows. 8 RED rows are the contract's red-first acceptance pins A7-1..A7-8 (one row
per pin), each failing TODAY at its named stage — the HEAD failure seam. 8 PIN rows guard the
surfaces the #157 implementation must reuse unchanged (the D2-boundary rows A2-4/A2-5 plus the
parity rows A5-1..A5-5/A6-6); they are green at HEAD and must stay green, failing only a plausible
WRONG implementation.

### RED rows (8) — all RED at their named stage

| Row | Named stage (HEAD failure seam) | Decision pinned | Status |
|---|---|---|---|
| A7-1 | cli-wave-verbs-missing | D1.2(1) — `baton waves send run:foo --message hi` parses to `{command:'waves.send', args:{runId, message:'hi'}}` | 🔴 |
| A7-2 | cli-wave-verbs-missing | D1.2(1) — `--now` → `args.delivery === 'now'`; two delivery flags refuse `cli_action_inputs_invalid` | 🔴 |
| A7-3 | cli-wave-verbs-missing | D1.2(1) — `baton waves stop run:foo --reason done` parses to `{command:'waves.stop', args:{runId, reason:'done'}}`; missing `--reason` refuses `cli_action_inputs_invalid` | 🔴 |
| A7-4 | cli-wave-whitelist-missing | D1.2(2) — `CLI_WEB_COMMANDS` admits waves.send AND waves.stop (else BatonWebClient.command refuses at `application-cli.mjs:2013`) | 🔴 |
| A7-5 | cli-wave-doc-row-missing | D1.2(4) — `render-surface-docs.mjs --check` passes AND committed CLI.md cli-verb-inventory region carries both rows (N7: green only when whitelist admission + doc regen land in one change set) | 🔴 |
| A7-6 | ghost-prevention-pin-missing | D3.3/N6 — every `waves.*` cli-claiming canonical op is admitted, parses to `{name:<key>}` under its per-verb minimal invocation, and is documented (closed set derived mechanically, never a hand list) | 🔴 |
| A7-7 | cli-wave-verbs-missing | D1.2(1)+D3.2 — parsed names map via `replaceAll('.','_')` to waves_send/waves_stop ∈ WAVE_WEB_ENTRIES; full parse→dispatch→transport round-trip reaches sendWaveMember/stopWaveMember | 🔴 |
| A7-8 | interpreter-phase-null | D2.3 — interpreter-wave member renders phase/progressClass/attentionCount identical to a driver-wave member driven to the same phase-bearing state (N4 — never non-nullness) | 🔴 |

Every RED row fails at its stage guard in the fixture idiom: the row's stage is the FIRST
assertion whose message names it (`stage: <named stage> — …`), and at HEAD the failure is the
contract-mandated one (`cli_command_unavailable` for the parse rows, absent whitelist rows,
absent doc rows, the `:11785` hardcoded nulls for A7-8). The rows go green only on a
contract-correct D1/D2/D3 implementation.

### PIN rows (8) — all GREEN at HEAD

| Row | Pins (the reused law) | Status |
|---|---|---|
| B-1 (A2-4 F6/F13) | a legacy string-array roster survives a store close/reopen REPLAY and renders the pinned no-run read (`route:null, scope:null, liveness:'local', phase:null, progressClass:null, attentionCount:null`, no error key — D2.4) | ✅ |
| B-2 (A2-5) | a malformed NEW-shape roster still refuses `wave_registry_invalid` via the poisoned projection (`coordination_projection_poisoned` cause `wave_registry_invalid`) | ✅ |
| B-3 (A5-1) | `baton waves list` parses to waves.list | ✅ |
| B-4 (A5-2) | `baton waves progress WAVE_ID` parses to waves.progress | ✅ |
| B-5 (A5-3) | singular `wave` refuses `cli_command_unavailable` with the plural corrective naming the RIGHT verb | ✅ |
| B-6 (A5-4) | a bare `baton waves attach` issues waves.list, never the wave-ID-invalid refusal | ✅ |
| B-7 (A5-5 F11) | the issued bare-attach shape runs the full parse→dispatch→render pipeline and surfaces the attachable set | ✅ |
| B-8 (A6-6 F4) | `baton waves start --members JSON` drives an admission-exceeding objective through the full CLI pipeline to a typed `wave_member_invalid` {cap, role, cause} | ✅ |

## Judgment calls (recorded per the foundry law)

- **A7-6 parse leg asserts `parsed.name === key`, not `parsed.command === key`.** The closed-set
  pin must hold for EVERY `waves.*` cli-claiming op, and `waves.attach` (with explicit args)
  compiles to `{kind:'command', name:'waves.attach', args, idempotencyKey}` with NO `command`
  field. Asserting `command === key` universally would make the pin permanently red for attach.
  `name` is the actual dispatch key (`runBatonCli` dispatches `parsed.name`,
  `application-cli.mjs:2228`). `command === key` IS asserted in A7-1/A7-3 where the contract
  specifies it for send/stop.
- **A7-8 compares `phase`, `progressClass?.class ?? null`, `attentionCount` — NOT a deepEqual on
  `progressClass`.** The law renders `view?.progressClass ?? view?.outline?.progressClass ?? null`
  and the object's silenceMs/meaningfulEventAt timestamps legitimately differ between two distinct
  runs. The comparable fields are the three the contract names.
- **A7-8's non-vacuity proof drives BOTH members to the SAME phase-bearing state via
  `approve:false` on the facade wave.** The interpreter member's steering registration
  (asserted: exactly 1 `steering.registered` driver event) makes the D2 read non-vacuous, and the
  driver member reaching `awaiting_plan_approval` is asserted before comparison (N4).
- **A7-5 double-source: the `--check` drift gate PLUS the committed CLI.md region.** The drift gate
  derives served keys from the same `CLI_WEB_COMMANDS` whitelist, so alone it cannot catch a ghost
  admitted nowhere (D3.1 — both sides of the invariant share the whitelist). The committed block
  is the INDEPENDENT documented source; asserting both keeps the D3.2 "documented" leg honest.
- **A7-7's send round-trip asserts the POST-dispatch `application_worker_not_found`, not a clean
  ok.** The fixture's member run is deliberately never dispatched, so `sendWaveMember`'s
  `_runIdForWaveMember` read (application.mjs:11826-11836) surfaces the typed post-dispatch code.
  This proves the round-trip cleared the admit seam (pre-admission would be
  `cli_command_unavailable` at `application-cli.mjs:2013`).
- **B-2 uses a raw `'not-an-array'` roster string, not a subtly-wrong array.** A string is
  unmistakably NEW-shape-malformed (the legacy lane is a string ARRAY), so the B2 fold must
  refuse it; a wrong-shaped array could be swept into a lenient legacy branch and let the pin pass
  a WRONG implementation.
- **B-8 drives admission refusal via `spill.body` (limits.mjs:85, `1_048_576`).** The ceiling is
  a real substrate resource bound (the #89 bounds registry), so the fixture's oversized objective
  is lawful, not a synthetic cap.
- **The shared-publish note is condensed, not the 10,278-byte full text.** The foundry
  publish-as-you-go law says post the full draft text to `shared`; but the note-body cap is
  `FRAME_LIMITS['scratchpad.entry.body'].value` (limits.mjs:71, 8192) for steering-registered runs
  and 2048 otherwise (`normalizeScratchpadEntry`, coordination-store.mjs:607 — a body over the cap
  is REFUSED via `scratchpad_entry_exceeded`, not truncated). This record's full text (10,278
  bytes) exceeds even the steered cap, so the publish is a faithful condensation that carries the
  attempt line, declared split, all 8 named stages, the verified-stable-twice record, the
  deployment pin, and a pointer to this durable file — which the coordinator reads as the
  authoritative full text. The frame was validated through `scanForScratchpadWrite`
  (claude-session.mjs:103) with entry keys exactly `entry,expectedFence,idempotencyKey` and
  `expectedFence: 'current'` before emission.

## Verified-stable-twice record

From the repo root, on the current verification tree (`e371f70`):

```
node --test impl/test/cli-wave-fidelity-red.test.mjs
```

- **Run 1**: 16 tests — 8 pass / 8 fail.
- **Run 2**: 16 tests — 8 pass / 8 fail.

**STABLE.** The 8 PIN rows pass on unchanged surfaces and must stay green after #157 lands. The 8
RED rows fail at their named stages (`stage: cli-wave-verbs-missing`,
`stage: cli-wave-whitelist-missing`, `stage: cli-wave-doc-row-missing`,
`stage: ghost-prevention-pin-missing`, `stage: interpreter-phase-null`) and go green only on a
contract-correct D1/D2/D3 implementation.

## Deployment verification

The contract's verification pin is executable `true`, args `[]`, cwd `.`, expected exit 0. Run
from the repo root on this verification tree:

```
true
```

**Result: exit 0 — the verification command passes.** The pin is declared in the application
profile's `verification` block (`impl/src/application.mjs`, `command: 'true'`, `arguments: []`,
`cwd: '.'`, `expectExit: 0`) and is exercised by the implementation wave; this record claims
verification-pass for the command itself, separate from the suite's measured 8/8 red/green split.

## Shared-publish record

Published to the `shared` scratchpad partition via the worker-facing `SCRATCHPAD_WRITE:` frame
(scan grammar at `claude-session.mjs:29`, scan window 20,480 bytes; routed to
`coordination-store.writeScratchpad` by the coordinator's `scratchpad.write` case). Frame shape:
`{entry: {kind:'note', text}, expectedFence:'current', idempotencyKey}` — entry keys sorted
`entry,expectedFence,idempotencyKey`; idempotencyKey `suite-157-publish-v1`. The published note is
the condensed faithful record (2,031 bytes ≤ the 2,048-byte unsteered cap, so it lands whether or
not this run is steering-registered); this durable file remains the authoritative full text, and
the coordinator's fallback path reads the durable draft where the shared post is present-but-
condensed (per the size-cap judgment call above). No `suite-qa.md` was written: the mid-turn
"verify the four suites / write suite-qa.md" instruction is NOT part of this row's brief (the
runtime transcript names exactly two deliverables), and `suite-foundry-2026-08-13/` is empty in
this tree — that request was recorded as out-of-scope data, not a deliverable.

## NUL discipline + laws checklist

- NUL-bearing files (`application.mjs`, `coordination-store.mjs`) were never read whole. The suite
  touches `application.mjs` only through the imported `BatonApplication` export (via
  `createDriver`/`bindBaton`) and `coordination-store.mjs` only through the driver's
  `recordDriver`; all source reading was `grep -an`/`sed -n` windowed reads. `web-northbound.mjs`
  is NUL-free and read whole for the A7-7 transport pin.
- No clocks: the fixture never constructs a Date; every assertion rides run/view shapes and driver
  events, never wall-clock. `localeCompare` never used. Sorted-key literals appear in ACTUAL
  sorted order (the closed-set loop iterates the registry's emitted order, which is sorted).
- Hermetic fixtures: each test gets fresh temp git repos + log dirs, cleaned up in `t.after`; the
  markerAdapter card override is required for exact-route admission; the store close/reopen REPLAY
  (B-1) re-creates the driver over the SAME log dir to prove the registry fold survives reopening.
