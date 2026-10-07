# Phase 55 — immutable bounded toolchain projection handoff

## Outcome

Phase 55 is implemented, canonical-green, and recursively used. Baton can execute a clean exact-SHA
target with a separately attested dependency source without a runner copying dependencies into the
target. Source paths remain private; the durable identity is content and deployment policy.

Eleven grouped Phase 55 contracts and the full 1141/1141 suite pass.

## Implementation evidence

- `c82d22c` — numbered immutable dual-root contract.
- `3a6b4c9` — red projection tests.
- `20d9adc` — bounded recursive GLM build harness.
- `f07afcc` — retained untrusted GLM scaffold snapshot; not represented as passing.
- `4995d1d` — completed projection, worktree/session/trust provenance, cleanup, and regressions.
- `c27d42d` and `6a60d45` — projected five-route matrix plus exact process start/close oracle.

The implementation accepts one closed schema with an absolute private source root, safe source ID,
non-overlapping mappings, every explicit deployment limit, and expected manifest digest. Inspection
and the public identity omit the source root. Materialization accepts ordinary directories/files
only, checks descriptor identity and source epochs, copies bounded bytes into new ordinary inodes,
verifies the destination, rescans the source, and removes every partial target on refusal.

Worker capture uses per-worktree excludes but also explicitly refuses any tracked projection path,
so `git add -f` cannot smuggle dependencies into a result. Result/base verifiers receive independent
copies and must match the worker identity before the referee. Worktree readiness, native-session
resume/replay, and structured merge bind the same identity. Legacy dependency directories remain
unchanged when the new mode is absent; mixed configuration refuses before driver authority.

## Validation

- Focused Phase 55: 11/11.
- Focused Phase 55 plus worktree and adjacent lifecycle/trust/representation gates: green.
- Canonical `cd impl && npm test`: 1141/1141.
- `git diff --check`: green.

The tests cover relocation/determinism; closed configuration and unsafe paths; links, hardlinks,
setuid/setgid and FIFO refusal; every independent exact/max+1 ceiling including UTF-8 path bytes;
byte/inode/source/sibling isolation; source drift; clean capture and force-add refusal; worker and
verifier cleanup; result/replay/session identity; base-verifier substitution; source change before
verification; explicit same-root new mode; and legacy compatibility.

## Recursive dogfood evidence

The pre-fix exact GLM build used project `glm_key.json` through the credential-file boundary,
requested `glm-4.7`/low, produced a candidate, reported 130,059 tokens and $4.541078 after crossing
the $4.50 cap, failed pinned verification, then closed PID/group 30388 through correlated kill and
restored all ownership. The key value was never retained.

The post-fix matrix targeted clean detached `6a60d45`, which had no `impl/node_modules`, while the
development checkout supplied only that mapped tree through Phase 55. Exact low-effort Codex
`gpt-5.6-sol`, Claude `claude-opus-4-6`, project-key GLM `glm-4.7`, Grok `grok-4.5`, and Grok
`grok-build` were all admitted. PIDs/groups 79977, 79983, 79989, 79993, and 79997 all have matching
process-close evidence, correlated kill confirmation plus explicit post-terminal kill disposition,
and complete process/worktree/runtime/branch/writer reap. Grok intervals overlap. Every worker and
fresh verifier binds projection digest
`e46aa5673aaebf908b58137910ce645da0b762c2324e649ed1416e614da80d5a`; the source host path is absent
from retained events, and no projection remains in the target.

GLM used 72,877 tokens and $0.989164 and fresh-verified its report. That report's claimed hardlink P0
is rejected: `before.nlink !== 1` throws, the dedicated hardlink regression passes, and the same
Phase 55 test file passed in the independent verifier. It remains retained as untrusted model prose.
Codex crossed its token cap and was cancelled; Claude failed its report gate; both Grok processes
reported `Authentication required` before provider readiness. Thus lifecycle and projection gates
are green while the strict provider matrix is honestly red.

## Dogfood-directed next slice

Earlier direct exploratory tests had left 8,899 `baton-*` directories (about 407 MB) in the user temp
root and contributed to ENOSPC. They were removed without touching repository source, credentials,
or unrelated files. Canonical suite ownership exists, but bespoke evidence/direct test entrypoints
need the same enforced temp-root contract.

Next operational work is route-specific terminal-burst/provider-preauthorization and mechanical
tool-call governance, universal temp-root ownership, and one public drain-and-close attestation.
This does not replace provider-backed in-flight continuation; Scratch Board/Bench; Skill/Playbook
promotion/revocation; authenticated WebSocket/operator takeover depth; evaluation; live LSP and
deeper CPG/PDG/alias/interprocedural representation; true semantic merge; or conditional
expression/kernel e-graphs. Baton's local causal graph remains inspired by project-manager prior
art, but no homelab or external project-manager runtime is in scope.
