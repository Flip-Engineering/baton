# #157 CONTRACT v1.1 (FOLDED) — CLI wave ghosts + interpreter-wave registry fidelity

- **Issue:** #157 — two surface-honesty defects in one lane.
- **Version:** v1.1 — folds the #157 red-team report (`contract-redteam.md`, verdict **NOT
  FOLD-READY**, one numbered blocker) into contract v1 (`cli-wave-fidelity-contract.md`). The
  blocker's concrete fix and every non-blocking minor (N1–N7, F1) are folded in below; everything
  the red-team verdict'd **SOUND** is held byte-stable in substance.
- **Date:** 2026-08-13.
- **Base provenance:** the v1 header's base line (`master` @ `baton/ws-9486fb64ea7454173244299de3fe4cfd`
  worktree, HEAD `ada515d`) is **stale drafting metadata** — that worktree does not exist in this
  deployment tree. No citation depends on it. Every working-tree citation below was re-verified at
  the **current HEAD** (`88aa98177d2f0344e8e43a7c6d889a806552ca85`) with `grep -an`/`sed -n`
  (NUL-bearing files `application.mjs` + `coordination-store.mjs` — 3 NUL bytes each — read with
  `grep -a`); the runtime claims were executed, not inferred (see Section 0 red baseline).
- **Briefs:** `contract-157-brief.md`, `redteam-157-brief.md`, `contract-fold-brief.md`.
- **Deliverable:** this fold, `docs/reference/evidence/cli-wave-fidelity-2026-08-13/contract-fold.md`.
- **Laws:** no clocks; every citation re-verified at the current HEAD (NUL discipline on
  `application.mjs` + `coordination-store.mjs`); sorted-key literals in ACTUAL sorted order;
  `localeCompare` never used.

---

## Fold map

| Finding | Resolution | Where in v1.1 |
|---|---|---|
| **Blocker 1** — the refusal-vocabulary row `cli_config_unavailable` @ `application-cli.mjs:2013` is a wrong citation: that line throws `cli_command_unavailable` (message `unsupported Run command ${name}`), and the code `cli_config_unavailable` exists nowhere in the repo (repo-wide `.mjs`/`.md`/`.json` grep). An implementer asserting the table — or writing the A7-6 D3 admission leg against it — tests a code that can never fire. | Row code corrected to `cli_command_unavailable`; actual message noted; the D3 admission side is told explicitly not to assert a `cli_config_*` code. | §Refusal vocabulary (row 4); §D3.2 leg (3) note |
| **F1 (mirror of Blocker 1)** — the D3.2 admission leg / D3.3 "pre-existing web-client refusal" point at `application-cli.mjs:2013` with the same wrong code label; the admission assertion itself is sound. | The `:2013` seam's code and message are stated once, so no admission test targets a non-firing code. | §D3.2 leg (3) note |
| **N1** — D1.2(1) cites `:1346-1348`/`:1391-1393` as "the same `id()` helper"; those lines are the direct `/^wave:[a-f0-9]{32}$/u` checks, not the helper. The helper lives at `application-cli.mjs:100-103` (used by `waves.attach` at `:1386`). RunId-validation intent is otherwise correct (`id()` matches `validId`, `application.mjs:316`; the schema's `runId: id` is a plain id, not the wave pattern). | Citation corrected to the helper at `application-cli.mjs:100-103`, used at `:1386`. | §D1.2(1) |
| **N2** — header base-worktree/HEAD provenance is stale. | Provenance relabeled drafting metadata; every citation re-verified at the current HEAD. | Header |
| **N3** — after hydration, the string branch draws `run.inspect` — including its authorization — and inherits the D5.2 seam: a steering-registered string member whose run vanished now refuses `wave_not_found` instead of rendering silent nulls. Deliberate parity; must not be "safeguarded" back. Breaks no existing pin (A2-4's members have no steering record). | Explicit D5.2-seam sentence added to the hydration point. | §D2.3 |
| **N4** — A7-8's "renders **non-null**" overstates: the law renders `view?.phase ?? view?.outline?.phase ?? null`, legitimately null for a freshly-started run before any outline exists. The comparative clause ("identical to a driver-wave member") is the real law. | A7-8 rephrased as "identical to a driver-wave member driven to the same state"; the test must drive both members to a phase-bearing state. | §A7-8 |
| **N5** — the D3 pin is lane-scoped and one-directional; the reverse ghost (a `CLI_WEB_COMMANDS` entry with no registry row or parse branch) passes the pin. Deliberate closed-set scope, not a #157 gap. | Reverse-ghost direction recorded as a deliberate out-of-scope. | §D3.3 |
| **N6** — the D3 parse-acceptance leg needs per-verb minimal valid args (`waves.progress` a waveId, `waves.run` a specPath, `waves.send` runId+`--message`, `waves.stop` runId+`--reason`) because `parseBatonCli` rejects arg-less invocations for value-taking verbs. The contract must pin how each verb's minimal invocation is built, so the implementer does not hardcode a per-key arg table by hand. | Parse-leg construction rule pinned, derived mechanically from each schema's required set. | §D3.3 |
| **N7** — A7-5 couples to the `--check` drift gate: green only after D1.2(2) whitelist admission **and** D1.2(4) doc regeneration land together. | Sequencing note added; both must land in one change set. | §A7-5, §Verification |
| **§4 drift** — the D3 pin is new conformance logic in `surface-conformance.mjs`; it makes the conformance gate RED at HEAD until D1 lands, so any CI running the gate blocks until D1+D3 land together. The contract must state the coupling so the implementer does not split the pin into a separate green-only change. | Coupling stated explicitly; also notes the A7 rows add no new tool/registry row, so the #132 surface-inventory drift does not recur. | §Verification |

---

## 0. The two defects, restated

**(a) CLI ghost rows.** `waves.send` / `waves.stop` are registered on the `cli` surface
(`application-semantics.mjs:1599-1621`) and served on web + MCP
(`web-northbound.mjs:37-61`, `mcp-northbound.mjs:100-101`), but the CLI parser refuses both.
Live probe at HEAD (re-run at the fold HEAD, byte-identical to the contract's red baseline):

```
baton waves send run-a --message hi  =>  cli_command_unavailable: expected waves list, progress, start, attach, or run
baton waves stop run-a --reason done =>  cli_command_unavailable: expected waves list, progress, start, attach, or run
```

**(b) Interpreter-wave registry under-report.** `waves list` renders interpreter-run
(`waves.run`) wave members with `phase: null, progressClass: null, attentionCount: null`
even though the member runs exist and are steering-registered in the same store; driver-launched
waves project live phase/progressClass. Observed live on the #147 wave.

The two defects share a shape: the registry/`waves list` projection claims more than the
reader/hydration honors. D1 fixes the CLI claim; D2 fixes the registry projection; D3 makes a
recurrence of the CLI half of the class impossible.

---

## D1 — the CLI wave verbs, complete

### D1.1 Red baseline (verified)

- The `waves` branch handles `run | list | progress | start | attach` only
  (`application-cli.mjs:1323-1416`). Everything else falls to the closed-set refusal:
  `if (action !== 'attach') throw cliError('expected waves list, progress, start, attach, or run', 'cli_command_unavailable')` at `application-cli.mjs:1383-1384`.
- The dispatch whitelist `CLI_WEB_COMMANDS` (`application-cli.mjs:16-32`) contains
  `waves.attach, waves.list, waves.progress, waves.run, waves.start` — **not** `waves.send`,
  `waves.stop`. This matters twice: `BatonWebClient.command` refuses any name outside the
  whitelist (`application-cli.mjs:2013`) *before* mapping `name.replaceAll('.', '_')`
  (`application-cli.mjs:2015`), so the whitelist is the admit seam for D1, not the parser alone.
- The registry input schemas **already exist** and already claim the `cli` surface
  (`application-semantics.mjs`):
  - `waves.send` (`:1599-1613`): `{ runId, message, delivery ∈ ['nudge','now','turn'], claimGrant }`,
    required `['runId','message']`, example `baton waves send RUN_ID --message TEXT`.
  - `waves.stop` (`:1614-1621`): `{ runId, reason }`, required `['runId']`, `destructive: true`,
    example `baton waves stop RUN_ID --reason TEXT`.
- The web wire for both already exists: `WAVE_WEB_ENTRIES` has `waves_send`
  (`web-northbound.mjs:40`) and `waves_stop` (`web-northbound.mjs:41`); `WAVE_ARG_FIELDS`
  (`web-northbound.mjs:54-61`) carries `waves_send: {claimGrant, delivery, message, runId}` and
  `waves_stop: {reason, runId}`. MCP tools `baton_waves_send`/`baton_waves_stop` exist
  (`mcp-northbound.mjs:100-101`). The application dispatch for both exists:
  `waves.send → sendWaveMember` (`application.mjs:11840-11893`),
  `waves.stop → stopWaveMember` (`application.mjs:11895-11902`); dispatch table at
  `application.mjs:12560-12569`. **No server-side work is needed for D1** — only the CLI parse
  layer and the generated doc.

### D1.2 The change set (complete)

1. **Add the two parse branches** inside the `waves` block (`application-cli.mjs:1323-1416`),
   before the closed-set refusal. The parse must consume the closed schema shapes and emit the
   ordinary `{kind:'command', command, name, args, idempotencyKey}` shape that `runBatonCli`
   dispatches (`application-cli.mjs:2211-2228` → `client.command(parsed.name, parsed.args, …)`),
   matching the `waves.start` branch idiom (`application-cli.mjs:1372-1376`):

   - `baton waves send RUN_ID --message TEXT [--nudge|--now|--turn] [--claim-grant JSON]`
     → `{ kind: 'command', command: 'waves.send', name: 'waves.send',
         args: { runId, message, ...(delivery ? { delivery } : {}), ...(claimGrant ? { claimGrant } : {}) },
         idempotencyKey }`
     - `runId` positionally, validated with the `id()` helper (`application-cli.mjs:100-103` —
       the same helper `waves.attach` uses at `:1386`). The helper matches the schema's
       `runId: id` (a plain id — not the `/^wave:[a-f0-9]{32}$/u` wave pattern the
       `progress`/`attach` branches check directly at `:1346-1348`/`:1391-1393`).
     - `--message TEXT` required (mirror `--members` required-take at `:1363-1365`).
     - Delivery mode flags `--nudge|--now|--turn` → `delivery`, at most one — copy the
       `run send` idiom verbatim (`application-cli.mjs:1733-1738`: bounded modes, refuse when
       `modes.length > 1`).
     - `--claim-grant JSON` optional, parsed like `--members JSON` (`application-cli.mjs:1363-1371`);
       refusal on non-JSON. (Open question 3.)
   - `baton waves stop RUN_ID --reason TEXT`
     → `{ kind: 'command', command: 'waves.stop', name: 'waves.stop',
         args: { runId, reason }, idempotencyKey }`
     - `runId` positional; `--reason TEXT` **required** — the dispatcher already requires it
       (`_normalizeWaveMemberAction(…, 'wave stop', { reason: true })` at
       `application.mjs:11900`, guard at `application.mjs:11967-11968`), so the CLI must refuse
       early with `cli_action_inputs_invalid` rather than surface a server refusal. (Open
       question 1.)

2. **Admit the two names to `CLI_WEB_COMMANDS`** (`application-cli.mjs:16-32`). This is
   mandatory: without it the parsed command never reaches the transport (`application-cli.mjs:2013`).

3. **Update the closed-set refusal text** (`application-cli.mjs:1383-1384`) to
   `'expected waves list, progress, start, send, stop, attach, or run'` — same code
   `cli_command_unavailable`, same throw site. The singular `wave` corrective
   (`application-cli.mjs:1314-1322`) already names `send`/`stop` in `pluralCorrective`
   (`:1316`), so it needs no change.

4. **Regenerate `impl/CLI.md`** with `node impl/scripts/render-surface-docs.mjs` — never
   hand-edit (#142). Verified: `deriveSurfaceNames('waves.send').cli === 'baton waves send'` and
   the registry examples yield the two new rows in the generated block:

   ```
   | `waves.send` | `ordinary` | `baton waves send` | `baton waves send RUN_ID --message TEXT` |
   | `waves.stop` | `ordinary` | `baton waves stop` | `baton waves stop RUN_ID --reason TEXT` |
   ```

   Today `servedCliOrdinaryKeys()` (`render-surface-docs.mjs:34-75`) emits the `waves.` subset
   `attach, list, progress, run, start` only (in `servedCliOrdinaryKeys`' own `.sort()` order) —
   the ghost is currently invisible to the generated doc. D1.2(2) + this step makes the rows
   emit; the `--check` flag (`render-surface-docs.mjs:8`) is the drift gate.

### D1.3 Why this is complete

The schema (D1.2 input shape), the web transport (`waves_send`/`waves_stop`), the MCP tools,
the application dispatch, and the register-decision are all pre-existing. D1 only (1) parses two
already-specified verbs, (2) admits them to the one whitelist that gates CLI dispatch, (3) fixes
the closed-set refusal that must now name them, and (4) regenerates the doc row. Nothing else
moves.

---

## D2 — the registry fidelity law

### D2.1 The defect chain (verified end to end)

1. Interpreter lane: `runWorkflow` (`workflow-interpreter.mjs:483-618`) calls
   `baton.waves.start({ members: rendered, … })` at `:534`.
2. The embedded facade's `start` is `createWave` (`application-client.mjs:1555`), which mints a
   **role-only string roster**: `const roster = members.map((member) => member.role);`
   (`wave.mjs:180`).
3. Each member's `runs.start` carries `waveId, waveRole, waveStart` (`wave.mjs:202-206`),
   minting (a) the `steering.registered` record — `APPLICATION_STEERING_REGISTERED_KIND =
   'steering.registered'` (`application.mjs:135`), recorded at `application.mjs:4654-4667` with
   `{runId, driverKind, waveId, waveRole, route}` — and (b) the pre-loop `wave.started` record
   whose roster is the string array (legacy `idempotencyKey,roster` waveStart pair, accepted at
   `application.mjs:1525-1532`).
4. The registry fold stores the raw string array: `coordination-store.mjs:8099-8123` accepts a
   well-formed string-array or object-array roster (`:8108-8114`) and keeps `[...roster]`
   (`:8118`). `wave_registry_invalid` (`:8113`) is reserved for genuinely malformed NEW-shape
   records — a string roster is legal, not corrupt.
5. `waveList` (`application.mjs:11759-11822`) string-member branch (`:11776-11788`) recovers the
   seat map from the steering record — `route` is already resolved via
   `_runWaveRoute(_runIdForWaveMember(row.waveId, member))` (`:11782`; Issue #74, comment
   `:11779-11781`) — **but hardcodes `phase: null, progressClass: null, attentionCount: null`**
   (`:11785`).
6. Driver waves take the direct port `waves.start → startWave` (`application.mjs:11648-11697`),
   which mints the D2.2 **object roster** `[{role, route, scope}]` (`:11661-11665`) and rides
   `waveStart: { deploymentId, roster, idempotencyKey }` (`:11679`). Their members hit the
   object-member branch (`:11789-11809`), which `inspect`s the live run (`:11794`) and renders
   live `phase`/`progressClass`/`attentionCount` (`:11806-11808`), refusing typed
   `wave_not_found` when a registered run vanished (`:11796-11799`, the D5.2 seam).

Net: interpreter members are steering-registered exactly like driver members, but the string
branch never looks at the resolved run for phase/progress — the projection under-reports by
construction.

### D2.2 The law

> **An interpreter-run wave's members project `phase`, `progressClass`, and `attentionCount`
> identically to driver-launched wave members. The member runs exist in the same store (the
> `steering.registered` record binds runId ↔ waveId/waveRole/route for both paths —
> `application.mjs:4654-4667`); the projection must read them.**

The answer the brief invites ("project them") is correct: there is no honesty reason to show
nulls for a member whose run is live and inspectable. The registry row stores a bare role, but
`_runIdForWaveMember` (`application.mjs:11826-11836`) resolves the run for BOTH shapes — the
object branch already proves the read works. The interpreter seam is not a reason to under-report;
it is exactly the reason the string branch was written, and now the seat-map recovery (route) and
the phase/progress hydration must sit side by side.

### D2.3 The hydration point (pinned)

**Hydration happens in the `waveList` string-member branch, `application.mjs:11776-11788`.**

When `_runIdForWaveMember(row.waveId, member)` resolves a runId (i.e. the member is
steering-registered — the interpreter's case, and any driver wave that was minted with a legacy
string roster), the branch must `inspect` that run exactly as the object branch does
(`:11792-11801`) and render:

- `phase: view?.phase ?? view?.outline?.phase ?? null`
- `progressClass: view?.progressClass ?? view?.outline?.progressClass ?? null`
- `attentionCount: Array.isArray(view?.attention) ? view.attention.length : 0`

(i.e. the object-branch render expressions at `:11806-11808`, plus its `attention` computation
at `:11802`), keeping the recovered `route` (`:11782`) and the existing `role`,
`liveness: 'local'`, `scope: null` fields.

**The hydrated string read carries the D5.2 seam (N3).** Drawing `run.inspect` — including its
authorization — means a steering-registered string member whose run has vanished now refuses
typed `wave_not_found` exactly as the object branch does (`application.mjs:11796-11799`), never
a silent null render. This is deliberate parity with the object branch; the implementer must NOT
"safeguard" the hydrated string branch back to silent nulls. It breaks no existing pin — A2-4's
members have no steering record, so the no-run branch below still fires for them.

**When `_runIdForWaveMember` returns null** (a genuinely run-less legacy member — no steering
record), keep the pinned no-run render verbatim: `route: null, scope: null, liveness: 'local',
phase: null, progressClass: null, attentionCount: null`, no `error` key. This is the F13
contract and must not move.

### D2.4 F13 preservation (the D2 boundary)

The D2 fix must not touch the legacy no-run read. The pin is A2-4
(`impl/test/wave-observability-red.test.mjs:667-706`): a `wave.started` record written with
`roster: ['alpha', 'beta']` and **no** steering registration replays through a store
close/reopen and renders each member with `route: null, scope: null, liveness: 'local',
phase: null, progressClass: null, attentionCount: null` and no `error` key
(`:693-705`). Because those members have no `steering.registered` record,
`_runIdForWaveMember` returns null after the fix, so the no-run branch (`D2.3` second
paragraph) still fires. A2-4 stays green. The D2 implementation must add a row (A7-8, below)
that exercises the *opposite* case — a steering-registered interpreter member — which is the
RED case at HEAD.

### D2.5 Why the projection can legitimately show nulls (the honest remainder)

The only members that keep null phase/progress are members whose run was never steering-registered
(no run exists in this store) — the no-run branch pinned by A2-4 — or, transiently, members whose
runs are still mid-start (honest, and identical to driver waves in the same state). There is no
"the interpreter can't tell us" case: the steering record is the durable referent the whole
`waveList` read already trusts for `route`. `_runIdForWaveMember` scans the full event log, so
the steering record is found even if minted after the registry fold; there is no ordering hole.

---

## D3 — the ghost-prevention pin

### D3.1 The gap (verified)

`servedCliOrdinaryKeys()` (`render-surface-docs.mjs:34-75`) derives the served inventory **from
`CLI_WEB_COMMANDS`** (`:42-52`). `checkProfileDocParity` (`surface-conformance.mjs:495-545`)
compares the CLI.md generated block against `cliOrdinaryKeys()`, which **is** the served
inventory (`surface-conformance.mjs:374-376`). Because the docs and the served set both derive
from the same whitelist, a registry row claiming `cli` surface but absent from the whitelist is
invisible to *both* sides of the parity check — the ghost passes through. The registry claim
(`surfaces.includes('cli')`) is never checked against the whitelist. Verified at HEAD:
`servedCliOrdinaryKeys()` emits `waves.attach/list/progress/run/start`, and the registry claims
`cli` for `waves.send`/`waves.stop` too — no conformance signal fires (`render-surface-docs.mjs
--check` exits 0 at HEAD).

### D3.2 The invariant (#159 doctrine, CLI instance)

The three-way invariant for the wave lane (closed set):

1. **Documented** — the operation key appears in the CLI.md generated block (equivalently, in
   `servedCliOrdinaryKeys()`).
2. **Parsed** — `parseBatonCli` accepts the verb named by the registry's `deriveSurfaceNames(key)
   .cli` and returns `{ kind: 'command', command: <key>, name: <key> }`.
3. **Admitted/dispatched** — `<key> ∈ CLI_WEB_COMMANDS`, and the transport name
   (`name.replaceAll('.', '_')`, `application-cli.mjs:2015`) resolves in
   `WAVE_WEB_ENTRIES ∪` the table-registered attach set (`web-northbound.mjs:37-47`).

**Documented ⇄ Parsed ⇄ Admitted.** All three must hold, and each pair must be checked by an
independent assertion — never derived from the same source on both sides.

> **Admission-side code (F1).** The admit seam at `application-cli.mjs:2013` throws
> `cli_command_unavailable` with message `unsupported Run command ${name}` — there is no
> `cli_config_*` code at that site. The D3 admission assertion must not test for a code that can
> never fire; the leg's assertion is the whitelist membership itself (`CLI_WEB_COMMANDS.has(key)`),
> and the pre-existing web-client refusal is its backstop, coded `cli_command_unavailable`.

### D3.3 The pin (what to add)

Add to the conformance layer (`surface-conformance.mjs`, alongside `checkProfileDocParity` — or
as a closed-set prelude to it):

> **Closed-set registry-claim pin.** For every canonical operation with
> `surfaces.includes('cli')` and `key.startsWith('waves.')`: assert
> `CLI_WEB_COMMANDS.has(key)` (admission) AND `parseBatonCli` accepts the registry-named CLI verb
> into `{ command: key }` (parse) AND the emitted CLI.md generated block contains the row
> (documented).

This single assertion is RED at HEAD (send/stop are claimed but unadmitted, unparsed,
undocumented) and GREEN only after D1 lands. It is the mechanical guard that the ghost class
cannot recur in the wave lane: any future registry row claiming `cli` must be parseable,
whitelisted, and documented, or the conformance gate fails.

**Parse-leg construction (N6).** `parseBatonCli` rejects arg-less invocations for value-taking
verbs, so the parse-acceptance leg must drive each verb with a minimal valid invocation — built
mechanically from the registry schema's required set, never a hand-arg table:

- a required positional id rides argv positionally: `runId` for `waves.send`/`waves.stop`,
  `waveId` for `waves.attach`/`waves.progress`, `specPath` for `waves.run`;
- each remaining schema-required field rides a flag: `--message TEXT` (send), `--reason TEXT`
  (stop), `--members JSON` with `[]` as the empty-minimum (start/attach);
- a verb whose schema requires nothing (`waves.list`) is bare.

Assert `parseBatonCli(argv)` returns `{ kind: 'command', command: <key>, name: <key> }` for each
closed-set verb. (The closed set at HEAD is exactly `waves.attach, waves.start, waves.progress,
waves.send, waves.stop, waves.list, waves.run` — derived from `APPLICATION_SEMANTIC_REGISTRY
.canonicalOperations` filtered by `surfaces.includes('cli') && key.startsWith('waves.')`.)

**Scope (N5).** The pin is lane-scoped and one-directional — a registry `cli` claim must be
whitelisted, parsed, and documented. The reverse ghost (a `CLI_WEB_COMMANDS` entry with no
registry row and no parse branch) is **not** covered and would pass. That direction is a
deliberate closed-set scope per D3.2, not a #157 gap; a two-way pin would be the fuller #159
doctrine — a future extension, not this contract.

This is the CLI instance of the #159 conformance doctrine (doc-truth ↔ admission), applied to
the wave lane. See the campaign siblings:
`docs/reference/evidence/doc-truth-conformance-2026-08-13/contract-159-brief.md` (three-way
invariant) and `docs/reference/evidence/cli-silent-start-2026-08-13/contract-155-brief.md`
(CLI refusal form).

---

## Refusal vocabulary

| Code | Site | Meaning / message |
|---|---|---|
| `cli_command_unavailable` | `application-cli.mjs:1383-1384` (closed-set refusal, updated by D1.2(3)) | `expected waves list, progress, start, send, stop, attach, or run` — the corrected closed set. Also the singular `wave` corrective (`:1314-1322`, unchanged — already names send/stop). |
| `cli_action_inputs_invalid` | new send/stop parse branches (D1.2(1)); existing `run.act` at `application-cli.mjs:1696-1697` | Malformed/missing fields at the CLI layer: `waves send` without `--message`, `waves stop` without `--reason`, two delivery flags, non-JSON `--claim-grant`/`--members`. |
| `cli_invalid` | `id()` helper (`application-cli.mjs:100-103`, the default `cliError` code — `cliError(message, code = 'cli_invalid')` at `:50`) | A positional id (runId) that is not a valid id. |
| `cli_command_unavailable` | `application-cli.mjs:2013` (pre-existing web-client refusal, the D3 admission side — unchanged) | A parsed name that still falls outside `CLI_WEB_COMMANDS`. Message: `unsupported Run command ${name}`. |

> **Blocker 1, folded.** The v1 row claimed `cli_config_unavailable` at `application-cli.mjs:2013`;
> that line throws `cli_command_unavailable` (`unsupported Run command ${name}`), and
> `cli_config_unavailable` does not exist anywhere in the repo (repo-wide `.mjs`/`.md`/`.json`
> grep). The row is corrected above; no implementer writes an assertion for a code that can never
> fire.

---

## Red-first acceptance pins

Idiom: `impl/test/wave-observability-red.test.mjs` — red rows fail for a named stage at HEAD and
are green only for the correct implementation (never pin green to a wrong-but-passing impl).
New rows in the wave-observability suite (or a sibling `cli-wave-fidelity-red.test.mjs`):

| Row | Stage | Assertion (RED at HEAD → GREEN after D1/D2/D3) |
|---|---|---|
| **A7-1** | parse | `baton waves send run:foo --message hi` parses to `{ command: 'waves.send', args: { runId, message: 'hi' } }`. RED: currently `cli_command_unavailable` (`application-cli.mjs:1383-1384`). |
| **A7-2** | parse | `baton waves send run:foo --message hi --now` → `args.delivery === 'now'`; two delivery flags refuse `cli_action_inputs_invalid` (mirror `run send`, `application-cli.mjs:1733-1738`). |
| **A7-3** | parse | `baton waves stop run:foo --reason done` parses to `{ command: 'waves.stop', args: { runId, reason: 'done' } }`; `waves stop run:foo` (no `--reason`) refuses `cli_action_inputs_invalid`. RED at HEAD. |
| **A7-4** | admit | `CLI_WEB_COMMANDS` contains `waves.send` and `waves.stop` (else `BatonWebClient.command` refuses at `application-cli.mjs:2013`). RED at HEAD. |
| **A7-5** | doc | `render-surface-docs.mjs --check` passes and the CLI.md generated block contains both rows. RED at HEAD (ghost rows absent). **Sequencing (N7):** green only after D1.2(2) whitelist admission **and** D1.2(4) doc regeneration land together — land both in one change set or this pin red-flags mid-flight. |
| **A7-6** | D3 closed-set | Every `waves.*` canonical operation with `surfaces.includes('cli')` is in `CLI_WEB_COMMANDS` and parses to `{ command: <key> }` (per-verb minimal invocation per D3.3, N6). RED at HEAD. |
| **A7-7** | dispatch leg | The parsed `waves.send`/`waves.stop` names map through `name.replaceAll('.', '_')` to `waves_send`/`waves_stop` ∈ `WAVE_WEB_ENTRIES` (`web-northbound.mjs:40-41`), and a full parse → dispatch → transport round-trip reaches `sendWaveMember`/`stopWaveMember`. |
| **A7-8** | D2 | An interpreter-wave member (driven through `runWorkflow` → `createWave`, `wave.mjs:180`) renders `phase`/`progressClass`/`attentionCount` in `waves list` **identical to a driver-wave member driven to the same state**. The law renders `view?.phase ?? view?.outline?.phase ?? null` (`application.mjs:11806-11808`) — legitimately null for a freshly-started run before any outline exists — so the test must drive both members to a phase-bearing state rather than assert absolute non-nullness (N4). RED at HEAD. |

**Must stay green (the D2 boundary and the existing parity rows):**

- **A2-4 F6/F13** (`wave-observability-red.test.mjs:667-706`) — legacy string-array roster with
  no steering record keeps `route/scope null`, `liveness 'local'`, `phase/progressClass/
  attentionCount null`, no `error` key. D2.3's no-run branch preserves this verbatim.
- **A2-5** (`:708-723`) — malformed NEW-shape roster still refuses `wave_registry_invalid` via the
  poisoned projection (`coordination-store.mjs:8099-8123`).
- **A5-1..A5-5** (`:852-904`) — `waves list`/`waves progress` parse, singular `wave` corrective,
  bare-attach → `waves.list`, and the full parse→dispatch→render pipeline. Unchanged by D1.
- **A6-6** (`:1036-1067`) — `baton waves start --members JSON` pipeline leg. Unchanged.

The A7 rows add no new MCP tool, no new `APPLICATION_COMMAND_DEFINITIONS` entry, and no new
registry row — `waves.send`/`waves.stop` already exist — so the surface-inventory drift observed
in the #132 review does not recur here.

---

## Open questions

1. **`waves.stop` reason required-vs-optional (cross-surface discrepancy).** The registry schema
   required-set is `['runId']` only (`application-semantics.mjs:1614-1621`); the dispatcher
   requires `reason` (`application.mjs:11900`, `:11967-11968`). The audit's fix wording and the
   registry example both pass `--reason`. **Recommendation:** the CLI branch requires `--reason`
   (matching dispatch, the stricter seam); flag the schema `required` set as a doc-truth follow-up
   so the admission contract matches the wire.
2. **`waves.send` runId vs WAVE_ID.** The audit fix wording says
   `baton waves send WAVE_ID|RUN_ID` (`surface-audit-cli.md:292`), but `sendWaveMember`
   (`application.mjs:11840-11893`) is runId-validated and the web port is runId-keyed. Accepting a
   WAVE_ID needs a resolve step (wave → member run). **Recommendation:** pin `RUN_ID` only in the
   CLI branch (matches the schema), and note the audit's WAVE_ID alternative as deliberately
   deferred — a future ergonomic, not a #157 gap.
3. **`--claim-grant` on the CLI.** The schema accepts `claimGrant {boardRunId, board}`
   (`application-semantics.mjs:1599-1613`) and `_normalizeWaveMemberAction` honors it
   (`application.mjs:11974-11981`, closed shape verified — the sorted key set `board,boardRunId`);
   the web wire already carries it (`web-northbound.mjs:54-61`); the audit fix wording omits it.
   **Recommendation:** parse `--claim-grant JSON` (mirror the `--members` JSON take,
   `application-cli.mjs:1363-1371`) so the CLI does not drop a closed shape the wire already
   accepts; the D1.2(1) shape includes it. If the implementer chooses omission, document it and
   add a conformance note — do not silently drop it.
4. **#132 D4.5 stale premise (premise correction).** The wave-observability contract claimed
   `waves.send`/`waves.stop` "keep their current parse" (`wave-observability-contract.md:354`) —
   they never parsed. This contract is the correction: there was no current parse; the verbs were
   ghosts. No code change is owed to #132, but its D4.5 line should be read as superseded here.

---

## Verification (deployment)

1. Regenerate docs and run the conformance gate:
   `node impl/scripts/render-surface-docs.mjs --check`
   (RED at HEAD until D1.2(2)+(4) land; GREEN after).
   **Coupling (§4 drift).** The D3 pin is new conformance logic in `surface-conformance.mjs`
   (the main gate at `:734-745` already iterates profiles and calls `checkProfileDocParity` at
   `:738`). It makes the conformance gate's verdict RED at HEAD until D1 lands, so any CI that
   runs surface-conformance as a required gate blocks until D1+D3 land in the **same change set**.
   Do not split the pin into a separate green-only change, and do not land the A7-5 whitelist
   admission without the doc regeneration (N7).
2. Run the wave-observability suite:
   `node --test impl/test/wave-observability-red.test.mjs`
   (A7-1..A7-8 added per the pins above; A2-4/A2-5/A5-*/A6-6 stay green).
3. Deploy-verification for this contract's execution: executable `true`, args `[]`, cwd `.`,
   expected exit code `0`. No code was changed by this contract; the work is the contract text.
4. Confirm the only edited/new file in the worktree is
   `docs/reference/evidence/cli-wave-fidelity-2026-08-13/contract-fold.md`
   (`git status`).
