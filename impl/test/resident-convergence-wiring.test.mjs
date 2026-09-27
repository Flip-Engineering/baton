import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// PR 239 landing contract: the convergence layer is not an opt-in library left on the
// shelf — the campaign resident itself rides openConvergedBaton, so the unified surface
// (one CLI, one MCP) is THE surface every client sees.
//
// RED   = createBatonDeployment() returns the raw substrate deployment (no `.convergence`
//         runtime, no journal) — convergence installed nowhere.
// GREEN = the resident's deployment carries the convergence runtime: journal + wrapped
//         client surface, on an isolated fixture repo (never the live campaign root).

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-resident-conv-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'resident-conv@example.invalid', GIT_COMMITTER_EMAIL: 'resident-conv@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Resident Conv', GIT_COMMITTER_NAME: 'Resident Conv' });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('RESIDENT-CONVERGENCE: the campaign resident rides the converged surface', async (t) => {
  const repo = repository();
  const prevRepo = process.cwd();
  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const home = mkdtempSync(join(tmpdir(), 'baton-resident-conv-home-'));
  const xdg = mkdtempSync(join(tmpdir(), 'baton-resident-conv-xdg-'));
  let deployment = null;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    try { process.chdir(prevRepo); } catch {}
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
    try { rmSync(home, { recursive: true, force: true }); } catch {}
    try { rmSync(xdg, { recursive: true, force: true }); } catch {}
  });
  process.chdir(repo);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = xdg;
  // Lazy import AFTER the env flip so createBatonDeployment's process.cwd() is the fixture.
  const { createBatonDeployment } = await import('../scripts/resident.deployment.mjs');
  deployment = await createBatonDeployment();
  assert.ok(deployment.convergence, 'deployment exposes the convergence runtime (openConvergedBaton wired)');
  assert.equal(typeof deployment.convergence.journal?.append, 'function',
    'convergence runtime carries the durable journal');
});
