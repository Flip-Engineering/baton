import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const typed = (message, code) => Object.assign(new Error(message), { code });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const SYSTEMS = Object.freeze({ npm: { deps: 'NPM', osv: 'npm' } });
const boundedText = (value, field, max = 512) => {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > max || value.includes('\0')) throw typed(`invalid ${field}`, 'invalid_package_identity');
  return value;
};
const exactNpm = (packageName, version) => {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw typed('npm coordinate must be an exact package and semantic version', 'invalid_package_identity');
  }
};
const strings = (value, max = 512) => Array.isArray(value)
  ? [...new Set(value.filter((item) => typeof item === 'string' && item.length > 0 && Buffer.byteLength(item) <= max))].sort()
  : [];
const safeTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const scanCoordinate = (value) => {
  if (!exactKeys(value, ['ecosystem', 'package', 'version']) || value.ecosystem !== 'npm') throw typed('scan coordinates must be closed exact npm identities', 'invalid_package_identity');
  const packageName = boundedText(value.package, 'package'); const version = boundedText(value.version, 'version'); exactNpm(packageName, version);
  return { ecosystem: 'npm', package: packageName, version };
};
const coordinateKey = (value) => `${value.ecosystem}\0${value.package}\0${value.version}`;
const pagination = (value) => value.next_page_token !== undefined || value.nextPageToken !== undefined;
const rfc3339Utc = (value) => {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const parsed = new Date(0); parsed.setUTCFullYear(year, month - 1, day); parsed.setUTCHours(hour, minute, second, 0);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour && parsed.getUTCMinutes() === minute && parsed.getUTCSeconds() === second;
};
const boundedRead = (path, expectedBytes, ceiling) => {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > ceiling) throw typed('source artifact exceeded deployment ceiling', 'oracle_source_oversize');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== expectedBytes || stat.size > ceiling) throw typed('source artifact integrity failure', 'oracle_source_integrity');
    const raw = Buffer.alloc(expectedBytes); let offset = 0;
    while (offset < raw.length) { const count = readSync(fd, raw, offset, raw.length - offset, offset); if (count === 0) break; offset += count; }
    if (offset !== raw.length || readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw typed('source artifact integrity failure', 'oracle_source_integrity');
    return raw;
  } finally { if (fd !== undefined) closeSync(fd); }
};

export class PublicSupplyChainOracle {
  constructor(opts = {}) {
    const maxScanComponents = opts.maxScanComponents ?? 256;
    const maxBatchSize = opts.maxBatchSize ?? Math.min(100, maxScanComponents);
    const maxScanAdvisories = opts.maxScanAdvisories ?? (opts.maxAdvisories ?? 1_000);
    const maxScanWallMs = opts.maxScanWallMs ?? 30_000;
    const maxTransactionBytes = opts.maxTransactionBytes ?? 262_144;
    if (typeof (opts.fetch ?? globalThis.fetch) !== 'function') throw new TypeError('PublicSupplyChainOracle requires fetch');
    if (!Number.isSafeInteger(opts.timeoutMs ?? 5_000) || (opts.timeoutMs ?? 5_000) <= 0) throw new TypeError('oracle timeoutMs must be positive');
    if (!Number.isSafeInteger(opts.maxResponseBytes ?? 1_048_576) || (opts.maxResponseBytes ?? 1_048_576) <= 0) throw new TypeError('oracle maxResponseBytes must be positive');
    if (!Number.isSafeInteger(opts.maxAdvisories ?? 1_000) || (opts.maxAdvisories ?? 1_000) <= 0) throw new TypeError('oracle maxAdvisories must be positive');
    if (!Number.isSafeInteger(maxScanComponents) || maxScanComponents <= 0) throw new TypeError('oracle maxScanComponents must be positive');
    if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize <= 0 || maxBatchSize > maxScanComponents) throw new TypeError('oracle maxBatchSize must be positive and within maxScanComponents');
    if (!Number.isSafeInteger(maxScanAdvisories) || maxScanAdvisories <= 0) throw new TypeError('oracle maxScanAdvisories must be positive');
    if (!Number.isSafeInteger(maxScanWallMs) || maxScanWallMs <= 0) throw new TypeError('oracle maxScanWallMs must be positive');
    if (!Number.isSafeInteger(maxTransactionBytes) || maxTransactionBytes <= 0) throw new TypeError('oracle maxTransactionBytes must be positive');
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('oracle artifactRoot required');
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 1_048_576;
    this.maxAdvisories = opts.maxAdvisories ?? 1_000;
    this.maxScanComponents = maxScanComponents;
    this.maxBatchSize = maxBatchSize;
    this.maxScanAdvisories = maxScanAdvisories;
    this.maxScanWallMs = maxScanWallMs;
    this.maxTransactionBytes = maxTransactionBytes;
    const scannerId = opts.scannerId ?? 'osv-querybatch-v1';
    if (typeof scannerId !== 'string' || scannerId.length === 0 || Buffer.byteLength(scannerId) > 128 || scannerId.includes('\0')) throw new TypeError('oracle scannerId must be bounded text');
    this.scannerId = scannerId;
    this.now = opts.now ?? Date.now;
    if (typeof this.now !== 'function') throw new TypeError('oracle now must be a function');
    const artifactRoot = resolve(opts.artifactRoot); mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); this.artifactRoot = realpathSync(artifactRoot);
    this.depsDevBase = new URL(opts.depsDevBase ?? 'https://api.deps.dev/v3/');
    this.osvBase = new URL(opts.osvBase ?? 'https://api.osv.dev/v1/');
    this.osvQueryBatchUrl = new URL('https://api.osv.dev/v1/querybatch');
    if (this.depsDevBase.protocol !== 'https:' || this.osvBase.protocol !== 'https:') throw new TypeError('oracle endpoints must use HTTPS');
  }

  card() {
    return Object.freeze({
      schemaVersion: 1,
      oracleId: 'public-supply-chain-oracle',
      scan: Object.freeze({ scannerId: this.scannerId, provider: 'osv.dev', operation: 'QueryBatch', method: 'POST', url: this.osvQueryBatchUrl.href, ecosystem: 'npm', versionSemantics: 'exact_input_provider_fuzzy_match' }),
      ceilings: Object.freeze({ maxScanComponents: this.maxScanComponents, maxBatchSize: this.maxBatchSize, maxScanAdvisories: this.maxScanAdvisories, maxResponseBytes: this.maxResponseBytes, maxTransactionBytes: this.maxTransactionBytes, perResponseTimeoutMs: this.timeoutMs, maxScanWallMs: this.maxScanWallMs }),
      sourceStore: Object.freeze({ kind: 'private-cas-request-response-session-v1', transactionMediaType: 'application/vnd.baton.osv-querybatch-transaction+json', sessionMediaType: 'application/vnd.baton.osv-querybatch-session+json' }),
    });
  }

  async _json(url, init, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort('timeout'), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const response = await this.fetch(url, { ...init, redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
      if (!response || response.ok !== true) throw typed('supply-chain oracle unavailable', 'oracle_unavailable');
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > this.maxResponseBytes) throw typed('supply-chain oracle response exceeded deployment ceiling', 'oracle_response_oversize');
      let raw;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks = []; let total = 0;
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          const chunk = Buffer.from(value); total += chunk.length;
          if (total > this.maxResponseBytes) { await reader.cancel().catch(() => {}); throw typed('supply-chain oracle response exceeded deployment ceiling', 'oracle_response_oversize'); }
          chunks.push(chunk);
        }
        raw = Buffer.concat(chunks, total);
      } else {
        raw = Buffer.from(await response.arrayBuffer());
        if (raw.length > this.maxResponseBytes) throw typed('supply-chain oracle response exceeded deployment ceiling', 'oracle_response_oversize');
      }
      let value; try { value = JSON.parse(raw); } catch { throw typed('supply-chain oracle returned invalid JSON', 'oracle_schema_invalid'); }
      if (!record(value)) throw typed('supply-chain oracle returned invalid schema', 'oracle_schema_invalid');
      const digest = sha(raw); const path = join(this.artifactRoot, `${digest}.json`);
      if (!existsSync(path)) {
        try { writeFileSync(path, raw, { mode: 0o600, flag: 'wx' }); }
        catch (error) { if (error?.code !== 'EEXIST') throw error; }
      }
      const observed = boundedRead(path, raw.length, this.maxResponseBytes);
      if (!observed.equals(raw) || sha(observed) !== digest) throw typed('supply-chain source artifact integrity failure', 'oracle_source_integrity');
      return { value, digest, bytes: raw.length, handle: `art:sha256:${digest}`, mediaType: 'application/json' };
    } catch (error) {
      if (controller.signal.aborted) throw typed('supply-chain oracle timed out or was cancelled', signal?.aborted ? 'cancelled' : 'oracle_timeout');
      if (typeof error?.code === 'string') throw error;
      throw typed('supply-chain oracle unavailable', 'oracle_unavailable');
    } finally {
      clearTimeout(timer); signal?.removeEventListener?.('abort', abort);
    }
  }

  async vet(request, ctx = {}) {
    const ecosystem = boundedText(request?.ecosystem, 'ecosystem', 32).toLowerCase();
    const system = SYSTEMS[ecosystem]; if (!system) throw typed('unsupported package ecosystem', 'unsupported_ecosystem');
    const packageName = boundedText(request?.package, 'package'); const version = boundedText(request?.version, 'version');
    exactNpm(packageName, version);
    const encodedName = encodeURIComponent(packageName); const encodedVersion = encodeURIComponent(version);
    const versionUrl = new URL(`systems/${system.deps}/packages/${encodedName}/versions/${encodedVersion}`, this.depsDevBase);
    const osvUrl = new URL('query', this.osvBase);
    const [deps, osv] = await Promise.all([
      this._json(versionUrl, { method: 'GET' }, ctx.signal),
      this._json(osvUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ package: { name: packageName, ecosystem: system.osv }, version }) }, ctx.signal),
    ]);
    const versionKey = deps.value.versionKey;
    if (!record(versionKey) || versionKey.system !== system.deps || typeof versionKey.name !== 'string' || typeof versionKey.version !== 'string') throw typed('deps.dev version schema mismatch', 'oracle_schema_invalid');
    if (versionKey.name !== packageName || versionKey.version !== version) throw typed('provider returned a different package coordinate', 'oracle_coordinate_mismatch');
    if (osv.value.next_page_token !== undefined) throw typed('OSV result requires unsupported pagination', 'oracle_incomplete');
    const vulnerabilities = Array.isArray(osv.value.vulns) ? osv.value.vulns : [];
    if (vulnerabilities.length > this.maxAdvisories || vulnerabilities.some((item) => !record(item) || typeof item.id !== 'string')) throw typed('OSV advisory schema or ceiling mismatch', 'oracle_schema_invalid');
    const advisoryIds = [...new Set([
      ...((deps.value.advisoryKeys ?? []).map((item) => item?.id).filter((id) => typeof id === 'string')),
      ...vulnerabilities.map((item) => item.id),
    ])].sort();
    if (advisoryIds.length > this.maxAdvisories) throw typed('advisory count exceeded deployment ceiling', 'oracle_response_oversize');
    const sourceProject = (deps.value.relatedProjects ?? []).find((item) => item?.relationType === 'SOURCE_REPO' && typeof item?.projectKey?.id === 'string');
    let project = null; let projectSource = null;
    if (sourceProject) {
      const projectId = boundedText(sourceProject.projectKey.id, 'project', 1_024);
      projectSource = await this._json(new URL(`projects/${encodeURIComponent(projectId)}`, this.depsDevBase), { method: 'GET' }, ctx.signal);
      const scorecard = projectSource.value.scorecard;
      project = {
        id: projectId,
        relationProvenance: typeof sourceProject.relationProvenance === 'string' ? sourceProject.relationProvenance : 'UNKNOWN',
        scorecard: record(scorecard) && Number.isFinite(scorecard.overallScore)
          ? { overallScore: scorecard.overallScore, date: safeTime(scorecard.date), checks: Array.isArray(scorecard.checks) ? scorecard.checks.filter((item) => typeof item?.name === 'string' && Number.isFinite(item?.score)).slice(0, 64).map((item) => ({ name: item.name, score: item.score })).sort((a, b) => a.name.localeCompare(b.name)) : [] }
          : null,
      };
    }
    const attestations = [...(deps.value.attestations ?? []), ...(deps.value.slsaProvenances ?? [])];
    return Object.freeze({
      schemaVersion: 1,
      requested: { ecosystem, package: packageName, version },
      resolved: { ecosystem, system: versionKey.system, package: versionKey.name, version: versionKey.version },
      packageFacts: {
        publishedAt: safeTime(deps.value.publishedAt), deprecated: deps.value.isDeprecated === true,
        licenses: strings(deps.value.licenses, 256),
        providerVerifiedAttestations: attestations.filter((item) => item?.verified === true).length,
      },
      advisories: vulnerabilities.map((item) => ({ id: item.id, modified: safeTime(item.modified), published: safeTime(item.published), withdrawn: safeTime(item.withdrawn), malicious: /^MAL-/i.test(item.id) || item?.database_specific?.malicious === true })).sort((a, b) => a.id.localeCompare(b.id)),
      advisoryIds, project,
      sources: [
        { source: 'deps.dev', operation: 'GetVersion', handle: deps.handle, digest: deps.digest, bytes: deps.bytes, mediaType: deps.mediaType },
        { source: 'osv.dev', operation: 'QueryVersion', handle: osv.handle, digest: osv.digest, bytes: osv.bytes, mediaType: osv.mediaType },
        ...(projectSource ? [{ source: 'deps.dev', operation: 'GetProject', handle: projectSource.handle, digest: projectSource.digest, bytes: projectSource.bytes, mediaType: projectSource.mediaType }] : []),
      ],
    });
  }

  _normalizeScanBatch(value, coordinates) {
    if (pagination(value) || Object.keys(value).some((key) => key !== 'results') || !Array.isArray(value.results) || value.results.length !== coordinates.length) throw typed('OSV querybatch result count or pagination is unsupported', pagination(value) ? 'oracle_incomplete' : 'oracle_schema_invalid');
    let advisoryCount = 0;
    const results = value.results.map((entry, index) => {
      if (!record(entry) || pagination(entry) || Object.keys(entry).some((key) => key !== 'vulns') || (entry.vulns !== undefined && !Array.isArray(entry.vulns))) throw typed('OSV querybatch result schema is invalid', pagination(entry ?? {}) ? 'oracle_incomplete' : 'oracle_schema_invalid');
      const byId = new Map();
      for (const advisory of entry.vulns ?? []) {
        if (!exactKeys(advisory, ['id', 'modified']) || typeof advisory.id !== 'string' || advisory.id.length === 0 || advisory.id.trim() !== advisory.id || Buffer.byteLength(advisory.id) > 512 || /[\0\r\n]/.test(advisory.id)
          || !rfc3339Utc(advisory.modified) || byId.has(advisory.id)) throw typed('OSV querybatch advisory schema is invalid', 'oracle_schema_invalid');
        const normalized = { id: advisory.id, modified: advisory.modified };
        byId.set(normalized.id, normalized);
      }
      const advisories = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)); advisoryCount += advisories.length;
      if (advisoryCount > this.maxScanAdvisories) throw typed('scan advisory count exceeded deployment ceiling', 'oracle_response_oversize');
      return { coordinate: coordinates[index], advisories };
    });
    return { results, advisoryCount };
  }

  _writeScanEnvelope(value, suffix, mediaType, operation) {
    const raw = Buffer.from(`${stable(value)}\n`); const digest = sha(raw); const path = join(this.artifactRoot, `${digest}.${suffix}.json`);
    if (raw.length > this.maxTransactionBytes) throw typed('scan envelope exceeded deployment ceiling', 'oracle_response_oversize');
    if (!existsSync(path)) { try { writeFileSync(path, raw, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error?.code !== 'EEXIST') throw error; } }
    const observed = boundedRead(path, raw.length, this.maxTransactionBytes); if (!observed.equals(raw) || sha(observed) !== digest) throw typed('scan envelope artifact integrity failure', 'oracle_source_integrity');
    return { source: operation === 'ScanSession' ? 'baton' : 'osv.dev', operation, handle: `art:sha256:${digest}`, digest, bytes: raw.length, mediaType };
  }

  _scanTransaction(body, response, scan) {
    const transaction = { schemaVersion: 1, scannerId: this.scannerId, scan, request: { method: 'POST', url: this.osvQueryBatchUrl.href, body: JSON.parse(body), bodyDigest: sha(body) }, response: { handle: response.handle, digest: response.digest, bytes: response.bytes, mediaType: response.mediaType } };
    return this._writeScanEnvelope(transaction, 'scan', 'application/vnd.baton.osv-querybatch-transaction+json', 'QueryBatch');
  }

  async scan(request, ctx = {}) {
    const input = Array.isArray(request) ? request : exactKeys(request, ['coordinates']) ? request.coordinates : null;
    if (!Array.isArray(input) || input.length > this.maxScanComponents) throw typed('scan requires a bounded coordinate list', 'invalid_package_identity');
    const unique = new Map();
    for (const item of input) { const coordinate = scanCoordinate(item); unique.set(coordinateKey(coordinate), coordinate); }
    const coordinates = [...unique.values()].sort((a, b) => coordinateKey(a).localeCompare(coordinateKey(b)));
    const observedMs = this.now(); if (!Number.isFinite(observedMs)) throw typed('scan clock is invalid', 'oracle_clock_invalid');
    const observedAt = new Date(observedMs).toISOString();
    const scanId = randomUUID(); const coordinatesDigest = sha(stable(coordinates)); const batchCount = Math.ceil(coordinates.length / this.maxBatchSize); const scannerCardDigest = sha(stable(this.card()));
    const controller = new AbortController(); let wallExpired = false; const abort = () => controller.abort(ctx.signal?.reason);
    if (ctx.signal?.aborted) abort(); else ctx.signal?.addEventListener?.('abort', abort, { once: true });
    const wallTimer = setTimeout(() => { wallExpired = true; controller.abort('scan wall deadline'); }, this.maxScanWallMs); wallTimer.unref?.();
    try {
      const results = []; const batches = []; const sources = []; let totalAdvisories = 0;
      for (let offset = 0; offset < coordinates.length; offset += this.maxBatchSize) {
        const batchIndex = batches.length;
        const batchCoordinates = coordinates.slice(offset, offset + this.maxBatchSize);
        const body = JSON.stringify({ queries: batchCoordinates.map((coordinate) => ({ package: { ecosystem: 'npm', name: coordinate.package }, version: coordinate.version })) });
        const response = await this._json(this.osvQueryBatchUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, controller.signal);
        const normalized = this._normalizeScanBatch(response.value, batchCoordinates); totalAdvisories += normalized.advisoryCount;
        if (totalAdvisories > this.maxScanAdvisories) throw typed('scan advisory count exceeded deployment ceiling', 'oracle_response_oversize');
        const source = this._scanTransaction(body, response, { scanId, observedAt, coordinatesDigest, scannerCardDigest, batchIndex, batchCount }); results.push(...normalized.results); sources.push(source); batches.push({ offset, count: batchCoordinates.length, sourceDigest: source.digest });
      }
      const sessionValue = { schemaVersion: 1, scannerId: this.scannerId, scanId, observedAt, coordinatesDigest, coordinateCount: coordinates.length, scannerCardDigest, batches, sourceDigests: sources.map((source) => source.digest) };
      const session = this._writeScanEnvelope(sessionValue, 'session', 'application/vnd.baton.osv-querybatch-session+json', 'ScanSession');
      return Object.freeze({ schemaVersion: 1, scannerId: this.scannerId, observedAt, coordinates, results, batches, sources, session });
    } catch (error) {
      if (wallExpired && !ctx.signal?.aborted && error?.code === 'cancelled') throw typed('supply-chain scan exceeded wall deadline', 'oracle_timeout');
      throw error;
    } finally { clearTimeout(wallTimer); ctx.signal?.removeEventListener?.('abort', abort); }
  }

  verifyScan(scan) {
    try {
      if (!exactKeys(scan, ['schemaVersion', 'scannerId', 'observedAt', 'coordinates', 'results', 'batches', 'sources', 'session']) || scan.schemaVersion !== 1 || scan.scannerId !== this.scannerId || !rfc3339Utc(scan.observedAt)
        || !Array.isArray(scan.coordinates) || scan.coordinates.length > this.maxScanComponents || !Array.isArray(scan.results) || !Array.isArray(scan.batches) || !Array.isArray(scan.sources)) return { ok: false, reason: 'scan_schema_invalid' };
      const coordinates = scan.coordinates.map(scanCoordinate); const keys = coordinates.map(coordinateKey);
      if (new Set(keys).size !== keys.length || stable(coordinates) !== stable([...coordinates].sort((a, b) => coordinateKey(a).localeCompare(coordinateKey(b))))) return { ok: false, reason: 'scan_coordinate_order' };
      if (scan.results.length !== coordinates.length || scan.batches.length !== scan.sources.length || scan.batches.length !== Math.ceil(coordinates.length / this.maxBatchSize)) return { ok: false, reason: 'scan_manifest_invalid' };
      const session = scan.session;
      if (!exactKeys(session, ['source', 'operation', 'handle', 'digest', 'bytes', 'mediaType']) || session.source !== 'baton' || session.operation !== 'ScanSession' || !/^[a-f0-9]{64}$/.test(session.digest ?? '') || session.handle !== `art:sha256:${session.digest}` || session.mediaType !== 'application/vnd.baton.osv-querybatch-session+json' || !Number.isSafeInteger(session.bytes) || session.bytes <= 0) return { ok: false, reason: 'scan_session_invalid' };
      if (session.bytes > this.maxTransactionBytes) return { ok: false, reason: 'scan_transaction_oversize' };
      const sessionRaw = boundedRead(join(this.artifactRoot, `${session.digest}.session.json`), session.bytes, this.maxTransactionBytes); if (sha(sessionRaw) !== session.digest) return { ok: false, reason: 'source_digest_mismatch' };
      let sessionValue; try { sessionValue = JSON.parse(sessionRaw); } catch { return { ok: false, reason: 'scan_session_invalid' }; }
      const scanId = sessionValue?.scanId; const coordinatesDigest = sha(stable(coordinates)); const scannerCardDigest = sha(stable(this.card()));
      if (typeof scanId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scanId)) return { ok: false, reason: 'scan_session_invalid' };
      const results = []; const batches = []; const sources = []; let nextOffset = 0; let totalAdvisories = 0;
      for (let index = 0; index < scan.batches.length; index += 1) {
        const batch = scan.batches[index]; const source = scan.sources[index];
        if (!exactKeys(batch, ['offset', 'count', 'sourceDigest']) || batch.offset !== nextOffset || !Number.isSafeInteger(batch.count) || batch.count <= 0 || batch.count > this.maxBatchSize || batch.offset + batch.count > coordinates.length
          || !exactKeys(source, ['source', 'operation', 'handle', 'digest', 'bytes', 'mediaType']) || source.source !== 'osv.dev' || source.operation !== 'QueryBatch' || !/^[a-f0-9]{64}$/.test(source.digest ?? '')
          || source.handle !== `art:sha256:${source.digest}` || source.mediaType !== 'application/vnd.baton.osv-querybatch-transaction+json' || !Number.isSafeInteger(source.bytes) || source.bytes <= 0 || batch.sourceDigest !== source.digest) return { ok: false, reason: 'scan_manifest_invalid' };
        if (source.bytes > this.maxTransactionBytes) return { ok: false, reason: 'scan_transaction_oversize' };
        const raw = boundedRead(join(this.artifactRoot, `${source.digest}.scan.json`), source.bytes, this.maxTransactionBytes);
        if (raw.length !== source.bytes || sha(raw) !== source.digest) return { ok: false, reason: 'source_digest_mismatch' };
        let transaction; try { transaction = JSON.parse(raw); } catch { return { ok: false, reason: 'source_schema_invalid' }; }
        const batchCoordinates = coordinates.slice(batch.offset, batch.offset + batch.count); const body = JSON.stringify({ queries: batchCoordinates.map((coordinate) => ({ package: { ecosystem: 'npm', name: coordinate.package }, version: coordinate.version })) });
        if (!exactKeys(transaction, ['schemaVersion', 'scannerId', 'scan', 'request', 'response']) || transaction.schemaVersion !== 1 || transaction.scannerId !== this.scannerId
          || !exactKeys(transaction.scan, ['scanId', 'observedAt', 'coordinatesDigest', 'scannerCardDigest', 'batchIndex', 'batchCount']) || transaction.scan.scanId !== scanId || transaction.scan.observedAt !== scan.observedAt || transaction.scan.coordinatesDigest !== coordinatesDigest || transaction.scan.scannerCardDigest !== scannerCardDigest || transaction.scan.batchIndex !== index || transaction.scan.batchCount !== scan.batches.length
          || !exactKeys(transaction.request, ['method', 'url', 'body', 'bodyDigest']) || transaction.request.method !== 'POST' || transaction.request.url !== this.osvQueryBatchUrl.href || transaction.request.bodyDigest !== sha(body) || stable(transaction.request.body) !== stable(JSON.parse(body))
          || !exactKeys(transaction.response, ['handle', 'digest', 'bytes', 'mediaType']) || transaction.response.handle !== `art:sha256:${transaction.response.digest}` || transaction.response.mediaType !== 'application/json' || !/^[a-f0-9]{64}$/.test(transaction.response.digest ?? '') || !Number.isSafeInteger(transaction.response.bytes) || transaction.response.bytes <= 0) return { ok: false, reason: 'scan_transaction_invalid' };
        if (transaction.response.bytes > this.maxResponseBytes) return { ok: false, reason: 'scan_response_oversize' };
        const responseRaw = boundedRead(join(this.artifactRoot, `${transaction.response.digest}.json`), transaction.response.bytes, this.maxResponseBytes); if (sha(responseRaw) !== transaction.response.digest) return { ok: false, reason: 'source_digest_mismatch' };
        let value; try { value = JSON.parse(responseRaw); } catch { return { ok: false, reason: 'source_schema_invalid' }; }
        if (!record(value)) return { ok: false, reason: 'source_schema_invalid' };
        const normalized = this._normalizeScanBatch(value, batchCoordinates); totalAdvisories += normalized.advisoryCount;
        if (totalAdvisories > this.maxScanAdvisories) return { ok: false, reason: 'scan_advisory_oversize' };
        results.push(...normalized.results); batches.push({ offset: batch.offset, count: batch.count, sourceDigest: source.digest }); sources.push({ ...source }); nextOffset += batch.count;
      }
      if (nextOffset !== coordinates.length) return { ok: false, reason: 'scan_manifest_invalid' };
      const expectedSession = { schemaVersion: 1, scannerId: this.scannerId, scanId, observedAt: scan.observedAt, coordinatesDigest, coordinateCount: coordinates.length, scannerCardDigest, batches, sourceDigests: sources.map((source) => source.digest) };
      if (stable(sessionValue) !== stable(expectedSession)) return { ok: false, reason: 'scan_session_invalid' };
      const normalized = { schemaVersion: 1, scannerId: this.scannerId, observedAt: scan.observedAt, coordinates, results, batches, sources, session: { ...session } };
      return stable(normalized) === stable(scan) ? { ok: true, normalized } : { ok: false, reason: 'scan_semantic_mismatch' };
    } catch (error) { return { ok: false, reason: error?.code === 'oracle_source_integrity' ? 'source_digest_mismatch' : typeof error?.code === 'string' && error.code.startsWith('oracle_') ? error.code : 'source_unavailable' }; }
  }

  verifySources(sources) {
    if (!Array.isArray(sources) || sources.length < 2 || sources.length > 3) return { ok: false, reason: 'source_set_invalid' };
    try {
      for (const source of sources) {
        if (!/^[a-f0-9]{64}$/.test(source?.digest ?? '') || source?.handle !== `art:sha256:${source.digest}` || source?.mediaType !== 'application/json' || !Number.isSafeInteger(source?.bytes) || source.bytes <= 0 || source.bytes > this.maxResponseBytes) return { ok: false, reason: 'source_ref_invalid' };
        const raw = boundedRead(join(this.artifactRoot, `${source.digest}.json`), source.bytes, this.maxResponseBytes);
        if (raw.length !== source.bytes || sha(raw) !== source.digest) return { ok: false, reason: 'source_digest_mismatch' };
      }
      return { ok: true };
    } catch (error) { return { ok: false, reason: error?.code === 'oracle_source_integrity' ? 'source_digest_mismatch' : 'source_unavailable' }; }
  }
}
