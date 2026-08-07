# #114 IMPL — cross-suite contradiction (documented, NOT weakened)

- **Date:** 2026-08-07
- **Seat:** claude-opus-4-8 (re-drive attempt i2)
- **Status:** the PRIMARY deliverable is COMPLETE — `impl/test/workflow-as-data-red.test.mjs`
  is **29/29** (stable across two runs), zero test weakening. This note records a genuine
  contradiction between two of the four brief-listed verify suites that is **inherent to the
  contract-required work**, not a defect in the implementation and not resolvable by editing any
  test (which the brief forbids).

## The contradiction

The contract (D2 / pin group W6-MCP) REQUIRES the workflow-as-data lane's MCP tool to join the
ordinary application surface. `impl/test/workflow-as-data-red.test.mjs` W6-01 asserts:

```js
assert.ok(mcpApplicationToolNames().includes('baton_waves_run'), 'the baton_waves_run tool must join the application surface');
```

Adding `baton_waves_run` necessarily increments the ordinary MCP surface from **33 → 34** tools.

But two EARLIER-epic suites hard-pin the pre-#114 count of 33 as a frozen-inventory guard:

- `impl/test/workflow-surface-red.test.mjs`
  - **FP-14-tools** (line 1429): `assert.equal(mcpApplicationToolNames().length, 33, 'the
    ordinary surface is exactly the landed 27 + the six — a seventh stowaway tool greens nothing')`.
    This is a **hard-coded 33 in the test file** — unfixable without editing the test.
  - **FP-16-conformance**: `checkSurfaceDocs()` compares the generated `impl/CLI.md` / `impl/MCP.md`
    surface blocks to the served surface; the new `waves run` verb + `baton_waves_run` tool make the
    docs stale (doc regeneration is outside the `impl/src/**` edit scope).
- `impl/test/mcp-reflex-surface-red.test.mjs`
  - two **Inventory** tests that pin the exact ordinary/combined tool membership (same +1 delta).

`mcpApplicationToolNames()` is the SAME accessor W6-01 requires the tool to appear in and FP-14
requires to be length 33. There is no arrangement in which both hold: including `baton_waves_run`
makes the length 34.

## Why this is not weakened / mis-implemented

- Removing `baton_waves_run` from the ordinary surface would green FP-14/FP-16/the two Inventory
  tests but **breaks the PRIMARY suite** (W6-01 → 28/29). The brief's primary is
  workflow-as-data-red 29/29, so `baton_waves_run` must ship.
- FP-14's `33` is a literal in a test file; the brief says **"Do NOT edit any test file."** So the
  guard's expected count cannot be bumped 33 → 34 by this seat.
- These are #93 / S-3 frozen-inventory guards. Landing a new contract-mandated tool is exactly the
  event they are meant to be REGENERATED for; that regeneration lives in their own test/doc files,
  out of this task's `impl/src/**` scope.

## Two classes of collateral, both from the SAME root cause (the +1 tool)

### Class 1 — regenerable conformance artifacts (OUTSIDE the `impl/src/**` edit scope)

The served surface now includes `baton_waves_run` + the `baton waves run` CLI verb, so the generated
surface docs and the committed inventory artifact are stale. The tooling's own remediation is:

```sh
node impl/scripts/surface-conformance.mjs --write-inventory
```

That command REGENERATES (it does not weaken): `impl/CLI.md`, `impl/MCP.md` (the `mcp-tool-inventory`
generated block), `impl/scripts/surface-inventory-artifact.json`, and the divergence ledger
(`impl/scripts/surface-divergence-ledger.json` — a `novel name divergence: mcp.baton:baton_waves_run:name`
finding must be admitted). **Every one of these paths is OUTSIDE `impl/src/**`**, which the brief
restricts this seat to ("Work only within: impl/src/**"), so this seat cannot run it. Once regenerated,
these rows go green:
- `workflow-surface-red.test.mjs` **FP-16-conformance**
- `wave-grammar-red.test.mjs` **WG-5** (two-commit landing discipline / conformance findings)
- `harvest-accessor-red.test.mjs` — the one conformance row that regressed (5→4 pass; the other 34
  reds are the pre-existing unshipped #99 accessor suite, unrelated to this seat)
- likely both `mcp-reflex-surface-red.test.mjs` **Inventory** rows (they read the regenerated inventory)

### Class 2 — a hard-coded literal in a TEST file (unfixable by this seat)

- `workflow-surface-red.test.mjs` **FP-14-tools** line 1429: `assert.equal(mcpApplicationToolNames().length, 33)`.
  A literal `33` in a test file. The brief forbids editing tests, so this row cannot be greened by this
  seat; the fold must bump it to 34.

## Measured splits (this seat's changes applied)

- `impl/test/workflow-as-data-red.test.mjs` — **29 / 29** (0 fail) — THE DELIVERABLE, twice-stable.
- `impl/test/wave-driver-red.test.mjs` — **10 / 10** (0 fail) — no regression.
- `impl/test/workflow-surface-red.test.mjs` — 35 / 37 (FP-14 Class-2, FP-16 Class-1; baseline 37/37).
- `impl/test/mcp-reflex-surface-red.test.mjs` — 19 / 21 (two Inventory rows, Class-1; baseline 21/21).
- `impl/test/wave-grammar-red.test.mjs` — 4 / 5 (WG-5 Class-1; baseline 5/5).
- `impl/test/harvest-accessor-red.test.mjs` — 4 / 39 (one Class-1 conformance row regressed; the
  remaining 34 reds are the pre-existing unshipped-#99-accessor suite — baseline 5/39).

Regression sweep with NO collateral (all green, baseline-matched): coordinator (57), e2e (4),
adapter (42), cli-adapters (24), recipes-red (6), scratchpad-33-red (50), wave-driver-policy-red (11),
decision-gate-trust-gate-red (3), bidirectional-driver-red (15), bidirectional-v3-red (30),
kg12-decisions-red (18), reflex1-decision-requests-red (34), phase38-reuse-decision (11),
cli-dead-paths-red (9).

## Bottom line

The #114 lane is fully implemented and the primary acceptance suite is 29/29 with zero test
weakening. The only red rows are the mechanical inventory-increment collateral of the
contract-required `baton_waves_run` tool: regenerable conformance artifacts that live OUTSIDE this
seat's `impl/src/**` scope, plus one hard-coded count literal inside a test file this seat may not
edit. The fold/review step lands both trivially (`--write-inventory` + one `33 → 34` bump).
