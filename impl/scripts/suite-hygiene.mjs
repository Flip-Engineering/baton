// Issue #40: suite temp-residue hygiene. run-suite.mjs cleans its baton-suite-* root on every
// handled exit, but a SIGKILL-class parent death runs no handler — the root leaked and the
// detached test group kept working headless. Two cooperating repairs live here:
//
// - Each suite root records its owner (`suite-owner.json`). The next suite start sweeps sibling
//   roots whose recorded owner process is provably dead (ESRCH). Death of the recorded pid is
//   the only sweep authority: unreadable receipts, live owners, and foreign directories are
//   never touched, so the sweeper needs no age heuristic.
// - scripts/suite-orphan-watchdog.mjs (imported into the detached child) makes the test group
//   terminate itself once its parent disappears.

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RECEIPT_NAME = 'suite-owner.json';

export function writeSuiteOwnerReceipt(suiteRoot) {
  writeFileSync(join(suiteRoot, RECEIPT_NAME), JSON.stringify({
    schemaVersion: 1, pid: process.pid, startedAt: new Date().toISOString(),
  }), { mode: 0o600 });
}

function ownerDead(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM proves the pid is live under another user; only ESRCH proves death.
    return error?.code === 'ESRCH';
  }
}

export function sweepStaleSuiteRoots(parentDir) {
  let entries;
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const swept = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('baton-suite-')) continue;
    const root = join(parentDir, entry.name);
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(join(root, RECEIPT_NAME), 'utf8'));
    } catch {
      continue; // No readable receipt is no proof of death.
    }
    if (receipt?.schemaVersion !== 1 || !ownerDead(receipt.pid)) continue;
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
      swept.push(root);
    } catch { /* a busy or vanishing root is retried by a later suite start */ }
  }
  return swept;
}
