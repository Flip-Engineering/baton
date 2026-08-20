import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// PR 239 landing contract: the convergence layer is not an opt-in library left on the
// shelf — the campaign resident itself rides openConvergedBaton, so the unified surface
// (one CLI, one MCP) is THE surface every client sees.
//
// RED   = createBatonDeployment() returns the raw substrate deployment (no `.convergence`
//         runtime, no journal) — convergence installed nowhere.
// GREEN = the resident's deployment carries the convergence runtime: journal + wrapped
//         client surface, on an isolated fixture repo (never the live campaign root).

function repository(t) {
  const root = mkdtempSync('/tmp/baton-resident-conv-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'resident-conv@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Resident Conv'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  return root;
}

test('RESIDENT-CONVERGENCE: the campaign resident rides the converged surface', async (t) => {
  const repo = repository(t);
  const prevRepo = process.cwd();
  const prevHome = process.env.HOME;
  const home = mkdtempSync('/tmp/baton-resident-conv-home-');
  const xdg = mkdtempSync('/tmp/baton-resident-conv-xdg-');
  t.after(() => {
    try { process.chdir(prevRepo); } catch {}
    process.env.HOME = prevHome;
    try { rmSync(home, { recursive: true, force: true }); } catch {}
    try { rmSync(xdg, { recursive: true, force: true }); } catch {}
  });
  process.chdir(repo);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = xdg;
  // Lazy import AFTER the env flip so createBatonDeployment's process.cwd() is the fixture.
  const { createBatonDeployment } = await import('../scripts/resident.deployment.mjs');
  const deployment = await createBatonDeployment();
  t.after(async () => { try { await deployment.close(); } catch {} });
  assert.ok(deployment.convergence, 'deployment exposes the convergence runtime (openConvergedBaton wired)');
  assert.equal(typeof deployment.convergence.journal?.append, 'function',
    'convergence runtime carries the durable journal');
});
