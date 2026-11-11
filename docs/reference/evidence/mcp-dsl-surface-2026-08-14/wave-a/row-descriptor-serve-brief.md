# ROW BRIEF — row-descriptor-serve: a descriptor with resolvable routes serves the real application

Issue #227 item 2. Deliverable: implementation + red-first pin.

## Anchors

- impl/src/mcp-descriptor.mjs:136-172 — buildDescriptorFacade: doctor-only; every other
  command refuses application_command_unavailable. The doc comment admits the intent:
  'a descriptor whose routes carry no resolvable harness adapters degrades' — but the code
  degrades ALWAYS; there is no resolvable-routes branch at all.
- The descriptor carries credential refs (file/env/keychain) resolved at load
  (resolveCredentialRef) — the adapters can be built from these the same way
  openBatonDeployment builds them from deployment options.

## Contract (closed)

1. A descriptor whose routes carry resolvable credentials constructs the real application
   (the openBatonDeployment path with descriptor-derived routes) and serves the full
   ordinary surface through it; doctor-only remains ONLY for unresolvable/absent
   credentials, honestly reported in doctor readiness.
2. The descriptor stays pinned at open (existing law); parse/validation semantics
   byte-stable.
3. Red-first pin impl/test/mcp-descriptor-serve-red.test.mjs: descriptor with a resolvable
  (fake-file) credential answers waves_run with accepted (RED at pre-change head:
  application_command_unavailable).

## Hard bounds
Additive; no credential material in logs/projections (existing redaction class); batteries green.
