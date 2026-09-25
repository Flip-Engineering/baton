// Issue #42: the time-bomb fixture class — a real store clock beside a hardcoded near-dated
// expiry — reached master green twice and failed hours later when wall time crossed the literal
// (kg12, fixed in 0afe842; a phase89 lease shape caught in the bloc acceptance review). Contract
// text now mandates fixed clocks; these contracts pin the mechanical lint that enforces it.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { lintFixtureClocks } from '../scripts/fixture-clock-lint.mjs';

function fixtureDir(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'baton-clock-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

const NOW = Date.parse('2026-07-23T12:00:00.000Z');

// The pre-fix kg12 shape verbatim: a CoordinationStore built with a real clock in a file that
// also hardcodes a near-dated lease expiry.
const PRE_FIX_KG12 = `
import { CoordinationStore } from '../src/coordination-store.mjs';
function freshStore(label) {
  return new CoordinationStore(dir(label), { repoId });
}
const lease = { expiresAt: '2026-07-22T09:00:00.000Z' };
`;

test('CL1 (#42): the pre-fix kg12 shape — real store clock + near-dated expiry — is flagged with file and line', (t) => {
  const root = fixtureDir(t, { 'kg12-shape.test.mjs': PRE_FIX_KG12 });
  const findings = lintFixtureClocks([join(root, 'kg12-shape.test.mjs')], { now: NOW });
  assert.equal(findings.length, 1);
  assert.match(findings[0].file, /kg12-shape\.test\.mjs$/u);
  assert.equal(findings[0].line, 6, 'the finding points at the expiry literal');
  assert.match(findings[0].reason, /clock/iu);
});

test('CL2 (#42): a distant sentinel expiry (2099) is effectively infinite and stays clean', (t) => {
  const root = fixtureDir(t, {
    'sentinel.test.mjs': `
new CoordinationStore(dir());
const principal = { expiresAt: '2099-01-01T00:00:00.000Z' };
`,
  });
  assert.deepEqual(lintFixtureClocks([join(root, 'sentinel.test.mjs')], { now: NOW }), []);
});

test('CL3 (#42): an injected clock defuses the same shape', (t) => {
  const root = fixtureDir(t, {
    'fixed.test.mjs': `
new CoordinationStore(dir(), { clock: () => '2026-07-22T08:00:00.000Z' });
const lease = { expiresAt: '2026-07-22T09:00:00.000Z' };
`,
  });
  assert.deepEqual(lintFixtureClocks([join(root, 'fixed.test.mjs')], { now: NOW }), []);
});

test('CL4 (#42): the explicit pragma allows a deliberate real-clock fixture, reviewably', (t) => {
  const root = fixtureDir(t, {
    'deliberate.test.mjs': `// baton-lint: allow-real-clock — this fixture exercises wall-time drift on purpose
${PRE_FIX_KG12}`,
  });
  assert.deepEqual(lintFixtureClocks([join(root, 'deliberate.test.mjs')], { now: NOW }), []);
});

test('CL5 (#42): a file without any store construction never trips on timestamp literals alone', (t) => {
  const root = fixtureDir(t, {
    'web.test.mjs': `
const now = () => Date.parse('2026-07-11T12:00:00.000Z');
const session = { expiresAt: '2026-12-31T00:00:00.000Z' };
`,
  });
  assert.deepEqual(lintFixtureClocks([join(root, 'web.test.mjs')], { now: NOW }), []);
});

test('CL6 (#42): the real canonical suite is clean under the lint', () => {
  const testDir = new URL('.', import.meta.url).pathname;
  const files = readdirSync(testDir).filter((name) => name.endsWith('.mjs')).map((name) => join(testDir, name));
  const findings = lintFixtureClocks(files);
  assert.deepEqual(findings, [], `time-bomb fixtures in the live suite: ${JSON.stringify(findings)}`);
});
