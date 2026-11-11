import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { handleCache } from '../cache_server.mjs';
import { withFineCache, cachedBake } from '../lib/fx/anatomy/fine/fine_cache_client.mjs';

const hasFlock = spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;

test('Fine7 client and cache server interoperate over local HTTP with synthetic arrays', { skip: !hasFlock && 'Linux flock is required by the opt-in route' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fine7-http-cpu-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = http.createServer((req, res) => {
    if (!handleCache(req, res, root, { singleflight: { enabled: true, maxArtifactBytes: 1048576, maxStoreBytes: 8388608, maxLeaseMs: 30000 } })) {
      res.writeHead(404); res.end();
    }
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => nativeFetch(new URL(url, `http://127.0.0.1:${server.address().port}`), options);
  const config = { enabled: true, qualified: true, namespace: 'a'.repeat(64), source_manifest_sha256: 'b'.repeat(64),
    runtime_sha256: 'c'.repeat(64), dependency_sha256: 'd'.repeat(64), endpoint: '/out/.pcache/.singleflight/v1',
    maxInputBytes: 1048576, maxResultBytes: 1048576, maxWaitMs: 10000, pollMs: 5, requestTimeoutMs: 5000, leaseMs: 30000 };
  globalThis.__ACP_FINE_CACHE_CONFIG__ = config;
  let computations = 0;
  const result = () => { computations++; return { W: 2, H: 1, h: new Float32Array([3, 2]), grad: new Float32Array([1, 2, 3, 4]),
    cav: new Float32Array([5, 6]), mask: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), cov: new Uint8Array([9, 10]),
    pos: null, hLo: null, hHi: null, cavHi: null, vHi: null, voHi: null, fHi: null, report: { ms: { bake: 17 }, note: 'synthetic fixture' } }; };
  const capture = () => ({ positions: new Float32Array([1, 2, 3]), options: { res: 2 } });
  const run = token => cachedBake(token, result);
  try {
    const outputs = await Promise.all(Array.from({ length: 6 }, () => withFineCache(capture, run)));
    assert.equal(computations, 1, 'six concurrent callers should produce one result');
    for (const value of outputs) assert.deepEqual(value, outputs[0]);
    outputs[0].h[0] = 100;
    assert.equal(outputs[1].h[0], 3, 'decoded callers should own separate arrays');
    const warm = await withFineCache(capture, run);
    assert.equal(computations, 1);
    assert.equal(warm.h[0], 3);
    await withFineCache(() => ({ ...capture(), extra: 'changed' }), run);
    assert.equal(computations, 2, 'changed inputs should use a separate entry');
    delete globalThis.__ACP_FINE_CACHE_CONFIG__;
    await withFineCache(capture, run);
    assert.equal(computations, 3, 'default-off execution should use the original producer');
  } finally {
    globalThis.fetch = nativeFetch;
    delete globalThis.__ACP_FINE_CACHE_CONFIG__;
  }
});

