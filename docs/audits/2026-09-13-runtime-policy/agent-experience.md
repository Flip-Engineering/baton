# Agent experience for living swarms — surface audit and interface contract

Audit date: 2026-09-13. Scope: the public agent experience for living swarms
([docs/39](../../39-swarm-runtime.md)) — the command family, the SDK, and the four-surface exposure
of the family. Files under audit and change: `impl/src/swarm-surface.mjs` (new),
`impl/src/swarm-client.mjs` (new), `impl/src/application-client.mjs`, `impl/src/application-cli.mjs`,
`impl/src/mcp-northbound.mjs`, `impl/test/swarm-surface.test.mjs` (new). The swarm runtime handlers
and the central registry live in root's checkout and are **not** modified here; §4 states the exact
interface root consumes.

Method: source reading plus executable probes. Every claim below is sourced from the tree at this
revision; line numbers are given with the symbol name so they survive drift. Where a behaviour was
observed by running something, the command and its result are quoted.

---

## 1. Executive summary

**One table is the family's public contract, and every surface derives from it.** The swarm family
is nine + one commands (`swarm.list/create/inspect/watch/update/recruit/guide/capture/check/stop`).
`SWARM_COMMAND_DEFINITIONS` (`swarm-surface.mjs:45`) carries them in the exact shape of an
`APPLICATION_COMMAND_DEFINITIONS` row — declared args, capability classes, surface flags, and the
durability pair — and `validateSwarmCommand` (`:240`) is the closed argument authority the shared
dispatch runs. The MCP wire table and the CLI verbs/help derive from that same table, so the four
surfaces cannot drift from one another.

**Exactly one seam is root's: the registry spread.** Nothing in the family is admitted on the web
bus, advertised on MCP, or connected on the CLI until root spreads `SWARM_COMMAND_DEFINITIONS` into
`APPLICATION_COMMAND_DEFINITIONS` and calls `validateSwarmCommand` from
`validateApplicationCommandArgs`. Each surface-local integration point gates on that registration
(`swarmRegisteredCommands` `:119`, `swarmWebAdmittedCommands` `:132`), so the pre-spread tree is
byte-unchanged on every derived table — verified: `surface-conformance` (the executable conformance
main), `cli-web-closure-audit`, `control-surface-audit`, `unified-capability-audit`, and
`doc-truth-conformance-red` are all green with the family unregistered, and
`swarm-surface.test.mjs` drives the same activation against a merged registry map.

**The orchestrator is the first-class caller, and the SDK never invents authority.** `createSwarms`
(`swarm-client.mjs:201`) returns `create/open/list`; a `Swarm` handle (`:52`) carries `id` plus
`inspect/watch/recruit/guide/capture/check/stop` and the domain conveniences
`group/work/assign/context/contribute/review/leave/close`, all mapping to `swarm.update`. Callers
never handle a worker id, a turn coordinate, or a fence. Client-side permissions do not exist in this
code: `caller` and `availableActions` come back from the runtime verbatim.

**Two defects were found.** The client's objective ceiling (`F1`) is fixed here: `prepareRunStart`
refused an ordinary 4,320-byte objective with `Run objective is required`, and the same predicate
also refused a long objective on `attach`, `workflow`, and `review`; the cap is gone and
non-empty/no-NUL validation stays, with a regression test. A second, pre-existing defect (`F2`) is
reported but **not** repaired here because its files are outside this task's scope: the packaged MCP
entry cannot start an application-less config, so `phase16`'s MN2/MN3 subprocess row is red at HEAD.

---

## 2. The command contract root consumes

Ten commands, all `web: true, mcp: true, reconcilable: true`, no `transportHidden` field on any row
(no hidden direct port, no side-channel exception). Capability classes are the existing
`observe | control | emergency_stop` vocabulary only.

| Command | Args | Capabilities | mcpStateful | Semantics |
| --- | --- | --- | --- | --- |
| `swarm.list` | — | observe | no | Living swarms visible to the caller |
| `swarm.create` | `purpose`, `swarmId?`, `idempotencyKey` | control, observe | yes | Mint the swarm; `swarmId` may be caller-supplied |
| `swarm.inspect` | `swarmId` | observe | no | Authoritative view (below) |
| `swarm.watch` | `swarmId`, `afterSeq?`, `timeoutMs?` | observe | no | Await the next coordination append past `afterSeq`, return the refreshed inspect |
| `swarm.update` | `swarmId`, `event`, `payload?`, `idempotencyKey` | control, observe | yes | Domain change; `event` is the closed eight-kind set |
| `swarm.recruit` | `swarmId`, `participantId`, `objective`, `options?`, `permissions?`, `idempotencyKey` | control, observe | yes | Admit + start the participant's native Run |
| `swarm.guide` | `swarmId`, `participantId`, `message`, `idempotencyKey` | control, observe | yes | Guidance, active or paused |
| `swarm.capture` | `swarmId`, `participantId`, `contributionId` | control, observe | no | Immutable code at a turn boundary; author session stays |
| `swarm.check` | `swarmId`, `participantId`, `contributionId`, `checkId` | control, observe | no | Independent check of a captured contribution |
| `swarm.stop` | `swarmId`, `participantId`, `reason`, `idempotencyKey` | emergency_stop, observe | yes | Explicit participant shutdown |

Notes that are contract, not preference:

- **`mcpStateful` ⇔ the caller key is a declared arg.** `swarm.capture`/`swarm.check` are
  identity-keyed: the coordinates *are* the key, so a repeat replays the same capture/check instead
  of minting a second one — the same posture the wave member lanes (`waves.send`/`waves.stop`) take.
  The invariant is asserted in the suite for every row.
- **`swarm.update.payload` is optional and takes either form.** An ordinary JSON object matching the
  effect kind, or a plain-text body for findings and discussion. The runtime owns effect-kind
  matching; this surface refuses only what no kind could accept (arrays, blanks, non-JSON scalars).
- **`swarm.watch` is one call, one await.** It returns the refreshed inspect — including on timeout,
  which is a refresh, not progress. No surface loops, retries, or prompts on the caller's behalf.
- **Closing is organizational; stopping is per participant.** `swarm.closed` never implies
  `swarm.stop`; the suite asserts a check never emits either.
- **Permissions are root's.** No row, SDK method, or CLI verb computes, filters, or caches an
  authority. `caller` and `availableActions` are read from the inspect view.

Closed `swarm.update` event set (`swarm-surface.mjs:27`): `swarm.group_updated`,
`swarm.work_updated`, `swarm.assignment_updated`, `swarm.context_updated`,
`swarm.contribution_recorded`, `swarm.contribution_reviewed`, `swarm.participant_left`,
`swarm.closed`. Spawn and worker binding are deliberately **not** expressible here; they ride
`swarm.recruit`.

Validation: unknown command → `swarm_command_unavailable`; any shape/closed-set/field violation →
`swarm_command_invalid` naming the field and its expectation. Requirements are exactly the required
sets above; ids are `[A-Za-z0-9._:-]{1,256}`; prompts are non-empty-after-trim and NUL-free with **no
byte ceiling** (the runtime's `FRAME_LIMITS` catalog owns size policy — see F1).

### 2.1 The inspect view (root's return shape, consumed as-is)

```jsonc
{ "swarmId", "purpose", "status",
  "participants": [{ "participantId", "runId", "role", "permissions", "bindings",
                     "runtime": { "workerId", "state", "turn" } }],
  "groups", "work", "assignments", "context",        // version/actor metadata rides the entries
  "contributions", "reviews",
  "caller": { "participantId", "permissions" },
  "updates": [{ "event", "seq" }],
  "cursor" }
```

The SDK requires `swarm.create` to name the swarm: `swarmId` at the top level (or `result.swarm.swarmId`)
— a divergent answer against a caller-supplied `swarmId` is refused as `swarm_protocol_invalid`
rather than silently rebinding the handle. `cursor` is what a caller feeds back as `watch.afterSeq`;
`Swarm.watch` defaults `afterSeq` to the cursor of the last view the handle saw.

---

## 3. The SDK

`BatonClient.swarms` (`application-client.mjs:1586`) binds the facade to the client's own command
port — the same authority every other verb rides; there is no second transport. `bindBatonPort` and
`bindBaton` both work, so the embedded leg needs no registry row of its own.

```js
const swarm = await client.swarms.create('Ship the parser fix');      // → Swarm handle
await swarm.recruit('impl-a', 'Implement X', { options: { exact: { harness, model, effort } } });
await swarm.guide('impl-a', 'Prefer the boring design.');
const view = await swarm.watch({ timeoutMs: 60_000 });                 // event-driven, no polling
await swarm.work({ workId: 'work:1', status: 'blocked' });             // → swarm.work_updated
const captured = await swarm.capture('impl-a', 'contribution:1');      // author session survives
const check = await swarm.check('reviewer-a', 'contribution:1', 'check:1'); // plain JSON
```

- **Idempotency:** `options.idempotencyKey` is optional in the SDK and minted **once per
  invocation** (`randomUUID`), never per retry loop; a caller-supplied key is passed through
  verbatim so the caller owns its retry identity. Both directions are asserted.
- **Requests are validated locally with the same function the runtime uses**
  (`validateSwarmCommand`), so a malformed call never leaves the process and the refusal code is the
  transport's own.
- **Results are the runtime's JSON, unmodified** — a contribution check is an observation about a
  captured revision, never a task-completion wrapper; a capture is the captured revision. Runtime
  refusals propagate with their `code` untouched.
- **`watch` defaults `afterSeq` to the handle's last cursor**; an explicit cursor always wins.

---

## 4. Surface derivation, and the one integration seam

Every derived table was already keyed off `APPLICATION_COMMAND_DEFINITIONS`, so the spread activates
the family everywhere at once:

| Surface | Where it derives | Change needed in this task |
| --- | --- | --- |
| Web bus | `web-northbound.mjs:22` (admission), `:158` (capabilities), `:169` (reconcilable), `:174` (read-only class), `:206/:222` (accepted args) | **None** — fully derived from the registry row |
| MCP | `mcp-northbound.mjs:21` (`APPLICATION_TOOL`), `:108` (capabilities), `:164` (stateful), `:172` (reconcilable) | Tool *definitions* added, registration-gated (`:829`), spread at `:860` |
| CLI | `application-cli.mjs:28` (web whitelist), `:1294` (parser branch), `:908` (help) | Branch + whitelist + help text, registration-gated |
| Embedded | `application-client.mjs:1586` (`get swarms()`) | The SDK facade is the embedded leg |

**Root's integration checklist** (in dependency order):

1. Spread `SWARM_COMMAND_DEFINITIONS` into `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:173`).
2. Route the swarm keys from `validateApplicationCommandArgs` (`application.mjs:1849`) to
   `validateSwarmCommand` — the same closed validation the SDK already applies.
3. Dispatch the ten commands to the runtime handlers. Return shapes: §2.1 for `inspect`/`watch` and
   for every mutation's refreshed view; `{swarmId, …}` from `create`; `swarm.capture` its captured
   revision; `swarm.check` its check JSON (never a task verdict).
4. `swarm.recruit` preflight lowers through `prepareRunStart` (`application-client.mjs:126`), now
   exported for exactly this: the same pure Run intent the client sends on `run.start`, validation
   included, so a recruitment refusal and a start refusal can never disagree about an admissible
   objective/route/scope. It is one import of the existing helper — no duplicate intent lowering.
5. Regenerate the derived artifacts, because the family moves derived counts:
   `node impl/scripts/surface-conformance.mjs --write-inventory` (the committed
   `surface-inventory-artifact.json` carries `webBusCommands`, `applicationCommandDefinitions`, and
   the MCP profile counts) and the generated doc blocks (`CLI.md`, `MCP.md` — `renderSurfaceDoc`
   byte-equals them; a stale block is a conformance finding).
6. Expect the counting pins that legitimately move with the family: `doc-truth-conformance-red`
   `WEB_BUS_DOT_NAMES_31` and R11's `webBusCommands`, `phase16`'s combined-count row, and
   `mcp-profile-parity-red`'s profile counts. The closed-set laws
   (`canonical-naming-233` case 3/4) derive from the registry and stay green **by construction** —
   that is the point of the spread: add the rows, and every derivation follows.

### 4.1 Registration gating is deliberate

The family is not "a hidden direct port with a fossil exception": it is a first-class command family
whose admission is *derived* on all four surfaces. What is gated is only the **pre-registration
state**, so that a tree without root's spread advertises exactly what it can dispatch:

- `swarmWebAdmittedCommands(APPLICATION_COMMAND_DEFINITIONS)` → `[]` today, all ten after the spread;
  `CLI_WEB_COMMANDS` (and therefore `cli-web-closure-audit`) follows the same projection.
- `swarmApplicationToolDefinitions(APPLICATION_COMMAND_DEFINITIONS)` → `[]` today; against a registry
  carrying the family it yields all ten `fleet_swarm_*` tools with envelope fields taken from each
  row's `mcpStateful` flag, and the canonical dot-name twins derive from them through the existing
  `CANONICAL_DOT_TOOL_DEFINITIONS` seam.

Both directions are asserted in `impl/test/swarm-surface.test.mjs`, so the seam is exercised before
it lands — and afterwards the same assertions hold against the live registry.

---

## 5. Findings

### F1 — The client objective ceiling refused work the application admits (fixed)

`application-client.mjs`'s `nonempty` caps any string at 4,096 bytes and was used for objectives:

```
function nonempty(value) { … && Buffer.byteLength(value) <= 4_096; }   // identifier predicate
prepareRunStart: if (!nonempty(objective)) throw clientError('Run objective is required');
```

The application's own lane row (`limits.mjs:63`, `run.objective`) is `graceful:
'spill-digest-citation'` with `enforcedAt: 'application run.start admission'`: the inline path admits
an over-cap objective and mints a durable spill artifact rather than refusing or truncating. So the
client cap was a client-only defect: an ordinary 4,320-character objective failed with `Run objective
is required`, and the *same* predicate silently affected `prepareWorkflowStart`,
`prepareReviewStart`, and `BatonRun`'s metadata check — `runs.attach` refused the long objective a
Run was already running under.

Fix: `promptText` (`application-client.mjs:22`) — non-empty-after-trim and NUL-free, **no byte
ceiling** — used at all five objective sites (`:124`, `:185`, `:235`, `:857`, `:1347/:1352`).
Nothing is truncated. Regression tests: "a long objective reaches the port intact and is never
truncated" and "the objective contract stays non-empty and NUL-free" (12,000-byte objectives on
`start`/`explore`/`workflow`, plus the attach path; empty, whitespace-only, and NUL-bearing
objectives still refuse before the port is touched).

### F2 — The packaged MCP entry cannot start an application-less config (pre-existing, out of scope)

`scripts/mcp-stdio.mjs:30` constructs the server with `surface: configured.surface ?? 'combined'`,
while `McpFleetServer`'s constructor (`mcp-northbound.mjs:1478`) refuses a `combined` surface with no
application. A config module that supplies a coordinator and coordination store but no application —
exactly what `phase16-mcp-northbound.test.mjs:608` writes — therefore dies at startup with
`internal_error: MCP surface requires an available application or an explicit advanced surface`.
The same row also pins `responses[1].result.tools.length === 19` while the live application surface
serves 37 tools (`mcpApplicationToolNames().length`). Both conditions exist unchanged at HEAD
(`git show HEAD:impl/scripts/mcp-stdio.mjs:30`, `git show HEAD:impl/src/mcp-northbound.mjs:1438`),
so the row is red at HEAD and red after this change; it is reported here rather than repaired,
because `scripts/mcp-stdio.mjs` and that test file are outside this task's path scope. Either the
default should resolve to `'advanced'`/`'application'` from the provided options, or the row's
fixture must supply an application — a decision for the MCP packaging owner.

### F3 — Verified pre-existing reds (not regressions)

For the avoidance of doubt, the following were failing before this change and are unaffected by it:
`phase64-application-cli` UC2b (the client returns the full command budget for `run.status`, 90,000,
where the row pins 45,000 — `requestTimeoutMs = options.commandTimeoutMs` at HEAD:2059),
`scratchpad-write-red` (9 named red stages), `launch-validation-red` (9 named red stages), and
`mcp-profile-parity-red` (13 named red stages / 8 green pins). Each named stage is the row's own
declared missing rung.

---

## 6. Verification

Verification contract (Baton): `node --test impl/test/swarm-surface.test.mjs` → **14 tests, 14 pass,
0 fail** (exit 0). The suite covers: the registry rows and their invariants; the closed validation
refusals and the no-ceiling rule; web/CLI/MCP registration gating in both directions; the CLI parser
table (all ten verbs, flags, JSON/text payloads, help routing, typed refusals); the MCP tool table
activation and envelope-field derivation; the four first-class workflows through a fake command port
(orchestrator create-and-recruit-later; delegated coordinator reading `availableActions` then updating
groups/context; reviewer capturing and checking a partial contribution without touching the author;
implementer reading shared context and contributing a plain-text finding); event-driven `watch`
resuming from the last cursor; SDK idempotency-key minting/reuse; refusal propagation; and the F1
objective regressions.

Regression sweep (unchanged or expected-red, all matched):

```
surface-conformance: ok                 cli-web-closure-audit exit=0
control-surface-audit exit=0            unified-capability-audit exit=0
frame-economics-red 50/50               canonical-naming-233-red 4/4
doc-truth-conformance-red 13/13         phase64-integrated-run-application 35/35
phase67-progressive-agent-experience 12/12   issue10-p0-agent-experience 8/8
error-actionability-red 22/22           phase68-unified-agent-entrypoint 21/21
mcp-tool-map-red 2/2                    unified-mcp-surface 10/10
grammar-m4b-red 7/7                     mcp-packaging-red 18/18
cli-dead-paths-red 9/9                  cli-truthfulness-red 7/7
participant-contributions 5/5           contribution-verification 4/4
```
