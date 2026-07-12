import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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
  : op === 'provenance.plan'
    ? { kind: 'proposed-install-plan', mediaType: 'application/vnd.baton.proposed-install-plan+json' }
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
const pathPackageName = (path) => { const marker = 'node_modules/'; const index = path.lastIndexOf(marker); return index < 0 ? null : path.slice(index + marker.length); };
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
const exactNpm = (name, version) => /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version);
const semverRangeAtom = '(?:0|[1-9]\\d*|[xX*])(?:\\.(?:0|[1-9]\\d*|[xX*])){0,2}(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const semverComparator = new RegExp(`^(?:\\^|~|<=|>=|<|>|=)?\\s*${semverRangeAtom}$`);
const semverHyphen = new RegExp(`^${semverRangeAtom}\\s+-\\s+${semverRangeAtom}$`);
const registrySpec = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[:/@\\]/.test(value)
  && value.split('||').every((set) => { const text = set.trim(); return text.length > 0 && (semverHyphen.test(text) || text.replace(/([<>]=?|[~^=])\s+/g, '$1').split(/\s+/).every((token) => semverComparator.test(token))); });
const validSri = (value) => {
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(value ?? ''); if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64'); return bytes.length === ({ sha256: 32, sha384: 48, sha512: 64 })[match[1]] && bytes.toString('base64').replace(/=+$/, '') === match[2].replace(/=+$/, '');
};
const validPackagePath = (value) => typeof value === 'string' && value.startsWith('node_modules/') && !value.includes('\\') && !value.split('/').includes('..')
  && value.slice('node_modules/'.length).split('/node_modules/').every((name) => /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name));
const validDependencyMaps = (item) => ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'].every((field) =>
  item[field] === undefined || (item[field] && typeof item[field] === 'object' && !Array.isArray(item[field])
    && Object.entries(item[field]).every(([name, spec]) => /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && registrySpec(spec))));
const validResolutionMetadata = (item) => validDependencyMaps(item) && ['workspaces', 'overrides', 'resolutions', 'pnpm'].every((field) => !Object.hasOwn(item, field));
const prop = (component, name) => component.properties.find((item) => item.name === name)?.value ?? null;
function npmGraph(raw, policy, grounding, { requireRegistry = false, allowedOrigins = [] } = {}) {
  if (raw.length > policy.maxLockfileBytes) throw typed('lockfile exceeds deployment ceiling', grounding === 'actual_lockfile' ? 'sbom_oversize' : 'proposal_oversize');
  let lock; try { lock = JSON.parse(raw); } catch { throw typed('lockfile JSON invalid', grounding === 'actual_lockfile' ? 'sbom_schema_invalid' : 'proposal_schema_invalid'); }
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) throw typed('npm package-lock v3 packages map required', grounding === 'actual_lockfile' ? 'sbom_schema_invalid' : 'proposal_schema_invalid');
  const entries = Object.entries(lock.packages).filter(([key]) => key !== '').sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > policy.maxComponents) throw typed('component count exceeds deployment ceiling', grounding === 'actual_lockfile' ? 'sbom_oversize' : 'proposal_oversize');
  const components = [];
  for (const [key, item] of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw typed('package entry invalid', grounding === 'actual_lockfile' ? 'sbom_schema_invalid' : 'proposal_schema_invalid');
    const name = lockPackageName(key, item); const version = typeof item.version === 'string' ? item.version : null;
    if (!name || (!version && item.link !== true)) throw typed('package identity unavailable', grounding === 'actual_lockfile' ? 'sbom_schema_invalid' : 'proposal_schema_invalid');
    const resolved = typeof item.resolved === 'string' ? item.resolved : null; const integrity = typeof item.integrity === 'string' ? item.integrity : null;
    if (requireRegistry) {
      const derivedName = pathPackageName(key); const postureValid = ['dev', 'optional', 'peer', 'devOptional'].every((field) => item[field] === undefined || typeof item[field] === 'boolean');
      if (!validPackagePath(key) || derivedName !== name || !exactNpm(name, version) || !validResolutionMetadata(item) || !postureValid || item.link === true || !validSri(integrity) || !resolved) throw typed('proposed registry component lacks exact identity/origin/integrity', 'proposal_policy_violation');
      let origin; try { origin = new URL(resolved).origin; } catch { throw typed('proposed registry origin is invalid', 'proposal_policy_violation'); }
      const resolvedUrl = new URL(resolved); if (resolvedUrl.username || resolvedUrl.password || resolvedUrl.protocol !== 'https:' || !allowedOrigins.includes(origin)) throw typed('proposed registry origin is not allowed', 'proposal_policy_violation');
    }
    components.push({ type: 'library', 'bom-ref': `npm:${key}`, name, version, ...(version ? { purl: npmPurl(name, version) } : {}), properties: [
      { name: 'baton:lockfile_path', value: key }, { name: 'baton:grounding', value: grounding },
      ...(integrity ? [{ name: 'baton:integrity', value: integrity }] : []), ...(resolved ? [{ name: 'baton:resolved', value: resolved }] : []),
      ...(item.dev === true ? [{ name: 'baton:dev', value: 'true' }] : []), ...(item.optional === true ? [{ name: 'baton:optional', value: 'true' }] : []),
      ...(item.peer === true ? [{ name: 'baton:peer', value: 'true' }] : []), ...(item.devOptional === true ? [{ name: 'baton:devOptional', value: 'true' }] : []),
    ] });
  }
  const componentByPath = new Map(components.map((component) => [prop(component, 'baton:lockfile_path'), component]));
  const unresolvedEdges = []; const requestEdges = []; const dependencies = []; const rootEntry = lock.packages[''] ?? {};
  if (requireRegistry && !validResolutionMetadata(rootEntry)) throw typed('proposed root contains unsupported dependency sources', 'proposal_policy_violation');
  const rootName = typeof rootEntry.name === 'string' ? rootEntry.name : typeof lock.name === 'string' ? lock.name : 'application';
  const rootVersion = typeof rootEntry.version === 'string' ? rootEntry.version : typeof lock.version === 'string' ? lock.version : '0.0.0';
  const rootRef = `application:${rootName}@${rootVersion}`;
  for (const [key, item] of [['', rootEntry], ...entries]) {
    const fromRef = key === '' ? rootRef : componentByPath.get(key)?.['bom-ref']; if (!fromRef) continue;
    const dependsOn = [];
    for (const [field, type] of [['dependencies', 'runtime'], ['optionalDependencies', 'optional'], ['devDependencies', 'dev'], ['peerDependencies', 'peer']]) {
      for (const [name, spec] of Object.entries(item[field] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        const target = resolveLockDependency(lock.packages, key, name); const targetRef = target ? componentByPath.get(target)?.['bom-ref'] : null;
        const row = { from: key === '' ? '' : key, name, type, spec };
        if (targetRef) { dependsOn.push(targetRef); requestEdges.push({ ...row, to: target }); } else unresolvedEdges.push(row);
      }
    }
    dependencies.push({ ref: fromRef, dependsOn: [...new Set(dependsOn)].sort() });
  }
  requestEdges.sort((a, b) => stable(a).localeCompare(stable(b))); unresolvedEdges.sort((a, b) => stable(a).localeCompare(stable(b)));
  const edgeCount = requestEdges.length + unresolvedEdges.length;
  if (Number.isSafeInteger(policy.maxEdges) && edgeCount > policy.maxEdges) throw typed('dependency edge count exceeds deployment ceiling', grounding === 'actual_lockfile' ? 'sbom_oversize' : 'proposal_oversize');
  const digest = sha(raw);
  return { lock, root: { name: rootName, version: rootVersion, ref: rootRef, entry: rootEntry }, requestEdges, unresolvedEdges, sbom: { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, metadata: { component: { type: 'application', 'bom-ref': rootRef, name: rootName, version: rootVersion }, properties: [{ name: 'baton:grounding', value: grounding }, { name: 'baton:source_digest', value: digest }] }, components, dependencies } };
}
function graphDelta(actual, proposed) {
  const rows = (graph) => new Map(graph.sbom.components.map((item) => [prop(item, 'baton:lockfile_path'), { name: item.name, version: item.version, integrity: prop(item, 'baton:integrity'), resolved: prop(item, 'baton:resolved'), dev: prop(item, 'baton:dev') === 'true', optional: prop(item, 'baton:optional') === 'true', peer: prop(item, 'baton:peer') === 'true', devOptional: prop(item, 'baton:devOptional') === 'true' }]));
  const a = rows(actual); const p = rows(proposed); const added = []; const removed = []; const changed = [];
  for (const [path, value] of p) if (!a.has(path)) added.push({ path, ...value }); else if (stable(a.get(path)) !== stable(value)) changed.push({ path, before: a.get(path), after: value });
  for (const [path, value] of a) if (!p.has(path)) removed.push({ path, ...value });
  const edges = (graph) => new Map(graph.requestEdges.map((row) => [stable(row), row]));
  const ae = edges(actual); const pe = edges(proposed);
  const unresolved = (graph) => new Map(graph.unresolvedEdges.map((row) => [stable(row), row])); const au = unresolved(actual); const pu = unresolved(proposed);
  const rootRequests = (graph) => Object.fromEntries(['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies'].map((field) => [field, Object.fromEntries(Object.entries(graph.root.entry[field] ?? {}).sort(([a], [b]) => a.localeCompare(b)))]));
  const delta = { rootRequest: { before: rootRequests(actual), after: rootRequests(proposed) }, added, removed, changed, edgesAdded: [...pe].filter(([key]) => !ae.has(key)).map(([, row]) => row), edgesRemoved: [...ae].filter(([key]) => !pe.has(key)).map(([, row]) => row), unresolvedEdgesAdded: [...pu].filter(([key]) => !au.has(key)).map(([, row]) => row), unresolvedEdgesRemoved: [...au].filter(([key]) => !pu.has(key)).map(([, row]) => row) };
  return { ...delta, counts: { componentsAdded: added.length, componentsRemoved: removed.length, componentsChanged: changed.length, edgesAdded: delta.edgesAdded.length, edgesRemoved: delta.edgesRemoved.length, unresolvedAdded: delta.unresolvedEdgesAdded.length, unresolvedRemoved: delta.unresolvedEdgesRemoved.length, rootRequestChanged: stable(delta.rootRequest.before) === stable(delta.rootRequest.after) ? 0 : 1 } };
}
function planProjection(delta, proposed) {
  const rootRequestChanged = stable(delta.rootRequest.before) !== stable(delta.rootRequest.after);
  const rootRequestRemoved = Object.keys(delta.rootRequest.before).some((field) => Object.keys(delta.rootRequest.before[field]).some((name) => !Object.hasOwn(delta.rootRequest.after[field], name)));
  const integrityChanged = delta.changed.some((row) => row.before.integrity !== row.after.integrity);
  const deltaRows = delta.added.length + delta.removed.length + delta.changed.length + delta.edgesAdded.length + delta.edgesRemoved.length + delta.unresolvedEdgesAdded.length + delta.unresolvedEdgesRemoved.length + (rootRequestChanged ? 1 : 0);
  const findings = [...new Set([
    ...(delta.removed.length > 0 || delta.edgesRemoved.length > 0 || delta.unresolvedEdgesRemoved.length > 0 || rootRequestRemoved ? ['unexpected_removal'] : []),
    ...(integrityChanged ? ['integrity_changed'] : []), ...(proposed.unresolvedEdges.length > 0 ? ['unresolved_graph'] : []),
    ...(delta.removed.length === 0 && delta.changed.length === 0 && delta.edgesRemoved.length === 0 && delta.unresolvedEdgesRemoved.length === 0 && !rootRequestRemoved && !integrityChanged && proposed.unresolvedEdges.length === 0 && (delta.added.length > 0 || delta.edgesAdded.length > 0 || rootRequestChanged) ? ['clean_addition'] : []),
    ...(deltaRows === 0 ? ['no_change'] : []),
  ])].sort();
  return { deltaRows, findings };
}

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
    this.proposalResolver = opts.proposalResolver ?? null; this.proposalPolicy = null;
    if (this.proposalResolver !== null) {
      if (!this.sbomPolicy || typeof this.proposalResolver?.resolve !== 'function' || typeof this.proposalResolver?.card !== 'function' || typeof this.proposalResolver?.verifyReceipt !== 'function') throw new TypeError('proposal resolver requires SBOM policy and resolve/card/verifyReceipt methods');
      const card = this.proposalResolver.card(); const policy = opts.proposalPolicy;
      if (!card || typeof card.resolverId !== 'string' || typeof card.toolVersion !== 'string' || card.tool !== 'npm' || card.reconciled !== true
        || !policy || !Array.isArray(policy.allowedRegistryOrigins) || policy.allowedRegistryOrigins.length === 0
        || !Number.isSafeInteger(policy.maxEdges) || policy.maxEdges <= 0 || !Number.isSafeInteger(policy.maxDeltaRows) || policy.maxDeltaRows <= 0) throw new TypeError('proposal resolver identity/policy is invalid');
      const allowedRegistryOrigins = exactList(policy.allowedRegistryOrigins, 'allowedRegistryOrigins').map((value) => { const url = new URL(value); if (url.protocol !== 'https:' || url.origin !== value) throw new TypeError('allowed registry origins must be exact HTTPS origins'); return value; });
      this.proposalPolicy = Object.freeze({ resolverId: card.resolverId, tool: card.tool, toolVersion: card.toolVersion, allowedRegistryOrigins, maxEdges: policy.maxEdges, maxDeltaRows: policy.maxDeltaRows });
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
        ...(this.proposalResolver ? { 'provenance.plan': { latency_class: 'bounded_batch', deterministic: false, side_effects: ['isolated_registry_resolution', 'content_addressed_artifact'], reverifiable: true } } : {}),
      },
      underlying: ['atlas-index:code.seed', 'atlas-index:repo.map'],
      limitations: [
        this.externalOracle ? 'External dossier is fail-closed and package-level; import observation is not vulnerable-function reachability' : 'External vet is not deployment-configured',
        this.sbomPolicy ? 'SBOM is exact npm package-lock v3 actual state only' : 'SBOM is not deployment-configured',
        this.proposalResolver ? 'Proposed graph is hypothetical and grants no install or decision authority' : 'Proposed graph resolver is not deployment-configured',
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

  _writeRaw(bytes) {
    const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes); const digest = sha(raw); const path = join(this.artifactRoot, `${digest}.blob`);
    if (!existsSync(path)) { try { writeFileSync(path, raw, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error?.code !== 'EEXIST') throw error; } }
    const observed = readFileSync(path); if (!observed.equals(raw) || sha(observed) !== digest) throw typed('content-addressed raw path is occupied by different bytes', 'artifact_integrity');
    return { digest, bytes: raw.length, path };
  }

  _rawRef(bytes, kind, mediaType) { const artifact = this._writeRaw(bytes); return { kind, mediaType, handle: `art:sha256:${artifact.digest}`, digest: artifact.digest, bytes: artifact.bytes }; }

  _loadRaw(ref, expectedKind = null, expectedMediaType = null) {
    if (!ref || (expectedKind !== null && ref.kind !== expectedKind) || (expectedMediaType !== null && ref.mediaType !== expectedMediaType)
      || !/^[a-f0-9]{64}$/.test(ref.digest ?? '') || ref.handle !== `art:sha256:${ref.digest}` || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw typed('plan artifact reference invalid', 'artifact_integrity');
    const raw = readFileSync(join(this.artifactRoot, `${ref.digest}.blob`)); if (raw.length !== ref.bytes || sha(raw) !== ref.digest) throw typed('plan artifact digest mismatch', 'artifact_integrity'); return raw;
  }

  _loadArtifact(ref, expectedOp = null) {
    const expectedType = expectedOp === null ? null : artifactType(expectedOp);
    const knownType = [artifactType('orientation.slice'), artifactType('reuse.vet'), artifactType('provenance.sbom'), artifactType('provenance.plan')].find((candidate) => candidate.kind === ref?.kind && candidate.mediaType === ref?.mediaType);
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
    const planRefs = document.op === 'provenance.plan' ? (document.provenance.planRefs ?? []).map((ref) => ({ ...ref, path: join(this.artifactRoot, `${ref.digest}.blob`) })) : [];
    const resumable = !['reuse.vet', 'provenance.sbom', 'provenance.plan'].includes(document.op);
    return Object.freeze({
      op: document.op, status: truncated ? (resumable ? 'needs_resume' : 'partial') : 'ok', summary: document.summary, payload,
      refs: [{ kind: type.kind, handle: `art:sha256:${artifact.digest}`, digest: artifact.digest, bytes: artifact.bytes, path: artifact.path, mediaType: type.mediaType }, ...sourceRefs, ...planRefs],
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
    if (op === 'provenance.plan' && this.proposalResolver) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).sort().join(',') !== 'ecosystem,lockfilePath,package,version') throw typed('proposal request shape is invalid', 'invalid_proposal');
      const ecosystem = normalizedText(args.ecosystem, 'invalid_proposal').toLowerCase(); const packageName = normalizedText(args.package, 'invalid_proposal'); const version = normalizedText(args.version, 'invalid_proposal');
      if (ecosystem !== 'npm' || !exactNpm(packageName, version)) throw typed('proposal requires exact npm coordinate', 'invalid_proposal');
      if (typeof ctx.worktreeRoot !== 'string' || ctx.worktreeRoot.length === 0) throw typed('proposal requires trusted worktree root', 'proposal_context_required');
      const requested = normalizedText(args.lockfilePath, 'invalid_sbom_path').replace(/^\.\//, '');
      if (isAbsolute(requested) || requested.split('/').includes('..')) throw typed('proposal lockfile path escapes worktree', 'invalid_sbom_path');
      let root; let path; try { root = realpathSync(ctx.worktreeRoot); path = realpathSync(join(root, requested)); } catch { throw typed('proposal base lockfile unavailable', 'sbom_unavailable'); }
      const rel = relative(root, path); if (rel.startsWith('..') || isAbsolute(rel)) throw typed('proposal base lockfile escaped worktree', 'invalid_sbom_path');
      const graphPolicy = { ...this.sbomPolicy, maxEdges: this.proposalPolicy.maxEdges };
      let actualRaw; try { actualRaw = readFileSync(path); } catch { throw typed('proposal base lockfile unavailable', 'sbom_unavailable'); }
      const actualDigest = sha(actualRaw); const actual = npmGraph(actualRaw, graphPolicy, 'actual_lockfile');
      if (actual.lock.name !== actual.root.name || actual.lock.version !== actual.root.version) throw typed('actual root identity is internally inconsistent', 'sbom_schema_invalid');
      let manifestPath; let manifestRaw; try { manifestPath = realpathSync(join(dirname(path), 'package.json')); manifestRaw = readFileSync(manifestPath); } catch { throw typed('proposal manifest unavailable', 'sbom_unavailable'); }
      if (relative(root, manifestPath).startsWith('..')) throw typed('proposal manifest escaped worktree', 'invalid_sbom_path');
      if (manifestRaw.length > this.sbomPolicy.maxLockfileBytes) throw typed('proposal manifest exceeds deployment ceiling', 'proposal_oversize');
      let manifest; try { manifest = JSON.parse(manifestRaw); } catch { throw typed('proposal manifest is invalid', 'proposal_schema_invalid'); }
      if (manifest?.name !== actual.root.name || manifest?.version !== actual.root.version) throw typed('proposal manifest identity diverges from lockfile', 'proposal_root_changed');
      if (!validResolutionMetadata(actual.root.entry) || !validResolutionMetadata(manifest)) throw typed('proposal base contains unsupported dependency sources', 'proposal_policy_violation');
      const manifestDigest = sha(manifestRaw);
      const coordinate = { ecosystem, package: packageName, version };
      const resolved = await this.proposalResolver.resolve(Object.freeze({ coordinate, baseLockfile: Buffer.from(actualRaw), baseDigest: actualDigest, manifest: Buffer.from(manifestRaw), manifestDigest }), { signal: ctx.signal }); this._abort(ctx);
      const proposedRaw = Buffer.isBuffer(resolved?.proposedLockfile) ? resolved.proposedLockfile : typeof resolved?.proposedLockfile === 'string' ? Buffer.from(resolved.proposedLockfile) : null;
      if (!proposedRaw) throw typed('proposal resolver output is invalid', 'proposal_schema_invalid');
      const proposedDigest = sha(proposedRaw); const receipt = resolved.receipt;
      let receiptBytes; try { receiptBytes = Buffer.byteLength(stable(receipt)); } catch { throw typed('proposal execution receipt is invalid', 'proposal_receipt_invalid'); }
      if (receiptBytes > this.sbomPolicy.maxLockfileBytes) throw typed('proposal execution receipt exceeds deployment ceiling', 'proposal_oversize');
      const expectedArgv = ['install', `${packageName}@${version}`, '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'];
      if (!receipt || receipt.schemaVersion !== 1
        || receipt.resolverId !== this.proposalPolicy.resolverId || receipt.tool !== 'npm' || receipt.toolVersion !== this.proposalPolicy.toolVersion
        || stable(receipt.argv) !== stable(expectedArgv) || receipt.baseDigest !== actualDigest || receipt.manifestDigest !== manifestDigest || receipt.proposedDigest !== proposedDigest
        || stable(receipt.coordinate) !== stable(coordinate) || receipt.isolatedRoot !== true || receipt.ownedCache !== true || receipt.exitCode !== 0
        || stable(receipt.registryOrigins) !== stable(this.proposalPolicy.allowedRegistryOrigins)
        || typeof receipt.isolation?.invocationId !== 'string' || typeof receipt.isolation?.rootHandle !== 'string' || typeof receipt.isolation?.cacheHandle !== 'string'
        || receipt.cleanup?.processes !== true || receipt.cleanup?.root !== true || receipt.cleanup?.cache !== true || receipt.cleanup?.credentials !== true
        || (await this.proposalResolver.verifyReceipt(receipt, { coordinate, baseDigest: actualDigest, manifestDigest, proposedDigest, argv: expectedArgv, allowedRegistryOrigins: this.proposalPolicy.allowedRegistryOrigins }))?.ok !== true) throw typed('proposal execution receipt is invalid', 'proposal_receipt_invalid');
      let currentRaw; let currentManifest; let currentPath; let currentManifestPath;
      try { currentRaw = readFileSync(path); currentManifest = readFileSync(manifestPath); currentPath = realpathSync(join(root, requested)); currentManifestPath = realpathSync(join(dirname(path), 'package.json')); } catch { throw typed('proposal base changed during resolution', 'sbom_source_changed'); }
      if (!currentRaw.equals(actualRaw) || !currentManifest.equals(manifestRaw) || currentPath !== path || currentManifestPath !== manifestPath) throw typed('proposal base changed during resolution', 'sbom_source_changed');
      const proposed = npmGraph(proposedRaw, graphPolicy, 'proposed_lockfile', { requireRegistry: true, allowedOrigins: this.proposalPolicy.allowedRegistryOrigins });
      if (proposed.lock.name !== proposed.root.name || proposed.lock.version !== proposed.root.version) throw typed('proposal root identity is internally inconsistent', 'proposal_root_changed');
      if (actual.root.name !== proposed.root.name || actual.root.version !== proposed.root.version) throw typed('proposal changed root application identity', 'proposal_root_changed');
      const rootSpec = proposed.root.entry.dependencies?.[packageName] ?? proposed.root.entry.optionalDependencies?.[packageName];
      const targetPath = resolveLockDependency(proposed.lock.packages, '', packageName); const target = targetPath ? proposed.lock.packages[targetPath] : null;
      if (rootSpec !== version || target?.version !== version || lockPackageName(targetPath ?? '', target) !== packageName) throw typed('proposal substituted requested coordinate', 'proposal_coordinate_mismatch');
      const delta = graphDelta(actual, proposed); const { deltaRows, findings } = planProjection(delta, proposed);
      if (deltaRows > this.proposalPolicy.maxDeltaRows) throw typed('proposal delta exceeds deployment ceiling', 'proposal_oversize');
      const proposedLockRef = this._rawRef(proposedRaw, 'proposed-lockfile', 'application/vnd.npm.package-lock+json');
      const proposedSbomRef = this._rawRef(`${stable(proposed.sbom)}\n`, 'proposed-sbom', 'application/vnd.cyclonedx+json');
      const receiptRef = this._rawRef(`${stable(receipt)}\n`, 'proposal-execution-receipt', 'application/vnd.baton.resolver-receipt+json');
      const deltaRef = this._rawRef(`${stable(delta)}\n`, 'install-graph-delta', 'application/vnd.baton.install-graph-delta+json');
      const planRefs = [proposedLockRef, proposedSbomRef, receiptRef, deltaRef];
      const item = { grounding: 'proposed_not_installed', authority: { install: false, decision: false, merge: false, verification: false }, coordinate, actual: { lockfile: requested, digest: actualDigest, manifestDigest, componentCount: actual.sbom.components.length }, proposed: { digest: proposedDigest, componentCount: proposed.sbom.components.length, unresolvedEdges: proposed.unresolvedEdges }, delta, findings, refs: planRefs };
      return this._result({ schemaVersion: 1, op, query: { lockfilePath: requested, ecosystem, package: packageName, version }, summary: `${delta.added.length} added, ${delta.removed.length} removed, ${delta.changed.length} changed proposed components`, items: [item], provenance: { deterministic: false, grounding: 'actual_to_proposed', baseLockfileDigest: actualDigest, baseManifestDigest: manifestDigest, proposedLockfileDigest: proposedDigest, resolverId: receipt.resolverId, tool: receipt.tool, toolVersion: receipt.toolVersion, receiptDigest: receiptRef.digest, proposedSbomDigest: proposedSbomRef.digest, deltaDigest: deltaRef.digest, planRefs, underlying: 'deployment-resolver+npm-package-lock-v3+cyclonedx-1.6' } }, ctx, started);
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
    if (['reuse.vet', 'provenance.sbom', 'provenance.plan'].includes(document.op)) throw typed('artifact is ref-addressed, not cursor-resumable', 'capability_resume_unavailable');
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
      if (op === 'provenance.plan') {
        const query = { lockfilePath: args?.lockfilePath?.replace(/^\.\//, ''), ecosystem: args?.ecosystem, package: args?.package, version: args?.version };
        if (stable(prior.query) !== stable(query) || query.ecosystem !== 'npm' || !exactNpm(query.package, query.version)
          || isAbsolute(query.lockfilePath ?? '') || query.lockfilePath?.split('/').includes('..') || !Array.isArray(prior.provenance?.planRefs) || prior.provenance.planRefs.length !== 4) return { ok: false, reason: 'query_mismatch' };
        const [lockRef, sbomRef, receiptRef, deltaRef] = prior.provenance.planRefs;
        const expectedRefs = [
          ['proposed-lockfile', 'application/vnd.npm.package-lock+json'], ['proposed-sbom', 'application/vnd.cyclonedx+json'],
          ['proposal-execution-receipt', 'application/vnd.baton.resolver-receipt+json'], ['install-graph-delta', 'application/vnd.baton.install-graph-delta+json'],
        ];
        if (expectedRefs.some(([kind, mediaType], index) => prior.provenance.planRefs[index]?.kind !== kind || prior.provenance.planRefs[index]?.mediaType !== mediaType)) return { ok: false, reason: 'artifact_integrity' };
        const refIdentity = (ref) => ({ kind: ref?.kind, mediaType: ref?.mediaType, handle: ref?.handle, digest: ref?.digest, bytes: ref?.bytes });
        if (stable((claim?.refs ?? []).slice(1).map(refIdentity)) !== stable(prior.provenance.planRefs.map(refIdentity))) return { ok: false, reason: 'artifact_integrity' };
        const graphPolicy = { ...this.sbomPolicy, maxEdges: this.proposalPolicy.maxEdges };
        const maxExpandedBytes = this.sbomPolicy.maxLockfileBytes * 8;
        if (lockRef.bytes > this.sbomPolicy.maxLockfileBytes || receiptRef.bytes > this.sbomPolicy.maxLockfileBytes || sbomRef.bytes > maxExpandedBytes || deltaRef.bytes > maxExpandedBytes) return { ok: false, reason: 'proposal_oversize' };
        const proposedRaw = this._loadRaw(lockRef, ...expectedRefs[0]); const proposed = npmGraph(proposedRaw, graphPolicy, 'proposed_lockfile', { requireRegistry: true, allowedOrigins: this.proposalPolicy.allowedRegistryOrigins });
        const sbomRaw = this._loadRaw(sbomRef, ...expectedRefs[1]); const receiptRaw = this._loadRaw(receiptRef, ...expectedRefs[2]); const deltaRaw = this._loadRaw(deltaRef, ...expectedRefs[3]);
        if (!sbomRaw.equals(Buffer.from(`${stable(proposed.sbom)}\n`))) return { ok: false, reason: 'proposed_sbom_diverged' };
        let receipt; let storedDelta; try { receipt = JSON.parse(receiptRaw); storedDelta = JSON.parse(deltaRaw); } catch { return { ok: false, reason: 'artifact_integrity' }; }
        let root; let actualPath; let manifestPath;
        try { root = realpathSync(ctx.worktreeRoot); actualPath = realpathSync(join(root, query.lockfilePath)); manifestPath = realpathSync(join(dirname(actualPath), 'package.json')); } catch { return { ok: false, reason: 'sbom_unavailable' }; }
        if (relative(root, actualPath).startsWith('..') || isAbsolute(relative(root, actualPath)) || relative(root, manifestPath).startsWith('..') || isAbsolute(relative(root, manifestPath))) return { ok: false, reason: 'invalid_sbom_path' };
        let actualRaw; let currentManifest; let rereadActualPath; let rereadManifestPath;
        try { actualRaw = readFileSync(actualPath); currentManifest = readFileSync(manifestPath); rereadActualPath = realpathSync(join(root, query.lockfilePath)); rereadManifestPath = realpathSync(join(dirname(actualPath), 'package.json')); } catch { return { ok: false, reason: 'sbom_source_changed' }; }
        if (rereadActualPath !== actualPath || rereadManifestPath !== manifestPath) return { ok: false, reason: 'sbom_source_changed' };
        const actualDigest = sha(actualRaw); const actual = npmGraph(actualRaw, graphPolicy, 'actual_lockfile');
        if (actualDigest !== prior.provenance.baseLockfileDigest || sha(currentManifest) !== prior.provenance.baseManifestDigest || receipt.baseDigest !== actualDigest
          || receipt.proposedDigest !== sha(proposedRaw) || prior.provenance.proposedLockfileDigest !== sha(proposedRaw) || prior.provenance.proposedSbomDigest !== sha(sbomRaw)
          || receipt.resolverId !== this.proposalPolicy.resolverId || receipt.toolVersion !== this.proposalPolicy.toolVersion
          || receipt.argv?.includes('--ignore-scripts') !== true || receipt.argv?.includes('--package-lock-only') !== true || receipt.argv?.includes('--save-exact') !== true
          || receipt.isolatedRoot !== true || receipt.ownedCache !== true || receipt.exitCode !== 0
          || receipt.cleanup?.processes !== true || receipt.cleanup?.root !== true || receipt.cleanup?.cache !== true || receipt.cleanup?.credentials !== true
          || receipt.manifestDigest !== prior.provenance.baseManifestDigest
          || (await this.proposalResolver.verifyReceipt(receipt, { coordinate: { ecosystem: query.ecosystem, package: query.package, version: query.version }, baseDigest: actualDigest, manifestDigest: prior.provenance.baseManifestDigest, proposedDigest: sha(proposedRaw), argv: ['install', `${query.package}@${query.version}`, '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], allowedRegistryOrigins: this.proposalPolicy.allowedRegistryOrigins }))?.ok !== true) return { ok: false, reason: 'proposal_receipt_invalid' };
        if (actual.lock.name !== actual.root.name || actual.lock.version !== actual.root.version || proposed.lock.name !== proposed.root.name || proposed.lock.version !== proposed.root.version
          || actual.root.name !== proposed.root.name || actual.root.version !== proposed.root.version) return { ok: false, reason: 'proposal_root_changed' };
        const rootSpec = proposed.root.entry.dependencies?.[query.package] ?? proposed.root.entry.optionalDependencies?.[query.package];
        const targetPath = resolveLockDependency(proposed.lock.packages, '', query.package); const target = targetPath ? proposed.lock.packages[targetPath] : null;
        if (rootSpec !== query.version || target?.version !== query.version || lockPackageName(targetPath ?? '', target) !== query.package) return { ok: false, reason: 'proposal_coordinate_mismatch' };
        const expectedDelta = graphDelta(actual, proposed);
        const { deltaRows, findings } = planProjection(expectedDelta, proposed); if (deltaRows > this.proposalPolicy.maxDeltaRows) return { ok: false, reason: 'proposal_oversize' };
        if (stable(expectedDelta) !== stable(storedDelta) || sha(deltaRaw) !== prior.provenance.deltaDigest || sha(receiptRaw) !== prior.provenance.receiptDigest) return { ok: false, reason: 'proposal_delta_diverged' };
        const expectedItem = { grounding: 'proposed_not_installed', authority: { install: false, decision: false, merge: false, verification: false }, coordinate: { ecosystem: query.ecosystem, package: query.package, version: query.version }, actual: { lockfile: query.lockfilePath, digest: actualDigest, manifestDigest: prior.provenance.baseManifestDigest, componentCount: actual.sbom.components.length }, proposed: { digest: sha(proposedRaw), componentCount: proposed.sbom.components.length, unresolvedEdges: proposed.unresolvedEdges }, delta: expectedDelta, findings, refs: prior.provenance.planRefs };
        const expectedSummary = `${expectedDelta.added.length} added, ${expectedDelta.removed.length} removed, ${expectedDelta.changed.length} changed proposed components`;
        const expectedProvenance = { deterministic: false, grounding: 'actual_to_proposed', baseLockfileDigest: actualDigest, baseManifestDigest: prior.provenance.baseManifestDigest, proposedLockfileDigest: sha(proposedRaw), resolverId: receipt.resolverId, tool: receipt.tool, toolVersion: receipt.toolVersion, receiptDigest: receiptRef.digest, proposedSbomDigest: sbomRef.digest, deltaDigest: deltaRef.digest, planRefs: prior.provenance.planRefs, underlying: 'deployment-resolver+npm-package-lock-v3+cyclonedx-1.6' };
        if (Object.keys(prior).sort().join(',') !== 'items,op,provenance,query,schemaVersion,summary'
          || prior.items.length !== 1 || stable(prior.items[0]) !== stable(expectedItem) || prior.summary !== expectedSummary
          || stable(prior.provenance) !== stable(expectedProvenance)) return { ok: false, reason: 'proposal_plan_diverged' };
        return { ok: true, observedDigest: claim?.refs?.[0]?.digest ?? null, snapshot: { grounding: 'proposed_not_installed', baseLockfileDigest: actualDigest, proposedLockfileDigest: sha(proposedRaw), deltaDigest: deltaRef.digest, installAuthority: false } };
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
