# Surface pins: one derivation per truth (issue #261)

Date: 2026-09-13 · Participant: surface-pins · Suite state after: **unchanged except as listed** —
surface gate `node impl/scripts/surface-gate.mjs` → ok; deployment verification command (13 files)
→ GREEN, exit 0 (163 passed, 27 expected red, 0 stale, 0 unexpected); remaining touched files →
GREEN (215 passed, 45 expected red, 0 stale, 0 unexpected).

## The derivation module

`impl/scripts/surface-truth.mjs` — every export derives from the same src tables the surfaces
serve, never from a retyped list:

| Export | Derives from | Committed witness |
| --- | --- | --- |
| `commandKeys()` | `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` (insertion order, 36) | `BYTE_STABLE_COMMAND_KEYS` + artifact `counts.applicationCommandDefinitions` |
| `swarmVerbs()` | `SWARM_COMMAND_NAMES` (swarm-contract) — the table's swarm block | witness prefix |
| `applicationCardCommands()` | table keys then the M4b canonical names (the `card().commands` assembly) | — |
| `mockApplicationCard(repoId)` | `applicationCardCommands()` | — |
| `webCardCommands()` | table keys with `web:true` ∪ the six wave direct ports, sorted | artifact `profiles['web.bus']` (41) |
| `ordinaryMcpToolNames()` | `McpFleetServer('application').toolDefinitions` served order (47) | artifact `profiles['mcp.application']` (sorted set) |
| `combinedMcpToolNames()` | `mcpCombinedToolNames()` (mcp-northbound, sorted, 131) | artifact `profiles['mcp.combined']` |
| `BYTE_STABLE_COMMAND_KEYS` | committed witness frozen in the module — all 36 keys spelled out, so a reorder in any source table breaks the pin | artifact count cross-check |

`impl/test/surface-truth.test.mjs` (new, 7 tests, green) ties every export to the committed
artifact and the src tables, so the derivations themselves cannot rot silently.

## Artifact leg — check-first result

The inventory artifact **already carried** the ordinary/combined MCP tool lists
(`profiles['mcp.application']`, `profiles['mcp.combined']`) and the web card
(`profiles['web.bus']`); byte-stability tests now compare the live derivations against those
committed profiles. It did **not** carry the insertion-ordered command-key list — only its count.
Adding it requires `buildSurfaceInventoryArtifact` in `impl/scripts/surface-conformance.mjs` plus
an artifact regeneration, both outside this task's write authority. The witness therefore lives as
`BYTE_STABLE_COMMAND_KEYS` in the one truth module (a reviewed commit changes it, exactly like an
artifact regeneration), with the artifact count as a size cross-check in
`surface-truth.test.mjs`. Migration path: emit the key list from
`buildSurfaceInventoryArtifact`, move `BYTE_STABLE_COMMAND_KEYS` consumers onto the artifact
profile, delete the frozen array — one commit, no test changes.

## Literals deleted (replaced by imports)

- **`WEB_BUS_DOT_NAMES_31`** (41 names) and **`WAVE_WEB_VERBS`** — `doc-truth-conformance-red` R2
  now derives the card (`webCardCommands()`), byte-checks it against the committed `web.bus`
  profile, and keeps the D2 source-pin; R5/R7/R11 use the derivation too.
- **`COMMANDS_BEFORE_M3` / `SWARM_COMMANDS`** in `grammar-m3-red` (M3-8) and
  `wave-observability-red` (A1-7) — both pins now compare the live table to
  `BYTE_STABLE_COMMAND_KEYS` with the original F8/UA5 messages.
- **`COMMANDS_BEFORE_M1`** — `grammar-m1-red` derives it (`commandKeys()`).
- **tools/list enumerations** (the 47-name served-order literal, five copies):
  `phase16` (ordinary), `mcp-reflex-surface-red` (ordinary Inventory), `phase67` (toolDefinitions),
  `phase72` (bridge) now assert against `ordinaryMcpToolNames()`. The phase72 **packaged-bridge**
  37-name enumeration is NOT the ordinary surface (it predates the swarm family) and stays
  literal; the phase16 advanced 19-tool fleet enumeration stays literal (kernel profile literal).
- **Combined count** — `phase16` now asserts `combined.result.tools.length ===
  combinedMcpToolNames().length`.
- **Mock application cards** (the copied 37-name list, plus variants) —
  `blind-waits-red`, `briefing-pack-red`, `harvest-accessor-red`, `reflex1-decision-requests-red`,
  `mcp-reflex-board-package-red`, `mcp-packaging-red`, `mcp-profile-parity-red`,
  `mcp-reflex-surface-red`, `phase12-web-operator`, `phase72-kimi-orchestrator-mcp`
  (commands const), `phase16` (own card), `frame-economics-red` (handshake card): all derive via
  `mockApplicationCard(repoId).commands`. The `run.steer` ghost (never in the table, never
  dispatched) and the phase12 extra canonical names died with the copies; card validation is
  subset-based and the web bus serves its own admitted entries, so no behavior moved.
- **Real card pin** — `phase64` (integrated application) compares `application.card().commands`
  to `applicationCardCommands()`.
- **Cross-pins** — `mcp-profile-parity-red` RG-P4..RG-P7 previously extracted the four literals
  from the test sources; they now pin that each site ties to `ordinaryMcpToolNames()` (plus the
  live `mcpApplicationToolNames()` set-equality leg). RG-P8 extracts
  `combinedMcpToolNames().length` from phase16's pin. RG-P1..RG-P3 untouched, still green.

## Source pins → behavior pins

- **`worker-orchestrated-swarm-red` P-A4**: the `srcAnchor` line-range assertions
  (application-cli.mjs line windows) are removed. The guarantee they backed — the byte-identical
  absence refusal — was already and remains pinned behaviorally: `discoverBatonConnection` on a
  missing profile throws `code === 'cli_config_invalid'` with message exactly
  `user connection profile is unavailable`.
- **`phase93a-canonical-identity-red` P93A1-C3**: the sha256 digest of
  `src/canonical-order.mjs` is removed; the same guarantees are pinned through outputs —
  `compareCanonicalStrings` ordering/reflexivity, `canonicalJson` sorted keys at depth,
  `-0` preservation and insertion-independence, `contextValueDigest` digest equality across key
  order plus the committed digest vector, and the `programDigest` vector.

## Tests whose state changed

**None.** Every touched test kept its pass/fail state. Ten tests are red today only because
their count literals went stale (mcp-profile-parity RG-02/RG-09/RG-11-R — stale counts *and* the
unlanded `uncoveredCommands` export; mcp-reflex-surface-red combined "Inventory" — 88 vs 131), but
each is listed in `impl/scripts/expected-red-tests.json`, and the partial-run verdict fails on any
listed test that passes (`stale expectation`). Regenerating that manifest is outside this task's
write authority, so the stale literals inside manifest-listed tests were left untouched and every
green pin that references them (RG-P4..P8) was rewritten in lockstep. When the sibling served-set
work lands and the manifest is regenerated, those literals can move to the derivations.

## Independent review

A read-only reviewer agent re-derived every export from its claimed source and returned
**sound-with-nits** (no high-severity findings; it byte-compared `commandKeys()` vs the witness,
`webCardCommands()` vs the committed 41-name `web.bus` profile, and the canonical-card mirror vs
`CANONICAL_CARD_COMMANDS`). Its one medium finding — the witness's swarm leg was spread from
`SWARM_COMMAND_NAMES`, making it self-blind to a reorder inside the contract — was fixed by
spelling out all ten verbs in the witness; the live tie to the contract runs the other way
(`surface-truth.test.mjs` asserts the table's swarm prefix equals `swarmVerbs()`). Remaining
nits (the canonical-card mirror needs lockstep edits when `card()` changes — guarded by
phase64's real-card `deepEqual` — and the six wave-port verbs exist in three loud-drift sites)
are inherent to the no-src-changes constraint and are named in the code comments.

## Out of scope, unchanged

No `src/` file, surface name, tool name, or command order changed; `docs/36` grammar untouched;
`impl/scripts/surface-conformance.mjs` and `surface-inventory-artifact.json` untouched.
