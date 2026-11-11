import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { handleCache } from '../cache_server.mjs';

const hasFlock = spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;
const test = (name, fn) => nodeTest(name, { skip: !hasFlock && 'Linux flock is required by the opt-in route' }, fn);
const ROUTE = key => `/out/.pcache/.singleflight/v1/${key}`;
const TOKEN = () => crypto.randomBytes(32).toString('hex');
const SERVER_MODULE = new URL('../cache_server.mjs', import.meta.url).href;

function startIndependentServer(root) {
  const script = `
    import http from 'node:http';
    import { handleCache } from ${JSON.stringify(SERVER_MODULE)};
    const server = http.createServer((req,res)=>{ if(!handleCache(req,res,process.env.TEST_ROOT,{singleflight:{enabled:true,maxArtifactBytes:1048576,maxStoreBytes:4194304,maxLeaseMs:60000}})){res.writeHead(404);res.end();} });
    server.listen(0,'127.0.0.1',()=>process.stdout.write(server.address().port+'\\n'));
    process.stdin.resume(); process.stdin.once('end',()=>{ server.close(()=>process.exit(0)); server.closeAllConnections(); });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TEST_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', errors = '', settled = false;
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const port = Number(output.split('\n')[0]);
      if (!settled && Number.isSafeInteger(port) && port > 0) { settled = true; resolve({ child, port }); }
    });
    child.stderr.on('data', chunk => { errors += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => { if (!settled) reject(new Error(errors || `server exit ${code}`)); });
  });
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mot4-singleflight-'));
  fs.mkdirSync(path.join(root, 'out', '.pcache'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = http.createServer((req, res) => {
    if (!handleCache(req, res, root, options)) { res.writeHead(404); res.end(); }
  });
  const listening = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const invoke = async (method, url, body = Buffer.alloc(0), headers = {}) => {
    await listening;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers, body: body.length ? body : undefined });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
  };
  return { root, invoke };
}

const json = value => Buffer.from(JSON.stringify(value));
const parse = response => JSON.parse(response.body.toString());

test('singleflight endpoints are hidden when disabled', async t => {
  const { invoke } = fixture(t);
  const result = await invoke('POST', `${ROUTE('a'.repeat(64))}/claim`, json({ token: TOKEN(), ttlMs: 1000 }));
  assert.equal(result.status, 404);
});

test('singleflight refuses enablement without explicit artifact and store budgets', async t => {
  const { invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 4096, maxLeaseMs: 1000 } });
  const result = await invoke('POST', `${ROUTE('a'.repeat(64))}/claim`, json({ token: TOKEN(), ttlMs: 1000 }));
  assert.equal(result.status, 503);
  assert.equal(parse(result).error, 'singleflight_not_configured');
});

test('parallel claims elect one owner across independent Node HTTP servers', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mot4-singleflight-processes-'));
  fs.mkdirSync(path.join(root, 'out', '.pcache'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32).toString('hex');
  const children = Array.from({ length: 8 }, () => startIndependentServer(root));
  const servers = await Promise.all(children);
  try {
    const results = await Promise.all(servers.map(({ port }) => fetch(`http://127.0.0.1:${port}${ROUTE(key)}/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN(), ttlMs: 30000 }),
    }).then(async r => ({ status: r.status, ...(await r.json()) }))));
    assert.equal(results.filter(x => x.state === 'owner').length, 1);
    assert.equal(results.filter(x => x.state === 'pending').length, 7);
  } finally {
    for (const { child } of servers) child.stdin.end();
    await Promise.all(servers.map(({ child }) => new Promise(resolve => child.once('close', resolve))));
  }
});

test('expired owner from another server cannot release or overwrite the new owner', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mot4-singleflight-expiry-'));
  fs.mkdirSync(path.join(root, 'out', '.pcache'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const servers = await Promise.all([startIndependentServer(root), startIndependentServer(root)]);
  try {
    const [oldServer, newServer] = servers, key = crypto.randomBytes(32).toString('hex');
    const url = `${ROUTE(key)}`;
    const staleToken = TOKEN(), currentToken = TOKEN();
    let response = await fetch(`http://127.0.0.1:${oldServer.port}${url}/claim`, { method: 'POST', body: JSON.stringify({ token: staleToken, ttlMs: 100 }) });
    assert.equal((await response.json()).state, 'owner');
    await new Promise(resolve => setTimeout(resolve, 180));
    response = await fetch(`http://127.0.0.1:${newServer.port}${url}/claim`, { method: 'POST', body: JSON.stringify({ token: currentToken, ttlMs: 5000 }) });
    assert.equal((await response.json()).state, 'owner');
    response = await fetch(`http://127.0.0.1:${oldServer.port}${url}/claim`, { method: 'DELETE', headers: { 'x-lease-token': staleToken } });
    assert.equal(response.status, 409);
    const bytes = Buffer.from('MOT4-after-expiry'), sha = crypto.createHash('sha256').update(bytes).digest('hex');
    response = await fetch(`http://127.0.0.1:${oldServer.port}${url}/artifact`, { method: 'PUT', headers: { 'x-lease-token': staleToken, 'x-content-sha256': sha }, body: bytes });
    assert.equal(response.status, 409);
    response = await fetch(`http://127.0.0.1:${newServer.port}${url}/artifact`, { method: 'PUT', headers: { 'x-lease-token': currentToken, 'x-content-sha256': sha }, body: bytes });
    assert.equal(response.status, 201);
    response = await fetch(`http://127.0.0.1:${newServer.port}${url}/artifact`);
    assert.equal(response.headers.get('x-content-sha256'), sha);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    for (const { child } of servers) child.stdin.end();
    await Promise.all(servers.map(({ child }) => new Promise(resolve => child.once('close', resolve))));
  }
});

test('lease renewal, expiry, stale-token rejection, publish and exact-byte read', async t => {
  let now = 10_000;
  const { invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 1024, maxStoreBytes: 4096, maxLeaseMs: 5000, now: () => now } });
  const key = crypto.randomBytes(32).toString('hex'), owner = TOKEN(), second = TOKEN(), bytes = Buffer.from([0, 77, 79, 84, 52, 255, 1]);
  const claim = await invoke('POST', `${ROUTE(key)}/claim`, json({ token: owner, ttlMs: 1000 }));
  assert.equal(parse(claim).state, 'owner');
  now += 500;
  assert.equal(parse(await invoke('POST', `${ROUTE(key)}/renew`, json({ token: owner, ttlMs: 2000 }))).state, 'owner');
  now += 2001;
  assert.equal(parse(await invoke('POST', `${ROUTE(key)}/claim`, json({ token: second, ttlMs: 1000 }))).state, 'owner');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const stalePut = await invoke('PUT', `${ROUTE(key)}/artifact`, bytes, { 'x-lease-token': owner, 'x-content-sha256': sha });
  assert.equal(stalePut.status, 409);
  const put = await invoke('PUT', `${ROUTE(key)}/artifact`, bytes, { 'x-lease-token': second, 'x-content-sha256': sha });
  assert.equal(put.status, 201); assert.equal(parse(put).sha256, sha);
  const get = await invoke('GET', `${ROUTE(key)}/artifact`);
  assert.equal(get.status, 200); assert.equal(get.headers['x-content-sha256'], sha); assert.deepEqual(get.body, bytes);
  assert.equal(parse(await invoke('POST', `${ROUTE(key)}/claim`, json({ token: TOKEN(), ttlMs: 1000 }))).state, 'ready');
});

test('artifact budgets and digest failures do not publish bytes', async t => {
  const { invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 4, maxStoreBytes: 256, maxLeaseMs: 1000 } });
  const key = crypto.randomBytes(32).toString('hex'), token = TOKEN();
  assert.equal(parse(await invoke('POST', `${ROUTE(key)}/claim`, json({ token, ttlMs: 1000 }))).state, 'owner');
  const tooLarge = await invoke('PUT', `${ROUTE(key)}/artifact`, Buffer.alloc(5), { 'x-lease-token': token, 'x-content-sha256': '0'.repeat(64) });
  assert.equal(tooLarge.status, 413);
  const bytes = Buffer.from('data');
  const badDigest = await invoke('PUT', `${ROUTE(key)}/artifact`, bytes, { 'x-lease-token': token, 'x-content-sha256': '0'.repeat(64) });
  assert.equal(badDigest.status, 400);
  assert.equal((await invoke('GET', `${ROUTE(key)}/artifact`)).status, 404);
});

test('store-wide budget includes committed metadata and rejects later keys', async t => {
  const { invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 128, maxStoreBytes: 220, maxLeaseMs: 1000 } });
  const firstKey = crypto.randomBytes(32).toString('hex'), firstToken = TOKEN();
  await invoke('POST', `${ROUTE(firstKey)}/claim`, json({ token: firstToken, ttlMs: 1000 }));
  const firstBytes = Buffer.from('payload-one'), firstSha = crypto.createHash('sha256').update(firstBytes).digest('hex');
  assert.equal((await invoke('PUT', `${ROUTE(firstKey)}/artifact`, firstBytes, { 'x-lease-token': firstToken, 'x-content-sha256': firstSha })).status, 201);

  const secondKey = crypto.randomBytes(32).toString('hex'), secondToken = TOKEN();
  await invoke('POST', `${ROUTE(secondKey)}/claim`, json({ token: secondToken, ttlMs: 1000 }));
  const secondBytes = Buffer.alloc(128, 7), secondSha = crypto.createHash('sha256').update(secondBytes).digest('hex');
  const rejected = await invoke('PUT', `${ROUTE(secondKey)}/artifact`, secondBytes, { 'x-lease-token': secondToken, 'x-content-sha256': secondSha });
  assert.equal(rejected.status, 507);
  assert.equal((await invoke('GET', `${ROUTE(secondKey)}/artifact`)).status, 404);
});

test('store-wide budget counts orphan upload files left by a crashed publisher', async t => {
  const { root, invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 128, maxStoreBytes: 180, maxLeaseMs: 1000 } });
  const key = crypto.randomBytes(32).toString('hex'), token = TOKEN();
  await invoke('POST', `${ROUTE(key)}/claim`, json({ token, ttlMs: 1000 }));
  const keyDir = path.join(root, 'out', '.pcache', '.singleflight', 'v1', key);
  fs.writeFileSync(path.join(keyDir, 'upload.orphaned-by-crash.tmp'), Buffer.alloc(100));
  const bytes = Buffer.from('next-payload'), sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const response = await invoke('PUT', `${ROUTE(key)}/artifact`, bytes, { 'x-lease-token': token, 'x-content-sha256': sha });
  assert.equal(response.status, 507);
  assert.equal((await invoke('GET', `${ROUTE(key)}/artifact`)).status, 404);
});

test('stale upload paused before publication cannot overwrite a newer lease owner across server processes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mot4-singleflight-stale-put-'));
  fs.mkdirSync(path.join(root, 'out', '.pcache'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const servers = await Promise.all([startIndependentServer(root), startIndependentServer(root)]);
  const [oldServer, newServer] = servers;
  const request = (port, method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); if (body) req.end(body); else req.end();
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const retryOwnerPut = async (url, bytes, token, sha, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs; let backpressure = 0;
    while (Date.now() < deadline) {
      const response = await request(newServer.port, 'PUT', `${url}/artifact`, bytes,
        { 'content-length': bytes.length, 'x-lease-token': token, 'x-content-sha256': sha });
      if (response.status !== 503) return { response, backpressure };
      assert.equal(JSON.parse(response.body).error, 'singleflight_store_busy');
      backpressure++;
      const retryAfter = Number(response.headers['retry-after']);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, deadline - Date.now()) : 25);
    }
    throw new Error(`new owner's PUT remained backpressured after ${timeoutMs}ms`);
  };
  try {
    const key = crypto.randomBytes(32).toString('hex'), url = ROUTE(key), oldToken = TOKEN(), newToken = TOKEN();
    let response = await request(oldServer.port, 'POST', `${url}/claim`, json({ token: oldToken, ttlMs: 60000 }), { 'content-type': 'application/json' });
    assert.equal(JSON.parse(response.body).state, 'owner');

    const staleBytes = Buffer.from('stale-content'), staleSha = crypto.createHash('sha256').update(staleBytes).digest('hex');
    let finishStaleUpload;
    const pendingPut = new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: oldServer.port, method: 'PUT', path: `${url}/artifact`,
        headers: { 'content-length': staleBytes.length, 'x-lease-token': oldToken, 'x-content-sha256': staleSha } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      finishStaleUpload = () => req.end(staleBytes.subarray(3));
      req.write(staleBytes.subarray(0, 3));
    });

    // Probe with independently owned keys until the stale upload has acquired the
    // store-wide lock. A 503 is the server's explicit lock-contention signal.
    let sawStoreBackpressure = false;
    const probeDeadline = Date.now() + 3000;
    while (!sawStoreBackpressure && Date.now() < probeDeadline) {
      const probeKey = crypto.randomBytes(32).toString('hex'), probeToken = TOKEN(), probeUrl = ROUTE(probeKey);
      response = await request(newServer.port, 'POST', `${probeUrl}/claim`, json({ token: probeToken, ttlMs: 5000 }), { 'content-type': 'application/json' });
      assert.equal(JSON.parse(response.body).state, 'owner');
      const bytes = Buffer.from('lock-probe'), sha = crypto.createHash('sha256').update(bytes).digest('hex');
      response = await request(newServer.port, 'PUT', `${probeUrl}/artifact`, bytes,
        { 'content-length': bytes.length, 'x-lease-token': probeToken, 'x-content-sha256': sha });
      if (response.status === 503) {
        assert.equal(JSON.parse(response.body).error, 'singleflight_store_busy');
        sawStoreBackpressure = true;
      } else {
        assert.ok(response.status === 200 || response.status === 201, `unexpected lock probe status ${response.status}`);
      }
    }
    assert.ok(sawStoreBackpressure, 'stale upload must hold the shared publication lock before the lease changes');

    // Release the old claim through its owner token while the upload is paused.
    // The server waits until its owner lock is actually closed before replying.
    response = await request(oldServer.port, 'DELETE', `${url}/claim`, null, { 'x-lease-token': oldToken });
    assert.equal(response.status, 200);
    response = await request(newServer.port, 'POST', `${url}/claim`, json({ token: newToken, ttlMs: 5000 }), { 'content-type': 'application/json' });
    assert.equal(JSON.parse(response.body).state, 'owner');

    // The new owner is valid while the stale body still holds the store lock. The
    // documented 503 response is transient backpressure, so retain and retry the
    // identical upload after the stale request finishes.
    const newBytes = Buffer.from('new-content'), newSha = crypto.createHash('sha256').update(newBytes).digest('hex');
    response = await request(newServer.port, 'PUT', `${url}/artifact`, newBytes,
      { 'content-length': newBytes.length, 'x-lease-token': newToken, 'x-content-sha256': newSha });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).error, 'singleflight_store_busy');

    finishStaleUpload();
    const staleResult = await pendingPut;
    assert.equal(staleResult.status, 409);
    assert.equal((await request(newServer.port, 'GET', `${url}/artifact`)).status, 404);

    const { response: newResult, backpressure } = await retryOwnerPut(url, newBytes, newToken, newSha);
    assert.ok(newResult.status === 201 || newResult.status === 200, `new owner's PUT failed: ${newResult.status} ${newResult.body}`);
    response = await request(newServer.port, 'GET', `${url}/artifact`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, newBytes);
    assert.ok(backpressure >= 0);
  } finally {
    for (const { child } of servers) child.stdin.end();
    await Promise.all(servers.map(({ child }) => new Promise(resolve => child.once('close', resolve))));
  }
});

test('corrupt artifacts fail closed and allow a new owner to republish', async t => {
  const { root, invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 1024, maxStoreBytes: 4096, maxLeaseMs: 5000 } });
  const key = crypto.randomBytes(32).toString('hex'), token1 = TOKEN(), token2 = TOKEN(), bytes = Buffer.from('MOT4-track');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  await invoke('POST', `${ROUTE(key)}/claim`, json({ token: token1, ttlMs: 5000 }));
  const firstPut = await invoke('PUT', `${ROUTE(key)}/artifact`, bytes, { 'x-lease-token': token1, 'x-content-sha256': sha });
  assert.equal(firstPut.status, 201, firstPut.body.toString());
  const blob = path.join(root, 'out', '.pcache', '.singleflight', 'v1', key, 'blobs', `${sha}.bin`);
  fs.writeFileSync(blob, Buffer.from('corrupt'));
  assert.equal((await invoke('GET', `${ROUTE(key)}/artifact`)).status, 500);
  assert.equal((await invoke('DELETE', `${ROUTE(key)}/claim`, Buffer.alloc(0), { 'x-lease-token': token1 })).status, 200);
  assert.equal(parse(await invoke('POST', `${ROUTE(key)}/claim`, json({ token: token2, ttlMs: 5000 }))).state, 'owner');
  const repaired = await invoke('PUT', `${ROUTE(key)}/artifact`, bytes, { 'x-lease-token': token2, 'x-content-sha256': sha });
  assert.equal(repaired.status, 201);
  assert.deepEqual((await invoke('GET', `${ROUTE(key)}/artifact`)).body, bytes);
});

test('release is token-owned and expired owners cannot renew', async t => {
  let now = 50;
  const { invoke } = fixture(t, { singleflight: { enabled: true, maxArtifactBytes: 64, maxStoreBytes: 256, maxLeaseMs: 100, now: () => now } });
  const key = crypto.randomBytes(32).toString('hex'), owner = TOKEN();
  await invoke('POST', `${ROUTE(key)}/claim`, json({ token: owner, ttlMs: 10 }));
  now += 11;
  assert.equal((await invoke('POST', `${ROUTE(key)}/renew`, json({ token: owner, ttlMs: 10 }))).status, 409);
  assert.equal((await invoke('DELETE', `${ROUTE(key)}/claim`, Buffer.alloc(0), { 'x-lease-token': TOKEN() })).status, 409);
});
