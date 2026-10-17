# Phase 33 — addressed orientation push

## OP1 — split evidence from authority

Cartographer computes a bounded `orientation.slice` through the existing Coordinator-owned ACI
registry. Only Coordinator may address and deliver it to a worker. The capability receives no
adapter, worker, fence, or outbox authority.

## OP2 — exact fenced target

`orientWorker(workerId, args, note, {expectedFence, budgetTokens, actor})` requires one known active
worker and its exact current fence before invoking Atlas. A stale fence refuses before capability
computation. The serialized send lane rechecks the fence after computation and before delivery, so
stop/interrupt races cannot cross authority.

## OP3 — nudge-class structured delivery

The delivery is a nudge at the adapter's ordinary tool/turn boundary, never ad-hoc stdin. Its JSON
message contains a bounded operator note plus the ACI status, summary, inline typed payload,
content-addressed handle/digest/bytes/media type, optional resume cursor, and a closed provenance
projection. Host artifact paths and deployment-private provenance are not pushed.

## OP4 — one observable delivery event

A successful adapter acknowledgement appends `knowledge.map_served` on the worker's ordinary
operational log with the authenticated actor and exact structured message. Refusal appends no false
served event. Generic `send()` callers cannot forge this kind.

## OP5 — same authenticated northbounds

Web and MCP extend the existing `capability_invoke` action union with `push`; no new control plane or
MCP tool is added. The action is restricted to `cartographer-quartermaster/orientation.slice`,
requires control authority, worker/note/args/budget, and exact fence, and derives actor only from the
authenticated principal.

## OP6 — explicit next automation

This phase does not auto-push on a worker edit. Scope-drift detection must later bind an immutable
brief path scope, observed worker file-edit evidence, an explicit policy, dedup/cooldown, and the
same fence-safe `orientWorker` primitive. Interrupt must void queued pushes. No homelab integration
is introduced.
