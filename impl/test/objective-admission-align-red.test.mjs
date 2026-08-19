// Issue #207 (row-admission-align) — the admission alignment pin. RED at the pre-change head:
// the interpreter admits a by-reference brief up to the 64 KiB D5 envelope
// (OBJECTIVE_REF_MAX_BYTES, workflow-interpreter.mjs:46), so a 4-64 KiB brief passes admission,
// reaches waves.start, and every member then dies at run.start — the foundry-era phantom
// (spill_body_exceeded per member at the pre-#89 head; at the current head the machinery
// admits-with-spill, churning the inline spill lane the by-reference seam was never meant to
// ride). GREEN (this row): the interpreter refuses AT ADMISSION — a rendered objective over the
// run.objective cap throws the typed `workflow_spec_invalid` naming BOTH byte counts (the
// measured rendered bytes and the cap), and waves.start is NEVER reached (fail-loud at the seam,
// never a per-member start failure).
//
// Contract (closed): docs/reference/evidence/phantom-root-2026-08-15/wave-f/admission-align-notes.md
//   — item 1 (admission-time refusal naming byte counts), item 2 (judgment call: the 64 KiB
//   OBJECTIVE_REF_MAX_BYTES stays the documented by-reference FILE envelope; the ADMISSION bound
//   is the run.objective cap from the limits registry, enforced on the RENDERED objective — the
//   interpreter does not split, so the spill lane stays the inline path's mechanism, OQ5's
//   advisory-PASS governs createWaveDriver, never this by-reference seam), item 3 (this suite).
//
// Hermetic: temp git repos, a recording stub facade (waves.start records + throws a marker) — no
// driver stack, no network, no provider. The admission refusal must fire BEFORE any wave start,
// so the stub is the proof surface: count === 0 on refusal, count === 1 on the within-cap guard.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { runWorkflow } from '../src/workflow-interpreter.mjs';

// The run.start objective cap from the registry — the ONE source (Decision 8 no-re-declare law).
const CAP = FRAME_LIMITS['run.objective'].value;

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-admission-align-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Admission Align', '-c', 'user.email=align@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return dir;
}

function specFor(dir, role, objectiveRef) {
  return {
    schemaVersion: 1,
    idempotencyKey: `admission-align-${role}`,
    members: [{ role, objectiveRef, exact: { ...ROUTE }, scope: ['out.md'] }],
  };
}

// A facade whose waves.start records the call and throws a marker — the rows assert the admission
// refusal fires BEFORE the wave starts (never a per-member start failure).
function recordingFacade() {
  const calls = { count: 0 };
  return {
    calls,
    waves: {
      start: async () => {
        calls.count += 1;
        throw Object.assign(new Error('PIN: admission passed — waves.start was reached'), { code: 'pin_waves_start_reached' });
      },
    },
  };
}

// Run and return the rejection reason (or null on fulfillment) — the rows assert the refusal's
// code + message directly, independent of assert.rejects' return-value semantics.
async function captureRejection(fn) {
  try { await fn(); return null; } catch (error) { return error; }
}

// Parse the measured rendered bytes the refusal names ("renders to N bytes").
function measuredBytes(message) {
  return Number(/\brenders to (\d+) bytes\b/u.exec(message)?.[1]);
}

test('ADMISSION-ALIGN-RED: a 4-64 KiB objectiveRef brief refuses at admission naming both byte counts, waves.start never reached', async (t) => {
  const dir = repo(t);
  // 5 KiB: inside the 64 KiB D5 envelope (render passes), over the 4096-byte run.objective cap —
  // the exact band that phantom-failed every member at the pre-change head.
  writeFileSync(join(dir, 'brief.md'), 'x'.repeat(5 * 1024));
  const facade = recordingFacade();
  const error = await captureRejection(() => runWorkflow(facade, specFor(dir, 'align-red', 'brief.md'), { repoRoot: dir }));
  assert.ok(error, 'a brief over the run.objective cap must refuse at admission');
  assert.equal(error.code, 'workflow_spec_invalid',
    'the admission refusal is the typed workflow_spec_invalid (never a per-member start failure)');
  const measured = measuredBytes(error.message);
  assert.ok(Number.isSafeInteger(measured) && measured > 5 * 1024,
    `the refusal names the measured RENDERED bytes — the salt marker rides the objective (measured ${measured}, file 5120)`);
  assert.ok(error.message.includes(`${CAP}`),
    `the refusal names the cap (${CAP} bytes) — both byte counts on the seam`);
  assert.equal(facade.calls.count, 0,
    'waves.start must never be reached — fail-loud at the seam, never a per-member start failure');
});

test('ADMISSION-ALIGN-BOUNDARY: a brief file at exactly the cap renders over it (the attempt marker) and still refuses at admission', async (t) => {
  const dir = repo(t);
  // The sharpest boundary: the FILE is at the cap, but the RENDERED objective (the exact string
  // run.start measures) carries the "[attempt: <salt> <role>] " marker — so it exceeds the cap.
  writeFileSync(join(dir, 'brief.md'), 'x'.repeat(CAP));
  const facade = recordingFacade();
  const error = await captureRejection(() => runWorkflow(facade, specFor(dir, 'align-boundary', 'brief.md'), { repoRoot: dir }));
  assert.ok(error, 'a file at the cap renders to more and must refuse at admission');
  assert.equal(error.code, 'workflow_spec_invalid',
    'the boundary refusal is the typed workflow_spec_invalid');
  const measured = measuredBytes(error.message);
  assert.ok(Number.isSafeInteger(measured) && measured > CAP,
    `the rendered objective (file + attempt marker) exceeds the cap (measured ${measured}, cap ${CAP})`);
  assert.equal(facade.calls.count, 0, 'waves.start must never be reached');
});

test('ADMISSION-ALIGN-GUARD: a within-cap brief passes admission and reaches waves.start', async (t) => {
  const dir = repo(t);
  writeFileSync(join(dir, 'brief.md'), 'x'.repeat(200));
  const facade = recordingFacade();
  await assert.rejects(
    () => runWorkflow(facade, specFor(dir, 'align-ok', 'brief.md'), { repoRoot: dir }),
    (cause) => cause?.code === 'pin_waves_start_reached',
    'a within-cap brief must pass admission — the refusal must never over-fire',
  );
  assert.equal(facade.calls.count, 1, 'waves.start was reached exactly once');
});
