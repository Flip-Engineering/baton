import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AcpJsonRpcProcess } from '../src/acp-json-rpc-process.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-kimi-acp.mjs', import.meta.url));
const make = (extra = {}) => new AcpJsonRpcProcess({ command: process.execPath, args: [fixture, '--serve'], setupTimeoutMs: 1000, maxFrameBytes: 1024, ...extra }).start();

test('ACP core correlates concurrent responses by id', async () => {
  const acp = make({ env: { ...process.env, FAKE_KIMI_MODE: 'out-of-order' } });
  try { assert.deepEqual(await Promise.all([acp.request('slow'), acp.request('fast')]), [{ method: 'slow' }, { method: 'fast' }]); }
  finally { await acp.kill(); }
});

test('ACP core bounds setup requests and fails the process closed', async () => {
  const acp = make();
  try { await assert.rejects(acp.request('hang'), (error) => error.code === 'timeout'); }
  finally { await acp.kill(); }
  assert.equal((await acp.closePromise).confirmed, true);
});

for (const [method, code] of [['malformed', 'acp_protocol_error'], ['oversize', 'wire_frame_oversize']]) {
  test(`ACP core fails closed on ${method} protocol input`, async () => {
    const acp = make();
    try { await assert.rejects(acp.request(method), (error) => error.code === code); }
    finally { await acp.kill(); }
    assert.equal((await acp.closePromise).confirmed, true);
  });
}

test('ACP core dispatches and answers a reverse request callback', async () => {
  const seen = [];
  const acp = make({ onReverseRequest(method, params) { seen.push([method, params]); return { content: 'bounded' }; } });
  try { assert.deepEqual(await acp.request('reverse'), { content: 'bounded' }); assert.deepEqual(seen, [['fs/read_text_file', { path: 'allowed.txt' }]]); }
  finally { await acp.kill(); }
});

test('ACP core settles pending requests on child close', async () => {
  const acp = make();
  await assert.rejects(acp.request('close'), (error) => error instanceof Error);
  assert.equal((await acp.closePromise).code, 7);
  await acp.kill();
});

test('ACP core launches detached and kill confirms process-group reap', async () => {
  const acp = make();
  assert.equal(acp.child.spawnargs[1], fixture);
  const result = await acp.kill();
  assert.equal(result.confirmed, true);
});

test('ACP core bounds outbound frames before writing provider input', async () => {
  const acp = make({ maxFrameBytes: 128 });
  await assert.rejects(acp.request('echo', { text: 'x'.repeat(256) }), (error) => error.code === 'wire_frame_oversize');
  await acp.kill();
});

test('ACP core fails closed when notification handling fails', async () => {
  const acp = make({ onNotification() { throw new Error('notification rejected'); } });
  await assert.rejects(acp.request('notify-then-hang'), /notification rejected/);
  assert.equal((await acp.closePromise).confirmed, true);
});

test('ACP core rejects uncorrelated responses and truncated terminal frames', async () => {
  for (const method of ['uncorrelated', 'truncated']) {
    const acp = make();
    await assert.rejects(acp.request(method), (error) => error.code === 'acp_protocol_error');
    assert.equal((await acp.closePromise).confirmed, true);
  }
});

test('ACP core sanitizes provider frames before resolving or dispatching them', async () => {
  const seen = [];
  const sanitizeFrame = (frame) => JSON.parse(JSON.stringify(frame).replaceAll('bounded', '[REDACTED]'));
  const acp = make({ sanitizeFrame, onReverseRequest(method, params) { seen.push([method, params]); return { content: 'bounded' }; } });
  try {
    assert.deepEqual(await acp.request('reverse'), { content: '[REDACTED]' });
    assert.deepEqual(seen, [['fs/read_text_file', { path: 'allowed.txt' }]]);
  } finally { await acp.kill(); }
});
