import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const typed = (message, code) => Object.assign(new Error(message), { code });
const ROWS = Object.freeze([
  { rung: 'R1', name: 'ast-cst-structural', status: 'shipped_proposal', paths: ['spec/phase13/atlas-structural-delta.md', 'spec/phase17/atlas-structural-search-rewrite.md', 'impl/src/atlas-structural.mjs', 'impl/src/atlas-rewrite.mjs'], limitations: ['no direct rewrite apply', 'syntax evidence is not semantic equivalence'] },
  { rung: 'R2', name: 'symbol-scip-index', status: 'shipped_bounded', paths: ['impl/src/atlas-index.mjs'], limitations: ['no live LSP daemon', 'language precision follows parser/index support'] },
  { rung: 'R3', name: 'cpg-cfg-path', status: 'shipped_bounded', paths: ['spec/phase18/atlas-cpg-slice.md', 'spec/phase19/atlas-cpg-delta-impact.md', 'spec/phase20/atlas-cpg-taint.md', 'spec/phase22/atlas-cpg-path-sensitive.md', 'impl/src/atlas-cpg.mjs', 'impl/src/atlas-cpg-delta.mjs', 'impl/src/atlas-cpg-taint.mjs'], limitations: ['no full SSA or PDG', 'no aliases heap implicit flow exceptions or interprocedural returns'] },
  { rung: 'R4', name: 'compiler-ir', status: 'decision_ceiling_r3', paths: ['spec/phase24/atlas-representation-ceiling.md', 'impl/src/atlas-representation-ceiling.mjs'], limitations: ['produces no compiler IR', 'external LLVM MIR MLIR and translation validation remain gated'] },
  { rung: 'R5', name: 'behavioral-fingerprint', status: 'shipped_observational', paths: ['spec/phase25/atlas-behavior-fingerprint.md', 'impl/src/atlas-behavior-fingerprint.mjs'], limitations: ['observation is not equivalence proof'] },
  { rung: 'R6', name: 'structured-merge', status: 'shipped_structured', paths: ['spec/phase26/structured-merge.md', 'impl/src/structured-merge.mjs'], limitations: ['not true semantic merge', 'live Mergiraf binary remains environment-gated'] },
  { rung: 'R7', name: 'egraph-evaluation', status: 'decision_retired_native', paths: ['spec/phase27/egraph-evaluation.md', 'impl/src/atlas-egraph-evaluation.mjs'], limitations: ['native repository engine retired', 'external expression or kernel research remains conditional'] },
]);

function git(root, args, opts = {}) { return execFileSync('git', args, { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, ...opts }); }

export class AtlasRepresentationReview {
  constructor(opts = {}) {
    const limits = opts.limits; const fields = ['maxArtifactBytes', 'maxFileBytes', 'maxFiles', 'maxRows'];
    if (typeof opts.repoRoot !== 'string' || typeof opts.artifactRoot !== 'string' || !limits || Object.keys(limits).sort().join(',') !== fields.sort().join(',') || Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new TypeError('representation review requires repository, artifact root, and exact positive limits');
    this.repoRoot = opts.repoRoot; this.artifactRoot = opts.artifactRoot; this.limits = Object.freeze({ ...limits }); mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }
  card() { return Object.freeze({ name: 'atlas-representation-review', version: '0.1.0', underlying: ['git:committed-tree', 'baton:fixed-representation-ladder'], ops: { 'representation.review': { deterministic: true, latency_class: 'bounded_batch', side_effects: ['writes_content_addressed_artifacts'], reverifiable: true } }, limitations: ['inventory attestation is not behavior proof', 'retains every missing rung and Decision honestly'] }); }
  _build(args, ctx = {}) {
    if (ctx.signal?.aborted) throw typed('representation review cancelled', 'cancelled');
    if (!args || Object.keys(args).join(',') !== 'treeSha' || !/^[a-f0-9]{40,64}$/.test(args.treeSha ?? '')) throw typed('exact tree SHA required', 'representation_review_invalid');
    const head = git(this.repoRoot, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); if (head !== args.treeSha) throw typed('representation review tree is not current', 'representation_tree_changed');
    let files = 0; const rows = ROWS.map((row) => {
      const sources = row.paths.map((path) => { if (++files > this.limits.maxFiles) throw typed('representation file ceiling exceeded', 'representation_review_oversize'); let bytes; try { bytes = git(this.repoRoot, ['show', `${args.treeSha}:${path}`], { maxBuffer: this.limits.maxFileBytes + 1 }); } catch (error) { if (error?.code === 'ENOBUFS') throw typed('representation source exceeds file ceiling', 'representation_review_oversize'); throw error; } if (bytes.length > this.limits.maxFileBytes) throw typed('representation source exceeds file ceiling', 'representation_review_oversize'); return { path, bytes: bytes.length, digest: sha(bytes) }; });
      const core = { rung: row.rung, name: row.name, status: row.status, sources, limitations: row.limitations }; return { ...core, rowDigest: sha(Buffer.from(JSON.stringify(core))) };
    });
    if (rows.length > this.limits.maxRows) throw typed('representation row ceiling exceeded', 'representation_review_oversize');
    const document = { schemaVersion: 1, kind: 'baton-representation-review', treeSha: args.treeSha, rows, missingStillPlanned: ['live-lsp', 'ssa-pdg-path-solving', 'aliases-heap-implicit-flow', 'exceptions-interprocedural-returns', 'external-ir-translation-validation', 'true-semantic-merge', 'conditional-expression-kernel-egraphs'] }; const serialized = `${JSON.stringify(document)}\n`; if (Buffer.byteLength(serialized) > this.limits.maxArtifactBytes) throw typed('representation review artifact exceeds ceiling', 'representation_review_oversize'); return { document, serialized, digest: sha(Buffer.from(serialized)) };
  }
  async invoke(op, args, ctx = {}) {
    if (op !== 'representation.review') throw typed('unsupported representation review operation', 'unsupported_op'); if (!Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required'); const built = this._build(args, ctx); const path = join(this.artifactRoot, `${built.digest}.json`); if (existsSync(path) && sha(readFileSync(path)) !== built.digest) throw typed('representation review artifact integrity failure', 'artifact_integrity'); if (!existsSync(path)) writeFileSync(path, built.serialized, { mode: 0o600, flag: 'wx' }); const payload = built.document.rows; if (Buffer.byteLength(JSON.stringify(payload)) > ctx.budgetTokens * 4) throw typed('representation review exceeds context budget', 'context_oversize'); return Object.freeze({ op, status: 'ok', summary: `attested ${payload.length} representation rungs at ${args.treeSha.slice(0, 12)}`, payload, refs: [{ handle: `art:sha256:${built.digest}`, kind: 'representation_review', digest: built.digest, bytes: Buffer.byteLength(built.serialized), mediaType: 'application/vnd.baton.representation-review+json', path }], cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: 'git:committed-tree' }, provenance: { treeSha: args.treeSha, deterministic: true, inventoryOnly: true, editAuthority: false, verificationAuthority: false, mergeAuthority: false, approvalAuthority: false, publicationAuthority: false, routingMutationAuthority: false, proofAuthority: false, policyAuthoringAuthority: false } });
  }
  async reverify(claim, op, args, ctx) { const rebuilt = await this.invoke(op, args, ctx); return Object.freeze({ ok: JSON.stringify(rebuilt) === JSON.stringify(claim), observedDigest: rebuilt.refs[0].digest }); }
}
