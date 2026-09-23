// issue558-publish-remote-reaches-driver-red.test.mjs — issue #558's declaration half must reach
// the driver the composition root returns.
//
// Measured 2026-09-23 on master 65c913f0: a real landing refused integrate_publish_undeclared
// (contribution-4e9dad30a7f92dcf419f152f612e2c64, target master, 03:47Z). The refusal has a
// direct cause in the composition root, independent of the environment the serving process was
// started with: createDriver read the option and validated it (impl/src/index.mjs:1249) and
// carried it into the coordinator options (:1647), but the object it RETURNS (:1882-1885) had no
// `integrationPublishRemote` member, while the swarm runtime's landing authority reads exactly
// that member (impl/src/application.mjs:2276-2282) and passes the resulting null into the landing
// (impl/src/worktree.mjs:2351-2356, which refuses a real landing before anything moves). The
// unwired option is silent the way the CDW1 route authority was: nothing throws, the landing
// refuses with a code that names the deployment rather than the wiring.
//
// Rows: a driver opened with the declaration exposes it; a driver opened without one exposes null;
// and the consumer's own read resolves the declared remote off the returned driver.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-558-wiring-${name}-`));
const DECLARED = 'https://github.com/Flip-Engineering/baton.git';

function repo() {
  const path = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: path });
  return path;
}

const RUNTIME_POLICY = Object.freeze({
  schemaVersion: 1, pathEntries: Object.freeze([dirname(process.execPath)]),
  constants: Object.freeze({ LANG: 'C' }),
});

const mock = () => new MockAdapter({
  scenario: { outcome: 'completed' },
  card: { harness: 'mock', version: 'wiring-1', model: 'wiring-model' },
});

/** The read the swarm runtime's landing authority makes of the driver (impl/src/application.mjs
 * :2276-2282), reproduced here so the pin fails on the wiring, not on a copied constant. */
function landingPublishRemoteOf(driver) {
  return typeof driver?.integrationPublishRemote === 'string'
    && driver.integrationPublishRemote.length > 0 ? driver.integrationPublishRemote : null;
}

function openDriver(t, extra = {}) {
  const repository = repo();
  const logDir = root('log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-558-wiring', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY, ...extra,
  });
  t.after(async () => {
    await driver.drainAndClose('558-wiring').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return driver;
}

test('558-p1: a driver opened with a declared publish remote exposes it to the landing authority', async (t) => {
  const driver = openDriver(t, { integrationPublishRemote: DECLARED });
  assert.equal(driver.integrationPublishRemote, DECLARED,
    'createDriver validated the declaration, so the driver it returns must carry it — a consumer reading the member is the only path the landing authority has to it');
  assert.equal(landingPublishRemoteOf(driver), DECLARED,
    'the consumer read resolves the declared remote, so a real landing publishes to it instead of refusing integrate_publish_undeclared');
});

test('558-p2: a driver opened without a declaration exposes null', async (t) => {
  const driver = openDriver(t);
  assert.equal(driver.integrationPublishRemote, null,
    'a deployment that declares none says so with null, never with a missing member that a consumer reads as undefined');
  assert.equal(landingPublishRemoteOf(driver), null,
    'and the consumer read still answers null, which is the value that refuses a real landing');
});
