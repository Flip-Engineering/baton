import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { acquireResultExportRootLease } from '../src/result-export.mjs';


// #330 red pin — a lease whose recorded rootIdentityDigest differs from the current root's
// (the evidence root was recreated under a dead holder) must not brick the successor with a
// bare result_export_root_busy forever. Liveness decides BEFORE identity: a DEAD holder is
// reclaimable even on identity mismatch; a LIVE foreign-identity holder still refuses, and the
// refusal names the pid so the operator reads the cause through the serve/doctor refusal path.
//
// RED   = a foreign-digest lease over a dead pid refuses (busy) today.
// GREEN = the dead foreign-identity lease reclaims; the successor acquires.

const FOREIGN_DIGEST = 'f'.repeat(64);

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'baton-lease-330-'));
  chmodSync(root, 0o700);
  return root;
}

async function deadOwnerPid() {
  const child = spawn('/bin/sleep', ['0.05']);
  const pid = child.pid;
  return new Promise((resolve) => {
    child.on('exit', () => {
      const timer = setInterval(() => {
        try { process.kill(pid, 0); } catch {
          clearInterval(timer);
          resolve(pid);
        }
      }, 20);
    });
  });
}

function livePidStart(pid) {
  return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8', maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function writeLeaseOwner(root, { pid, pidStart, rootIdentityDigest }) {
  const lease = join(root, '.baton-export-root-lease');
  mkdirSync(lease, { mode: 0o700 });
  writeFileSync(join(lease, 'owner.json'), JSON.stringify({
    schemaVersion: 2,
    pid,
    pidStart,
    nonce: randomUUID(),
    rootIdentityDigest,
  }));
  chmodSync(join(lease, 'owner.json'), 0o600);
  return lease;
}

test('LEASE-330: a foreign-identity lease over a dead pid reclaims on acquire (successor boots)', async (t) => {
  const root = makeRoot();
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const deadPid = await deadOwnerPid();
  writeLeaseOwner(root, {
    pid: deadPid, pidStart: 'Sat Jan  1 00:00:00 1999', rootIdentityDigest: FOREIGN_DIGEST,
  });
  // THE PIN: a dead holder cannot hold THIS root through that lease, mismatch or not.
  const lease = acquireResultExportRootLease(root);
  assert.ok(lease, 'the successor acquires the reclaimed root');
  assert.equal(lease.release(), true);
});

test('LEASE-330: a live foreign-identity holder still refuses naming the pid', (t) => {
  const root = makeRoot();
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  writeLeaseOwner(root, {
    pid: process.pid, pidStart: livePidStart(process.pid), rootIdentityDigest: FOREIGN_DIGEST,
  });
  assert.throws(() => acquireResultExportRootLease(root), (error) => {
    assert.equal(error?.code, 'result_export_root_busy');
    assert.match(error?.message ?? '', new RegExp(`\\b${process.pid}\\b`),
      'the refusal names the live holder pid');
    assert.equal(error?.detail?.holder?.pid, process.pid);
    assert.equal(error?.detail?.holder?.liveness, 'alive');
    assert.equal(error?.detail?.rootIdentity, 'mismatch');
    return true;
  });
});

test('LEASE-330: an unproved lease refuses closed with the manual-rm remedy', (t) => {
  const root = makeRoot();
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const lease = join(root, '.baton-export-root-lease');
  mkdirSync(lease, { mode: 0o700 });
  writeFileSync(join(lease, 'owner.json'), '{"schemaVersion":999}\n', { mode: 0o600 });
  assert.throws(() => acquireResultExportRootLease(root), (error) => {
    assert.equal(error?.code, 'result_export_root_busy');
    assert.match(error?.message ?? '', /rm -rf /,
      'the refusal names the manual removal when no live holder is proved');
    assert.equal(error?.detail?.rootIdentity, 'unproved');
    assert.match(error?.detail?.remedy ?? '', /rm -rf /);
    assert.equal(error?.detail?.lease, lease);
    return true;
  });
});
