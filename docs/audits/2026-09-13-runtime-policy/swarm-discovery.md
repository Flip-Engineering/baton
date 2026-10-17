# Swarm discovery — per-event payload schemas, credential-free CLI help, nameable idempotency keys

Date 2026-09-13. Participant `discovery` (native omp session), swarm
`swarm-40e643e96fd1edcd567a7c004a788adb`. Implements the G3 and G5 directions from
`native-swarm-exercise.md` in this worktree. Scope honored: no auth grants, cross-swarm guards,
raw credential handling, command count, or size policy changed.

## G3 — payload shapes are discoverable, and wrong shapes refuse early with named fields

- **New `impl/src/swarm-event-schemas.mjs`** (pure, no imports): one declarative description of
  every public `swarm.update` payload — per kind a summary and field rows (`required`, optional,
  `autoFilled`, expectation text, example), plus `SWARM_EVENT_EXAMPLES`, the derived helpers
  (`swarmEventRequiredFields` / `AutoFilled` / `AgentRequired`, `swarmEventFieldExpectation`), and
  two renderers (`swarmUpdatePayloadSummary` for schema surfaces, `swarmUpdatePayloadDetails` for
  help). Bodies stay arbitrary JSON or plain text — no field enumeration inside a body, no fixed
  record. No size/count cap appears anywhere in the data (a module-load assertion enforces it, and
  a load-time well-formedness pass pins examples and markers).
- **One source of truth, one import direction**: `swarm-contract.mjs` imports the module (never the
  reverse) and throws at load if the described kinds and `SWARM_EVENT_KINDS` ever disagree.
- **Contract admission** (`validateSwarmCommand`) now presence-checks only the CALLER-supplied
  fields — required minus `autoFilled` (`swarmId` from the token scope; contribution
  author/id minted; reviewer overridden; self-leave participantId defaulted). The kinds the runtime
  can assemble from request identity pass untouched: a plain-text contribution body, an empty
  self-leave, and `swarm.closed` all still validate. Refusals carry
  `{field: "payload.<name>", event, required, expectation}` — the audit's exact probe
  (`context_updated` missing `body`) now refuses at admission, before any authority check or
  durable fold, in every lane that runs the contract (bridge, runtime `command()` pre-authorize,
  SDK client). Deep typing deliberately stays with `validateSwarmEvent` (root-owned); this is a
  presence pre-check derived from the shared description, not a second domain validator.
- **Surfaces**: the `swarm.update` MCP row's `payload` property carries a `description` naming every
  kind (flows through `SWARM_COMMAND_SCHEMAS` → `CANONICAL_OPERATION_SPECS` → the wire
  `inputSchema`), and `SWARM_CLI_HELP['swarm.update']` carries the multi-line per-kind text.

## G5 — the minted idempotencyKey is learnable

`swarmBridgeMain` adds `commandReceipt.idempotencyKey` to the existing result object when it
mints the key for a stateful verb; failures expose the same key for reconciliation; a caller-supplied key keeps the historical bare-result output byte-for-byte. The receipt is
additive metadata so a retry can name the key — replay dedupe itself stays the runtime's (`_once`).

## Local help without a bridge credential

`--help` / `-h` / `help` render the family view; `<swarm.command> --help` (or `help <command>`) the
per-command view — arguments, required/optional, the same expectation text the validator refuses
with (`swarmCommandFieldSummary`, derived from the contract tables — no second registry), env
auto-fill notes, and for `swarm.update` the per-event payload shapes. Rendering is local: no
endpoint lookup, no token read, no network. An unknown command with a help flag refuses typed
(`swarm_command_unavailable`).

## Tests

- **New `swarm-event-schemas.test.mjs`**: kind coverage; every shipped example satisfies
  `validateSwarmEvent` once the runtime's injection is modeled from the module's own `autoFilled`
  markers; every store-required field is real (dropping one refuses in the store); the contract
  refuses exactly the agent-required fields, with field+event+expectation detail; auto-filled fields
  are never demanded; no caps; help renderers name every kind.
- **Bridge suite**: real child-process `--help` runs with a scrubbed env — the deployment injects
  `BATON_SWARM_BRIDGE_*` into this test process, so the pre-existing missing-env probe now scrubs
  explicitly (an inherited URL made it a real network call); the minted-key receipt is exercised
  end-to-end through a live bridge (minted key printed, used at dispatch, nameable on retry,
  explicit keys untouched); in-process help/usage parity.
- **Surface suite**: the payload description reaches the wire schema; help names every kind; and
  the canonical SDK examples were made store-valid (`members`, `key`+`body`, `objective`,
  `decision`) — the old ones were already invalid under `validateSwarmEvent` and now fail fast at
  admission instead of in the store.

## Notes for root

- `Swarm.group/context/review` SDK helpers pass payloads through; callers that used the old
  `{groupId, add}` / bare-`{notes}` shapes will now get the detailed admission refusal. Docs
  examples should move to the store's real shapes.
- Root integrated `swarm.inspect.updatePayloads`, filtered to the caller's allowed updates,
  with fields and runnable examples from the same descriptions.
- `validateSwarmEvent` may adopt the module as its description of record later; the module asserts
  nothing about it, so integration is additive.

## Verification

- `node --test impl/test/swarm-event-schemas.test.mjs impl/test/swarm-native-bridge.test.mjs
  impl/test/swarm-surface.test.mjs` → exit 0; tests 50, pass 50, fail 0.
- `impl/test/swarm-runtime.test.mjs` → 8/8 (the shared contract change breaks nothing).
- Conformance sweep (`control-surface-truth-red`, `cli-silent-start-red`,
  `phase16-mcp-northbound`, `doc-truth-conformance-red`) and `checkSurfaceDocs()` are unchanged
  versus clean HEAD (15 pre-existing RED rows before and after; no generated-doc drift — the swarm
  family is not in the committed inventories).
- Live child-process probes: `--help` and `swarm.update --help` with every
  `BATON_SWARM_BRIDGE_*` key unset → exit 0, help on stdout.

Root integration: both native discovery and custody-review captures exposed Git rejecting an
ignored dependency directory in a negative add pathspec. Stop preservation retained their exact
checkpoints; those captures/checks were not successful. Root fixed snapshot staging separately
and verified the ignored-dependency regression with real Git.
