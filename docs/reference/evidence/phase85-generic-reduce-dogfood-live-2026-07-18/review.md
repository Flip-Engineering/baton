# Generic Context reduce adversarial review

No concrete defect was found in the scoped effective implementation.

- Admission remains effect-free: `application.mjs` durably binds the successor Workflow definition
  and generic call before proposing the Plan; `coordination-store.mjs` revalidates the Context
  service principal, requester principal/session, source settlement and lineage, role catalog,
  exact route, and successor Plan without invoking a provider. CC85-A1/A3 prove zero added adapter
  calls before approval and reject requester or ledger substitution.
- Restart and approval preserve exact-once truth: `_reconcileContextCalls` proposes only a still
  `plan_pending` prebinding, while Plan proposal, approval, and node dispatch use durable idempotency
  keys. The admitted Plan binding fixes the selected role's harness/model/effort. CC85-A1/A3 prove
  one recovered proposal, one selected-route dispatch, and no redispatch after reopen.
- The physical reduce Brief closes the result boundary: `context-call.mjs` revalidates the output
  and evidence refs, every result ref and capsule, the retained-result/source projection through the
  deployment reference reader, and the private source digest/item count before attaching source
  content. The durable task Brief remains reference-only; only the provider-facing Brief receives
  `contextInput`.
- Replay remains version-compatible: `context.call_admitted` replay selects the historical map
  validator for schema v1 and the generic effect-call validator for schema v2. CM85-L1 and the
  Phase 84 replay/tamper cases preserve the historical map upgrade and fail closed before provider
  effects.
- Stop/reap includes generic calls and their worker: Run-stop admission snapshots
  `targetContextCallIds` together with the Run task/worker union, stop waits for zero remaining
  workers and equal observed/closed process counts, and completion requires every targeted call
  terminal or stopped. CC85-A1/A3 exercise generic reduce stop after dispatch/reopen.

Focused verification: `node --test impl/test/phase85-context-effect-admission-red.test.mjs
impl/test/phase84-context-map-wave-red.test.mjs` — 16 passed, 0 failed.

