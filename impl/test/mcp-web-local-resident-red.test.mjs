// The `baton-mcp-web` bridge is the ordinary MCP path into a resident Baton host, and
// `baton serve` publishes that host over an owner-only Unix socket (`transport: 'local'`).
// Found by dogfood 2026-07-23: the bridge resolved the local connection through the same
// discovery chain as the CLI but then fetched it with `globalThis.fetch`, so every ordinary
// zero-assembly resident was unreachable over MCP (`cli_transport_failed` at startup) while
// the CLI worked. These tests pin the bridge to the same transport selection the CLI uses.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationStore, MockAdapter, connectBatonWebApplication, createBatonWebMcpServer, openBaton,
} from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

function repository(t) {
  const root = mkdtempSync('/tmp/bt-mcpweb-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'mcpweb@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'MCP Web'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true, scripts: { test: 'node --test' },
  }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('smoke', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'mcp-web resident fixture' },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'mcp-web-local-resident', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

async function publishedResident(t) {
  const repo = repository(t);
  const deploymentRoot = mkdtempSync('/tmp/bt-mcpweb-deployment-');
  const configRoot = mkdtempSync('/tmp/bt-mcpweb-config-');
  const home = mkdtempSync('/tmp/bt-mcpweb-home-');
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const owner = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
  });
  t.after(async () => { try { await owner.close(); } catch {} });
  const hosted = await owner.host();
  assert.equal(hosted.state, 'published');
  assert.equal(hosted.transport, 'local');
  return { repo, env, home };
}

test('MCPWEB-L1: the bridge reaches the ordinary owner-local socket resident through discovery alone', async (t) => {
  const { repo, env, home } = await publishedResident(t);

  const application = await connectBatonWebApplication({ cwd: repo, env, home });
  const card = application.card();
  for (const command of ['application.help', 'run.start', 'run.inspect', 'run.act', 'run.stop']) {
    assert.ok(card.commands.includes(command), `ordinary command ${command} is advertised`);
  }

  const principal = application.principal();
  const help = await application.command('application.help', {}, {
    principalId: principal.userId, sessionId: principal.sessionId,
  }, { transport: 'mcp', requestId: 'req-l1', idempotencyKey: 'mcp.call:req-l1' });
  assert.ok(help && typeof help === 'object', 'application.help round-trips over the socket');
});

test('MCPWEB-L2: createBatonWebMcpServer serves the local resident without a fetch override', async (t) => {
  const { repo, env, home } = await publishedResident(t);
  const callRoot = mkdtempSync('/tmp/bt-mcpweb-calls-');
  t.after(() => rmSync(callRoot, { recursive: true, force: true }));

  const server = await createBatonWebMcpServer({
    coordination: new CoordinationStore(join(callRoot, 'coordination')),
    cwd: repo, env, home,
  });
  assert.ok(server, 'the MCP server is constructed against the discovered local resident');
});

test('MCPWEB-L3: an explicit fetchImpl override still wins over local transport selection', async (t) => {
  const { repo, env, home } = await publishedResident(t);
  let used = 0;
  const failingFetch = async () => { used += 1; throw new Error('override fetch reached'); };
  await assert.rejects(
    connectBatonWebApplication({ cwd: repo, env, home, fetchImpl: failingFetch }),
    () => used > 0,
    'a caller-supplied fetchImpl is used verbatim, never silently replaced',
  );
});
