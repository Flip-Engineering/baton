# Phase 87 — Semantic `run.act` Authority: Adversarial Review

Reviewer: GLM (bounded Baton worker, profile `default@988b35a2…`).
Worktree: `baton/baton-98e6ce74be99ccdae8725926-work`.
Date: 2026-07-18 (dogfood-live evidence window).

## Scope and method

Inspected only the Phase 87 surface, within a twelve-read budget:

- `spec/phase87-semantic-action-authority.md`
- `impl/src/application-semantics.mjs` (registry, capability source, freeze)
- `impl/src/application.mjs` (`normalizeCommandContext`, `_authorizeSemanticAuthority`,
  `actionAuthority`, `_recheckSemanticAction`, `authorizeReplay`, `act`,
  `_replaySemanticResumeAction`)
- `impl/src/northbound-capability-authority.mjs` (transport capability token)
- `impl/src/web-northbound.mjs` and `impl/src/mcp-northbound.mjs` (admission / replay /
  dispatch context)
- `impl/src/mcp-web-bridge.mjs` and `impl/src/application-cli.mjs` (preflight bridge + client)
- `impl/test/phase87-semantic-action-authority.test.mjs`

No full suite was run (brief forbids it; the reviewer runs `node`). No nested Baton was
invoked. Every shell operation used `rtk`, one command per call. Only this file was written.

## Verdict

The core authority design is **sound** against the seven attack classes named in the brief.
Authority is resolved from a closed, frozen registry, enforced at every northbound admission
boundary before quota or admission, re-bound to the persisted semantic authority, and
re-checked immediately before the effect. I found **one concrete (low-to-medium) conformance
defect** — the MCP-over-Web bridge facade's `authorizeReplay` ignores persisted semantic
authority and current capabilities — plus a low-severity quota-ordering observation and a set
of **follow-up test gaps**. No authority-escalation or new-effect bypass was found.

## Authority model recap (as implemented)

- The capability source is closed and self-checking:
  `APPLICATION_ACTION_CAPABILITIES` is built from `APPLICATION_ACTION_CAPABILITY_SOURCE`,
  sorted canonical, frozen, and validated against the action registry so neither set can drift
  (`application-semantics.mjs:415-447`). `run.act` advertises no coarse command capability
  (`capabilities: []`, `semanticCapabilities: true`), so the coarse gate is a no-op and the
  real authority is the per-kind semantic set — exactly SA1.
- Transport authority is an opaque, per-transport **frozen singleton** checked by reference
  identity (`northbound-capability-authority.mjs:1-10`). JSON round-trip cannot reproduce it,
  so a caller cannot mint a trusted northbound context by copying fields (SA3).
- For a new request the order is: resolve authority → require
  `requiredCapabilities ⊆ principal.capabilities` → take quota → append durable admission →
  verify the admission carries the same authority digest (SA2). Denial (403) precedes quota.

## Findings by attack class

### 1. Confused-deputy path — **sound**

`normalizeCommandContext` (`application.mjs:286-335`) requires that if any of
`capabilityAuthority` / `capabilities` / `semanticAuthority` is present, then
`capabilityAuthority` and `capabilities` must both be present and the token must pass
`hasNorthboundCapabilityAuthority(transport, token)` (`:313-321`). Web and MCP inject the
genuine token at dispatch (`web-northbound.mjs:794-797`, `mcp-northbound.mjs:944-947`), not at
client request time. In `act`, the live action is re-resolved and `_authorizeSemanticAuthority`
requires `context.semanticAuthority.authorityDigest === normalized.authorityDigest` whenever a
capability context is present (`application.mjs:1476-1482`), so a stale/forged authority does
not bind. Direct in-process callers carry no `capabilityAuthority` and fall through to the
deployment authorizer plus the same registry derivation, matching SA3.

### 2. Quota / admission before denial — **sound (one low-severity observation)**

Web denies on `403 forbidden` at `web-northbound.mjs:558-565`, before `takeCommand`
(`:571`) and `admitWebCommand` (`:580`). MCP mirrors this at `mcp-northbound.mjs:724-731`
before `:734`/`:773`. Both focused tests assert `quotaCalls === 0` on denial. The SA2
invariant — *an authority-denied request charges no quota* — holds.

Observation (low severity, not an authority bypass): quota is taken **before** the admission is
appended (`web:571→580`, `mcp:734→773`). Under a concurrent idempotency conflict, the
pre-check at `web:542` / `mcp:705` can pass and the later `admit*` can still return
`idempotency_conflict`, so a 409 response can carry a quota charge with no admission or effect.
This is defensible as rate-limiting (the request passed authn/authz and consumed resources),
and SA2's "no quota charge" clause is framed around *authority denial*. Flagging only because
the ordering is worth one deterministic test.

### 3. Forged transport authority — **sound**

The token is reference-identity compared (`northbound-capability-authority.mjs:8-10`). A
hand-built `capabilityAuthority: {}` is a different object reference and is rejected; the test
at `phase87-…test.mjs:99-105` confirms `application_context_invalid`. Cross-transport forgery
(web token presented in an MCP context) also fails because `TOKENS.web !== TOKENS.mcp`. Not
currently tested (see gaps).

### 4. Capability-downgrade replay — **sound at the native application; see §8 for the bridge**

`authorizeReplay` for `run.act` uses the persisted `context.semanticAuthority` and does not
call live `actionAuthority` when one is present (`application.mjs:1578-1585`).
`_authorizeSemanticAuthority` then checks the **persisted** `requiredCapabilities` against the
**current** `context.capabilities` (`:1476-1482`), and both northbound layers feed the current
principal's capabilities into replay (`web-northbound.mjs:684`, `mcp-northbound.mjs:856`). So a
principal who loses a capability is denied a completed replay. The Web test covers this
(`phase87-…test.mjs:225-231`).

### 5. Disappeared-action replay failure — **sound**

Completed replay is served from the persisted outcome after `authorizeReplay` succeeds, with
no requirement that the action remain advertised (`web-northbound.mjs:668-702`,
`mcp-northbound.mjs:840-873`). The Web test exercises this by making `actionAuthority` throw
and still obtaining `replayed: true` (`phase87-…test.mjs:215-224`). For direct calls,
`act`'s resume branch re-derives authority from `context.semanticAuthority` and only proceeds
when `_replaySemanticResumeAction` matches the exact prior `work.resumed` event bound to
principal scope and reason digest (`application.mjs:5870-5889`, `:7659-7671`), then returns a
read — no effect is re-applied. Fail-closed everywhere else (`:7672`).

### 6. Session mixing — **sound**

The Web idempotency scope is keyed on `userId` (`web-northbound.mjs:537`), so cross-*user*
replay is impossible. For an in-flight (`status === 'admitted'`) `run_act` replay, both
transports require `admission.sessionId === current.sessionId` (`web:625-628`, `mcp:801-803`),
preventing a different session from attaching to another session's live dispatch. Completed
replay is same-user by scope and capability-gated rather than session-pinned, which is the
SA2 design ("reauthorizes the current principal against the persisted semantic authority").

### 7. Preflight / admission race — **sound**

After admission, both layers assert
`admission.semanticAuthority.authorityDigest === resolved.authorityDigest` for `run_act`
(`web:594-599`, `mcp:780-783`), rejecting with `application_action_authority_invalid` if the
winning admission's authority differs from what this request resolved — closing the
resolve→admit window. The MCP-over-Web bridge shares one idempotency key between preflight and
command (`mcp-web-bridge.mjs:93-101`, `:103-127`, `:163-180`), so retries land on the same
scope; the SA4 test asserts key equality (`phase87-…test.mjs:359-363`). Importantly, the
bridge command does **not** carry the preflight authority into the dispatch envelope, so a
stale client-side authority can never bind — the server re-resolves fresh at admission.

### 8. Concrete defect — bridge `authorizeReplay` ignores semantic authority (low → medium)

`BatonWebApplicationFacade.authorizeReplay` (`mcp-web-bridge.mjs:129-143`) validates only the
context shape, the session attestation, and the remote application card / registry digest. It
**ignores `context.capabilities` and `context.semanticAuthority`**. When this facade is wired
as the `application` for an `McpFleetServer`, the MCP completed-replay path returns the
locally-cached `run.act` outcome after calling exactly this method
(`mcp-northbound.mjs:840-873`) — it does not re-forward to the remote Web application, so the
remote's enforcing `BatonApplication.authorizeReplay` is never consulted.

Consequence: in an MCP-over-Web topology that retains completed `run.act` admissions in the
local coordination store, a principal whose capabilities were downgraded after the original
dispatch can still read the cached completed response. This contradicts SA3, which requires
that "`authorizeReplay` uses persisted semantic authority for an admitted `run.act`; it must
not silently fall back to generic observe authority," and SA2's "a capability downgrade
therefore denies replay."

Why the severity is bounded, not high:

- The cached body is the principal's *own previously-authorized* completed result; replay
  performs **no new effect** (the effect already ran at first dispatch).
- It requires an authenticated, attested session, and the principal's capabilities are fixed
  for the life of a single MCP server instance, so a within-session downgrade is implausible
  and a cross-restart downgrade typically loses the in-memory cache anyway.
- It is informational / conformance, not an escalation.

Recommended fix (smallest): in `BatonWebApplicationFacade.authorizeReplay`, when
`name === 'run.act'`, require `context.semanticAuthority` and verify
`context.capabilities ⊇ context.semanticAuthority.requiredCapabilities` (and re-derive the
digest), mirroring `_authorizeSemanticAuthority` — or forward replay authorization to the
remote `/v1/action-authority` scope so the authoritative store decides. Then add the test in
§"Follow-up test gaps."

## Follow-up test gaps

These are coverage holes, not code defects. Each would harden an already-sound path (or
confirm the §8 fix):

1. **MCP capability-downgrade replay** — the Web downgrade proof
   (`phase87-…test.mjs:225-231`) has no MCP twin. Add one asserting a completed `baton_run_act`
   replay is refused (`forbidden`) and quota-neutral after the principal loses a required
   capability. This is also the regression test for §8 once the facade is wired through a real
   `McpFleetServer` + coordination store.
2. **`run_act` idempotency-conflict** — neither transport test sends a *different* request body
   under the same idempotency key to assert `409 idempotency_conflict` (web `:542`, mcp `:705`)
   with zero quota and zero admission. Also covers the §2 ordering observation.
3. **Cross-transport token forgery** — present `northboundCapabilityToken('web')` inside an
   `mcp` context (and vice-versa) at `act` / `authorizeReplay` and assert rejection. The token
   is reference-identity per transport, but no test pins that.
4. **Preflight/admission race** — no test drives the `application_action_authority_invalid`
   branch where the winning admission's digest differs from the requester's resolved digest
   (web `:594-599`, mcp `:780-783`). A double-dispatch test where `actionAuthority` returns a
   changed authority between the two `execute` calls would close it.
5. **Completed-replay semantic-authority mismatch** — replay where the persisted
   `semanticAuthority` digest no longer matches the action identity, asserting denial.
6. **In-flight session mixing** — assert that an `admitted` (not yet completed) `run_act`
   replay from a different session is refused (`web:625-628`, `mcp:801-803`). Today only the
   completed path is exercised.

## Notes on registry integrity

`APPLICATION_ACTION_CAPABILITIES` is built from `APPLICATION_ACTION_CAPABILITY_SOURCE`,
canonicalized, frozen, and cross-checked against `actions` so the two cannot diverge
(`application-semantics.mjs:439-447`). `normalizeSemanticAuthority` re-derives and compares the
digest and rejects unknown kinds, non-canonical capability lists, and digest mismatches
(`application.mjs:261-279`, `:1468-1475`), and the test covers unknown-kind refusal
(`phase87-…test.mjs:86-97`). Unknown kinds fail closed everywhere this matters.

## Deployment verification

Per the brief, the focused suite was not executed by this worker; the reviewer runs `node`
(must exit 0). No code or test path outside this review file was modified, so the existing
Phase 87 suite behavior is unchanged. The deployment verification command for the
`default@988b35a2…` profile is the reviewer's `node` invocation against
`impl/test/phase87-semantic-action-authority.test.mjs`; this worker did not fabricate or
substitute that result.
