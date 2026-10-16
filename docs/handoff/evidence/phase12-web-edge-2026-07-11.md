# Phase 12 web edge policy evidence — 2026-07-11

EP1–EP9 now ships the bounded security and lifecycle edge around Baton's existing authenticated
command, session, and SSE authority. It does not add a second fleet state machine or any homelab
integration.

## Shipped behavior

- Canonical IPv4/IPv6 client identity, including IPv4-mapped IPv6 normalization, is shared by
  exact trusted-peer membership, quotas, and keyed audit digests.
- Direct TLS and trusted cleartext-proxy modes are mutually explicit. Trusted forwarding requires
  one server-owned `rawHeaders` representation with no duplicate or mixed forwarding field-lines;
  every route, including health and readiness, requires canonical HTTPS.
- Immediate-peer, address, login, principal, weighted-cost, ticket, and connection authorities are
  separately bounded. Ordering prevents malformed targets/proxy inputs, invalid login bodies, or
  unauthorized tickets from consuming a more privileged bucket.
- Principal and cost preflight is atomic. Ticket reservation rolls back on issuance failure and
  exact ticket state is deleted if synchronous HTTP delivery fails.
- Readiness is bound to the same coordination, session/revocation, authentication, idempotency,
  and admission authorities used by the listener and discloses no dependency or fleet detail.
- Shutdown closes admission before asynchronous work, bounds listener drain and stream control
  frames by frame and buffer ceilings, performs exactly-once lease cleanup, tolerates cleanup/audit
  failures without skipping listener close, and never changes worker truth.
- Error and audit schemas use fixed classifications; attacker-controlled property names, origins,
  addresses, or credentials are not retained in durable audit.

## Deterministic validation

- `node --test` over the five Phase 12 edge/session/auth/northbound/stream files passes 82/82.
- The current full implementation suite passes 678/678 through the owned canonical runner.
- `git diff --check` passes.
- A real local proxy listener covers duplicate raw field-lines, forwarding-protocol casing, and
  immediate-peer quota behavior rather than relying only on synthetic request objects.

## Recursive Baton evidence and honest gates

The build and corrective reviews used the exact orchestrator route
`CodexAppServerCli` + `gpt-5.6-sol` + `low`, fresh verification, ff-only integration, confirmed
kill, and process/worktree/runtime/metadata/branch reap. Eleven review passes found and closed edge
defects. The twelfth detached review resolved the exact route but the provider returned its usage
limit before producing a verdict; it was killed and fully reaped. Therefore local EP1–EP9 behavior
is green, but the final clean independent-review gate is still pending.

The concurrent Grok fallback allocated `grok-4.5` and `grok-composer-2.5-fast` tasks and both
isolated worktrees at once. Both sessions were refused with `Authentication required` before child
PID/model observation. Baton confirmed both kills and reaped every process, worktree, runtime,
metadata, and branch resource. That is negative authentication-boundary evidence, not a claim that
either model executed.

Raw ledgers and runners are under
`docs/reference/evidence/phase12-web-edge-codex-{build,review}-2026-07-11/` and
`docs/reference/evidence/phase11-grok-model-selection-2026-07-11/`.

## Dogfood frictions promoted into scope

The first recursive build was rejected after its verification command named a nonexistent test
file that Node silently ignored. The runner now requires `test -s` before `node --test`.

Repeated full-suite and dogfood runs also left 14,070 Baton-named temporary fixture directories,
eventually causing `ENOSPC` despite clean registered worker/worktree/runtime/branch state. Only
those measured Baton temp directories were removed, recovering roughly 3 GB. Automatic fixture
registration, bounded retention, and reap on every terminal path are now explicit full-system
reliability scope. A subsequent controlled 657-test run under one owned `TMPDIR` reproduced 623
leftover directories totaling 8.7 MB; that entire owned root was removed after measurement.
TF1–TF4 subsequently made this ownership automatic for `npm test`; its 660/660 run left zero
suite roots in the configured parent.

Concrete OIDC callback behavior, admitted-but-incomplete command reconciliation, optional
WebSocket parity, MCP/operator surfaces, real browser automation, and the final clean provider
review remain unshipped. No homelab integration was added.
