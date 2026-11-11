# Phase 46 — attested representation review packet

## RP1 — complete fixed ladder

One packet enumerates every retained representation rung: R1 AST/CST structural delta/rewrite,
R2 symbol graph/SCIP, R3 bounded CPG/CFG/path/taint/delta, R4 compiler-IR ceiling Decision, R5
behavioral fingerprint, R6 structured merge, and R7 e-graph evaluation Decision. No caller can add,
remove, rename, reorder, or relabel a rung.

## RP2 — committed source attestation

Input is only the exact current Git tree SHA. Every row names a fixed confined set of implementation
and contract paths read from that commit with argument-safe Git. The packet records each file digest,
byte count, and a row digest. Worktree prose and untracked files cannot affect it.

## RP3 — honest status language

Closed statuses distinguish shipped bounded observation/proposal capabilities from policy Decisions
and retirements. The packet never upgrades CPG to compiler IR, fingerprints to equivalence,
structured merge to semantic proof, or a Decision to an implementation.

## RP4 — bounded content-addressed packet

Deployment pins file, per-file byte, artifact byte, and result-row ceilings. Any max+1 refuses; no
partial ladder is emitted. The canonical packet is written mode 0600 under a content-addressed path.

## RP5 — replay and reverify

Reverify rebuilds the packet from the same current commit and compares its digest. Tree drift,
source substitution, occupied artifact paths, cancellation, schema mutation, and claim substitution
fail closed.

## RP6 — authority and reachability

The operation is read-only evidence inventory behind the existing Coordinator-owned ACI registry
and generic authenticated web/MCP invoke/reverify surfaces. It grants no edit, verification, merge,
approval, publication, routing, proof, or policy-authoring authority.

## RP7 — next work remains visible

Rows explicitly retain missing SSA/PDG/path solving, aliases/heap/implicit flow, exceptions,
interprocedural returns, live LSP, external IR/translation validation, true semantic merge, and
conditional expression/kernel e-graphs. This packet does not close those capabilities.

## RP8 — gates

Reds cover fixed row/order/status/path inventory, real committed-source digests, tree mismatch,
path/file/artifact/row max+1, cancellation, artifact tamper, reverify drift, authority denial, and
direct/generic northbound reachability. Live proof attests the Baton commit itself and fully cleans
artifact/writer ownership. No homelab or external project-manager runtime is involved.
