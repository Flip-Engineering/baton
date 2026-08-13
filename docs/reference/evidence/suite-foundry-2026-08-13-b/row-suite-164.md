# ROW BRIEF — row-suite-164: the red-first suite for the folded #164 contract (v2)

Read `foundry-brief.md` first (the suite law binds you — red-first, named stages, hermetic,
split-twice, the attempt-echo law in the first five lines). Your source of truth:
`docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (v2 FOLDED — blind
waits fail loud: the wait-local terminal-truth helper per DR-1(a) with the durable-stop
predicate extended to the settle-block loop, the RA6/RA7 pins, the FP-05 unknown≡foreign pin,
`application_wait_invalid` in the refusal table, the additive-only law). Also read
`redteam-164.md` (the attack surface — the transport-principal over-claim class your rows must
discriminate) and `fold-164.md`.

Idioms to mirror: `impl/test/wave-observability-red.test.mjs` (long-poll/wait seams) — the
rows exercise wait verbs against terminal/auth states; hermetic fixtures drive runs to the
named states, never real providers and never wall-clock waits (fake timers as doubles only).

Deliverables (edit ONLY these): `impl/test/blind-waits-red.test.mjs` ·
`docs/reference/evidence/blind-waits-2026-08-13/suite-draft-notes.md` (row inventory + stage
table + both measured splits + judgment calls).
