// Control-surface contract v2 CS-2 — dead-path resolution (red suite).
// Authority: docs/reference/evidence/control-surface-2026-07-31/control-surface-decisions.md (v2).
// (a) run resume → run.resume_work; (b) five web-admitted verbs through whitelist;
// (c) context eval parse-time typed refusal OR host dispatch (pinned); (d) baton_runs
// advertised or removed from dispatch (pinned); (e) prior verbs still dispatch.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBatonCli, runBatonCli, BatonWebClient,
} from '../src/application-cli.mjs';
import {
  McpFleetServer,
  mcpApplicationToolNames,
  mcpDispatchToolNames,
} from '../src/mcp-northbound.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';

const D = 'a'.repeat(64);

function mockWebClient(calls) {
  return {
    async command(name, args, idempotencyKey) {
      calls.push({ name, args, idempotencyKey });
      return { ok: true, name, args };
    },
  };
}

// ── (a) run resume reaches run.resume_work ──────────────────────────────────

test('CS2-a: parseBatonCli(run resume) reaches run.resume_work and dispatches via mock client', async () => {
  const parsed = parseBatonCli([
    'run', 'resume', 'run-a', '--reason', 'Continue preserved work',
    '--idempotency-key', 'resume-a',
  ]);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'run.resume_work');
  assert.deepEqual(parsed.args, {
    runId: 'run-a', reason: 'Continue preserved work',
  });
  assert.equal(parsed.idempotencyKey, 'resume-a');

  const calls = [];
  const result = await runBatonCli(parsed, mockWebClient(calls));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'run.resume_work');
  assert.equal(result.name, 'run.resume_work');
});

// ── (b) five web-admitted verbs through the CLI web-client whitelist ────────

const WEB_ADMITTED = [
  {
    label: 'run episode',
    argv: ['run', 'episode', 'run-a', 'outline', '--idempotency-key', 'ep-a'],
    name: 'run.episode',
  },
  {
    label: 'run result → run.episode',
    argv: ['run', 'result', 'run-a', '--idempotency-key', 'res-a'],
    name: 'run.episode',
  },
  {
    label: 'run workstreams',
    argv: ['run', 'workstreams', 'run-a', '--idempotency-key', 'ws-a'],
    name: 'run.workstreams',
  },
  {
    label: 'run notify → run.workstream.notify',
    argv: ['run', 'notify', 'run-a', 'work', 'nudge text', '--idempotency-key', 'nt-a'],
    name: 'run.workstream.notify',
  },
  {
    label: 'run stop-member → run.workstream.stop',
    argv: ['run', 'stop-member', 'run-a', 'work', '--idempotency-key', 'sm-a'],
    name: 'run.workstream.stop',
  },
];

for (const row of WEB_ADMITTED) {
  test(`CS2-b: ${row.label} parses and dispatches through the web-client whitelist`, async () => {
    const parsed = parseBatonCli(row.argv);
    assert.equal(parsed.kind, 'command');
    assert.equal(parsed.name, row.name);

    // Real BatonWebClient whitelist admits the name (construction only — no network).
    const client = new BatonWebClient({
      baseUrl: 'https://baton.example.test/',
      origin: 'https://control.example.test/',
      repoId: 'repo-a',
      token: 't'.repeat(32),
      commandTimeoutMs: 30_000,
      pollMs: 250,
      fetchImpl: async () => {
        throw new Error('network must not be reached in CS2-b whitelist pin');
      },
      clock: () => Date.now(),
      sleep: async () => {},
    });
    // Whitelist gate is the first line of command(); a non-whitelist name throws
    // cli_command_unavailable before fetch. We only assert the gate admits.
    let gateError = null;
    try {
      await client.command(row.name, parsed.args, parsed.idempotencyKey);
    } catch (error) {
      gateError = error;
    }
    assert.notEqual(gateError?.code, 'cli_command_unavailable',
      `${row.name} must be on the CLI web-client whitelist`);

    const calls = [];
    await runBatonCli(parsed, mockWebClient(calls));
    assert.equal(calls[0]?.name, row.name);
  });
}

// ── (c) context eval: parse-time typed refusal naming live paths ────────────

test('CS2-c: context eval refuses at parse with a typed code naming embedded/MCP paths', () => {
  // Pin: parse-time refusal (not host-local dispatch). Live paths are
  // embedded BatonRun.context().evaluate / MCP baton_context_eval.
  let error;
  try {
    parseBatonCli([
      'context', 'eval', '--run', 'run-a', '--json', '{"schemaVersion":1}',
    ]);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'context eval must refuse at parse time');
  assert.equal(typeof error.code, 'string');
  assert.match(error.code, /^cli_/u);
  assert.match(String(error.message), /baton_context_eval|context\(\)|evaluate|embedded|MCP/iu);
});

// ── (d) baton_runs advertised on MCP application surface (pinned) ───────────

test('CS2-d: baton_runs is advertised on the MCP application tool table (not a shadow)', () => {
  const advertised = mcpApplicationToolNames();
  const dispatch = mcpDispatchToolNames();
  assert.ok(advertised.includes('baton_runs'),
    'baton_runs must appear in the application-surface tool table');
  assert.ok(dispatch.includes('baton_runs'),
    'baton_runs remains in the dispatch map');
  // Instantiated surface agrees with the exported inventory.
  // Minimal facade that satisfies McpFleetServer application-surface construction.
  const commands = Object.keys(APPLICATION_COMMAND_DEFINITIONS);
  const application = {
    repoId: 'repo-a',
    card: () => ({ repoId: 'repo-a', commands }),
    command: async () => ({}),
    authorizeReplay: async () => true,
  };
  const server = new McpFleetServer({
    coordinator: {
      list: () => [],
      card: () => ({}),
      capability: () => null,
    },
    coordination: {
      admitMcpCall: async () => ({ status: 'admitted' }),
      completeMcpCall: async () => {},
      failMcpCall: async () => {},
      mcpCall: () => null,
      recordMcpAudit: () => {},
    },
    application,
    principal: {
      userId: 'op', sessionId: 's',
      capabilities: ['observe', 'control', 'approve'],
      repoIds: ['repo-a'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revoked: false,
    },
    shutdownPrincipal: {
      actor: 'mcp-host', principalId: 'host', sessionId: 's',
    },
    repoIds: ['repo-a'],
    surface: 'application',
    maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  const toolNames = server.toolDefinitions.map((tool) => tool.name);
  assert.ok(toolNames.includes('baton_runs'),
    'instantiated application surface must advertise baton_runs');
});

// ── (e) regression: previously-dispatching verbs still dispatch ─────────────

test('CS2-e: previously-dispatching verbs still parse and dispatch', async () => {
  const rows = [
    {
      argv: ['run', 'status', 'run-a', '--idempotency-key', 'st-a'],
      name: 'run.status',
    },
    {
      argv: ['run', 'stop', 'run-a', '--reason', 'done', '--idempotency-key', 'sp-a'],
      name: 'run.stop',
    },
    {
      argv: ['run', 'evidence', 'run-a', '--idempotency-key', 'ev-a'],
      name: 'run.evidence',
    },
    {
      argv: ['run', 'approve', 'run-a', '--plan', D, '--idempotency-key', 'ap-a'],
      name: 'run.approve',
    },
    {
      argv: ['runs', 'list', '--idempotency-key', 'ls-a'],
      name: 'runs.list',
    },
  ];
  for (const row of rows) {
    const parsed = parseBatonCli(row.argv);
    assert.equal(parsed.kind, 'command', row.name);
    assert.equal(parsed.name, row.name);
    const calls = [];
    await runBatonCli(parsed, mockWebClient(calls));
    assert.equal(calls[0]?.name, row.name, row.name);
  }
});
