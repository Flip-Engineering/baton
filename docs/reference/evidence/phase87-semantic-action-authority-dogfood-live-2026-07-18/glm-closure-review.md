# Phase 87 — Semantic `run.act` Authority: MCP-over-Web Replay Closure Review

Reviewer: GLM (bounded Baton worker, profile `default@50fd8b2b…`).
Worktree: `baton/baton-58ab02aae17a7d69a213dbd5-work`.
Date: 2026-07-19.
Subject: closure of the §8 concrete defect in `glm-review.md` — bridge
`BatonWebApplicationFacade.authorizeReplay` ignored persisted semantic authority and
current capabilities before returning a cached completed `run.act` result.

## Scope and method

Inspected the Phase 87 replay surface within a six-read budget:

- `docs/reference/evidence/phase87-semantic-action-authority-dogfood-live-2026-07-18/glm-review.md`
  (§8 defect + recommended fix and test)
- `impl/src/mcp-web-bridge.mjs` — `BatonWebApplicationFacade.authorizeReplay`
  (`:131-172`)
- `impl/src/mcp-northbound.mjs` — `run.act` pre-check (`:698-732`), admission/replay
  branch (`:768-834`), completed-replay path (`:840-873`)
- `impl/test/phase87-semantic-action-authority.test.mjs` — facade assertions
  (`:367-394`) and the MCP downgrade test (`:268-318`)

No full suite was run (the brief forbids it; the reviewer runs `node`). No nested
Baton was invoked. Every shell operation used `rtk`, one command per call, with no
pipes, `&&`, or semicolons. Only this file was written. No code, test, or other path
was modified.

## Verdict

**Closed.** The §8 defect is fixed. For `run.act`,
`BatonWebApplicationFacade.authorizeReplay` now enforces **all six** required
authorities in a single conjunctive rejection predicate, and that method is the gate
on the only path that returns a cached completed `run.act` outcome
(`mcp-northbound.mjs:840-873`): a throw at the facade short-circuits to a tool error
(`:866`); the cached body at `:873` is reached only after the facade returns `true`.
A second, independent denial also exists upstream at `:724-731`, so a capability
downgrade is refused twice. **No remaining concrete bypass was found.** Two test gaps
remain — both coverage holes, not defects.

## The six authorities, checked before a cached completed result is returned

For `name === 'run.act'`, `BatonWebApplicationFacade.authorizeReplay`
(`mcp-web-bridge.mjs:131-172`) resolves `semantic = context.semanticAuthority` and
`definition = APPLICATION_SEMANTIC_REGISTRY.actions[semantic?.kind]`, builds the
canonical `payload`, and fails closed unless every term below holds. Any miss throws
`application_unauthorized` (`:159-161`).

| Required authority | Where enforced (current code) |
|---|---|
| Current capabilities | `:152-158` — `context.capabilities` must cover every `semantic.requiredCapabilities`; `:154-155` additionally pins `context.capabilities` to the facade's frozen principal capabilities, so a caller cannot inflate them. The completed-replay path feeds the **live** `this.principal.capabilities` into `context.capabilities` (`mcp-northbound.mjs:856`). |
| Persisted semantic authority | `:137` — the persisted `context.semanticAuthority` is the sole source of `requiredCapabilities` / `effect` / `authorityDigest`; there is no live `actionAuthority` fallback inside the replay gate. |
| Action identity | `:147` (`semantic.actionId === args?.actionId`) and `:138`/`:148` (`definition` must resolve for `semantic.kind`). |
| Registry effect / capabilities | `:148-150` — `semantic.effect === definition.effect` and `semantic.requiredCapabilities` byte-equals the registry `definition.requiredCapabilities`. Catches registry drift. |
| Digest | `:151` — `semantic.authorityDigest === digest(payload)` over the canonical persisted fields. Tamper-evident. |
| Opaque MCP transport authority | `:146` — `hasNorthboundCapabilityAuthority('mcp', context.capabilityAuthority)`; the completed path injects the genuine `northboundCapabilityToken('mcp')` singleton (`mcp-northbound.mjs:855`), which is reference-identity compared and cannot be reproduced by a JSON round-trip. |

Context shape (`:132`), session attestation (`:135` → `_attestSession`, which also
detects a changed remote session digest), and the remote application card / registry
digest (`:163-170`) are checked around the six. All six run before a cached completed
result can be returned. **Yes** to the brief's question.

## The cached completed-result path is gated

`mcp-northbound.mjs:840` — when `admission.call.status === 'completed' &&
APPLICATION_TOOL[name]` (true for `baton_run_act`), the server calls
`this.application.authorizeReplay(...)` at `:849` with a context that, for `run.act`,
carries the real MCP capability token, the **current** principal capabilities, and the
**persisted** admission `semanticAuthority` (`:851-858`). In the bridge topology
`this.application` is the `BatonWebApplicationFacade`
(`createBatonWebMcpServer` constructs `McpFleetServer({ application: facade })`,
`mcp-web-bridge.mjs:242-275`), so the facade's six-check gate is exactly what executes.
On throw, `:866` returns `toolError(stateFailureCode(cause))` and the cached body is
never returned. Only on success does control fall through the goal-plan projection
branch (`:868-872`, not applicable to `run.act`) to `:873`
`return clone(admission.call.outcome)`. There is no alternate return for a completed
`run.act` outcome — `:837-838` is fleet-reuse only, `:868` is goal-plan only — so the
facade gate is unavoidable.

## Independent upstream denial (defense in depth)

`mcp-northbound.mjs:698-732` resolves `semanticAuthority = prior?.semanticAuthority`
(persisted — never live, so a disappeared action still replays, satisfying §5) and at
`:724-731` refuses `forbidden` unless
`semanticAuthority.requiredCapabilities ⊆ this.principal.capabilities`, before quota
(`:734`) and before `_callTool`. A downgraded principal is therefore denied here too,
which is why the existing MCP downgrade test (`:312-317`) returns `forbidden` without
ever consulting a facade. The two gates are not redundant in coverage: the upstream
check uses the *persisted* requirements and does **not** verify digest integrity,
registry drift, or transport identity — exactly the three the facade gate adds.

## Concrete bypasses considered and rejected

- **Capability downgrade** — denied at `:724-731` and again at the facade
  (`:152-158`). No path to `:873`.
- **Registry drift** (an action kind's `requiredCapabilities` changed after the
  original dispatch) — the persisted authority's requirements would differ from the
  current registry `definition`; facade `:150` rejects. Upstream `:724` alone would
  miss this, so the facade fix is load-bearing here, not cosmetic.
- **Authority-digest tampering** — facade `:151` rejects (`authorityDigest` is
  re-derived over canonical fields).
- **Transport-token forgery** (hand-built `{}` or cross-transport token) —
  reference-identity singleton; facade `:146` rejects. JSON copy cannot reproduce it.
- **Action-identity swap** under a reused scope — facade `:147`
  (`semantic.actionId !== args?.actionId`) rejects.
- **Capability inflation via the context** — facade `:154-155` pins
  `context.capabilities` to the frozen principal; the completed path feeds exactly
  `this.principal.capabilities`, so a mismatched/inflated value fails closed.

No remaining concrete bypass found.

## Remaining test gaps (coverage, not defects)

1. **No end-to-end bridge completed-replay test.** The facade fix is exercised only
   by a direct unit call (`test:367-394`). The existing MCP test (`:268-318`) uses a
   **stub** application whose `authorizeReplay` unconditionally returns `true`, and
   its downgrade case (`:312-317`) is rejected at the upstream pre-check
   (`mcp-northbound.mjs:724-731`) before the completed-replay gate is reached — so the
   facade gate is never driven through a real `McpFleetServer` + `CoordinationStore`.
   Recommended: wire `BatonWebApplicationFacade` into a real `McpFleetServer`, prime a
   completed `run.act` admission, then replay from a downgraded facade principal and
   assert `forbidden`, quota-neutral, and the cached body withheld. This is the
   integration twin the original review asked for.
2. **The facade unit test pins only `approve_plan` happy-path and one missing
   capability.** It does not exercise the predicates the fix introduced *beyond* the
   original §8 ask: registry drift (`semantic.requiredCapabilities` ≠ registry
   `definition.requiredCapabilities`), digest tampering (`authorityDigest` ≠
   re-derived), transport forgery (non-`mcp` token or `{}`), action-identity mismatch
   (`semantic.actionId` ≠ `args.actionId`), or the capability-inflation pin
   (`context.capabilities` ≠ frozen principal). Each is a one-line `assert.rejects`
   and would pin the three checks that make the facade gate non-redundant with the
   upstream pre-check.

These harden already-correct paths; they are not bypasses.

## Deployment verification

Per the brief, this worker did not execute the focused suite. The deployment
verification command for profile `default@50fd8b2b…` is the reviewer's `node`
invocation against `impl/test/phase87-semantic-action-authority.test.mjs` (must exit
0). No code or test path outside this review file was modified, so the existing Phase
87 suite behavior is unchanged; this worker did not fabricate or substitute that
result.
