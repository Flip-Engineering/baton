# FOLD — row-fold156 (#156 MCP default profile as a bus superset)

[attempt: f3425277-ad18-4234-b694-6044e4283c89 row-fold156]

**Fold:** v1.0 → v1.1 · **Date:** 2026-08-13
**Contract:** `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` (folded in place)
**Red-team:** `docs/reference/evidence/mcp-profile-parity-2026-08-13/redteam-156.md` (row-rt156 — NOT FOLD-READY: 1 blocker + 2 amendments + 3 notes)
**QA:** `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §2.5 (verdict UPHELD; C-1 and C-5 struck as non-reproducing)
**Frame:** `docs/reference/evidence/fold-2026-08-13/foundry-brief.md`

---

## Blocker → resolution map

| # | Item | Resolution | Where folded |
|---|---|---|---|
| **Blocker 1** | D4 item 1 / RG-10 unachievable — the 5 `mcp.baton` alias rows are inert | **FOLDED (fix 1).** Keep the 5 rows (already the registry's `[canonical, surface, name]` tuple — `name` = the tool); add the renderer's canonical-miss fallback `?? { key: alias.canonical, profile: 'ordinary' }` so an alias whose canonical key has no `canonicalOperations` entry still renders the operation key. RG-10's oracle is now achievable. | D4 item 1, G11, RG-10, OQ2 |
| **Amend. 2** | D1 Gap 1 — construction order + mechanism pin | **FOLDED.** `uncoveredCommands()` snapshots the hand-rows-only served set BEFORE the LIFECYCLE spread; hand-inlining the 14 rows is FORBIDDEN; the suite pins the mechanism (`.map` over `uncoveredCommands()`, `key`/`tool`/`source` derived, pre-spread snapshot = 14, spread after snapshot). | D1 "Construction order" paragraph |
| **Amend. 3** | C-2 / C-3 / C-4 citation fixes | **FOLDED.** C-2: `scripts/` → `impl/scripts/` everywhere (G1/G2/G3/G7/G10/D4.3/RG-11/OQ4). C-3: M4b comment `:751-754` → `:685-689` (G4). C-4: "35 to 102 tools" → "35 to 86 today, 102 after D1+D2". | G1/G2/G3/G4/G7/G10/D4.3/RG-11/OQ4 |
| **QA 2** | Strike C-1, C-5 | **STRUCK.** C-1: the served-command set is 11 unique (the prior report read sibling `key`s as `command`s); G2's 11 stands. C-5: `MCP.md:87` "families for kernel-control deployments" is correct; the contract's `MCP.md:46-47, 87` citations stand. | G2, G9/D1 (unchanged) |
| **QA 3 (C-6)** | D3 red-state sentence | **FOLDED.** Rephrased: at HEAD the red state is the import itself (`mcpApplicationCommandNames()` does not exist → the import throws before any assert); once the export lands the derivation reports the 14-name diff, then `[]` after D1. | D3 |
| **QA 4** | State Gap 1 | **FOLDED.** Same as Amend. 2 — construction order pinned in D1. | D1 |
| **QA 5 (M1)** | D1 table illustrative | **FOLDED.** The 14-row table is marked illustrative; authority = `APPLICATION_COMMAND_DEFINITIONS[command].mcpStateful` / `.capabilities`. | D1 table |
| **QA 6** | Optional third D3 dispatch-binding pin | **FOLDED (adopted).** New `mcpApplicationDispatch()` export (the frozen `APPLICATION_TOOL`) + a third D3 pin row: every uncovered command's sibling tool is bound to its command in the dispatch map. | D1 step 1, D3 |
| **Note 4** | D1 Gap 2 — wait/follow list drift | **FOLDED as named residual.** Accepted; recorded in §5 as a named non-goal (RG-07 pins only the two named tools). | §5 |
| **Note 5** | G10/G11 span imprecisions | **FOLDED.** G10 branch `:501-523` → `:502-523`; G11 projection region `:2020-2059` → `:1990-2060`. | G10, G11 |
| **Note 6** | RG-11 wording | **FOLDED.** "a 49/102 surface is not representable" → "the current committed artifact encodes 35/86". | RG-11 |

No item is ESCALATED: every blocker, amendment, note, and QA instruction received a definitive
FOLDED or STRUCK resolution.

---

## Incremental fold log (the edit sequence, as applied)

1. **Version bump** — `mcp-profile-parity-contract.md` `**Status:** v1.0 DRAFT` → `**Status:** v1.1 DRAFT (folded — see Fold record)`.
2. **C-2 (`scripts/` → `impl/scripts/`)** — read-order line, G1, G2, G3, G7, G10, D4 item 3, RG-11, OQ4 (§4 citation fix).
3. **C-3 (`:685-689`)** — G4's "M4b contract comment" anchor `:751-754` → `:685-689`.
4. **C-4 ("35 to 86 today, 102 after D1+D2")** — D1 prose "balloon the trusted surface from 35 to 102 tools" → "from 35 to 86 today (102 after D1+D2)".
5. **G11 claim + anchor** — updated the renderer-resolution claim (the 5 non-canonical ops now resolve via the 5 alias rows + the renderer's canonical-miss fallback, no longer `key = tool`); projection anchor `:2020-2059` → `:1990-2060` (red-team note 5).
6. **D1 step 1 — `mcpApplicationDispatch()` export** — added to the served-command-set item (feeds the QA §2.5 item-6 third pin).
7. **M1 — D1 table marked illustrative** — note added under the 14-row table; authority = `APPLICATION_COMMAND_DEFINITIONS[command].mcpStateful` / `.capabilities`.
8. **Gap 1 — D1 Construction-order paragraph** — `uncoveredCommands()` snapshots the hand-rows-only set before the LIFECYCLE spread; hand-inlining forbidden; mechanism pinned (`.map` over `uncoveredCommands()`, derived key/tool/source, pre-spread snapshot = 14, spread after snapshot).
9. **C-6 — D3 red-state sentence** — rephrased: the red state is the import throw (no `mcpApplicationCommandNames()`), then the 14-name diff, then `[]`.
10. **Third D3 dispatch-binding pin** — added after the tool-level row (`.filter` over `mcpApplicationDispatch()`); import updated to include `mcpApplicationDispatch`.
11. **D4 item 1 — renderer canonical-miss fallback** — added `?? { key: alias.canonical, profile: 'ordinary' }`, the `[canonical, surface, name]` tuple-shape note, and the "5 keys are NOT canonical" explanation; projection anchor → `:1990-2060`.
12. **D4 item 3 — paths + gate anchor** — `impl/scripts/` prefixes; `checkProfileDocParity` `:501-523` → `:502-523`.
13. **RG-10 green oracle** — now asserts the renderer fallback + alias rows resolve the 5 non-canonical ops to their operation keys.
14. **RG-11** — `impl/scripts/` paths + wording "a 49/102 surface is not representable" → "the current committed artifact encodes 35/86" (red-team note 6).
15. **OQ2 verdict** — updated to "add the alias rows + the renderer fallback" (the rows alone are inert without it).
16. **§5 named residual (red-team note 4, Gap 2)** — the wait/follow list drift recorded as an accepted non-goal.
17. **Fold record appended** — v1.0 → v1.1, date, red-team + QA paths, blocker→resolution table, judgment calls, top-orchestrator decisions.

---

## Completeness — no silent drops (explicit audit)

| Source item | Resolution | Fold record row |
|---|---|---|
| Red-team **Blocker 1** — D4 item 1 / RG-10 unachievable | FOLDED (fix 1) | ✓ |
| Red-team **Amendment 2** — D1 Gap 1 construction order + mechanism pin | FOLDED | ✓ |
| Red-team **Amendment 3** — C-2 / C-3 / C-4 citation fixes | FOLDED | ✓ |
| Red-team **Note 4** — D1 Gap 2 wait/follow drift | FOLDED (named residual) | ✓ |
| Red-team **Note 5** — G10/G11 span imprecisions | FOLDED | ✓ |
| Red-team **Note 6** — RG-11 wording | FOLDED | ✓ |
| QA §2.5 **item 1** — fix D4 HOLE; update G11 + RG-10 | FOLDED (fix 1; G11 + RG-10 updated) | ✓ |
| QA §2.5 **item 2** — strike C-1, C-5 | STRUCK (both are false alarms) | ✓ |
| QA §2.5 **item 3** — apply C-2, C-3, C-4, C-6 | FOLDED (all four applied) | ✓ |
| QA §2.5 **item 4** — state Gap 1 | FOLDED (D1 construction-order paragraph) | ✓ |
| QA §2.5 **item 5** — adopt M1 | FOLDED (D1 table illustrative) | ✓ |
| QA §2.5 **item 6** — optional third D3 dispatch-binding pin | FOLDED (adopted; not declined) | ✓ |
| Red-team §1.3 — C-1 / C-5 refuted | STRUCK (recorded in fold record) | ✓ |
| Red-team §4 — deep shallow-greenability hole (Gap 1 mode b) | FOLDED (mechanism pin + third dispatch pin) | ✓ |
| Red-team §5 OQ2 — "right instinct, broken mechanism; choose fix A or C" | FOLDED (fix A variant adopted; contract OQ2 verdict updated) | ✓ |

Every blocker, every numbered QA instruction, and every note carries a definitive resolution;
zero items dropped.

---

## Judgment calls

- **Fix 1 over fix 3 for the D4 HOLE.** The renderer canonical-miss fallback is a 1-line
  presentation-only change that keeps the doc's teaching purpose (the Operation column shows the
  bus verbs — the point of the parity law) while preserving M4A-3's "authority cannot move"
  guarantee. Fix 3 would teach tool spellings for exactly the 5 ops the parity law is about.
- **The red-team's "corrected rows" are not adopted as stated.** The registry tuple is
  `[canonical, surface, name]` (`application-semantics.mjs:1981`), so the contract's original rows
  `['run.status','mcp.baton','baton_run_status']` already put `name` = the tool and satisfy the
  renderer's `row.name === tool` lookup (`render-surface-docs.mjs:104-115`). The red-team's
  proposal `['baton_run_status','mcp.baton','run.status']` would set `name` = `run.status`, making
  the alias lookup fail. The operative fix is the renderer fallback alone — this is a correction
  to the red-team's fix A, recorded per the frame.
- **The third D3 dispatch-binding pin is adopted.** It closes the remaining shallow-greenable
  surface (sibling exists AND routes), complementing the construction-order mechanism pin.

## Citations re-verified this session

All anchors touched by this fold were re-verified against the worktree before writing
(`impl/src/mcp-northbound.mjs`, `impl/src/application-semantics.mjs`, `impl/scripts/render-surface-docs.mjs`,
`impl/scripts/surface-conformance.mjs`, `impl/MCP.md`, `impl/src/application.mjs` with NUL-safe
`grep -an`/`sed -n`): `ORDINARY_APPLICATION_ENTRIES` = 11 unique commands; the M4b ordinary-table
comment at `mcp-northbound.mjs:685-689` (not `:751-754`); `MCP.md:87` = "families for
kernel-control deployments."; the renderer trace `render-surface-docs.mjs:104-115`;
`checkProfileDocParity`'s `mcp.application` branch at `surface-conformance.mjs:502`; the projection
split at `application-semantics.mjs:1990-2060`; `SURFACE_ALIAS_ROWS` tuple `[canonical, surface,
name]` at `application-semantics.mjs:1981`; no top-level `scripts/` — both files live at
`impl/scripts/`.

## Deployment verification

Execution contract run: executable `true`, argv `[]`, cwd `.`, expected exit 0. The authored
change is the folded contract document; RG-01…RG-12 remain pinned future-gate properties, not
properties the current gate must yet emit.
