# Phase 48 Cairn audit-gated bounded recall — 2026-07-13

## Shipped checkpoint

Phase 48 makes Baton's local typed causal graph deliberately recallable without creating ambient
memory injection or an external graph runtime. `cairn/causal.recall` requires same-repository audit
and recall policies, pins one observation and valid-time boundary, and reruns the Phase 47 critical
audit before ranking. Unicode-scalar-safe normalized terms use fixed integer weights
(`idExact=1000`, `idToken=100`, `typeToken=40`, `bodyToken=10`) plus bounded breadth-first graph
distance (`max(1, 30 - 5 * distance)`), with node ID as the stable final tie break. Candidate bytes,
count, depth, rows, result count, snippets, receipts, and total result all have deployment ceilings.

Unresolved contradictions are returned only as complete endpoint/edge bundles and never silently
resolved. Results are framed `UNTRUSTED_RECALLED_MEMORY` and contain bounded snippets without local
paths or worker/edit/verification/merge/approval/publication/routing/proof/note/policy authority.
Direct, authenticated web, and MCP routes use the same repository-bound ACI operation and exact
read-only reverify.

Every successful invocation appends one compact `knowledge.recall` receipt before returning any
content. It retains query/term digests, sorted filters/seeds, policy, temporal boundary, ordered
IDs/versions/integer-score commitments, contradiction IDs, reader identity, and request/result/
receipt digests—never raw query text, terms, bodies, snippets, credentials, prompts, or paths. The
request digest is recomputed from compact query/reader/policy fields during replay. Returned nodes
project exact `ReadBy` edges; later invalidation, supersession, or contradiction resolution retains
the exact historical receipt in affected-reader contamination across restart.

The final hardening removes the public unreceipted preview surface. `causal.recall` opts into a
closed ACI card flag, so the registry injects its deployment envelope ceiling and the admitted
budget-derived payload ceiling as trusted context. Cairn performs exact pre-append sizing through a
private metadata-only gate; either ACI refusal leaves no receipt, `_knowledgeReads`, or `ReadBy`
effect. Generic post-return ACI validation remains defense in depth.

## Red-to-green verification

- Phase 48 passes **10/10** grouped BR tests.
- The canonical zero-quota suite passes **1016/1016** through `cd impl && npm test`.
- Exact scoring assertions prove the normative weight decomposition and stable equal-score node-ID
  ordering. Independent max+1 coverage includes malformed Unicode/NUL, query bytes/terms,
  candidates/scanned bytes, results, graph rows, graph depth, receipt bytes, and result bytes.
- Contradiction tests prove complete-bundle refusal and historical-before/current-after resolution
  behavior. Reader tests cover claims both before and after recall, restart reverify, `ReadBy`, and
  exact contamination blast radius.
- A self-consistent substituted `requestDigest` plus recomputed `receiptDigest` is rejected during
  restart. Separate ACI envelope and budget reds prove refusal before any recall/read effect.
- Direct, authenticated web, and authenticated MCP invoke/reverify paths remain green. Cancellation,
  append failure, idempotent replay/conflict, and audit failure return no content or partial receipt.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton evidence

The initial heterogeneous run in
`docs/reference/evidence/phase48-harness-matrix-2026-07-12/summary.json` exercised all intended
harness registrations concurrently against clean commit `c426b5d`. Exact harness/model/effort
request and resolution passed for Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, Claude
`claude-opus-4-6`/low, and Grok `grok-4.5`/low. GLM ran on PID `9159`, used 78,605 accounted tokens /
$0.568361, fresh-verified its scoped report, and fully reaped. Codex reached PID `9153` and the exact
provider model before Baton correctly rejected its terminal artifact after a 254,393-token budget
overrun. Claude reached PID `9165` and the requested model but its isolated login was unavailable.
Grok refused authentication before a provider PID. All terminal allocations accepted safe kill,
and all processes, worktrees, runtimes, branches, and writer authority reaped. The retained runner
now measures concurrency by actual pairwise turn-window overlap; Codex and GLM did overlap even
though the original summary's earlier aggregate metric reported false.

The clean Codex retry in
`docs/reference/evidence/phase48-codex-review-2026-07-12/summary.json` completed and fresh-verified
on PID `10655` with exact `codex` / `gpt-5.6-sol` / `low`, using 392,520 accounted tokens. It found
three real P1s: the public preview oracle, ACI output refusal after the receipt effect, and an opaque
durable request digest. Those findings produced the hardening in `dd221bf`, including the claimed-
before-reader complement requested by the review. Confirmed kill and every ownership cleanup check
passed.

The post-fix project-key GLM proof in
`docs/reference/evidence/phase48-postfix-glm-review-2026-07-13/summary.json` reviews committed
`dd221bf` through exact `glm` / `glm-4.7` / `low`. PID `56030` used 92,285 accounted tokens /
$0.762902, produced a scoped report, passed Baton's fresh-sandbox referee, received confirmed kill,
and passed every process/worktree/runtime/branch/writer-release check. The ignored owner-only
project credential was loaded only through `GlmSessionCli`; its value is absent from evidence and
Git.

The current two-Grok attempt in
`docs/reference/evidence/phase48-grok-concurrent-kill-reap-2026-07-13/summary.json` allocated exact
`grok-4.5`/low and `grok-composer-2.5-fast`/low routes concurrently on commit `597cb3e`. The installed
`grok 0.1.216` probe still reported `You are not authenticated` despite the owner-only auth file, so
both refused before native PID/model observation and no working-process kill can be claimed. Both
dead allocations accepted idempotent cleanup, and their private runtimes, worktrees, metadata,
branches, processes, and writer authority all reaped. Phase 21 remains the latest successful
authenticated concurrent Grok provider-observed interrupt/resume/kill proof.

## Review dispositions and retained scope

The first GLM report's route-advice audit finding was outside BR2, which governs `causal.recall`,
and its contradiction-limit concern described the implemented caller-limit behavior. Its useful
ranking-test request became an exact score regression.

The post-fix GLM headline claimed ID matches had weight 1, but its quoted result proves the opposite:
`decision:retry` is exactly `1*100 + 1*10 + 30 = 140`. No product change was warranted. Its genuine
coverage observation—no direct `maxGraphDepth+1` red—became a green regression, as did the promised
equal-score node-ID tie case. Its asymmetric contradiction and historical temporal cases were
already covered.

Phase 48 does not complete the full goal. Selective promotion breadth, failure/control/Scratch
promotion, Playbook/Skill promotion, recall feedback and utility learning, authenticated
contradiction/operator UX, retention/compaction, and deployment-neutral export remain active Cairn
work. Persistent provider-backed recovery and fork/rewind depth; quota/seat governance; Vantage,
Evidence Ladder, Scratch REPL/Bench, Skill Forge/computer use; deeper LSP/SSA/PDG/path/alias/heap/
implicit-flow/interprocedural analysis; semantic merge; and conditional e-graph research all remain
catalogued. No homelab or external project-manager runtime integration is part of this project.
