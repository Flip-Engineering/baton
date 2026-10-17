# SUITE-FOLD-2 — blue-team finding → resolution map (all 13, F1–F13)

Folds `suite-blueteam.md` (NEEDS-FOLD, 13 findings) into `impl/test/wave-observability-red.test.mjs`.
Target: the SUITE's red-keeping power. Three green-side blockers (F1–F3) are fixed so a *correct*
implementation can go green; four shallow-greenability/oracle gaps (F4, F7, F8, F12) are closed so a
*dishonest* one stays red; five missing-row gaps (F5, F6, F9, F10, F11) get rows; the under-determined
assertion (F13) is pinned in contract v1.2 and asserted in A2-4.

Resulting suite: **30 rows — 4 PINs (green at HEAD) + 26 red capability rows** (was 26 = 4 + 22).

| | Row(s) | Resolution |
|---|---|---|
| [F1](#f1--critical--green-side-blocker-the-fixture-never-provides-a-deploymentid) | fixture + A2-1/A2-3/A3-1/A4-1 | `openHost` derives a deploymentId and retries a corrected constructor; the four rows assert the minted value equals the known host id |
| [F2](#f2--critical--green-side-blocker-a1-3a1-4-dispatch-to-a-runid-that-can-never-exist) | A1-3, A1-4 | both rows dispatch to a REAL runId the fixture creates via the direct-port start; A1-3 asserts the typed post-admission 404, A1-4 asserts 200 `ok:true` + narrowed envelope |
| [F3](#f3--high--green-side-blocker-a6-1-drives-the-facade-whose-per-member-swallow-the-d51f6-fix-never-touches) | A6-1 | re-aimed at the DIRECT-PORT `waves.start` — the site D5.1/F6 owns — and asserts the full `{actual, cap, cause, role}` refusal |
| [F4](#f4--high--shallow-greenable-d5-surface-constancy-is-under-asserted) | A6-2, A6-3, A6-6 | A6-2/A6-3 assert the SAME detail shape + byte-identical message as A6-1; NEW CLI leg A6-6 drives `baton waves start --members JSON` → typed `body.error` + non-zero exit |
| [F5](#f5--high--missing-row-wave_not_found-is-pinned-only-by-a-spoofable-source-grep) | A6-4 | behavioral row: synthetic NEW-shape records with THIS deployment's id + a steering.registered ghost runId → `wave_not_found` typed on facade, MCP, web |
| [F6](#f6--high--missing-row-the-registry-folds-replay-exactness-is-never-exercised) | A2-4 | store close/reopen replay — shutdown + `releaseWriterLease` + fresh host over the same logDir, then `waves.list` rebuilt from the ledger |
| [F7](#f7--medium--shallow-greenable-a1-6s-card-assertions-can-be-special-cased) | A1-6 | source pin: the card region derives via `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name)`; runtime dot/underscore checks kept |
| [F8](#f8--medium--oracle-a1-7-pins-a-subset-so-a-length-preserving-unrelated-swap-passes) | A1-7 | full 26-key insertion-order `deepEqual` (grammar-m3 M3-8 literal), local to this suite |
| [F9](#f9--medium--missing-row-the-exactly-once-on-attach-leg-is-untested) | A2-7 | start + attach (same objective) → exactly one `wave.started` and exactly one registry row |
| [F10](#f10--medium--missing-row-the-per-member-runid-envelope-is-never-validated-on-the-negative-path) | A6-7 | `waves.send {}` / `{runId:'bad id'}` → `application_wave_member_action_invalid` on the embedded throw AND the web body |
| [F11](#f11--medium--missing-row-a5-4-is-parse-only-renderexit-semantics-untested) | A5-5 | full CLI parse→dispatch→render over a host with open rows; rendered attachable set + exit-0 semantics |
| [F12](#f12--low--oracle-includes-source-pins-can-be-tripped-by-incidental-text) | A4-2, A6-5, A6-4 | negative pins REGION-RESTRICTED (processState → safeRegular; stateFailureCode → protocolResult); the `wave_not_found` guard is behavioral |
| [F13](#f13--low--under-determined-a2-4s-renders-raw-leg-and-the-wave_not_found-seam-interact-ambiguously) | A2-4 + contract v1.2 (D2.4) | legacy no-run member render pinned: liveness `'local'`, phase/progressClass/attentionCount/route/scope `null`, NO `wave_not_found` |

---

## F1 — CRITICAL · green-side blocker: the fixture never provides a `deploymentId`

**Finding.** `openHost` constructed `new BatonApplication({driver, repoId, profiles, defaults, principals, authorize})` with no deployment id, so a correct F3/D2.2 implementation could never mint the projected record, and a value-checking validator could flip the A2-2 PIN red.

**Resolution.** The fixture now supplies a known deployment id end-to-end:
- `deploymentIdFor(repo, logDir)` derives `deployment-${sha256(`${repo}|${logDir}`).slice(0,32)}` deterministically — the SAME repo+log pair reopens to the SAME id (F6 replay depends on this).
- `buildApplication(driver, deploymentId)` tries `new BatonApplication({...base, deploymentId})` and, on `application_config_invalid` (the HEAD validator rejecting the unknown field — PROBE-verified), falls back to the bare options. Every row is therefore green-side honest at HEAD (all commands function) AND passes the known id to a correct constructor.
- A2-1 asserts `payload.deploymentId === host.deploymentId`, and A2-3/A3-1/A4-1 assert `row.deploymentId === host.deploymentId` — a hardcoded constant cannot pass (F1's second clause).

**Rows:** fixture + A2-1, A2-3, A3-1, A4-1.

## F2 — CRITICAL · green-side blocker: A1-3/A1-4 dispatch to a `runId` that can never exist

**Finding.** The rows sent `waves_send {runId:'run-a'}` / `waves_stop {runId:'run-a'}` into a fixture that had started no member run, so under a correct D1 the round-trip could never hold (404, not 200/ok:true).

**Resolution.** Both rows now dispatch to a REAL runId the fixture actually creates:
- `startWave` (direct-port `application.command('waves.start', {idempotencyKey, members})`) mints the member run at `run-…`; the member stays `awaiting_plan_approval`, so `coordinator.list()` is empty (PROBE-verified) — `sendWaveMember` resolves `application_worker_not_found` exactly as a genuinely missing worker.
- A1-3: web `waves_send` → `404 {code:'not_found'}` — the typed post-admission collapse (web-northbound.mjs:169), never the pre-admission 400.
- A1-4: web `waves_stop` → `200 ok:true` (stopWaveMember uses `_findRun`), plus the narrowed-envelope check — a `waves_stop` carrying `delivery` is refused `unknown_argument_field`.

**Rows:** A1-3, A1-4.

## F3 — HIGH · green-side blocker: A6-1 drives the facade, whose per-member swallow the D5.1/F6 fix never touches

**Finding.** `BatonClient.waves.start` binds `createWave` (per-member try/catch swallow at wave.mjs:195-209); the D5.1 wrap lives in `application.startWave`. The facade never reaches the fold site, so a correct fold left A6-1 red, and a shallow impl fixing only `startWave` passed everything.

**Resolution.** A6-1 now drives the DIRECT-PORT path — `host.application.command('waves.start', {idempotencyKey, members: [memberExact('alpha', BIG_OBJECTIVE)]}, principal)` — the exact site D5.1/F6 owns. At HEAD the direct port rejects with a RAW `spill_body_exceeded` (PROBE-verified, no role/cause/detail); the fold wraps it into `wave_member_invalid` with message `'wave member alpha did not start'` and `detail {actual, cap, cause, role}`. A2-1 (record-shape) rides the same direct-port start to prove a well-formed start still mints.

**Row:** A6-1 (facade swallow left untouched by design).

## F4 — HIGH · shallow-greenable: D5 surface-constancy is under-asserted — the CLI leg has no row

**Finding.** A6-2/A6-3 checked only the code; a dishonest impl could emit the bare code with a generic message and pass, violating D5.1's `{actual, cap, cause, role}` payload and the #114 W6 surface-constant law.

**Resolution.** The D5.1 payload and message are now asserted on all three surfaces:
- A6-1 (facade/direct port): full `{actual, cap, cause: {code: 'spill_body_exceeded'}, role}` and message `'wave member alpha did not start'`.
- A6-2 (web body): `error.code === 'wave_member_invalid'`, `error.message` byte-identical, `error.detail ?? error` carries the same `{actual, cap, cause, role}`.
- A6-3 (MCP): `parsed.error.code/message/detail` byte-identical, never degrading to `command_outcome_unknown`.
- **A6-6 (NEW CLI leg)**: `parseBatonCli(['waves','start','--members', JSON.stringify(members)])` compiles to `waves.start` with the members payload, then `runBatonCli` over the bindBaton-shaped routing client refuses `wave_member_invalid` with the byte-identical message/detail; the exit derivation (`cli_*` → 2, outcome refusals → 1) is asserted non-zero.

**Rows:** A6-1, A6-2, A6-3, A6-6.

## F5 — HIGH · missing row: `wave_not_found` is pinned only by a spoofable source grep

**Finding.** A6-4 was `src.includes('wave_not_found')`; the real F8 behavior was unpinned.

**Resolution.** A6-4 is now behavioral. It records synthetic NEW-shape rows carrying THIS deployment's id (a foreign `deploymentId` row is dropped by D3.1 and the seam never fires):
- `wave.started` for a ghost wave with `deploymentId: host.deploymentId`, a member-object roster, and an idempotency key;
- `steering.registered` binding `waveRole: 'alpha'` to a ghost `runId` that no longer resolves.
Then the per-member live read refuses `wave_not_found` on the facade (`waves.list`), MCP (`baton_waves_list` → typed error, not `command_outcome_unknown`), and web (`waves_list` → `404` with the typed code). The source-pin negative is dropped entirely (see F12).

**Row:** A6-4.

## F6 — HIGH · missing row: the registry fold's replay-exactness is never exercised

**Finding.** A2-4 appended a synthetic record to the LIVE store and read live; a shallow in-memory fold passed.

**Resolution.** A2-4 now proves the fold by a store close/reopen REPLAY: append the legacy record (PROBE-verified `ok:true` at HEAD) → `application.shutdown` → `releaseWriterLease` (caught) → `createDriverFor` + `buildApplication` over the SAME `logDir` → the reopened `waves.list` rebuilds the row from the ledger. The row's legacy leg then asserts the F13 render (below).

**Row:** A2-4.

## F7 — MEDIUM · shallow-greenable: A1-6's card assertions can be special-cased

**Finding.** A hardcoded card listing exactly the 5 dot names passed; the derivation source was unpinned.

**Resolution.** A1-6 adds a source pin over the card region (`pathname === '/v1/application-card'` → `const asset = operatorAsset(pathname)`): the region must carry the derive idiom `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name)` (web-northbound.mjs:1458 maps `WEB_APPLICATION_ENTRIES` only at HEAD). The runtime dot/underscore checks are kept, including the negative spellings.

**Row:** A1-6.

## F8 — MEDIUM · oracle: A1-7 pins a subset, so a length-preserving unrelated swap passes

**Finding.** A length-26 + absence-of-verbs check let a length-preserving unrelated key swap pass; the full-set guard lived only in grammar-m3.

**Resolution.** A1-7 now `deepEqual`s `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` against the FULL 26-key insertion-order set (the grammar-m3 `COMMANDS_BEFORE_M3` literal, in ACTUAL order), locally — a swap or reorder breaks the PIN. It keeps the negative check (the five wave verbs are never table entries) and `waves.attach` stays the one table row.

**Row:** A1-7 (PIN).

## F9 — MEDIUM · missing row: the exactly-once-on-attach leg is untested

**Finding.** Nothing verified that attaching to a wave does not duplicate `wave.started` or double-list the registry row.

**Resolution.** A2-7 starts a wave through the facade, then attaches to it with `BatonClient.waves.attach(started.waveId, [member('alpha', objective)])` — `attachWave` binds existing runs by OBJECTIVE (wave.mjs:268-274), so the SAME objective is required. It asserts exactly one `wave.started` record and exactly one registry row for the wave. (A `driver_detached` assertion is deliberately NOT made — at HEAD `driver_detached` mints 0 on this path, and the finding only requires the exactly-once legs.)

**Row:** A2-7.

## F10 — MEDIUM · missing row: the per-member `runId` envelope is never validated on the negative path

**Finding.** No row drove `_normalizeWaveMemberAction` (application.mjs:11738-11745) on `waves_send {}` / `{runId: 'bad id'}`.

**Resolution.** A6-7 sends both negative envelopes to the direct port (typed `application_wave_member_action_invalid` on the embedded throw) and `{}` through the web body post-admission (the typed code survives `dispatchFailure`, never the pre-admission 400). Green at HEAD on the facade (PROBE-verified), red on the web at `web-admission-missing`.

**Row:** A6-7.

## F11 — MEDIUM · missing row: A5-4 is parse-only; render/exit semantics untested

**Finding.** A CLI whose run-loop still errors after the parse change — or never renders — passed A5-4.

**Resolution.** A5-5 runs the FULL pipeline: `parseBatonCli(['waves','attach'])` (issued `waves.list`, F5 shape) → `runBatonCli(parsed, cliRoutingClient(host))` over a host with open rows → the rendered result passes through unchanged (projectBatonCliResult:1019 — no compact projection for non-run-view commands), surfacing the attachable set (waveId + member roles); a resolved command exits 0 (baton.mjs:128-131).

**Row:** A5-5.

## F12 — LOW · oracle: `includes` source-pins can be tripped by incidental text

**Finding.** File-level `includes` matched comments/dead branches — false-green on A4-2, false-red on A6-5, spoofable on A6-4.

**Resolution.** Every remaining source pin is REGION-RESTRICTED:
- A4-2: slice `processState(` → `safeRegular(`; asserts no `'remote'` literal in the function, exactly 2 `return 'unknown'`, exactly 1 `return 'stale'`, and the exact ternary `observed === expectedStart ? 'active' : 'stale'`.
- A6-5: slice `stateFailureCode(` → `protocolResult(`; asserts the allowlist array never contains the quoted literal `'wave_registry_invalid'` (the contract v1.2 note tells the implementer to keep such a comment OUT of the function).
- A6-4: the `wave_not_found` guard is behavioral (F5), not a source read.

**Rows:** A4-2 (PIN), A6-5 (PIN), A6-4.

## F13 — LOW · under-determined: A2-4's "renders raw" leg and the `wave_not_found` seam interact ambiguously

**Finding.** Legacy members are bare role strings with NO runId; the D5.2 seam says a member run that no longer resolves refuses `wave_not_found` — a faithful impl might refuse the whole legacy row.

**Resolution.** Contract v1.2 adds **D2.4** (legacy no-run member render): a run-less legacy member reads `liveness: 'local'`, `phase`/`progressClass`/`attentionCount` `null`, `route`/`scope` `null`, and NEVER refuses `wave_not_found` (the D5.2 seam only fires for a member whose run WAS registered and then disappeared). A2-4 asserts exactly that render on the reopened row.

**Row:** A2-4 (+ contract v1.2 D2.4).
