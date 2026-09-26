// Issue #137 — `baton setup` reads the resident's own publication before it tells an operator to
// create a profile.
//
// The witnessed misdirection (2026-08-06): while the resident host was mid-startup — its
// self-check phase, its profile not yet published — `baton setup` answered `profiles: missing`
// with the sole next action `create_profile → baton help connection`. The actual resolution was to
// WAIT: the running serve published seconds later. Setup sent the operator toward creating a
// profile that would have raced the resident's own publication.
//
// The resident's artifacts are owner-readable under the git common directory — `baton serve`
// writes `baton/connection.json` (its selector, schemaVersion 2) and holds the
// `baton/publication.lease` directory while it runs — so setup can tell the three states apart:
// `published` (a resident serves this repository; nothing for setup to create), `starting` (a
// resident holds the publication and has published nothing yet; retry shortly), and `absent` (no
// resident: setup's own profile answer stands).
//
// Rows:
//   137a  no publication artifacts → setup's own answer (`profiles: missing` + create_profile);
//   137b  the lease held, nothing published → `resident_starting`, the wait action, and NO
//         create_profile hint;
//   137c  a published selector → `resident_published` naming the resident's profile, no
//         create_profile hint;
//   137d  a schemaVersion-1 selector is an installed connection, not a resident publication;
//   137e  an unreadable selector with no lease is absence, never a crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupBatonConnection } from '../src/index.mjs';

const neverFetch = async () => { throw new Error('setup must not reach the network in this contract'); };

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue137-${label}-`));
  roots.push(root);
  return root;
}
/** A repository with a git common directory, and a config home holding no connections directory
 * (the operator has no profile, which is what makes the create_profile hint reachable at all). */
function world(label) {
  const repo = scratch(`${label}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const home = scratch(`${label}-config`);
  return { repo, home, batonDir: join(repo, '.git', 'baton') };
}
const setup = (w, extra = {}) => setupBatonConnection({
  cwd: w.repo, env: { XDG_CONFIG_HOME: w.home }, home: w.home, fetchImpl: neverFetch, ...extra,
});
const nextCommands = (result) => result.next.map((entry) => entry.command);

test('137a: with no resident the profile answer stands', async () => {
  const result = await setup(world('plain'));
  assert.equal(result.state, 'needs_user_input');
  assert.equal(result.outline.profiles, 'missing');
  assert.deepEqual([...result.profiles], []);
  assert.deepEqual(nextCommands(result), ['baton help connection'],
    'with no publication the operator is still told to create a profile');
});

test('137b: a resident holding the publication reads as starting, and setup says wait', async () => {
  const w = world('starting');
  mkdirSync(join(w.batonDir, 'publication.lease'), { recursive: true });
  writeFileSync(join(w.batonDir, 'publication.lease', 'owner.json'), JSON.stringify({ repoId: 'repo-x' }));
  const result = await setup(w);
  assert.equal(result.state, 'needs_user_input');
  assert.equal(result.outline.profiles, 'resident_starting');
  assert.equal(result.resident.state, 'starting');
  assert.equal(result.outline.connection, 'not_written');
  assert.equal(nextCommands(result).includes('baton help connection'), false,
    'the create_profile hint must not appear while a resident is about to publish');
  assert.ok(nextCommands(result).includes('baton setup'), 'the resolution is to WAIT and retry');
});

test('137c: a published resident is named, and needs no profile created', async () => {
  const w = world('published');
  mkdirSync(w.batonDir, { recursive: true });
  writeFileSync(join(w.batonDir, 'connection.json'), JSON.stringify({
    schemaVersion: 2, transport: 'local', profile: 'resident-abc-123', repoId: 'repo-x',
    deploymentId: 'deployment-x', incarnation: 'instance-x', startedAt: '2026-09-26T15:37:40.583Z',
  }));
  const result = await setup(w);
  assert.equal(result.outline.profiles, 'resident_published');
  assert.equal(result.resident.state, 'published');
  assert.equal(result.resident.profile, 'resident-abc-123', 'the resident\'s profile name is readable');
  assert.equal(result.resident.incarnation, 'instance-x');
  assert.equal(result.outline.connection, 'published_by_resident');
  assert.deepEqual(nextCommands(result), ['baton doctor --check'],
    'nothing is left for setup to create or select on a repository a resident serves');
});

test('137d: a schemaVersion-1 selector is an installed connection, not a resident publication', async () => {
  const w = world('v1');
  mkdirSync(w.batonDir, { recursive: true });
  writeFileSync(join(w.batonDir, 'connection.json'), JSON.stringify({
    schemaVersion: 1, profile: 'operator-profile', repoId: 'repo-x',
  }));
  const result = await setup(w);
  assert.equal(result.outline.profiles, 'missing', 'a v1 selector is not read as a resident');
  assert.deepEqual(nextCommands(result), ['baton help connection']);
});

test('137e: an unreadable selector with no lease is absence, never a crash', async () => {
  const w = world('broken');
  mkdirSync(w.batonDir, { recursive: true });
  writeFileSync(join(w.batonDir, 'connection.json'), '{ not json');
  const result = await setup(w);
  assert.equal(result.outline.profiles, 'missing');
  assert.equal(result.resident, undefined, 'no resident is claimed from an unreadable file');
});
