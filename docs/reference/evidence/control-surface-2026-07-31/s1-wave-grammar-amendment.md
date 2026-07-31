# S-1 wave grammar amendment — preset sugar, portable attach, facade parity (v1)

(Successor contract named by the control-surface v2 (R-CS-2 fold). Parent: docs/36 v2.1
(the L5 model: `waves.start` is recorded preset sugar over `run.start`,
docs/36-unified-control-grammar.md:289-294,324-326); issue #43; 93B (the attach machinery
this amendment names). Operator directive: "if other harnesses are meant to orchestrate
through baton, the MCP surface needs the same wave-level ergonomics" — the portability
decision below rides it. NOT in scope: recipes (P1-D library), board authority (S-2),
`decision.list`/scratchpad/REPL/knowledge surfacing (S-3), M5 (S-4).)

## The two decisions

1. **`waves.start` stays registry-declared preset expansion sugar of `run.start` — never a
   canonical peer.** It registers in the grammar AS a preset (the docs/36 L5 model):
   expansion provenance is recorded per C7 (`waves.start({approve:false})` is a distinct
   recorded expansion), idempotency and authority semantics are exactly the expansion of its
   member `run.start` intents plus the 93B `waveId`/`waveStart` bindings; it gets NO
   independent command/idempotency semantics. Derived names are accepted VERBATIM from the
   mechanical derivation (plural registry key `waves.start` → CLI `baton waves start`, MCP
   `baton_waves_start`, Web `waves_start`, embedded `waves.start()`) — the singular
   `wave start` hand-alias is refused (R-CS-2's contradiction, dissolved by taking the
   derived names as-is).
2. **`waves.attach` is PORTABLE.** Rationale: the orchestrating model is not always the
   embedded one (MCP parity is an operator requirement), attach is a read/harvest authority
   (observe-class; it starts no runs, mutates no member state — its only mutation is the
   exactly-once `wave.driver_detached` receipt), and its binding proof is already
   server-side. Registration: canonical key `waves.attach`, profile `ordinary`, surfaces
   `{embedded, cli, mcp, web}` with derived names verbatim; `waveId` is a REQUIRED PUBLIC
   input (transport-validated like any runId); `members` (roles+objectives) is a required
   public input with the closed RoleCard-lite shape; ONLY `mintWaveDetached` stays hidden
   (declared-hidden in the registry row — the conformance harness pins it absent from
   advertised web/MCP schemas and present in the in-process validator, the
   hidden-by-declaration pattern the CS v2 contract established). `run.inspect`'s
   side-channel occurrence of `waveId` rides the same declared-hidden flag: required when
   `mintWaveDetached === true`, never advertised. The deployment facade gains `waves.attach`
   (parity with `BatonClient.waves`, closing the split at
   `application-deployment.mjs:1188-1195`).

## Rules

1. Registration rows for both operations follow the R-CS-3 registry-delta shape: exact key,
   closed profile enum, enabled surfaces, effect/durability, closed input/output schema,
   authority-vs-server-derived fields, one-live-method mapping (`waves.start` →
   `wave.mjs:createWave`; `waves.attach` → `wave.mjs:attachWave` via the client getter).
2. Conformance (the CS-1 harness, now live): C1 name-resolution rows for both operations on
   every enabled surface; negative rows (singular `wave` spellings refused everywhere;
   `mintWaveDetached` rejected by MCP argument validation and absent from advertised schemas;
   `waveId` REQUIRED by the attach schema and by the side-channel validator).
3. Idempotency semantics pinned: `waves.start` with an `idempotencyKey` derives the
   deterministic `waveId`; a retry of the same logical start ATTACHES (never double-starts
   members) — the 93B rule-1 behavior, stated as the operation's contract, not just the
   library's. `waves.attach` is idempotent by construction (repeated attaches return the same
   member bindings; `wave.driver_detached` mints exactly once).
4. Authority-digest discipline: this amendment changes the registry authority digest — it
   lands alone, suite green, at a fleet quiesce point (docs/36:512-514), in ONE commit with
   its conformance rows.
5. No semantic drift: attach NEVER starts runs (a zero-member bind refuses
   `wave_attach_unknown_wave` exactly as the W93 suite pins); member objectives on the wire
   are the salted objectives (attach binds by objective match per 93B; the schema documents
   this honestly as the binding key).

## Red-first tests — `impl/test/wave-grammar-red.test.mjs`

1. **WG-1:** the registry rows exist with the exact keys/profiles/surfaces/schemas; derived
   names resolve on every enabled surface (`baton waves start`, `baton_waves_start`,
   `waves_start`, `waves.start()`, `baton waves attach`, …); singular `wave` spellings are
   refused with the corrective naming the plural.
2. **WG-2:** preset semantics — a `waves.start` execution records the expansion provenance
   (C7 shape) and the member intents' idempotency; NO independent `waves.start` command key
   exists in the command table (source-scan).
3. **WG-3:** `waves.attach` through MCP and web: `waveId` required and validated; a
   zero-member bind refuses `wave_attach_unknown_wave`; a mismatched member refuses
   `application_wave_member_mismatch`; `mintWaveDetached` rejected by MCP argument validation
   and absent from every advertised schema while present in the in-process validator
   (hidden-by-declaration, conformance-pinned).
4. **WG-4:** deployment-facade parity — `deployment.waves.attach` binds and harvests
   identically to `BatonClient.waves.attach` (same W93 taxonomy); `waves.start`
   idempotencyKey retry attaches without double-starting (member runIds identical).
5. **WG-5:** conformance harness C1/negative rows for both operations pass; the authority
   digest change is confined to this commit (suite green before and after).

Deterministic: MockAdapter fixtures, in-process surfaces, no live providers.

## Verification

```text
node --test impl/test/wave-grammar-red.test.mjs impl/test/wave-attach-red.test.mjs impl/test/control-surface-truth-red.test.mjs
node impl/scripts/surface-conformance.mjs
node impl/scripts/run-suite.mjs
```
