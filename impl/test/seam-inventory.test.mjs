// seam-inventory.test.mjs — issue #259 slice 0. Pins the machine-checked seam map that
// impl/scripts/seam-inventory.mjs produces and the check mode that keeps it honest.
//
// Three claims are load-bearing:
//   1. COMPLETE — every top-level member of the three classes appears in the committed artifact,
//      in source order, exactly once. The map is the input to a later split, so a member the map
//      silently dropped is a member the split would silently leave behind in the monolith.
//   2. STALE-DETECTING — a regeneration of the committed artifact is clean, and the check mode
//      refuses a committed artifact that has drifted (a moved line, a changed seam, changed
//      evidence, a member that vanished). A map that cannot fail is documentation, not a check.
//   3. EVIDENCE-BASED — classification follows the catalogue in the script, not a per-member
//      table: the pins below name members whose seam is readable from what they call.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  FALLBACK_EVIDENCE, INVENTORY_PATH, SCHEMA_VERSION, SEAMS, TARGETS,
  checkSeamInventory, collectMembers, collectSeamInventory, renderSeamInventory,
} from '../scripts/seam-inventory.mjs';

const IMPL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const READABLE_SEAM = new RegExp(`^(?:${SEAMS.join('|')}|delegates):[a-z_]+$`, 'u');

function committed() {
  return JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
}

function withMutation(mutate) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-seam-inventory-'));
  const path = join(directory, 'seam-inventory.json');
  const inventory = committed();
  mutate(inventory);
  writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`);
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('SI1: the committed map classifies every member of all three classes exactly once', () => {
  const inventory = collectSeamInventory();
  assert.equal(inventory.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(inventory.files.map((file) => file.file), TARGETS.map((target) => target.file));

  for (const target of TARGETS) {
    const file = inventory.files.find((entry) => entry.file === target.file);
    // The source is the authority on the member list: parse it again and require an exact match,
    // so a member the classifier skipped fails here rather than going missing in the split.
    const source = readFileSync(join(IMPL_ROOT, target.file.slice('impl/'.length)), 'utf8');
    const parsed = collectMembers(source, target.className);
    assert.deepEqual(
      file.members.map((member) => ({ name: member.name, ordinal: member.ordinal })),
      parsed.map((member) => ({ name: member.name, ordinal: member.ordinal })),
      `${target.file}: every ${target.className} member must be classified, in source order`,
    );
    assert.equal(file.class, target.className);

    // Uniqueness is per DEFINITION (name+ordinal), not per name, so a class that declares one
    // method twice shows both rather than hiding the silent override — and nothing is keyed by a
    // line number, so ordinary edits do not stale the committed map.
    const identities = new Set();
    for (const member of file.members) {
      assert.ok(SEAMS.includes(member.seam), `${member.name}: seam ${member.seam} is not one of the five`);
      const identity = `${member.name}#${member.ordinal}`;
      assert.ok(!identities.has(identity), `${identity}: classified twice`);
      identities.add(identity);
      assert.ok(Number.isSafeInteger(member.ordinal) && member.ordinal >= 0, `${member.name}: ordinal`);
      assert.ok(Number.isSafeInteger(member.size) && member.size > 0, `${member.name}: size`);
      assert.ok(Number.isSafeInteger(member.line) && member.line > 0, `${member.name}: the live inventory knows its line for --report`);
      assert.ok(Array.isArray(member.evidence) && member.evidence.length > 0, `${member.name}: evidence must be present`);
      for (const entry of member.evidence) assert.match(entry, READABLE_SEAM, `${member.name}: evidence ${entry}`);
    }
  }
});

test('SI1b: the committed artifact carries no line numbers, so ordinary edits never stale it', () => {
  for (const file of committed().files) {
    for (const member of file.members) {
      assert.equal(member.line, undefined, `${member.name}: committed map carries no line`);
      assert.equal(member.endLine, undefined, `${member.name}: committed map carries no endLine`);
      assert.ok(Number.isSafeInteger(member.ordinal) && Number.isSafeInteger(member.size), `${member.name}: ordinal and size`);
    }
  }
});

test('SI2: the committed map regenerates clean, deterministically, and the check mode fails when it is stale', () => {
  assert.deepEqual(checkSeamInventory(), [], 'the committed artifact must match a fresh regeneration');
  assert.equal(renderSeamInventory(collectSeamInventory()), renderSeamInventory(collectSeamInventory()), 'classification must be deterministic');
  assert.equal(readFileSync(INVENTORY_PATH, 'utf8'), renderSeamInventory(collectSeamInventory()), 'the committed bytes must be the rendered artifact');

  const cases = [
    {
      name: 'a reclassified member',
      mutate: (inventory) => {
        const member = inventory.files[0].members[0];
        member.seam = member.seam === 'effect' ? 'observation' : 'effect';
      },
      expect: /classifies as/u,
    },
    {
      name: 'a dropped member',
      mutate: (inventory) => { inventory.files[0].members.pop(); },
      expect: /is uncommitted/u,
    },
    {
      name: 'a member that no longer exists',
      mutate: (inventory) => { inventory.files[0].members.push({ name: 'ghostMember', ordinal: 0, size: 1, seam: 'effect', evidence: ['effect:action_verb'] }); },
      expect: /no longer exists/u,
    },
    {
      name: 'a renamed member',
      mutate: (inventory) => { inventory.files[1].members[0].name = `${inventory.files[1].members[0].name}Renamed`; },
      expect: /is uncommitted|no longer exists/u,
    },
    {
      name: 'drifted evidence',
      mutate: (inventory) => { inventory.files[2].members[0].evidence.push('effect:timer_arm'); },
      expect: /evidence drifted/u,
    },
  ];
  for (const { name, mutate, expect } of cases) {
    const fixture = withMutation(mutate);
    try {
      const findings = checkSeamInventory({ path: fixture.path });
      assert.ok(findings.length > 0, `${name}: the check must not accept a stale artifact`);
      assert.ok(findings.some((finding) => expect.test(finding)), `${name}: expected ${expect} in ${findings.join(' | ')}`);
    } finally {
      fixture.cleanup();
    }
  }

  const corrupt = withMutation(() => {});
  writeFileSync(corrupt.path, '{ not json');
  try {
    assert.match(checkSeamInventory({ path: corrupt.path }).join(' '), /not JSON/u);
  } finally {
    corrupt.cleanup();
  }
  assert.match(checkSeamInventory({ path: join(tmpdir(), 'baton-absent-seam-inventory.json') }).join(' '), /unreadable/u);
});

test('SI3: the check mode is the same one the CLI runs, and it exits non-zero on a stale artifact', () => {
  // Green: the committed artifact.
  const ok = execFileSync(process.execPath, ['scripts/seam-inventory.mjs'], { cwd: IMPL_ROOT, encoding: 'utf8' });
  assert.equal(ok.trim(), 'seam-inventory: ok');
  // Green: the report the doc's tables are read from.
  const report = execFileSync(process.execPath, ['scripts/seam-inventory.mjs', '--report'], { cwd: IMPL_ROOT, encoding: 'utf8' });
  assert.match(report, /"entangled"/u);

  // Red: a stale artifact. The CLI resolves the artifact by path, so the fixture is written over
  // the committed file and restored immediately — the check mode is what a suite/CI run sees.
  const original = readFileSync(INVENTORY_PATH, 'utf8');
  try {
    const inventory = JSON.parse(original);
    inventory.files[0].members[0].seam = inventory.files[0].members[0].seam === 'effect' ? 'observation' : 'effect';
    writeFileSync(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`);
    const failure = spawnSync(process.execPath, ['scripts/seam-inventory.mjs'], { cwd: IMPL_ROOT, encoding: 'utf8' });
    assert.equal(failure.status, 1, 'a stale artifact must exit 1');
    assert.match(failure.stderr, /seam-inventory: /u);
  } finally {
    writeFileSync(INVENTORY_PATH, original);
  }
  assert.deepEqual(checkSeamInventory(), [], 'the committed artifact must be restored exactly');
});

test('SI4: the classifier reads the seams off the source, not off a per-member table', () => {
  const inventory = collectSeamInventory();
  const member = (file, name) => {
    const entry = inventory.files.find((row) => row.file.endsWith(file));
    const found = entry.members.find((row) => row.name === name);
    assert.ok(found, `${file}: ${name} must be classified`);
    return found;
  };

  // Transport reachability: these members are surface because the application's dispatcher calls
  // them, which is read off `_commandDispatch`'s call sites — not because a list names them.
  assert.equal(member('application.mjs', '_commandDispatch').seam, 'surface');
  assert.equal(member('application.mjs', 'messageSend').seam, 'surface');
  assert.ok(member('application.mjs', 'messageSend').evidence.includes('surface:transport_dispatch'));
  // A transport that also does real work keeps its dispatch evidence AND its authority evidence:
  // that is what makes it entangled, and what the split has to decide about.
  assert.equal(member('application.mjs', 'act').seam, 'surface');
  assert.ok(member('application.mjs', 'act').evidence.length >= 2, 'a transport entrypoint records every authority it touches');

  // Effect: the process/worktree/provider seams.
  for (const name of ['kill', '_spawn', '_dispatch', 'sendMessage']) {
    assert.equal(member('coordinator.mjs', name).seam, 'effect', `${name} acts on the world`);
  }
  // Recovery: restart reconciles — by name and by call.
  for (const name of ['_recover', '_replay', 'recover', 'startupReady']) {
    assert.equal(member('coordinator.mjs', name).seam, 'recovery', `${name} is a restart path`);
  }
  assert.equal(member('coordination-store.mjs', '_load').seam, 'recovery');
  // Observation: durable recording and projection.
  for (const name of ['_append', '_appendBatch', 'createTask', 'snapshot']) {
    assert.equal(member('coordination-store.mjs', name).seam, 'observation', `${name} records or projects durable state`);
  }
  assert.equal(member('coordinator.mjs', 'constructor').seam !== undefined, true);
  // Admission: the validators that refuse before any effect.
  for (const name of ['_validateTaskTopology', '_validateGoalPlanReplayTransactions', 'admitWebCommand']) {
    const row = member('coordination-store.mjs', name);
    assert.ok(['admission', 'recovery'].includes(row.seam), `${name} decides, not acts (saw ${row.seam})`);
    assert.ok(row.evidence.some((entry) => entry.startsWith('admission:')), `${name} must carry admission evidence`);
  }

  // The named fallback: a member that touches no authority is reported as exactly that, so the
  // split can see which members it must place by hand instead of inheriting a silent default.
  const fallback = inventory.files.flatMap((file) => file.members).filter((row) => row.evidence.includes(FALLBACK_EVIDENCE));
  assert.ok(fallback.length > 0, 'the fallback bucket is a finding the map must keep visible');
  for (const row of fallback) {
    assert.deepEqual(row.evidence, [FALLBACK_EVIDENCE], `${row.name}: fallback members carry no other evidence`);
    assert.equal(row.seam, 'surface');
  }
  assert.ok(fallback.length < inventory.files.reduce((sum, file) => sum + file.members.length, 0) / 4,
    'the fallback must stay a small minority of the corpus, not the default answer');
});
