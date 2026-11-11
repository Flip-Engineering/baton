SUITE-QA v1

# SUITE-FOUNDRY wave-b COORDINATOR QA — the four red-first suites (#155/#156/#161/#164)

[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc coordinator]

Coordinator: v4-pro seat, `suite-foundry-2026-08-13-wave-b`. Verification date: 2026-08-13.

## Signal state (honest record)

`signalOnMembersDone` had NOT fired at verification time. Per the #174 law I did not wait on the
dark channel: I verified on-disk content directly in the row worktrees
(`../../wt/ws-*/impl/test/<file>` + `../../wt/ws-*/docs/reference/evidence/<topic>/suite-draft-notes.md`),
which is the ground truth the wave-a QA missed. All four rows' deliverables EXIST on disk; no row is
dead. Three of four were already settled; the fourth (#164) settled during verification (its files
stabilised at 06:51/06:55 and the notes were corrected to match the final split).

## Verification evidence (cited, no fabrication)

Each suite was run twice from its row worktree root (`node --test impl/test/<file>`, the exact
command in the brief). Both runs agree. Measured split vs the row's declared split in its notes:

| Suite | Test file (worktree) | Run 1 | Run 2 | Declared in notes | Match |
|---|---|---|---|---|---|
| #155 cli-silent-start | `ws-1aa523…/impl/test/cli-silent-start-red.test.mjs` | 12 / pass 7 / fail 5 | 12 / 7 / 5 | 12 / 7 / 5 (7 PIN + 5 capability) | ✅ stable, matches |
| #156 mcp-profile-parity | `ws-966e97…/impl/test/mcp-profile-parity-red.test.mjs` | 21 / pass 8 / fail 13 | 21 / 8 / 13 | 21 / 8 / 13 (8 PIN + 13 capability) | ✅ stable, matches |
| #161 orchestrator-plan-object | `ws-3d81be…/impl/test/orchestrator-plan-object-red.test.mjs` | 44 / pass 5 / fail 39 | 44 / 5 / 39 | 44 / 5 / 39 (5 PIN + 39 red) | ✅ stable, matches |
| #164 blind-waits | `ws-e8767b…/impl/test/blind-waits-red.test.mjs` | 31 / pass 23 / fail 8 | 31 / 23 / 8 | 31 / 23 / 8 (23 PIN + 8 capability) | ✅ stable, matches |

No instability anywhere. All four declared splits match the measured splits at the settled state.

## Per-suite QA

### #155 — cli-silent-start (`row-suite-155`) — VERDICT: SOUND

- **Measured split:** 12 tests — 7 pass / 5 fail, run twice, identical. Declared 7/5 (7 PIN rows
  PT-1/PT-3/PT-6/PT-7/PT-8/PT-9/PT-10 green; 5 capability rows PT-2a/PT-2b/PT-2c/PT-4/PT-5 red).
- **Stage discipline:** every red capability row fails at a NAMED stage in the assertion message —
  `stage[pinned-typo-<token>]`, `stage[generated-damerau1-sweep]`, `stage[facade-nouns-symbol-absent]`,
  `stage[alias-first-tokens-symbol-absent]`, `stage[derivation-symbol-absent]`,
  `stage[guard-replaces-naked-fallthrough]`, `stage[new-cli-code-minted]`, `stage[member-prefix-*]`.
  All 7 PIN rows green. No stage-less capability row.
- **Shallow-green spot-check (2 rows):** PT-2a (pinned typos `shwo`/`sned`/`viwe`/`attenton`) — the
  cheapest wrong impl is hardcoding those four tokens; blocked by PT-2c's generated
  Damerau–Levenshtein-1 sweep (2 711 exactly-one variants, 0/two-or-more asserted). PT-4 (derivation
  symbol) — the cheapest wrong impl is a hand-kept verb literal; blocked by PT-4(a–e)'s source-scan
  (FACADE_NOUNS ≡ run-branch dispatch labels; ALIAS_FIRST_TOKENS cross-checked against
  `OPERATION_ALIASES`). Neither row is shallow-greenable.
- **Law check:** parse-seam only, hermetic by construction (no connection/provider/clock/host state,
  no fixture so no mkdtemp/stallMs clause applies — stated in the notes). No absolute line-window
  anchors (ORDER/EXISTENCE/byte-string only). No `localeCompare`. Attempt echo verbatim
  `[attempt: 08d0dac7-… row-suite-155]` in the suite header (line 2) and notes (line 3).

### #156 — mcp-profile-parity (`row-suite-156`) — VERDICT: SOUND

- **Measured split:** 21 tests — 8 pass / 13 fail, run twice, identical. Declared 8/13 (8 PIN rows
  RG-P1..RG-P8 green; 13 capability rows RG-01..RG-11 red).
- **Stage discipline:** every red row names its stage — `stage: served-set export`,
  `stage: application-tools-count-49`, `stage: uncovered-set-empty`, `stage: combined-102-includes-siblings`,
  `stage: sibling-schema-inherits-source`, `stage: alias-rows-registered`,
  `stage: renderer-fallback-absent`, `stage: artifact-counts-49-102`, etc. All 8 PIN rows green
  (RG-P1 conformance-main-green through RG-P8 phase16-combined-count-pin).
- **Shallow-green spot-check (2 rows):** RG-02 (application tools/list 49) — cheapest wrong impl is a
  hardcoded count; blocked by set-equality against the LIVE `mcpApplicationToolNames()` output plus
  RG-03's mechanical derivation (`webCommands − served = []`, never a hand list). RG-06 (sibling
  schema inherits `fleet_run_*`) — cheapest wrong impl is a shallow schema copy; blocked by
  byte-equality modulo `name` + `taskSupport === 'forbidden'` + `_meta['baton/registryDigest']`.
  Neither is shallow-greenable.
- **Law check:** fixed fixture clock (`new Date(NOW)`), no wall-clock control. No line-window anchors.
  `localeCompare` appears only in ban-commentary. `watchdog.stallMs` clause vacuous (no watchdog-armed
  fixture; stated in the notes). Attempt echo verbatim `[attempt: 08d0dac7-… row-suite-156]` in header
  (line 2) and notes (line 3).

### #161 — orchestrator-plan-object (`row-suite-161`) — VERDICT: SOUND

- **Measured split:** 44 tests — 5 pass / 39 fail, run twice, identical. Declared 5/39 (5 PIN rows
  F4/R4/… green; 39 capability rows M1..M5, F1..F3, S1..S8, L1.., A.., X.., N1/N2 red).
- **Stage discipline:** every red row names its stage — `plan-write-port-missing`,
  `plan-read-port-missing`, `plan-fold-unlanded`, `plan-batch-kind-unregistered`,
  `plan-status-law-missing`, `plan-authority-matrix-missing`, `web-plan-ledger-missing`, etc. 5 PIN
  rows green (F4 close/reopen replay, R4 goal-plan validator, …). Note: the suite was caught mid-write
  with a transient `SyntaxError: Identifier 'alpha' has already been declared` at first run; the row
  fixed it before settling — the final state runs clean.
- **Shallow-green spot-check (2 rows):** L1 (exactly-one-in-progress / `plan_parallel_progress`) —
  cheapest wrong impl is always-refuse `plan_parallel_progress`; blocked by the row's dual-path
  assertion (resolved-write leg vs refused-write leg, recorded as the row's judgment call). M4/M5
  (version-bearing idempotency / `plan_stale_version`) — cheapest wrong impl is ignoring taskVersion;
  blocked by the explicit upsert-v1→v2 (`expectedTaskVersion=2` green) and stale (`=1` refuses
  `plan_stale_version`) legs. Neither is shallow-greenable.
- **Law check:** `watchdog: { stallMs: 60_000 }` threaded with the one-line comment in the only
  Coordinator-arming fixture (`createDriverFor`). Fixed fixture clock. No line-window anchors.
  `localeCompare` ban-commentary only. Attempt echo verbatim `[attempt: 08d0dac7-… row-suite-161]`
  in header (line 1) and notes (line 3).

### #164 — blind-waits (`row-suite-164`) — VERDICT: NEEDS-FOLD (minor, named below)

- **Measured split:** 31 tests — 23 pass / 8 fail, run twice, identical. Declared 23/8 (matches at the
  settled state — the row's notes were corrected to 31/23/8 after I observed an earlier stale 17/12/5).
- **Stage discipline:** every red capability row names its stage —
  `stage: terminal-truth-predicate-missing` (A1-a), `stage: settle-block-durable-stop-missing` (A1-b),
  `stage: mcp-refusal-renewal-missing` (A2-a/A2-b), `stage: web-refusal-renewal-missing` (A3-a/A3-b),
  `stage: driver-stop-on-repeated-auth-missing` (A4), `stage: return-seam-revalidation-missing` (B1).
  All 23 PIN rows green (A1-c, A5..A10, A4-pin, D3.2, P-APP/P-MCP/P-WEB/P-PUBLISH).
- **Shallow-green spot-check (2 rows):** A1-a (terminal-truth predicate) — cheapest wrong impl is a
  one-line edit admitting `stopping` to `APPLICATION_RUN_TERMINAL_PHASES`; blocked by A9 (the
  terminal/settled literal sets + `WAITING_ON_KINDS` stay byte-unchanged, additive-only). A2-a/A3-a
  (renewal naming) — cheapest wrong impl is moving the renewal into the application layer; blocked by
  P-APP (`run.wait`'s application-layer refusal stays `application_unauthorized` with NO renewal field
  — renewal is a TRANSPORT-surface concern). Neither is shallow-greenable.
- **Law check (findings):**
  1. **Attempt-echo NOT verbatim (the named fold item).** The suite header line 1 reads
     `// row-suite-164 attempt 08d0dac7-…` and line 6 `// Attempt echo: …` — the required verbatim
     `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-164]` line is absent; the other three
     suites carry it byte-verbatim. The notes (line 3, `row-suite-164 · attempt \`08d0dac7-…\``) share
     the deviation. The row recorded this as a "judgment-call interpretation" (§J); the #171 law says
     VERBATIM, so the fold must either normalize both headers to the verbatim `[attempt: …]` line or
     the top orchestrator must accept the interpretation. As-is the harvest's attribution check can
     refuse the file.
  2. **(minor) `watchdog.stallMs` not threaded.** The `createDriver` fixture (line ~289) omits the
     `watchdog` option, so the Coordinator falls back to its default `stallMs: 120000`
     (`coordinator.mjs:1069`) with no one-line comment — law #6 prescribes `60_000` + the comment.
     The default is a valid positive integer so the suite does not hang, but it is not the pinned value
     the law asks for. Compare #161, which threaded `stallMs: 60_000` explicitly.
  3. Otherwise compliant: no line-window anchors, no `localeCompare`, hermetic (mkdtemp + `t.after`
     `rmSync`, MockAdapter, no network/provider), fake clock (`mutableClock` + injected `now`) used only
     at the contract's clock seams.

## Shallow-greenability summary

All four suites pass the shallow-green spot-check: no capability row admits a cheap wrong
implementation that would green it, because each red row is cross-pinned (generated sweeps,
source-scans, mechanical derivations, byte-stability pins) rather than asserting a hand list. This is
the wave-a fold B4/#159 doctrine working — no sharpening note is required for any row.

## Escalations

None issued. No authority-class question arose: the verification is a coordinator judgment call
(recorded above), not an authority ambiguity, so no `DECISION_REQUEST` is warranted.

## What the fold stage needs next

Only #164 needs a fold, and it is a two-line normalization: (1) make the attempt-echo line verbatim
`[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-164]` in the suite header and the notes
header; (2) thread `watchdog: { stallMs: 60_000 }` into the `createDriver` fixture. The suite's
splits, stage discipline, and shallow-green hardening are otherwise sound. #155/#156/#161 are sound
and need no fold.

## Shared-scratchpad publish — record

The brief requires publishing this QA's full text to the `shared` scratchpad partition, and recording
the exact refusal if the publish fails. The publish was ATTEMPTED from this worktree and REFUSED. The
exact refusal, captured verbatim:

```
node impl/scripts/baton.mjs run scratchpad write shared "suite-qa"
  → ✦(◕﹏◕)◦ baton: cli_invalid: unexpected argument write
```

This matches the rows' independent findings (each recorded the refusal): the shared write lane is RED
at HEAD. `run.scratchpad.append` (the #158 publish verb) is not in the application dispatch
(`application.mjs:12522-12523` routes only `run.scratchpad.read` / `run.scratchpad.elevate`), and a
`writeScratchpad(…, scope: 'shared')` attempt is refused `scratchpad_write_invalid` ("scratchpad write
envelope is invalid") because the scope vocabulary is the closed `[runId, taskId, workerId, entry]` —
a `shared` scope is not expressible. This refusal is the campaign evidence (#158); the durable handoff
is this file in `docs/reference/evidence/suite-foundry-2026-08-13-b/`.
