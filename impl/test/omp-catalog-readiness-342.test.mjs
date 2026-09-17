// omp-catalog-readiness-342.test.mjs — issue #342: an omp route is ready only when the harness's
// own catalog (`omp models --json`) defines the model and its effort, and an omp that dies before
// its ready frame carries its stderr on the setup crash. Hermetic: injected catalog reads, a fake
// `omp` script on disk, temp HOME/repo; no real omp, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ompModelCatalog, ompRouteReadiness } from '../src/application-deployment.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

const dirs = [];
function tmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-omp-342-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// The shape `omp models --json --no-extensions` answered on 2026-09-17 (omp 17.4.0), reduced to
// the deepseek provider: no `deepseek-v4-pro[1m]` exists; `deepseek-v4-pro` does, at low/high/max.
const CATALOG_JSON = JSON.stringify({
  models: [
    { provider: 'deepseek', id: 'deepseek-flash', selector: 'deepseek/deepseek-flash', thinking: ['low', 'high', 'max'] },
    { provider: 'deepseek', id: 'deepseek-v4-flash', selector: 'deepseek/deepseek-v4-flash', thinking: ['low', 'high', 'max'] },
    { provider: 'deepseek', id: 'deepseek-v4-pro', selector: 'deepseek/deepseek-v4-pro', thinking: ['low', 'high', 'max'] },
    { provider: 'zai', id: 'glm-5.3-flash', selector: 'zai/glm-5.3-flash', thinking: ['low', 'high', 'max'] },
    { provider: 'opencode-go', id: 'deepseek-flash', selector: 'opencode-go/deepseek-flash', thinking: null },
    { provider: 'broken' },
  ],
});

/** A staged operator: ~/.omp/agent/agent.db exists, and the repo carries the provider key file. */
async function withOmpHome(fn) {
  const home = tmp('home');
  mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
  writeFileSync(join(home, '.omp', 'agent', 'agent.db'), 'sqlite-fixture');
  const repo = tmp('repo');
  writeFileSync(join(repo, 'deepseek_key.json'), JSON.stringify({ deepseek_key: 'bogus' }));
  writeFileSync(join(repo, 'glm_key.json'), JSON.stringify({ glm_key: 'bogus' }));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try { return await fn(repo); } finally { process.env.HOME = previousHome; }
}

test('#342: ompModelCatalog maps the harness catalog by selector and drops malformed rows; an unreadable catalog is null', () => {
  const catalog = ompModelCatalog({ catalogRead: () => CATALOG_JSON });
  assert.equal(catalog.size, 5);
  assert.deepEqual(catalog.get('deepseek/deepseek-v4-pro'), { provider: 'deepseek', id: 'deepseek-v4-pro', thinking: ['low', 'high', 'max'] });
  assert.deepEqual(catalog.get('opencode-go/deepseek-flash').thinking, null);
  assert.equal(catalog.has('deepseek/deepseek-v4-pro[1m]'), false);
  assert.equal(ompModelCatalog({ catalogRead: () => null }), null);
  assert.equal(ompModelCatalog({ catalogRead: () => 'not json' }), null);
  assert.equal(ompModelCatalog({ catalogRead: () => { throw new Error('no omp'); } }), null);
});

test('#342: the phantom route is blocked naming the models the harness defines; a wrong effort is blocked naming the efforts; a defined route reads ready; an unreadable catalog blocks typed', async () => {
  await withOmpHome((repo) => {
    const read = () => CATALOG_JSON;
    const phantom = ompRouteReadiness(repo, 'deepseek/deepseek-v4-pro[1m]', 'medium', { catalogRead: read });
    assert.equal(phantom.state, 'blocked');
    assert.equal(phantom.code, 'model_unavailable_in_harness');
    assert.match(phantom.summary, /deepseek\/deepseek-v4-pro\b/u, 'names the model the harness does define');
    assert.match(phantom.summary, /deepseek\/deepseek-flash/u);
    const effort = ompRouteReadiness(repo, 'deepseek/deepseek-v4-pro', 'medium', { catalogRead: read });
    assert.equal(effort.code, 'effort_unavailable_in_harness');
    assert.match(effort.summary, /low, high, max/u);
    assert.deepEqual(ompRouteReadiness(repo, 'deepseek/deepseek-flash', 'low', { catalogRead: read }), { state: 'ready' });
    assert.deepEqual(ompRouteReadiness(repo, 'zai/glm-5.3-flash', 'max', { catalogRead: read }), { state: 'ready' });
    assert.deepEqual(ompRouteReadiness(repo, 'deepseek/deepseek-flash', null, { catalogRead: read }), { state: 'ready' }, 'no effort asked: the model alone decides');
    const unreadable = ompRouteReadiness(repo, 'deepseek/deepseek-flash', 'low', { catalogRead: () => null });
    assert.equal(unreadable.code, 'omp_catalog_unavailable');
    assert.match(unreadable.summary, /omp models --json --no-extensions/u);
  });
});

test('#342: an omp that exits before its ready frame carries its stderr tail on the setup refusal and the crash row', async () => {
  const bin = tmp('fake-omp');
  const script = join(bin, 'omp');
  writeFileSync(script, [
    '#!/bin/sh',
    'echo \'Model "deepseek/deepseek-v4-pro[1m]" not found\' >&2',
    'echo \'Set an API key environment variable: ANTHROPIC_API_KEY=sk-ant-SECRETSECRETSECRET\' >&2',
    'exit 1',
    '',
  ].join('\n'));
  chmodSync(script, 0o755);
  const worktree = tmp('worktree');
  const adapter = new OmpRpcCli({
    cmd: script, requestTimeoutMs: 2_000, model: 'deepseek/deepseek-v4-pro[1m]',
    modelCatalog: { 'deepseek/deepseek-v4-pro[1m]': ['medium'] },
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  const ack = await adapter.spawn('w-342', { goal: 'x', verification: { command: 'true', expectExit: 0 } }, {
    worktree, model: 'deepseek/deepseek-v4-pro[1m]', reasoningEffort: 'medium', processReapTimeoutMs: 500,
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'setup_process_exit');
  assert.match(ack.stderrTail, /Model "deepseek\/deepseek-v4-pro\[1m\]" not found/u, 'the refusal carries omp\'s own sentence');
  assert.doesNotMatch(ack.stderrTail, /SECRETSECRET/u, 'a token-shaped value on stderr is redacted');
  const crashed = events.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crashed, 'the setup crash is emitted');
  assert.equal(crashed.payload.phase, 'setup');
  assert.equal(crashed.payload.exitCode, 1);
  assert.match(crashed.payload.stderrTail, /not found/u);
  assert.doesNotMatch(crashed.payload.stderrTail, /SECRETSECRET/u);
});
