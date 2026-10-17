# Red Team — #156 MCP Profile Parity Contract

**Role:** row-rt156 (adversarial red-team)
**Target:** `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md`
**Frame:** REVIEW FOUNDRY `foundry-brief.md` (from commit `8401d88`)
**HEAD verified:** `f5bf3386cb2ac8d2bcd83079a13dfd8be534d894` (worktree HEAD)
**Date:** 2026-08-13

**Verdict:** **NOT FOLD-READY** — 1 blocker (D4 item 1 / RG-10 is unachievable as specified), plus 2 amendments and 3 notes. Everything else in the contract survives contact with landed code; two of the prior red-team's citations (C-1, C-5) do not reproduce and are refuted below.

---

## 1. Citation audit (every anchor re-verified at HEAD)

All anchors were re-verified this session against the live files. `application.mjs` and `coordination-store.mjs` were read with NUL discipline (`grep -an`/`sed -n`); all other files with plain grep/sed/node.

### 1.1 Confirmed exact (reproduce byte-for-byte)

| Contract anchor | Verified result |
|---|---|
| G1 — `mcpApplicationToolNames()` returns 35 application tools; selection at `mcp-northbound.mjs:1269-1270`, `:1284`; artifact `mcpApplicationTools: 35` | EXACT. Live node call returns 35 tools. |
| G2 — web bus 25, served 11 unique, uncovered 14; `application.mjs:183-197` | EXACT. Live derivation: `web:true` = 25 (`waves.attach` included), served command set = 11 unique, uncovered = exactly the 14 lifecycle ops. Every cited line `:183` run.status … `:197` run.recover is the correct web:true line. |
| G3 — `MCP_APPLICATION_ENTRIES` `:14-16`, `APPLICATION_TOOL` `:33-42`, `CAPABILITY` `:79-86`, `STATEFUL` `:139-140`, `RECONCILABLE` `:147-148` | EXACT. Both `CAPABILITY` (spread) and `STATEFUL`/`RECONCILABLE` (post-loops) consume `ORDINARY_APPLICATION_ENTRIES`, so the D1 siblings flow into all three with no further code. |
| G4 — `CANONICAL_ORDINARY_SIBLINGS` 6 rows `:23-32`, `ORDINARY_APPLICATION_ENTRIES` `:54-70`, sibling constructor `:690-696` | EXACT rows. Command is the 3rd tuple element; sibling def is `{...base, name: sibling.tool}`. |
| G5 — `APPLICATION_TOOL_DEFINITIONS` 18 fleet rows `:383-402`, `.map` execution stamp `:402` (no `_meta`), legacy table `:403-685` with `_meta` at `:683-689` | EXACT. Confirms D1's "the `_meta` stamp must be added explicitly". |
| G6 — registry `retry_verification`/`resume_work` `application-semantics.mjs:675-682`, capabilities `:722-723`, `approve_plan` `:810`, `deriveSurfaceNames` `:1130-1151`, `normalizeRetryVerification` `application.mjs:1071-1078`, `normalizeResumeWork` `:1081-1089`, `stateFailureCode` `mcp-northbound.mjs:201-210` | EXACT. |
| G7 — both conformance gates exit 0 at HEAD | EXACT (ran live). |
| G8 — `phase16:92-103` + `:121-122`, `mcp-reflex-surface-red.test.mjs:201-215`, `phase67:647-661`, `phase72:296-308` + `:629` | EXACT. |
| G9 — `MCP.md:46-47, 83-89, 144-184` | EXACT. |
| G12 — `approve_plan` `application-semantics.mjs:810` | EXACT. |
| G13 — `mcp-northbound.mjs:954-955` `invalid_run_wait` list, `:1510` observe-path authority gate | EXACT. Current list is `['fleet_run_wait','fleet_run_follow']` at both sites. |
| G14 — the 14 admission facts | EXACT. |

### 1.2 Citation defects (real, verifiable)

- **C-2 (reproduces): `scripts/` → `impl/scripts/`.** The contract cites `scripts/surface-conformance.mjs` (D4 item 3, RG-11) and `surface-inventory-artifact.json` (G1, G7). There is **no top-level `scripts/` directory** in the repo — both live at `impl/scripts/`. All runnable-path references in D4 item 3 and RG-11 must be `impl/scripts/…`.
- **C-3 (reproduces): M4b comment is at `:685-689`, not `:751-754`.** The contract's D1 mechanism ("reusing the M4b mechanism the audit found sound") cites `:751-754`; `:751-754` is the **reflex** contract comment. The M4b sibling `_meta` comment is at `:685-689`. The D1 sibling constructor citation `:690-696` is correct.
- **C-4 (reproduces): "35 to 102 tools" mixes application with combined.** D1 prose: "Flipping the default would balloon the trusted surface from 35 to 102 tools". `mcp.combined` is **86 today**, not 35; application is 35. The correct framing is application 35→49 and combined 86→102. The arithmetic in D4 item 3 (49/102) is right; the D1 prose number is wrong.
- **G10 off-by-one (minor):** contract cites `checkProfileDocParity` at `surface-conformance.mjs:501-523`; the `mcp.application` branch begins at `:502`. The claim is correct, the span is one line early.
- **G11 span imprecision (minor):** contract cites the projection split at `application-semantics.mjs:2020-2060`. `authorityProjection` starts at `:1990`, `presentationProjection` at `:2030`, digest/hash at `:2055-2060`. The cited span is inside the region and the *claim* (authorityProjection excludes `surfaceAliases`; `digest = authorityDigest`) is **verified true** — but the anchor starts ~30 lines late.

### 1.3 Prior red-team findings that do NOT reproduce (corrections)

- **C-1 (refuted):** the prior report claimed the application profile serves **16 unique commands**. The served command set is **11 unique**. The prior C-1 misread the 6 sibling **keys** as commands; the sibling **commands** are the 3rd tuple element (`run.act, run.inspect, run.workstreams, run.workstream.notify, run.workstream.stop, application.help`) and all duplicate hand rows. The contract's "11 unique commands / 14 uncovered" is **CORRECT**. The prior report's gap count of 16 is wrong.
- **C-5 (refuted):** the prior report claimed MCP.md:88 lacked "kernel-control". `MCP.md:87` **is** "families for kernel-control deployments." The contract's `MCP.md:46-47, 87` citation is **CORRECT**.

---

## 2. Per-decision attacks against the real code

### D1 — The parity law and the mechanism: `baton_*` siblings for all 14 — **SOUND** (with 2 spec gaps)

**The law holds.** Live derivation locks `web:true = 25`, served = 11 unique, uncovered = 14 (exactly the audit's gap). The law is genuinely one-directional — `waves.attach` is web:true AND served, and the application profile's MCP-only families (waves, decision channel, workflow/knowledge) exceed the bus by design. The parity law is mechanical and verifiable.

**The mechanism survives contact.** `deriveSurfaceNames` is the ONE shared name derivation, and the 9 canonical gap ops' `canonicalOperations[].names.mcp` **already equal** the derived sibling names (`run.approve`→`baton_run_approve`, `run.answer`→`baton_run_answer`, …). Verified live: all 9 canonical gap ops resolve through the renderer's `byDerived` path with **no alias rows needed** — D4's "The 9 canonical ops need no rows" is correct. The three registration spreads (ORDINARY_APPLICATION_ENTRIES, APPLICATION_TOOL, ORDINARY_APPLICATION_TOOL_DEFINITIONS) are the exact sites that feed `CAPABILITY`/`STATEFUL`/`RECONCILABLE`. The `_meta` stamp must be explicit (verified: fleet sources carry `execution` but no `_meta`; `phase67:660` pins the digest) and the sibling constructor reads `APPLICATION_TOOL_DEFINITIONS` (defined `:383`, before `TOOL_BY_NAME` at `:831`) — the TDZ warning is correct.

**Gap 1 (amendment — construction order is un-pinned, and the "never a hand list" doctrine is unenforceable by the D3 pin as written):** `LIFECYCLE_ORDINARY_SIBLINGS = uncoveredCommands().map(...)` must be computed from the **hand-rows-only** served set, *before* the LIFECYCLE rows are spread into `ORDINARY_APPLICATION_ENTRIES`. `ORDINARY_APPLICATION_ENTRIES` is a frozen literal; growing it means a new binding. If the implementer computes `uncoveredCommands()` after the spread (or reads `servedCommands` from the grown table), uncovered = `[]`, the law passes vacuously, and no sibling is ever created. Worse, the D3 pin asserts the **output** (uncovered = `[]`), so a **hand-inlined** 14-row table — the exact thing the #159 doctrine forbids — also passes every pin. Fix: pin the mechanism, not just the output — assert `LIFECYCLE_ORDINARY_SIBLINGS` is built by `.map` over `uncoveredCommands()` with `key`/`tool`/`source` each derived (never literal), assert the pre-spread snapshot has exactly 14 uncovered, and assert the spread occurs after the snapshot.

**Gap 2 (note — wait/follow list drift):** the two special-case lists (`:954-955`, `:1510`) are extended by hand to add `baton_run_wait`/`baton_run_follow`, and nothing mechanically keeps a future wait-like verb in both lists. `RG-07` tests only the two named tools. Acceptable for this change; flag that a future wait/follow verb can silently bypass the bounded-wait gate.

### D2 — The two missing tools — **SOUND**

`run.resume_work` (`:193`) and `run.retry_verification` (`:192`) are both `mcp:true, mcpStateful:true, reconcilable:true` — already admitted through `MCP_APPLICATION_ENTRIES` into `CAPABILITY`/`STATEFUL`/`RECONCILABLE`; only the tool definitions are missing. The closed schemas `{repoId, idempotencyKey, runId, reason ≤ 1_024}` byte-mirror `fleet_run_stop` (`:392`); `schema()` hard-codes `additionalProperties: false` (`:285-287`); `idempotencyKey` required is correct (stateful); `application_resume_invalid`/`application_retry_invalid` flow through `normalizeResumeWork`/`normalizeRetryVerification` and the `stateFailureCode` passthrough (`:201-210`, `not_found` allowlist). No hole found.

### D3 — The parity pin — **SOUND** (with the mechanism-enforcement caveat)

The pin is mechanically derived from the same admission maps on both sides (`webBusNames`, `mcpApplicationCommandNames`), so it is self-consistent: at HEAD it reports the 14 uncovered; after D1 it reports `[]`. RG-01's red state is correct — `mcpApplicationCommandNames()` does not exist at HEAD (verified exports). Caveat: as written the pin cannot distinguish a derived table from a hand-inlined one (Gap 1 mode (b)); restate the oracle as a mechanism pin.

### D4 — The doc half — **HOLE (blocker)** — the 5 `mcp.baton` surfaceAlias rows are inert

Verified live against `render-surface-docs.mjs:104-115`:

```js
const alias = ...surfaceAliases.find((row) => row.surface === 'mcp.baton' && row.name === tool);
const byDerived = canonicalOperations.find((operation) => operation.names.mcp === tool);
const operation = alias ? canonicalOperations.find((entry) => entry.key === alias.canonical) : byDerived;
const key = operation?.key ?? tool;
```

The contract proposes rows `['run.status', 'mcp.baton', 'baton_run_status']`, etc. The `SURFACE_ALIAS_ROWS` tuple shape is `[name, surface, canonical]` (verified: `{name, surface, canonical}` rows in the registry). The proposed row is wrong in **both** directions:

1. **`name` must be a tool name, not a command key.** The renderer looks up `row.name === tool` where `tool` is `baton_run_status`. `'run.status'` never equals a tool name → the alias is never found → falls through to `byDerived`.
2. **Even with the shape corrected to `{name:'baton_run_status', canonical:'run.status'}`, the renderer resolves `canonicalOperations.find(e => e.key === 'run.status')` → `undefined`** — `run.status`, `run.follow`, `run.wait`, `run.resume_work`, `run.retry_verification` are **NOT** canonical keys (verified live: all 5 resolve `NOT CANONICAL`). `operation` is `undefined`, so `key = tool`.

Therefore all 5 proposed rows are inert: RG-10's oracle ("the 5 alias rows resolve `run.status`→`baton_run_status` … in the Operation column") is **unachievable as specified**, and the generated MCP.md inventory will render the 5 non-canonical ops as `key = tool` (the exact fallback D4 set out to remove). The 9 canonical ops render correctly via `byDerived` (verified).

**M4A-3 is verified correct** — `authorityProjection` (fields: schemaVersion/version/depths/sections/enums/operations/actions/canonicalOperations) excludes `surfaceAliases`, `presentationProjection` carries `aliases`/`surfaceAliases`, and `digest = authorityDigest`. Adding alias rows provably cannot move the tools' `_meta` stamps or live-session authority. The HOLE is strictly the inertness of the rows, not the authority claim.

**Fix options (recommend A, fall back C):**
- **A (renderer + corrected rows):** add a fallback in `renderMcpToolInventory` — `canonicalOperations.find(e => e.key === alias.canonical) ?? { key: alias.canonical, profile: 'ordinary' }` — and write the rows in the correct tuple shape with the command as canonical: `['baton_run_status','mcp.baton','run.status']`, `['baton_run_follow','mcp.baton','run.follow']`, `['baton_run_wait','mcp.baton','run.wait']`, `['baton_run_resume_work','mcp.baton','run.resume_work']`, `['baton_run_retry_verification','mcp.baton','run.retry_verification']`. Then RG-10 is achievable and the Operation column teaches the bus verbs. (This is a `presentationProjection`-only touch — M4A-3 still holds.)
- **C (drop the alias requirement):** accept the renderer's `key = tool` for the 5 non-canonical ops, rewrite RG-10 to assert the tool-name keys, and note the Operation column teaches tool spellings for those 5. Zero registry change.
- **Rejected: promote the 5 ops to canonical.** This moves `authorityProjection`/`authorityDigest` — directly violating D1's scope and M4A-3's "provably cannot move" framing, and it is a far larger semantic change than the doc-half warrants.

---

## 3. Refusal vocabulary — **SOUND**

All 5 typed codes verified against real code: `invalid_run_wait` (`:954-955`), `application_resume_invalid` (`normalizeResumeWork` `:1081-1089`), `application_retry_invalid` (`normalizeRetryVerification` `:1071-1078`), `forbidden` (`_authority`/`CAPABILITY` `:1325-1335`), `not_found` (`stateFailureCode` allowlist `:204`). Every code is a typed `application_*`/`stateFailureCode` lane code with the MN1/MN8 sanitization law (`:1516-1521`) applied — no generic `command_failed`, no provider detail leak. The extended wait/follow lists inherit the observe-path gate. Closed-literal sorts byte-match the contract's ACTUAL sorted order.

---

## 4. Acceptance pins — shallow-greenability audit

- **RG-01 … RG-09, RG-11, RG-12: SOUND.** Each red state was verified to fail at a NAMED stage at HEAD (`mcpApplicationCommandNames` import throws; 35/86 counts; the 14 names absent; the five test-site lists at the cited anchors). Each green oracle is concrete and could not be satisfied by a cosmetic change (schema byte-equality RG-06, dispatch RG-05, refusal RG-07/08).
- **RG-10: BROKEN** (D4 hole). The oracle asserts a rendering outcome that is impossible without a renderer change (see D4).
- **RG-11 (minor):** "a 49/102 surface is not representable" is loose — the gate does not hard-code counts, it merely passes at the current shape. Intent is fine; wording should say "the current committed artifact encodes 35/86".
- **Deep shallow-greenability hole (Gap 1 mode b):** the single most exploitable weakness is that **no pin distinguishes a derived sibling table from a hand-inlined one**. A hand-written 14-row table would satisfy RG-02 (49 tools), RG-03 (uncovered = `[]`), RG-05 (dispatch), RG-06 (schema inheritance), and RG-11 (regenerated artifact) while silently violating the #159 doctrine. The contract's §5 "No hand lists where a derivation exists" is a review obligation, not a pin. Fix as in D1 Gap 1: pin the construction mechanism.

---

## 5. Open questions — verdicts

1. **`baton_run_answer` alongside the decision channel — SOUND.** `run.answer` is `web:true` (`:187`); `baton_decision_answer` is a matrix surface reaching `run.answer` but does not serve the command on the application profile's served-command table. The parity law is command-level, so the sibling is required. Correct verdict.
2. **Doc resolution of the 5 non-canonical ops — right instinct, broken mechanism.** The alias-row approach is presentation-only (good, M4A-3 verified) but the rows as specified are inert (D4). Choose fix A or C.
3. **Where the 14 sibling rows live — SOUND.** A separate `LIFECYCLE_ORDINARY_SIBLINGS` table is correct because the source definitions differ from `CANONICAL_ORDINARY_SIBLINGS` (lifecycle siblings source `fleet_run_*`, must add `_meta` explicitly). Folding them into `CANONICAL_ORDINARY_SIBLINGS` would require extending its source resolution.
4. **The parity law's boundary — SOUND.** `WAVE_WEB_ENTRIES` (`web-northbound.mjs:31-38`) are direct ports / MCP-only, outside `APPLICATION_COMMAND_DEFINITIONS`. Consistent: `waves.attach` is inside the map and served; the remaining wave verbs are MCP-only. Extending the law to them is a separate #159-adjacent web-parity question.

---

## 6. Final verdict — **NOT FOLD-READY**

**Blocker (1):**
1. **D4 item 1 / RG-10 unachievable.** The 5 proposed `mcp.baton` surfaceAlias rows are inert in both orientations (name=command-key instead of tool-name; and no canonical target exists for the 5 non-canonical ops). Fix: renderer fallback `?? { key: alias.canonical, profile: 'ordinary' }` + corrected rows (`['baton_run_status','mcp.baton','run.status']`, …), OR drop the alias requirement and rewrite RG-10. Do not promote the 5 ops to canonical (moves `authorityDigest`, breaks M4A-3 and D1 scope).

**Amendments (2):**
2. **D1 Gap 1 — construction order + mechanism pin.** Pin that `uncoveredCommands()` snapshots the hand-rows-only served set *before* the LIFECYCLE spread, and add a pin asserting the sibling table is built by derivation (`.map` over `uncoveredCommands()`, `key`/`tool`/`source` never literal) so a hand-inlined table cannot pass. Without this, the #159 doctrine is unenforceable by the suite.
3. **C-2 path fixes + C-3/C-4 citation corrections.** `scripts/` → `impl/scripts/` (D4 item 3, RG-11); M4b comment anchor `:751-754` → `:685-689`; "35 to 102 tools" → "application 35→49, combined 86→102".

**Notes (3):**
4. **D1 Gap 2 — wait/follow list drift** (`:954-955` / `:1510`) is hand-extended and unpinned; a future wait-like verb can bypass the bounded-wait gate.
5. **G10/G11 span imprecisions** — `checkProfileDocParity` branch at `:502` (not `:501`); projection region starts `:1990` (not `:2020`). Claims correct, anchors late.
6. **RG-11 wording** — "a 49/102 surface is not representable" should be "the current committed artifact encodes 35/86".

---

## 7. Session notes

- Received a `signalOnMembersDone` coordinator signal ("All rows settled … write review-qa.md per your brief") misrouted to this row seat. `workflow.json` scopes that signal to `roles: ["coordinator"]`; row-rt156's report is `redteam-156.md` ONLY. `review-qa.md` is not this row's deliverable; it is noted here for the coordinator.
- Judgment calls recorded: C-1/C-5 refuted on live reproduction; D4 fix options A/C recommended, B rejected.
- Work confined to `docs/reference/evidence/review-foundry-2026-08-13/**`; no files outside that directory were written. No clocks, no `localeCompare`.
