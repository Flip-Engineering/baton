# #74 SUITE-FOLD BRIEF — fold the blue-team findings into the worker-orchestrated-swarm suite

You are folding a blue-team report into the #74 red-first suite. Read fully, in order: (1)
`suite-blueteam.md` (NEEDS-FOLD — three blockers + non-blocking findings, each with its
concrete fix); (2) `impl/test/worker-orchestrated-swarm-red.test.mjs` (your primary edit
target); (3) `contract-fold.md` (v1.1 — edit ONLY if a finding requires contract movement;
v1.2 note if so); (4) `suite-draft-notes.md` (update).

## Priorities (per the report)

- **Green-side blockers first** — §1.1 (the fixtures install the PERMISSIVE default authorize,
  so the D1.2 sibling-refusal legs can never go green: the fixtures must install the v1.1
  read-law authorize seam the contract pins); §1.2's three contract-side consequences; §1.5
  (the A8 delivery is unpinned).
- **Shallow-greenability blockers** — §2.1 (the permanence half: an impl recording `denied`
  while STILL marking the key handled must FAIL — pin `answeredKeys` exclusion + the ask
  staying pending + the later human answer settling); §2.2 (the over-refusal costume: the
  wave-scoped grant path must be asserted REACHABLE, not only the sibling refusal).
- **The static-anchor ruling (§3.2)** — keep ORDER/EXISTENCE/byte-string assertions; drop the
  tight absolute line windows (the report's own recommendation; replaces the re-base churn
  with drift-tolerant pins).
- **§4.1** — the P-D1.4 scan is too narrow; widen per the report.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic. `watchdog.stallMs` valid-positive in every fixture (the
  #67 law); `stallAction` only from the contract vocabulary.

## Deliverables (edit ONLY these)

`impl/test/worker-orchestrated-swarm-red.test.mjs` ·
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/suite-draft-notes.md` ·
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/suite-fold-2.md` (finding →
resolution map) · `contract-fold.md` (v1.2 ONLY if a finding requires contract movement).
