# #157 cli-wave-fidelity red suite — fold-suite-157 (blue-team findings → resolutions)

[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf157]

*Fold of the red-first acceptance suite for the #157 cli-wave-fidelity contract (v1.1). Source
review: `blue-team-2026-08-13-a/blueteam-157.md` — the adversarial acceptance review of the
16-row suite at HEAD `e371f70`, final verdict **NEEDS-FOLD** with five numbered fold blockers.
This fold edits `impl/test/cli-wave-fidelity-red.test.mjs` IN PLACE and records the re-verified
split here. Every `file:line` citation was re-derived this session on the current worktree HEAD
`e371f70` (NUL discipline: `application.mjs`/`coordination-store.mjs` only via `sed -n` ranges
and the imported exports, never read whole).*

- **Suite:** `impl/test/cli-wave-fidelity-red.test.mjs` (16 rows: 8 PIN green / 8 RED at named stages)
- **Contract:** `contract-fold.md` **v1.1** (unchanged — this fold is suite-only; no contract movement)
- **Verified split (pre-fold, HEAD `e371f70`):** `node --test` from the repo root — **16 rows ·
  8 pass · 8 fail**, recorded after TWO consecutive runs (matches the suite header's declared split).
- **Verified split (post-fold, HEAD `e371f70`):** **16 rows · 8 pass · 8 fail**, identical across
  TWO consecutive runs — the same 8 RED rows, each failing at its named stage; no PIN row moved.

---

## Fold-map (blue-team finding → resolution)

| # | Blue-team finding | Verdict | Resolution — where |
|---|---|---|---|
| 1 | A7-8 pins **equality only, at one phase state** — a constant (guarded or not) in the string branch passes the row while the projection never inspects the run (§2.9 M5, §4). | blocker → folded | **A7-8 gains the live-read CHANGE leg.** After the parity assertions, `interp.runs.get('alpha').approve()`, re-list, and assert the interpreter member's rendered phase **and** progressClass both CHANGE while the never-approved driver member stays at `awaiting_plan_approval`. At HEAD the string branch hardcodes `phase:null` (application.mjs:11785), so this leg fails at the same seam as the parity leg; no constant can satisfy a change. |
| 2 | A7-1/A7-2/A7-3 don't pin the new verbs' **refusal vocabulary** — a shape-special-cased parse branch passes without `id()`, `--claim-grant`, or `--nudge` (§2.9 M1). | blocker → folded | **A7-1 + A7-3 gain id-refusal negative legs** (`waves send bad id` / `waves stop bad id` → `cli_invalid`); **A7-2 gains the `--nudge` delivery positive leg** (`delivery 'nudge'`, the schema's third enum member) **and a non-JSON `--claim-grant` refusal** (`cli_action_inputs_invalid`, the contract refusal vocabulary). The parse must be schema-shaped, not shape-special-cased. See JC-1. |
| 3 | A7-5 doesn't pin **regeneration-vs-hand-edit** — a byte-matching hand-edit + renderer hardcode passes the doc row without the whitelist admission (§2.9 M3). | blocker → folded | **A7-5 replaces the two `assert.match` legs with a byte-equality assertion:** `renderCliVerbInventory()` must **byte-equal** the committed CLI.md cli-verb-inventory region (independently of the whitelist), so the renderer and the committed doc must BOTH move together. The cluster's A7-4 keeps the admit duty. See JC-4. |
| 4 | A7-6's `minimalWaveCliInvocation()` is a hand-written per-key `switch` — the **N6 "never a hand-arg table" law deviation**. | needs-fold → folded | **`minimalWaveCliInvocation()` now derives each verb's argv mechanically** from the registry schema's required set (`WAVE_CLI_POSITIONAL_ID_FIELDS` + per-field kebab flag + per-type minimal value). `waves.stop`'s CLI-required `--reason` rides the OQ1 seam (the schema required set omits it); `waves.run`'s `specPath` is a positional special case. A new cli-claiming op derives its argv instead of throwing `no CLI minimal invocation pinned for <key>`. |
| 5 | A7-7's round-trip **never crosses the web whitelist gate** — `cliRoutingClient` calls the application command bus directly, so a parse-only impl (whitelist untouched) flips the row green (§2.9 M1). | blocker → folded | **The dispatch legs route through `webGatedClient`** — a client that applies the exact `CLI_WEB_COMMANDS` gate (`application-cli.mjs:2013`: `if (!CLI_WEB_COMMANDS.has(name)) throw cliError(..., 'cli_command_unavailable')`) BEFORE dispatching to the command bus, so "parse only" fails the dispatch leg. The admit seam is pinned twice (here + A7-4). See JC-2. |

---

## Complete disposition — every blue-team finding (FOLDED / STRUCK / ESCALATED)

The blue-team's `§4 per-row verdict summary` is the canonical finding list; the fold above is the
numbered-blocker work. This section dispositions **every** finding in the report — the per-row
verdicts, the §4 whole-suite fake, the §2.9 bite-test evidence, and the §5 law re-check — so
nothing escapes without an explicit FOLDED / STRUCK / ESCALATED. **ESCALATED: none** — every
finding resolved within the blue-team's own fix language; the judgment calls (JC-1..JC-4) are
suite-side choices the fix explicitly left open, not authority-class ambiguity.

| Finding (blue-team §) | Verdict | Disposition |
|---|---|---|
| A7-1 (SHALLOW, §2.9 M1) | shape-special-cased parse passes | **FOLDED** — id-refusal negative leg (`bad id` → `cli_invalid`); see fold-map #2, JC-1 |
| A7-2 (SHALLOW, §2.9 M1) | mode-subset parser passes | **FOLDED** — `--nudge` delivery positive leg + non-JSON `--claim-grant` → `cli_action_inputs_invalid`; see fold-map #2 |
| A7-3 (SHALLOW, §2.9 M1) | shape-only stop branch passes | **FOLDED** — id-refusal negative leg (`bad id` → `cli_invalid`); see fold-map #2 |
| A7-4 (SOUND, §2.9 M2) | whitelist IS the object under test; no cheaper wrong impl | **STRUCK** — carried byte-stable; the admit seam stays pinned by the direct Set check |
| A7-5 (SHALLOW, §2.9 M3) | matching hand-edit + renderer hardcode passes | **FOLDED** — byte-equality `renderCliVerbInventory()` ↔ committed region; see fold-map #3, JC-4 |
| A7-6 (SOUND + N6 law deviation, §2.9 M4/M6) | no cheaper wrong impl than the full admit+parse+doc set | **STRUCK** the SOUND verdict (row unchanged) — **FOLDED** the N6 hand-arg-table deviation; `minimalWaveCliInvocation()` now derives argv mechanically; see fold-map #4 |
| A7-7 (SHALLOW, revised on M1) | round-trip never crosses the web whitelist gate; parse-only passes | **FOLDED** — dispatch legs route through `webGatedClient` (the exact `CLI_WEB_COMMANDS` gate, application-cli.mjs:2013); see fold-map #5, JC-2 |
| A7-8 (SHALLOW — the deciding finding, §2.9 M5) | guarded constant in the string branch passes while never inspecting the run | **FOLDED** — CHANGE leg: approve the interpreter member's run, assert rendered phase/progressClass CHANGE, driver stays put; see fold-map #1, JC-3 |
| B-1..B-8 (all SOUND pins, §2.9 M5/M7-M13) | each bites a named wrong impl; none decorative | **STRUCK** — all eight carried byte-stable; each still bites (M5, M7-M13) under the folded suite |
| §4 whole-suite fake (the NEEDS-FOLD driver) | D1 correct + faked D2: guarded constants for every registered member pass A7-8 and preserve B-1 | **FOLDED** — the CHANGE leg cannot be satisfied by any constant, guarded or not. **Empirically re-verified this fold** on a scratch copy (M1 parse-only + M5-guarded constants applied): the fake now fails A7-8 at the **CHANGE leg** (`approving the interpreter member run CHANGES its rendered phase` — the parity leg passes under the constants, the constant cannot change), while B-1..B-8 stay green. |
| §2.9 bite-test record (M1-M13) | empirical evidence per row | **STRUCK** as standalone findings — each mutation's proof is subsumed by the row's disposition above. **Re-verified this fold** against the folded suite on a scratch copy: **M1** (parse-only) stays RED — A7-1/A7-3 at the id-refusal negative legs, A7-2 at the `--nudge` leg, A7-7 at the web gate (`cli_command_unavailable`); **M5-guarded** (D2 constant) stays RED at the A7-8 CHANGE leg. **M3** (renderer hardcode + doc regen) still passes A7-5 by design — the byte-equality leg pins renderer↔doc agreement (#142 regenerate-never-hand-edit); the admit duty stays with A7-4 in the cluster, exactly as the blue-team's blocker-3 fix language states. |
| §5 law re-check | all frame laws pass; no instability | **STRUCK** — no findings; the fold adds no new clocks, no hand-arg table, no NUL reads, and keeps the marker-anchored source reads |

---

## Judgment calls

- **JC-1 — the id-refusal negative leg uses `'bad id'`, not the blue-team's literal `nope`.**
  The blocker's fix language is "`waves send nope` → `cli_invalid` (id refusal)", but `nope`
  passes the `id()` regex (`/^[A-Za-z0-9._:-]{1,256}$/u`, application-cli.mjs:100-103) — under
  the correct impl it is a VALID id, so that literal example would make the negative leg
  unsatisfiable (a BROKEN row). The fold preserves the intent — pin the `id()` refusal — with a
  space-bearing id that deterministically fails the gate.
- **JC-2 — A7-7 binds the gate into a web-shaped client instead of constructing `BatonWebClient`.**
  The blocker offers both ("route through the real `BatonWebClient` (or bind its whitelist gate
  into the dispatch assertion)"). `BatonWebClient` is an HTTP transport client
  (`this._json('/v1/commands', …)`, application-cli.mjs:2033) — it needs a live server, origin,
  and auth; the suite's hermetic fixture never runs one. `webGatedClient` applies the identical
  gate line before the command bus, so the admit seam is pinned twice hermetically.
- **JC-3 — A7-8 uses the CHANGE leg (the blocker's "minimally" option), not drive-to-different-states.**
  The primary fix ("drive the two members to DIFFERENT phase-bearing states and assert their
  projections still equal the respective runs") is unstatable at HEAD: the string branch renders
  `phase:null` for every registered member (application.mjs:11785), so the interpreter member's
  projection can never equal the driver lane's live `awaiting_plan_approval` — the primary leg
  would assert a contradiction instead of a seam. The CHANGE leg proves the read is live and
  fails every constant, guarded or not (probe-verified: approve → `awaiting_plan_approval` leaves
  the run deterministically).
- **JC-4 — A7-5 byte-equalizes the TRIMMED inner region.** The committed block's outer marker
  lines (`<!-- BEGIN/END GENERATED: … -->`) are renderer framing, not content; the assertion
  compares the inner region (marker-to-marker, blank-line-trimmed) so framing whitespace cannot
  false-fail the row. Byte-for-byte on the content slice is the law; the framing is not. The
  renderer byte-equals the trimmed committed slice at HEAD (3489 bytes) — verified before
  committing to the assertion.

---

## Red-first split

### Pre-fold (HEAD `e371f70`, the suite as drafted)
- `node --test impl/test/cli-wave-fidelity-red.test.mjs` from the repo root, run **twice**:
  **16 rows · 8 pass · 8 fail**, stable across both runs.
- **GREEN 8** — B-1..B-8 (the D2-boundary + parity PIN rows).
- **RED 8** — A7-1..A7-8, each at its named stage.

### Post-fold (HEAD `e371f70`, this fold applied)
- `node --test impl/test/cli-wave-fidelity-red.test.mjs` from the repo root, run **twice**:
  **16 rows · 8 pass · 8 fail**, identical across both runs.
- **GREEN 8** — B-1..B-8 (identical set; none moved).
- **RED 8** — A7-1..A7-8 (identical set; each still fails at its named HEAD seam). The fold legs
  sit AFTER the named stage and fail where their parents do, so no RED row was handed a green and
  the fold added no false red:
  - A7-5 → `cli-wave-doc-row-missing` (the byte-equality leg engages only after D1.2 regenerates
    the rows);
  - A7-7 → `cli-wave-verbs-missing` (the web-gated dispatch legs engage only after D1.2 parses
    the verbs);
  - A7-8 → `interpreter-phase-null` (the CHANGE leg sits after the parity leg, which fires first).
