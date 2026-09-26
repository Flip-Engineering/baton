// Issue #306 (the WIRING half) — `deployment.reincarnate` is REACHABLE end to end.
//
// Lane A landed the verb (application.mjs reincarnate() → the deployment's own reincarnate(),
// 809341b3) and the two CLI spellings (application-cli.mjs parseBatonCli), and lane B landed the
// served/behind doctor row and the `incarnation_changed` wake class (6bc66bcb). What neither lane
// could land is the two admissions that make the verb REACHABLE — the row the CLI's own dispatch
// gate derives from (application-cli.mjs cliDispatchTransports reads webAdmittedCommandNames()) and
// the web lane's direct-port row (web-northbound.mjs). Without them the resident answers
// 'unsupported command' and the CLI refuses `cli_command_unavailable` in its own process, before
// any request leaves it.
//
// RED at the pre-wiring HEAD, row by row (observed by running this file against a clean worktree at
// the same base):
//  (a) `baton deployment reincarnate <sha>` exits 2 with
//      `baton: cli_command_unavailable: unsupported Run command deployment.reincarnate` — the
//      resident is never asked;
//  (b) `baton serve --reincarnate <sha>` takes the identical path and dies the identical way;
//  (c) the canonical operation row does not exist (canonicalOperationForCommand returns null), and
//      the web lane does not admit either spelling.
//
// What each row pins, on a REAL resident (`baton serve` as a child process, the owner socket, the
// published connection the CLI discovers):
//  (a) the refusal is the RESIDENT'S OWN — `reincarnation_target_unreachable` for a commit-ish this
//      deployment cannot resolve, `reincarnation_same_commit` for the commit it already serves —
//      with the resident's own message, crossed typed (409, retryable:false). Both are drawn
//      BEFORE any effect (no row, no spawn, no lease moved), which the row also proves: the
//      resident is still serving the same incarnation afterwards;
//  (b) the `serve --reincarnate` spelling is the SAME command, byte-identically;
//  (c) the admission is ONE row per spelling and the argument authority is exactly {target}.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY, canonicalOperationForCommand, deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import { cliDispatches, parseBatonCli } from '../src/application-cli.mjs';
import { validateWebCommandEnvelope, webAdmittedCommandNames } from '../src/web-northbound.mjs';

import { endFixtureResident, spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
// A commit-ish no repository holds: well-formed for the CLI's own validator (a 40-hex sha), so the
// request reaches the resident and the DEPLOYMENT is the authority that refuses it.
const UNREACHABLE = '0'.repeat(40);
const RESIDENT_CODE = 'reincarnation_target_unreachable';
const SAME_COMMIT_CODE = 'reincarnation_same_commit';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const roots = [];
// Issue #471: this file serves ONE resident shared by its rows, so its cleanup is the file's own:
// the residents are ended by process group BEFORE the worlds they served are removed, and the
// helper's process-level handlers (exit, SIGTERM/SIGINT/SIGHUP) cover a runner killed outright.
const residents = [];
test.after(async () => {
  for (const child of residents) await endFixtureResident(child);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt306w-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue306w@example.invalid', GIT_COMMITTER_EMAIL: 'issue306w@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue306w', GIT_COMMITTER_NAME: 'Issue306w' });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  writeFileSync(join(repo, 'landing.txt'), 'landing\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  const landing = git(['rev-parse', 'HEAD']).stdout.trim();
  return { root, repo, home, configRoot, deploymentRoot, landing };
}

/** The exact adapter card the ordinary resident self-check requires (the issue351/issue387 recipe):
 * a fixture adapter with an exact route and available credentials, so the resident publishes
 * without a provider process. The deployment is a REAL one — a real state directory, a real
 * coordination store, a real owner socket. */
function deploymentModule(fixture) {
  const advanced = `
    deploymentRoot: ${JSON.stringify(fixture.deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: { XDG_CONFIG_HOME: ${JSON.stringify(fixture.configRoot)}, HOME: ${JSON.stringify(fixture.home)} }, home: ${JSON.stringify(fixture.home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
  `;
  const path = join(fixture.root, 'deployment.mjs');
  writeFileSync(path, `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${JSON.stringify(ROUTE)});
function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue306w fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue306w-reincarnate-reachable', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  return path;
}

/** The served resident: a real `baton serve` child over the fixture deployment, waited for by its
 * own publication (the selector the CLI discovers). */
function serveResident(label) {
  const fixture = world(label);
  const modulePath = deploymentModule(fixture);
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const env = {
    ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot,
    [bypassName]: bypassValue,
  };
  // Issue #471: the ONE fixture-resident spawn. The child declares THIS runner (so a killed runner
  // leaves no resident behind) and is registered for this file's own cleanup above.
  const child = spawnFixtureResident(null, {
    args: [SCRIPT, 'serve', modulePath],
    cwd: fixture.repo, env,
  });
  residents.push(child);
  const state = { stderr: '' };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
  const published = () => (existsSync(selectorPath)
    ? JSON.parse(readFileSync(selectorPath, 'utf8')) : null);
  return Object.freeze({
    ...fixture, child, state, env, modulePath,
    async untilReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) break;
        if (published() !== null && state.stderr.includes('"state":"published"')) return;
        await sleep(25);
      }
      throw new Error(`the fixture resident never published (exit=${child.exitCode}): ${state.stderr.slice(-2_000)}`);
    },
    published,
    /** One CLI invocation against the served resident, exactly as an operator runs it: the real
     * entry script, from the served checkout, with the environment the connection is published in.
     * The first spelling is `deployment reincarnate`, the second `serve --reincarnate` — the argv
     * is the caller's, never an in-process shortcut. */
    cli(argv) {
      return spawnSync(process.execPath, [SCRIPT, ...argv], {
        cwd: fixture.repo, env, encoding: 'utf8', timeout: 60_000,
      });
    },
  });
}

let resident = null;
function servedResident() {
  resident ??= serveResident('resident');
  return resident;
}

// ── (a) the CLI's own spelling reaches the RUNNING resident ─────────────────────────────────────

test('306w-a: `baton deployment reincarnate <sha>` reaches the served resident and its refusal is the RESIDENT\'S', async () => {
  const served = servedResident();
  await served.untilReady();
  const first = served.published();

  const unreachable = served.cli(['deployment', 'reincarnate', UNREACHABLE]);
  assert.equal(unreachable.status, 1, `the refusal is a runtime failure, never a usage error: ${unreachable.stderr}`);
  assert.match(unreachable.stderr, new RegExp(RESIDENT_CODE, 'u'),
    'the refusal carries the deployment\'s own typed code');
  assert.match(unreachable.stderr, /resolves to no commit in this deployment/u,
    'and the resident\'s own message, so the refusal is the verb\'s and not a transport\'s');
  assert.doesNotMatch(unreachable.stderr, /cli_command_unavailable|unsupported command/u,
    'the CLI never refuses a verb the wire it talks to admits');

  // The same command against the commit this resident ALREADY serves: the deployment resolved the
  // target and drew its second pre-effect refusal — proof the verb itself ran, not just the wire.
  const same = served.cli(['deployment', 'reincarnate', served.landing]);
  assert.equal(same.status, 1, same.stderr);
  assert.match(same.stderr, new RegExp(SAME_COMMIT_CODE, 'u'), same.stderr);
  assert.match(same.stderr, new RegExp(served.landing, 'u'), 'the refusal names the commit it serves');

  // Both refusals were drawn BEFORE any effect: this is the FIRST incarnation, still serving the
  // selector it published, and no reincarnation row was written.
  assert.equal(served.child.exitCode, null, 'the resident is still the live one');
  assert.equal(served.published()?.incarnation, first?.incarnation,
    'still the SAME incarnation: a refused request never moves the publication');
  const ledger = join(served.deploymentRoot, 'state', 'coordination', 'events.jsonl');
  const rows = existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line))
    : [];
  assert.deepEqual(rows.filter((row) => row.kind === 'driver.recorded'
    && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.reincarnation')),
  [], 'a refused request writes no reincarnation row and spawns no successor');
});

// ── (b) the second spelling is the SAME command ─────────────────────────────────────────────────

test('306w-b: `baton serve --reincarnate <sha>` takes the same path to the same resident verb', async () => {
  const served = servedResident();
  await served.untilReady();

  const before = parseBatonCli(['serve', '--reincarnate', UNREACHABLE]);
  const sibling = parseBatonCli(['deployment', 'reincarnate', UNREACHABLE]);
  assert.equal(before.name, sibling.name, 'one command, two spellings');
  assert.deepEqual(before.args, sibling.args);

  const refused = served.cli(['serve', '--reincarnate', UNREACHABLE]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, new RegExp(RESIDENT_CODE, 'u'), refused.stderr);
  assert.doesNotMatch(refused.stderr, /cli_command_unavailable|unsupported command/u, refused.stderr);
});

// ── (c) the admission is ONE row per spelling; the argument authority is exactly {target} ───────

test('306w-c: the verb is admitted once per spelling, with `target` as its only argument', () => {
  const admitted = webAdmittedCommandNames();
  for (const spelling of ['deployment.reincarnate', 'deployment_reincarnate']) {
    assert.equal(admitted.filter((name) => name === spelling).length, 1,
      `${spelling} is admitted exactly once`);
  }
  assert.ok(cliDispatches('deployment.reincarnate'),
    'the CLI\'s dispatch authority derives from the same admission (cliDispatchTransports)');

  const operation = canonicalOperationForCommand('deployment.reincarnate');
  assert.ok(operation, 'the canonical operation row exists (the CLI gate and the doc renderer read it)');
  assert.equal(deriveSurfaceNames('deployment.reincarnate').web, 'deployment_reincarnate',
    'the underscore spelling is the row\'s derived web transport, through the ONE naming seam — '
    + 'exactly the pair deployment.doctor has admitted beside it');
  assert.deepEqual(Object.keys(operation.inputSchema.properties), ['target'],
    '`target` is the operation\'s only declared argument');
  assert.deepEqual(operation.inputSchema.required, ['target']);
  assert.equal(operation.surfaces.includes('cli'), true, 'the row claims the surface it now serves');
  assert.equal(operation.surfaces.includes('mcp'), false,
    'no advertised MCP tool belongs to a verb that ends the process answering the call');
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((entry) => entry.key === 'deployment.reincarnate').length, 1,
  'ONE canonical row');

  // The wire's own closed set: {target} admitted on both spellings, anything else refused by name.
  const envelope = (command, args) => ({
    schemaVersion: 1, commandId: `cmd-306w-${command}`, idempotencyKey: `idem-306w-${command}`,
    command, args, repoId: 'repo-306w', origin: 'https://baton.test',
  });
  for (const spelling of ['deployment.reincarnate', 'deployment_reincarnate']) {
    assert.equal(validateWebCommandEnvelope(envelope(spelling, { target: 'main' })), null,
      `${spelling} admits {target}`);
    assert.deepEqual(validateWebCommandEnvelope(envelope(spelling, { target: 'main', extra: 1 })),
      { code: 'unknown_argument_field', field: 'extra', message: 'unknown_argument_field' },
      `${spelling} admits nothing beside target`);
  }
});
