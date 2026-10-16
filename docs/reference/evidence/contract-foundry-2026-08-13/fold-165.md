# Fold record — #165 launch-time harvest-contract validation (v1 → v2)

[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc row-fold165]

- **Date:** 2026-08-13
- **Folded artifact:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md` (v1 → v2)
- **Frame:** `fold-2026-08-13-b/foundry-brief.md` (the shared fold frame; blind-QA law binds)
- **Row brief:** `fold-2026-08-13-b/row-fold-165.md`
- **Red-team (row report, governs over the QA on conflict):** `contract-foundry-2026-08-13/redteam-165.md` — 4 binding blockers (C1, D2-H1, D1-H1, D2-H4), non-blocking D1-H2/D2-H2/D2-H3/D2-H5/D2-H6, the A5 web omission, C2/C3 nits, `brief_unreadable` note.
- **Blind QA:** `review-foundry-2026-08-13-b/review-qa.md` §3 — SOUND with one amendment (H1 path normalization) + two nits + §3.4 instruction set.
- **Verification HEAD:** `e371f70`. Every `file:line` citation in the folded contract was re-verified THIS fold session (`grep -an`/`sed -n` for the NUL-bearing `application.mjs`/`coordination-store.mjs`; direct reads for the NUL-free files). None inherited from the v1 draft.
- **Outcome:** the four blockers are all FOLDED (C1 restated; D2-H1 positive path shape; D1-H1 scoped out as OQ6; D2-H4 extended to the interpreter seam as D2b). The QA §3.4 set is folded. Zero items STRUCK, zero ESCALATED (no authority-class ambiguity arose — the two "pick one" fixes were resolved as row judgment calls, recorded in the fold notes). No source files modified; work confined to `contract-foundry-2026-08-13/**`.

---

## Blocker map (the four binding items)

| Blocker | Claim | Resolution | Where |
|---|---|---|---|
| C1 | Exit-code map mis-cited: `:96,192-198` presented as one class; `:96` is start-refused, `:192-198` set no exit code. | **FOLDED** — map restated: exit 2 = launch/argument refusals (`:46,:48,:65`); exit 1 = start-refused only (`:96`, the no-run-returned branch); harvest verdicts (`:192-198`) are receipt-carried, process exits 0. | Refusal vocabulary (exit-code map), contract §Refusal vocabulary |
| D2-H1 | Bare-path grammar accepts prose — a line like `- the contract file, plus its fold map` is shape-valid. | **FOLDED** — positive path shape (no whitespace; basename carries `.` or path contains `/`); prose/table/fence/near-miss-heading lines refuse `deliverables_malformed`; A3 pins a whitespace-bearing prose line. | D2 grammar; A3 |
| D1-H1 | No harvest-time blob backstop on the DRIVER surface — a target absent at launch that the wave creates as a directory still poisons the driver pin. | **FOLDED (scope-out)** — red-team option (b): the driver's created-directory case explicitly scoped out as **OQ6** (distinct from OQ2's tree-content equality); D1/D3 language made surface-explicit (the `:632` backstop is interpreter-only). | D1a note; D3 lifecycle sentence; OQ6 |
| D2-H4 | No deliverable-coverage check on the `waves.run` surface — the D2 incident class still reachable via `baton waves run`. | **FOLDED (extend)** — red-team first option: coverage predicate extended to the interpreter admission-adjacent seam (**D2b**), riding `renderObjective`'s existing brief read (`:339`); refuses `workflow_harvest_invalid` naming the uncovered set; pinned by A7. | D2b; D3; A7 |

## Non-blocking map

| Item | Verdict | Where |
|---|---|---|
| D1-H2 — repoRoot gating vs categorical framing | **FOLDED** — one-line precondition in D1b (`waves.run` always supplies repoRoot; `renderObjective` refuses without one, `:335`). | D1b |
| D2-H2 — raw string set-difference, no normalization | **FOLDED** — one-pass path normalization before the coverage set difference; A6 pins the `./`-prefix/duplicate-slash non-refusal. | D2 normalization; A6 |
| D2-H3 — fence-state + near-miss/subsection vacuity | **FOLDED** — fenced regions skipped; near-miss headings refuse `deliverables_malformed`; `###` subsections do not terminate the section; residual prose-only vacuity folded into OQ3. | D2 grammar; OQ3 |
| D2-H5 — no targets ⊆ scope check | **FOLDED (named exclusion)** — operator-trust boundary; a target the scope can't touch surfaces as harvest `-INCOMPLETE`; recorded in OQ5. | D2 boundary note; OQ5 |
| D2-H6 — `{path, mustContain}` inexpressible in front-matter | **FOLDED (named exclusion)** — "the front-matter declares paths, not content"; content moves to a `waves.run` `{path, mustContain}` entry. | D2 grammar |
| A5 — web transport omitted | **FOLDED** — A5 now asserts CLI + MCP + web `waves_run` direct port carry `workflow_harvest_invalid`. | A5 |
| C2 — "three closed tokens" vs the four in the table | **FOLDED** — re-counted to four. | Refusal vocabulary intro |
| C3 — G2's `:138` ".status() call" | **FOLDED** — G2 now says `:138` reads `view?.terminalOutcome?.status` (a field read). | G2 |
| `brief_unreadable` behavior-change note | **FOLDED** — stated explicitly (every `--brief` launch now requires a readable brief). | D2 grammar |
| G8 test-range nit (`:663-686` truncated) | **FOLDED** — corrected to `:663-690`. | G8; A4 |

## QA §3.4 map (the instruction set)

| QA instruction | Verdict | Where |
|---|---|---|
| H1 — one path-normalization pass + a `./`/duplicate-slash non-refusal pin | **FOLDED** — same fix as red-team D2-H2; **A6** pins the non-refusal. | D2 normalization; A6 |
| Nit 1 — "four closed tokens" count | **FOLDED** — with C2. | Refusal vocabulary |
| Nit 2 — G2 `:138` → "a field read" | **FOLDED** — with C3. | G2 |
| Ship D1a/D1b, `## Deliverables` strict grammar, D3 three-axis as written | **FOLDED (shipped)** — shipped with the blocker closures; D3's three axes unchanged (D2b adds the coverage axis of the same admission law). | D1; D2; D3 |
| Name OQ2/OQ3 as follow-ons | **FOLDED** — OQ2/OQ3 named; OQ6 added (distinct from OQ2). | OQ2; OQ3; OQ6 |
| §3.2 positional note — `run-task-wave.mjs` lives at `docs/reference/evidence/run-task-wave.mjs` (dogfood driver), not `impl/` | **FOLDED** — one-line location clarification in Cross-references; the QA itself marks it "not an error". | Cross-references |

---

## Fold notes (judgment calls, recorded per the frame)

1. **D1-H1 chose scope-out (option b) over adding the driver blob check (option a).** The
   contract is launch-time-scoped (Ring-2, "specifies behavior at launch"); a driver harvest-time
   blob check is a different rung (harvest-time, adjacent to #99's authoritative-sha territory and
   OQ2's tree-content equality). Adding it would expand the contract beyond the row brief's D1/D2
   launch-time halves. The over-claiming sentences (D1 opening, D3 lifecycle) were made
   surface-explicit instead, and the gap is named OQ6 with its fix sketched.
2. **D2-H4 chose extend (option a) over name-boundary (option b).** The incident class is still
   reachable via `baton waves run`; closing it on the interpreter is feasible with zero new I/O
   (rides `renderObjective`'s brief read at `:339`) and reuses the existing typed code. Extending
   is the stronger fold — the same `## Deliverables` source of truth now gates both surfaces.
3. **A6 is a GREEN-path guard, not a RED pin.** At HEAD no coverage predicate exists, so the
   `./`-prefix non-refusal holds trivially; the QA ordered the pin, so it is included with its
   "RED-by-implementation" framing made explicit (it binds the GREEN implementation against a
   raw-string set-difference). All other pins (A1-A5, A7) are RED at HEAD by construction.
4. **D2's strict grammar got three closures beyond the blocker ask** (fence-state skip,
   near-miss-heading refusal, `###` non-termination) because D2-H3 asked for them and the QA's
   "strict grammar as written" shipped them together — one coherent, closed grammar rather than a
   piecemeal patch.
5. **The QA's "SOUND with one amendment" is overridden by the row report where they conflict.**
   The QA was written blind; the four row blockers stand and were folded ahead of the QA verdict.
   No conflict arose in substance — the QA amendment (H1) and the row blocker (D2-H2) resolved to
   the same normalization pass.
6. **D2-H4 seam placement (judgment call).** The red-team fix (a) says "parse the brief at
   `admitSpec` (`:154`)". This fold places D2b at the objective render instead — `runWorkflow` →
   `renderObjective` (`:510,:333-348`), where the brief is ALREADY read (`:339`) — zero new I/O,
   still before `waves.start`, still `workflow_harvest_invalid`. The red-team's own D2-H4 text names
   `renderObjective` as the feasible seam, so this is option (a)'s "interpreter admission seam"
   implemented at the existing brief read, not a scope-down.
7. **QA "pin A2/A3" → dedicated A6 (judgment call).** The QA's §3.3 H1 says "pin A2/A3 with a
   normalization case". Folded as a dedicated A6: the normalization non-refusal is a GREEN-path
   guard (no predicate at HEAD to misfire), a different pin kind from A2/A3's RED refusals; bending
   A2/A3 would blur their "RED at HEAD" contract. Substance delivered by A6.
8. **QA §6 "#165 ... `--check` wire path" mapped, not dropped.** The `--check` half is a cross-row
   artifact — no `--check` exists in the v1 contract's OQ1–OQ5, `row-launchval.md`, or this fold; it
   is #167's liveness flag (`application-cli.mjs:1264/:2213`). The #165 half (OQ3 front-matter
   adoption; OQ4 the unlanded #158 append verb — the wire-path question) is recorded in the
   contract's OQ3/OQ4.

## Verification

- Folded contract written IN PLACE at `contract-foundry-2026-08-13/contract-165.md` (version v2,
  `## Fold record` appended; every blocker/QA item above mapped FOLDED/STRUCK/ESCALATED — no
  silent drops).
- This fold map at `contract-foundry-2026-08-13/fold-165.md`; the attempt line
  `[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc row-fold165]` sits in the first five lines.
- Deployment verification run (`true`, no args, expected exit 0) — see the row close-out.
