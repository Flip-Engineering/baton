import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const typed = (message, code) => Object.assign(new Error(message), { code });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const normalizedText = (value, code) => {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value) > 2048 || value.includes('\0')) throw typed('orientation/reuse text is invalid', code);
  return value.trim().replace(/\s+/g, ' ');
};
const terms = (value) => [...new Set(value.toLowerCase().match(/[a-z_$][a-z0-9_$.-]*/g) ?? [])].filter((term) => term.length > 1).slice(0, 32);
const bounded = (items, budgetTokens) => {
  const payload = [];
  for (const item of items) {
    if (Buffer.byteLength(JSON.stringify([...payload, item])) > budgetTokens * 4) break;
    payload.push(item);
  }
  return payload;
};
const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const seedEvidence = (item) => {
  if (!item || typeof item.path !== 'string' || !Number.isFinite(item.score) || !Array.isArray(item.symbols)
    || !stringArray(item.imports) || !Array.isArray(item.calls)) throw typed('Atlas seed item schema mismatch', 'orientation_source_integrity');
  const lexicalProjection = item.score - item.symbols.length * 5 - item.imports.length * 0.1;
  const lexicalLines = Math.round(lexicalProjection);
  if (!Number.isSafeInteger(lexicalLines) || lexicalLines < 0 || Math.abs(lexicalProjection - lexicalLines) > 1e-9) throw typed('Atlas seed score projection mismatch', 'orientation_source_integrity');
  return { lexicalLines, matched: item.symbols.length > 0 || item.calls.length > 0 || lexicalLines > 0 };
};
const briefItem = (item) => {
  const evidence = seedEvidence(item);
  return {
    path: item.path, score: item.score, lexicalLines: evidence.lexicalLines,
    symbols: item.symbols.slice(0, 64), symbolCount: item.symbols.length,
    imports: item.imports.slice(0, 64), importCount: item.imports.length,
    calls: item.calls.slice(0, 64), callCount: item.calls.length,
    detailTruncated: item.symbols.length > 64 || item.imports.length > 64 || item.calls.length > 64,
  };
};

export class CartographerQuartermaster {
  constructor(opts = {}) {
    if (!opts.atlas || typeof opts.atlas.invoke !== 'function') throw new TypeError('Cartographer/Quartermaster requires AtlasCodeIndex');
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('Cartographer/Quartermaster artifactRoot required');
    this.atlas = opts.atlas; this.now = opts.now ?? Date.now;
    if (typeof opts.atlas.resultRoot !== 'string' || opts.atlas.resultRoot.length === 0) throw new TypeError('Cartographer/Quartermaster requires Atlas resultRoot');
    this.atlasResultRoot = realpathSync(opts.atlas.resultRoot);
    const artifactRoot = resolve(opts.artifactRoot); mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); this.artifactRoot = realpathSync(artifactRoot);
  }

  card() {
    return {
      name: 'cartographer-quartermaster', version: 1,
      ops: {
        'orientation.slice': { latency_class: 'interactive', deterministic: true, side_effects: ['content_addressed_artifact'], reverifiable: true },
        'reuse.internal': { latency_class: 'interactive', deterministic: true, side_effects: ['content_addressed_artifact'], reverifiable: true },
      },
      underlying: ['atlas-index:code.seed', 'atlas-index:repo.map'],
      limitations: ['Rung 0 supports brief/map orientation and internal reuse only', 'no external package vet, auto-install, SBOM, reachability gate, worker push, or semantic prose'],
    };
  }

  _abort(ctx) { if (ctx?.signal?.aborted) throw typed('orientation/reuse cancelled', 'cancelled'); }

  _inner(result) {
    const ref = result?.refs?.[0];
    if (!ref || ref.kind !== 'atlas_results' || ref.mediaType !== 'application/vnd.baton.atlas-index+json'
      || typeof ref.path !== 'string' || !/^[a-f0-9]{64}$/.test(ref.digest ?? '')
      || ref.handle !== `art:sha256:${ref.digest}` || result?.provenance?.artifactDigest !== ref.digest) {
      throw typed('Atlas result reference invalid', 'orientation_source_integrity');
    }
    let path; try { path = realpathSync(ref.path); } catch { throw typed('Atlas result artifact unavailable', 'orientation_source_integrity'); }
    if (path !== join(this.atlasResultRoot, `${ref.digest}.json`)) throw typed('Atlas result artifact escaped result root', 'orientation_source_integrity');
    const raw = readFileSync(path);
    if (sha(raw) !== ref.digest || ref.bytes !== raw.length) throw typed('Atlas result digest mismatch', 'orientation_source_integrity');
    let full; try { full = JSON.parse(raw); } catch { throw typed('Atlas result JSON invalid', 'orientation_source_integrity'); }
    if (full.schemaVersion !== 1 || !Array.isArray(full.items) || full.op !== result.op
      || full.provenance?.index_epoch !== result.provenance?.index_epoch
      || (full.provenance?.overlay_digest ?? null) !== (result.provenance?.overlay_digest ?? null)
      || full.provenance?.staleness !== result.provenance?.staleness) {
      throw typed('Atlas result schema mismatch', 'orientation_source_integrity');
    }
    return { full, ref };
  }

  _write(document) {
    const bytes = `${stable(document)}\n`; const digest = sha(bytes); const path = join(this.artifactRoot, `${digest}.json`);
    if (!existsSync(path)) {
      try { writeFileSync(path, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
    }
    let observed; try { observed = readFileSync(path); } catch { throw typed('orientation artifact unavailable after write', 'artifact_integrity'); }
    if (sha(observed) !== digest || !observed.equals(Buffer.from(bytes))) throw typed('content-addressed orientation path is occupied by different bytes', 'artifact_integrity');
    return { digest, path, bytes: Buffer.byteLength(bytes) };
  }

  _loadArtifact(ref, expectedOp = null) {
    if (!ref || ref.kind !== 'orientation-reuse' || ref.mediaType !== 'application/vnd.baton.orientation-reuse+json'
      || !/^[a-f0-9]{64}$/.test(ref.digest ?? '') || ref.handle !== `art:sha256:${ref.digest}`) throw typed('orientation artifact reference invalid', 'artifact_integrity');
    const expected = join(this.artifactRoot, `${ref.digest}.json`); let path;
    try { path = realpathSync(ref.path); } catch { throw typed('orientation artifact unavailable', 'artifact_integrity'); }
    if (path !== expected) throw typed('orientation artifact path mismatch', 'artifact_integrity');
    const raw = readFileSync(path); if (sha(raw) !== ref.digest || ref.bytes !== raw.length) throw typed('orientation artifact digest mismatch', 'artifact_integrity');
    let document; try { document = JSON.parse(raw); } catch { throw typed('orientation artifact JSON invalid', 'artifact_integrity'); }
    if (document.schemaVersion !== 1 || !this.card().ops[document.op] || !Array.isArray(document.items)
      || (expectedOp !== null && document.op !== expectedOp)) throw typed('orientation artifact schema invalid', 'artifact_integrity');
    return document;
  }

  _result(document, ctx, started) {
    const artifact = this._write(document); const payload = bounded(document.items, ctx.budgetTokens); const truncated = payload.length < document.items.length;
    return Object.freeze({
      op: document.op, status: truncated ? 'needs_resume' : 'ok', summary: document.summary, payload,
      refs: [{ kind: 'orientation-reuse', handle: `art:sha256:${artifact.digest}`, digest: artifact.digest, bytes: artifact.bytes, path: artifact.path, mediaType: 'application/vnd.baton.orientation-reuse+json' }],
      ...(truncated ? { cursor: `orientation:${artifact.digest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: Math.max(0, this.now() - started), usd: 0, underlying: 'atlas-index:orientation-reuse-r0' },
      provenance: { ...document.provenance, artifactDigest: artifact.digest, deterministic: true, mergeAuthority: false, verificationAuthority: false },
    });
  }

  async invoke(op, args = {}, ctx = {}) {
    const started = this.now(); this._abort(ctx);
    if (!Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw typed('positive orientation budget required', 'invalid_budget');
    if (op === 'orientation.slice') {
      const focus = normalizedText(args.focus, 'invalid_orientation'); const shape = args.shape ?? 'brief';
      if (!['brief', 'map'].includes(shape)) throw typed('unsupported orientation shape', 'invalid_orientation');
      const atlasOp = shape === 'brief' ? 'code.seed' : 'repo.map';
      const atlasArgs = shape === 'brief' ? { indexEpoch: args.indexEpoch, terms: terms(focus) } : { indexEpoch: args.indexEpoch };
      if (shape === 'brief' && atlasArgs.terms.length === 0) throw typed('orientation focus has no searchable terms', 'invalid_orientation');
      const innerResult = await this.atlas.invoke(atlasOp, atlasArgs, ctx); this._abort(ctx);
      const { full, ref } = this._inner(innerResult); let items = full.items;
      if (shape === 'brief') items = items.filter((item) => seedEvidence(item).matched).slice(0, 512).map(briefItem);
      if (shape === 'map') {
        const needles = terms(focus); const pathFocus = focus.toLowerCase().replace(/^\.\//, '');
        const pathLike = pathFocus.includes('/') || pathFocus.includes('\\');
        for (const item of items) if (!item || typeof item.path !== 'string' || !stringArray(item.imports)) throw typed('Atlas map item schema mismatch', 'orientation_source_integrity');
        items = items.filter((item) => pathLike
          ? item.path.toLowerCase().includes(pathFocus)
          : item.path.toLowerCase().includes(pathFocus) || needles.some((term) => item.path.toLowerCase().includes(term) || item.imports.some((entry) => entry.toLowerCase().includes(term))));
      }
      return this._result({ schemaVersion: 1, op, query: { focus, shape, indexEpoch: args.indexEpoch }, summary: `${items.length} ${shape} orientation records for ${JSON.stringify(focus)}`, items,
        provenance: { index_epoch: innerResult.provenance.index_epoch, overlay_digest: innerResult.provenance.overlay_digest ?? null, staleness: innerResult.provenance.staleness, atlasArtifactDigest: ref.digest } }, ctx, started);
    }
    if (op === 'reuse.internal') {
      const need = normalizedText(args.need, 'invalid_reuse'); const queryTerms = terms(need);
      if (queryTerms.length === 0) throw typed('reuse need has no searchable terms', 'invalid_reuse');
      const innerResult = await this.atlas.invoke('code.seed', { indexEpoch: args.indexEpoch, terms: queryTerms }, ctx); this._abort(ctx);
      const { full, ref } = this._inner(innerResult);
      // Atlas code.seed includes import-count as a small ranking prior. That prior is useful after
      // a match but is not itself evidence that the requested capability exists; Quartermaster
      // must never turn an unrelated imported file into a build-vs-borrow recommendation.
      const candidates = full.items.filter((item) => seedEvidence(item).matched).slice(0, 64)
        .map((item) => ({ path: item.path, score: item.score, lexicalLines: seedEvidence(item).lexicalLines, symbols: item.symbols.slice(0, 64).map((symbol) => ({ name: symbol.name, kind: symbol.kind, symbol: symbol.symbol, range: symbol.range })) }));
      const verdict = { need, recommendation: candidates.length > 0 ? 'internal' : 'external_vet_required', candidates };
      return this._result({ schemaVersion: 1, op, query: { need, indexEpoch: args.indexEpoch }, summary: candidates.length > 0 ? `${candidates.length} internal reuse candidates` : 'no internal match; external vet required', items: [verdict],
        provenance: { index_epoch: innerResult.provenance.index_epoch, overlay_digest: innerResult.provenance.overlay_digest ?? null, staleness: innerResult.provenance.staleness, atlasArtifactDigest: ref.digest, externalLookup: false } }, ctx, started);
    }
    throw typed(`unsupported orientation/reuse op ${op}`, 'unsupported_op');
  }

  async resume(ref, cursor, ctx = {}) {
    if (!Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw typed('positive orientation budget required', 'invalid_budget'); this._abort(ctx);
    const match = /^orientation:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? '');
    if (!match || match[1] !== ref?.digest || ref?.handle !== `art:sha256:${match[1]}`) throw typed('orientation cursor mismatch', 'invalid_cursor');
    const document = this._loadArtifact(ref);
    const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > document.items.length) throw typed('orientation cursor offset invalid', 'invalid_cursor');
    const payload = bounded(document.items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < document.items.length;
    return Object.freeze({ op: document.op, status: truncated ? 'needs_resume' : 'ok', summary: document.summary, payload, refs: [ref], ...(truncated ? { cursor: `orientation:${match[1]}:${next}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: 'atlas-index:orientation-reuse-r0' }, provenance: { ...document.provenance, artifactDigest: match[1], resumed_from: offset, deterministic: true, mergeAuthority: false, verificationAuthority: false } });
  }

  async reverify(claim, op, args, ctx) {
    if (claim?.op !== op) return { ok: false, reason: 'operation_mismatch' };
    try {
      this._loadArtifact(claim?.refs?.[0], op);
      const rerun = await this.invoke(op, args, ctx);
      return { ok: rerun.refs[0].digest === claim?.refs?.[0]?.digest, observedDigest: rerun.refs[0].digest };
    } catch (error) { return { ok: false, reason: error?.code ?? 'reverify_failed' }; }
  }
}
