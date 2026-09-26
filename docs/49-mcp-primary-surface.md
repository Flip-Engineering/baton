# 49 — MCP as the primary agent surface: a core tool set, one entry story, receipts and wakes, reincarnation survival (issue #314)

Design direction: 2026-09-18. The core projection, entry points, receipts, wakes, and resident
reconnection are implemented. Their contracts are covered by
`impl/test/issue314-core-table.test.mjs`, `issue314-mcp-core-surface-red.test.mjs`,
`issue314-lane2-receipts-wakes.test.mjs`, and `issue314-lane3-reincarnation-rebind.test.mjs`.

The production application surface exposes eight core tools: `baton_deployment`, `baton_run`,
`baton_swarm`, `baton_waves`, `baton_knowledge`, `baton_wakes`, `baton_services`, and
`baton_surface`. The raw `McpFleetServer` application table contains 57 tools after the #566
restoration; the production wrapper projects that table into the core families. The startup
gate in `impl/test/mcp-web-startup-gate.test.mjs` checks the composed entry point and its gate
selection for application entry-point and bridge changes.

The original issue measured 52 flat `baton_*` tools on the ordinary surface (the generated
inventory, impl/MCP.md §Tool inventory) plus six `baton_surface_*` meta tools the production
wrapper merges — **58 tools, 64,629 bytes of schema on every `tools/list`** (measured). An
orchestrator running lanes needs about a dozen operations (the issue names them: doctor, run
start/view/send/stop, swarm create/recruit/view/guide/update/capture/check/watch, and the #294
wake subscription). Every tool schema costs an agent client context on every turn, so the
default surface must BE the small set. Two entry points (`impl/scripts/mcp-web.mjs`, the
resident bridge, and `impl/scripts/mcp-stdio.mjs <descriptor.json>`, the descriptor) both
authenticate today, but the guide leads with the descriptor (impl/MCP.md:1, "descriptor-first")
although the bridge is the one that carries swarms and wakes. Mutations return the whole view
(run.start/run.stop answer the full outline — `BatonWebApplicationFacade.command`,
impl/src/mcp-web-bridge.mjs:638-665). And a bridge session is bound to one resident
incarnation: the connection is discovered ONCE (`connectBatonWebApplication`,
impl/src/mcp-web-bridge.mjs:695), the socket path embeds the incarnation (docs/48 §1), and a
reincarnation withdraws that socket — the wake plane then reconnects to the dead address forever
(`WakeSubscriptions._scheduleReconnect`, impl/src/mcp-web-bridge.mjs:349-355) and every command
fails.

## 0. Rules that do not change

- **One authority path** (docs/36 §1.3). The core table is a PROJECTION of the registry over
  the same dispatch, never a second dispatch. The wire card stays the bridge's admission
  authority (`_admits`, impl/src/mcp-web-bridge.mjs:452-459).
- **Constrain by construction** (docs/36 L8): a principal's inventory is
  `render(filter(registry, capabilities ∪ profile))`. The core is a profile projection, not a
  hand list.
- **One operation table** (#289): the canonical operations and their names derive from the
  registry; this design adds no operation, retires none from the registry, and renames none.
- **#302 receipts, #294 one attachment per session, #343/#349 frame narrowing, #430/#436 typed
  refusals** — all landed; this design composes them and mints no new refusal code and no new
  wake class.
- **The CLI is unchanged.** `baton swarm watch --follow` and the bounded watch stay (docs/39
  §Waking the orchestrator); the retirement below names MCP tools only.
- **The kernel/authoring/host profiles stay un-unified** (docs/36 §11). The descriptor's
  `advanced`/`combined` surfaces serve what they serve today.

## 1. Measured baseline

These measurements describe the 2026-09-18 baseline before the core projection. The current
tool counts are stated above; the historical schema byte counts below belong to that baseline.

| fact | value | source |
|---|---|---|
| ordinary-surface tools | 52 | `ORDINARY_APPLICATION_TOOL_DEFINITIONS`, impl/src/mcp-northbound.mjs:1086; `mcpApplicationToolNames()`, :2960 |
| `baton_surface_*` merged by the wrapper | 6 | impl/src/surface-capability-catalog.mjs:531-558 (4), impl/src/surface-capability-resolution.mjs:59,83 (2) |
| wire total a client pays | **58 tools / 64,629 bytes** | measured through `wrapProductionMcpServer` (both entries wrap: impl/scripts/mcp-stdio.mjs:36, impl/scripts/mcp-web.mjs:40) |
| largest tool today | `baton_swarm_update`, 5,253 B (descriptor form) | measured |
| bound bridge form strips `repoId`/`idempotencyKey` | 55,618 B | impl/src/mcp-northbound.mjs:1849-1857 |
| blocking reads advertised | `baton_run_attention_watch`, `baton_swarm_watch` | the inventory |
| run.start/run.stop answer | the whole run outline | impl/src/mcp-web-bridge.mjs:638-665 (`_inspectOutline`) |
| connection discovery | once, at session open | impl/src/mcp-web-bridge.mjs:695-739 |
| stale-incarnation refusal exists | `resident_incarnation_mismatch`, retryable | impl/src/application-cli.mjs:357-359, raised at :4780-4784 |
| wake attachment end is typed | `baton.wake_attachment_closed`, reason `resident_stopping` | docs/48 §3 (#316 b) |
| `incarnation_changed` wake class | landed, deployment scope, non-terminal | impl/src/wake-stream.mjs:257-273 |

## 2. The core tool set

**Law (a).** The default ordinary surface advertises exactly **one tool per family, each a
`verb`-discriminated closed schema** (the docs/36 grammar: `noun.verb` becomes `tool {verb, ...}`;
H7's depth cap becomes the tool count). No flat `baton_<noun>_<verb>` spelling is advertised by
default; the migration table (§7) maps every one of them. Seven families landed with #314; #317
added the eighth (`baton_services`) without changing the rule — a new family joins the same way.

**Landed (#314 lane 1; #317 added the eighth family).** The production wrapper
(`production-mcp-convergence.mjs`) advertises exactly these eight tools on the ordinary (`application`) surface — the surface both entry scripts
serve — and the raw `McpFleetServer` keeps its flat table for embedders and its own pins; rows
314-a (the name set) and 314-c (the closed schema shape) are green. `advanced`/`combined` are
untouched (§9). The tables' third column is on the core rows too: each long verb carries its
`wake` handoff (`kinds` + `settleOn`), validated against the landed `WAKE_CLASS_TABLE` when the
table loads, and `coreVerbFacts(tool, verb)` answers `{mutation, long, wake}` for the answer
composer — the §10 ownership row, read by lane 2.

The schema law, per core tool (the red file carries the designed schemas as executable data):

```jsonc
{
  "type": "object", "additionalProperties": false,
  "required": ["repoId", "verb"],            // repoId stripped on the bound bridge surface, as today
  "properties": { "verb": { "type": "string", "enum": [/* the tool's closed verb set */] },
                  /* the union of every verb's fields, each spelled exactly once */ },
  "oneOf": [ /* one branch per verb: {properties: {verb: {const: <verb>}}, required: [verb, ...itsFields]} */ ]
}
```

A field one verb requires and another forbids is never optional-at-the-top-level: the oneOf
branch owns the per-verb closure, so a `swarmId` on a `list` call refuses `invalid_arguments`
naming the field — the house closed-set teaching pattern (impl/src/mcp-northbound.mjs:1431-1435)
applied per verb.

The eight tools and their core verb sets. **Receipt** names the answer shape (§5); **wake
handoff** names the classes the answer's subscription carries for a long verb and the
`settleOn` subset whose frame settles the follow-up (class vocabulary:
impl/src/wake-stream.mjs:121-326, never extended by this design).

### `baton_deployment` — 1 verb

| verb | required fields | receipt | wake handoff |
|---|---|---|---|
| `doctor` | — | the readiness answer (read; quota-free, per-call fresh — unchanged) | — |

### `baton_run` — 7 verbs

| verb | required fields | receipt | wake handoff |
|---|---|---|---|
| `start` | `intent`, `idempotencyKey` | `{command, event, changed: [runs/<runId>], next}` | kinds `attention`, `paused`, `integrated`; settleOn the same — the run's turn pause, its attention ask, or its integration |
| `view` | `runId` | the view (read: `depth`/`section`/`role`/`generation`/`cursor`/`pageCursor`; **no `waitMs`** — §5) | — |
| `list` | — | the page (read) | — |
| `send` | `runId`, `body` | the message-lane outcome (as `baton_run_message_send` answers today) | — |
| `stop` | `runId`, `reason`, `idempotencyKey` | the stop receipt | — |
| `answer` | `runId`, `requestId`, `answer`, `idempotencyKey` | the settlement receipt (incl. the landed distinct `already_resolved` outcome) | — |
| `do` | `runId`, `actionId`, `inputs`, `idempotencyKey` | the action's outcome | — |

Judgment calls beyond the issue's named set, stated: `list` (discovery — a reconnected
orchestrator cannot otherwise find its runs), `answer` and `do` (without them an orchestrator
cannot settle the attention its own starts raise — docs/36 §7.3's settlement verbs). Member
addressing (`run.member.*`) and the message receipt read stay behind the surface (§3).

### `baton_swarm` — 8 verbs

| verb | required fields | receipt | wake handoff |
|---|---|---|---|
| `create` | `purpose`, `idempotencyKey` | the #302 receipt (`swarm.created`) | — |
| `list` | — | the page (read) | — |
| `view` | `swarmId` | the sliced view (read: `participantId`/`projection`/`cursor` — #283/#343, unchanged) | — |
| `update` | `swarmId`, `event`, `idempotencyKey` | the #302 receipt | — |
| `recruit` | `swarmId`, `participantId`, `objective`, `idempotencyKey` | the #302 receipt + `admission` | scope `swarms: [swarmId]`, `participants: [participantId]`; kinds `queued`, `refused`, `dead`, `reroute_proposed`, `contribution_recorded`; settleOn `refused`/`dead`/`reroute_proposed`/`contribution_recorded` |
| `guide` | `swarmId`, `participantId`, `message`, `idempotencyKey` | the #302 receipt (`guide: {seq, ts, messageId}`) | — |
| `capture` | `swarmId`, `participantId` | the #302 receipt (identity-keyed, as today) | — |
| `check` | `swarmId`, `participantId`, `contributionId` | the #302 receipt | kinds `reviewed`; settleOn `reviewed` (the frame naming the contribution) |

`swarm.stop` and `swarm.integrate` stay behind the surface (§3): the first is the
`emergency_stop` capability class, the second is the root's landing verb — neither is lane
pacing. `swarm.watch` is retired from MCP (§5).

### `baton_waves` — 5 verbs

| verb | required fields | receipt | wake handoff |
|---|---|---|---|
| `start` | `members`, `idempotencyKey` | `{waveId, members: [{role, runId}]}` (unchanged shape) | kinds `attention`, `paused`, `integrated`; settleOn the same, correlated by the receipt's member runIds |
| `list` | — | the page (read) | — |
| `progress` | `waveId` | the paged projection (read) | — |
| `send` | `runId`, `message` | the lane outcome | — |
| `stop` | `runId`, `reason` | the stop receipt | — |

`waves.attach`/`waves.compile`/`waves.run` stay behind the surface: the bridge session IS the
attachment lifetime, and spec compilation is a build-time act.

### `baton_knowledge` — 2 verbs

| verb | required fields | receipt |
|---|---|---|
| `search` | — | the evidence-search answer (read; the seq cursor — #312 — unchanged) |
| `seed` | `runId`, `type`, `grounding`, `body` | the seed receipt (idempotent under the server-derived key, as today) |

The scratchpad trio and the settlement pair stay where they already live: scratchpad reads/appends
are seat-side verbs (behind the surface for an orchestrator), and the settlement pair is
descriptor-kernel only, never bridged (the U-G3 posture,
impl/test/mcp-bridge-admission.test.mjs:390-405).

### `baton_wakes` — 3 verbs

| verb | required fields | receipt |
|---|---|---|
| `subscribe` | — | the landed subscription receipt `{subscriptionId, since, kinds, swarms, participants, cursor, attachments}` |
| `since` | — | one bounded page with the typed continuation (`boundWakePage`, impl/src/mcp-web-bridge.mjs:149-184) |
| `unsubscribe` | `subscriptionId` | `{subscriptionId, open: false, ...}` (as today) |

The brief's six-family parenthetical (run, swarm, waves, surface, knowledge, deployment) is
extended with `wakes` as a seventh family because #294 already made `wakes.*` a noun family in
the registry (the generated inventory carries `wakes.subscribe`/`wakes.since`/`wakes.unsubscribe`
as canonical operations); folding it under `deployment` would break H1's derivation for no
saving.

### `baton_surface` — 6 verbs

The six `baton_surface_*` meta tools fold into one tool, fields unchanged
(impl/src/surface-capability-catalog.mjs:530-558,
impl/src/surface-capability-resolution.mjs:59-83): `catalog`, `describe`, `invoke`, `snapshot`,
`watch`, `visualize`. This tool IS the progressive disclosure (§3) — `describe` also absorbs
`baton_help`/`baton_application_help` (a `name` the catalog lists, or a help topic).

### `baton_services` — 1 verb (#317)

| verb | required fields | receipt | wake handoff |
|---|---|---|---|
| `list` | — | the deployment's configured services: models offered, routes derived, subscription usage and reset instant (read; quota-free) | — |

**33 core verbs across 8 tools.** Everything else an orchestrator might need is one
`baton_surface invoke` away; everything else entirely is the CLI's.

## 3. Progressive disclosure and the byte budget

**Law (b).** `tools/list` on the default surface carries the core tools and nothing else. The
rest opens through `baton_surface`: `catalog` lists the capability inventory this deployment
profile serves (the landed mechanism), `describe` answers one capability's live schema and
posture, `invoke` routes it through the authority it already has. A caller that knows a legacy
spelling gets taught the core verb by the refusal (§8) without a `tools/list` round trip.

The production wrapper advertises eight core tools. The #566 composition measures 21,230
serialized bytes in the descriptor fixture used by the core-surface tests. The raw application
table has 57 flat tools; the resident bridge filters that table through its admission policy.
`baton_surface` resolves capabilities through their existing authority paths. A flat spelling
folded into a core family refuses with `movedTo` (§8, row 314-g).

The six unified `baton_surface_*` spellings remain accepted as unadvertised aliases of their
core verbs. The CLI MCP client in `configured-mcp-client.mjs` uses these aliases.

The byte-budget test derives its bound from the designed schemas:

```
budget = designedCoreTools().length × largest designed schema's serialized bytes
```

Row 314-b compares the serialized `tools/list` result against this bound. The name-set test
checks all eight families. Changes to the designed schemas change the derived budget.

## 4. One entry story

**Law (c).** MCP.md leads with the resident bridge; the descriptor is documented as the
headless mode for a host without a resident.

- **The story:** `baton serve` in the checkout, then point the harness's MCP config at
  `node impl/scripts/mcp-web.mjs` — no arguments, no descriptor, no credentials in the config:
  the bridge discovers the published connection exactly as the CLI does
  (`discoverBatonConnection`, impl/src/application-cli.mjs:728) and the principal IS the
  connection's session identity (impl/src/mcp-web-bridge.mjs:735-745).
- **The headless mode:** `node impl/scripts/mcp-stdio.mjs <descriptor.json>` — a host with no
  resident declares repo, routes, principal and quotas in one bounded closed document (read
  once at open, immutable — impl/src/mcp-descriptor.mjs:1-9).
- **One table, gate-checked:** both entries construct the same `McpFleetServer` ordinary table
  (impl/src/mcp-northbound.mjs:1834-1835) over the same registry, and the constructor's card
  contract (:1802-1811) already refuses a facade that cannot dispatch what it advertises. The
  entry parity assertions both scripts already run
  (`assertCliMcpControlParity`/`assertUnifiedCapabilityCoverage`/`assertSurfaceCapabilityNameClosure`
  — impl/scripts/mcp-stdio.mjs:22-24, impl/scripts/mcp-web.mjs:23-25) keep it one table.
- **One cleanup:** `impl/scripts/mcp-web.mjs:25-27` today accepts a descriptor and builds a
  descriptor server from the BRIDGE entry — the ambiguity the issue names. The bridge entry
  refuses an argument (`usage: baton-mcp-web` + exit 2); the descriptor moves to
  `impl/scripts/mcp-stdio.mjs` alone.
- On the bound bridge surface `repoId`/`idempotencyKey` stay server-derived
  (impl/src/mcp-northbound.mjs:1849-1857) — the core schemas carry them only on the descriptor
  surface, exactly as the flat tools do today.

> **Landed (2026-09-18, lane 4).** `impl/MCP.md` leads with `## The resident bridge (the entry
> story)` and documents the descriptor as `## The headless mode (a host without a resident)`;
> `impl/scripts/mcp-web.mjs` refuses any argument with the typed `cli_invalid` (usage line, exit
> 2) whose message names `mcp-stdio.mjs`, and it no longer builds a descriptor server. Red row
> 314-h is green; `impl/test/mcp-web-entry-story.test.mjs` pins the entry policy and both entries'
> shared gate (ES-A/ES-D), and the doc-versus-wire parity beside it (ES-B/ES-C).

## 5. Receipts and wakes — never a blocking call

**Law (d).** Every mutation verb answers a **receipt**, and every long operation's answer adds a
**wake handoff**; no core verb blocks.

```jsonc
// a mutation answer on the core surface
{
  "schemaVersion": 1,
  "command": "swarm.recruit",
  "receipt": { "command": "...", "event": { "kind": "...", "seq": 0, "ts": "...", "actor": "..." },
               "changed": [{ "collection": "...", "id": "...", "seq": 0, "ts": "..." }],
               "next": { "command": "...", "args": {} } },   // the landed #302 shape
  "wake": { "subscriptionId": "wake-sub:…", "since": 0,
            "kinds": ["…"], "swarms": ["…"], "participants": ["…"],
            "settleOn": ["…"] },                            // long verbs only; absent otherwise
}
```

- The receipt is the #302 derivation (`swarmChangedRow`/`swarmReceiptNext`,
  impl/src/swarm-contract.mjs — the ONE mapping), extended to the run and waves families: the
  run/waves receipt's `event` is the durable row the operation recorded, derived the same way,
  never a second shape. The whole view NEVER rides a mutation answer by default; `view: true`
  opts in, as the swarm family already does. `run.start`/`run.stop` stop answering the outline
  (impl/src/mcp-web-bridge.mjs:638-665 is retired).
- The wake handoff is a subscription on the session's ONE wake plane (#294 — one upstream
  attachment however many subscriptions; impl/src/mcp-web-bridge.mjs:82-98), opened by the
  server as part of answering, filtered to the operation's subject per §2's tables. `settleOn`
  names the subset of the handoff's classes whose frame SETTLES this operation's follow-up (it
  is a per-operation property, deliberately distinct from the class table's `terminal` flag,
  which speaks about the subject's lifecycle — impl/src/wake-stream.mjs:122 vs :167). A frame in
  `settleOn` naming the subject is the client's cue to re-read and act; the subscription is the
  client's to keep or `unsubscribe`.
- **Retired from MCP:** `baton_run_attention_watch` and `baton_swarm_watch` — blocking reads an
  agent must never hold a turn on. `baton_wakes subscribe` with a `swarms`/`kinds` filter is the
  same information as a feed, and `baton_wakes since` is the bounded pull. The CLI keeps both
  legs of the same stream: `baton swarm watch --follow`, unchanged, and
  `baton deployment wakes-since` (#507), which prints one bounded page of the same frames.
  `run.view` carries no `waitMs` on the core schema;
  the change-aware read is a subscription plus a re-view.
- `baton_surface watch` stays: it is the bounded composite notification loop for an operator
  client, not a per-operation block.

> **Landed (2026-09-18, lane 2 — receipts and wakes).** Law (d) is live on the served surface, and
> the pieces are:
>
> - **The composer.** `coreMutationAnswer({command, args, result, wake})` (impl/src/mcp-northbound.mjs)
>   is the ONE answer shape, and `coreDerivedReceipt`/`coreWakeHandoffFilter`/`coreWakeHandoff` are
>   its derivations. The bridge facade applies it on its dispatch seam (`BatonWebApplicationFacade.command`);
>   the command → verb facts come from the core table itself (`coreCommandFacts`,
>   impl/src/mcp-core-tools.mjs), never a bridge-side hand list — an application command the core
>   does not fold in keeps the answer its own lane sends, untouched.
> - **One derivation, never a second.** An answer that already carries a receipt — every swarm
>   mutation, the runtime's own `_mutationResult` — rides through UNTOUCHED beside the envelope's
>   `schemaVersion`/`command`; only the run/waves/knowledge families, which answer a projection
>   today, derive one (the row the answer's identity names, the outcome the projection itself
>   carries, and `event: null` — the landed #302 rule for an effect whose answer names no recorded
>   event). The whole view never rides the answer; `view: true` opts in, as the swarm family already
>   does.
> - **The blocking answer is gone.** `_inspectOutline` (the run.start/run.stop follow-up read that
>   answered the whole outline) is retired, along with its `run_inspect` round trip; a mutation
>   returns as soon as its receipt exists.
> - **The four long verbs** — `run.start`, `swarm.recruit`, `swarm.check`, `waves.start` — answer
>   `{receipt, wake}` where `wake` is the landed subscription receipt verbatim (its own filter echo
>   and cursor) plus `settleOn`. The subscription opens on the session's ONE plane, filtered by the
>   classes AND the scope axes §2's third column declares (`recruit` by swarm and participant,
>   `check` by swarm, the run/waves families by classes alone — the #294 filter has no run axis,
>   §12 Q2); frames are delivered through the session sink the MCP server installs at construction
>   (the same sink an explicit `baton_wakes subscribe` delivers through).
> - **#479.** `baton_deployment {verb: doctor}` projects the client's own `doctor()` result
>   including its `stopping` section (#467/#476) — `null`, never absent, for a resident that is not
>   stopping.
>
> Pins: `impl/test/issue314-lane2-receipts-wakes.test.mjs` (the four long verbs over the production
> bridge, the receipt identity against a real `SwarmRuntime` receipt, the doctor projection), and
> red row 314-d2 (green; its manifest row retired). The U-E2 row of `impl/test/unified-mcp-surface.test.mjs`
> now routes the meta block and the three meta calls through `baton_surface {verb}` (its own law —
> advertised == dispatchable, no kernel merge, the ghost refused — is unchanged, and its manifest
> row is retired).
>
> **Hand-back NOT taken — the inventory renderer, blocked by an out-of-scope hunk.** Hand-back (i)
> (`renderMcpToolInventory()` renders the SHIPPED core table + MCP.md regenerated, lane 4's ES-B
> green) is implemented and measured, and it CANNOT land alone: the moment MCP.md's block lists the
> seven core tools, `runSurfaceConformanceMain`'s CS-1 profile parity compares it against
> `instantiateProfileInventory('mcp.application')` — which still returns the RAW flat table
> (`mcpApplicationToolNames()`, impl/scripts/surface-conformance.mjs:464, and the inventory artifact's
> `counts.mcpApplicationTools`/`pins.batonRunsAdvertised` at :713/:735) — so `surface-gate.mjs` goes
> red and `run-suite.mjs` refuses before any test (measured: gate exit 0 at the base commit, exit 1
> with the renderer switch alone, 32 `documented but unserved` findings). The pair must travel
> together: (1) `impl/scripts/render-surface-docs.mjs` `renderMcpToolInventory()` (this lane's one-line
> shape above), (2) `impl/scripts/surface-conformance.mjs`'s `mcp.application` inventory + its
> regenerated `impl/scripts/surface-inventory-artifact.json` (`node impl/scripts/surface-conformance.mjs
> --write-inventory`), (3) `node impl/scripts/render-surface-docs.mjs`. Until then ES-B is listed in
> the expected-red manifest under `#314` (it was red at this base and unlisted) and MCP.md's inventory
> block still documents the flat table — the two rows the pair closes.
> `mcp-profile-parity-red.test.mjs`'s RG-10b/RG-10c read the flat counterparts out of that same block
> and move with it (already tracked under `#156`).

## 6. Reincarnation survival

**Law (e).** A bridge session survives a resident reincarnation (#306): it re-attests against
the successor transparently, the client learns it through ONE typed notification, and an
in-flight call at the boundary is retried once — never surfaced as a session-fatal error.

Today the session dies with the incarnation: the connection (socket path + token) is read once
(impl/src/mcp-web-bridge.mjs:695-739), the socket path embeds the old incarnation (docs/48 §1),
the old withdraws it at the handoff's end (docs/48 §2 step 7), and the wake plane's reconnect
loop re-dials that dead address forever (:349-355). The pieces the fix composes already exist —
discovery, the per-dispatch attestation (:505-519), the retryable stale-incarnation refusal
(impl/src/application-cli.mjs:357-359), the typed attachment end, the `incarnation_changed`
class. The design:

1. **The rebind authority.** `BatonWebApplicationFacade` gains a construction option
   `rediscover: () => Promise<{client, card, session}>` — the same discovery and session
   establishment as the open path. `createBatonWebMcpServer` supplies it; a facade constructed
   without one (a test, an embedder) keeps today's behavior exactly.
2. **Triggers.** Three, all already typed: a command answered `resident_incarnation_mismatch`;
   the wake attachment ending with `resident_stopping` (or its socket refusing the reconnect);
   a command whose transport refuses the dead socket. None is a new code.
3. **Re-attestation.** The successor's session must name the SAME `userId`, carry a SUPERSET of
   the bound capabilities, and scope the same repoId (the `_reattestSession` comparison,
   impl/src/mcp-web-bridge.mjs:487-502) — with one relaxation, explicit and scoped to the
   rebind: the resident-issued `sessionId` is re-minted per incarnation and re-binds. The
   client-facing principal (the MCP session's own identity) never changes. A successor whose
   session narrows the grant is not a reincarnation for this session: the rebind refuses
   `application_unauthorized` and the session ends typed, as an authority change does today.
4. **The swap is atomic at the dispatch epoch.** The per-dispatch attestation key
   (:505-519) means a rebind lands BETWEEN dispatches; no dispatch straddles two clients. The
   wake plane keeps its subscription records and its `_cursor`; only the client it opens
   against changes, and the resumed attachment reads the SAME ledger from that cursor — a gap
   of nothing, including the `host.reincarnated` row, which reaches wake subscribers as the
   landed `incarnation_changed` class.
5. **ONE typed notification.** After a successful rebind the session emits exactly one
   `notifications/baton/resident_reincarnated` with `{from, to, cursor}` — a session-lifecycle
   fact beside `notifications/baton/wake` (impl/src/mcp-northbound.mjs:926), delivered to the
   client whether or not it holds a subscription, exactly once per handoff. It is NOT a wake
   class: the wake table is the deployment's vocabulary; this is the session's own authority
   event.
6. **An in-flight call during the window** either completes on the old incarnation (the drain
   serves it — docs/48 §2 steps 2-3) or fails typed retryable; the facade then rebinds and
   retries ONCE under the SAME derived idempotency key (`_mutationKey`,
   impl/src/mcp-web-bridge.mjs:522-530): the coordination ledger is the deployment's, shared
   across incarnations, so a replayed mutation returns the first attempt's receipt and a
   replayed read is just a read. A second failure propagates as the refusal it is.
7. **A resident that is DOWN, not reincarnating, changes nothing:** rediscovery finds no
   successor publication over the same deployment id, calls keep their typed refusals, and the
   wake plane keeps its bounded reconnect cadence.
8. The descriptor (headless) mode has no resident and no reincarnation story: the deployment is
   the process; nothing here applies, and nothing there changes.

> **Landed (2026-09-18, lane 3).** Law (e) is closed, and the design above landed with three
> recorded deltas. (1) The rebind authority is `openBatonWebConnection(options)` — the SAME
> exported derivation `connectBatonWebApplication` opens through — and its answer carries a fourth
> fact, the `incarnation` the connection names, so `from`/`to` are the incarnations themselves and
> not a digest restated by hand; `createBatonWebMcpServer` supplies it whenever the caller did not
> hand an explicit connection (an embedder that did has no publication to re-read and keeps
> today's behavior exactly). (2) Item 2's trigger list is read through ONE classification
> (`_rebindableFailure` / `_incarnationGone`): the stale-incarnation refusal and the web
> transport's own refusal from a dispatch, a `resident_stopping` end (or a socket refusing the
> reconnect) from the plane, and the `incarnation_changed` class — with the #306r reading that a
> `host.reincarnation_failed` row is NOT a handoff (the predecessor re-took its authority and the
> publication still names it), and a handoff is never bound twice before the session is back in
> contact with the incarnation it bound. (3) Item 6's retry is `_onceAfterRebind`: it wraps the
> dispatches AND the reads a dead transport can meet (`command`, `doctor`, `actionAuthority`,
> `authorizeReplay`, `wakeSince`), and the idempotency key is derived once, before the retry.
> Notification method: `notifications/baton/resident_reincarnated` (mcp-northbound.mjs, beside
> `WAKE_NOTIFICATION_METHOD`). Pinned by `impl/test/issue314-lane3-reincarnation-rebind.test.mjs`
> (five rows — a staged handoff over a real resident, an applied-once mutation, a surviving
> subscription resumed from its cursor, the failed-handoff arm, and the method routing).

## 7. The migration table

**Law (f).** Every tool the current guide documents maps to exactly one core verb, one surface
operation, or a named retirement. The red file carries this table as executable data and checks
it against impl/MCP.md on every run, so a tool added to the inventory without a mapping is red.

| today's tool | lands as |
|---|---|
| `baton_deployment_doctor` | `baton_deployment {verb: "doctor"}` |
| `baton_run_start` / `baton_run_stop` | `baton_run` `start` / `stop` |
| `baton_run_view` / `baton_run_inspect` / `baton_run_episode` | `baton_run {verb: "view"}` (the depth/section/role/generation axes fold in) |
| `baton_runs` | `baton_run {verb: "list"}` |
| `baton_run_message_send` | `baton_run {verb: "send"}` |
| `baton_decision_answer` | `baton_run {verb: "answer"}` |
| `baton_run_act` / `baton_run_do` | `baton_run {verb: "do"}` |
| `baton_run_knowledge_seed` | `baton_knowledge {verb: "seed"}` |
| `baton_evidence_search` | `baton_knowledge {verb: "search"}` |
| `baton_swarm_create` / `list` / `view` / `update` / `recruit` / `guide` / `capture` / `check` | `baton_swarm` with the same verb |
| `baton_waves_start` / `list` / `progress` / `send` / `stop` | `baton_waves` with the same verb |
| `baton_wakes_subscribe` / `since` / `unsubscribe` | `baton_wakes` with the same verb |
| `baton_surface_catalog` / `describe` / `invoke` / `snapshot` / `watch` / `visualize` | `baton_surface` with the same verb |
| `baton_help` / `baton_application_help` | `baton_surface {verb: "describe"}` |
| `baton_run_member_view` / `baton_run_workstreams` | surface: `run.member.view` |
| `baton_run_member_send` / `baton_workstream_notify` | surface: `run.member.send` |
| `baton_run_member_stop` / `baton_workstream_stop` | surface: `run.member.stop` |
| `baton_run_message_receipt` | surface: `run.message.receipt` |
| `baton_run_scratchpad_read` / `append` / `elevate` | surface: `run.scratchpad.*` (seat-side verbs) |
| `baton_swarm_stop` | surface: `swarm.stop` (the `emergency_stop` class) |
| `baton_swarm_integrate` | surface: `swarm.integrate` (the root's landing verb) |
| `baton_waves_attach` / `compile` / `run` | surface: `waves.attach` / `waves.compile` / `waves.run` |
| `baton_scratchpad_elevate` / `baton_scratchpad_settle` / `baton_knowledge_promote` / `baton_knowledge_settlement_lease` | descriptor kernel profile, never bridged — the landed U-G3 posture, unchanged |
| `baton_run_attention_watch` | **retired** — `baton_wakes {verb: "subscribe"}` replaces it |
| `baton_swarm_watch` | **retired from MCP** — `baton_wakes {verb: "subscribe", swarms: [id]}` replaces it; the CLI keeps `baton swarm watch` |

The migration table groups legacy spellings by destination. Field mappings come from the
legacy tool schemas in `impl/src/mcp-northbound.mjs` and the swarm command table; the core
schema tests check their projection.

> **Landed (2026-09-18, lane 4) — the guide half.** `impl/MCP.md`'s `## Migration from the flat
> tool set` is a GENERATED block rendered from this section by
> `impl/scripts/render-surface-docs.mjs` (`renderMcpMigrationTable`, marker
> `mcp-migration-table`; `--check` refuses a drifted guide, and a §7 whose table shape cannot be
> read refuses to render at all). 314-f's guard now reads the documented set as §7's rows ∪ the
> seven core names — a core tool is its own target, so only a legacy spelling needs a row here —
> and the served-surface clause beside it is lane 1's projection, red until the core surface
> lands.

**Landed (#314 lane 1).** The served-surface clause holds: no spelling this table moves behind
`baton_surface` or retires is advertised by default (row 314-f's red clause is green), and every
moved spelling refuses with its `movedTo` pointer — the pointer set is derived in
`impl/src/mcp-core-tools.mjs` from each verb's `replaces` plus that spelling's canonical dot twin,
never a second hand list. The MCP.md coverage half of law (f) is lane 4's.

## 8. The refusal set

**Law (g).** The core surface mints NO refusal code. The set a client can meet:

- `unknown_tool` (the landed code, impl/src/mcp-northbound.mjs:2036-2046) for a name the core
  does not advertise — with one DATA addition, never a new code: when the requested name is a
  retired or moved flat spelling, `data.movedTo: {tool, verb}` names its core replacement beside
  the landed `{code, requested, nearest, tools}`. A migration the client can act on without a
  `tools/list` round trip.
- `invalid_arguments` naming `field: "verb"` with `detail.admitted` — the closed-set teaching
  pattern the swarm family already refuses with — for a verb outside the tool's enum.
- Everything else crosses from the resident unchanged: the typed ladder
  (impl/src/mcp-northbound.mjs:395-431), the web layer's crossing (#430/#436,
  impl/src/web-northbound.mjs:575+), the bridge's wireSafe composition
  (impl/src/mcp-web-bridge.mjs:47-50), and the wake plane's own codes
  (`invalid_wake_filter`, `wake_stream_*`).

**Landed (#314 lane 1).** Law (g) is live: the core surface mints no code — an unadvertised name
refuses the landed `unknown_tool` over the core set (with `data.movedTo` when §7 folds or retires
it), a verb outside a tool's enum refuses `invalid_arguments` with `field: "verb"` and
`detail.admitted`, and a field another verb owns refuses the same way naming that field. The six
unified meta spellings are the one unadvertised exception: the CLI's own MCP client speaks them,
and they ride their core verb instead of refusing (§3).

## 9. What stays OUT

- **No new operations, no renamed operations, no new refusal codes, no new wake classes.** The
  registry (#289) is untouched; this is a projection and a lifecycle fix.
- **No change to the CLI, the web bus, or the embedded client.** `baton swarm watch --follow`
  stays; the retirement list names MCP tools only.
- **The descriptor's `advanced`/`combined` surfaces are unchanged** — kernel and authoring
  profiles are docs/36 §11's explicit non-goal, kept.
- **The legacy flat spellings on the `combined` surface** (the dot-twin and alias inventory of
  docs/36 M1-M5) are that migration's business, not this one's; §7 governs the ordinary
  surface only.
- **No per-subscription upstream connections, no wake-protocol change** — the #294 plane is
  composed, not extended. The `rediscover` rebind is a client-side authority swap.
- **No re-parenting of seat worker processes** — docs/48 §7's exclusions stand; a seat's next
  turn resumes under the successor exactly as after any restart.

## 10. Closed-set owners

| closed set | ONE owner |
|---|---|
| the seven core tool names and their verb enums | `impl/src/mcp-core-tools.mjs` (new — the core table, derived from the registry rows) |
| per-verb argument schemas | the same table, composed from the registry rows it projects — never retyped |
| the receipt + wake answer shape | the dispatch answer composer, `impl/src/mcp-northbound.mjs` (`coreMutationAnswer`/`coreDerivedReceipt`; the swarm receipt derivation stays `swarmChangedRow`/`swarmReceiptNext`, impl/src/swarm-contract.mjs); the command → verb facts a bridge reads are `coreCommandFacts` (impl/src/mcp-core-tools.mjs) |
| the wake handoff's per-verb class lists and scope axes | the core table, values drawn from `WAKE_CLASS_TABLE` (impl/src/wake-stream.mjs) — a class named there, never a literal that drifts — and the scope axes from §2's third column (`recruit`: swarm + participant; `check`: swarm; the run/waves families: none) |
| the session notification method | beside `WAKE_NOTIFICATION_METHOD`, impl/src/mcp-northbound.mjs:926 |
| the rebind authority and re-attestation rule | `BatonWebApplicationFacade`, impl/src/mcp-web-bridge.mjs |
| the migration table | docs/49 §7, pinned executable in the red file |
| the byte budget | derived by the red file from its own designed table — never a hand-typed constant |

## 11. Implementation lanes

Four lanes, each DeepSeek-implementable, each owning red rows it turns green. No lane edits
another's rows; a lane that must move a pin says so in its contribution (the #306/#464
precedent).

**Lane 1 — the core table and the grammar.** Files: `impl/src/mcp-core-tools.mjs` (new),
`impl/src/mcp-northbound.mjs` (ordinary surface = the core table; per-verb validation through
the oneOf branches; the `unknown_tool` `movedTo` data), `impl/src/surface-capability-catalog.mjs`
+ `impl/src/surface-capability-resolution.mjs` + `impl/src/production-mcp-convergence.mjs`
(the six meta tools fold into `baton_surface`; the wrapper stops merging six and merges one).
Red rows: **314-a, 314-b, 314-c, 314-g**. Watch: the wrapper's merge seam
(production-mcp-convergence.mjs:668+) and the instruction suffix (:517) move with the fold.

**Lane 2 — receipts and wakes.** Files: `impl/src/mcp-web-bridge.mjs` (retire the
`_inspectOutline` answer; compose the receipt + wake handoff on the dispatch seam),
`impl/src/mcp-northbound.mjs` (the answer shape; the `run`/`waves` receipt derivation beside
`swarmChangedRow`). Red rows: **314-d1, 314-d2**. Dependency: lane 1's table (the verb →
receipt/wake mapping lives on the core rows). Watch: `run.start`/`run.stop` outline consumers
(phase64's UA5 pin names the card commands, not the answer shape — check
`grep -rn _inspectOutline impl/test` before landing).

> **Landed (2026-09-18, lane 2).** Red rows 314-d1 and 314-d2 are green and 314-d2's manifest row is
> retired; the answer composer lives in `impl/src/mcp-northbound.mjs` with `coreCommandFacts` on the
> core table, the facade applies it on the dispatch seam, and `_inspectOutline` is gone
> (`grep -rn _inspectOutline impl/test` found no consumer). The lane also carried two hand-backs from
> lanes 1 and 4: the U-E2 row now routes the meta block and its three calls through
> `baton_surface {verb}` (landed, its manifest row retired), while the inventory renderer switch is
> BLOCKED on an out-of-scope hunk — §5's landed note names the pair. Pins:
> `impl/test/issue314-lane2-receipts-wakes.test.mjs`.

**Lane 3 — reincarnation survival.** Files: `impl/src/mcp-web-bridge.mjs` (the `rediscover`
construction option, the re-attestation relaxation scoped to rebind, the atomic swap, the wake
plane's client swap, the once-retry), `impl/src/mcp-northbound.mjs` (the
`notifications/baton/resident_reincarnated` method beside :926). Red rows: **314-e1, 314-e2**.
Watch: `WakeSubscriptions` invariants (:186+) — the plane outlives the client it opens through;
the red file's 314-e1 drives exactly this.

**Lane 4 — the entry story.** Files: `impl/MCP.md` (re-lead: bridge first, descriptor as the
headless mode), `impl/scripts/mcp-web.mjs` (refuse a descriptor argument),
`impl/scripts/render-surface-docs.mjs` (the generated inventory renders the seven core tools),
plus the generated-block regeneration. Red rows: **314-f, 314-h**. Watch: `mcp-web.mjs`'s
descriptor fallback has consumers (`grep -rn "mcp-web" impl/test impl/scripts`); the U-G3 pin
(impl/test/mcp-bridge-admission.test.mjs:390-405) reads MCP.md sections by heading — lane 4
keeps the headed sections it cites.

## 12. Open questions

1. **`outputSchema` on the core tools.** This design pins the receipt/wake shape by behavior
   (314-d2) and keeps it OUT of the advertised schema to protect the byte budget. If MCP
   clients come to weight `outputSchema` for routing, declaring it is a budgeted growth — the
   §3 pin is exactly the decision point.
2. **A `runId` axis on the wake filter.** The #294 filter vocabulary is
   kinds/swarms/participants/since; a run.start handoff correlates by the frame's `runId` field
   client-side. A `runs` filter axis is a wake-stream change this design deliberately does not
   take — revisit if the correlation proves noisy on busy deployments.
3. **`baton_surface invoke` of a retired spelling.** §8 gives `movedTo` on `unknown_tool`;
   whether `invoke {name: "run.stop"}` should also accept a retired MCP spelling
   (`baton_run_stop`) as a convenience alias is left to lane 1 — the safe default is no
   (canonical names only, H2).
4. **Subscription growth on a long-lived session.** Each long verb opens one subscription; the
   plane dedupes the ATTACHMENT, not the subscription records. A client that never unsubscribes
   grows filter records per operation. If measurement shows it matters, the settlement frame
   (`settleOn`) can auto-close the subscription — a server-side nicety, not this design.
