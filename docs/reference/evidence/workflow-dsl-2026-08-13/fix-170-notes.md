[attempt: 625dd7b4-c95b-442c-8231-449db5b92394 fix-170]
# fix-170 notes — the #170 impl's adjacent regressions (fix wave, impl/src serialized)

Date: 2026-08-13 · Attempt: `625dd7b4-c95b-442c-8231-449db5b92394` · Role: `fix-170`.
Authority: `fix-170-brief.md` + `impl-170-notes.md` §3 (the prior member's decision record).

## 0. Worktree-base discrepancy (provisioning, named honestly)

My worktree's branch `baton/ws-b764daf477292d8b8431ac645a487b83` was created from `9b18ec1`
(fold foundry-c — PRE-impl) per the reflog (`branch: Created from 9b18ec18…`), not from the fix
base `d38671a` (`baton workflow base fix-170-2026-08-14-wave-a`). At `9b18ec1` the #170 impl is
absent (`impl/src/workflow-dsl.mjs` missing, no `waves.compile`), so the four "regression" suites
are green there by construction — nothing broke because nothing landed. I fast-forwarded the clean
worktree to `d38671a` (a descendant; non-destructive, nothing discarded) to bring the impl in, then
reproduced and fixed the four regressions on that base. All split records below are measured at
`d38671a` + these fixes.

## 1. Split records

**The four regression suites** (before → after, at the fix base):

| Suite | pre-fix | post-fix |
|---|---|---|
| `workflow-surface-red.test.mjs` | 36/37 (FP-14 only) | 37/37 |
| `phase77-recursive-application-red.test.mjs` | 13/14 (RA2 only) | 14/14 |
| `board-workerhalf-red.test.mjs` | 10/24 (14 rows) | 24/24 |
| `kg-settlement-red.test.mjs` | 22/24 (KS5/KS6) | 24/24 |

**The #170 target suites** (must stay green):

| Suite | result |
|---|---|
| `workflow-dsl-red.test.mjs` | 35/35 |
| `workflow-dsl-package-red.test.mjs` | 12/12 |

**Named adjacents** (must stay green):

| Suite | result |
|---|---|
| `workflow-as-data-red.test.mjs` | 30/30 |
| `wave-observability-red.test.mjs` | 30/30 |
| `control-surface-truth-red.test.mjs` | 7/7 |
| `mcp-reflex-surface-red.test.mjs` | 21/21 |
| `phase16-mcp-northbound.test.mjs` | 29/29 |
| `phase67-progressive-agent-experience.test.mjs` + `phase72-kimi-orchestrator-mcp.test.mjs` | 32/32 |

`node impl/scripts/surface-conformance.mjs` → `surface-conformance: ok`.

## 2. Mechanism + fix per regression

### FP-14 (workflow-surface-red) — collateral tool-count, not an impl bug

**Mechanism.** `baton_waves_compile` is the contract-mandated (DR-2(a)) NEW ordinary MCP tool; it
shifts the ordinary surface count 35 → 36. The impl member updated the collateral inventories in
phase16/mcp-reflex/phase67/phase72/wave-observability but missed `workflow-surface-red`'s FP-14 pin,
which asserts `mcpApplicationToolNames().length === 35`.

**Fix.** The one suite edit the brief permits: `35` → `36` and the message now names
`baton_waves_compile (#170, DR-2(a) contract-required)`. No assertion weakened — the pin still
asserts the exact ordinary-surface cardinality, now 36.

### RA2 (phase77) — the `command()` wrapper broke the detached-call contract

**Mechanism.** RA2 pins that a forged principal (`{...principal('forger'),
orchestratorLeaseId: '…forged'}`) refuses `application_authority_invalid` at the public command
entry. It does so via `BatonApplication.prototype.command.call({_assertOpen(){}}, …)` — a detached
call on a minimal `this`. The impl's `command`/`_commandDispatch` split made `command` delegate
through `this._commandDispatch`, which is `undefined` on that minimal `this` → `TypeError:
this._commandDispatch is not a function` instead of the typed refusal.

**Fix.** `command` now runs `normalizePrincipal(rawPrincipal, 'command principal')` at its public
entry — BEFORE the dispatch body — so the forged-principal refusal fires on a detached call without
needing the full instance. The dispatch body re-normalizes below (idempotent on a valid principal);
the PG-PIN `rawOptions.authorize` override path is untouched.

### board-workerhalf (14 rows) — the #176 gate caught the S-2 claimGrant seam

**Mechanism.** The #176 closure's raw-context gate refused EVERY `waves.*` verb under a
`sessionAuthority` context. But `waves.send`'s closed `claimGrant` mint (`sendGrant`, BW-03/05/22
and every grant-dependent row) is the orchestrator's board-grant transport — it REQUIRES the S-2
session authority (`sendWaveMember` throws `application_wave_member_action_invalid` without it). The
gate therefore refused the legitimate orchestrator grant with `run_orchestrator_command_forbidden`,
breaking all 14 grant/scope/CAS/durability/read rows.

**Fix.** The gate now exempts `waves.send` when `args.claimGrant !== undefined` (the S-2 admission
seam — a board operation, not a recursive steering verb). Every other `waves.*` verb, and a
non-claimGrant `waves.send`, still refuses typed (PG-A/PG-B hold).

### kg-settlement (KS5/KS6) — the #183 check refused the ritual re-drive

**Mechanism.** The #183 `assertWaveStartReplayable` refusal (in `createWave`) fired on the settlement
hook's same-key re-drive. KS5/KS6 drive the settlement wave, then `driveWave` AGAIN with the same
`idempotencyKey`; the first pass's member run is already `completed`, so the wave is "terminal" and
`createWave` threw `wave_already_terminal` before the driver could re-run the ritual. The settlement
re-drive is the idempotent resume path (runId dedupe via `saltObjectives:false`), not a user replay.

**Fix.** `createWave` skips the #183 refusal when `options.allowTerminalReplay === true`; the
wave-driver's `run` sets that flag on its `startOptions` (its same-key re-drive re-attaches rather
than replays). The user-facing `waves.start` (PK-A) and the interpreter's `runWorkflow` do NOT set
the flag, so a terminal key still refuses `wave_already_terminal` there.

## 3. Anything not fixed / residual

- **None of the four regression suites remain red.** All four are green at their pre-impl cardinality
  (37/37 · 14/14 · 24/24 · 24/24).
- **`mcp-profile-parity-red` is NOT in my acceptance set** (the fix brief's named adjacents exclude
  it) but I re-ran it anyway to confirm the siblings suite is unmoved: it holds its declared split
  **8 pass / 13 red-by-design** — the RED rows still fail at their designed stages
  (application-tools-count-49 / combined-102-includes-siblings / artifact-counts-49-102, etc.), not
  at a new stage. The impl-170 notes §5 already names the composition-fold drift (35→36 / 86→87) as
  the #156 siblings feature's to-re-derive consequence, not a #170 regression.
- **The `command()` double-normalization** (public-entry + dispatch-body) is a deliberate, idempotent
  choice: it is the minimal change that preserves the detached-call contract the RA2 pin relies on
  without re-indenting the 190-line dispatch body in a NUL-bearing file.

## 4. Craft-law compliance

- No clocks introduced; no `localeCompare`; no sorted-key literal reordered; no byte literal added
  outside `limits.mjs`; no closed-vocabulary member appended.
- NUL discipline: `application.mjs` (3 NUL bytes, line 626) and `coordination-store.mjs` (3 NUL
  bytes) were read only via `grep -an`/`sed -n`; edits were exact-string and left the NUL bytes
  intact (re-verified: 3 each).
- No generated doc hand-edited (`surface-conformance: ok`).
- The only suite edit is FP-14's collateral count (the one the brief permits).
