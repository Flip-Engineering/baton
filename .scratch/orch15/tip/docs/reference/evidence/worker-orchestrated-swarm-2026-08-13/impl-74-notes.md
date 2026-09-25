# Issue #74 — worker-orchestrated swarm rung: implementation notes

- **Contract:** `contract-fold.md` v1.2 (source of truth).
- **Suite:** `impl/test/worker-orchestrated-swarm-red.test.mjs` (16 rows: 8 RED at named stages / 8 PIN).
- **Date:** 2026-08-13.
- **Result:** 16/16 green, verified with
  `node --test impl/test/worker-orchestrated-swarm-red.test.mjs` from the repo root (two consecutive
  runs, identical). All four adjacent suites green (below).

## The six seam closures landed

The fold-2 suite named six seam closures; each is implemented in one natural subsystem boundary.

| Seam | Law | Where |
|---|---|---|
| D1.2 | the scratchpad read-authorization law at the deployment seam | `application-deployment.mjs` — the permissive `authorize: async () => true,` literal is replaced by `restrictingReadAuthorize()` (the default). `shared` always resolves; `worker:<scope>` resolves for the member's own partition (`principalId === scope`), the review authority (`local-owner` / `service-*`), or an explicit wave-scoped grant (the named escape hatch — the two-level shape routes through `shared` until a grant lane lands); a sibling `worker:<role>` read refuses `application_unauthorized` (the "unknown ≡ foreign" default). Non-read commands stay permissive. |
| D1.3 | the truthful steering trail | `workflow-interpreter.mjs` `answerDecision` — a denied/raced `handle.answer` throw records `{trigger:'answerDecisions', role, requestId, optionId?/text?, outcome:'denied', refusal:<thrown code>}`, does NOT mark the key handled, and leaves the ask pending; `outcome:'answered'` is recorded only AFTER a successful return. The pre-answer `s.answeredKeys.add` at the top of `processMember` is gone (the `permanencePin` structural pin); a new `deniedDecisionKeys` set implements the no-re-attempt policy (a denied requestId is skipped, never re-auto-answered per poll). |
| D2 | the coordinator authority boundary (`coordinator_authority_forbidden`) | `limits.mjs` declares the ONE new refusal code + its graceful path (byte literals live in the registry, Decision 8 no-re-declare law); `application.mjs` fires `_refuseCoordinatorAuthority` at the `waves.start`/`waves.run`/`waves.stop` dispatch seam for a worker-seat principal (`principalId` `worker:<id>`), carrying `{attempted, gracefulPath:'DECISION_REQUEST'}`. `waves.list`/`waves.progress` are observe verbs (not refused); the top orchestrator never fires the code. |
| D3 | the seat map in the registry view | `application.mjs` — `start()` mints the member's EXACT route onto the steering-registered record; `_runWaveRoute` recovers it; `waveList` renders the route for interpreter-seam (string-roster) waves. The object-roster render is UNCHANGED (the wave-observability D3 pin closes it at the five keys `{attentionCount, liveness, phase, progressClass, role}`). |
| D4 | the message-kind closure + the file-not-directory structural check | `workflow-interpreter.mjs` widens `MESSAGE_KINDS` and adds the `gitObjectType` blob check in `harvestOne`; `coordinator.mjs` `sendMessage` and `application.mjs` `_normalizeMessageSend` widen the `inform|query|steer` set to `inform|query|steer|brief|result` end-to-end, so the `brief`/`result` kinds DELIVER to the adapter, not just admit. |

## Reconciliation note (object vs string roster)

The `waves.list` seat-map fix is scoped to the interpreter seam only. `createWave`
(`wave.mjs:180`, out of this rung's edit set) mints a role-only STRING roster, so the route is
recovered from the member run's steering-registered `route` record (minted by `start()`). The
direct `waves.start` port already mints the OBJECT roster `[{role, route, scope}]`, but
`wave-observability-red` A3-1 pins the object-roster per-member render to the closed five keys —
so the object path is left byte-unchanged and the seat map rides the string path the #74 A6 row
drives (`waves.run` → `createWave`).

## Commit split (#141 — natural subsystem boundaries)

1. `feat(#74): D1.3 truthful steering trail + D4 interpreter seams` — `workflow-interpreter.mjs`.
2. `feat(#74): D2 authority boundary + D3 seat map + D4 lane delivery` — `limits.mjs`,
   `application.mjs`, `coordinator.mjs`.
3. `feat(#74): D1.2 restricting authorize at the deployment seam` — `application-deployment.mjs`.
4. `docs(#74): impl notes` — this file.

`recipes.mjs` (in the allowed edit set) needed no change: `implementContractRecipe` already admits
`role:'coordinator'` as an ordinary member with the heavy route preserved (the A1 admission green
leg passes at HEAD).

## Verification

Primary (from the repo root):

```sh
node --test impl/test/worker-orchestrated-swarm-red.test.mjs   # 16/16
```

Adjacents (the brief's four):

```sh
node --test impl/test/workflow-as-data-red.test.mjs            # 29/29
node --test impl/test/wave-observability-red.test.mjs          # 30/30
node --test impl/test/phase79-workflow-composition-red.test.mjs # 7/7
node --test impl/test/reply-chains-red.test.mjs                # 26/26
```

Also re-run clean (no regressions): `messages`, `scratchpad-33-red`, `phase77-recursive-*`,
`wave-driver-red`, `wave-attach-red`, `wave-grammar-red`, `recipes-red`, `trust-gate-steering-red`,
`decision-gate-trust-gate-red`, `workflow-surface-red`, `workflow-policy`, `briefing-pack-red`,
`phase84-context-map-wave-red`, `phase85-context-effect-admission-red`, `issue45-startup-reconcile-red`,
`phase42-policy-invalidation`, `phase78-concise-deployment-factory`,
`phase78-deployment-capacity-red`, `phase78-deployment-readiness-red`,
`phase47-cairn-causal-audit`. Out-of-scope red-first suites stay at their documented red splits
(`nested-orchestration-red` 7 PIN / 8 RED for the unimplemented #12 rung; `harvest-accessor-red`
for the unimplemented #99 rung).

## Campaign-law compliance

- **No clocks as controls:** the only `Date.now()` reads are the pre-existing drive-loop
  wall-clock bound and the pin floor; no new deadline/expiry/turn-cap enters the new paths.
- **Byte literals ONLY in limits.mjs:** the new refusal code `coordinator_authority_forbidden` and
  its `gracefulPath` (`'DECISION_REQUEST'`) are declared in `limits.mjs` and imported by
  `application.mjs`. The `brief`/`result` message kinds are enum members of an already-shipped
  closed set (widened in place in the three files that carry it), not refusal payloads.
- **`localeCompare` banned; sorted-key literals in ACTUAL order:** none introduced.
- **NUL discipline:** `application.mjs` / `coordination-store.mjs` are imported, never whole-file
  read; edits located with `grep -an` / `sed -n`.
- **No arbitrary numeric limits:** the no-re-attempt policy is a concurrency/set-membership bound,
  not a counter (the P-D1.4 drive-loop pin stays intact).
