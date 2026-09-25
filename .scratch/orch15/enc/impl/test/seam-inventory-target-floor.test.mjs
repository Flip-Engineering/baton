// seam-inventory-target-floor.test.mjs — issue #510. The committed artifact's per-target member
// counts are the floor the check mode enforces: a target's count may grow or hold between the
// committed artifact and a fresh regeneration, and a drop — or a target the regeneration loses
// entirely — is refused by name with both counts. SI6 pins the corpus as frozen data inside the
// suite; this file exercises the check itself, the one `node scripts/seam-inventory.mjs` runs on
// a checkout whose TARGETS catalogue lost an entry. The `fresh` injection point is how the test
// holds the regenerated side smaller than the committed one without editing the script.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { INVENTORY_PATH, TARGETS, checkSeamInventory, collectSeamInventory } from '../scripts/seam-inventory.mjs';

const FLOOR_FINDING = /member count dropped|absent from the regeneration/u;

function committedCounts() {
  return new Map(
    JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')).files.map((file) => [file.file, file.members.length]),
  );
}

test('SI7 (#510): check mode refuses a regeneration that lost a TARGETS entry, naming the target and both counts', () => {
  const counts = committedCounts();
  // The incident: one TARGETS entry falls out of the catalogue, so the regenerated inventory
  // carries no entry for that file while the committed artifact still carries its members.
  const dropped = TARGETS[TARGETS.length - 1].file;
  const before = counts.get(dropped);
  assert.ok(Number.isSafeInteger(before) && before > 0, `${dropped}: the dropped target must be one the committed artifact carries`);
  const smaller = collectSeamInventory();
  smaller.files = smaller.files.filter((file) => file.file !== dropped);
  assert.ok(!smaller.files.some((file) => file.file === dropped), 'the fixture must model the dropped entry');

  const findings = checkSeamInventory({ path: INVENTORY_PATH, fresh: smaller });
  assert.ok(findings.length > 0, 'check mode must refuse when a committed target is missing from the regeneration');
  assert.ok(
    findings.some((finding) => finding.includes(dropped) && finding.includes(`committed ${before}`) && finding.includes('regenerated 0')),
    `check mode must name the dropped target with both counts: ${findings.join(' | ')}`,
  );
});

test('SI7b (#510): check mode refuses a target whose member count shrank, naming both counts', () => {
  const counts = committedCounts();
  const file = TARGETS[0].file;
  const before = counts.get(file);
  assert.ok(Number.isSafeInteger(before) && before >= 2, `${file}: the shrunken target must be one the committed artifact carries`);
  const shrunken = collectSeamInventory();
  const entry = shrunken.files.find((row) => row.file === file);
  entry.members = entry.members.slice(0, Math.floor(before / 2));
  const after = entry.members.length;
  assert.ok(after > 0 && after < before, 'the fixture must model a partial count drop');

  const findings = checkSeamInventory({ path: INVENTORY_PATH, fresh: shrunken });
  assert.ok(findings.length > 0, 'check mode must refuse when a target member count drops');
  assert.ok(
    findings.some((finding) => finding.includes(file) && finding.includes(`committed ${before}`) && finding.includes(`regenerated ${after}`)),
    `check mode must name the shrunken target with both counts: ${findings.join(' | ')}`,
  );
});

test('SI7c (#510): a target that grew, and a brand-new target, carry no per-target finding', () => {
  const grown = collectSeamInventory();
  grown.files[0].members.push({ name: 'brandNewMember', ordinal: 0, size: 1, seam: 'surface', evidence: ['surface:no_authority_touched'] });
  grown.files.push({
    file: 'impl/src/brand-new-target.mjs',
    class: null,
    members: [{ name: 'brandNewModuleMember', ordinal: 0, size: 1, seam: 'surface', evidence: ['surface:no_authority_touched'] }],
  });

  const findings = checkSeamInventory({ path: INVENTORY_PATH, fresh: grown });
  assert.ok(!findings.some((finding) => FLOOR_FINDING.test(finding)), `growth and new targets are admitted: ${findings.join(' | ')}`);
});
