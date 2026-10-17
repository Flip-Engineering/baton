# Phase 87 dogfood assessment

## Outcome

Phase 87 closes the `run.act` confused-deputy escalation across the application, authenticated
Web, native MCP, and MCP-over-Web bridge. A semantic action now carries one closed, canonical
capability authority. New requests are denied before quota and admission, durable admissions bind
that authority, completed replay survives action disappearance but not capability downgrade, and
the application rechecks current action identity immediately before effect.

## Reflexive review

The first Baton worker used exact route `glm / glm-5.2 / xhigh`:

- Run: `run-4e3e3318734c6ba943673ef3bdc479b6`
- resolved harness: `glm@claude-code-2.1.211+zai-anthropic`
- provider-observed model: `glm-5.2`
- preserved result: `92c7eb1c7668075ea3d1516e5d5c089bcf608323`
- verification: complete

It found that the MCP-over-Web facade's local completed-replay path reattested the remote session
and card but did not itself validate persisted semantic authority and current capabilities. This
could disclose the caller's own cached response after a capability downgrade, although it could
not repeat the effect. The fix validates current capabilities, exact action ID, registry effect and
capability set, canonical digest, and the opaque MCP transport token before the cache is returned.

The closure Baton worker used the same exact route:

- Run: `run-93b004db46a193776676218ab1b00c80`
- preserved result: `42b5ca09d01e6f17c6d4df9b649cab78b52127bd`
- verification: complete
- verdict: defect closed; no concrete bypass found

The closure review's remaining fail-closed unit matrix was added for action swap, registry effect
or capability drift, digest tampering, forged transport token, missing capability, and capability
inflation.

## Route and AX evidence

- `codex / gpt-5.6-sol / low` was selected exactly and the model was provider-observed, but Codex
  CLI `0.144.6` ended as generic `provider_crashed` before producing work. Baton stopped and reaped
  the Run. The provider cause remains too generic for efficient recovery.
- `kimi-code / kimi-code/k3 / high` was refused before launch as
  `authentication_refresh_required`.
- `grok / grok-4.5 / high` was refused before launch as `authentication_refresh_required`.
- Baton did not mutate Kimi or Grok login state.
- GLM xhigh took several minutes even for the six-read closure review. The default application
  still needs progressive elapsed-stage visibility and deployment-owned adaptive fallback without
  exposing caller-managed wall, token, or provider-turn knobs.
- `Run.stop()` completed and application close reported zero workers, but the compact runner
  projection serialized `stop: null` and `ownership: null`. This is a real operator-evidence gap
  for the forthcoming attach/control surface.

## Validation and cleanup

- Full implementation suite after the code fix: 2,148/2,148.
- Focused Phase 87 suite after the final test matrix: 5/5.
- `git diff --check`: clean.
- application close after every attempted route: zero workers.
- final Git worktree inventory: main worktree only.
- final capacity ledger: zero reservations.
