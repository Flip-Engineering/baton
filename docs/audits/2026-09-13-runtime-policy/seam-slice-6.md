# Seam slice 6 — the injected recorder port the effect and recovery seams share

Issue #259, slice 6. The map (`docs/audits/2026-09-13-runtime-policy/seam-map.md`, §4.3) found that
the effect modules need an injected recorder, which is the same port the recovery seam needs: a
narrow interface over the observation-layer authorities (log, coordination, route) that both seams
call through. This slice defines the port, wires it at the composition root, and migrates two proof
consumers — one from each seam — to demonstrate both halves of the interface.

Revision under audit: `f4db39a6` plus this slice's two commits (`a300cd03`, `f20a5ad7`). Write
scope: `impl/src/runtime-recorder-port.mjs`, `impl/src/coordinator.mjs`, `impl/src/index.mjs`,
`impl/scripts/seam-inventory.json` (regenerated), `impl/test/runtime-recorder-port.test.mjs`,
`impl/test/create-driver-wiring.test.mjs`, and this file.

## 1. The port

`impl/src/runtime-recorder-port.mjs` exports `createRecorderPort({ log, coordination, route })`,
which returns a frozen object carrying:

| property | type | purpose |
| --- | --- | --- |
| `log` | EventLog | the log the moved member appends partial events to |
| `coordination` | CoordinationStore or null | the coordination store the moved member writes through |
| `route` | `{ record? }` or null | route attribution the moved member reads |
| `mapEvent(event)` | function | delegates to `coordination.mapOperationalEvent` with an evidence key |
| `recordDriver(kind, payload, key, actor)` | function | delegates to `coordination.recordDriver` or `recordAuthorityRejected` |

The factory validates that `log.append` is a function and freezes the returned object. When
`coordination` is null the helpers return null, so a recorder port assembled without a coordination
store is safe to hold and call.

The operation set was derived from the coordinator's effect bucket (102 members) and recovery bucket
(43 members). Every recording primitive these members reach — `log.append`, `coordination.mapOperationalEvent`,
`coordination.recordDriver`, `coordination.recordAuthorityRejected`, `coordination.completeRecoveryAttempt` —
appears on the port directly or through its helpers.

## 2. What moved

| member | from | to | lines | delegate |
| --- | --- | --- | ---: | --- |
| `_detachSharedWorkspace` | `Coordinator` | `runtime-recorder-port.mjs` (`detachSharedWorkspace`) | 23 → 3 | same name, arity 2 |
| `_completeDurableRecoveryAttempt` | `Coordinator` | `runtime-recorder-port.mjs` (`completeDurableRecoveryAttempt`) | 16 → 3 | same name, arity 3 |

Bodies are verbatim: `this._log` became `recorder.log`, `this._coordination` became
`recorder.coordination`, and each helper a body calls (`this._harnessOf`, `this._safeTurnEpoch`,
`this._routeAttribution`) arrives as `coordinator.<member>` through the explicit first parameter.
`createRecoveryAttemptCompletion` moved from `coordinator.mjs`'s own import to the port module's import.

The two consumers demonstrate both halves of the port:

- **`detachSharedWorkspace`** (effect seam): calls `recorder.log.append` to write a
  `worktree.custody_deferred` event, then `recorder.mapEvent` to map it through coordination.
- **`completeDurableRecoveryAttempt`** (recovery seam): calls `recorder.coordination.completeRecoveryAttempt`
  to write a recovery attempt completion through the coordination store.

## 3. Wiring

The port is assembled at two sites:

- **`createDriver`** (`impl/src/index.mjs`): builds the port from the log, coordination store, and
  route that the factory already holds, and passes it to the Coordinator constructor as
  `opts.recorderPort`. An injected `opts.recorderPort` is passed through.
- **Coordinator constructor** (`impl/src/coordinator.mjs`): validates the option when present,
  assigns `this._recorder`. When no option is supplied (bare `new Coordinator(opts)` without
  `createDriver`), the constructor builds its own port from `this._log`, `this._coordination`, and
  `this._route`, so delegates never reach a null recorder.

This follows the `knowledgeBriefingProvider` pattern from slice 3: `createDriver` assembles the
authority, the constructor validates and falls back.

## 4. The map

The seam inventory regenerates cleanly. The two moved members' evidence changes:

- `_detachSharedWorkspace`: size 23 → 3, evidence `[effect:action_verb, effect:action_name]` (was
  `[effect:action_verb, effect:action_name, observation:log_append]`). The `observation:log_append`
  evidence is no longer present because the delegate body does not call `this._log.append`.
- `_completeDurableRecoveryAttempt`: size 16 → 3, evidence `[recovery:restart_name]` (was
  `[recovery:restart_name, observation:coordination_authority, observation:durable_read]`). The two
  observation bits are gone because the delegate body does not reach `this._coordination`.

No new evidence rule was needed. The existing name rules classify the delegates correctly:
`action_verb` (weight 3) matches `detach` in the first delegate, `restart_name` (weight 4) matches
`durableRecoveryAttempt` in the second.

## 5. The test

`impl/test/runtime-recorder-port.test.mjs` adds 9 cases (RP1–RP6, with sub-cases):

| case | what it pins |
| --- | --- |
| RP1 | `createRecorderPort` rejects a missing or invalid log, freezes a valid port |
| RP2 | a real `createDriver` driver carries the injected recorder port on its coordinator |
| RP3 | `detachSharedWorkspace` appends a log event and maps it through the port |
| RP4 | `completeDurableRecoveryAttempt` writes through `coordination.completeRecoveryAttempt` |
| RP4b | a non-pending attempt returns without recording |
| RP5 | `mapEvent` delegates to `coordination.mapOperationalEvent` with the evidence key |
| RP5b | `mapEvent` returns null when coordination is absent |
| RP5c | `recordDriver` calls `recordDriver` or `recordAuthorityRejected` by kind |
| RP6 | the coordinator delegates retain the original member names and arities |

`impl/test/create-driver-wiring.test.mjs` gains one entry in `UNEXERCISED_OPTIONS`:
`recorderPort` — the observation-layer port the effect and recovery seams share, assembled by
`createDriver` when absent — so the CDW5 completeness ratchet accepts the new option.

## 6. Evidence

| command | result |
| --- | --- |
| `node impl/scripts/seam-inventory.mjs` | `ok` (regenerated with `--write`) |
| `node --test impl/test/runtime-recorder-port.test.mjs` | 9 passed, 0 failed |
| `node --test impl/test/create-driver-wiring.test.mjs` | GREEN |

## 7. What this slice does not claim

- Two proof consumers moved. The remaining 100 effect members and 41 recovery members that call
  recording primitives still reach them through `this._log`, `this._coordination`, and `this._route`
  directly. Those members are candidates for future slices; the port's interface is designed to cover
  them, and the two proof consumers demonstrate both halves.
- The port's `recordDriver` and `mapEvent` helpers are convenience wrappers. They encode the key
  format (`evidence:${event.worker}:${event.seq}`) and the `authority.rejected` dispatch that several
  effect members share, but a consumer that needs a different shape can call `recorder.coordination`
  directly.
- The `route` property is carried on the port but not exercised by either proof consumer.
  `_detachSharedWorkspace` reads route attribution through `coordinator._routeAttribution(handle)`,
  which is an existing coordinator method, not a port method. Future consumers that read
  `recorder.route.record` directly will exercise it.
