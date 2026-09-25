# S-2 board/package authority sub-contract — SECURITY red-team (v1)

**Verdict: UNSOUND.**

The completion goal (name a shared admission primitive before new board/package surfaces
land) survives, and the diagnosis in "Ground truth" is largely accurate to the live code.
But the primitive as specified does not achieve its own claim — "one enforcement every
present and future surface inherits." It **relocates** the one check that is only safe today
because it is bound to the authenticated MCP connection into an *envelope authenticated by
non-secret identifiers* (R-BA-1, P0); it treats a **run-scoped** authority for an object the
store binds to no run (R-BA-2, P0); it pins a normalized-request idempotency rule and a
BA-7 replay-conflict test against store paths that compare **only the key** (R-BA-3); it
keeps the fence CAS **outside** the store append where the worker path already CASes atomically
(R-BA-4); it enumerates four mutations while a fifth fence-advancing orchestrator mutation
(`drop`) reaches the store with the actor default and no guard (R-BA-5); it leaves the read
projection an unguarded cross-session oracle (R-BA-6); and it *states* the ghost-surface ban
while *deferring* its enforcement to a sibling contract, so `board_edit` rows keep advertising
cli/web/embedded during the window (R-BA-7). An adversarial caller does not need to break the
lease machinery — the machinery is sound; the contract moves the trust boundary to a place
where identifiers, not authority, admit the mutation.

Two P0s block adoption as implementation authority. The verdict is not "the primitive is a
bad idea" — it is the right consolidation — but v1 must specify *proof-of-principal* and
*board→run binding* before an implementer can build it without opening the exact bypass the
contract was minted to close.

---

## R-BA-1 — P0 — The primitive authenticates by non-secret identifiers; moving the check off the MCP connection makes the envelope principal impersonable

**Grounding.**
- `coordination-store.mjs:1811-1842` — `activeRunOrchestratorLeaseForSession(fields)` resolves a
  lease by filtering on `{repoId, principalId, sessionId, expiresAt}` alone (`:1826-1834`), then
  returns `_activeRunOrchestratorLease({ orchestratorLeaseId, principalId, sessionId,
  sessionAuthorityDigest: lease.session.authorityDigest })` at `:1837-1842`.
- `coordination-store.mjs:1659-1675` — `_activeRunOrchestratorLease` does the real revalidation
  (expiry vs `this._clock()` at `:1663`, revoked at `:1662`, session-digest match at `:1664-1667`,
  parent task, run admission). **But** the session-digest compared at `:1664` is
  `auth.sessionAuthorityDigest`, and the only caller in the lookup path (`:1837`) feeds it the
  lease's **own** `lease.session.authorityDigest`. The digest revalidation is therefore
  tautological on this path — nothing the *caller* supplies is checked against the authority
  digest.
- `mcp-northbound.mjs:826` (`this.principal = Object.freeze(clone(opts.principal))`) and
  `:1443-1449` (`_requireOrchestratorLease` calls the lookup with `principalId: principal.userId,
  sessionId: principal.sessionId, expiresAt: principal.expiresAt`) — under MCP this is safe
  **only** because `principal` is frozen from the authenticated stdio handshake; the caller never
  gets to name `principalId`/`sessionId`.
- Contract §Rules 1(a) accepts a caller-filled envelope `{principal {actor, principalId,
  sessionId}, runId, ...}`; §Rules 1(b) resolves/revalidates "the active run-orchestrator lease"
  citing exactly `coordination-store.mjs:1818-1842` — the by-identifier lookup above.

**The failure.** `repoId`, `principalId`, `sessionId`, `expiresAt`, `runId` are all observable,
non-secret identifiers (they appear in receipts, run views, and lineage). The lease's
`authorityDigest` is the only thing resembling a bearer proof, and the cited lookup never checks
it against caller evidence — it reads it back out of the stored lease. MCP survives this because
the connection binds the principal. The instant the contract moves the check into a coordinator
primitive that trusts an *envelope* principal (rule 1a/1b) — the embedded facade, a CLI, a web
router, or an in-process confused-deputy capability handed to a less-trusted plugin — admission
collapses to *identifier matching*. A cross-session impersonator who can name a live
orchestrator session's `{repoId, principalId, sessionId, expiresAt}` tuple resolves that
session's lease and writes as its orchestrator. Rule 4's "obtains session authority honestly"
governs lease *acquisition* (`issueRunOrchestratorLease`, `:1762`, which does bind authority) —
but per-mutation *admission* re-resolves by tuple, so honest acquisition does not close the hole.

**Minimal repair.** The envelope must carry a *proof-of-principal* the caller cannot fabricate —
the same secret/capability that `lease.session.authorityDigest` attests — and
`activeRunOrchestratorLeaseForSession` (or a new admission entry) must compare a **caller-supplied**
authority proof against `lease.session.authorityDigest`, not feed the lease its own digest.
Equivalently: the primitive resolves the lease from an unforgeable session-authority token (the
`sessionAuthority` the MCP layer already threads at `mcp-northbound.mjs:1408-1428`), and refuses
`board_session_mismatch` when the presented token does not attest the named principal. Until the
envelope names *authority* rather than *identity*, the "one enforcement" is one *bypass*.

---

## R-BA-2 — P0 — Boards carry no `runId`; the lease→board binding is nominal, so any orchestrator lease in the repo authorizes any board

**Grounding.**
- `coordination-store.mjs:13391-13411` — `postBoardItem` mints a board item whose core is
  `{ itemId, itemVersion, board, title, detail, state, owner, evidence, ordinal }` (`:13403`).
  There is **no `runId`**. Boards are keyed by the `board` string and are repo-global; a `grep`
  for `runId` across the board hub (`:13374-13560`) finds only `board.claim_expired` — no
  board→run binding exists.
- `coordination-store.mjs:1826-1834` — `activeRunOrchestratorLeaseForSession` takes **no `runId`**
  and filters only by the session tuple.
- Contract §Rules 1(a) puts `runId` in the envelope; §Rules 1(b) claims revalidation of "parent
  task, Run admission" binds the mutation to a Run.

**The failure.** The `runId` in the envelope is decorative with respect to board authority. The
revalidation at `_activeRunOrchestratorLease` (`:1668-1673`) validates the *lease's parent run*,
not the *board's run* — there is no board's run to validate against. Consequently **any** active
orchestrator lease anywhere in the repo authorizes a mutation of **any** board: orchestrator A
holding a lease for Run X can retitle/close a board conceptually owned by Run Y. Combined with
R-BA-1 this is a full cross-Run board takeover with only observable identifiers. The contract's
framing of a *run-scoped* enforcement is not backed by the object model.

**Minimal repair.** Either (a) bind board items to a `runId` at post time and CAS
`envelope.runId` against the stored `item.runId` inside admission (a schema change the contract
must own, not defer), or (b) state plainly that board authority is **repo-scoped to any live
orchestrator lease** and delete `runId` from the envelope's authority role so implementers do
not build a false run-isolation guarantee. Silent option (b) today is itself the finding.

---

## R-BA-3 — P1 — Idempotency is key-only in the cited store paths; BA-7 "replay-conflict refuses" ships green against a store that never conflicts

**Grounding.**
- `coordination-store.mjs:13392` (`postBoardItem`), `:13480` (`retitleBoardItem`), `:9343`
  (`admitContextPackage`), `:9425` (`attachContextPackage`) all begin
  `const prior = this._byKey.get(auth?.key); if (prior) return { ok: true, result: 'idempotent',
  ... }` — the prior event is returned with **no comparison of the request body**.
- Contrast `coordination-store.mjs:1762-1770` (`issueRunOrchestratorLease`) and `:1857-1869`
  (`admitRunLineage`): these DO compare `prior.payload?.requestDigest !== canonicalDigest(request)`
  and raise `*_conflict`. The board/package hubs have no such guard.
- Contract §Rules 1(d): "binds the idempotency key to the NORMALIZED request (replay-same returns
  the prior receipt; replay-conflict refuses)"; BA-7: "replay-conflict (same key, different
  request) refuses."

**The failure.** A replay attacker (or a buggy retrying facade) that reuses a known idempotency
key with a **different** request receives the *prior* receipt and the different request is
silently dropped — no `board_replay_conflict`, no effect, no signal. This is a cache-confusion /
confused-deputy vector: the caller believes their new mutation applied; it did not. BA-7 will
pass against the live store because the store never conflicts — the test asserts a refusal the
code is structurally incapable of producing on these paths, so a conformant implementation that
"reuses the existing idempotency" satisfies BA-7 while being exactly wrong.

**Minimal repair.** Mirror the lease-path guard into the board/package hubs (or into the
primitive before it calls them): persist a `requestDigest` alongside the idempotency key and, on
`_byKey` hit, refuse `board_replay_conflict` when `canonicalDigest(normalizedRequest)` differs.
The contract must name *where* the normalized digest is stored and compared, because "binds the
key to the normalized request" is a net-new mechanism on these paths, not an existing one.

---

## R-BA-4 — P1 — The orchestrator fence CAS lives outside the store append; the worker path already CASes atomically — the split is the TOCTOU surface, not an async gap

**Grounding.**
- `mcp-northbound.mjs:1452-1456` — `_requireBoardFence(board, expected)` reads
  `this.coordination.boardFence(board)` and throws `stale_board_fence` **before**
  `postBoardItem`/successor is called (`:1335, :1356, :1362, :1367`). The store's post/successor
  methods (`:13391-13489`) do **not** re-check the fence at append.
- `coordination-store.mjs:13505-13506` — the **worker** claim path CASes the fence *inside* the
  store at apply time: `const currentFence = this.boardFence(item.board); if
  (fields.expectedBoardFence !== currentFence) return { ok:false, result:'stale_board_fence' }`,
  then appends. Two serialization points for one fence.
- `coordination-store.mjs:8243-8251` — the fence advances only on the five orchestrator
  transitions at *apply*; claims/reports do not advance it (so worker traffic cannot grief the
  orchestrator CAS — the one thing that is fine).
- Contract §Rules 1(c): CAS "inside the same admission"; §Rules 3 deletes the adapter check;
  BA-5: "instrumented interleaving" proves no TOCTOU.

**The failure.** Today the adapter's read-then-call is atomic only because
`this.coordinator.postBoardItem(...)` is invoked synchronously with no `await` between the fence
read and the store append. Rule 3 deletes that adapter check and rule 1(c) re-homes the CAS in a
coordinator *primitive* that also performs an (async-capable) lease revalidation in the same
step. The moment admission awaits anything between `boardFence()` and the store append — a future
async lease lookup, a promise-returning authority check, an awaited normalization — a
check/write split opens, and the store append will **not** catch it because the orchestrator
append does not itself CAS. BA-5's instrumented interleaving proves the property for the
*tested* path, not for all future call paths. The structural fix already exists in the codebase
one method over.

**Minimal repair.** Push the orchestrator fence CAS **into the store append**: have
`postBoardItem`/`retitleBoardItem`/`reorderBoardItem`/`closeBoardItem`/`dropBoardItem` accept
`expectedBoardFence` and CAS at apply, exactly as `requestBoardClaim` does at `:13505`. Then the
append is the single serialization point and the property holds by construction, independent of
what the admission layer awaits.

---

## R-BA-5 — P1 — `dropBoardItem` is a fifth fence-advancing orchestrator mutation the primitive and the BA battery omit; it reaches the store with the actor default and no guard

**Grounding.**
- `coordination-store.mjs:13486-13489` — `dropBoardItem` mints a `board.item_dropped` successor;
  `:8244-8251` advances the board fence for `board.item_dropped`. It is a full orchestrator-
  authority, fence-advancing mutation.
- `coordinator.mjs:9728-9732` — `dropBoardItem(itemId, opts)` forwards to the store with
  `actor: opts.actor ?? 'orchestrator'` — the same authority default the contract's Ground truth
  #4 names as the hole.
- `mcp-northbound.mjs:1332-1369` — the MCP layer exposes `post/retitle/reorder/close/read` only;
  there is **no `baton_board_drop`**, so `dropBoardItem` never sees `_requireOrchestratorLease`
  or `_requireBoardFence`.
- Contract §Rules 1, §Rules 3, and BA-1..BA-10 enumerate only post/retitle/reorder/close.

**The failure.** Any surface generated from the registry, or any in-process caller, that invokes
`Coordinator.dropBoardItem` writes as orchestrator with **no lease and no fence** — the exact
bypass the primitive exists to close — and it is invisible to the contract because the
enumeration and the negative battery never name `drop`. A conformant, green implementation ships
with `drop` unguarded.

**Minimal repair.** The primitive must enumerate **all five** orchestrator transitions
(post/retitle/reorder/close/**drop**); rule 3's adapter/primitive routing adds `drop`; BA-1..10
gain a `drop` row asserting lease + fence + actor honesty on the drop path.

---

## R-BA-6 — P1 — `baton_board_read` grants the full "orchestrator sees all" projection with no lease — a cross-session confidentiality oracle the mutation-only primitive leaves open

**Grounding.**
- `mcp-northbound.mjs:1372` — `baton_board_read` calls `projectBoardView(this.coordinator
  .boardSnapshot(args.board), { role: 'orchestrator', workerId: null }, this._boardViewCache)`
  **unconditionally** — no `_requireOrchestratorLease` precedes it.
- `mcp-northbound.mjs:80-81` — the board tools' capability requirement is merely `['observe']`.
- `application.mjs:372` coerces `role` to `orchestrator` when asked, and `:382-383` — the
  per-worker visibility filter (`role === 'orchestrator' || item.owner === workerId || board ===
  workerId`) is bypassed entirely for the orchestrator role, exposing every worker's items,
  claims, and reports on any board.
- `application-semantics.mjs:1272` — the registry `board.read` row is `profile: 'ordinary'`,
  `capabilities: ['observe']`, defaulting to `ALL_SURFACES`.
- Contract §The question / §Rules 2 cover only *mutation*; read is out of the refusal order.

**The failure.** Any MCP principal holding the ambient `observe` capability — with **no
orchestrator lease at all** — reads the full orchestrator projection of any board in the repo,
including other workers' private boards (`board === workerId`) and their reports. The contract's
own thesis ("every present and future surface inherits exactly one enforcement") is falsified by
its own read path: the read inherits *none*. This is a confidentiality leak and an existence
oracle (does board X exist / who owns item Y) independent of the mutation refusal order the
contract does pin.

**Minimal repair.** Gate the orchestrator projection behind the same lease resolution used for
mutation: an observer without the run-orchestrator lease receives the *worker* projection scoped
to its own `workerId` (or `board_lease_required`); stop hardcoding `role: 'orchestrator'` in the
adapter (`mcp-northbound.mjs:1372`). If read authority is genuinely S-3's to decide, the contract
must say so **and** remove the unconditional orchestrator role today — deferring the *decision*
does not justify shipping the *oracle*.

---

## R-BA-7 — P1 — The ghost-surface ban is asserted but its enforcement is deferred; `board_edit` rows advertise cli/web/embedded with an optional fence for the whole window

**Grounding.**
- `application-semantics.mjs:1244-1272` — `board.post/retitle/reorder/close` are
  `effect: 'board_edit'`, carry `runId/entryId/note/before`, and place `expectedBoardFence` in
  the schema but **not** in the `required` array (post requires `['runId','title']`, retitle
  `['runId','entryId','title']`, etc.).
- `application-semantics.mjs:1531` (`profile: spec.profile ?? 'ordinary'`), `:1539`
  (`surfaces: spec.surfaces ?? ALL_SURFACES`), `:1109`
  (`ALL_SURFACES = ['cli','mcp','web','embedded']`) — none of the four board rows set `profile`
  or `surfaces`, so they default to `ordinary` + all four surfaces.
- `mcp-northbound.mjs:493-503` — the live MCP schema requires `expectedBoardFence`
  (`['repoId','idempotencyKey','board','title','expectedBoardFence']`) and uses `board/detail`,
  confirming Ground truth #3's schema fork.
- Contract §Rules 5: "No row may advertise a surface until its primitive-backed operation exists
  (the ghost-surface ban)" — but the rewrite/removal is delegated to "the S-3 registry-delta
  matrix, which consumes this primitive."

**The failure.** This contract lands the primitive but leaves the ghost rows *live*. For the
window between this primitive and S-3, the registry advertises `board_edit` mutations on **cli,
web, and embedded** — three surfaces with no `_requireOrchestratorLease`/`_requireBoardFence`
adapter — with `expectedBoardFence` **optional** (omit it and a fence-checking primitive that
reads `expected ?? current` would no-op the CAS). If any surface generator wires these rows to
`Coordinator.postBoardItem`, it inherits `actor:'orchestrator'` (`coordinator.mjs:9707`) plus no
fence. The contract states the ban and then does not enforce it — the ban belongs to the
contract that *pins the primitive*, because the exposure is concurrent with the primitive's
landing, not after S-3's.

**Severity note.** P0 if a live surface generator already consumes these rows and routes to the
coordinator; P1-latent if the rows are inert-by-construction today (no non-MCP dispatcher reads
`surfaces`). Verifying which requires the S-3 surface-generation path; the contract must not ship
the primitive until the rows are made inert (reduce `surfaces` to `['mcp']` / remove, make the
fence required) **in this landing**.

---

## R-BA-8 — P2 — Package admit/attach inherit R-BA-1/R-BA-2: the lease guard is session-level and unbound to the package's `runId`, though attach encodes `runId` in its authority key

**Grounding.**
- `mcp-northbound.mjs:1379-1391` — `baton_package_admit` and `baton_package_attach` both call
  `_requireOrchestratorLease(args, principal)` (the session-tuple lookup, R-BA-1) with **no
  `runId`**; `admit` has no `runId` argument at all.
- `coordination-store.mjs:9343-9349` — store `admitContextPackage` checks only
  `_byKey`-idempotency and `_contextProgramPolicy` existence; no lease, no session.
- `coordination-store.mjs:9424-9448` — `attachContextPackage` validates the `auth.key` shape
  `package.attach:${digest}:${runId}:${scope}` (`:9445`) but **never checks the caller's lease is
  for `fields.runId`** — the key is a naming convention, not an authority binding.
- Contract §Rules 6 folds packages under "the same session-authority envelope + lease
  revalidation."

**The failure.** Packages ride the same by-identifier admission (R-BA-1) and the same absent
run-binding (R-BA-2). The attach key *mentions* a `runId` but nothing verifies the admitting
principal holds a lease for that Run, so a cross-Run attach (pointer-binding a package into
another Run's scope) is admitted on any repo orchestrator lease.

**Minimal repair.** After R-BA-1/R-BA-2 are fixed for boards, extend the same proof-of-principal
and `envelope.runId == attach.runId` CAS to the package paths; the store's admit/attach must
require the primitive's authority context rather than `_contextProgramPolicy` presence alone.

---

## R-BA-9 — P2 — The pinned refusal order invents a code namespace absent from the live code and omits item-existence, leaking an existence oracle between the lease and fence checks

**Grounding.**
- Contract §Rules 2 pins `board_admission_invalid → board_lease_required →
  board_session_mismatch → board_run_closed → stale_board_fence → board_parent_stale →
  board_replay_conflict`, calling every code "typed."
- The live codes are different names: `run_orchestrator_lease_required`
  (`mcp-northbound.mjs:1447`), `run_orchestrator_session_mismatch`
  (`coordination-store.mjs:1666`), `stale_board_fence` (`mcp-northbound.mjs:1454`), and there is
  no `board_run_closed`/`board_parent_stale`/`board_replay_conflict` in the code at all.
- `mcp-northbound.mjs:1356/1362/1367` evaluate `_boardOf(args.itemId)` — which throws
  `board_item_not_found` (`:1459-1461`) — as the argument to `_requireBoardFence`, i.e. **after**
  the lease check but **as part of** the fence step, revealing item existence. The pinned order
  never places item-existence; it jumps from `stale_board_fence` to `board_parent_stale`.

**The failure.** Two problems. (1) The pinned codes are a **net-new parallel namespace** the code
does not use; rule 2 presents them as "typed" as if mapped to live refusals, so an implementer
cannot tell whether to rename the live `run_orchestrator_*` codes (breaking existing MCP receipt
consumers — the `run_orchestrator_` prefix passthrough at `stateFailureCode` is load-bearing) or
add a translation layer. (2) A lease-holding caller can probe **item existence** on any board via
the `board_item_not_found`-vs-`stale_board_fence` distinction, which the pinned order does not
account for — an existence oracle the "test-pinned order" claims to have closed.

**Minimal repair.** Map every pinned code to a concrete live code (or explicitly declare the
renames and their receipt-compatibility handling), and insert item-existence into the pinned
order at a fixed point (after session, before or fused with fence) so retitle/reorder/close/drop
cannot leak existence through ordering. Add a BA row asserting the existence-refusal position.

---

## Surviving sections (adopt as written, or with only the folds above)

- **§Ground truth 1-4** — accurate to the code and correctly motivate consolidation. #1 (guard in
  the wrong layer) verified at `mcp-northbound.mjs:1332-1369` vs `coordination-store.mjs:13391-13489`;
  #4 (actor default) verified at `coordinator.mjs:9707-9731`. Keep. (Note #3's "schema fork" is
  real but understated — see R-BA-7.)
- **§Rules 4 (facade acquisition honesty)** — the *acquisition* path
  (`issueRunOrchestratorLease`, `coordination-store.mjs:1762`) genuinely binds authority, TTL, and
  revocation; the "no ambient authority → `board_lease_required`" posture is sound **once
  admission stops trusting envelope identifiers (R-BA-1)**. Keep the intent; it is not itself the
  hole.
- **§Rules 3 (MCP guards retire to thin adapters)** — the direction is correct: the adapter today
  carries the only enforcement (`_requireOrchestratorLease`/`_requireBoardFence`), and centralizing
  it is right. Adopt **after** R-BA-4 (CAS into the store append) so retiring the adapter check
  does not remove the only atomic point.
- **§Rules 6 (packages share the envelope)** — the consolidation is right; it simply inherits
  R-BA-1/R-BA-2/R-BA-8 and must be fixed with boards, not separately.
- **§Verification harness + BA-1..BA-10 skeleton** — the *shape* of the negative battery is the
  right instrument. It must add a `drop` row (R-BA-5), a real replay-conflict assertion backed by
  a request-digest guard (R-BA-3), an existence-order row (R-BA-9), a read-authority row (R-BA-6),
  and an impersonation-by-identifier row (R-BA-1) before it can certify the primitive.
- **§Explicit non-goals** — correct scoping; worker claim/report staying claim-only is consistent
  with the fence model (worker traffic does not advance the board fence, `coordination-store.mjs
  :8252-8253`), so no worker-path bypass of the orchestrator CAS exists — the one thing the design
  gets structurally right.
