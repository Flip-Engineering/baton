import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

export class PublicSupplyChainOracle {
  constructor(opts = {}) {
    if (typeof (opts.fetch ?? globalThis.fetch) !== 'function') throw new TypeError('PublicSupplyChainOracle requires fetch');
    if (!Number.isSafeInteger(opts.timeoutMs ?? 5_000) || (opts.timeoutMs ?? 5_000) <= 0) throw new TypeError('oracle timeoutMs must be positive');
    if (!Number.isSafeInteger(opts.maxResponseBytes ?? 1_048_576) || (opts.maxResponseBytes ?? 1_048_576) <= 0) throw new TypeError('oracle maxResponseBytes must be positive');
    if (!Number.isSafeInteger(opts.maxAdvisories ?? 1_000) || (opts.maxAdvisories ?? 1_000) <= 0) throw new TypeError('oracle maxAdvisories must be positive');
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('oracle artifactRoot required');
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 1_048_576;
    this.maxAdvisories = opts.maxAdvisories ?? 1_000;
    const artifactRoot = resolve(opts.artifactRoot); mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); this.artifactRoot = realpathSync(artifactRoot);
    this.depsDevBase = new URL(opts.depsDevBase ?? 'https://api.deps.dev/v3/');
    this.osvBase = new URL(opts.osvBase ?? 'https://api.osv.dev/v1/');
    if (this.depsDevBase.protocol !== 'https:' || this.osvBase.protocol !== 'https:') throw new TypeError('oracle endpoints must use HTTPS');
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
      const observed = readFileSync(path);
      if (!observed.equals(raw) || sha(observed) !== digest) throw typed('supply-chain source artifact integrity failure', 'oracle_source_integrity');
      return { value, digest, bytes: raw.length, handle: `art:sha256:${digest}`, mediaType: 'application/json' };
    } catch (error) {
      if (error?.code) throw error;
      if (controller.signal.aborted) throw typed('supply-chain oracle timed out or was cancelled', signal?.aborted ? 'cancelled' : 'oracle_timeout');
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

  verifySources(sources) {
    if (!Array.isArray(sources) || sources.length < 2 || sources.length > 3) return { ok: false, reason: 'source_set_invalid' };
    try {
      for (const source of sources) {
        if (!/^[a-f0-9]{64}$/.test(source?.digest ?? '') || source?.handle !== `art:sha256:${source.digest}` || source?.mediaType !== 'application/json' || !Number.isSafeInteger(source?.bytes)) return { ok: false, reason: 'source_ref_invalid' };
        const raw = readFileSync(join(this.artifactRoot, `${source.digest}.json`));
        if (raw.length !== source.bytes || sha(raw) !== source.digest) return { ok: false, reason: 'source_digest_mismatch' };
      }
      return { ok: true };
    } catch { return { ok: false, reason: 'source_unavailable' }; }
  }
}
