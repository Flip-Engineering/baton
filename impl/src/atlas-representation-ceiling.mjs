import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, sep } from 'node:path';

const DECISION_ID = 'phase24-js-ts-r3-ceiling';
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const FALSE_R4_OPS = new Set(['ir.build', 'ir.delta', 'tv.validate']);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const typed = (message, code, fields = {}) => Object.assign(new Error(message), { code, ...fields });
const abort = (ctx) => { if (ctx?.signal?.aborted) throw typed('representation policy query cancelled', 'cancelled'); };

function confinedPath(path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) throw typed('relative source path required', 'path_escape');
  const normalized = normalize(path);
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) throw typed('source path escapes repository', 'path_escape');
  return normalized.split(sep).join('/');
}

function family(path) {
  if (!EXTENSIONS.has(extname(path).toLowerCase())) throw typed('representation policy has no compiler-IR decision for this language', 'unsupported_language');
  return 'javascript-typescript';
}

function bounded(items, tokens) {
  const out = [];
  for (const item of items) {
    if (Buffer.byteLength(JSON.stringify([...out, item])) > tokens * 4) break;
    out.push(item);
  }
  return out;
}

export class AtlasRepresentationCeiling {
  constructor(opts = {}) {
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('representation policy artifactRoot required');
    if (!Number.isSafeInteger(opts.maxArtifactBytes) || opts.maxArtifactBytes <= 0) throw new TypeError('maxArtifactBytes must be deployment-derived');
    this.artifactRoot = opts.artifactRoot;
    this.maxArtifactBytes = opts.maxArtifactBytes;
    this.now = opts.now ?? Date.now;
    this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }

  card() {
    return Object.freeze({
      name: 'atlas-representation-ceiling',
      version: '0.1.0',
      underlying: [`policy:${DECISION_ID}`],
      ops: { 'representation.ceiling': { deterministic: true, latency_class: 'interactive', side_effects: 'writes_content_addressed_artifacts', reverifiable: true } },
      languageFamilies: { 'javascript-typescript': { extensions: [...EXTENSIONS].sort(), maximumRung: 'R3' } },
      limitations: ['produces no compiler IR', 'produces no translation-validation verdict', 'external LLVM/MIR/MLIR paths remain separately gated'],
    });
  }

  async invoke(op, args, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    abort(ctx);
    const path = confinedPath(args?.path);
    const languageFamily = family(path);
    if (FALSE_R4_OPS.has(op)) {
      throw typed(`${languageFamily} representation ceiling is R3; use structural/CPG capabilities or a separately tool-gated external IR path`, 'rung_ceiling', {
        maximumRung: 'R3', decisionId: DECISION_ID, redirects: ['diff.structural', 'cpg.build', 'cpg.delta', 'cpg.taint'],
      });
    }
    if (op !== 'representation.ceiling') throw typed(`unsupported representation policy operation: ${op}`, 'unsupported_op');

    const started = this.now();
    this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, path });
    const item = {
      recordType: 'representation_ceiling', path, languageFamily, maximumRung: 'R3', decisionId: DECISION_ID,
      availableViews: ['R0:text', 'R1:ast-structural', 'R2:symbol-scip', 'R3:cpg-cfg-may-dataflow'],
      unavailableViews: ['R4:compiler-ir', 'translation-validation'],
      redirects: ['diff.structural', 'cpg.build', 'cpg.delta', 'cpg.taint'],
      meaning: 'representation_availability_policy_not_behavioral_or_translation_validation_proof',
    };
    const artifact = { schemaVersion: 1, op, decisionId: DECISION_ID, items: [item] };
    const serialized = `${JSON.stringify(artifact)}\n`;
    const digest = sha(serialized);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('representation policy artifact exceeds deployment budget', 'artifact_too_large');
    const artifactPath = join(this.artifactRoot, `${digest}.json`);
    if (existsSync(artifactPath) && sha(readFileSync(artifactPath)) !== digest) throw typed('representation policy artifact integrity failure', 'artifact_integrity');
    if (!existsSync(artifactPath)) writeFileSync(artifactPath, serialized, { mode: 0o600, flag: 'wx' });
    const payload = bounded(artifact.items, ctx.budgetTokens); const truncated = payload.length < artifact.items.length;
    const result = Object.freeze({
      op,
      status: truncated ? 'needs_resume' : 'ok',
      summary: `${languageFamily} maximum representation rung is R3`,
      payload,
      refs: [{ handle: `art:sha256:${digest}`, kind: 'representation_policy', digest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-representation-policy+json', path: artifactPath }],
      ...(truncated ? { cursor: `atlas-representation:${digest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: Math.max(0, this.now() - started), usd: 0, underlying: `policy:${DECISION_ID}` },
      provenance: {
        decisionId: DECISION_ID, representationRung: 'R3', languageFamily, deterministic: true,
        semanticDeltaMeaning: 'structural_and_cpg_delta_are_review_signals_not_translation_validation',
      },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, path, digest, status: result.status });
    return result;
  }

  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    abort(ctx);
    const match = /^atlas-representation:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? '');
    if (!match || match[1] !== ref?.digest) throw typed('invalid representation policy cursor', 'invalid_cursor');
    let path; try { path = realpathSync(ref.path); } catch { throw typed('representation policy artifact unavailable', 'artifact_integrity'); }
    const root = realpathSync(this.artifactRoot);
    if (path !== join(root, `${ref.digest}.json`)) throw typed('representation policy artifact path escape', 'artifact_integrity');
    const bytes = readFileSync(path); if (sha(bytes) !== ref.digest) throw typed('representation policy artifact digest mismatch', 'artifact_integrity');
    let artifact; try { artifact = JSON.parse(bytes); } catch { throw typed('representation policy artifact JSON invalid', 'artifact_integrity'); }
    if (artifact.schemaVersion !== 1 || artifact.op !== 'representation.ceiling' || artifact.decisionId !== DECISION_ID || !Array.isArray(artifact.items)) throw typed('representation policy artifact schema mismatch', 'artifact_integrity');
    const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > artifact.items.length) throw typed('invalid representation policy cursor offset', 'invalid_cursor');
    const payload = bounded(artifact.items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < artifact.items.length;
    return Object.freeze({
      op: 'representation.ceiling', status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} representation policy records`, payload, refs: [ref],
      ...(truncated ? { cursor: `atlas-representation:${ref.digest}:${next}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `policy:${DECISION_ID}` },
      provenance: { decisionId: DECISION_ID, resumed_from: offset, deterministic: true },
    });
  }

  async reverify(claim, op, args, ctx) {
    const rerun = await this.invoke(op, args, ctx);
    return Object.freeze({ ok: rerun.refs[0].digest === claim?.refs?.[0]?.digest, observedDigest: rerun.refs[0].digest });
  }
}
