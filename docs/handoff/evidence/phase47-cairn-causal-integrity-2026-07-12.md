# Phase 47 Cairn causal integrity and attested audit — 2026-07-12

## Shipped checkpoint

Phase 47 closes the integrity prerequisite for bounded Cairn recall. Generic knowledge events are
content-bound and replay-validated, retain observation-version history, and support true bitemporal
queries. Supersession is live, same-type, acyclic, validity-CAS bound, and atomic with exact-reader
contamination. Contradictions have canonical unordered identities, cannot be born resolved, and
close only through an authorized winner/loser/edge CAS event that invalidates the loser and records
the exact affected reads.

`causal.audit` independently reports causal completeness, temporal coherence, structure/orphans,
grounding/lineage, contradiction state, recall utility, and contamination at one pinned observation
boundary. `causal.trace` walks only live typed causal rows with cycle protection, stable order, exact
node/edge/evidence/frontier accounting, and deployment ceilings. Direct claims preserve their local
artifact path; authenticated web/MCP claims use the same registry and only transport-redact that
path. Both remain fully reverifiable and carry no worker, edit, verification, merge, approval,
publication, routing, proof, note, or policy-authoring authority.

The recursive review found that northbound idempotency was merely forwarded. The ACI registry now
durably binds repository, actor, key, action, capability, operation, bounded input digest, budget,
and terminal result in an owner-only record. Identical concurrent requests coalesce, restart
duplicates replay, changed requests conflict, and an incomplete prior effect refuses pending
reconciliation. Raw request input is not retained in the record or operational audit.

Audit artifacts are size/owner/mode checked through a no-follow descriptor before any read.
Cancellation is rechecked after scan, after observation-time acquisition, at publication, and
before return; any packet created by an operation whose final gate closes is removed. The packet's
versioned, digested stable-ID catalog retains the whole goal, including authenticated control,
exact harness/model/effort routing, sessions/reap, trust and publication, adaptive routing, shared
memory/recall, AST/CST/SCIP/CPG/IR/semantic delta, Vantage, Evidence Ladder, Scratch, Skill Forge,
Cartographer/Quartermaster/Cairn, fingerprints/semantic merge, and conditional e-graphs. No homelab
or external project-manager runtime is involved.

## Red-to-green verification

- Phase 47 passes **15/15** grouped CA tests.
- The canonical zero-quota suite passes **1005/1005** through `cd impl && npm test`.
- New reds prove concurrent and restart ACI replay, changed-request conflict, durable request/result
  binding, oversized occupied-artifact refusal before content comparison, and cancellation during
  observation-time publication setup with no residue.
- Compatibility regressions cover the generic Phase 29 ACI contract, authenticated web/MCP,
  representation review, and the Phase 38/39 reuse paths. Legacy fixtures that reused one key for
  two different operations now use distinct command identities.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton evidence

All live work ran through Baton against clean detached clones of commit `51217cf`; credentials were
referenced only by owner-only paths and were never printed or copied into evidence.

The heterogeneous matrix in
`docs/reference/evidence/phase47-harness-matrix-2026-07-12/summary.json` simultaneously launched
three distinct native PIDs with exact low-effort routes: Claude `claude-opus-4-6`, Codex
`gpt-5.6-sol`, and GLM `glm-4.7`. Claude reached the requested model but its isolated CLI reported
not logged in. The first Codex leg performed work and wrote its scoped report, then Baton correctly
hard-stopped it at the initial 160k accounting ceiling. GLM used the ignored project-local
`glm_key.json` through `GlmSessionCli`, consumed 131,475 accounted tokens / $1.190776, produced a
freshly verified report, received confirmed kill, and left no process, worktree, runtime, branch,
or writer authority.

The ceiling-derived Codex retry in
`docs/reference/evidence/phase47-codex-review-live-2026-07-12/summary.json` completed on PID `84338`
with exact `gpt-5.6-sol` / `low`, consumed 361,620 accounted tokens, passed fresh verification, and
fully reaped. Its three P1s were real: unbound registry idempotency, pre-bound occupied-artifact
reads, and cancellation crossing the publication seam. All three supplied the red tests and fixes
described above.

The current two-Grok attempt in
`docs/reference/evidence/phase47-grok-concurrent-kill-reap-2026-07-12/summary.json` requested and
resolved exact `grok-4.5` / `low` and `grok-composer-2.5-fast` / `low` concurrently. Despite the
owner-only `~/.grok/auth.json` being present, the installed `grok 0.1.216` `models` probe reported
`You are not authenticated`, so both allocations refused before provider PID/identity and could not
exercise a fresh working-process kill. Baton still reaped both worktrees, runtime scopes, branches,
process allocations, and writer authority. Phase 21 remains the latest successful authenticated
two-Grok provider-observed interrupt/resume/kill/idempotent-reap proof; this run does not relabel the
current authentication failure green.

## Review dispositions and remaining scope

The GLM report found no P0. Its claim that observed Findings require verified lineage conflicts
with CA4, which deliberately applies that upgrade requirement only to `grounding: verified`; any
evidence that is referenced must exist, but an observed claim is not silently promoted. Its trace
frontier scenario is already refuted by the triangle and wide-graph regressions: every node at the
allowed depth is visited, and only undiscovered next-depth nodes remain frontier. Its future-dated
contradiction question is allowed by the bitemporal contract when endpoints are live at the stated
valid time; CA2 requires a parseable non-negative interval, not transaction time equal to valid
time. None required a product change.

Phase 47 is an integrity/audit gate, not recall completion. Phase 48 still owes audit-gated bounded
lexical and graph ranking, contradiction bundles, compact durable read receipts, pull-only proof,
authenticated ACI reach, and exact replay/reverify. Broader control/failure/Scratch promotion,
Playbook/Skill promotion, recall feedback, deployment-neutral export, deeper language analysis,
provider/session/runtime depth, and the rest of the full-system catalog remain active.
