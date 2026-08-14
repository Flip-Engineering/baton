# COMPLETE-QA — honesty completion wave (wave-c)

[attempt: 12EEF6B3-F38D-48A0-9DAC-916DF954A400 coordinator]

Coordinator acceptance gate for the honesty package's completion wave. Every claim below is a
cited suite run (`node --test`, exit split), a code anchor, or an explicitly named absence. No
clocks, no fabrication. Verdicts drive the landing. The four wave-c rows own the disjoint seams
(`run.scratchpad.append` CLI/dispatch/restrictor legs + the artifact-count re-pin); my job is the
acceptance below, not their implementation.

---

## 1. Await-inputs / signal status

The wave-c rows are `row-cli2`, `row-web2`, `row-deploy2`, `row-docs2` (wavefile
`complete/impl-honesty-c.wavefile`). Their reports are
`notes-row-cli2.md` / `notes-row-web2.md` / `notes-row-deploy2.md` / `notes-row-docs2.md` in
this directory. Polled at ~30s cadence across this worktree and the sibling `.baton/wt/ws-*`
worktrees:

| Input | State at acceptance time |
|---|---|
| `notes-row-cli2.md` | **ABSENT** |
| `notes-row-web2.md` | **ABSENT** |
| `notes-row-deploy2.md` | **ABSENT** |
| `notes-row-docs2.md` | **ABSENT** |

`git worktree list` shows the sibling worktrees at baseSha `dc476d87` (no commits); the wave-c
row worktrees were still materializing during the acceptance window (new `ws-*` worktrees
appearing at 21:46Z). Absence is not death (#174 law), but at verification time no wave-c row
produced a notes file, a diff, or a signal — so there is no wave-c implementation to grade
sound vs needs-fold. Each row's target stages are still at their base RED split (§3), which is
the on-disk proof.

The recovered wave-b rows' notes that ARE present (`notes-row-kernel.md`,
`notes-row-errors.md`, `notes-row-docs.md`) were read in full and are the terrain map the
briefs name. `notes-row-cli.md` is absent from the tree (row-cli's harvest was
drain-truncated); its cross-seam terrain survives in
`recovered/row-cli.harvest-757cf506.patch`, quoted in §5.

## 2. Recovered-work verification (wave-b is APPLIED)

The brief states the recovered rows' work is already in the tree. Verified against the three
recovered notes:

- **row-kernel** (`#158` write lane): `appendScratchpad` present (`coordination-store.mjs:14224`),
  admission tables in `mcp-northbound.mjs` (5 sites: `:118`/`:737`/`:907`/`:1298`/`:2044`) and
  `web-northbound.mjs` (4 tables). Suite split **8 green / 15 red** — the 8 green
  (A2-1, A2-3, A3-2, P-A1, P-A4, P-A5, P-A6, P-A7) are exactly the kernel's 8 rows in
  `notes-row-kernel.md` §Acceptance. MATCHES.
- **row-errors** (`#160`): `error-actionability-red` **22/22** and `mcp-reflex-surface-red`
  **21/21** green — matches `notes-row-errors.md` (22/22, 21/21).
- **row-docs** (`#159`): `doc-truth-conformance-red` green rows R2/R6/R7/R10/P-CS1-b/P-CS4 match
  `notes-row-docs.md` §per-row (6 of its 7 green rows; the 7th, R11, is re-RED below — see §6).

The one discrepancy is **R11** (`artifact-counts-stale`): it was green in row-docs' worktree
(`counts.webBusCommands=31, parserLifecycleActions=29`) but is RED here with
`parserLifecycleDispatchCount` throwing "lifecycle dispatch gate present" at
`doc-truth-conformance-red.test.mjs:190` — the parser's lifecycle-dispatch accessor the D1 leg
exports isn't served at this tree. That is the row-docs2 dependency on row-cli2/row-web2's
dispatch work, not a row-docs regression.

## 3. Acceptance — measured splits

All run from `impl/` via `node --test <suite>`; full logs under `/tmp/coord-qa/*.log`.

### 3.1 Headline + targets

| Suite | split | wave-c stages (all RED at this tree) |
|---|---|---|
| `scratchpad-write-red` | **8 pass / 15 fail** | A1-1, A1-2, A2-2, A3-1, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2, A7-3, A8-1, A9-1, A9-2, A10-1 |
| `doc-truth-conformance-red` | **6 pass / 7 fail** | R1, R3, R4, R5, R8, R9, R11 |
| `cli-wave-fidelity-red` | **16 pass / 0 fail** | — (green, but see §5 PT-7) |
| `error-actionability-red` | **22 pass / 0 fail** | — |
| `mcp-reflex-surface-red` | **21 pass / 0 fail** | — |

The RED set maps to the four wave-c rows exactly: A1-1/A1-2/A9-1 (+A9-2/A10-1 teaching/admission)
→ row-cli2; A2-2/A3-1 (+R3/R8/R9) → row-web2; A4-1/A4-2/A5-1 → row-deploy2; R11 → row-docs2.
A6-1/A7-1/A7-2/A7-3/A8-1 are kernel-reachable rows that flip green once the CLI dispatch lands
(`notes-row-kernel.md` §"Rows still RED"). None of these are green — the wave-c legs have not
landed.

### 3.2 Adjacents (item 4)

| Suite | split | bar | status |
|---|---|---|---|
| `cli-silent-start-red` | 7 pass / 5 fail | 7 PIN green + 5 #155 capability red-by-design | ✓ |
| `phase16-mcp-northbound` | 29/29 | green-unchanged | ✓ |
| `phase67-progressive-agent-experience` | 12/12 | green-unchanged | ✓ |
| `phase72-kimi-orchestrator-mcp` | 20/20 | green-unchanged | ✓ |
| `wave-observability-red` | 30/30 | green-unchanged | ✓ |
| `event-log-read-scaling-red` | 2/2 | green-unchanged | ✓ |
| `waves-list-scaling-red` | 1/1 | WLS-1 | ✓ (green at this tree) |

`waves-list-scaling-red` WLS-1 is **GREEN** here (1 pass / 0 fail), not RED-by-design — the
brief's parenthetical ("WLS-1 stays RED-by-design until its own wave — name it, don't absorb
it") does not match this tree; there is no red WLS-1 to name. Reported as green-unchanged.

`cli-silent-start-red`: the 5 red rows are PT-2a/PT-2b/PT-2c/PT-4/PT-5 — the #155 capability
rows (row-cli's separate package), exactly the red-by-design set named in
`notes-row-errors.md` §"Not green". The 7 PIN rows (PT-1/3/6/7/8/9/10) are green.

### 3.3 Surface conformance (item 5)

`node impl/scripts/surface-conformance.mjs` → **`surface-conformance: ok`, exit 0**. ✓

### 3.4 Landing blockers (item 6) — RED, adjudicated in §4

| Suite | split | red stages |
|---|---|---|
| `phase11-persistent-sessions` | 41 pass / 2 fail | NR1/NR3, NR3/NR5 |
| `phase12-web-northbound` | 31 pass / 2 fail | UA5/WN, WN4/WN5/WN7 |

## 4. Landing-blocker adjudication (item 6)

Both fail at the recovery base `bcca97b` (bisect-proven per the brief), so they are
recovered-work collateral, not the eventsView work. Adjudicated below.

### 4.1 `phase12-web-northbound` — the refusal surface LEGITIMATELY MOVED → restage

- **UA5/WN** (`phase12-web-northbound.test.mjs:196`): malformed Run intent → actual
  `application_route_invalid`, expected `invalid_command`.
- **WN4/WN5/WN7** (`:510`): unknown top-level field / actor / credential / modelPolicy → actual
  `unknown_top_level_field`, expected `invalid_command`.

Root cause is `#160` R4 (error-actionability — the authority). `validateEnvelope`
(`web-northbound.mjs:516-559`) now returns **structured** refusals carrying the typed code +
field instead of collapsing to `invalid_command`:

- `:521-525` — unknown top-level field → `{ code: 'unknown_top_level_field', field, message }`
  ("#160 R4: name the offending KEY in `field` (W1)").
- `:532-537` — unknown arg field → `{ code: 'unknown_argument_field', field, ... }` (W2).
- `:543-559` — a **named** validator refusal passes its code through (W3/W8-2): the
  `validateApplicationCommandArgs` throw of `application_route_invalid` surfaces verbatim instead
  of the pre-#160 `application_command_arguments_invalid` collapse.

The pass-through is the exact behavior the `error-actionability-red` suite pins green — W1
(`unknown_top_level_field` names the key) and W8 (`a vocabulary-code validator failure passes
through its named code`), both GREEN. So the phase12 `invalid_command` pins are the pre-#160
generic shape and are now stale.

**Disposition: RESTAGE** the two phase12 pins to the specific codes. The move is quoted at
`web-northbound.mjs:543-559` (named-validator pass-through) and `:521-525` (structured
`unknown_top_level_field`). The suite's own sibling test at `:516-524` already pins the specific
codes (`unknown_top_level_field` / `unknown_argument_field` / `unknown_model_policy_field`), which
is the intended post-#160 shape to extend to `:510`.

### 4.2 `phase11-persistent-sessions` — the admitted-Brief shape MOVED (restage, with a caveat)

- **NR1/NR3** (`phase11-persistent-sessions.test.mjs:564`) and **NR3/NR5** (`:610`):
  `deepStrictEqual` on the admitted Brief fails — `actual` carries `attention: []`, `expected`
  does not.

```
+     attention: [],
```

The `attention` field is a canonical outline field (`APPLICATION_SERIALIZATION_ORDER.outline`
lists `attention` at `application-semantics.mjs:145`), and the adapter renders it
(`renderAttentionSection(brief.attention)` at `adapter.mjs:173`). The Brief reaching the adapter
dialect hook now carries the defaulted `attention: []`. The prime suspect (per the brief) is
row-kernel's `application-semantics.mjs` registry row or the northbound dispatch edits — the
outline projection now defaults `attention` onto the admitted Brief.

**Disposition: RESTAGE** the two pins to include `attention: []` (the move is quoted as the
`+ attention: []` diff above; the field is canonical per `application-semantics.mjs:145`). Caveat:
the stage name is "immutable admitted Brief", so the landing must confirm the coordinator is
permitted to normalize/default the Brief (add `attention: []`) rather than pass it through
byte-identical. If immutability is the binding contract, the impl must stop defaulting `attention`
onto the admitted Brief instead of restaging. This is the one authority-class judgment in this
adjudication; recommended default is restage.

## 5. PT-7 39→40 re-pin (item 4, quoted)

`cli-silent-start-red` must be handled EXPLICITLY, not silently broken, when `run watch` lands.
The quote is from row-cli's recovered cross-seam note (`recovered/row-cli.harvest-757cf506.patch`,
the `notes-row-cli.md` hunk):

> adding `watch` as a recognized first-token inflates the cli-silent-start suite's (#155) DERIVED
> detection set from 39 → 40, which breaks that suite's currently-GREEN PT-7 pin
> (`assert.equal(detection.size, 39)`, cli-silent-start-red.test.mjs:439) — the 39 is "at HEAD",
> so #155's impl may re-pin it, but row-sf159 must coordinate rather than silently break the pin.

Row-cli2's `run watch` work is the trigger; the re-pin of PT-7 `39 → 40` is a coordinated
detection-set restage, not a suite break. (At this tree PT-7 is still green at 39 — `run watch`
has not landed.)

## 6. R11 artifact-count re-pin (item 3, cross-check)

`doc-truth-conformance-red` R11 is RED here for the same reason the wave-c legs are: the counts
(`counts.webBusCommands`, `counts.parserLifecycleActions`) derive from admission + parser
dispatch, and the parser legs (`run.scratchpad.append`, `run watch`) are row-cli2's. Row-docs2's
brief already names this dependency and its await-inputs discipline (poll `notes-row-cli2.md` /
`notes-row-web2.md` before finalizing the artifact). No fabrication: the counts are not faked
here.

## 7. Green-is-earned cross-check (item 7)

Three green stages verified against the impl (not suite edits — the acceptance suites are
immutable this wave; none of the recovered patches touch them):

- **A2-1** (MCP advertise) — `baton_run_scratchpad_append` admitted at 5 real sites in
  `mcp-northbound.mjs` (`:118` capability map, `:737` tool def, `:907` sorted list, `:1298`
  schema branch, `:2044` dispatch). Earned.
- **P-A5** (no permissive `authorize: async () => true,` literal) — the only occurrence is a
  documentation comment at `application-deployment.mjs:2079`; the literal is not wired at the
  driver construction. Earned.
- **W1** (unknown_top_level_field names the key) — `web-northbound.mjs:524` returns the
  structured `{ code: 'unknown_top_level_field', field, ... }`. Earned.

## 8. Per-row verdicts

| Row | Owns (wavefile scope) | Notes | Verdict |
|---|---|---|---|
| row-cli2 | `application-cli.mjs` · `CLI.md` | ABSENT | **not-landed** (A1-1/A1-2/A9-1 + R1/R4/R5 red) |
| row-web2 | `application.mjs` dispatch · northbounds · `MCP.md` | ABSENT | **not-landed** (A2-2/A3-1 + R3/R8/R9 red) |
| row-deploy2 | deployment/restrictor seam | ABSENT | **not-landed** (A4-1/A4-2/A5-1 red) |
| row-docs2 | `surface-inventory-artifact.json` · `surface-divergence-ledger.json` | ABSENT | **not-landed** (R11 red, awaits cli2/web2) |

"not-landed" is not "dead" — the wave-c worktrees were materializing during this acceptance
window. What is true is that no wave-c row has landed as of verification.

## 9. Final verdict

**HOLD.**

1. The four wave-c rows have not landed — their notes are absent and their stages are at base
   RED (§1, §3.1). The package's headline (`scratchpad-write-red` A1-1…A9-1) is not green.
2. The two landing blockers remain red (§3.4) and must be adjudicated per §4 before the
   package's issues (#157-#160) can close: `phase12` restage (documented #160 R4 move) and
   `phase11` restage-with-caveat (`attention: []` shape move).

**Land conditions** (the package lands when all hold):
- row-cli2/row-web2/row-deploy2 land their stages → `scratchpad-write-red` 23/23,
  `doc-truth-conformance-red` R1/R3/R4/R5/R8/R9 green; row-docs2 re-pins R11.
- `cli-silent-start-red` PT-7 re-pinned 39→40 per §5 (coordinated, quoted).
- `phase11`/`phase12` restaged per §4 with the quoted moves (the only permitted suite edits).
- `surface-conformance.mjs` stays ok (already true).

## 10. Residual register / escalation

1. **Signal absent** — `signalOnMembersDone` (row-cli2,row-web2,row-deploy2,row-docs2) has not
   fired; no wave-c report exists on disk.
2. **phase11 immutability caveat** (§4.2) — restage vs impl-fix is authority-class; default
   recommendation is restage (`attention` is canonical), but the "immutable admitted Brief"
   contract is the deciding authority.
3. **WLS-1 green-vs-red-by-design** (§3.2) — the brief's note does not match this tree; WLS-1 is
   green, reported as such.
4. The two restages in §4 are landing-step edits to `impl/test/` — outside this coordinator's
   `docs/reference/evidence/honesty-package-2026-08-14/**` write scope; recorded here as
   prescribed actions with quoted proof, not performed by this coordinator.
