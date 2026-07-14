# Phase 63 — repository-wide canonical-order authority and migration

Canonical order is authority whenever ordering affects bytes, a digest, an identity, a replay
decision, a CAS, a receipt, a bounded traversal, or a protocol projection that another component
can bind. It must not depend on the host locale, ICU data, process environment, or user display
preferences. This phase replaces every production `localeCompare` authority path with one shared
UTF-16 code-unit comparator and establishes an explicit compatibility boundary for persisted
coordination history written before the cut.

This phase changes no human-language comparison semantics and adds no homelab or external
project-manager integration. Baton's self-contained causal/temporal knowledge graph remains the
only knowledge authority.

## CO1 — one closed canonical-order primitive

`impl/src/canonical-order.mjs` owns canonical string comparison. Version 1 compares JavaScript
strings by exact UTF-16 code-unit order: equality returns zero, `<` returns minus one, and `>`
returns one. Inputs must be strings; implicit coercion, normalization, case folding, numeric
collation, `Intl.Collator`, and locale fallback are forbidden.

The module exports the current canonical-order version, the comparator, a bounded array ordering
helper, and canonical JSON object-key ordering. Array order remains semantically significant unless
a caller explicitly sorts it. Object keys use the same comparator before serialization. The
adjacent path-identity case fold has its own version and uses locale-independent Unicode default
lowercasing; ICU locale-specific `toLocaleLowerCase` is not authority.

## CO2 — authoritative and display order are distinct

Every production `localeCompare` call is inventoried. Atlas/SCIP/CPG artifacts, semantic deltas,
taint paths, Cairn scorecards/recall/causal projections, Cartographer/Quartermaster graphs,
supply-chain receipts, capability and advisory cards, provider projections, toolchain manifests,
capacity identities, coordination replay, and direct/web/MCP results use CO1.

Production authority code may not call `String.prototype.localeCompare`, construct an
`Intl.Collator`, or call `toLocale*`. Existing path collision/sparse identity code is migrated to
the separately versioned locale-independent case fold. A display-only locale sort is permitted only in a separately
named UI adapter with a source comment and must never feed an identity, digest, cursor, receipt,
request, or event. Phase 63 introduces no such exception.

Default `Array.prototype.sort()` on already-validated strings is code-unit deterministic, but new
or modified authority code must use the named comparator so intent remains reviewable. Numeric and
tuple order keeps its primary numeric comparison and uses CO1 for textual tie breakers.

## CO3 — byte-identical family coverage

At minimum, adversarial Unicode fixtures exercise each authoritative family named in CO2 with
strings whose English, Swedish, and Turkish collation differs from code-unit order. The expected
order is fixed bytes, not whatever the current machine reports. Equivalent operations under
`C.UTF-8`, `en_US.UTF-8`, `sv_SE.UTF-8`, and `tr_TR.UTF-8`, when installed, must produce identical
serialized artifacts, digests, identities, pagination order, and replay projections.

At least two actually installed locales are required by the test runner. A missing optional locale
is reported as unavailable and cannot be counted as a passing comparison. A unit test also patches
`String.prototype.localeCompare` to throw, proving covered production paths do not consult it.

## CO4 — versioned coordination compatibility receipt

Deployment-created coordination stores enable one closed canonical-order policy with bounded
`maxLedgerBytes`, `maxEventBytes`, `maxEvents`, and `maxReceiptBytes`. Before construction may
replay any non-empty history or writer authority becomes usable, the store owns exactly
one private `canonical-order-receipt.json` under the coordination root. The receipt contains only:

- `schemaVersion: 1` and `canonicalOrderVersion: 1`;
- `mode: "empty_bootstrap" | "adopt_compatible"`;
- the exact `throughSeq`, prefix byte count, and SHA-256 digest of the raw newline-terminated
  coordination prefix;
- the replay-derived prefix event digest;
- the exact four-field deployment policy, the exact four-field cut policy used by bootstrap or
  adoption, and a hub-stamped creation time; and
- a digest over every preceding receipt field.

Receipt keys and bytes are canonical. The file is mode `0600`, written through a same-directory
exclusive temporary file, fsynced, atomically renamed, and followed by a directory fsync where the
platform supports it. The receipt never contains credentials, paths outside the coordination root,
principal/session details, or provider prose.

Every later open verifies the receipt and re-hashes the exact pinned prefix before replay,
checks its ceilings and version, and only then replays the whole ledger before admitting writer effects. Later events extend the
ledger but cannot change the pinned prefix. Missing, malformed, future-version, truncated,
oversized, digest-divergent, or path-unsafe receipts fail closed.

## CO5 — explicit compatible adoption, never silent reinterpretation

An empty coordination root bootstraps version 1 automatically after the exclusive writer lease is
claimed. A non-empty root without a receipt refuses during pre-open inspection with
`canonical_order_migration_required`; passing an option to the ordinary runtime constructor cannot
bypass that refusal. The operator must invoke one exact offline migrator with an adoption request
containing:

- `mode: "adopt_compatible"`;
- the expected raw prefix SHA-256 digest;
- the expected event count; and
- ceilings no greater than the deployment policy.

The executable operator API is
`migrateCanonicalOrderLedger(root, { policy, migration, clock? })`. `policy` always contains
exactly `maxLedgerBytes`, `maxEventBytes`, `maxEvents`, and `maxReceiptBytes`; there is no compact
shape and no ambient default. `migration` contains those same four cut ceilings plus `mode` and,
for compatible adoption, `expectedPrefixDigest` and `expectedEvents`. The ordinary
`CoordinationStore` constructor rejects `canonicalOrderMigration` as offline-only.

The offline migrator first acquires the same exclusive writer lease, performs bounded per-event and
whole-ledger framing checks, rejects unknown event kinds, and replays the existing bytes through
every current derived-identity validator without enabling commands or effects. Only if replay is
green, the request exactly names the observed prefix, and the prefix is within both sets of bounds
may it commit the compatibility receipt. Adoption does not rewrite, reorder, normalize, truncate,
or re-digest any event. A ledger whose historical identities are unvalidated or fail current
replay remains incompatible; it receives no receipt. Replay success is necessary but not a claim
that an event kind lacking an explicit identity validator was migrated; such a kind is rejected
until its validator is specified.

The explicit reset route is a newly selected empty coordination root. Offline `mode: "reset_empty"` is
accepted only when both the event count and byte count are zero, and produces an
`empty_bootstrap` receipt. Baton never deletes or clears a non-empty ledger on the operator's
behalf. The prior root remains available for audit.

## CO6 — exclusive, idempotent, crash-safe cut

Offline receipt creation occurs only while the exact coordination writer lease is held. Concurrent
controllers cannot both migrate: one owns the lease and the other receives the ordinary typed
writer-busy refusal. An exact retry after lost response returns the same immutable receipt.
Changed expected digest, event count, mode, ceilings, or version conflicts.

A crash before rename leaves no authority receipt. Once the dead writer is proven absent and a new
writer lease is acquired, Baton removes only canonical-order temporary files belonging to the
receipt protocol and retries from the raw ledger. A crash after rename yields the same verified
receipt. No temporary file is treated as authority and no ledger byte is released or changed.

## CO7 — direct, web, MCP, restart, and projection parity

Canonical order is below transport authority. Identical state observed through direct methods,
authenticated HTTPS/SSE, and MCP has identical ordered content and digests. Transport adapters may
redact fields but may not re-collate retained values. Cursor boundaries and pagination use the
canonical tuple order plus their existing stable sequence tie breaker.

Restart from the same receipt and ledger must reconstruct byte-equivalent snapshots. Tampering
with the pinned prefix after later events exist is detected before commands, capability effects,
provider starts, worktree creation, or web/MCP readiness.

## CO8 — bounded public posture

The receipt and migration command are deployment/operator configuration, not worker, model, direct
fleet, web-user, or MCP authority. Northbound callers may receive only typed readiness failure; they
cannot select a comparator version, request migration, provide expected digests, or read filesystem
paths. Existing web/MCP projections remain credential-free and transport-derived.

Low-level test construction with a caller-supplied coordination store remains an explicit embedding
boundary. Production `createDriver()` enables the policy for its owned store; a custom store must
attest the same version/receipt contract before it can be used as deployment authority.

## CO9 — required adversarial tests

Red tests must cover:

1. exact code-unit ordering of ASCII, combining characters, Turkish I variants, Scandinavian
   letters, an astral character, and a private-use BMP character;
2. rejection of non-string comparator inputs and over-bound helper inputs;
3. repository scan failure on production `localeCompare`, `Intl.Collator`, or `toLocale*` use;
4. byte/digest equality and explicit canonical-order/profile versions across Atlas R1/R2/R3,
   Cairn causal/recall, supply-chain, capacity,
   toolchain, capability/advisory cards, provider reads, Goal/Plan, direct/web/MCP projections;
5. two installed process locales plus a throwing `localeCompare` mutation;
6. empty bootstrap, ordinary-runtime pre-open refusal, offline compatible adoption, and explicit
   empty reset;
7. missing adoption, wrong prefix digest/count, max-plus-one bytes/events, malformed/future receipt,
   prefix tamper, receipt tamper, symlink/path substitution, and incompatible replay;
8. append after the cut followed by restart, preserving the exact pinned prefix;
9. response loss, concurrent writers, crash before/after rename, stale temporary-file cleanup, and
   immutable exact retry; and
10. no commands, provider processes, worktrees, capabilities, or northbound readiness before the
    cut is valid.

The canonical suite must remain green. A Baton-on-Baton exact-route review must inspect the shared
primitive, the complete production inventory, migration implementation, red tests, and repository
scan. Every admitted process must close and reap exactly.

## CO10 — retained boundaries and next dependencies

Phase 63 establishes deterministic ordering and a coordination-ledger cut. It does not claim a
general event-schema transformer, cross-version semantic rewrite, or automatic repair of an
incompatible ledger. Every affected persisted artifact/projection family binds
`canonicalOrderVersion`; its schema, extractor, binding model, card/profile, or media version is
incremented where an old consumer could otherwise interpret newly ordered bytes as the former
profile. Old content-addressed bytes remain immutable historical artifacts. Authoritative reuse
requires explicit old-profile recognition plus recomputation/mapping into the new profile; it may
not silently regenerate an old digest under new ordering.

This work does not displace same-task controller-qualified branch ownership, source-anchored
semantic report verification, provider-backed continuation, richer Goal/Plan evidence and
amendment authority, WebSocket/MCP runtime depth, deeper representation rungs, semantic merge,
Vantage, Evidence Ladder, Scratch Board/Bench, Skill Forge, later Cartographer/Quartermaster and
Cairn rungs, or conditional e-graphs. All remain catalogued under the full-system goal.
