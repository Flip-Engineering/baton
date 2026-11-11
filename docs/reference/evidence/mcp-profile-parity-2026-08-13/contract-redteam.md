# #156 RED-TEAM REPORT — adversarial attack on the MCP profile-parity contract v1

**Target:** `mcp-profile-parity-contract.md` (v1.0 DRAFT, same dir)
**Verification HEAD:** `a13413cadd60bdef2b17f9ac39f17babe765fe84` (current worktree HEAD).
The contract's stated drafting HEAD `f5bf3386cb2ac8d2bcd83079a13dfd8be534d894` is the parent of
the red-team-brief commit; all `impl/` files the contract cites are byte-identical between the two
heads (`git diff d529a88 a13413c` touches only `impl/src/workflow-interpreter.mjs` +
`impl/test/workflow-as-data-red.test.mjs`, neither cited here). Every anchor below was re-verified
against the current tree; NUL discipline observed on `application.mjs` + `coordination-store.mjs`
(`grep -an`/`sed -n`/`tr` only).

**Method.** Every `file:line` citation in the contract was re-checked against the current tree
(`sed -n`/`grep -n` for the NUL-bearing files). The parity derivations, the 9/5 canonical split,
the renderer alias resolution, the profile counts, the closed-literal sorts, and both conformance
gates were run live (`node`). No NUL-bearing file was opened whole.

---

## 1. Citation re-verification

### 1.1 Verified correct (the bulk — no action)

All of the following anchors resolve exactly as cited:

- `mcp-northbound.mjs`: `:14-16` `MCP_APPLICATION_ENTRIES` (both `run.resume_work`/`run.retry_verification`
  admitted, `mcp:true`); `:23-32` `CANONICAL_ORDINARY_SIBLINGS` (6 rows); `:33-42` `APPLICATION_TOOL`;
  `:54-70` `ORDINARY_APPLICATION_ENTRIES`; `:79-86` `CAPABILITY`; `:128-140` `STATEFUL`;
  `:141-148` `RECONCILABLE`; `:201-210` `stateFailureCode` (`application_*` verbatim passthrough,
  `not_found` allowlist); `:383-402` `APPLICATION_TOOL_DEFINITIONS` (18 `fleet_run_*` rows,
  `fleet_run_start`:384 … `fleet_run_export`:401, `.map` execution stamp `:402`, no resume/retry);
  `:403-685` legacy table with `_meta` stamped `:683-689`; `:690-696` `ORDINARY_APPLICATION_TOOL_DEFINITIONS`
  (sibling `{...base, name: sibling.tool}` at `:691-695`); `:830` `TOOL_DEFINITIONS` composition;
  `:831` `TOOL_BY_NAME` (the TDZ trap the contract warns about); `:903-912` `applicationArgs`;
  `:947-956` `validateArguments`; `:954-955` `invalid_run_wait` bound; `:1269-1270` surface
  selection; `:1284` `toolNames`; `:1325-1335` `_authority` `forbidden`; `:1390` `tools/call` name
  check; `:1510` observe-path `_authority` gate (`['fleet_run_follow','fleet_run_wait']`); `:1691`
  `_dispatch` (routes `APPLICATION_TOOL[name]` → `application.command`); `:2222-2224`
  `mcpApplicationToolNames`. Also `:697-754` ADVANCED kernel surface, `:812-830` REFLEX table.
- `application.mjs` (NUL-bearing; `grep -an`/`sed -n` only): `:168-207` `APPLICATION_COMMAND_DEFINITIONS`;
  the 14 `web:true` lines `:183` run.status … `:197` run.recover exactly as cited; `:1071-1078`
  `normalizeRetryVerification`, `:1079-1080` the PS5 comment, `:1081-1089` `normalizeResumeWork`
  (both `{runId, reason}`, reason bounded `validText(…, 1_024)`, `application_retry_invalid` /
  `application_resume_invalid`); `:5347` and `:5433` `_authorize` on the two ops.
- `application-semantics.mjs`: `:675-682` registry `retry_verification`/`resume_work` label+summary
  (the D2 descriptions are byte-identical to the registry summaries); `:722-723` capability rows
  `['retry_verification','observe']`/`['resume_work','observe']`; `:810` `approve_plan: 'run.approve'`;
  `:1130-1151` `deriveSurfaceNames` (`mcp: baton_${parts.join('_')}`); `:1731` `SURFACE_ALIAS_ROWS`;
  `:1895` `['run.answer','mcp.baton','baton_decision_answer']`; `:1990-2025` `authorityProjection`
  (excludes `surfaceAliases`), `:2026-2034` `presentationProjection` (includes `surfaceAliases`),
  `:2060` `digest: authorityDigest`.
- `render-surface-docs.mjs`: `:95-119` `renderMcpToolInventory` (reads `mcpApplicationToolNames()`);
  `:104-115` alias → byDerived → `key = operation?.key ?? tool` fallback; `:145-154` `checkSurfaceDocs`.
- `surface-conformance.mjs`: `:362-371` `REFERENCE_PROFILES`; `:378-383` `webBusNames()`; `:403-407`
  `mcp.application` = `mcpApplicationToolNames()`; `:495-545` `checkProfileDocParity`; `:501-523`
  `mcp.application` branch; `:735-745` parity main. `--write-inventory` exists (`:750`).
- `impl/MCP.md`: `:46-47` documented default / kernel-control caveat; `:83-89` initialize prose;
  `:144-184` generated inventory block (byte-current at HEAD — `render-surface-docs.mjs --check` exits 0).
- Tests: `phase16:92-103` + `:121-122` (35-list, combined 86 + prefix); `mcp-reflex-surface-red.test.mjs:201-215`
  (length 35 + list); `phase67:647-661` + `:660` (list, `additionalProperties === false` at `:659`,
  `_meta['baton/registryDigest']` at `:660` — the contract's `:660` is correct); `phase72:296-308`
  + `:629-…` (two more 35-lists).
- `surface-inventory-artifact.json`: line numbers `:12` `webBusCommands` 25, `:56-92` `mcp.application`,
  `:114-200` `mcp.combined` (neither resume/retry present), `:202-…` `web.bus` (25) — **all resolve
  under the real path `impl/scripts/`** (see defect C-2).
- `web-northbound.mjs:31-38` `WAVE_WEB_ENTRIES` (open question 4's boundary claim).
- All `surface-audit-mcp.md` citations (`:20-25`, `:40`, `:41`, `:51-58`, `:64-66`, `:65`, `:68`,
  `:113`, `:122`, `:123`, `:124`, `:128`) verified against the audit text.

**Live runs at HEAD (G2/G7/G11/D3-red-state):**
- `webBusCommands` = 25; served-command set (reconstructed from `ORDINARY_APPLICATION_ENTRIES`
  source literal) = **16 unique commands**; `bus − served` = **exactly the audit's 14 names**
  (`run.adopt, run.answer, run.approve, run.evidence, run.export, run.feedback, run.follow,
  run.integrate, run.recover, run.resume_work, run.retry_verification, run.review, run.status,
  run.wait`). The parity gap of 14 is correct.
- `mcpApplicationToolNames()` = 35, `mcpCombinedToolNames()` = 86, `mcpAdvancedToolNames()` = 19.
- Canonical split: 9 canonical (`run.approve, run.answer, run.adopt, run.evidence, run.export,
  run.feedback, run.integrate, run.recover, run.review`), 5 non-canonical (`run.status, run.follow,
  run.wait, run.resume_work, run.retry_verification`). G11's split is correct.
- `render-surface-docs.mjs --check` exits 0; `surface-conformance.mjs` prints
  `surface-conformance: ok`, exits 0 (G7).
- All closed literals (14 sibling names, 2 fleet names, 5 refusal codes) sort byte-identically to
  the contract's "ACTUAL sorted order" lists. Profile counts 49/102/19/25 arithmetic checks out
  (35+14=49; 86+14+2=102; applicationCommandDefinitions = 26, web:true = 25).

### 1.2 Citation defects (a wrong citation is an automatic blocker per the brief)

- **C-1 (G2) — the served-command count "11 unique commands" is wrong.** `ORDINARY_APPLICATION_ENTRIES`
  serves **16** unique commands: the 11 hand-written rows (`application.help, runs.list, run.start,
  run.inspect, run.episode, run.workstreams, run.workstream.notify, run.workstream.stop, run.act,
  run.stop, waves.attach`) plus **5 sibling-derived rows that add new commands** (`run.do, run.view,
  run.member.view, run.member.send, run.member.stop`; `application.help` is the only duplicate).
  The parity conclusion (14 uncovered) is correct — the sibling-derived commands are not
  `web:true` so they do not shrink the gap — but the stated served-set size is factually wrong.
  **Fix:** "the 16 unique commands in `ORDINARY_APPLICATION_ENTRIES` (11 hand rows + 5 canonical-sibling
  commands)" — and note the D1 law / D3 pin already use the full set, so no derivation changes.
- **C-2 (systematic) — `scripts/…` paths are missing the `impl/` prefix.** The contract cites
  `scripts/surface-inventory-artifact.json` (G1, G2, G3), `scripts/surface-conformance.mjs`
  (read-order, G2, G7, open Q4) and bare `render-surface-docs.mjs` (G7). There is **no top-level
  `scripts/` directory** in the repo; the files live at `impl/scripts/`. Every line number resolves
  correctly under the real path, but the paths as written dangle from the repo root (the audit and
  the tool's own stale-artifact message consistently use `impl/scripts/`). **Fix:** normalize all
  `scripts/` references to `impl/scripts/`.
- **C-3 (G4) — `:751-754` is mislabeled "the M4b contract comment".** Lines `:751-754` hold the
  **"Reflex surface contract Part A.1"** comment (about `LEGACY_REFLEX_TOOL_DEFINITIONS`). The M4b
  contract comment ("The ordinary table = retained legacy tools + the canonical grammar tools
  rendered from the registry (M4b). A canonical tool is its legacy sibling under the derived
  canonical name…") is at `:685-689`. **Fix:** cite `:685-689`.
- **C-4 (D1) — "Flipping the default would balloon the trusted surface from 35 to 102 tools" mixes
  the current application count with the post-change combined count.** At HEAD `combined` is **86**
  tools, not 102. 102 is the count only after D1 adds the 14 siblings + D2 adds the 2 fleet rows.
  **Fix:** "from 35 to 86 today (102 after D1+D2)". The substantive point — `combined` serves the
  kernel/reflex surface and is far larger than the ordinary surface — is unaffected.
- **C-5 (D1) — `MCP.md:46-47, 87`; the "kernel-control deployments" phrase is on line 88, not 87.**
  Trivial off-by-one; line 87-88 covers the claim. **Fix:** `MCP.md:46-47, 88`.
- **C-6 (D3 prose) — "At HEAD the assertion fails with exactly the audit's 14 names in the diff" is
  not literally what happens.** `mcpApplicationCommandNames()` does not exist at HEAD (RG-01), so the
  pin's `import` throws before any `assert.deepEqual` runs; you only see the 14-name diff if the
  served set is reconstructed without the export. The RG-03 row ("the D3 parity derivation reports 14
  uncovered names") states the real red state correctly. **Fix:** rephrase D3's sentence to "the
  derivation, run against the reconstructed served set, reports exactly the audit's 14 names; the
  import of the not-yet-existing export throws first (RG-01)."

---

## 2. D1 — The parity law and mechanism: `baton_*` siblings for all 14 (NOT `combined`)

**Verdict: SOUND** (with two implementation-spec gaps that must be closed; not blockers on the law).

**The choice.** The sibling extension over flipping the default to `combined` is right and the
reasoning is sound: `combined` serves the kernel/reflex surface (`fleet_spawn`/`fleet_send`/
`fleet_kill`, goal/plan, board/package/REPL/knowledge — verified `:697-754, 756-830`), which
`MCP.md:46-47` documents as "explicit kernel-control deployments". Flipping the default would hand
the trusted surface to an agent that only needs run-lifecycle steering. Reusing the M4b sibling
mechanism (`:23-32, 685-691`) is exactly the audit's F1 fix (`surface-audit-mcp.md:124`).

**The law.** `∀ c ∈ {n : APPLICATION_COMMAND_DEFINITIONS[n].web} : c ∈ servedCommands` is
one-directional and mechanically stated; the one-directionality is justified (the ordinary surface
legitimately exceeds the bus with MCP-only families). The `mcpApplicationCommandNames()` derivation
from `ORDINARY_APPLICATION_ENTRIES` and the `uncoveredCommands()` derivation from the two admission
maps are both mechanical, no hand list.

**The silent-regression question the brief asks.** A new bus verb landing without its MCP sibling
**is** caught: `uncoveredCommands()` grows, the D3 pin's `busCommands − servedCommands` diff goes
non-empty, the red suite fails. Verified live: at HEAD the reconstruction reports exactly the 14.
The tool-level row closes the loop on names (`deriveSurfaceNames(command).mcp` must be a served
tool). The law cannot pass while a gap exists.

**Two gaps to close before/at implementation (spec, not verdict-flipping):**

- **Gap 1 — evaluation-order trap in the `LIFECYCLE_ORDINARY_SIBLINGS` derivation.** The contract
  defines `uncoveredCommands()` over `servedCommands = new Set(ORDINARY_APPLICATION_ENTRIES.map(…))`
  and then spreads the sibling rows *into* `ORDINARY_APPLICATION_ENTRIES`. `ORDINARY_APPLICATION_ENTRIES`
  is a frozen const literal at `:54-70`; the sibling rows cannot be re-added to the same literal. The
  implementation must therefore build `ORDINARY_APPLICATION_ENTRIES` as hand-rows **plus** the
  `LIFECYCLE`-derived rows (e.g. `[...HAND_ROWS, ...LIFECYCLE_ORDINARY_SIBLINGS.map(…) ]`) with
  `LIFECYCLE` computed from the hand-rows-only command set **before** the spread. If instead the
  author derives `LIFECYCLE` after the spread (or hand-inlines the 14 rows into `:54-70`), one of two
  things happens: (a) `uncoveredCommands()` returns `[]` → empty `LIFECYCLE` → no siblings → the D3
  pin goes red (caught, but a confusing red state); or (b) the rows are hand-written into `:54-70` →
  the D3 pin goes **green** but the "never a hand list" doctrine (#159) is silently violated and the
  derived table is dead code. Mode (b) is a silent doctrinal regression the pin cannot distinguish.
  **Fix:** state the required construction order and that the gap snapshot must exclude the siblings
  (or equivalently: `mcpApplicationCommandNames()` must be the hand-rows + derived-siblings union,
  never the post-spread `ORDINARY_APPLICATION_ENTRIES` read circularly).
- **Gap 2 — the two wait/follow special-case lists stay hand-maintained and are un-pinned.** The
  `invalid_run_wait` bound (`:954-955`) and the observe-path post-dispatch `_authority` gate (`:1510`)
  are name-list literals. D1 correctly extends both for the 14 siblings, but nothing mechanical pins
  that a *future* wait/follow-like verb (or a future sibling) also lands in both lists — a bounded-wait
  verb whose sibling is added to the tool/entries tables but missed in the two lists would bypass the
  `maxWaitMs` bound and the post-dispatch authority gate with the D3 pin green. RG-07 tests the 14
  only. **Fix:** at minimum note the residual manual step in §5; ideally drive the wait/follow list
  from a registry flag on the command definition (out of #156 scope, but the pin gap is real).

---

## 3. D2 — The two missing tools: `fleet_run_resume_work` / `fleet_run_retry_verification`

**Verdict: SOUND.**

- **Admission already exists (G3) — fully verified.** `MCP_APPLICATION_ENTRIES` (`:14-16`) admits
  both; `APPLICATION_TOOL`, `CAPABILITY`, `STATEFUL`, `RECONCILABLE` all register them via their
  spreads; `tools/call` (`:1390`) refuses only because `toolNames` lacks the definition rows.
- **Closed schemas are exact mirrors — verified arg-for-arg.** Bus verbs take `{runId, reason}`,
  `reason` bounded `1_024` (`normalizeResumeWork`/`normalizeRetryVerification`,
  `application.mjs:1071-1089`, `validText` = non-empty, ≤ 1_024 bytes, no NUL). The MCP schemas add
  only the transport fields `repoId` (required on every MCP tool) and `idempotencyKey` (required
  because both are `mcpStateful: true`), and match the established `fleet_run_stop` reason pattern
  (`minLength: 1, maxLength: 1_024`). The `schema()` helper hard-codes `additionalProperties: false`
  (`:285-287`), and `applicationArgs` (`:903-912`) strips the transport fields before the bus's own
  `validateApplicationCommandArgs` (`application.mjs:1844`, unknown-key rejection) enforces the exact
  `{runId, reason}` shape at the command layer. Closed at both layers. (Micro-note: JSON-schema
  `maxLength` counts code points while `validText` counts bytes, so a multi-byte `reason` between
  1_024 chars and 1_024 bytes is schema-accepted / bus-refused — identical to the existing
  `fleet_run_stop` behavior and the registry's own `inputSchema`, so a pre-existing family trait, not
  a new defect.)
- **Refusal-for-refusal — verified.** `application_resume_invalid` / `application_retry_invalid`
  thrown by the normalizers; `stateFailureCode` (`:201-210`) passes every `application_*` code
  verbatim; `not_found` when the run is gone (`application_run_not_found` allowlist). The descriptions
  are byte-identical to the registry summaries (`application-semantics.mjs:675-682`) — a single
  derivation source, no drift risk.
- **Capability-class alignment — no mismatch.** `['resume_work','observe']` / `['retry_verification','observe']`
  come from `APPLICATION_COMMAND_DEFINITIONS` (`:192-193`) and flow into `CAPABILITY` for both the
  `fleet_run_*` tools (via `MCP_APPLICATION_ENTRIES`) and their `baton_run_*` siblings (via
  `ORDINARY_APPLICATION_ENTRIES` → the D1 table). The bus `_authorize('run.resume_work'/'run.retry_verification', …)`
  (`application.mjs:5347, 5433`) reads the same command definition. The MCP `_authority` gate
  (`:1325-1335`) and the bus `_authorize` therefore require the same classes.

---

## 4. D3 — The parity pin: mechanically derived, never a hand list

**Verdict: SOUND** (with the dispatch-binding note below — covered by RG-05, recommend hardening).

- **Mechanical, both sides from admission maps.** Bus side = `APPLICATION_COMMAND_DEFINITIONS`
  `web:true`; served side = the new `mcpApplicationCommandNames()` export over `ORDINARY_APPLICATION_ENTRIES`.
  Neither is a hand list; the pin never names the 14.
- **Tool-level row is genuinely mechanical.** `deriveSurfaceNames(command).mcp` is the ONE shared
  derivation, so a hand-written sibling with a non-derived name fails the pin (verified: for the 5
  non-canonical ops the derived names are `baton_run_status` etc.; the row checks each against
  `mcpApplicationToolNames()`).
- **Red state confirmed.** At HEAD the reconstruction reports exactly the audit's 14; `mcpApplicationCommandNames`
  does not exist (RG-01 red). The two `mcpCombinedToolNames().includes('fleet_run_resume_work'|'fleet_run_retry_verification')`
  rows are both red at HEAD (verified: neither is in the 86-tool combined list).
- **No count-equality false constraint.** The note that 49 tools ≠ 25 commands is correct and the
  per-op closure is the right shape.
- **Three-surface question.** The pin is scoped to MCP-default ⊇ web-bus, which is the right scope:
  the web bus *is* `APPLICATION_COMMAND_DEFINITIONS.web:true` (it cannot diverge), and the CLI surface
  derives its verbs from the same command definitions via `deriveSurfaceNames().cli` (`baton ${key}`),
  so a new bus verb is CLI-reachable by construction. The only surface with a hand-maintained tool
  table is MCP — which is exactly what the pin gates. No three-surface hole within the law's scope;
  a CLI-specific pin would be a separate (unneeded) gate.
- **Dispatch-binding gap (recommendation).** The pin proves (a) every web command is served and
  (b) every uncovered command has a derived-name sibling tool. It does **not** prove the sibling
  dispatches to its bus command — `APPLICATION_TOOL` is a separate hand-maintained table (`:33-42`),
  and a sibling present in the entries + definitions tables but absent from `APPLICATION_TOOL` passes
  the pin while `_dispatch` (`:1691`) falls through and returns `normalized(undefined) = null` — a
  silent no-op. RG-05's oracle covers this at acceptance, but the mechanical pin doesn't. **Fix
  (optional, cheap):** a third pin row asserting `mcpApplicationDispatchNames()?.[baton_run_X] === X`
  per uncovered command (requires exporting `APPLICATION_TOOL` or a helper). Not a blocker: the law
  as stated is command-coverage, and RG-05 closes the acceptance loop.

---

## 5. D4 — The doc half: the default-profile section teaches the final shape

**Verdict: HOLE** — the 5-alias-row fix (item 1, and the RG-10 oracle) does not achieve its stated
goal. The rest of D4 is sound.

- **Sound parts (verified):** the inventory is generated from `mcpApplicationToolNames()` so adding
  the 14 siblings regenerates the table to 49 rows with no hand edit; `checkProfileDocParity`
  (`surface-conformance.mjs:501-523`, `namesFromMcpInventoryBlock` `:447`) compares the served tool
  list against the tool column of the committed generated block, so a served table that grows forces
  the doc to regenerate or the gate fails — a stale block cannot ship. The prose refresh is a normal
  hand-maintained block. The `--write-inventory` count deltas (49/102/19/25, 25, 26) are arithmetic
  and verified.
- **The hole — the alias rows cannot resolve the 5 non-canonical ops.** `renderMcpToolInventory`
  (`render-surface-docs.mjs:104-115`) resolves the operation key as
  `alias ? canonicalOperations.find(entry => entry.key === alias.canonical) : byDerived` and falls
  back to `key = operation?.key ?? tool`. The alias branch **only yields the canonical key when that
  key exists in `canonicalOperations`**. The 5 non-canonical ops (`run.status, run.follow, run.wait,
  run.resume_work, run.retry_verification`) are **not** canonical operations (verified: the registry's
  `canonicalOperations` contains only the 9; G11's own split says so). Therefore the proposed rows
  `['run.status','mcp.baton','baton_run_status']` … each resolve `operation = undefined` and the
  renderer still prints `key = baton_run_status` (the tool name). Simulated live: all 5 rows behave
  exactly this way. The existing working alias `['run.answer','mcp.baton','baton_decision_answer']`
  works only because `run.answer` IS canonical — confirming the mechanism's precondition. RG-10's
  oracle ("the 5 alias rows resolve `run.status`→`baton_run_status` … in the Operation column") is
  therefore **unachievable as specified**.
  **Concrete fixes (pick one):**
  1. Change the renderer's alias branch to fall back to the alias key directly:
     `const operation = alias ? (canonicalOperations.find(e => e.key === alias.canonical) ?? { key: alias.canonical, profile: 'ordinary', effect: 'idempotent' }) : byDerived;`
     — a `render-surface-docs.mjs` change (the contract currently treats the renderer as read-only),
     small and locally scoped; or
  2. Promote the 5 ops to canonical operations in the registry — a much larger change (moves the
     authority digest, surface matrices, and many tests) and **not** what D4 asks; or
  3. Drop the alias-row requirement and the "teaches operation keys" goal for the 5, accept
     `key = tool`, and rewrite RG-10 accordingly (the zero-registry option the contract's open
     question 2 rejects).
  The contract should adopt fix 1 (or 3) and update G11/RG-10 to match. M4A-3's authority-immunity
  claim itself remains verified — the *presentation* projection is what the 5 rows would touch — but
  the rows as proposed are inert, so the M4A-3 guarantee is moot until the renderer is fixed.

---

## 6. Refusal/observability vocabulary

**Verdict: SOUND.** All five codes are typed lane codes on existing machinery, each mechanism
verified: `invalid_run_wait` (`:954-955`), `application_resume_invalid`/`application_retry_invalid`
(normalizers → `stateFailureCode` `application_*` verbatim passthrough `:201-210`), `forbidden`
(`_authority`/`CAPABILITY` `:1325-1335`), `not_found` (`:204` allowlist). The MN1/MN8 sanitization
claim (`:1516-1521` — the observe-path catch region) holds; the typed `application_*` codes ride the
stateful lane's message+detail path. No generic `command_failed`, no provider detail. The two
wait/follow siblings inheriting the extended `:1510` observe-path gate is correct (Gap 2 in D1
noted the residual manual-list risk for future verbs).

---

## 7. Acceptance pins (RG-01…RG-12)

**Verdict: SOUND except RG-10 (broken by the D4 hole); RG-11 wording is slightly off.**

- RG-01 ✓ feasible — `mcpApplicationCommandNames()` absent at HEAD (verified exports).
- RG-02 ✓ feasible — 35 → 49 via the sibling constructor; the 14 derived names verified.
- RG-03 ✓ feasible — derivation reports 14 at HEAD (verified), `[]` after.
- RG-04 ✓ feasible — neither in the 86 combined tools at HEAD (verified); 102 after.
- RG-05 ✓ feasible — dispatch via `APPLICATION_TOOL`; this is also the acceptance oracle that closes
  the D3 dispatch-binding gap.
- RG-06 ✓ feasible — sibling `{...source, name, _meta}` construction makes schema byte-equality
  (modulo name) and `execution.taskSupport === 'forbidden'` hold by construction; the `_meta` stamp is
  added explicitly because `fleet_run_*` carry no `_meta` (verified `:402` adds only `execution`).
- RG-07 ✓ feasible — the two list extensions are specified; note the bound is per-deployment
  `maxWaitMs`, so the test needs a bounded server fixture.
- RG-08 ✓ feasible — `tools/call` refuses at `:1390` today (verified), dispatches after.
- RG-09 ✓ feasible — 86 → 102 arithmetic verified.
- **RG-10 ✗ not achievable as specified** — the 5 alias rows cannot change the rendered Operation
  column for the 5 non-canonical ops (D4 hole). The "49-row generated block" and "prose teaches the
  final shape" halves are achievable; the "5 alias rows resolve … in the Operation column" half is
  not, absent a renderer change or canonical promotion. Fix with D4.
- RG-11 ✓ with a wording nit — "a 49/102 surface is not representable" is true of the committed
  artifact at HEAD (it holds 35/86); the gate's parity main (`:735-745`) does not hard-code the
  counts, so 49/102 is representable after regeneration. The intent (regenerate + re-pass) is right.
- RG-12 ✓ feasible — the five name-list sites verified at HEAD; re-derivation from
  `mcpApplicationToolNames()`/`mcpCombinedToolNames()` is the right (and #159-compliant) update; the
  `_meta` pin at `phase67:660` still passes because the sibling constructor adds the stamp.

---

## 8. Open questions — verdicts

1. **`baton_run_answer` alongside the decision channel — SOUND.** `run.answer` is `web:true`
   (`application.mjs:187`), so the command-level law requires the ordinary surface to serve it; the
   `baton_decision_answer` channel (`application-semantics.mjs:1895`) is a distinct spelling the
   renderer resolves via an existing alias row. The two coexist; the mechanical pin would indeed
   report a gap without `baton_run_answer`. The reviewer-escape ("decision channel satisfies
   `run.answer`") would require an explicit law exemption — correct to reject.
2. **Doc resolution of the 5 non-canonical ops — the verdict is right but the mechanism is broken.**
   Adding the alias rows is the right instinct; it simply cannot work without the renderer fallback
   (D4 hole). The reviewer flag on `presentationDigest` movement is correct and the authority
   surface cannot move (verified M4A-3). Fold the renderer fix into this item.
3. **Where the 14 rows live — SOUND.** A separate `LIFECYCLE_ORDINARY_SIBLINGS` sourced from
   `APPLICATION_TOOL_DEFINITIONS` (with explicit `_meta`) is the correct home; folding into
   `CANONICAL_ORDINARY_SIBLINGS` would require extending that table's source resolution to the
   `fleet_run_*` table and the `_meta` stamp — more surgery for no gain. Keep the separate table;
   state the derivation-order constraint (D1 Gap 1).
4. **The parity law's boundary — SOUND.** Measuring against `APPLICATION_COMMAND_DEFINITIONS`
   `web:true` (the web bus's own admission map, `webBusNames()` `:378-383`) is the right frame;
   `WAVE_WEB_ENTRIES` (`web-northbound.mjs:31-38`) is genuinely a direct-port/extra-bus set and is
   correctly outside #156. Extending the law to those is a separate web-parity question.

---

## 9. Final verdict

**NOT FOLD-READY.** The four substantive decisions are sound — D1's law and mechanism, D2's exact
mirrors, D3's mechanical pin, and the generated-doc machinery are all correct and verified — but the
brief's campaign law makes **any wrong citation an automatic blocker**, and there are several, plus
one decision-level HOLE (D4's alias fix is inert).

### Numbered blockers (what + why + concrete fix)

1. **D4/RG-10 HOLE — the 5 `mcp.baton` alias rows cannot resolve the 5 non-canonical ops.**
   `render-surface-docs.mjs:104-115` resolves the operation key through `canonicalOperations`; the 5
   non-canonical keys aren't there, so `key` stays the tool name. The contract's item 1 and RG-10
   overstate the fix's effect. **Fix:** add the renderer fallback to `alias.canonical`
   (`operation ?? { key: alias.canonical, profile: 'ordinary', effect: 'idempotent' }`), or drop the
   alias requirement and rewrite RG-10 to accept `key = tool`; update G11's "alias rows resolve"
   claim either way.
2. **Citation C-1 — G2's served-command set is 16 unique commands, not 11.** Wrong count in a ground
   truth. The 14-op parity conclusion is unaffected. **Fix:** "16 unique commands (11 hand rows + 5
   canonical-sibling commands)".
3. **Citation C-2 — `scripts/…` paths lack the `impl/` prefix** (G1/G2/G3, read-order, G7, open Q4).
   No top-level `scripts/` exists; the line numbers resolve under `impl/scripts/`. **Fix:** normalize
   to `impl/scripts/surface-inventory-artifact.json` / `impl/scripts/surface-conformance.mjs`.
4. **Citation C-3 — G4 cites `:751-754` as "the M4b contract comment"; the M4b comment is at
   `:685-689`** (`:751-754` is the reflex-table comment). **Fix:** cite `:685-689`.
5. **Citation C-4 — D1's "35 to 102 tools" mixes the current application count with the post-change
   combined count.** HEAD `combined` = 86. **Fix:** "35 to 86 today (102 after D1+D2)".
6. **Mechanism spec gap — D1's `LIFECYCLE_ORDINARY_SIBLINGS` derivation-order is unstated.** Deriving
   it after the sibling spread yields an empty table (red pin); hand-inlining the 14 rows into
   `ORDINARY_APPLICATION_ENTRIES` passes every pin while silently violating the #159 no-hand-list
   doctrine. **Fix:** state that `ORDINARY_APPLICATION_ENTRIES` is built as hand-rows +
   `LIFECYCLE`-derived rows, with the gap snapshot taken before the spread.

### Not blockers (noted for the fold)

- The two wait/follow special-case lists (`:954-955`, `:1510`) stay hand-maintained; RG-07 covers the
  14 but nothing mechanically pins a future wait-like verb into both lists (D1 Gap 2).
- The D3 pin doesn't verify the `APPLICATION_TOOL` dispatch binding; RG-05 covers it. A third pin row
  over an exported dispatch map would close it mechanically (recommended, cheap).
- C-5 (`MCP.md:87`→`:88`) and C-6 (D3's "assertion fails with the 14-name diff" wording) are minor
  and should be fixed while the above are, but neither blocks independently.
