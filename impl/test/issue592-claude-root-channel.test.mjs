import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { applicationCardCommands, BatonApplication } from '../src/application.mjs';
import { WebNorthbound, createLocalAuthenticatedWebServer } from '../src/web-northbound.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
import { attachClaudeRootChannel } from '../src/claude-root-channel.mjs';
import { openRootAttention } from '../src/root-attention-stream.mjs';
import { fixtureSocketRoot } from './fixture-root.mjs';

const origin = 'https://baton.local';
const repoId = 'repo-592-channel';
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-592-channel-'));
  const sockets = fixtureSocketRoot('baton-592-channel-');
  const socketPath = join(sockets, 'resident.sock');
  const store = new CoordinationStore(join(directory, 'coordination'));
  store.claimWriterLease();
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issue = (capabilities) => sessions.issue({ userId: 'operator', authMethod: 'bearer',
    capabilities, repoIds: [repoId], ttlMs: 600_000 }, { actor: 'test' });
  const owner = issue(['observe', 'control', 'approve']);
  const observer = issue(['observe']);
  const runtime = new SwarmRuntime({ store, coordinator: { list: () => [], pausedTurns: () => [] }, authorize: async () => {} });
  const application = { repoId, command: async () => {}, authorizeReplay: async () => {},
    card: () => ({ repoId, commands: applicationCardCommands() }),
    _swarmRuntime: () => runtime, startAttentionDelivery: BatonApplication.prototype.startAttentionDelivery };
  const web = new WebNorthbound({ coordinator: {}, coordination: store, sessions, repoIds: [repoId],
    allowedOrigins: [origin], application });
  const http = createLocalAuthenticatedWebServer(web);
  await new Promise((resolve) => http.listen(socketPath, resolve));
  chmodSync(socketPath, 0o600);
  const attachments = [];
  t.after(async () => {
    for (const attachment of attachments) attachment.close();
    await Promise.all(attachments.map((attachment) => attachment.done.catch(() => {})));
    await web.shutdown({ server: http });
    await runtime.close();
    store.releaseWriterLease();
    rmSync(directory, { recursive: true, force: true });
    rmSync(sockets, { recursive: true, force: true });
  });
  const open = (onAttention, token = owner.token) => {
    const attachment = openRootAttention({ baseUrl: origin, origin, socketPath, token, onAttention });
    attachments.push(attachment);
    return attachment;
  };
  let key = 0;
  const row = (kind, payload) => store.recordSwarm(kind, { swarmId: 's', ...payload }, { actor: 'operator', key: `row-${++key}` });
  row('swarm.created', { purpose: 'root needs an answer' });
  row('swarm.participant_joined', { participantId: 'author' });
  const contribute = () => row('swarm.contribution_recorded', { participantId: 'author', contributionId: 'c',
    body: { subject: 'Native attention', needsFromOthers: [{ to: 'root', ask: 'Choose the native session.' }] } });
  return { store, web, runtime, open, observer, contribute };
}

test('a committed root ask reaches the explicit Claude channel through the resident attachment', async (t) => {
  const f = await fixture(t);
  const mcp = new McpFleetServer({ coordinator: {}, coordination: f.store,
    principal: { userId: 'operator', sessionId: 'mcp-session', capabilities: ['observe'],
      repoIds: [repoId], expiresAt: new Date(Date.now() + 600_000).toISOString() }, repoIds: [repoId] });
  t.after(() => mcp.close());
  const message = deferred();
  mcp.attachNotificationSink((frame) => message.resolve(frame));
  attachClaudeRootChannel(mcp, { open: f.open, onClose: () => {} });
  const greeting = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Claude Code', version: '2.1.282' } } });
  assert.deepEqual(greeting.result.capabilities.experimental, { 'claude/channel': {} });
  assert.equal(f.web._rootAttention, null);
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  f.contribute();
  const frame = await message.promise;
  assert.equal(frame.method, 'notifications/claude/channel');
  assert.match(frame.params.content, /Choose the native session\./);
  assert.deepEqual(frame.params.meta, { recipient: 'root' });
  assert.equal(f.web._rootAttention.principalId, 'operator');
  assert.equal(f.store.swarm('s').contributions.c.answers, undefined);
  await mcp.close();
});

test('an observer cannot enroll as the root; source debt is delivered when the operator attaches', async (t) => {
  const f = await fixture(t);
  const observer = f.open(() => {}, f.observer.token);
  const refused = assert.rejects(observer.done, { code: 'forbidden' });
  await assert.rejects(observer.opened, { code: 'forbidden' });
  await refused;
  f.contribute();
  await f.runtime.attentionDelivery.flush();
  assert.ok(f.store.eventsView().some((event) => event.payload?.kind === 'attention.undelivered'
    && event.payload?.code === 'root_unattached'));
  const delivered = deferred();
  const attached = f.open((input) => delivered.resolve(input));
  await attached.opened;
  const input = await delivered.promise;
  assert.ok(input.obligations.some((row) => row.ask === 'Choose the native session.'));
});
