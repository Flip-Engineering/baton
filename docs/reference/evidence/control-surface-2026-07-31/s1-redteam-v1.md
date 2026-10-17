# S-1 wave grammar amendment — adversarial red-team (v1)

**Verdict: SOUND-WITH-FOLDS**

The two decisions track R-CS-2's prescribed repair exactly — one canonical key, mechanically
derived names accepted verbatim, `waveId` a required public input, only `mintWaveDetached`
hidden, deployment-facade parity riding the portability decision. The W93 binding machinery it
names is real and server-side (`_runWaveId` against `steering.registered`, fail-closed typed
refusal), and the derived names (`baton waves start` / `baton_waves_start` / `waves_start` /
`waves.start()`) fall out of the single `deriveSurfaceNames`. But five folds block a safe
one-commit landing: the hidden-by-declaration claim is already false on the web surface
(`mintWaveDetached`/`waveId` are web-advertised and web-enforced today), the "registry-declared
preset" needs a preset registry and a C7 expansion-record mechanism that do not exist, the
portable attach's authority semantics are unpinned (which principal the transport handler runs
as, what the returned "handle" is over MCP/web), the binding proof is coupled to the mint
callback so an unwired transport silently skips it, and the one-commit quiesce discipline is
underspecified against a conformance main that is now live. All are repairable; none invalidates
the portability decision itself.

---

## R-WG-1 — P1 — Portable attach's authority semantics are unpinned; "observe-class" understates what gets transported

### Grounding

- `wave.mjs:234-297` — `attachWave` returns `createWaveHandle(...)`, and that handle exposes
  `stopMember` (`wave.mjs:359-379` → `run.act('stop_member')` / `run.stop`) and `close`
  (`wave.mjs:442-468` → `entry.run.stop(reason)`), both `emergency_stop`-gated at the command
  layer.
- `application-client.mjs:1518-1522` — the only production wiring of `waves.attach` passes a
  mint callback into `attachWave`; the callback is what reaches the binding proof. The client
  is bound to the caller's principal (`bindBaton(application, principal)`,
  `application-client.mjs:1597`).
- `application-deployment.mjs:1166-1169` — the deployment facade binds its own
  `#baton = bindBaton(application, principal)` with a privileged deployment principal
  (`deployment:<repoId>` / `local-owner`; capabilities `baton_orchestrator/code/test` at
  `application-deployment.mjs:827,860`).
- `application.mjs:10147-10158` — the `wave.driver_detached` mint is authorized as
  `run.status` (`_authorizeRecursiveCommand('run.status', ...)`), i.e. observe-only, with no
  wave-owner check; the binding proof checks the run↔waveId binding, never the caller's
  relationship to the wave.
- `control-surface-decisions.md:43-50` — R-CS-2's repair: "Pin expansion, idempotency, and
  authority semantics before enabling another surface."

### Failure

The amendment calls attach "a read/harvest authority (observe-class)" and justifies portability
with "its binding proof is already server-side". Both are true but incomplete. What the portable
operation transports is not a read — it is (a) a durable coordination-log write
(`wave.driver_detached` mint) that is currently reachable only through the in-process client,
(b) member runId bindings for harvest, and (c) if the handler keeps the returned handle, a
stop-capable object. The amendment never pins which principal the MCP/web handler runs as, or
what the "attach" operation returns. Because `attachWave`'s `close()`/`stopMember()` are only
per-command capability-gated, an implementation that wires `baton_waves_attach` through the
deployment facade's privileged `#baton` gives an observe-capable MCP caller a
stop-capable handle over member runs — the R-CS-1 shape (a facade path that inherits a
privileged principal the caller does not hold). The binding proof being server-side proves the
run belongs to the waveId, not that the caller may attach or harvest; nothing in the amendment
says who may attach, and `waveId` is explicitly a public input, so any observe principal who
knows waveId + member objectives can mint the receipt and bind. R-CS-2's repair demanded the
authority semantics be pinned "before enabling another surface"; the amendment pins idempotency
(rule 3) but not authority (rule 5 only re-asserts the binding key).

### Minimal repair

Pin (a) the MCP/web handler always runs `attachWave` under the **calling session principal**,
never the deployment `#baton`; (b) the portable operation's return is a closed member-binding
list (`role → runId`), harvest and stop continue through the existing `run.view`/`run.stop`
commands so each is capability-gated independently — no server-held live handle is exposed or
indexed; (c) the `wave.driver_detached` mint gets a named capability (or an explicit
"attach requires observe on every member run" authorization row) instead of riding
`run.status`; (d) a negative test: observe-only principal may attach (mint fires, key-deduped)
but `close()`/`stopMember()` on the returned embedded handle refuse with
`application_action_unavailable`, and the same refusal is pinned for a web/MCP-shaped caller.

---

## R-WG-2 — P1 — "Registry-declared preset sugar" forks the registry model; the C7 expansion mechanism does not exist

### Grounding

- `application-semantics.mjs:1130-1303` — `CANONICAL_OPERATION_SPECS`: 44 rows, no preset row
  kind, no "expands" field; every row becomes a canonical operation via
  `buildCanonicalOperation` (`application-semantics.mjs:1547`) and enters the authority digest
  projection (`application-semantics.mjs:1557-1590`).
- `application-semantics.mjs:1089-1107` — `deriveSurfaceNames` is the one shared derivation the
  conformance harness imports; a `waves.start` row derives `baton waves start` /
  `baton_waves_start` / `waves_start` / `waves.start()` — the machinery of a canonical operation.
- `surface-conformance.mjs:643-690` — the now-live conformance main classifies the surface
  inventory and flags any novel name against the ledger; `run-suite.mjs:36-43` gates the suite
  on it. A `waves.*` row without a ledger entry fails the suite.
- `docs/36-unified-control-grammar.md:325` — `waves.start` is listed under the `run.start` row
  as sugar, not as its own operation; `docs/36-unified-control-grammar.md:83` admits
  `explore`/`review` record no expansion today; `docs/36-unified-control-grammar.md:289-294`
  (L5) says the *work* is extending provenance to `explore`/`review` and "recording the
  expansion itself" — i.e. no C7 expansion record exists anywhere in `application.mjs` (grep for
  preset/expansion yields only view-projection `expansions`).
- `impl/CLI.md:10-11` — "Orchestration waves stay embedding-only" — the current documented
  posture this amendment overturns.

### Failure

WG-1's "registry rows exist with the exact keys/profiles/surfaces/schemas" plus C1
name-resolution rows for `waves.start` on every enabled surface is indistinguishable from
canonical-operation registration: the only registry is `CANONICAL_OPERATION_SPECS`, its rows
drive names, surfaces, generated docs, ledger gating, and the authority digest. Registering
`waves.start` there makes it a canonical peer with independent surface names — precisely the
fork R-CS-2 warned about ("one implementer can treat it as run.start expansion sugar while
another can give it independent command/idempotency semantics"). The amendment's "gets NO
independent command/idempotency semantics" is a semantic promise, not a registry fact. And
WG-2's "records the expansion provenance (C7 shape)" requires a net-new coordination-log record
kind (`run.start`/`createWave` write no expansion record today), whose shape, key, dedup, and
projection the amendment never specifies.

### Minimal repair

Split the concept: add a **preset registry** separate from `CANONICAL_OPERATION_SPECS` — row
kind `preset`, `expands: ['run.start']`, closed surfaces, one-live-method mapping to
`wave.mjs:createWave` — and exclude preset rows from the authority digest's
`canonicalOperations` projection (or give presets their own digest projection) so
`waves.start` sugar provably cannot carry independent command/idempotency authority. Add the C7
expansion record as an explicitly specified record kind (key, mint point inside the first
member's `run.start`, dedup on `waveId`, projection into the run's durable log) before WG-2 can
pass. Conformance C1 for presets tests expansion provenance, not command-name resolution.

---

## R-WG-3 — P1 — Hidden-by-declaration is already false on the web surface; pinning it requires a per-transport schema divergence

### Grounding

- `application.mjs:151` — `run.inspect` command definition args include `mintWaveDetached` and
  `waveId`.
- `web-northbound.mjs:14-16,71` — `WEB_APPLICATION_ENTRIES` derives from
  `APPLICATION_COMMAND_DEFINITIONS`, and `ARG_FIELDS` is built as `new Set(definition.args)` for
  each web entry; therefore `ARG_FIELDS.run_inspect` **contains** `mintWaveDetached` and
  `waveId`.
- `web-northbound.mjs:306-333` — `validateEnvelope` rejects only args **not** in `ARG_FIELDS`
  (`unknown_argument_field` at :318-320); `run_inspect` with `mintWaveDetached:true` +
  `waveId` passes `validateApplicationCommandArgs` (which enforces
  `mintWaveDetached === true ⇒ waveId present`, `application.mjs:1434-1438`).
- `application.mjs:10147-10158` — the mint then executes under observe authority. So **today**,
  an observe-level web caller can mint `wave.driver_detached` on any run whose waveId they know.
- `mcp-northbound.mjs:347-358` — the hand-written `baton_run_inspect` inputSchema excludes both
  fields; `mcp-northbound.mjs:666` then rejects them with `unknown_argument_field`. MCP is
  hidden; web is not.
- `control-surface-decisions.md:101-103` — R-CS-3 already flagged that the registry has no
  per-field hidden-by-declaration flag; the "pattern" the amendment credits to "the CS v2
  contract" was a **v1** proposal that v2 cut (v2's whole point was that wave cross-surface
  transport was deferred to S-1).

### Failure

The amendment's core mechanism — "`mintWaveDetached` … absent from advertised web/MCP schemas …
hidden-by-declaration" — is contradicted by the live web surface: the web schema (ARG_FIELDS)
advertises both fields and the web validator accepts them. WG-3's conformance row "absent from
every advertised schema while present in the in-process validator" fails against the live code.
Because web ARG_FIELDS and the MCP inputSchema are both *derived from* the single
`run.inspect` command definition (web) or hand-maintained (MCP), "present in the in-process
validator" and "absent from web schemas" cannot both derive from the one command-definition
source: making web hide the fields requires either filtering `ARG_FIELDS` per transport or
forking the web entry from the definition — the hand-maintained schema hack docs/36 L4 exists
to end. The amendment also misattributes the hidden-by-declaration "pattern" to a CS v2
contract that explicitly deferred it.

### Minimal repair

Move `mintWaveDetached`/`waveId` **out** of `APPLICATION_COMMAND_DEFINITIONS['run.inspect'].args`
and into an in-process-only validation branch that the direct command port and the web/MCP
schemas all derive from — then the side-channel disappears from both transport schemas
automatically (one source of truth, no per-transport hacks). Concretely: keep the runtime gate
at `application.mjs:10147-10158`, validate the hidden pair in a dedicated
`validateRunInspectSideChannel` called by the direct port and by `waves.attach`'s handler, and
drop the two args from the public command definition so `ARG_FIELDS` and the MCP schema both
exclude them by construction. Add a negative test pinning the end state — web `run_inspect`
with `mintWaveDetached:true` must reject `unknown_argument_field` (the leak this closes; today
the web surface accepts it). Correct the "CS v2 established it" attribution in the text.

---

## R-WG-4 — P1 — The binding proof is coupled to the mint callback; an unwired transport silently skips it, and the "salted objectives" claim is unimplemented

### Grounding

- `wave.mjs:280` — `if (typeof mintDetached === 'function') await mintDetached(record.id)`; the
  binding proof lives *inside* the callback, so `attachWave(baton, waveId, members, null)` skips
  the proof and adopts by objective match alone.
- `application-client.mjs:1518-1522` — the only production wiring of the callback is the
  in-process client getter. The amendment's one-live-method mapping ("`waves.attach` →
  `wave.mjs:attachWave` via the client getter") is therefore only implementable in-process; an
  MCP/web handler cannot reuse a live-handle getter and must re-implement `attachWave` — with no
  pin that it must pass a proof-carrying mint callback.
- `wave.mjs:225` — the comment claims "driver objectives are salted unique per wave"; no
  salting exists. `createWave` passes `member.objective` verbatim to `run.start`
  (`wave.mjs:202-206`); `run.start` only NFKC-trims the objective (`application.mjs:1174`) and
  deliberately excludes `waveId` from run identity (`application.mjs:1179-1182`), so identical
  objectives across waves resolve to the *same* run bound to the first wave's id.
- `impl/test/wave-attach-red.test.mjs` (W93-4) — the mismatch refusal is exercised only because
  the test authors chose distinct objective strings; nothing enforces that.

### Failure

WG-3's "a mismatched member refuses `application_wave_member_mismatch`" can pass in a test that
wires the callback while the shipped MCP/web tool omits it — the proof is not a required,
always-on step of attach, it is a side-effect of a callback the transport layer may reasonably
treat as client-side. A foreign-wave attach whose objectives happen to match would then
silently adopt another wave's runs. Separately, rule 5's "member objectives on the wire are the
salted objectives" is false against the code (no salting); with unsalted objectives a
legitimate second wave sharing an objective is fail-closed into `wave_attach_unknown_wave` at
start, and the "salted objectives … the binding key" schema promise is ungrounded.

### Minimal repair

Make the binding proof a required step of `attachWave` itself (move the
`run.inspect {mintWaveDetached:true, waveId}` proof call inside `attachWave`, independent of the
user mint callback, or add a dedicated `waves.attach` command handler that always runs it), and
pin a negative test: `attachWave(baton, foreignWaveId, members, null)` (no callback) still
refuses `application_wave_member_mismatch`. Implement objective salting at `createWave`
(prefix member objectives with the derived `waveId`) or enforce objective-uniqueness as a
start-time invariant, and amend the schema text to "objectives are the binding key; uniqueness
is enforced at start" rather than claiming salting that does not exist.

---

## R-WG-5 — P2 — The one-commit quiesce landing is not realistic as specified; "suite green" is under-specified against a live conformance main

### Grounding

- `surface-conformance.mjs:643-690` — the CS-1 main is live: it fails on novel name divergence,
  ledger invalidity, enum divergence, web-name collision, stale generated docs, and
  profile-parity drift; `run-suite.mjs:36-43` gates the suite on `classifySurfaces(...).novel`.
- `docs/36-unified-control-grammar.md:491-501` — append-forbidden/removal-only ledger;
  post-M0 additions require a spec-version change with red-team approval.
- `docs/36-unified-control-grammar.md:512-514` — authorityDigest-changing phases land at a fleet
  quiesce point.
- `application-semantics.mjs:1557-1590,1610-1622` — `authorityDigest` covers
  `canonicalOperations` (surfaces, inputSchema, capabilities, profile); adding `waves.*` rows
  changes it.
- The amendment's own verification block lists `wave-grammar-red.test.mjs`, which does not exist
  yet; the change surface spans registry rows, ledger entries, regenerated `CLI.md`/`MCP.md`
  (`checkSurfaceDocs`), web `ARG_FIELDS`, an MCP tool, the deployment facade, the C7 expansion
  mechanism, and five test files.

### Failure

"One commit, suite green before and after" is only achievable if the preset registry and C7
expansion mechanism from R-WG-2 already exist; they do not. Adding the waves rows to the
registry without ledger rows and regenerated docs fails the (now live) conformance main — so the
single commit must also modify the ledger, regenerate docs, filter web schemas, add the MCP
handler, add the expansion record, and add the facade method simultaneously. The quiesce
precondition ("no waves in flight") is an operational state no test proves; the amendment names
the docs/36:512-514 rule but does not pin how a reviewer verifies quiesce before merge.

### Minimal repair

Decompose into two green rungs: rung A lands the preset registry + C7 expansion record with no
authorityDigest change (preset rows excluded from the digest projection); rung B lands the
`waves.start`/`waves.attach` registry rows, ledger entries, regenerated docs, web/MCP handlers,
deployment-facade `waves.attach`, and the red tests, at the named quiesce point, with the
digest bump confined to that commit. Pin the quiesce precondition explicitly (wave-driver
liveness scan shows zero in-flight waves) and a rollback path (rows additive; digest bump is the
fold). Both rungs carry their own conformance rows, satisfying
`docs/36:512-514` and R-CS-5.

---

## R-WG-6 — P2 — Citation drift on the waves getter

### Grounding

- The amendment cites `application-client.mjs:1495-1507` as the "waves getter". The getter is at
  `application-client.mjs:1512-1524`; `1495-1507` is the tail of `BatonRuns.stopMembers` and the
  `BatonRuns` class close. The citation was already imprecise in the R-CS-7 evidence table
  (`redteam-v1.md` line 250) and the amendment inherits it.
- All other spot-checked citations hold: `docs/36:289-294` (L5), `:324-326` (run.start sugar),
  `:512-514` (quiesce); `application-semantics.mjs:1088-1105` (derivation);
  `wave.mjs:157-296` (createWave/attachWave); `application-deployment.mjs:1188-1195` (facade
  gap — `waves` exposes only `start`); `application.mjs:144-167` (command table with the
  `run.inspect` side-channel args); `mcp-northbound.mjs:7-9,63-93` (entries + capability map);
  `web-northbound.mjs:14-73` (entries + ARG_FIELDS); the W93 suite
  `impl/test/wave-attach-red.test.mjs` exists and pins same-run attach, typed unknown-wave
  refusal, and exactly-once `wave.driver_detached`.

### Failure

The stale range makes the derivation-of-names claim harder to reproduce and, more importantly,
hides that the only production wiring of the attach binding proof is those twelve lines
(1512-1524) — the fact R-WG-1 and R-WG-4 hang on.

### Minimal repair

Re-cite `application-client.mjs:1512-1524` for the getter and `:1518-1522` for the attach wiring.

---

## Surviving sections

- **`waves.start` stays preset sugar over `run.start`** — survives as the correct target of
  R-CS-2, provided the preset registry + C7 expansion record (R-WG-2) land as separate
  machinery; the derived names and the refusal of singular `wave start` survive.
- **`waves.attach` portability** — survives as the correct decision to make, with R-WG-1's
  repairs (calling-principal binding, closed return shape, named mint authority).
- **`waveId` as a required public input, `mintWaveDetached` the only hidden field** — survives
  as the design, but only after R-WG-3 moves the pair out of the public `run.inspect` command
  definition so both transport schemas exclude them by construction.
- **Deployment-facade parity** (`application-deployment.mjs:1188-1195`) — survives as a real,
  verified gap; the close must keep the deployment facade on its own principal.
- **W93 binding machinery as the attach contract** — survives; the binding proof and the
  exactly-once `wave.driver_detached` mint are real and server-side, and must be made
  unconditional (R-WG-4).
- **Deterministic MockAdapter/in-process surfaces and the three-command verification block** —
  survive; add the negative web-surface row and the no-callback attach row.
- **The quiesce/digest discipline** — survives as a goal, decomposed into two rungs (R-WG-5).
