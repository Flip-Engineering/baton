// Issue #288 (U-F9): `baton doctor` surfaces the protocol-drift refusal VERBATIM — both registry
// digests and the remedy the resident's own refusal carries — instead of swallowing it and offering
// `baton setup`, which cannot repair drift (the expected case after any `git pull`).
//
// The verb is the deliverable, so this test spawns `impl/scripts/baton.mjs doctor` the way an
// operator runs it, in a real checkout with a real publication, and reads its stdout.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const BATON = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
const CLI_REGISTRY_DIGEST = APPLICATION_SEMANTIC_REGISTRY.digest;
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue288-doctor-${label}-`));
  roots.push(root);
  return root;
}

/** One checkout with a resident publication (`baton serve`'s schema-2 selector + profile + token),
 * parameterized by the registry digest the publication claims. */
function publication({ label, registryDigest }) {
  const repo = join(scratch(label), 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const homedir = scratch(`${label}-home`);
  const configRoot = join(homedir, 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  const authorityRoot = join(repo, '.git', 'baton');
  mkdirSync(profilesRoot, { recursive: true });
  mkdirSync(authorityRoot, { recursive: true });
  const repoId = `repo-${createHash('sha256').update(realpathSync(join(repo, '.git')))
    .digest('hex').slice(0, 32)}`;
  const startedAt = '2026-09-14T00:00:00.000Z';
  writeFileSync(join(authorityRoot, 'connection.json'), JSON.stringify({
    schemaVersion: 2, profile: 'issue288', repoId,
    deploymentId: 'deploy-issue288', incarnation: 'incarnation-issue288', transport: 'local',
    registryDigest, startedAt,
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, 'issue288.json'), JSON.stringify({
    schemaVersion: 2, url: 'https://resident.baton.test', origin: 'https://control.baton.test',
    tokenFile: 'issue288.token', transport: 'local', socketPath: '/tmp/b288-doctor.sock',
    deploymentId: 'deploy-issue288', incarnation: 'incarnation-issue288',
    registryDigest, startedAt,
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, 'issue288.token'), 'issue288-private-bearer\n', { mode: 0o600 });
  return { repo, env: { ...process.env, HOME: homedir, XDG_CONFIG_HOME: configRoot } };
}

function doctor(fixture, args = ['doctor']) {
  const run = spawnSync(process.execPath, [BATON, ...args], {
    cwd: fixture.repo, env: fixture.env, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0, `baton ${args.join(' ')} exits 0 (stderr: ${run.stderr})`);
  return JSON.parse(run.stdout);
}

test('U-F9: doctor refuses protocol drift with both digests and the resident remedy, never "baton setup"', () => {
  const residentDigest = 'a'.repeat(64);
  const fixture = publication({ label: 'drift', registryDigest: residentDigest });
  const result = doctor(fixture);

  assert.equal(result.state, 'needs_setup');
  assert.equal(result.outline.connection, 'invalid');
  assert.ok(result.refusal, 'the refusal discovery raises rides the doctor output');
  assert.equal(result.refusal.code, 'cli_config_invalid');
  assert.equal(result.refusal.field, 'registryDigest');
  // Verbatim: the message carries BOTH full digests, not truncated stand-ins.
  assert.equal(result.refusal.message.includes(residentDigest), true, 'the resident digest is named');
  assert.equal(result.refusal.message.includes(CLI_REGISTRY_DIGEST), true, 'the CLI digest is named');
  assert.equal(result.refusal.detail.residentRegistryDigest, residentDigest);
  assert.equal(result.refusal.detail.cliRegistryDigest, CLI_REGISTRY_DIGEST);
  // The remedy is the resident's own next action, and the doctor's own `next` names it — the one
  // misdirection the finding recorded was `baton setup`, which cannot repair drift.
  assert.match(result.refusal.message, /use the CLI of the commit the resident runs, or restart the resident from this checkout/u);
  assert.equal(result.next.some((row) => row.command === 'baton setup'), false,
    'protocol drift is never reported as "run baton setup"');
  assert.equal(result.next[0].command, 'baton serve');
  assert.match(result.next[0].reason, /CLI of the commit the resident runs/u);
  assert.equal(JSON.stringify(result).includes('baton setup'), false);
});

test('U-F9: a healthy publication is never refused (the drift refusal is not blanket)', () => {
  const fixture = publication({ label: 'healthy', registryDigest: CLI_REGISTRY_DIGEST });
  const result = doctor(fixture);
  // The publication itself is judged usable — no refusal rides the outline. (The resident's own
  // liveness reads through the ordinary outline state; this fixture ships no listening socket.)
  assert.equal(result.outline.profile, 'ready');
  assert.equal(Object.hasOwn(result, 'refusal'), false, 'a matching publication is not refused');
});

test('U-F9: --check refuses drift on the same seam instead of a misleading network failure', () => {
  const fixture = publication({ label: 'drift-check', registryDigest: 'b'.repeat(64) });
  const run = spawnSync(process.execPath, [BATON, 'doctor', '--check'], {
    cwd: fixture.repo, env: fixture.env, encoding: 'utf8', timeout: 30_000,
  });
  assert.notEqual(run.status, 0, '--check on an unusable authority is a non-zero exit');
  const result = JSON.parse(run.stdout);
  assert.equal(result.outline.connection, 'invalid');
  assert.equal(result.refusal.detail.residentRegistryDigest, 'b'.repeat(64));
  assert.doesNotMatch(run.stderr, /check your network/u,
    'an unusable local publication is never reported as a network problem');
});
