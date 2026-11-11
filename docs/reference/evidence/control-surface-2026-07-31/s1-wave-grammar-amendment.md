# S-1 v2 amendment — the fold of the deepseek red-team (SOUND-WITH-FOLDS, R-WG-1..6)

(v2 folds `s1-redteam-v1.md` — deepseek-v4-flash@high's first adversarial seat. The
portability decision SURVIVES; five folds block the one-commit landing. Decisive
corrections: (1) `waves.start` registration as a "registry-declared preset" forks the
registry model — CANONICAL_OPERATION_SPECS has no preset row kind and any row IS canonical
registration (R-WG-2), so v2 REGISTERS ONLY `waves.attach`; `waves.start` stays embedding-
only preset sugar with the C7 expansion-record mechanism named as the docs/36-L5 follow-on.
(2) Portable attach's authority semantics are now pinned (R-WG-1). (3) Hidden-by-declaration
gets its per-transport mechanism (R-WG-3). (4) The binding proof moves server-side into the
operation — the mint-callback pattern deletes from the portable path (R-WG-4). (5) Landing
splits into two green commits (R-WG-5). Citations repaired (R-WG-6).)

## Amended decisions

1. **`waves.attach` (only) registers as a canonical operation.** Exact key `waves.attach`,
   profile `ordinary`, effect `observe` + `emergency_stop`-free (no member mutation — rule 3
   below), surfaces `{embedded, cli, mcp, web}` with derived names verbatim
   (`baton waves attach`, `baton_waves_attach`, `waves_attach`, `waves.attach()`), the
   R-CS-3 registry-delta row shape (closed input/output schema, authority-vs-server-derived
   fields, one-live-method mapping to `wave.mjs:attachWave`).
2. **Transport attach is ATOMIC attach-and-harvest, never a live handle.** Over MCP/web/CLI
   the operation attaches, validates every member binding SERVER-SIDE (each member's
   `steering.registered` waveId must equal the asserted `waveId` — the proof moves INTO the
   operation; the embedded mint-callback path routes through the same operation and the
   callback pattern deletes), settles, and returns `{outcomes, waveDriverDetached: bool}` —
   the `wave.driver_detached` receipt mints exactly once as today. Long-lived handles
   (`progress`, `send`, `stopMember`, `close`) stay embedded-only; stopping members is NOT
   part of the portable operation (no `emergency_stop` authority is transported, R-WG-1).
   The calling principal must hold `observe` on every member run (per-run authorization
   rides the existing `runs.attach`/`run.inspect` path — never the deployment's privileged
   principal).
3. **Inputs:** `waveId` (required, public, transport-validated), `members` (required:
   `{role, objective}` pairs — the binding key, documented honestly: objectives are the
   salted wave objectives; a portable caller learns them from the invocation manifest (P1-D)
   or operator records, NOT from any roster-reconstruction this contract does not build).
   Only `mintWaveDetached` + the `run.inspect` side-channel `waveId` carry the
   declared-hidden flag.
4. **Hidden-by-declaration gets its mechanism (R-WG-3).** The registry row gains
   `transportHidden: string[]`; advertised schemas (MCP tool inputSchema, web advertised
   schema) EXCLUDE those fields while the in-process and web validators continue to accept
   them; the web ARG_FIELDS derivation (`web-northbound.mjs:51-73`) learns to honor the
   flag (today it admits every `definition.args` member — R-WG-3's grounding: the fields are
   web-admitted NOW, so this is a behavior change, pinned by test); the conformance harness
   pins absence-from-advertised-schema AND acceptance-by-validator for each flagged field.
5. **Landing: two green commits (R-WG-5).** Commit 1: the registry row + server-side
   binding proof + validator/schema changes + WG rows. Commit 2: the transport wiring
   (CLI/MCP/web derivations + facade parity at `application-deployment.mjs:1188-1195`) +
   conformance rows. Each suite-green with the live conformance main consulted; the
   authority-digest change is confined to commit 1.
6. **`waves.start` stays embedding-only preset sugar** (CLI.md's posture remains accurate
   for start). The C7 expansion-record mechanism (recorded preset expansions for
   `waves.start`/`explore`/`review`) is the named docs/36-L5 follow-on — it does not exist
   anywhere today (R-WG-2's grounding) and is NOT built here.

## Amended red rows (wave-grammar-red.test.mjs)

- **WG-1:** the `waves.attach` registry row (exact key/profile/surfaces/schema) + derived
   names on every enabled surface; singular `wave` spellings refused; NO `waves.start`
   canonical row exists (source-scan).
- **WG-2:** atomic transport attach — MCP + web calls bind valid members, settle, return
   outcomes; a zero-member bind refuses `wave_attach_unknown_wave`; a mismatched member
   refuses `application_wave_member_mismatch` SERVER-SIDE (no callback involved);
   `wave.driver_detached` mints exactly once across transports.
- **WG-3:** hidden-by-declaration — advertised MCP/web schemas exclude `mintWaveDetached`
   (and `run.inspect`'s `waveId`); the validators accept them; conformance pins both.
- **WG-4:** authority — a principal lacking per-run observe on any member refuses (typed);
   no `emergency_stop` capability is required or transported; the deployment-facade attach
   binds identically (parity).
- **WG-5:** the two-commit landing discipline holds (each commit suite-green; digest change
   confined).

---

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
