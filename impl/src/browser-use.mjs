// browser-use.mjs — issue #85 browser-use capability epic (BU-0, BU-0-2, BU-2-2, BU-2-3,
// BU-2-4 freshness, BU-1). The capability-adapter posture: an ordinary CapabilityRegistry
// entry (card()/invoke()) with honest-empty availability modeled exactly on
// normalizeAtlasDeployment (probe-once at deployment-open, constructor-injected, no per-invoke
// re-probe). v1 engine is fetch+readability-class — no JS execution, no headless browser, no
// form submission. The engine package is the repo's first optionalDependencies entry and is
// loaded only lazily by probeBrowserUseAvailability (never a top-level import here or anywhere
// outside this module). Every fetch is a hub-admitted receipt whose artifact follows the
// atlas-cpg content-addressed shape; the excerpt that enters any context is bounded
// (MAX_ATTENTION_TEXT_BYTES), SECRET_SHAPED_TEXT-redacted, control-character-stripped, and
// framed UNTRUSTED_WEB_CONTENT at exactly the capability-result seam.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_ATTENTION_TEXT_BYTES, UNTRUSTED_WEB_CONTENT_FRAME, sanitizeWebContent } from './messages.mjs';

// The engine is an optionalDependencies entry (impl/package.json); the probe resolves it lazily
// so a host that never uses browser-use never pays its install/supply-chain surface.
const ENGINE_PACKAGE = '@mozilla/readability';

export const WEB_FETCH_MEDIA_TYPE = 'application/vnd.baton.web-fetch+text; charset=utf-8';
export { UNTRUSTED_WEB_CONTENT_FRAME };
const HONEST_EMPTY_SUMMARY = 'browser engine not installed; honest empty browser-use result';
const REFUSED_PREFIX = 'browser-use allowlist';

// ---------------------------------------------------------------------------
// URL normalization (BU-2-2 constructive soft-farm control). Runs at the capability
// boundary BEFORE the registry's idempotency binding and the network call, so
// `?t=1`/`?t=2` (cache-busting) and empty-valued query params collapse into one
// invocation and can never farm a near-identical fetch under fresh keys.
// ---------------------------------------------------------------------------

export function normalizeBrowserUseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const kept = [];
    for (const [key, value] of url.searchParams.entries()) {
      if (key === 't' || value === '') continue; // cache-buster and empty params normalize away
      kept.push([key, value]);
    }
    const search = new URLSearchParams();
    for (const [key, value] of kept) search.append(key, value);
    url.search = search.toString();
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// ---------------------------------------------------------------------------
// SSRF / private-network / DNS-rebinding allowlist (BU-0-2 amendment). The string-shape
// check classifies nothing, so the validator rejects at construction any entry that is an
// IP literal in a loopback/private/link-local/ULA range or a bare localhost/.local host,
// and every fetch runs a single bounded pre-connect resolution check that fails the fetch
// closed if an allowlisted hostname resolves to such an address.
// ---------------------------------------------------------------------------

function isPrivateIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
  const nums = parts.map(Number);
  if (nums.some((value) => value > 255)) return false;
  const [a, b] = nums;
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  return false;
}

function isPrivateIpv6(host) {
  const lower = host.toLowerCase();
  const compact = lower.replace(/^0+:0+:0+:0+:0+:0+:0+/u, '::').replace(/::0+$/u, '::');
  if (compact === '::' || compact === '::1' || lower === '0:0:0:0:0:0:0:1') return true; // unspecified/loopback
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  return false;
}

function isPrivateAddressLiteral(address) {
  if (typeof address !== 'string' || address.length === 0) return false;
  if (address.startsWith('[') && address.endsWith(']')) return isPrivateIpv6(address.slice(1, -1));
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

function assertAllowlistEntry(entry, rejected) {
  if (typeof entry !== 'string' || entry.length === 0) {
    throw new TypeError(`${REFUSED_PREFIX} entries must be non-empty hostnames`);
  }
  const host = entry.startsWith('[') ? entry : entry.toLowerCase();
  if (/^localhost$/iu.test(host) || /\.local$/iu.test(host)) {
    rejected.push(entry);
    return;
  }
  if (isPrivateAddressLiteral(host)) rejected.push(entry);
}

function validateAllowlist(allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    throw new TypeError(`${REFUSED_PREFIX} must be a non-empty string[] (pathScope validation shape)`);
  }
  const rejected = [];
  for (const entry of allowlist) assertAllowlistEntry(entry, rejected);
  if (rejected.length > 0) {
    throw new Error(`${REFUSED_PREFIX} rejects loopback/private/link-local/ULA literals and localhost/.local hosts: ${rejected.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Text hygiene for web-derived content (BU-2-3). Control characters stripped (the
// board-title convention, coordinator.mjs:302), NFKC + SECRET_SHAPED_TEXT redaction +
// byte cap. The frame is a result-side projection — the durable artifact keeps the
// full readability extract.
// ---------------------------------------------------------------------------

function sanitizeWebExtract(text) {
  return sanitizeWebContent(text, MAX_ATTENTION_TEXT_BYTES);
}

// ---------------------------------------------------------------------------
// Content-addressed artifact write (atlas-cpg shape: write-once, owner-only, digest-verified
// on every read; the receipt mints only after the artifact is durably written).
// ---------------------------------------------------------------------------

function writeArtifact(artifactRoot, digest, bytes) {
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  chmodSync(artifactRoot, 0o700);
  const path = join(artifactRoot, `${digest}.txt`);
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  return path;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const engineNameOf = (engine) => (engine && typeof engine.name === 'string' && engine.name.length > 0
  ? engine.name : 'browser-use:fetch+readability');

// ---------------------------------------------------------------------------
// BU-1 — the web-surface QA lane (BU-1-1). Registers with the identical adapter contract
// as BU-2 but availability is hardcoded 'empty' at construction (no engine wired in v1, not
// even the fetch-only one — a fetch-only engine cannot exercise a JS-rendered, authenticated
// surface). invoke() returns the schema-valid honest-empty result for EVERY op.
// ---------------------------------------------------------------------------

export function createBrowserQaCapability(_opts = {}) {
  const card = { name: 'browser-qa', ops: { 'browser-qa.snapshot': { latency_class: 'bounded_batch' } } };
  async function invoke(op, _args, _ctx = {}) {
    return {
      status: 'ok', op,
      summary: 'browser engine not installed; honest empty browser-qa result (Lane E review input)',
      payload: [], refs: [],
      cost: { tokens_out: 0, wall_ms: 0, usd: 0, underlying: 'browser-qa:skeleton' },
      provenance: { engine: 'honest_empty', lane: 'e', reviewOnly: true },
    };
  }
  return { card: () => card, invoke };
}

// ---------------------------------------------------------------------------
// BU-1-2 — the Lane E ledger-entry format. Review input for Lane E's downstream wave,
// never an automatic pass/fail gate on the canonical suite (gate-creep refused).
// ---------------------------------------------------------------------------

export function createLaneELedgerEntry(fields = {}) {
  return {
    lane: 'e',
    capability: fields.capability ?? null,
    receipt: fields.receipt ?? null,
    reviewInput: true,
    gate: false,
    reviewedBy: null,
    disposition: null,
    notes: fields.notes ?? null,
  };
}

// ---------------------------------------------------------------------------
// BU-0 — the deployment-open availability probe. Runs exactly once at deployment-open and
// is constructor-injected; the capability never re-probes per invoke. The probe is a pure
// local check (module resolves) — it never contacts a URL to "verify" the engine.
// ---------------------------------------------------------------------------

export async function probeBrowserUseAvailability() {
  try {
    await import(ENGINE_PACKAGE);
    return { status: 'available', reason: 'engine_installed' };
  } catch {
    return { status: 'empty', reason: 'engine_not_installed' };
  }
}

// ---------------------------------------------------------------------------
// BU-0 / BU-2-2 / BU-2-3 — the browser-use capability factory.
// ---------------------------------------------------------------------------

export function createBrowserUseCapability({
  availability, engine, allowlist, artifactRoot, lookup = null, onFetchReceipt = null,
}) {
  validateAllowlist(allowlist);
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) {
    throw new TypeError('browser-use artifactRoot is required');
  }
  const available = availability?.status === 'available';
  const engineName = engineNameOf(engine);
  const seenDigests = new Map(); // normalizedUrl -> last digest (BU-2-4-1 freshness/supersession)

  const card = {
    name: 'browser-use',
    ops: {
      'browser.fetch': { latency_class: 'bounded_batch' },
      'browser.followLink': { latency_class: 'bounded_batch' },
    },
  };

  function costFor(bytes) {
    return {
      tokens_out: Math.max(1, Math.ceil(bytes / 4)),
      wall_ms: 0,
      usd: 0,
      underlying: engineName,
    };
  }

  function honestEmpty(op) {
    return {
      status: 'ok', op,
      summary: HONEST_EMPTY_SUMMARY,
      payload: [], refs: [],
      cost: { tokens_out: 0, wall_ms: 0, usd: 0, underlying: engineName },
      provenance: { engine: 'honest_empty' },
    };
  }

  async function readArtifact(ref) {
    if (!ref || typeof ref.path !== 'string' || typeof ref.digest !== 'string') {
      throw Object.assign(new Error('web_fetch artifact ref is invalid'), { code: 'browser_artifact_invalid' });
    }
    const bytes = readFileSync(ref.path);
    const digest = sha256(bytes);
    if (digest !== ref.digest) {
      throw Object.assign(new Error('web_fetch artifact digest mismatch'), { code: 'browser_artifact_digest_mismatch' });
    }
    const excerpt = sanitizeWebExtract(bytes.toString('utf8'));
    return { kind: 'web_fetch', digest, excerpt: `${UNTRUSTED_WEB_CONTENT_FRAME}\n${excerpt}`, ref: { ...ref } };
  }

  async function execute(op, args, ctx) {
    if (!available) return honestEmpty(op);
    const rawUrl = typeof args?.url === 'string' ? args.url : null;
    if (!rawUrl || rawUrl.length === 0) {
      throw Object.assign(new Error('browser-use requires a url argument'), { code: 'browser_url_invalid' });
    }
    const url = normalizeBrowserUseUrl(rawUrl);
    let hostname = null;
    try { hostname = new URL(url).hostname; } catch { /* malformed */ }
    if (hostname === null || hostname.length === 0) {
      throw Object.assign(new Error('browser-use url is malformed'), { code: 'browser_url_invalid' });
    }
    if (!allowlist.includes(hostname)) {
      throw Object.assign(new Error(`browser-use refuses off-allowlist host ${hostname}`), { code: 'browser_allowlist_refused' });
    }
    // Single bounded pre-connect resolution check (SSRF / DNS-rebinding). The resolver is
    // injected by the deployment; an allowlisted name resolving private fails the fetch closed
    // and never follows a rebinding.
    if (typeof lookup === 'function') {
      let addresses = [];
      try { addresses = (await lookup(hostname)) ?? []; } catch { addresses = []; }
      if (Array.isArray(addresses) && addresses.some((address) => isPrivateAddressLiteral(address))) {
        throw Object.assign(
          new Error(`browser-use refuses private-network resolution for ${hostname}`),
          { code: 'browser_ssrf_refused' },
        );
      }
    }

    let fetched;
    try {
      fetched = await engine.fetch(url);
    } catch (error) {
      return {
        status: 'error', op,
        summary: `browser.fetch failed: ${String(error?.message ?? error).slice(0, 1200)}`,
        payload: [{ kind: 'web_fetch_error', url, error: String(error?.message ?? error).slice(0, 1200) }],
        refs: [], cost: costFor(0),
        provenance: { engine: engineName, url, error: 'fetch_error' },
      };
    }
    if (!fetched || typeof fetched.status !== 'number') {
      return {
        status: 'error', op,
        summary: 'browser.fetch failed: engine returned no status',
        payload: [{ kind: 'web_fetch_error', url }], refs: [],
        cost: costFor(0), provenance: { engine: engineName, url, error: 'no_status' },
      };
    }
    if (fetched.status < 200 || fetched.status >= 300) {
      return {
        status: 'error', op,
        summary: `browser.fetch failed: HTTP ${fetched.status}`,
        payload: [{ kind: 'web_fetch_error', url, status: fetched.status }], refs: [],
        cost: costFor(0), provenance: { engine: engineName, url, status: fetched.status, error: 'http_status' },
      };
    }
    const extract = typeof fetched.text === 'string' && fetched.text.length > 0
      ? fetched.text
      : (typeof fetched.html === 'string' ? fetched.html : '');
    const bytes = Buffer.from(extract, 'utf8');
    const digest = sha256(bytes);
    const artifactPath = writeArtifact(artifactRoot, digest, bytes);
    const supersedes = seenDigests.get(url) ?? null;
    seenDigests.set(url, digest);
    const excerpt = sanitizeWebExtract(extract);
    const ref = {
      kind: 'web_fetch', handle: `art:sha256:${digest}`, digest,
      bytes: bytes.byteLength, mediaType: WEB_FETCH_MEDIA_TYPE, path: artifactPath,
    };
    const result = {
      status: 'ok', op,
      summary: `browser.fetch: fetched ${url} (${bytes.byteLength} bytes, digest ${digest.slice(0, 12)})`,
      payload: [{
        kind: 'web_fetch', url, status: fetched.status, digest,
        ...(supersedes ? { supersedes } : {}),
        excerpt: `${UNTRUSTED_WEB_CONTENT_FRAME}\n${excerpt}`,
      }],
      refs: [ref],
      cost: costFor(bytes.byteLength),
      provenance: { engine: engineName, url, digest },
    };
    if (typeof onFetchReceipt === 'function') {
      try { onFetchReceipt({ actor: ctx?.actor ?? 'orchestrator', op, url, digest, ref }); }
      catch { /* the TG2 feed is advisory — never fails a completed fetch */ }
    }
    return result;
  }

  return {
    card: () => card,
    async invoke(op, args, ctx = {}) {
      if (op !== 'browser.fetch' && op !== 'browser.followLink') {
        throw Object.assign(new Error(`browser-use operation not advertised: ${op}`), { code: 'capability_op_unavailable' });
      }
      return execute(op, args, ctx);
    },
    readArtifact,
  };
}
