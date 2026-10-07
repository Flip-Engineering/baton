[attempt: 4b19d324-91d7-4f4f-86af-aa156a744331 row-harvest-recovery]

# ROW notes — row-harvest-recovery: harvest_miss carries the member's checkpoint sha (#241)

Issue #241 (wave-h measured): row-admission-align completed work_completed with resultSha
9d3d766fa4 (the checkpoint exists and is pinned) but its declared report missed the harvest —
the settle receipt showed harvest_miss with NO pointer to the recoverable work; recovery
required ledger archaeology. This wave (wave-b) lands the red-first pin + fix: the miss rows
carry the MEMBER OUTCOME's resultSha through as `recoverySha` (the work is not lost; the pin
is the pointer).

## Deliverable

1. RED pin `impl/test/harvest-recovery-red.test.mjs` (4 rows, all RED at HEAD at the named
   `recoverySha` assertion — the field does not exist before the fix):
   - R1: absent-path miss + member outcome sha → the miss row surfaces the member outcome's
     resultSha as `recoverySha`; the member outcome KEEPS `resultSha`; the absent row's own
     `resultSha` stays null (nothing recovered there — honest); the recovered `harvest_ok`
     row carries NO `recoverySha` (the pointer is miss-scoped). Verdict WAVE-INCOMPLETE (F9).
   - R2: absent-path miss + NO member sha → `recoverySha: null` — never invented.
   - R3: marker-miss site (:836) → `recoverySha === resultSha === the recovered member sha`.
   - R4: mustContain-miss site (:839) → `recoverySha === resultSha === the recovered member sha`.
2. Fix in `impl/src/workflow-interpreter.mjs` `harvestOne` — the three miss returns:
   - absent path (was :826): `recoverySha` = the first roster-order member outcome's
     `resultSha` (null when no outcome carries a sha — never invented);
   - marker miss (was :836) and mustContain miss (was :839): `recoverySha: resultSha`
     (the recovered member sha). `resultSha` stays on the member outcome, untouched.
3. GREEN + batteries.

## RED verification (at HEAD, before the fix)

`node --test impl/test/harvest-recovery-red.test.mjs` → tests 4 · pass 0 · fail 4. Every row
failed at its named `recoverySha` assertion with `actual: undefined` (the field is absent at
HEAD):
- R1: `the harvest_miss row carries recoverySha === the member outcome resultSha`
- R2: `no member resultSha → recoverySha null`
- R3: `the marker-miss row carries recoverySha === the member outcome resultSha`
- R4: `the mustContain-miss row carries recoverySha === the member outcome resultSha`

RED reason is the intended one: the miss rows carry no pointer to the recoverable pinned
work. (Initial R3 fixture used a plain harvest path, which trusts the sha and receipts
harvest_ok — the marker check only runs on `mustContain` entries — so R3 was re-arranged to a
mustContain entry, mirroring W4-03, to exercise the :836 branch.)

## Fix

`impl/src/workflow-interpreter.mjs` (harvestOne):
```js
if (!recovered) {
  const recoverySha = outcomes.find((outcome) => outcome?.resultSha)?.resultSha ?? null;
  return { ...base, ok: false, missed: true, matched: false, code: 'harvest_miss', recoverySha, resultSha: null, bytes: null };
}
// :836
return { ...base, ok: false, missed: true, matched: false, code: 'harvest_miss', recoverySha: resultSha, resultSha, bytes, actual: bytes };
// :839
return { ...base, ok: false, missed: true, matched: false, code: 'harvest_miss', recoverySha: resultSha, resultSha, bytes, expected: entry.mustContain, actual: bytes };
```

## Judgment calls (recorded per the brief's messageOnSpawn)

- Field name: `recoverySha` on the miss row; `resultSha` REMAINS on the member outcome (the
  wave-a brief allowed `harvest.resultSha` OR `harvest.recoverySha`; this wave pins
  `recoverySha` — the miss row's own `resultSha` stays null on the absent path because
  nothing was recovered there, and the two fields would collide semantically otherwise).
- Selection rule for the absent-path miss (multi-member waves): the FIRST roster-order member
  outcome carrying a `resultSha`. Deterministic, matches the measured single-member shape,
  and never invents (null when no outcome has a sha).
- No-sha test branch (R2): a pausable member that completes a turn then PARKS never
  finalizes — no result-section sha, no retained pin, so `outcome.resultSha` is null (the
  quiescence-completion R1 shape: "a quiesced member with no committed result sha"). This is
  fast and deterministic. (A start-refused phantom also settles resultSha null but leaves a
  zombie task that costs ~60 s in `wave.close` + ~60 s in shutdown — rejected; a zero-edit
  completed member still receipts a result sha via the run's result section — rejected.)
- R2 receipts verdict WAVE-QUIESCED (the parked roster quiesces), not WAVE-INCOMPLETE.

## GREEN verification

- `node --test impl/test/harvest-recovery-red.test.mjs` → tests 4 · pass 4 · fail 0
  (~2.6 s).
- Named batteries: `workflow-as-data-red.test.mjs` + `wave-driver-red.test.mjs` +
  `wave-driver-policy-red.test.mjs` → tests 52 · pass 52 · fail 0.
- Adjacent harvest-miss suites: `quiescence-completion-red.test.mjs` +
  `worker-orchestrated-swarm-red.test.mjs` → tests 31 · pass 31 · fail 0.
- `harvest-accessor-red.test.mjs` (34 red) and `workflow-surface-red.test.mjs` (2 red:
  FP-14/FP-15, stage: tools absent) — those suites' own pre-existing RED rows for different
  surfaces (MCP resultpin/harvest accessor, facade tool registration); untouched by this
  change (harvestOne is not on their paths).

## Verification command (definition of done)

`true` (argv `[]`, cwd `.`) → exit 0. The repository improvement is implemented and
verified above; the requested exact execution contract is preserved.
