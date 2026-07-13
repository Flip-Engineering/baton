## Verdict

PASS

The Phase 50 implementation at 305c9e3 correctly realizes the Scratch correction oracle and independent release/supersede/retract surface. Oracle provenance is pinned to immutable fact trees with exact route tuple verification, release evidence chains require independent same-task verification with artifact pairing, correction derivation is deterministic and replay-safe, public projections never disclose private Scratch values or worker prose, and the coordination layer enforces exact bounded ceilings at every validation checkpoint.

## P0-P1 findings

None. The adversarial review confirms:

1. **Oracle provenance (SC1-SC4)**: `scratchOraclePolicy` and `knowledgeScratchCorrectionPolicy` are exact immutable configurations with the required fields. `spawnScratchOracle` refuses `auto` harness and validates independence by comparing both harness name and model family from the durable six-element route tuple. The private fact snapshot is bounded by `maxTargetBytes`, and worktree base SHA is pinned to `fact.envRef.treeSha` rather than repository HEAD.

2. **Exact route commitments (SC3)**: The route tuple (harness, harness version, model, effort, model family, task class) is preserved from task creation through claim, verified against producer and reviewer cards, and durably recorded in `task.claimed`. Independence checks compare `tuple[0]` (harness) and `tuple[4]` (model family) explicitly.

3. **Evidence chain integrity (SC4)**: `_eligibleScratchOracle` (coordination-store.mjs:2252-2282) enforces that the oracle task's accepted review artifact must have provenance binding to the exact same worker and run, and the paired commit artifact's SHA must match the verification's capture SHA. The test suite confirms that borrowed same-worker verification from another task is rejected.

4. **Release/supersede/retract derivation (SC5-SC8)**: `_deriveScratchCorrection` enforces exact action shapes, target validity versions, and contradiction conflicts. Observed replacements require `minScratchReaders` distinct completed verified task outcomes. Derived replacements require the exact independent oracle evidence chain. Correction events contain only safe projections—no Scratch values, Briefs, prompts, paths, or secrets.

5. **Replay integrity (SC9)**: Idempotency keys bind the exact request including policy digest. Replay validates the complete historical derivation and refuses any tampering. Boundary staleness is detected when non-administrative events intervene between the observed boundary and correction append.

6. **Non-disclosure (SC7, SC10)**: Public results contain only closed fields: action, repoId, observedSeq, eventSeq, digests, node IDs, grounding, affected read count. Tests confirm that "SECRET" values and paths like `/Users/alice/private` never appear in JSON output. Scratch values are retained only in private snapshots bounded by policy.

7. **Authenticated transport parity (SC11)**: Web and MCP northbounds invoke the same coordinator methods with normalized `operator:${actor}` context. Reverify checks refuse forged `ctx.transport` and mismatched actors. Test coverage confirms direct, web, and MCP invocation paths work identically.

8. **Ceiling enforcement (SC8)**: Max+1 overflow checks at scan, affected reads, evidence refs, batch bytes, and result bytes refuse rather than truncate. ACI preflight output validation enforces `maxEnvelopeBytes` and `maxPayloadBytes` before the event becomes durable.

## Required corrections

No corrections required. The implementation is faithful to the spec and all test suites pass.