import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

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
const artifactType = (op) => op === 'reuse.vet'
  ? { kind: 'dependency-dossier', mediaType: 'application/vnd.baton.dependency-dossier+json' }
  : op === 'provenance.sbom'
    ? { kind: 'lockfile-sbom', mediaType: 'application/vnd.cyclonedx+json' }
  : { kind: 'orientation-reuse', mediaType: 'application/vnd.baton.orientation-reuse+json' };
const exactList = (value, field) => {
  if (!Array.isArray(value) || value.length > 256 || value.some((item) => typeof item !== 'string' || item.length === 0 || Buffer.byteLength(item) > 256 || item.includes('\0'))) throw new TypeError(`${field} must be a bounded string[]`);
  return [...new Set(value)].sort();
};
const lockPackageName = (path, item) => {
  if (typeof item?.name === 'string' && item.name.length > 0) return item.name;
  const marker = 'node_modules/'; const index = path.lastIndexOf(marker);
  return index < 0 ? null : path.slice(index + marker.length);
};
const resolveLockDependency = (packages, from, name) => {
  let cursor = from;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${name}` : `node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    const index = cursor.lastIndexOf('/node_modules/');
    if (index >= 0) cursor = cursor.slice(0, index);
    else if (cursor.startsWith('node_modules/')) cursor = '';
    else return null;
  }
};
const npmPurl = (name, version) => {
  const path = name.startsWith('@') && name.includes('/')
    ? `${encodeURIComponent(name.slice(0, name.indexOf('/')))}/${encodeURIComponent(name.slice(name.indexOf('/') + 1))}`
    : encodeURIComponent(name);
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
};

export class CartographerQuartermaster {
  constructor(opts = {}) {
    if (!opts.atlas || typeof opts.atlas.invoke !== 'function') throw new TypeError('Cartographer/Quartermaster requires AtlasCodeIndex');
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('Cartographer/Quartermaster artifactRoot required');
    this.atlas = opts.atlas; this.now = opts.now ?? Date.now;
    if (typeof opts.atlas.resultRoot !== 'string' || opts.atlas.resultRoot.length === 0) throw new TypeError('Cartographer/Quartermaster requires Atlas resultRoot');
    this.atlasResultRoot = realpathSync(opts.atlas.resultRoot);
    const artifactRoot = resolve(opts.artifactRoot); mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); this.artifactRoot = realpathSync(artifactRoot);
    this.externalOracle = opts.externalOracle ?? null;
    this.vetPolicy = null;
    if (this.externalOracle !== null) {
      if (typeof this.externalOracle?.vet !== 'function' || typeof this.externalOracle?.verifySources !== 'function') throw new TypeError('externalOracle must implement vet() and verifySources()');
      const policy = opts.vetPolicy;
      if (!policy || !Number.isSafeInteger(policy.ttlMs) || policy.ttlMs <= 0
        || (policy.minScorecard !== undefined && (!Number.isFinite(policy.minScorecard) || policy.minScorecard < 0 || policy.minScorecard > 10))
        || (policy.requireProviderVerifiedProvenance !== undefined && typeof policy.requireProviderVerifiedProvenance !== 'boolean')
        || (policy.blockDeprecated !== undefined && typeof policy.blockDeprecated !== 'boolean')) throw new TypeError('external vet requires deployment ttl/license/scorecard/provenance policy');
      const licenseAllow = exactList(policy.licenseAllow ?? [], 'licenseAllow');
      const licenseDeny = exactList(policy.licenseDeny ?? [], 'licenseDeny');
      if (licenseAllow.some((license) => licenseDeny.includes(license))) throw new TypeError('license allow/deny policy overlaps');
      this.vetPolicy = Object.freeze({ ttlMs: policy.ttlMs, licenseAllow, licenseDeny, minScorecard: policy.minScorecard ?? null, requireProviderVerifiedProvenance: policy.requireProviderVerifiedProvenance ?? false, blockDeprecated: policy.blockDeprecated ?? true });
      this.vetPolicyHash = sha(stable(this.vetPolicy));
      this.vetCache = new Map();
    }
    this.sbomPolicy = null;
    if (opts.sbomPolicy !== undefined) {
      const policy = opts.sbomPolicy;
      if (!policy || !Number.isSafeInteger(policy.maxLockfileBytes) || policy.maxLockfileBytes <= 0
        || !Number.isSafeInteger(policy.maxComponents) || policy.maxComponents <= 0) throw new TypeError('SBOM policy requires positive lockfile/component ceilings');
      this.sbomPolicy = Object.freeze({ maxLockfileBytes: policy.maxLockfileBytes, maxComponents: policy.maxComponents });
    }
  }

  card() {
    return {
      name: 'cartographer-quartermaster', version: 1,
      ops: {
        'orientation.slice': { latency_class: 'interactive', deterministic: true, side_effects: ['content_addressed_artifact'], reverifiable: true },
        'reuse.internal': { latency_class: 'interactive', deterministic: true, side_effects: ['content_addressed_artifact'], reverifiable: true },
        ...(this.externalOracle ? { 'reuse.vet': { latency_class: 'bounded_batch', deterministic: false, side_effects: ['external_api', 'content_addressed_artifact'], reverifiable: 'fresh_observation' } } : {}),
        ...(this.sbomPolicy ? { 'provenance.sbom': { latency_class: 'bounded_batch', deterministic: true, side_effects: ['content_addressed_artifact'], reverifiable: true } } : {}),
      },
      underlying: ['atlas-index:code.seed', 'atlas-index:repo.map'],
      limitations: [
        this.externalOracle ? 'External dossier is fail-closed and package-level; import observation is not vulnerable-function reachability' : 'External vet is not deployment-configured',
        this.sbomPolicy ? 'SBOM is exact npm package-lock v3 actual state only' : 'SBOM is not deployment-configured',
        'no auto-install; reuse-decision authority remains Coordinator-owned; no true vulnerability reachability or third-party prose',
      ],
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
    const expectedType = expectedOp === null ? null : artifactType(expectedOp);
    const knownType = [artifactType('orientation.slice'), artifactType('reuse.vet'), artifactType('provenance.sbom')].find((candidate) => candidate.kind === ref?.kind && candidate.mediaType === ref?.mediaType);
    if (!ref || !knownType || (expectedType && (ref.kind !== expectedType.kind || ref.mediaType !== expectedType.mediaType))
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

  _result(document, ctx, started, runtimeProvenance = {}) {
    const artifact = this._write(document); const payload = bounded(document.items, ctx.budgetTokens); const truncated = payload.length < document.items.length;
    const type = artifactType(document.op);
    const sourceRefs = document.op === 'reuse.vet' && Array.isArray(document.items?.[0]?.sources)
      ? document.items[0].sources.map((source) => ({ kind: 'supply-chain-source', handle: source.handle, digest: source.digest, bytes: source.bytes, mediaType: source.mediaType }))
      : [];
    const resumable = !['reuse.vet', 'provenance.sbom'].includes(document.op);
    return Object.freeze({
      op: document.op, status: truncated ? (resumable ? 'needs_resume' : 'partial') : 'ok', summary: document.summary, payload,
      refs: [{ kind: type.kind, handle: `art:sha256:${artifact.digest}`, digest: artifact.digest, bytes: artifact.bytes, path: artifact.path, mediaType: type.mediaType }, ...sourceRefs],
      ...(truncated && resumable ? { cursor: `orientation:${artifact.digest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: Math.max(0, this.now() - started), usd: 0, underlying: document.provenance.underlying ?? 'atlas-index:orientation-reuse-r0' },
      provenance: { ...document.provenance, ...runtimeProvenance, artifactDigest: artifact.digest, deterministic: document.provenance.deterministic ?? true, mergeAuthority: false, verificationAuthority: false },
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
    if (op === 'reuse.vet' && this.externalOracle) {
      const ecosystem = normalizedText(args.ecosystem, 'invalid_package_identity').toLowerCase();
      const packageName = normalizedText(args.package, 'invalid_package_identity');
      const version = normalizedText(args.version, 'invalid_package_identity');
      if (args.refresh !== undefined && typeof args.refresh !== 'boolean') throw typed('refresh must be boolean', 'invalid_package_identity');
      const innerResult = await this.atlas.invoke('repo.map', { indexEpoch: args.indexEpoch }, ctx); this._abort(ctx);
      const { full, ref } = this._inner(innerResult);
      for (const item of full.items) if (!item || typeof item.path !== 'string' || !stringArray(item.imports)) throw typed('Atlas map item schema mismatch', 'orientation_source_integrity');
      const usage = ecosystem === 'npm'
        ? (full.items.some((item) => item.imports.some((entry) => entry === packageName || entry.startsWith(`${packageName}/`))) ? 'import_observed' : 'not_observed')
        : 'unknown';
      const cacheKey = sha(stable({ ecosystem, package: packageName, version, indexEpoch: innerResult.provenance.index_epoch, overlayDigest: innerResult.provenance.overlay_digest ?? null, policyHash: this.vetPolicyHash }));
      const cached = this.vetCache.get(cacheKey);
      if (cached && args.refresh !== true) {
        const expiresAtMs = Date.parse(cached.items[0].expiresAt);
        if (this.now() < expiresAtMs) return this._result(cached, ctx, started, { cache: 'hit' });
        const prior = cached.items[0];
        const recommendation = prior.recommendation === 'block' ? 'block' : 'blocked_pending_vet';
        const policy = { ...prior.policy, unknown: [...new Set([...prior.policy.unknown, 'evidence_expired'])].sort() };
        const facts = { identity: prior.identity, packageFacts: prior.packageFacts, advisories: prior.advisories, advisoryIds: prior.advisoryIds, project: prior.project, sources: prior.sources, usage: prior.usage, policy, recommendation };
        const dossier = { ...facts, factDigest: sha(stable(facts)), asOf: prior.asOf, expiresAt: prior.expiresAt, staleAt: new Date(this.now()).toISOString() };
        const stale = { ...cached, summary: `${prior.identity.package}@${prior.identity.version}: ${recommendation} (evidence expired)`, items: [dossier], provenance: { ...cached.provenance, evidenceStale: true } };
        return this._result(stale, ctx, started, { cache: 'stale' });
      }
      const observation = await this.externalOracle.vet({ ecosystem, package: packageName, version }, ctx); this._abort(ctx);
      if (!observation || observation.schemaVersion !== 1 || !observation.requested || !observation.resolved || !observation.packageFacts
        || !Array.isArray(observation.packageFacts.licenses) || !Array.isArray(observation.advisories) || !Array.isArray(observation.advisoryIds)
        || !Array.isArray(observation.sources) || observation.sources.some((source) => typeof source?.source !== 'string' || !/^[a-f0-9]{64}$/.test(source?.digest ?? '') || source?.handle !== `art:sha256:${source.digest}` || source?.mediaType !== 'application/json' || !Number.isSafeInteger(source?.bytes))) throw typed('external oracle schema mismatch', 'oracle_schema_invalid');
      const licenses = [...new Set(observation.packageFacts.licenses)].sort();
      const license = licenses.some((value) => this.vetPolicy.licenseDeny.includes(value)) ? 'deny'
        : licenses.length > 0 && licenses.every((value) => this.vetPolicy.licenseAllow.includes(value)) ? 'allow' : 'unknown';
      const malicious = observation.advisories.some((advisory) => advisory.malicious === true);
      const score = observation.project?.scorecard?.overallScore;
      const blocked = [];
      if (malicious) blocked.push('known_malicious_package');
      if (observation.advisoryIds.length > 0) blocked.push('known_vulnerability');
      if (license === 'deny') blocked.push('license_denied');
      if (this.vetPolicy.blockDeprecated && observation.packageFacts.deprecated === true) blocked.push('deprecated');
      if (this.vetPolicy.minScorecard !== null && Number.isFinite(score) && score < this.vetPolicy.minScorecard) blocked.push('scorecard_below_policy');
      const unknown = [];
      if (license === 'unknown') unknown.push(licenses.length === 0 ? 'license_unknown' : 'license_not_allowlisted');
      if (this.vetPolicy.minScorecard !== null && !Number.isFinite(score)) unknown.push('scorecard_unknown');
      if (this.vetPolicy.requireProviderVerifiedProvenance && observation.packageFacts.providerVerifiedAttestations < 1) unknown.push('provider_verified_provenance_missing');
      const recommendation = blocked.length > 0 ? 'block' : unknown.length > 0 ? 'blocked_pending_vet' : 'borrow_candidate';
      const asOfMs = this.now(); const asOf = new Date(asOfMs).toISOString(); const expiresAt = new Date(asOfMs + this.vetPolicy.ttlMs).toISOString();
      const facts = { identity: observation.resolved, packageFacts: observation.packageFacts, advisories: observation.advisories, advisoryIds: observation.advisoryIds, project: observation.project, sources: observation.sources, usage: { status: usage, claim: 'repository_import_observation_only' }, policy: { hash: this.vetPolicyHash, license, blocked, unknown }, recommendation };
      const dossier = { ...facts, factDigest: sha(stable(facts)), asOf, expiresAt };
      const document = { schemaVersion: 1, op, query: { ecosystem, package: packageName, version, indexEpoch: args.indexEpoch }, summary: `${observation.resolved.package}@${observation.resolved.version}: ${recommendation}`, items: [dossier],
        provenance: { index_epoch: innerResult.provenance.index_epoch, overlay_digest: innerResult.provenance.overlay_digest ?? null, staleness: innerResult.provenance.staleness, atlasArtifactDigest: ref.digest, externalLookup: true, evidenceAsOf: asOf, evidenceExpiresAt: expiresAt, policyHash: this.vetPolicyHash, cacheIdentity: cacheKey, underlying: 'deps.dev+osv.dev+atlas-import-observation', deterministic: false } };
      this.vetCache.set(cacheKey, document);
      return this._result(document, ctx, started, { cache: 'miss' });
    }
    if (op === 'provenance.sbom' && this.sbomPolicy) {
      if (typeof ctx.worktreeRoot !== 'string' || ctx.worktreeRoot.length === 0) throw typed('SBOM requires trusted worktree root', 'sbom_context_required');
      const requested = normalizedText(args.lockfilePath, 'invalid_sbom_path').replace(/^\.\//, '');
      if (isAbsolute(requested) || requested.split('/').includes('..')) throw typed('SBOM lockfile path escapes worktree', 'invalid_sbom_path');
      let root; let path;
      try { root = realpathSync(ctx.worktreeRoot); path = realpathSync(join(root, requested)); }
      catch { throw typed('SBOM lockfile unavailable', 'sbom_unavailable'); }
      const rel = relative(root, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw typed('SBOM lockfile escaped worktree', 'invalid_sbom_path');
      const raw = readFileSync(path);
      try { if (realpathSync(path) !== path) throw new Error('identity changed'); }
      catch { throw typed('SBOM lockfile identity changed during read', 'sbom_source_changed'); }
      if (raw.length > this.sbomPolicy.maxLockfileBytes) throw typed('SBOM lockfile exceeds deployment ceiling', 'sbom_oversize');
      let lock; try { lock = JSON.parse(raw); } catch { throw typed('SBOM lockfile JSON invalid', 'sbom_schema_invalid'); }
      if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) throw typed('SBOM requires npm package-lock v3 packages map', 'sbom_schema_invalid');
      const entries = Object.entries(lock.packages).filter(([key]) => key !== '').sort(([a], [b]) => a.localeCompare(b));
      if (entries.length > this.sbomPolicy.maxComponents) throw typed('SBOM component count exceeds deployment ceiling', 'sbom_oversize');
      const components = [];
      for (const [key, item] of entries) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw typed('SBOM package entry invalid', 'sbom_schema_invalid');
        const name = lockPackageName(key, item); const version = typeof item.version === 'string' ? item.version : null;
        if (!name || (!version && item.link !== true)) throw typed('SBOM package identity unavailable', 'sbom_schema_invalid');
        const ref = `npm:${key}`;
        components.push({ type: 'library', 'bom-ref': ref, name, version, ...(version ? { purl: npmPurl(name, version) } : {}), properties: [
          { name: 'baton:lockfile_path', value: key }, { name: 'baton:grounding', value: 'actual_lockfile' },
          ...(typeof item.integrity === 'string' ? [{ name: 'baton:integrity', value: item.integrity }] : []),
          ...(item.dev === true ? [{ name: 'baton:dev', value: 'true' }] : []), ...(item.optional === true ? [{ name: 'baton:optional', value: 'true' }] : []),
        ] });
      }
      const componentByPath = new Map(components.map((component) => [component.properties.find((property) => property.name === 'baton:lockfile_path').value, component]));
      const unresolved = []; const dependencies = [];
      const rootEntry = lock.packages[''] ?? {};
      const allEntries = [['', rootEntry], ...entries];
      const rootName = typeof rootEntry.name === 'string' ? rootEntry.name : typeof lock.name === 'string' ? lock.name : 'application';
      const rootVersion = typeof rootEntry.version === 'string' ? rootEntry.version : typeof lock.version === 'string' ? lock.version : '0.0.0';
      const rootRef = `application:${rootName}@${rootVersion}`;
      for (const [key, item] of allEntries) {
        const fromRef = key === '' ? rootRef : componentByPath.get(key)?.['bom-ref']; if (!fromRef) continue;
        const names = [...new Set([...Object.keys(item.dependencies ?? {}), ...Object.keys(item.optionalDependencies ?? {})])].sort();
        const dependsOn = [];
        for (const name of names) {
          const target = resolveLockDependency(lock.packages, key, name);
          const targetRef = target ? componentByPath.get(target)?.['bom-ref'] : null;
          if (targetRef) dependsOn.push(targetRef); else unresolved.push({ from: key === '' ? '' : key, name });
        }
        dependencies.push({ ref: fromRef, dependsOn: [...new Set(dependsOn)].sort() });
      }
      const sbom = { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, metadata: { component: { type: 'application', 'bom-ref': rootRef, name: rootName, version: rootVersion }, properties: [{ name: 'baton:grounding', value: 'actual_lockfile' }, { name: 'baton:source_digest', value: sha(raw) }] }, components, dependencies };
      const item = { grounding: 'actual_lockfile', lockfile: requested, lockfileDigest: sha(raw), componentCount: components.length, unresolvedEdges: unresolved, proposedGraph: null, proposedGraphStatus: 'not_supplied', sbom };
      return this._result({ schemaVersion: 1, op, query: { lockfilePath: requested }, summary: `${components.length} actual npm lockfile components; ${unresolved.length} unresolved edges`, items: [item], provenance: { deterministic: true, lockfileDigest: sha(raw), grounding: 'actual_lockfile', proposedGraphGrounding: 'unavailable', underlying: 'npm-package-lock-v3+cyclonedx-1.6' } }, ctx, started);
    }
    throw typed(`unsupported orientation/reuse op ${op}`, 'unsupported_op');
  }

  async resume(ref, cursor, ctx = {}) {
    if (!Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw typed('positive orientation budget required', 'invalid_budget'); this._abort(ctx);
    const match = /^orientation:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? '');
    if (!match || match[1] !== ref?.digest || ref?.handle !== `art:sha256:${match[1]}`) throw typed('orientation cursor mismatch', 'invalid_cursor');
    const document = this._loadArtifact(ref);
    if (['reuse.vet', 'provenance.sbom'].includes(document.op)) throw typed('artifact is ref-addressed, not cursor-resumable', 'capability_resume_unavailable');
    const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > document.items.length) throw typed('orientation cursor offset invalid', 'invalid_cursor');
    const payload = bounded(document.items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < document.items.length;
    return Object.freeze({ op: document.op, status: truncated ? 'needs_resume' : 'ok', summary: document.summary, payload, refs: [ref], ...(truncated ? { cursor: `orientation:${match[1]}:${next}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: 'atlas-index:orientation-reuse-r0' }, provenance: { ...document.provenance, artifactDigest: match[1], resumed_from: offset, deterministic: true, mergeAuthority: false, verificationAuthority: false } });
  }

  async reverify(claim, op, args, ctx) {
    if (claim?.op !== op) return { ok: false, reason: 'operation_mismatch' };
    try {
      const prior = this._loadArtifact(claim?.refs?.[0], op);
      if (op === 'reuse.vet') {
        if (prior.query?.ecosystem !== args?.ecosystem || prior.query?.package !== args?.package || prior.query?.version !== args?.version
          || prior.query?.indexEpoch !== args?.indexEpoch) return { ok: false, reason: 'query_mismatch' };
        if (prior.provenance?.policyHash !== this.vetPolicyHash || Date.parse(prior.provenance?.evidenceExpiresAt ?? '') <= this.now()) return { ok: false, reason: prior.provenance?.policyHash !== this.vetPolicyHash ? 'policy_mismatch' : 'evidence_expired' };
        const dossier = prior.items[0] ?? {};
        const sources = await this.externalOracle.verifySources(dossier.sources);
        if (!sources?.ok) return { ok: false, reason: sources?.reason ?? 'source_integrity' };
        const currentMap = await this.atlas.invoke('repo.map', { indexEpoch: prior.provenance.index_epoch }, ctx);
        if (currentMap.provenance?.index_epoch !== prior.provenance.index_epoch
          || (currentMap.provenance?.overlay_digest ?? null) !== (prior.provenance?.overlay_digest ?? null)) return { ok: false, reason: 'effective_tree_changed' };
        const { factDigest, asOf, expiresAt, staleAt, ...facts } = dossier; void asOf; void expiresAt; void staleAt;
        const ok = /^[a-f0-9]{64}$/.test(factDigest ?? '') && sha(stable(facts)) === factDigest;
        return {
          ok, observedDigest: claim?.refs?.[0]?.digest ?? null, observedFactDigest: factDigest ?? null,
          ...(ok ? { snapshot: {
            identity: dossier.identity, recommendation: dossier.recommendation,
            policyHash: dossier.policy?.hash ?? null, policy: dossier.policy,
            factDigest, asOf: dossier.asOf, expiresAt: dossier.expiresAt,
            indexEpoch: prior.provenance?.index_epoch ?? null,
            overlayDigest: prior.provenance?.overlay_digest ?? null,
          } } : {}),
        };
      }
      if (op === 'provenance.sbom' && prior.query?.lockfilePath !== args?.lockfilePath?.replace(/^\.\//, '')) return { ok: false, reason: 'query_mismatch' };
      const rerun = await this.invoke(op, args, ctx);
      const ok = rerun.refs[0].digest === claim?.refs?.[0]?.digest;
      const item = prior.items?.[0];
      return {
        ok, observedDigest: rerun.refs[0].digest,
        ...(ok && op === 'provenance.sbom' ? { snapshot: {
          grounding: item?.grounding, lockfile: item?.lockfile, lockfileDigest: item?.lockfileDigest,
          componentCount: item?.componentCount,
        } } : {}),
      };
    } catch (error) { return { ok: false, reason: error?.code ?? 'reverify_failed' }; }
  }
}
