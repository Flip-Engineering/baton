# #70 cross-deployment-knowledge red suite — blue-team review (suite red-keeping power)

- **Review HEAD:** `bcc2cd4` (the current worktree effective-tree snapshot; a descendant of the
  fold HEAD `79a7826` carrying #67 stall-watchdog content). Every impl anchor below was
  re-verified at `bcc2cd4` with `grep -an` / `sed -n` on the NUL-bearing files
  (`coordination-store.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
  `application-deployment.mjs`, `index.mjs`, `resident-authority.mjs`; `application.mjs` = 0
  NULs and was read ranged for the `run.knowledge.seed` anchor).
- **Suite under attack:** `impl/test/cross-deployment-knowledge-red.test.mjs` — 28 rows
  (9 PIN green / 19 RED at named stages). Split re-verified at this HEAD: two consecutive runs
  `node --test impl/test/cross-deployment-knowledge-red.test.mjs` → 28 tests, 9 pass, 19 fail,
  identical row set.
- **Contract under review:** `cross-deployment-knowledge-contract.md` v1.1 (fold target of
  `contract-fold.md`, fold HEAD `79a7826`).
- **Overall verdict: NEEDS-FOLD.** Five of the 19 RED rows are **green-side blockers** — under a
  *correct* v1.1 implementation they cannot go green (Axis 1). One RED row (A1-R4) does not
  discriminate the containment walk it claims to pin (Axis 2). Three contract laws are not pinned
  behaviorally at all (Axis 3: D2 endpoint-closure, D2 edge-severing at projection build, D5
  success-path recall framing). Hermeticity is clean (Axis 4).

**Laws honored in this review:** no clocks as controls (all epoch reasoning is
`ledgerHeadSeq() − observedSeq`, both primary ledger seqs); every sorted-key literal in ACTUAL
byte order; no `localeCompare`; NUL-bearing files read ranged only; the A1-R2..R5 and R-R1
defects below were verified empirically against this tree, not asserted from the contract text.

---

## Axis 1 — Green-side blockers: can every RED row go green under a CORRECT v1.1 implementation?

**Verdict: NEEDS-FOLD** — 5 of 19 RED rows are structurally unsatisfiable by a correct
implementation. The remaining 14 RED rows are green-able; the fixtures can mint every state they
need (a second deployment root with `resident/deployment.json` + readable
`state/coordination/events.jsonl`, a symlink escape, a foreign-epoch replica, a foreign-repo
root).

### F1.1 [MAJOR] A1-R2, A1-R3, A1-R4, A1-R5 are structurally unsatisfiable

Each of the four rows opens with the same self-contradictory pair on the **same** call:

```js
const code = openDescriptor(badDescriptor);          // parse + construct in one call
assert.equal(code, null, '... reaches the <check> (stage: no knowledge field ...)');
assert.equal(openDescriptor(badDescriptor), 'descriptor_invalid', '... refuses at open');
```

`openDescriptor` is deterministic on its descriptor argument (`writeDescriptor` writes a fresh
JSON file, `loadMcpDescriptor` parses it, `createMcpServerFromDescriptor` constructs — same
content every time; verified empirically at this HEAD for all four rows: both calls return
`descriptor_invalid`). Under a correct v1.1 implementation **every one of these descriptors
MUST be refused at open** — the closed-schema check (A1-R2, `knowledge`'s key set is exactly
`{primaryRoot}`, D4) or the containment/deployment-root validation (A1-R3/R4/R5, D4). So:

- The first assertion `code === null` can **never** pass under a correct implementation.
- The second assertion `refusal === 'descriptor_invalid'` already **passes at HEAD** (the
  descriptor is refused today because `knowledge` is an unknown *top-level* field) — verified:
  the HEAD error message is `descriptor.knowledge: unknown field` for all four descriptors.

The row is therefore broken in both directions: red-forever on assertion 1, and — if assertion 1
were deleted — green-at-HEAD on assertion 2 (it would stop being a RED row). `refusalCode`
returns only the code, and the code is `descriptor_invalid` at HEAD *and* under a correct
implementation, so the rows cannot even discriminate the two failure modes by code alone. The
named stage ("no knowledge field in the descriptor") is the *reason the descriptor fails at
HEAD*, but it produces the same code the correct implementation's sub-seam also produces.

**Concrete fix (three workable forms, pick one):**

1. **Split the seam (cleanest).** For A1-R3/R4/R5 the parse and the construct are genuinely
   different stages: under a correct implementation `loadMcpDescriptor` **succeeds** (the
   well-formed `knowledge` field parses) and `createMcpServerFromDescriptor` fires the
   containment/deployment-root validation. Rewrite each row as:
   `const parsed = loadMcpDescriptor(writeDescriptor(desc))` → `assert.ok(parsed, 'the
   knowledge field parses (stage: no knowledge field in the descriptor)')` (red at HEAD — the
   top-level unknown throws; green under the correct impl) then
   `assert.equal(refusalCode(() => createMcpServerFromDescriptor(parsed)), 'descriptor_invalid',
   '... refuses at open')`. The two assertions are now on different calls and discriminate.
2. **Assert the sub-seam by message.** For A1-R2 the discriminator must be the error message: a
   helper that returns `{code, message}` and an assertion that the message names `knowledge.bogus`
   (at HEAD it names `knowledge` — red at the "no knowledge field" stage; under the correct impl
   it names `knowledge.bogus`, whichever seam fires — parse or construct). The same helper works
   for R3/R4/R5 with the containment / deployment-root seam tokens.
3. **Minimal:** replace the first assertion with a *message*-based stage probe and keep the
   refusal assertion, accepting that both probe the same call.

Fix 1 is preferred: it uses the suite's existing surfaces (`loadMcpDescriptor`,
`createMcpServerFromDescriptor`) and makes the two assertions genuinely different observations.

### F1.2 [MAJOR] R-R1's `eventTimeSeq === 2` contradicts the folded eventTime law — and rewards the wrong implementation

R-R1 asserts the projected `finding:P1` carries `observedSeq: 2` **and** `eventTimeSeq: 2`. The
second half is wrong. GT3 pins the temporal anchor (`cross-deployment-knowledge-contract.md:91-93`):

> `eventTime(events, evidence, fallback)` (`coordination-store.mjs:410`): `eventTimeSeq` is the
> MINIMUM `coordinationSeq` in the node's evidence refs.

Verified at this HEAD: the primary's `finding:P1` (event seq 2, evidence
`[{coordinationSeq: 1}]`) is derived by the node fold
(`coordination-store.mjs:8543-8554`, `observedSeq: event.seq` then `...eventTime(this._events,
p.evidence, event)`) with **`eventTimeSeq: 1`** — the minimum evidence seq — and `observedSeq: 2`
(reproduced by a store-level probe: `ledgerHeadSeq 2`, `finding:P1 observedSeq 2, eventTimeSeq 1`,
events `1:task.created | 2:knowledge.node_added`). D1.2 (ii) pins the projection's
`observedSeq`/`eventTimeSeq` **at the primary's seqs**
(`cross-deployment-knowledge-contract.md:210`), and D1.2 (i) + GT3 pin the projection as
replay-exact from the primary's ledger. A faithful, correct projection therefore derives the
node exactly as the primary did: `eventTimeSeq: 1`, not `2`.

Consequences:

- A **correct** v1.1 implementation fails the row → green-side blocker.
- A **wrong** implementation that re-anchors `eventTimeSeq` at the projected event's *own* seq
  (2) passes it → the row actively rewards a GT3 violation.

The test comment "eventTimeSeq is the primary's seq — never a replica seq" conflates the
projection's replay position / the node's `observedSeq` (the event seq, 2) with the node's
`eventTimeSeq` (the min evidence seq, 1).

**Concrete fix:** change the assertion to
`assert.equal(projected.eventTimeSeq, 1, 'eventTimeSeq is the minimum evidence coordinationSeq (GT3), anchored at the primary\'s seqs — never a replica seq')`.
`observedSeq === 2` and `replica.ledgerHeadSeq() === 0` (the no-merge half) stay correct.

### Axis-1 status of the remaining 14 RED rows (all green-able under a correct implementation)

| Row | Green-able? | Notes |
|---|---|---|
| A1-R1 | ✅ | `openDescriptor(valid)` opens (rootA passes the D4 deployment-root check: `resident/deployment.json` with the reader's repoId + empty-but-readable `state/coordination/events.jsonl`); derivation + repoId assertions are fixture-consistent, deterministic. |
| A2-R1 | ✅ | Store `addKnowledgeNode` must refuse `knowledge_primary_conflict` when constructed with `primaryRoot ≠ deploymentRoot` — see F2.4 for the seam note. |
| A2-R2 | ✅ | Store `promoteKnowledgeNode` must refuse; the coordinator's two callsites (`coordinator.mjs:6580`, `:13458`) pass through the same store method. |
| A2-R3 | ✅ | Coordinator `admitWorkflowFinding` wrapper (`coordinator.mjs:11647`) refuses on a non-primary. |
| A3-R1 / A3-R2 | ✅ | `projectHorizon` serves the primary's node with `{epochLag: 0, sourceRoot: 'deployment-primary'}` (primary's resident deploymentId; `2 − 2 = 0`). |
| S-R1 | ✅ | Path-vs-this-root refusal on a shared-repoId replica (the vacuous equality holds by construction — first assertion is a setup sanity check that passes at HEAD, then the refusal fails at the right stage). |
| S-R2 | ✅ | Two self-primary stores each frame their own project read with their own deploymentId, epochLag 0. |
| R-R2 / R-R3 | ✅ | Dedup by primary idempotencyKey; strict-prefix gap refusal (`projectionReplayPosition 5 > primary head 2` → `knowledge_primary_unreachable`). |
| K-R1 | ✅ | Frozen `KNOWLEDGE_FEDERATION_REFUSAL_CODES` export in ACTUAL sorted order (the suite's expected literal is correctly byte-ordered). |
| K-R2 | ✅ | Verified at HEAD: a #63 admission with a foreign candidate currently throws `workflow_admit_ineligible` (`coordination-store.mjs:16166`), not the typed code; a correct impl splits the absent-candidate branch to `knowledge_cross_root_denied` (D2/D3). Local candidates (A2-P2) still admit — the split is satisfiable. |
| K-R3 / K-R4 | ✅ | `projectionReplayPosition 0` + ceiling 0 → `knowledge_projection_stale`; ghost primary (no ledger) → `knowledge_primary_unreachable`. |

---

## Axis 2 — Shallow-greenability

**Verdict: NEEDS-FOLD (minor).** The suite's core containment and path-closure depth is NOT
shallow-passable; one containment row (A1-R4) is under-discriminated, and one seam note is worth
folding into the contract.

### F2.1 [SOUND] A1 cannot be shallow-passed by a string-prefix containment check

- A1-R3 (`../escape`): `resolve(repo, '../escape')` lands outside the repo lexically — a
  string-prefix check refuses it.
- A1-R4 (`escape-link` → outside): `resolve(repo, 'escape-link')` is *inside* the repo
  lexically, so a `resolve().startsWith()` check would ACCEPT it; only a realpath/containment
  walk refuses. **A1-R4 blocks the string-prefix shallow impl.**
- A1-R5 (`not-a-root`, foreign-repo root): both resolve inside the repo lexically; only real
  deployment-root validation (resident/deployment.json + repoId + readable events.jsonl) refuses.

So a `startsWith`-only implementation fails A1-R4 and A1-R5. Good.

### F2.2 [NEEDS-FOLD, MINOR] A1-R4 does not discriminate the containment walk from plain deployment-root validation

The fixture's symlink target is an **empty** dir (`dir('outside')`, no
`resident/deployment.json`). A shallow implementation that validates the deployment root *at the
lexically-resolved path* (`join(repo, 'escape-link')` follows the symlink to
`outside/resident/deployment.json` → ENOENT) also refuses A1-R4 — for the "not a deployment
root" reason, with no realpath walk. The row therefore does **not** pin the D4 no-symlink-out
rule (`mcp-packaging-decisions.md:95-99`) independently: both a correct containment-walk impl and
a realpath-less deployment-root impl pass.

**Concrete fix:** point `escape-link` at a **valid deployment root of this repo located outside
the repo** (a mkdtemp dir containing `resident/deployment.json` with the reader's repoId + a
readable `state/coordination/events.jsonl`). Then the lexical resolver *accepts* (the referent is
a real root with the right repoId) and only the containment walk refuses — the row now pins the
walk. Consider also asserting the refusal message names the containment seam rather than the
deployment-root seam.

### F2.3 [SOUND] A2 forces all three promotion paths

A2-R1 (store `addKnowledgeNode` / `run.knowledge.seed`), A2-R2 (store `promoteKnowledgeNode` /
verified_task_outcome auto-promotion), and A2-R3 (coordinator `admitWorkflowFinding` /
`knowledge.promote`) are separate rows. Guarding only `knowledge.promote` leaves R1/R2 red;
guarding only the store verbs leaves R3 red. A2-P1 (self-primary promotes) + A2-P2 (raw store
admission on a non-primary *succeeds*) additionally pin the seam split: the store's
`addKnowledgeNode`/`promoteKnowledgeNode` must enforce primary, the store's `admitWorkflowFinding`
must NOT, the coordinator wrapper MUST. This forces the contract's D3 distribution exactly.

### F2.4 [NEEDS-FOLD, MINOR] The suite probes the primary refusal at the STORE verbs; the contract D3 names only the "coordinator mutator seam"

A2-R1/R2 and S-R1 call `replica.addKnowledgeNode(...)` / `replica.promoteKnowledgeNode(...)`
**directly on the store**, bypassing the coordinator. The contract D3 says the refusal fires "at
the coordinator mutator seam (`COORDINATION_MUTATORS`, `coordinator.mjs:261-281`; both verbs at
`:266`)". An implementation that enforces ONLY inside the coordinator's mutator proxy would stay
red on A2-R1/R2/S-R1, because the direct store calls never pass through the proxy. The suite is
satisfiable — the store methods (constructed with `primaryRoot`/`deploymentRoot` opts) must
themselves enforce, and the coordinator's calls pass through the same store methods — but the
contract's seam wording is *narrower* than what the suite actually tests.

**Concrete fix (contract side, not the suite):** fold D3 to name the store verbs as enforcement
points: `addKnowledgeNode` (`coordination-store.mjs:16283`) and `promoteKnowledgeNode`
(`:16303`), when constructed with federation opts where `resolve(primaryRoot) ≠
resolve(deploymentRoot)`, refuse `knowledge_primary_conflict` inside the store; the coordinator's
mutator seam additionally guards the `admitWorkflowFinding` path (A2-R3), while the store's
`admitWorkflowFinding` (`:16207`) stays open (A2-P2). This matches what the suite probes and
keeps the contract's "every path is covered" promise true at both seams.

### F2.5 [SOUND] A3 cannot be shallow-passed with a projection that never affects a read

A3-R1/R2 assert `projectHorizon` serves the primary's node with `{epochLag, sourceRoot}`;
R-R1/R-R2 assert anchoring + dedup + no-merge; R-R3/K-R3/K-R4 assert strict reads *refuse*. A
projection that builds but never feeds a read fails all of these.

Observational note (not a defect): the suite DOES force the projection's defining mechanism — the
replica-side replay position in PRIMARY seqs. R-R3, K-R3, and K-R4 all pass a
`projectionReplayPosition` opt and assert the read path honors it (ahead-of-head → unreachable;
behind-with-ceiling → stale; unreadable ledger → unreachable), so a pure live federation with no
replay position fails. The only unpinned degree is the OQ2 implementation fold (on-demand re-read
vs a checkpoint cache keyed to the primary's `eventFence()`), which the contract explicitly
defers. Consistent — no fold needed.

### F2.6 [SOUND, minor note] The absent-field byte-identity PINs are strong

A1-P1 pins the descriptor parse (no `knowledge` key invented; server constructs); G1 pins the
plain store's `projectHorizon` shape (no `sourceRoot`/`epochLag`), the local `readKnowledge`
append (unchanged), and the `snapshot().knowledge` vocabulary. A regression that invents
federation behavior for an absent field is caught. One gap: A1-P1's `Object.isFrozen(parsed)`
checks only the top-level object — a shallow impl that freezes the top but leaves the nested
`knowledge` object mutable passes. Add `assert.ok(Object.isFrozen(parsed.knowledge))` to pin
PKG-1's "read once, immutable" for the nested field.

---

## Axis 3 — Missing rows: are the fold's named additions pinned behaviorally?

**Verdict: NEEDS-FOLD.** The split-brain discriminator is pinned behaviorally; the cross-store
replay law is *mostly* pinned, but its anchoring assertion is broken (F1.2), and three laws are
pinned only by comment.

### F3.1 [SOUND] The split-brain discriminator is pinned behaviorally, not by comment

S-R1 forces the declared-path-vs-this-root comparison on a shared-repoId replica — the vacuous
`repoId` equality holds by construction (`assert.equal(replica.repositoryId(), repoIdv)` is a
setup sanity check that passes at HEAD, then the `knowledge_primary_conflict` refusal is the
behavioral pin). S-R2 pins the OQ5 two-primaries honesty surface (each self-primary's project
read names its own `sourceRoot`, epochLag 0, `notEqual` across roots). Both are behavioral.

### F3.2 [NEEDS-FOLD, MINOR] D2 endpoint-closure is NOT pinned behaviorally

D2 pins that the projected slice is the endpoint-closure of fold outputs, in particular that
`task:<taskId>` endpoints cited by promotion edges are replicated (a projected `VerifiedBy`/
`Informed` edge never dangles). The fixture's primary ledger holds `task.created` (task:P1,
seq 1) and `knowledge.node_added` (finding:P1, seq 2), but **no row asserts `task:P1` appears in
the projection**. A buggy implementation that projects only the promotion-event nodes (dropping
task nodes) passes the entire suite.

**Concrete fix:** add a RED row asserting `horizon.nodes.some((node) => node.id === 'task:P1')`
and, for the edge-closure half, that every edge in the projected slice has both endpoints
present in the slice.

### F3.3 [NEEDS-FOLD, MINOR] D2 edge-severing at projection build is NOT pinned

K-R2 pins the *admission-side* refusal (a #63 admission with a foreign candidate refuses). But
the projection-build severing — a `workflow_admitted` node's `DerivedFrom` edge citing a
local-only candidate is **dropped at projection build** and `knowledge_cross_root_denied` fires
(D2) — is never exercised: the fixture's primary has no `workflow_admitted` node (finding:P1 is
a direct `addKnowledgeNode`). A correct-vs-buggy severing is indistinguishable.

**Concrete fix:** add a RED row whose PRIMARY ledger contains a `knowledge.workflow_admitted`
node (admitted in the primary via the #63 path) with a `DerivedFrom` edge to a candidate; assert
the projected slice carries no edge whose `from`/`to` is a candidate id (and/or that the
projection build refuses `knowledge_cross_root_denied`).

### F3.4 [NEEDS-FOLD, MINOR] D5's read shape is pinned only on `projectHorizon` and on STRICT refusals

A3-R2 pins `projectHorizon`'s `{epochLag, sourceRoot}`. R-R3/K-R3/K-R4 pin strict *refusals* of
`coord.recallKnowledge`. **No row asserts a SUCCESSFUL non-strict `knowledge.recall` on a
non-primary** serves the primary's node with `{epochLag, sourceRoot}` and appends nothing to the
consumer ledger (A6's "a projected read appends nothing"). A correct implementation that frames
`projectHorizon` but forgets the recall lane passes.

**Concrete fix:** add a RED row: on a fresh replica, a non-strict
`replicaCoord.recallKnowledge(query, reader, {idempotencyKey})` returns the primary's finding
with `epochLag: 0` (integer) and `sourceRoot: 'deployment-primary'`, the UNTRUSTED frame, AND
`replica.ledgerHeadSeq() === 0` (no `knowledge.recall` event appended).

### F3.5 [SOUND, with F1.2 caveat] The cross-store replay law is otherwise pinned

- No-merge: R-R1 (`replica.ledgerHeadSeq() === 0` after a projection read) + A3-P2. ✅
- Dedup by primary idempotencyKey: R-R2. ✅
- Strict-prefix gap: R-R3 (`knowledge_primary_unreachable`). ✅ — but only the *ahead-of-head*
  case (`projectionReplayPosition 5 > head 2`); a mid-stream gap is not representable with the
  scalar `projectionReplayPosition` surface and so is untested. Acceptable given the invented
  surface; note it in the suite header if strict-prefix law (iii) must also cover a skipped
  intermediate project-persistent event.
- Anchoring: R-R1 — **broken assertion** (F1.2). The law is effectively unpinned until the
  assertion is corrected.

---

## Axis 4 — Hermeticity / #7-class

**Verdict: SOUND** (one comment fix, no behavioral defect).

### F4.1 [SOUND] No wall-time or process-liveness dependence

Fixed clock (`FIXED_TS`) everywhere; coordinator `now: () => Date.parse(FIXED_TS)`; fixed lease
timestamps; `epochLag` derived from ledger seqs, never wall time; `referee`/`route`/`worktrees`
are mocks; no provider spawns; no network; `test.after` cleans tmpdirs. No row depends on the
test machine's clock or on another process staying alive.

### F4.2 [SOUND, documented tool dependency] The suite is not subprocess-free — it depends on the `git` executable

`gitRoot`/`repoIdOf` run `git init`, `git commit`, `git rev-parse` via `execFileSync` for the
repoId mint (the `application-deployment.mjs:175` precedent). Hermetic-local (deterministic,
self-contained tmpdirs) and documented in the suite header, but if `git` is absent every
gitRoot-based row crashes rather than failing at its named stage. Acceptable in this repo (git is
a first-class dependency); state it if the suite is ever run outside a git toolchain.

### F4.3 [SOUND] No reliance on the host's state

`mkdtempSync` under `os.tmpdir()`; on macOS `/tmp` is a symlink to `/private/tmp`, but the
fixtures never share a realpath with the worktree, so the A1-R4 containment walk is hermetic
(the git common-dir realpath is used only for the repoId mint, never for containment).

### F4.4 [NEEDS-FOLD, MINOR] K-R4's comment mis-states the D4 open-time check

K-R4's comment says the ghost primary "IS a deployment root — the D4 open-time check passes".
Contract D4 requires a **readable `state/coordination/events.jsonl`** (or the projection
checkpoint); the ghost has the directory but **no ledger** (it is never written), so a D4
descriptor-open would REFUSE it. The row itself is correct — it probes the runtime seam (the
store/coordinator are constructed directly with opts, bypassing the descriptor) where D5's
`knowledge_primary_unreachable` is the right posture — but the comment could mislead an
implementer into dropping the readable-events.jsonl clause from the D4 check so the ghost "passes
D4".

**Concrete fix:** correct the comment to say the ghost is a deployment root only by the
`resident/deployment.json` criterion, that the descriptor-open (D4) is bypassed by the store
seam, and that the absent ledger is the D5 runtime posture.

---

## Citation re-verification at `bcc2cd4`

The suite and the contract cite anchors verified at the fold HEAD `79a7826`. The current
worktree HEAD `bcc2cd4` carries #67 stall-watchdog content, so the `coordinator.mjs`,
`application.mjs`, and `application-semantics.mjs` anchors moved. Re-verified at this HEAD
(`grep -an` / `sed -n`):

| Anchor | Fold HEAD `79a7826` (as cited) | Worktree HEAD `bcc2cd4` (verified) |
|---|---|---|
| `recallKnowledge` | `coordinator.mjs:10486` | `coordinator.mjs:10705` |
| `serveKnowledge` | `coordinator.mjs:10513` | `coordinator.mjs:10732` |
| `admitWorkflowFinding` wrapper | `coordinator.mjs:11428` | `coordinator.mjs:11647` |
| `COORDINATION_MUTATORS` | `coordinator.mjs:261` | `coordinator.mjs:272` |
| both verbs in the mutator set | `coordinator.mjs:266` | `coordinator.mjs:277` |
| `promoteKnowledgeNode` callsites | `coordinator.mjs:13229` / `:6556` | `coordinator.mjs:13458` / `:6580` |
| `run.knowledge.seed` → `addKnowledgeNode` | `application.mjs:13197` | `application.mjs:13201` (`knowledgeSeed` `:13190`, dispatch `:12478`) |
| `knowledge.promote` liveMethod | `application-semantics.mjs:1509` / `:1515` | `application-semantics.mjs:1511-1519`, `liveMethod` `:1515` — `:1509` is now `repl.cite`'s `liveMethod: 'admitReplBinding + dropReplBinding'` |

Stable coordination-store anchors relied on by this review (unchanged between the fold HEAD and
this HEAD): `eventTime` `:410`; node fold `:8543-8554`; `ledgerHeadSeq` `:13374`;
`_validateKnowledgeEvidence` `:15803`; `_deriveWorkflowAdmission` `:16152` (ineligible throw
`:16166`); `admitWorkflowFinding` `:16207`; `addKnowledgeNode` `:16283`; `promoteKnowledgeNode`
`:16303`; `queryKnowledge` bound `:16690`; `readKnowledge` `:16997`; `UNTRUSTED_RECALLED_MEMORY`
`:17011`; `knowledgeContentDigest` `:17031`; `KNOWLEDGE_CANDIDATE_TRIGGERS` `:17020`;
`knowledgeCandidateQueue` `:17046`.

**Finding:** the suite's in-test citations are stale at this HEAD — A2-R2 cites
`coordinator.mjs:13229/:6556` (now `:13458/:6580`); A2-R3 cites
`application-semantics.mjs:1509 -> coordinator.mjs:11428` (now `:1511/:1515` and `:11647`; the
`:1509` reference points at the wrong method at this HEAD). The tests are behavioral and do not
depend on the cited numbers, but the suite header and the contract should re-anchor to the
verification HEAD `bcc2cd4` (or state that HEAD) so the citations stay law-clean.

---

## Verdict summary — all 28 rows

| Row | Status | Axis-1 green-able | Axis-2 | Axis-3 | Axis-4 |
|---|---|---|---|---|---|
| A1-R1 | RED | ✅ | ✅ | — | ✅ |
| A1-R2 | RED | ❌ **F1.1** | — | — | ✅ |
| A1-R3 | RED | ❌ **F1.1** | — | — | ✅ |
| A1-R4 | RED | ❌ **F1.1** | ⚠️ **F2.2** | — | ✅ |
| A1-R5 | RED | ❌ **F1.1** | ✅ | — | ✅ |
| A1-P1 | PIN | — | ⚠️ F2.6 note | — | ✅ |
| A2-R1 | RED | ✅ | ✅ (F2.4 seam note) | — | ✅ |
| A2-R2 | RED | ✅ | ✅ (F2.4 seam note) | — | ✅ |
| A2-R3 | RED | ✅ | ✅ | — | ✅ |
| A2-P1 | PIN | — | ✅ | — | ✅ |
| A2-P2 | PIN | — | ✅ | — | ✅ |
| A3-R1 | RED | ✅ | ✅ | — | ✅ |
| A3-R2 | RED | ✅ | ✅ | — | ✅ |
| A3-P1 | PIN | — | ✅ | — | ✅ |
| A3-P2 | PIN | — | ✅ | — | ✅ |
| S-R1 | RED | ✅ | ✅ | ✅ (F3.1) | ✅ |
| S-R2 | RED | ✅ | ✅ | ✅ (F3.1) | ✅ |
| S-P1 | PIN | — | ✅ | — | ✅ |
| R-R1 | RED | ❌ **F1.2** | — | ⚠️ anchoring (F1.2) | ✅ |
| R-R2 | RED | ✅ | — | ✅ (F3.5) | ✅ |
| R-R3 | RED | ✅ | — | ✅ (F3.5) | ✅ |
| R-P1 | PIN | — | ✅ | — | ✅ |
| K-R1 | RED | ✅ | — | — | ✅ |
| K-R2 | RED | ✅ | — | ⚠️ admission-side only (F3.3) | ✅ |
| K-R3 | RED | ✅ | — | ✅ | ✅ |
| K-R4 | RED | ✅ | — | ✅ | ⚠️ **F4.4** (comment) |
| K-P1 | PIN | — | ✅ | — | ✅ |
| G1 | PIN | — | ✅ | — | ✅ |

**Blockers that must be folded before this suite can gate the v1.1 implementation:** F1.1
(A1-R2..R5 unsatisfiable) and F1.2 (R-R1 eventTimeSeq). Both are fixes to the suite itself, not
to the contract. The missing-row findings F3.2/F3.3/F3.4 and the shallow-discrimination finding
F2.2 tighten the suite's red-keeping power but do not block it; F2.4 and F4.4 are fold notes for
the contract/suite comments.
