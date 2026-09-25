// U-E19 (issue #313, from the #288 web2 leftovers): the schema-version gate runs BEFORE the
// key-shape check in EVERY connection reader. discoverBatonConnection already lands that order
// (the unsupported-schema refusal names schemaVersion and the remedy); this pins the same
// ordering inside inspectBatonConnection: a selector newer than this CLI refuses as an
// unsupported schema — carried on the projection as `refusal`, never silently folded into the
// generic needs_setup outline that reads exactly like a corrupt publication.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectBatonConnection } from '../src/application-cli.mjs';

/** A real Git checkout whose common dir carries the connection file inspectBatonConnection reads. */
function checkoutWithSelector(t, selector) {
  const root = mkdtempSync(join(tmpdir(), 'baton-e19-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root]);
  const batonDir = join(root, '.git', 'baton');
  mkdirSync(batonDir, { recursive: true });
  writeFileSync(join(batonDir, 'connection.json'), `${JSON.stringify(selector)}\n`, 'utf8');
  return root;
}

const SCHEMA_3_RESIDENT_SELECTOR = {
  schemaVersion: 3, profile: 'p', repoId: 'repo:e19', deploymentId: 'deployment:e19',
  incarnation: 'incarnation:e19', transport: 'local', registryDigest: 'digest:e19',
  startedAt: '2026-09-14T00:00:00.000Z',
};
const SCHEMA_3_V1_SHAPED_SELECTOR = { schemaVersion: 3, profile: 'p', repoId: 'repo:e19' };

test('U-E19: a schema-3 selector is refused as an unsupported schema, naming the cause', (t) => {
  for (const selector of [SCHEMA_3_RESIDENT_SELECTOR, SCHEMA_3_V1_SHAPED_SELECTOR]) {
    const root = checkoutWithSelector(t, selector);
    const outline = inspectBatonConnection({ cwd: root, env: {}, home: root });
    assert.equal(outline.state, 'needs_setup');
    assert.equal(outline.outline.connection, 'invalid');
    assert.match(outline.refusal?.cause ?? '', /^$/, 'the projected refusal names repository_selector_schema_unsupported');
    assert.equal(outline.refusal?.code, 'cli_config_invalid');
    assert.match(outline.refusal?.detail?.rule ?? '', /unsupported schemaVersion/u);
  }
});

test('U-E19: a schema-2-shaped selector from a future CLI is not misread as a v1 connection', (t) => {
  // The red order read the key shape with the v1 key list first, so a NEWER resident selector
  // (resident keys present) was refused as "unknown or missing fields" — a repair-the-file lie.
  // The schema gate first, so the refusal names the schema, and the projection carries it.
  const root = checkoutWithSelector(t, { ...SCHEMA_3_RESIDENT_SELECTOR, schemaVersion: 2 });
  const outline = inspectBatonConnection({ cwd: root, env: {}, home: root });
  assert.equal(outline.outline.connection, 'invalid');
  assert.match(outline.refusal?.detail?.rule ?? '', /semantic-registry digest|incarnation|deployment/u,
    'a schema-2 selector with fresh resident fields refuses for its authority content, not its key shape');
});
