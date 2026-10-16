# ROW BRIEF — row-suite-163: the red-first suite for the folded #163 quiescence contract

Read `foundry-brief.md` first (the suite law binds you). Your source of truth:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (FOLDED —
quiescence-derived wave completion: the progressClass/liveness-gated candidate predicate (a
member mid-turn is NEVER a candidate), the #67 liveness kinds in the reset set, the
unreadable-member terminalization rule (the loop is total), the named `readView` projection
(`lastProgress`/`silenceMs`/`progressClass`), the `hardCapMs: null` sentinel + `normalizeDriver`
null branch, the D1.3 two-poll confirmation, DR-1(a)'s hard-break with the exclude-and-continue
follow-on named). Also read `redteam-163.md` (the mid-thought false-quiescence attack your rows
must discriminate — a silent-but-working member must NOT be quiesced) and `fold-163.md`.

Idioms to mirror: `impl/test/wave-observability-red.test.mjs` (drive-loop fixtures with
markerAdapter-style members) — your rows drive members to named liveness/phase states and
assert the candidacy verdicts; fake timers as doubles only, never wall-clock waits.

Deliverables (edit ONLY these): `impl/test/quiescence-completion-red.test.mjs` ·
`docs/reference/evidence/contract-foundry-2026-08-13/suite-notes-163.md` (row inventory +
stage table + both measured splits + judgment calls).
