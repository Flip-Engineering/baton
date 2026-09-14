// #287 U-E1/U-G10 (2026-09-14 audit): the documented descriptor quickstart authenticates.
//
// RED-state facts verified at the pre-fix HEAD (2026-09-14 run):
//   1. The descriptor principal carried no `expiresAt`, so `_authority` refused EVERY tool call
//      `unauthenticated` — `node impl/scripts/mcp-stdio.mjs <descriptor.json>` (the exact
//      command at impl/MCP.md:10) could not serve one call. U-E1.
//   2. The `initialize` greeting did not carry the served repoId, and nothing else MCP-reachable
//      did either — a client had to guess the one value every tool call takes. U-G10.
//
// The fix is honest about lifetime: the descriptor principal is a PROCESS-LIFETIME principal
// (`expiresAt: null` — the process IS the session; validity is the running process, never a
// hardcoded duration). `_authority` accepts that exact marker and still refuses any other
// absent, malformed, revoked, or elapsed expiry.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { createMcpServerFromDescriptor } from '../src/mcp-descriptor.mjs';
import { McpFleetServer } from '../src/index.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';

const REPO = mkdtempSync(join(tmpdir(), 'baton-mcp-descriptor-auth-'));
const DESCRIPTOR_PATH = join(REPO, 'descriptor.json');
const ROUTE = { harness: 'mock', model: 'model-a', effort: 'low' };

function descriptor() {
  return {
    repo: REPO,
    deploymentRoot: join(REPO, '.baton', 'descriptor-auth'),
    routes: [ROUTE],
    surface: 'application',
    principal: { userId: 'operator', capabilities: ['control', 'observe'] },
  };
}

test.after(() => {
  // The coordination stores are plain directories under the temp repo; tmp reclaims them.
});

// ---------------------------------------------------------------------------
// U-E1 — the documented entry point serves a real call, proven over a live
// `node impl/scripts/mcp-stdio.mjs <descriptor.json>` subprocess.
// ---------------------------------------------------------------------------

test('U-E1: a descriptor-launched stdio server authenticates and answers baton_deployment_doctor from real readiness', { timeout: 60_000 }, async (t) => {
  writeFileSync(DESCRIPTOR_PATH, `${JSON.stringify(descriptor(), null, 2)}\n`);
  const child = spawn(process.execPath, [new URL('../scripts/mcp-stdio.mjs', import.meta.url).pathname, DESCRIPTOR_PATH],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
  const frames = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim().length > 0) frames.push(JSON.parse(line));
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const send = (message) => new Promise((resolve, reject) => {
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => (error ? reject(error) : resolve()));
  });
  const waitFor = async (id, what) => {
    for (let waited = 0; !frames.some((frame) => frame.id === id); waited += 100) {
      if (waited > 30_000) throw new Error(`timeout waiting for ${what}; stderr: ${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}; stderr: ${stderr}`);
      await delay(100);
    }
    return frames.find((frame) => frame.id === id);
  };

  await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'descriptor-auth', version: '1' } } });
  const init = await waitFor(1, 'initialize');
  // U-G10: the greeting itself carries the served repoId — no guessing, ever.
  assert.match(init.result.instructions, new RegExp(`Served repoId: ${REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    'the initialize instructions carry the served repoId (U-G10)');
  await send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'baton_deployment_doctor', arguments: { repoId: REPO } } });
  const answer = await waitFor(2, 'doctor call');
  assert.equal(answer.result.isError, false, `the documented quickstart must serve a call (U-E1); got: ${JSON.stringify(answer.result)}`);
  const readiness = answer.result.structuredContent;
  assert.equal(readiness.schemaVersion, 1);
  assert.equal(readiness.repoId, REPO, 'the doctor answers for the served repository coordinate');
  assert.deepEqual(readiness.routes, [{ ...ROUTE, state: 'ready' }],
    'the readiness is the descriptor facade\'s REAL route readiness, never an unauthenticated refusal');
});

// ---------------------------------------------------------------------------
// U-E1 — the process-lifetime marker, unit-pinned at the guard: `expiresAt: null`
// authenticates; every other broken expiry still refuses.
// ---------------------------------------------------------------------------

function serverWithPrincipal(principalOverrides = {}) {
  // Each server gets its OWN deployment root: sharing one coordination directory across
  // servers would turn audit writes into contention refusals (temporarily_unavailable),
  // which is transport noise, not the guard semantics under test.
  const repo = mkdtempSync(join(tmpdir(), 'baton-mcp-descriptor-auth-srv-'));
  const descriptor = {
    repo,
    deploymentRoot: join(repo, '.baton', 'srv'),
    routes: [ROUTE],
    surface: 'application',
    principal: { userId: 'operator', capabilities: ['control', 'observe'] },
    quotas: null,
  };
  const configured = createMcpServerFromDescriptor(descriptor);
  const server = new McpFleetServer({
    ...configured,
    principal: {
      ...configured.principal,
      ...principalOverrides,
    },
  });
  return { server, repo };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const call = (server, id, name, args) => request(server, id, 'tools/call', { name, arguments: args });
const errorCode = (response) => response?.result?.structuredContent?.error?.code ?? null;

test('U-E1: the descriptor principal is process-lifetime (expiresAt null), and the guard still refuses broken expiries', async () => {
  const serving = serverWithPrincipal();
  assert.equal(serving.server.principal.expiresAt, null, 'the descriptor principal carries the explicit process-lifetime marker, never a fabricated duration');
  assert.equal(serving.server.principal.revoked, false);
  await initialized(serving.server);
  const served = await call(serving.server, 2, 'baton_deployment_doctor', { repoId: serving.repo });
  assert.equal(served.result.isError, false, `a process-lifetime principal serves calls: ${JSON.stringify(served.result)}`);

  const expired = serverWithPrincipal({ expiresAt: '2020-01-01T00:00:00.000Z' });
  await initialized(expired.server);
  assert.equal(errorCode(await call(expired.server, 3, 'baton_deployment_doctor', { repoId: expired.repo })), 'unauthenticated',
    'an elapsed expiry still refuses');

  const malformed = serverWithPrincipal({ expiresAt: 'not-a-timestamp' });
  await initialized(malformed.server);
  assert.equal(errorCode(await call(malformed.server, 4, 'baton_deployment_doctor', { repoId: malformed.repo })), 'unauthenticated',
    'a malformed expiry still refuses');

  const absent = serverWithPrincipal({ expiresAt: undefined });
  await initialized(absent.server);
  assert.equal(errorCode(await call(absent.server, 5, 'baton_deployment_doctor', { repoId: absent.repo })), 'unauthenticated',
    'an absent/undefined expiry is not the marker — it still refuses (only explicit null is process-lifetime)');

  const revoked = serverWithPrincipal({ revoked: true });
  await initialized(revoked.server);
  assert.equal(errorCode(await call(revoked.server, 6, 'baton_deployment_doctor', { repoId: revoked.repo })), 'unauthenticated',
    'a revoked principal refuses regardless of lifetime');
});

// ---------------------------------------------------------------------------
test('U-G10: initialize carries the served repoId, and a client can call with exactly that value', async () => {
  writeFileSync(DESCRIPTOR_PATH, `${JSON.stringify(descriptor(), null, 2)}\n`);
  const raw = new McpFleetServer(createMcpServerFromDescriptor(descriptor()));
  const server = wrapProductionMcpServer(raw, { expandNative: true });
  const init = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.match(init.result.instructions, /Served repoId: /, 'the greeting names the served repoId');
  assert.match(init.result.instructions, new RegExp(`${REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — pass this exact value as repoId`));
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const served = await call(server, 2, 'baton_deployment_doctor', { repoId: REPO });
  assert.equal(served.result.isError, false, 'the greeted value is the value the server accepts');
});
