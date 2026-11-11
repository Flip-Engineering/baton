# #160 blue-team — `error-actionability-red` suite vs `contract-fold.md` v1.1

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt160]

- **Target:** `impl/test/error-actionability-red.test.mjs` (22 tests — extracted from `master`
  blob `eacef4a07727b4ddd3e35dd63b084c94c79c8696`, blob-identical to commit `947a804`; absent
  from the worktree HEAD, run from a temporary copy that is removed after this report).
- **Authority:** `docs/reference/evidence/error-actionability-2026-08-13/contract-fold.md` v1.1,
  §4 RED-FIRST ACCEPTANCE PINS (rows W1–W8, M1–M5, C1–C3, X1–X3, S1–S3).
- **Frame:** foundry-brief.md shared laws — ring-2 form, citations re-verified at HEAD `e371f70`,
  no clocks as controls, NUL discipline, split-twice, attempt-echo law.
- **Verdict:** **NEEDS-FOLD** (1 BROKEN row — M5 un-greenable; 2 SHALLOW rows — M3, W3; 1
  contract-text gap — the MCP R2 detail-construction formula).

---

## 1. Split-twice verification (measured this session at HEAD `e371f70`)

Both runs executed via `node --test impl/test/error-actionability-red.test.mjs` (full output to
`/tmp/bt160-run1.out`, `/tmp/bt160-run2.out`):

| Run | tests | pass | fail | exit |
|-----|-------|------|------|------|
| 1   | 22    | 5    | 17   | 1    |
| 2   | 22    | 5    | 17   | 1    |

- RED rows (17): W1 W2 W3 W4 W5 W6 W7 W8 M1 M2 M3 M4 M5 C1 C2 C3 S2
- GREEN rows (5): X1 X2 X3 S1 S3

This matches the suite header's declared notes exactly.

## 2. Law re-check

- **No clocks as controls:** every fixture injects the clock (`now: () => NOW`,
  `clock: () => new Date(NOW).toISOString()`); no wall-clock assertion anywhere in the suite. ✓
- **NUL discipline:** `application.mjs` and `coordination-store.mjs` were touched only via
  `grep -an`/`sed -n` this session, never whole-file reads. ✓
- **Citations at HEAD:** every seam named below was re-verified at HEAD `e371f70` (web
  `dispatchFailure`/`validateEnvelope`/`_authorize`, MCP `stateFailureCode`/the stateful +
  observe + replay catches, CLI `parseBatonCli`/`BatonWebClient` fetch catch, the conformance
  main + ledger). ✓

---

## 3. Capability rows — cheapest wrong implementation per row

### W1 (F1 × web) — `unknown_top_level_field` + `field: 'bogusTopLevelField'` — **SOUND**
At HEAD red (execute collapses to `invalid_command`). Green requires `validateEnvelope` to diff
the envelope and name the actual unknown key in `field`; the field assertion pins the real key
(`bogusTopLevelField`), which only real unknown-key detection produces. A constant-field wrong
impl fails. The cheapest green impl is the R4 structured-refusal refactor — which is the fix.

### W2 (F1 × web) — `unknown_argument_field` + `field: 'bogusArg'` — **SOUND**
Identical structure to W1 on the args closure; the field must name the actual arg key. SOUND for
the same reason.

### W3 (F1 × web) — `run_act` exactObject → `application_action_invalid` — **SHALLOW**
At HEAD red (collapsed to `invalid_command`; the schema catch returns
`application_command_arguments_invalid`). Green only asserts the named code + a next action —
**no field, no message content**. Cheapest wrong impl: a one-line remap in the web `execute`
mapping, `if (envelope.command === 'run_act' && validation) return error(400,
'application_action_invalid', validation)`. This turns the row green without ever invoking the
application's real exactObject validator. The row pins neither the validator's authority nor the
offending key — the exactObject semantics are unenforced (W8-1 constrains the remap to `run_act`
only, which the narrow form satisfies). **SHALLOW.**

### W4 (F6 × web) — over-spill `run.objective` → 400/413, `field: 'objective'`, triple — **SOUND**
At HEAD red (503 fallback). Green requires: (a) typed coaching code routed to 400/413, never the
fallback; (b) `field` mapped lane→arg as `'objective'` — a naive passthrough of the lane name
`'run.objective'` **fails** `assert.equal(field, 'objective')`, so the row forces the arg-name
mapping; (c) `{cap, actual, unit, gracefulPath}` on the wire; (d) `assertNoBodyContent` — the
body never quotes the objective. All four legs are genuine discriminators. **SOUND.**

### W5 (F5 × web) — `waves.run` → `workflow_spec_invalid` naming the field — **SOUND**
At HEAD red (`workflow_*` degrades to the generic 400). Green: a `workflow_*` arm surfacing
`error(400, cause.code, cause.message)` so the message carries `members`. The code pin (never
`invalid_command`) and the message substring (`members`) are both real; the message-content check
is a soft substring, so a canned `waves_run` refusal also passes — the row pins the typed code and
field naming, not the generality. **SOUND** (with that softness noted).

### W6 (F3 × web) — `_authorize` per-precondition 403 + field ∈ {origin, csrf, repoId, capability} — **SOUND**
At HEAD red (403 `forbidden`, no field). Green requires each distinct precondition denial to name
its own field. A constant-field wrong impl (e.g., always `origin`) fails three of the four cases;
the row forces real per-precondition naming. **SOUND.**

### W7 (F2 × web) — 503 fallback ONLY for untyped throws — **SOUND**
Leg A holds at HEAD (untyped → 503 `temporarily_unavailable` / `command dispatch failed`, no
provider leak). Leg B is the discriminator: a typed coaching code (`decision_text_exceeded`) must
reach its triple arm, never the fallback. Green: a typed-vocabulary allowlist in
`dispatchFailure`. The Leg-A no-leak pins kill any message-passthrough wrong impl. **SOUND.**

### W8 (F1 × web boundary) — route-shape stays `invalid_command`; coded passes through — **SOUND**
Leg 1 holds at HEAD (fence-shaped `kill` → `invalid_command` + reason names `expectedFence`) and
constrains the repair: the string-validation path must not be remapped. Leg 2 is the
discriminator: `run_inspect`'s coded throw (`application_inspect_invalid`) must pass its named
code at 400. Cheapest green impl: a typed-code passthrough in the dispatch catch
(`if (typeof cause?.code === 'string') return error(400, cause.code, cause.message)`), which is
the R4 fix; the route-shape leg kills the "remap everything" variant. **SOUND.**

### M1 (F1 × MCP) — over-cap objective → `spill_body_exceeded` + {cap, actual} — **SOUND** (fold-note)
At HEAD red (stateful sink fallthrough → `command_outcome_unknown`; verified at assert line 405:
`actual: 'command_outcome_unknown'`). Green requires (a) the code allowlisted — never
`invalid_run_command`/`command_outcome_unknown` — and (b) the coaching numbers `{cap, actual}`
present. The cheapest wrong impl is a `spill_body_exceeded` special-case in the stateful catch
that constructs the triple. **Fold-note:** the literal fold B3 helper
(`laneCraftedToolError(cause) = toolError(stateCode, cause?.message ?? null, cause?.detail ?? null)`)
does **not** satisfy this row: `coachingApplicationError`/`coachingValidationError` put
`{code, field, cap, actual, unit, gracefulPath}` on the thrown Error **root**, so `cause.detail`
is `null` — a correct impl must *construct* `detail` from the cause's root fields. The suite is
correct to demand this; the fold text must say "construct, don't pass through." **SOUND.**

### M2 (F6 × MCP) — over-cap `decision.text` → `decision_text_exceeded` + triple — **SOUND** (same fold-note)
Same structure as M1 for the `run.answer` lane; the stateful sink must allowlist
`decision_text_exceeded` and the triple must ride in `detail` (constructed from the root). The
`assertCoachingTriple` (cap 4096, actual 5000, unit bytes, gracefulPath) kills both a code-only
sink and a message-only sink. **SOUND** with the identical fold-note.

### M3 (F7 × MCP) — `invalid_wave_start` + non-empty field — **SHALLOW**
At HEAD red (the wave tool-validation returns a bare `'invalid_wave_start'` string, surfaced as
`toolError(invalid)` — code-only, no message, no field, so `assertActionableTriple` fails on the
next-action leg). Green only asserts `error.field != null && String(error.field).length > 0` —
**any non-empty field passes**. Cheapest wrong impl: special-case `invalid_wave_start` at the
surfacing with a constant `field: 'members'` + a canned message. The pin's "offending member
(index/role)" specificity (member 1 / role `'designer'` — `mcp-northbound.mjs:1105-1115`) is
entirely unenforced: the offending member is never asserted. **SHALLOW.**

### M4 (F7/E4 × MCP) — observe-path `waves.progress` detail ≡ stateful detail — **SOUND**
At HEAD red (observe catch `toolError(code, message)` drops `cause.detail`;
`mcp-northbound.mjs:1518-1531`). Green: the observe sink forwards the lane's `detail` for typed
refusals. The `deepEqual` pins the exact `{actual: 1, cap: 0, cause: 'role_not_roster',
role: 'coder'}` payload — a partial or differently-shaped detail fails. **SOUND.**

### M5 (F6 × MCP replay) — replay carries `decision_text_exceeded` + triple — **BROKEN**
**Green-side blocker.** The stage assertion at line 488 —
`assert.equal(mcpError(first).code, 'command_outcome_unknown', 'stage: stateful-sink-fallthrough — the first call fails at HEAD via command_outcome_unknown')`
— hard-codes the HEAD-red behavior of the **first** call on idempotencyKey `m5-ik`. M1/M2 force
the *same* stateful sink to allowlist coaching codes (that is the R2 repair), so once the repair
lands the first call returns `decision_text_exceeded` and line 488 fails. The row is internally
contradictory: M1/M2 demand the stateful sink surface the coaching code; M5:488 demands it keep
the fallthrough. No sane implementation of the contract's own R2 satisfies both; a key-specific
hack is the only (absurd) escape. **Fix:** drop or relax line 488 to
`['command_outcome_unknown', 'decision_text_exceeded'].includes(mcpError(first).code)` — the
row's true pin is the replay sink only (line 494-496). **BROKEN as written.**

### C1 (F4 × CLI) — `cli_transport_failed` names the transport class + a next action — **SOUND**
At HEAD red (fetch catch message `'Baton Web connection failed'` matches `/web/i` but has no
next-action word). Green: the message gains a `(check|verify|ensure|confirm|retry)` phrase. The
regexes are lenient, but the discriminator is real — a message with neither the class nor a
next-action word fails. **SOUND.**

### C2 (F8 × CLI) — `baton run shwo` → `cli_command_unavailable` + `/start/i` — **SOUND**
At HEAD red (unknown run verb silently reinterprets through `parseStart` —
`application-cli.mjs:1578` — no throw, so `assert.throws` fails). Green: the run-verb branch
refuses unknown actions with `cli_command_unavailable` and a message listing `start`. Kills the
F8 silent-reinterpretation anti-pattern. **SOUND.**

### C3 (F9 × CLI) — the 20 CLI-local codes ledgered in `surface-divergence-ledger.json` — **SOUND**
At HEAD red (`{"schemaVersion":1,"entries":[]}` — empty). Green only via putting the 20 code
strings in the ledger file; that is the intended S2 escape hatch. The row validates string
presence only — the per-entry "deliberately code-only" semantics are unvalidated (minor
softness). **SOUND.**

### S2 (static closure) — every `cli_*` code in the CLI source is in-scope or ledgered — **SOUND**
At HEAD red (22 `cli_*` codes in `application-cli.mjs`; the 20 non-in-scope codes are exactly
`CLI_LOCAL_TOOLING_CODES` and are unledgered). Greenable only by ledgering the 20 (or editing the
source, which C3's code list makes pointless). The in-scope set is hardcoded; there is no cheaper
bypass. **SOUND.**

---

## 4. Pin rows — plausible wrong impl each kills

- **X1** (sanitization negative) — **bites.** Kills any compliance claim built on code-only tool
  errors (exactly the current `command_outcome_unknown` fallthrough shape) and, more broadly, any
  repair that ships the typed code without a next action. It pins `assertActionableTriple`'s leg
  (c), so a whole-family "code-only is fine" repair dies here. Not decorative.
- **X2** (sanitization negative, AS-4) — **bites.** Kills any refusal that quotes body/secret
  content. This is the general form of the W4/W7/W5 no-leak legs, on the apparatus itself.
- **X3** (carve-out, B4) — **bites.** Kills both poles: an over-strict sanitization that flags a
  lane-authored *field-key* quote (the legitimate `workflow_*` message), and a lax sanitization
  that leaks a secret-shaped *body value*. The B4 shape-vs-content distinction is pinned.
- **S1** (executable conformance gate) — **bites.** Kills any repair that breaks the conformance
  main (a ledger format change that makes `surface-conformance.mjs` throw, or a surface
  divergence that flips its output) — the repair must keep the gate green.
- **S3** (shape-only apparatus) — **bites.** Kills a "helpful" helper whose own failure message
  quotes the offending value. It pins the scanner law (never body content) on the suite itself.

None decorative.

---

## 5. Empirical mutation evidence (attack continued — every cheapest-wrong-impl and pin bite run against the real suite)

Each mutation below was applied to the worktree transport source, the suite re-run, and the
source restored to master; the final tree is clean except this deliverable and the (removed)
temp test copy. Baseline for every run: 22 tests — pass 5 / fail 17.

| Mut | Patch (the cheapest wrong impl / the bit) | Result | Proof |
|-----|------|--------|-------|
| **A** | W3: one-token `run_act`-only remap in web `execute` — `error(400, envelope.command === 'run_act' ? 'application_action_invalid' : 'invalid_command', validation)`. No exactObject validation at all. | pass 5 → 6 | **W3 ✔** — a remap flips it. **W3 SHALLOW confirmed.** |
| **B** | M3: `invalid_wave_start` surfaced with constant `field: 'members'` + canned message. No member index/role detection. | pass 5 → 6 | **M3 ✔** — constant field flips it. **M3 SHALLOW confirmed.** |
| **C** | Full correct R2: `stateFailureCode` allowlist + LANE_CRAFTED extended to coaching codes + `detail` **constructed from the cause's root fields** at both the stateful and RECONCILABLE replay sinks. | pass 5 → 7 | **M1 ✔ M2 ✔** but **M5 ✖ at line 488**: `actual 'decision_text_exceeded' / expected 'command_outcome_unknown'`. **M5 BROKEN confirmed** — the contract's own repair cannot turn it green. Also proves repair-independence: web rows W1–W8 stay red under the MCP-only fix. |
| **C′** | Same allowlist + LANE_CRAFTED, but the **literal** fold B3 formula — `cause?.detail ?? null` passed through, no root-field construction. | pass 5 (unchanged) | **M1 M2 stay ✖** (M2 fails `the cap is named` — wire detail is null because coaching refusals carry the triple at the Error *root*). **Fold-note confirmed empirically:** the fold text's B3 helper cannot satisfy the coaching rows. |
| **E** | Ledger the 20 CLI-local codes via an extra top-level `_cliToolingCodes` array (valid per `validateLedger`). | pass 5 → 7 | **C3 ✔ S2 ✔ S1 ✔** — the escape hatch works; the closure pin is satisfiable by the intended fix. |
| **G** | Naive dump: the 20 codes as `entries` with a plausible shape → "dead ledger row" findings in `surface-conformance`. | S1 breaks (runner aborts) | **S1 ✖** — the conformance main exits 1 (`invalid ledger: dead ledger row: …`), S1's `execFileSync` throws and aborts the runner before a summary prints. **S1 bites** a ledger that contains the strings but is semantically broken. |
| **F** | With the codes ledgered (E-state, S2 green), introduce a novel `cli_novel_unledgered` literal in `application-cli.mjs`. | pass 7 → 6 | **S2 ✖** — a novel unledgered `cli_*` code is a red finding. **S2 bites.** |

The pins X1/X2/X3 bite structurally (they are green at HEAD precisely because the apparatus
rejects the code-only / secret-quoting shapes): X1 is what keeps every row that ships a
code-only refusal red (the HEAD `command_outcome_unknown` fallthrough is exactly the shape X1
rejects); X2 is the general form of the W4/W7/W5 no-leak legs; X3 enforces the B4
shape-vs-content carve-out on the lane-authored `workflow_*` messages.

## 6. Fold findings

1. **MCP R2 detail-construction gap (contract text).** The fold's B3 helper formula passes
   `cause?.detail`; coaching refusals carry the triple at the Error **root**, so `cause.detail`
   is `null` for every coaching throw. M1/M2/M5 can only go green if the helper *builds* the wire
   `detail` from the cause's root `{cap, actual, unit, gracefulPath}` (and places `field` per the
   surface shape). The suite is correct; the fold text must be amended to "construct from root
   fields," not "pass `cause.detail`."
2. **M5 stage-marker defect (suite).** Line 488 hard-codes the HEAD fallthrough as a permanent
   expectation and contradicts M1/M2's required repair. Must be relaxed (see §3 M5).
3. **M3/W3 specificity gap (suite).** Both rows are green-able with surface-specific remaps
   (`invalid_wave_start` constant field; `run_act`-only remap). M3 should assert the offending
   member (index/role); W3 should pin a field or a message naming the offending key so a canned
   remap fails.

---

## 7. Final verdict

**NEEDS-FOLD.** (Every verdict above is now backed by the mutation evidence in §5: W3/M3 SHALLOW
proven by Mut A/B, M5 BROKEN proven by Mut C, the fold B3 formula insufficient proven by Mut C′,
S1/S2 bites proven by Mut G/F.)

Numbered blockers:

1. **M5 is BROKEN** — un-greenable as written; line 488 hard-codes the `command_outcome_unknown`
   stateful fallthrough that the M1/M2-required repair eliminates. Relax the stage marker.
2. **M3 is SHALLOW** — a constant `field` + canned message turns it green; the offending-member
   (index/role) pin is unenforced. Assert the actual member identity.
3. **W3 is SHALLOW** — a `run_act`-only remap turns it green without exactObject validation. Pin
   the offending key (field or message content).
4. **Fold B3 formula insufficient for MCP coaching** — the R2 helper must construct `detail`
   from the cause's root coaching fields, not pass `cause.detail` (which is null for every
   coaching throw).

Whole-suite cheapest wrong impl = correct R3/R4/R5/R6 + a narrow MCP allowlist with root-field
triple construction + the ledger dump — which passes every row except M5 (impossible) and reveals
the M3/W3 shallow seams.

---

## 8. Shared-publish evidence

- **Mechanism:** worker-facing `SCRATCHPAD_WRITE` up-channel (`impl/src/claude-session.mjs:29,105` —
  closed shape `{entry, expectedFence, idempotencyKey}`, `expectedFence: 'current'`).
- **Attempted:** publish with idempotencyKey `bt-160-publish-v1` (title line `#160 blue-team
  (row-bt160)`), emitted this session.
- **Confirmed landed:** runtime coordination store event seq **69996**,
  `kind: scratchpad.entry_written`, `actor: worker`, `idempotencyKey: bt-160-publish-v1`,
  `runId: run-825b6cbac997157bb1ddf5fd2a117bcb`, `workerId: w-249`, **`scope: worker:w-249`**,
  `entryId: scratchpad-entry:30f8d3aa…`.
- **Recorded refusal:** the worker-facing write lands at `worker:w-249` scope — the kernel
  `writeScratchpad` hardcodes `scope = worker:${workerId}` (`coordination-store.mjs:14103`), the
  `run.scratchpad.append` verb is unlanded (#158 DRAFT), and `shared`-scope writes are
  orchestrator-gated (elevation only). **The `shared`-scope target is unreachable from a worker
  surface at this HEAD** — exactly as the channel audit documents (`all entry_written scoped
  worker:*`). Full report: this file
  (`docs/reference/evidence/blue-team-2026-08-13-a/blueteam-160.md`).
