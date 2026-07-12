import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DECISION_ID = 'phase27-r7-egraph-retire-redirect';
const FALSE_OPS = new Set(['egraph.build', 'egraph.saturate', 'equivalence.prove', 'verification.skip', 'semantic_merge.authorize']);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const typed = (message, code, fields = {}) => Object.assign(new Error(message), { code, ...fields });
const abort = (ctx) => { if (ctx?.signal?.aborted) throw typed('e-graph evaluation cancelled', 'cancelled'); };

const POLICIES = Object.freeze({
  whole_repo: Object.freeze({
    decision: 'retired_native', redirect: ['integration.structured', 'behavior.compare', 'cpg.delta'], nativeEngine: false,
    reopeningGates: Object.freeze({ externalOnly: true, pinnedRealRepoTasksMin: 3, deploymentBoundsPass: true, falseCleanCounterexamplesMin: 2, independentOracleGrounded: true, externalCheckerRejectsAllCounterexamples: true }),
  }),
  whole_function: Object.freeze({
    decision: 'redirected_behavioral', redirect: ['behavior.fingerprint', 'behavior.compare', 'verify.pinned'], nativeEngine: false,
    reopeningGates: Object.freeze({ fingerprintAgreement: true, trustGateGreen: true, disjointOracleCorpusMultiplierMin: 10, oracleObservedDivergence: true, extractedPureKernelOnly: true }),
  }),
  expression_kernel: Object.freeze({
    decision: 'conditional_external_research', redirect: ['behavior.compare', 'verify.pinned'], nativeEngine: false,
    reopeningGates: Object.freeze({ externalOnly: true, translationValidation: true, realTaskKernelPairsMin: 5, independentlyLabeledPairsMin: 20, measuredFalsePositiveRateMax: 0, measuredFalseNegativeRateMax: 0, incrementalValueBeyondFingerprintPairsMin: 3, deploymentNodeAndWallBoundsPass: true }),
  }),
});

function policy(domain) {
  if (typeof domain !== 'string' || !Object.hasOwn(POLICIES, domain)) throw typed('unsupported e-graph evaluation domain', 'unsupported_domain');
  return POLICIES[domain];
}

function bounded(items, tokens) {
  const out = [];
  for (const item of items) {
    if (Buffer.byteLength(JSON.stringify([...out, item])) > tokens * 4) break;
    out.push(item);
  }
  return out;
}

export class AtlasEGraphEvaluation {
  constructor(opts = {}) {
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('e-graph evaluation artifactRoot required');
    if (!Number.isSafeInteger(opts.maxArtifactBytes) || opts.maxArtifactBytes <= 0) throw new TypeError('maxArtifactBytes must be deployment-derived');
    this.artifactRoot = opts.artifactRoot; this.maxArtifactBytes = opts.maxArtifactBytes; this.now = opts.now ?? Date.now; this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }

  card() {
    return Object.freeze({
      name: 'atlas-egraph-evaluation', version: '0.1.0', underlying: [`policy:${DECISION_ID}`],
      ops: { 'egraph.evaluate': { deterministic: true, latency_class: 'interactive', side_effects: 'writes_content_addressed_artifacts', reverifiable: true } },
      domains: Object.fromEntries(Object.entries(POLICIES).map(([domain, value]) => [domain, { decision: value.decision, nativeEngine: false, redirect: value.redirect }])),
      limitations: ['builds no e-graph', 'runs no equality saturation', 'produces no equivalence proof', 'has no verification or merge authority'],
    });
  }

  async invoke(op, args, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    abort(ctx); const domain = args?.domain; const selected = policy(domain);
    if (FALSE_OPS.has(op)) {
      const code = domain === 'whole_repo' ? 'r7_domain_retired' : domain === 'whole_function' ? 'r7_redirect' : 'r7_reopening_required';
      throw typed(`native e-graph operation unavailable for ${domain}; follow the recorded redirect and reopening gates`, code, { domain, decisionId: DECISION_ID, redirect: selected.redirect, reopeningGates: selected.reopeningGates });
    }
    if (op !== 'egraph.evaluate') throw typed(`unsupported e-graph evaluation operation: ${op}`, 'unsupported_op');
    const started = this.now(); this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, domain });
    const item = {
      recordType: 'egraph_evaluation_decision', decisionId: DECISION_ID, domain, decision: selected.decision,
      nativeEngine: false, redirect: selected.redirect, reopeningGates: selected.reopeningGates,
      reopeningMeaning: 'threshold_schema_requires_new_reviewed_external_tool_spec_and_does_not_enable_capability',
      meaning: 'policy_decision_not_equivalence_or_semantic_proof',
    };
    const artifact = { schemaVersion: 1, op, decisionId: DECISION_ID, items: [item] }; const serialized = `${JSON.stringify(artifact)}\n`; const digest = sha(serialized);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('e-graph evaluation artifact exceeds deployment budget', 'artifact_too_large');
    const artifactPath = join(this.artifactRoot, `${digest}.json`);
    if (existsSync(artifactPath) && sha(readFileSync(artifactPath)) !== digest) throw typed('e-graph evaluation artifact integrity failure', 'artifact_integrity');
    if (!existsSync(artifactPath)) writeFileSync(artifactPath, serialized, { mode: 0o600, flag: 'wx' });
    const payload = bounded(artifact.items, ctx.budgetTokens); const truncated = payload.length < artifact.items.length;
    const result = Object.freeze({
      op, status: truncated ? 'needs_resume' : 'ok', summary: `${domain}: ${selected.decision}`, payload,
      refs: [{ handle: `art:sha256:${digest}`, kind: 'egraph_evaluation_policy', digest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-egraph-evaluation-policy+json', path: artifactPath }],
      ...(truncated ? { cursor: `atlas-egraph-evaluation:${digest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: Math.max(0, this.now() - started), usd: 0, underlying: `policy:${DECISION_ID}` },
      provenance: { decisionId: DECISION_ID, domain, deterministic: true, meaning: 'policy_decision_not_equivalence_or_semantic_proof', mergeAuthority: false, verificationAuthority: false },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, domain, digest, status: result.status }); return result;
  }

  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required'); abort(ctx);
    const match = /^atlas-egraph-evaluation:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? '');
    if (!match || match[1] !== ref?.digest) throw typed('invalid e-graph evaluation cursor', 'invalid_cursor');
    let path; try { path = realpathSync(ref.path); } catch { throw typed('e-graph evaluation artifact unavailable', 'artifact_integrity'); }
    const root = realpathSync(this.artifactRoot); if (path !== join(root, `${ref.digest}.json`)) throw typed('e-graph evaluation artifact path escape', 'artifact_integrity');
    const bytes = readFileSync(path); if (sha(bytes) !== ref.digest) throw typed('e-graph evaluation artifact digest mismatch', 'artifact_integrity');
    let artifact; try { artifact = JSON.parse(bytes); } catch { throw typed('e-graph evaluation artifact JSON invalid', 'artifact_integrity'); }
    if (artifact.schemaVersion !== 1 || artifact.op !== 'egraph.evaluate' || artifact.decisionId !== DECISION_ID || !Array.isArray(artifact.items)) throw typed('e-graph evaluation artifact schema mismatch', 'artifact_integrity');
    const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > artifact.items.length) throw typed('invalid e-graph evaluation cursor offset', 'invalid_cursor');
    const payload = bounded(artifact.items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < artifact.items.length;
    return Object.freeze({ op: 'egraph.evaluate', status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} e-graph Decision records`, payload, refs: [ref], ...(truncated ? { cursor: `atlas-egraph-evaluation:${ref.digest}:${next}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `policy:${DECISION_ID}` }, provenance: { decisionId: DECISION_ID, resumed_from: offset, deterministic: true } });
  }

  async reverify(claim, args, ctx) {
    const rerun = await this.invoke('egraph.evaluate', args, ctx); return Object.freeze({ ok: rerun.refs[0].digest === claim?.refs?.[0]?.digest, observedDigest: rerun.refs[0].digest });
  }
}
