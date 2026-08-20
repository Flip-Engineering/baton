import { test } from 'node:test';
import assert from 'node:assert/strict';

// #244 red pin — wave reap DROPS member snapshot commits.
//
// Measured (wave-b, 2026-08-20): all three members completed their rows — notes files,
// code fixes, battery-green pins — riding worktree snapshot commits (worktree.mjs
// 'baton snapshot: <task>' commits, logged as worktree.captured {sha}). The wave settled,
// worktrees reaped... and NONE of the snapshot commits integrated. They dangled off no
// ref; recovery needed `git log --all --author=baton-worker-omp` archaeology.
//
// The contract: the settle receipt must carry each member's snapshot sha (the commit
// where the deliverable lives), so a reaped-but-unintegrated member is MECHANICALLY
// recoverable — the #241 recoverySha pattern generalized from harvest rows to the work
// itself.
//
// RED   = outcome rows carry only resultSha (the pinned result); no snapshot sha anywhere
//         on the receipt.
// GREEN = every outcome whose capture observed a snapshot commit carries snapshotSha
//         (the worktree.captured sha); members whose capture found a clean tree carry
//         snapshotSha: null (honest — nothing to recover).

test('SNAPSHOT-ON-RECEIPT (#244): settle outcomes carry the member snapshot sha', async () => {
  const mod = await import('../src/workflow-interpreter.mjs');
  assert.equal(typeof mod.runWorkflow, 'function', 'the interpreter exports runWorkflow');

  // Read the outcome-assembly source: the field the wave view builds per member.
  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/workflow-interpreter.mjs', import.meta.url), 'utf8'));
  const outcomeLine = src.match(/const outcome = \{ role: member\.role, phase, terminal, resultSha[^\n]*\}/);
  assert.ok(outcomeLine, 'the outcome assembly site exists');
  assert.ok(outcomeLine[0].includes('snapshotSha'),
    `the outcome row must carry snapshotSha (the worktree.captured sha — the member's deliverable commit); today: ${outcomeLine[0]}`);
});
