# Blue-team review — wave-observability red-first suite (#132)

**Target:** the SUITE's red-keeping power, not the contract. The question is whether `impl/test/wave-observability-red.test.mjs` (26 rows: 4 green PINs, 22 red at named stages) keeps a dishonest or shallow implementation red while allowing a *correct* implementation of `contract-fold.md` (B1–B3, F1–F8, §4) to go green.

**Verdict:** **NEEDS-FOLD** — 13 numbered findings below. Three are green-side blockers (F1–F3): under a correct fold the suite *cannot* go green, so it would hold a correct implementation red. Four are shallow-greenability/oracle gaps (F4, F7, F8, F12) where a dishonest implementation passes. Five are missing-row gaps (F5, F6, F9, F10, F11) and one is an under-determined assertion (F13).

**Method.** Read in the prescribed order: `wave-observability-contract.md` (v1.1) → `contract-fold.md` (B1–B3, F1–F8, §4 drift) → the suite → `suite-draft-notes.md`. All citations into the two NUL-byte files (`application.mjs`, `coordination-store.mjs`) were verified with `grep -an`/`sed -n`; NUL-free files verified with ordinary `grep -n`. No clocks are asserted in this report; event-ordering claims use the suite's own `startedAtEventSeq` idiom.

---

## 2. Measured split (two runs, from the repo root)

```
$ node --test impl/test/wave-observability-red.test.mjs
# pass 4 · fail 22
```

| Run | Command | Result |
|---|---|---|
| 1 | `node --test impl/test/wave-observability-red.test.mjs` | pass 4 · fail 22 |
| 2 | `node --test impl/test/wave-observability-red.test.mjs` | pass 4 · fail 22 |

The 4 green rows are exactly the PINs — deterministic and stable across both runs (no #7 flake class observed):

| Green row | What it pins | Verified anchor |
|---|---|---|
| A1-7 | command-table byte-stability: 26 keys, the five wave verbs are NOT `APPLICATION_COMMAND_DEFINITIONS` entries, `waves.attach` is the one table row | `grammar-m3-red.test.mjs:264` deepEqual pins the full 26-key set; wave lane stays direct ports `application.mjs:12329-12332` |
| A2-2 | exactly-once: repeat start with the same `idempotencyKey` yields the same `waveId` and one `wave.started` record | `_append` key dedup `coordination-store.mjs:1462-1463` |
| A4-2 | processState never guesses `remote`; `unknown` → `stale` on both non-ESRCH/EPERM and empty `ps -o lstart=` paths | `resident-authority.mjs:56,60,61` |
| A6-5 | `wave_registry_invalid` stays a store-integrity throw, never an MCP surface row | mcp-northbound.mjs has zero `wave_registry_invalid` references |

## 3. Stage honesty

All 22 red rows fail at their NAMED stage at HEAD. Each row's failure mode was confirmed from the run output and is the precise cause its name claims.

| Row | Named stage | Actual failing assertion at HEAD | Honest |
|---|---|---|---|
| A1-1 | web-admission-missing | 400 `invalid_command` "unsupported command" — verb not admitted | ✓ |
| A1-2 | web-admission-missing | 400 `invalid_command` — verb not admitted | ✓ |
| A1-3 | web-admission-missing | 400 `invalid_command` — verb not admitted | ✓ |
| A1-4 | web-admission-missing | 400 `invalid_command` — verb not admitted | ✓ |
| A1-5 | web-admission-missing | 400 `invalid_command` — verb not admitted | ✓ |
| A1-6 | card-dot-spelling-missing | card lacks `waves.start` (`web-northbound.mjs:1453-1460`) | ✓ |
| A2-1 | record-shape-missing | `wave.started` payload has no `deploymentId` (`application.mjs:4615-4619`) | ✓ |
| A2-3 | registry-projection-missing | `waves.list` read rejects (no such command at HEAD) | ✓ |
| A2-4 | legacy-store-replay | `waves.list` read rejects | ✓ |
| A2-5 | registry-integrity | no exception — no fold, so no poison (`coordination-store.mjs:1326-1345` unreachable) | ✓ |
| A2-6 | wave-closed-fold-missing | store has zero `wave.closed` references (B1 branch absent) | ✓ |
| A3-1 | registry-shape/paging-missing | `waves.list` read rejects | ✓ |
| A3-2 | mcp-waves-list-row-missing | pinned enumeration still 33 (`mcp-reflex-surface-red.test.mjs:201`) | ✓ |
| A4-1 | local-only-liveness | `waves.list` read rejects | ✓ |
| A5-1 | cli-wave-verbs-missing | `parseBatonCli` throws `expected waves attach` (`application-cli.mjs:1320`) | ✓ |
| A5-2 | cli-wave-verbs-missing | `parseBatonCli` throws `expected waves attach` | ✓ |
| A5-3 | singular-corrective-verb | corrective names "waves attach" (`application-cli.mjs:1312`), not the plural verb for the requested action | ✓ |
| A5-4 | bare-attach-shape-missing | HEAD refuses `cli_invalid "wave ID is invalid"` (`application-cli.mjs:1328`), never issues `waves.list` | ✓ |
| A6-1 | run-less-success-shape | no rejection — facade resolves a run-less wave handle (`wave.mjs:195-209` swallow) | ✓ |
| A6-2 | web-admission-missing | 400 `invalid_command` — verb not admitted | ✓ |
| A6-3 | stateFailureCode-degrade | admission refusal degrades to `command_outcome_unknown` (`mcp-northbound.mjs:260`) | ✓ |
| A6-4 | allowlist-missing | mcp-northbound.mjs has zero `wave_not_found` references | ✓ |

Stage honesty is the suite's strongest property. Every red row fails for the reason it names, at the stage it names, against HEAD. The red side of the suite is trustworthy as written.

## 4. Hermeticity

**Verified clean.** Every fixture root is a fresh `mkdtempSync` dir (`baton-132-<label>-*`); each host builds its own `CoordinationStore` on its own tmp root; the A2 rows that append to a real store (`A2-4`, `A2-5`) append to per-test stores and never share state; `t.after` tears down (application shutdown, writer-lease release, `rmSync` recursive). The A2-5 poison is confined to its own test's store and never read afterwards. Two consecutive runs gave byte-identical splits, so no cross-test bleed or ordering dependence was observed. The #7 flake class (shared store root across tests) is structurally impossible here because the store root is per-test. No hermeticity finding.

---

## 5. Findings

### F1 — CRITICAL · green-side blocker: the fixture never provides a `deploymentId`, so a correct F3/D2.2 implementation cannot mint the projected record (or even admit the intent)

- **Rows:** A2-1, A2-3, A3-1, A4-1 (definitively red under a correct fold); A2-2, A1-1, A6-2, A6-3 (red depending on how the validator treats a missing id).
- **Attack:** none needed — this is the reverse direction. The suite's `openHost` (`wave-observability-red.test.mjs:198-256`) constructs `new BatonApplication({driver, repoId, profiles, defaults, principals, authorize})` directly and **bypasses `openBatonDeployment`** (`application-deployment.mjs:1691`, re-exported at `index.mjs:51`). At HEAD `application.mjs` has **zero** `deploymentId` references; the deployment id exists only on the resident authority (`resident-authority.mjs:116`, minted `deployment-${randomUUID()}` at authority creation). Contract `D2.2`/`F3` requires `startWave` to thread the resident `deploymentId` into the mint (extending the `waveStart` closed key set at `application.mjs:1510` from `idempotencyKey,roster` to `deploymentId,idempotencyKey,roster`). A correct implementation must therefore either (a) add a constructor option and read `this.deploymentId`, or (b) read the authority — and **both** need the fixture to supply one. With the fixture as written:
  - the `deploymentId`-bearing assertions in A2-1 (`typeof payload.deploymentId === 'string'`), A2-3, A3-1, A4-1 (`typeof row.deploymentId === 'string'`) can never pass;
  - if the validator *value-checks* `deploymentId` as `validId`, the bare `await startWave` in A2-1/A2-2/A2-3/A3-1/A4-1 and the web dispatch in A1-1 reject with an intent refusal — flipping the A2-2 **PIN** red and breaking the green-pin invariant.
- **Fix:** the fixture must open the deployment host (`openBatonDeployment`) or pass a known `deploymentId` option into `BatonApplication`; the four deploymentId rows should additionally assert the value equals the known host id (which also kills a hardcoded-constant shallow impl). F3's fix item in `contract-fold.md` should state explicitly where the id enters the application object.

### F2 — CRITICAL · green-side blocker: A1-3/A1-4 dispatch to a `runId` that can never exist, so `ok: true` can never hold

- **Rows:** A1-3 (`waves_send {runId:'run-a'}` → asserts `res.status === 200` + `body?.ok === true`), A1-4 (`waves_stop {runId:'run-a', reason:'complete'}` → asserts 200 + `ok:true`).
- **Attack:** the fixture starts no member run before these two `web.execute` calls, so `run-a` is not a run. Under a correct D1 implementation, `sendWaveMember` throws `application_worker_not_found` (`application.mjs:11633-11635`; target = `coordinator.list().find(...)` → undefined) and `stopWaveMember` → `stop` → `_findRun` throws `application_run_not_found` (`application.mjs:3432`). `dispatchFailure` maps both to HTTP 404 with `ok:false`. The round-trip assertions can **never** hold — the rows fail *after* admission for a reason unrelated to the D1.1 admission they are named for.
- **Fix:** start a real member run in the fixture (via `startWave` or `runs.start`) and target its actual `runId`; or, if the row's intent is purely the admission round-trip, drop the `ok:true` claim and assert the transport round-trips a **typed** refusal (`{code: 'application_worker_not_found'}`) rather than `invalid_command`/`unsupported command`.

### F3 — HIGH · green-side blocker: A6-1 drives the facade (`createWave`), whose per-member swallow the D5.1/F6 fix never touches

- **Row:** A6-1 (`host.baton.waves.start({... BIG_OBJECTIVE})` → `assert.rejects` with `wave_member_invalid {actual, cap, cause, role}`).
- **Attack:** `BatonClient.waves.start` (`application-client.mjs:1548`) is bound to `createWave` (`wave.mjs:157`), which per-member calls `runs.start` inside a try/catch and swallows failures into `entry.startError` (`wave.mjs:195-209`) — resolving a run-less wave handle (the #129 witness). `contract-fold.md` F6/D5.1 pins the catch-wrap refusal in `application.startWave` (`application.mjs:11555-11576`, the `if (!runId) throw applicationError(...)` site). The facade never reaches that site — `createWave` calls `baton.runs.start`, not `application.command('waves.start')`. A correct D5.1 implementation therefore **leaves A6-1 red**; conversely a shallow impl that only fixes `startWave` and leaves the facade alone passes every red row here.
- **Fix:** fold the refusal into the facade — `createWave` must reject with `wave_member_invalid {actual, cap, cause, role}` when any member start fails (mirroring the `startWave` wrap), **or** A6-1 must drive the direct-port path (`application.command('waves.start', ...)`) so the row tests the site the fold actually touches.

### F4 — HIGH · shallow-greenable: D5 surface-constancy is under-asserted — A6-2/A6-3 check only the code, and the CLI leg has no row

- **Rows:** A6-2 (web), A6-3 (MCP); the CLI leg (D5.2: typed `body.error` + non-zero exit) has **no** row.
- **Attack:** A6-1 asserts `detail.cap`/`detail.actual`/`detail.role`/`detail.cause.code` on the embedded throw, but A6-2 asserts only `res.body?.error?.code === 'wave_member_invalid'` and A6-3 only the code plus `typeof message === 'string'`. A dishonest impl can emit the bare code with a generic message on web/MCP and pass both, violating D5.1's `{actual, cap, cause, role}` payload and the #114 W6 surface-constant law (`{code, message}` byte-identical across surfaces). The CLI surface — the `baton waves start` parse→dispatch→render path and its non-zero exit — is unpinned anywhere. (Note: the A6-3 message check `typeof parsed.error?.message === 'string'` passes on a one-word placeholder; it never compares to the embedded refusal's message.)
- **Fix:** A6-2/A6-3 must assert the same `detail` shape as A6-1 and that `message` is byte-identical to the embedded refusal; add a CLI row driving `baton waves start` with an oversize objective through the full pipeline and asserting typed `body.error` + non-zero exit.

### F5 — HIGH · missing row: `wave_not_found` is pinned only by a spoofable source grep

- **Row:** A6-4 (`src.includes('wave_not_found')`).
- **Attack:** a comment, doc string, or unrelated helper naming the code passes A6-4; the actual F8 behavior — a registry row whose member run no longer resolves refusing typed on the MCP surface (`baton_waves_list`) instead of degrading to `command_outcome_unknown` — is unpinned.
- **Fix:** a behavioral row: create a wave (real start), remove/stop the member run so it no longer resolves, call `baton_waves_list`/`baton_waves_progress`, assert typed `wave_not_found` on MCP *and* web.

### F6 — HIGH · missing row: the registry fold's replay-exactness is never exercised

- **Rows:** A2-4 (named "legacy-store replay") and the A2 contract pin that a fresh-store replay reconstructs the identical registry.
- **Attack:** A2-4 appends a **synthetic** record (`recordDriver('wave.started', {waveId, roster:['alpha','beta'], idempotencyKey}, {key:...})`) to the *live* store and reads live — the genuine `_load`→`_apply` replay over a persisted ledger (`coordination-store.mjs:1412`) is never run. A shallow impl that folds into an in-memory map keyed per-session (never rebuilt from disk) passes A2-4 and A2-1/A2-3. This is exactly the "REAL legacy record" concern: the record must survive a store close/reopen to prove the projection is derived from the ledger, not from the session's append stream.
- **Fix:** a reopen row: append the legacy record, close the store, `new CoordinationStore(sameRoot)`, assert the fold rebuilt the row and `waves.list` renders `{role, route:null, scope:null}` from the replayed ledger.

### F7 — MEDIUM · shallow-greenable: A1-6's card assertions can be special-cased

- **Row:** A1-6.
- **Attack:** asserts only `commands.includes('waves.start')` ×5 dot spellings and `!commands.includes('waves_start')` ×4 underscore spellings. A hardcoded card listing exactly those 5 dot names passes. The contractual *derivation* — the `([, name]) => name` map over `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]` — is unpinned. The current card (`web-northbound.mjs:1453-1460`) derives via `WEB_APPLICATION_ENTRIES.map(([, name]) => name)` at :1459; the suite asserts the derived result but never the derivation source, so a hardcoded card (or one built from a different array) passes.
- **Fix:** a source-read pin (the A4-2/A6-4 idiom) asserting the card line derives via the `([, name]) => name` map over a spread that includes `WAVE_WEB_ENTRIES`; optionally pin the exact command count (25 → 30).

### F8 — MEDIUM · oracle: A1-7 pins a subset, so a length-preserving unrelated swap passes

- **Row:** A1-7.
- **Attack:** asserts length 26 + absence of the five verbs + presence of `waves.attach`. A dishonest impl that swaps an unrelated key (e.g. renames `run.recover` → `run.recoverX`) keeps length 26, keeps the five verbs absent, and passes. The full-set guard lives only in `grammar-m3-red.test.mjs:264` (`deepEqual(Object.keys(...), COMMANDS_BEFORE_M3)`), external to this suite.
- **Fix:** pin the full sorted 26-key set in A1-7 (`deepEqual` against the pinned array) so byte-stability is asserted locally; or document M3-8 as the authority and keep A1-7 as the wave-specific subset (acceptable, but the suite then silently depends on an external file).

### F9 — MEDIUM · missing row: the exactly-once-on-attach leg is untested

- **Row:** none (OQ6 gap).
- **Attack:** `wave.driver_detached` mints at attach (`application.mjs:10889,11441`); `attachWave` binds existing runs. Nothing verifies that attaching to a wave does not duplicate the `wave.started` record or double-list the registry row.
- **Fix:** a row that starts a wave, attaches to it (`BatonClient.waves.attach`), and asserts exactly one `wave.started` record and exactly one registry row.

### F10 — MEDIUM · missing row: the per-member `runId` envelope is never validated on the negative path

- **Row:** none.
- **Attack:** A1-3/A1-4 send a valid `runId` (`'run-a'`); no row sends `waves_send {}` or `waves_send {runId: 'bad id'}` (invalid `validId`) and asserts the typed `application_wave_member_action_invalid` refusal on the facade and web surfaces post-admission. The direct ports (`application.mjs:12329-12332`) return before `validateApplicationCommandArgs` (:12334), so the negative gate is `_normalizeWaveMemberAction` (`application.mjs:11738-11745`) — and no row drives it.
- **Fix:** a row sending `waves_send {}` / `waves_send {runId: 'bad id'}` and asserting `application_wave_member_action_invalid` on the embedded throw and the web body.

### F11 — MEDIUM · missing row: A5-4 is parse-only; render/exit semantics untested

- **Row:** A5-4.
- **Attack:** D4.4/F5 pins the CLI issuing `waves.list`, rendering the attachable set (waveId + member roles), paging ≤16, exit 0. A5-4 only asserts `parseBatonCli(['waves','attach'])` returns `{kind:'command', name:'waves.list', args:{}}`. A CLI whose run-loop still errors after the parse change — or never renders — passes A5-4.
- **Fix:** a row running the CLI parse→dispatch→render pipeline over a host with open rows and asserting the rendered attachable set + exit 0.

### F12 — LOW · oracle: `includes` source-pins can be tripped by incidental text

- **Rows:** A6-4 (false-green on a comment naming `wave_not_found`), A6-5 (false-red if any comment names `wave_registry_invalid`), and by the same idiom A4-2 (`!src.includes("return 'remote'")` — false-green if a dead branch retains the literal).
- **Attack:** file-level `includes` matches substrings anywhere in the file, including comments, dead branches, and diagnostic strings.
- **Fix:** for A6-4 prefer the behavioral row (F5) as the real guard; for A6-5/A4-2 restrict the negative pin to the specific region — e.g. assert the `stateFailureCode` allowlist array does not contain the string, and that the processState function's reachable returns are only the two `unknown`s and the ternary.

### F13 — LOW · under-determined: A2-4's "renders raw" leg and the `wave_not_found` seam interact ambiguously

- **Row:** A2-4.
- **Attack:** legacy members are bare role strings — they have **no** `runId`. The contract's D5.2 seam says a registry row whose member run no longer resolves refuses `wave_not_found`. A legacy member run *never* resolves, so a faithful impl may refuse the whole legacy row's member read on `wave_not_found` — and A2-4 then fails even though the impl is contract-faithful. The contract says legacy rows render `{role, route:null, scope:null}` "and the same live reads" but never defines the no-run member case.
- **Fix:** pin the legacy no-run member read in the contract (e.g. liveness `'local'`, attention/progress `null`, no `wave_not_found` for run-less legacy members) and assert that render in A2-4, removing the ambiguity.

---

## 6. Verdict

**NEEDS-FOLD.** The red side is honest (all 22 rows fail at their named stages, confirmed across two identical runs) and hermetic (per-test stores, no bleed, deterministic split). But the suite cannot serve as the wave-observability acceptance gate until:

1. **F1, F2, F3 are resolved** — they are green-side blockers. A correct implementation of `contract-fold.md` (deploymentId threading, D1 admission, D5.1 facade refusal) leaves the suite red, and the A2-2 PIN's fate is hostage to the validator's treatment of a missing deploymentId. The fixture must construct the deployment host / supply a `deploymentId`, A1-3/A1-4 must target a real run (or assert a typed post-admission refusal), and A6-1 must drive the site the fold actually fixes (or the facade fold must be pinned).
2. **F4–F6, F12 are tightened** — the D5 payload and surface-constancy must be asserted as `{actual, cap, cause, role}` with byte-identical `message` on all three surfaces (including a new CLI leg); `wave_not_found` must get a behavioral row; the registry fold must be proven by a store close/reopen replay, not a live append.
3. **F7–F11, F13 are added or disambiguated** — card derivation, full key-set pinning, exactly-once-on-attach, per-member envelope refusal, CLI render/exit, and the legacy no-run member read.

With those folds, the suite's red-first scaffolding (stage honesty, PIN selection, hermetic isolation, NUL-disciplined citations) is sound and can carry the acceptance gate.
