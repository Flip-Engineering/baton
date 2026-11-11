// Optional exact Fine7 result reuse. The original synchronous bake remains the producer.
import { encode, decode, equalBytes, sha256, validateBake } from './fine_codec.mjs';

export const FINE_TOKEN = Symbol('farm-fine-numeric-record-v1');
const digest = /^[a-f0-9]{64}$/;
const basePath = '/out/.pcache/.singleflight/v1';

function configuration() {
  const c = globalThis.__ACP_FINE_CACHE_CONFIG__;
  if (!c || c.enabled !== true || c.qualified !== true) return null;
  for (const key of ['namespace', 'source_manifest_sha256', 'runtime_sha256', 'dependency_sha256']) {
    if (typeof c[key] !== 'string' || !digest.test(c[key])) return null;
  }
  for (const key of ['maxInputBytes', 'maxResultBytes', 'maxWaitMs', 'pollMs', 'requestTimeoutMs', 'leaseMs']) {
    if (!Number.isSafeInteger(c[key]) || c[key] <= 0) return null;
  }
  if (c.leaseMs < c.requestTimeoutMs || c.endpoint !== basePath) return null;
  return { ...c };
}

async function request(c, route, init = {}, binary = false) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), c.requestTimeoutMs);
  try {
    const response = await fetch(c.endpoint + route, {
      ...init, signal: abort.signal, credentials: 'same-origin', cache: 'no-store',
    });
    const declared = Number(response.headers.get('Content-Length'));
    const max = binary ? c.maxResultBytes : 64 * 1024;
    if (!Number.isSafeInteger(declared) || declared < 1 || declared > max) throw new Error('Invalid cache response length');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== declared) throw new Error('Truncated cache response');
    return { ok: response.ok, status: response.status, headers: response.headers,
      value: binary ? bytes : JSON.parse(new TextDecoder().decode(bytes)) };
  } finally { clearTimeout(timer); }
}

function randomToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
}

function note(value) {
  try { console.info('[FARM_FINE_CACHE]', JSON.stringify(value)); } catch { /* diagnostics cannot affect rendering */ }
}

async function release(c, key, token) {
  if (!token) return;
  try {
    await request(c, `/${key}/claim`, { method: 'DELETE', headers: { 'X-Lease-Token': token } });
  } catch { /* a lease expiry is safe; it can only cause a later duplicate bake */ }
}

function snapshot(c, capture) {
  return encode({
    schema: 1,
    namespace: c.namespace,
    source_manifest_sha256: c.source_manifest_sha256,
    runtime_sha256: c.runtime_sha256,
    dependency_sha256: c.dependency_sha256,
    inputs: capture(),
  }, c.maxInputBytes);
}

async function loadRecord(c, key, inputSha, published) {
  const response = await request(c, `/${key}/artifact`, {}, true);
  if (!response.ok) throw new Error('Artifact unavailable: ' + response.status);
  const bytes = response.value;
  const sha = await sha256(bytes);
  if (sha !== response.headers.get('X-Content-SHA256')) throw new Error('Artifact digest mismatch');
  if (published && (published.sha256 !== sha || published.bytes !== bytes.byteLength)) throw new Error('Published artifact changed after ready claim');
  const record = decode(bytes, c.maxResultBytes);
  if (record.schema !== 1 || record.namespace !== c.namespace || record.key !== key || record.input_sha256 !== inputSha) {
    throw new Error('Artifact identity mismatch');
  }
  return validateBake(record.B);
}

async function acquire(c, key, inputSha, before, capture) {
  const started = Date.now(), token = randomToken();
  for (;;) {
    const response = await request(c, `/${key}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ttlMs: c.leaseMs }),
    });
    if (!response.ok) throw new Error('Claim failed: ' + response.status);
    const claim = response.value;
    if (claim.state === 'ready') {
      const B = await loadRecord(c, key, inputSha, claim);
      if (!equalBytes(before, snapshot(c, capture))) throw new Error('Fine7 inputs changed while awaiting artifact');
      return { mode: 'hit', B, c, key, inputSha, before, uses: 0, invalid: false, started };
    }
    if (claim.state === 'owner') {
      if (claim.ownerToken !== token) throw new Error('Claim owner token mismatch');
      if (!equalBytes(before, snapshot(c, capture))) {
        await release(c, key, token);
        throw new Error('Fine7 inputs changed while acquiring claim');
      }
      return { mode: 'owner', token, c, key, inputSha, before, uses: 0, invalid: false, started };
    }
    if (claim.state !== 'pending') throw new Error('Unknown single-flight state');
    const elapsed = Date.now() - started;
    if (elapsed >= c.maxWaitMs) throw new Error('Fine7 producer wait budget exhausted');
    await new Promise(resolve => setTimeout(resolve, Math.min(c.pollMs, c.maxWaitMs - elapsed)));
    if (!equalBytes(before, snapshot(c, capture))) throw new Error('Fine7 inputs changed while waiting');
  }
}

export function cachedBake(token, original) {
  if (!token) return original();
  token.uses++;
  if (token.uses !== 1) { token.invalid = true; return original(); }
  if (token.mode === 'hit') return token.B;
  const started = Date.now();
  const B = original();
  token.bakeMs = Date.now() - started;
  try { token.B = validateBake(B); } catch { token.invalid = true; }
  return B;
}

export async function withFineCache(capture, runSync) {
  const c = configuration();
  if (!c) return runSync(null);
  let before, inputSha, key, token;
  try {
    before = snapshot(c, capture);
    inputSha = await sha256(before);
    key = await sha256(new TextEncoder().encode(`${c.namespace}\n${inputSha}`));
    token = await acquire(c, key, inputSha, before, capture);
  } catch (error) {
    note({ state: 'original', reason: String(error?.message || error) });
    return runSync(null);
  }

  // acquire() awaits network activity, so repeat the complete input snapshot in the
  // continuation that immediately calls the original synchronous Fine7 path.
  try {
    if (!equalBytes(before, snapshot(c, capture))) throw new Error('Fine7 inputs changed before synchronous bake');
  } catch (error) {
    if (token.mode === 'owner') await release(c, key, token.token);
    note({ state: 'original', reason: String(error?.message || error) });
    return runSync(null);
  }

  let output, completed = false;
  try { output = runSync(token); completed = true; return output; }
  finally {
    if (token.mode === 'owner') {
      try {
        if (completed && !token.invalid && token.uses === 1 && token.B) {
          const data = encode({ schema: 1, namespace: c.namespace, key, input_sha256: inputSha, B: token.B }, c.maxResultBytes, false);
          const result = await request(c, `/${key}/artifact`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Lease-Token': token.token,
              'X-Content-SHA256': await sha256(data) },
            body: data,
          });
          if (!result.ok) throw new Error('Artifact publication refused: ' + result.status);
          note({ state: 'published', key, bytes: data.byteLength, producer_bake_ms: token.bakeMs ?? null,
            elapsed_ms: Date.now() - token.started });
        }
      } catch (error) {
        note({ state: 'publication_failed', key, reason: String(error?.message || error) });
      } finally { await release(c, key, token.token); }
    } else note({ state: 'hit', key, elapsed_ms: Date.now() - token.started });
  }
}
