import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #230 red pin — omp runtime isolation. Measured 2026-08-15 (live resident dogfood): the omp
// member spawned with a live `omp --mode rpc` process and a started turn, then sat with ZERO
// established sockets for 25+ minutes — no provider call ever fired. Cause: runtimeIdentity
// maps every non-codex/grok/kimi harness to surface 'claude', so the omp member got
// HOME=<isolated home>, CLAUDE_CONFIG_DIR=<config/claude>, and NO omp credential projection.
// omp's provider auth (deepseek api-key, oauth tokens) lives in ~/.omp/agent/agent.db —
// invisible to the isolated HOME — so omp parked silently, auth-less, forever.
//
// RED   = the omp family's isolation env carries CLAUDE_CONFIG_DIR and no omp tree projection.
// GREEN = surface 'omp', HOME isolated, ~/.omp projected into that HOME so omp finds its auth.

const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

function ompCard() {
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 45_000, model: 'deepseek/deepseek-v4-flash',
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['high'] },
    ceiling: 4, versionProbe: () => 'omp test',
  });
  return adapter.card();
}

test('RUNTIME-ISOLATION: the omp surface isolates HOME without claude config, and projects the ~/.omp credential tree', () => {
  const repo = root('omp-iso-repo');
  const fakeHome = root('omp-iso-home');
  const fakeOmpAgent = join(fakeHome, '.omp', 'agent');
  mkdirSync(fakeOmpAgent, { recursive: true });
  writeFileSync(join(fakeOmpAgent, 'agent.db'), 'x');
  writeFileSync(join(fakeOmpAgent, 'config.yml'), 'x');

  const isolation = new RuntimeIsolation({
    repoRoot: repo,
    baseEnv: { HOME: fakeHome, PATH: '/usr/bin:/bin' },
    credentialTrees: {
      omp: [{ sourceRoot: fakeHome, relativeFiles: ['.omp/agent/agent.db', '.omp/agent/config.yml'] }],
    },
  });

  const runtime = isolation.create('w-omp-pin', ompCard());

  // 1. The surface is omp's own — never the claude fallback config dir.
  assert.equal(runtime.env.CLAUDE_CONFIG_DIR, undefined,
    'omp members must not receive a claude config dir (surface must be omp, not the claude fallback)');
  // 2. HOME is the isolated per-worker home.
  assert.equal(runtime.env.HOME, runtime.paths.home,
    `HOME must be the isolated per-worker home (got ${runtime.env.HOME})`);
  // 3. The ~/.omp credential tree is projected INSIDE the isolated home so omp finds its auth.
  assert.equal(existsSync(join(runtime.env.HOME, '.omp', 'agent', 'agent.db')), true,
    'the omp credential tree (~/.omp/agent/agent.db) must be projected into the isolated HOME — without it omp parks auth-less and never dials the provider');
  assert.equal(existsSync(join(runtime.env.HOME, '.omp', 'agent', 'config.yml')), true,
    'the omp config (agent/config.yml) rides the same projection');
});
