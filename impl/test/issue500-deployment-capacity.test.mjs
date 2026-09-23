// issue500-deployment-capacity.test.mjs — Issue #500 (deployment group): the disk, memory,
// artifact-size and worktree-capacity bounds in application-deployment.mjs carried no cited
// derivation. The module now carries a #500 triage comment at each bound (per the #496
// registry-roots precedent in limits.mjs: an operator-declared number stays, the comment records
// the triage), and THIS suite pins each bound's live value and — where a hermetic seam exists —
// the refusal behavior at its boundary.
//
// Rows:
//   500-caps-A  the open publishes the declared defaults verbatim on the driver options: the
//               worktree capacity reserves, the stop deadline, the steering nudge window, the
//               drain policy, the budget terminal grace, and the dependency projection limits
//   500-caps-B  a capacity observation is quantized down to the observation quanta before any
//               verdict or published row
//   500-caps-C  the adapter wire frame corridor refuses outside 64 KiB–16 MiB and admits both
//               bounds exactly
//   500-caps-D  the resident command deadline default is 30 s: pollMs sits on its boundary and
//               an explicit commandTimeoutMs moves it
//   500-caps-E  the muse auth.json read enforces the registry's credential.file boundary (at
//               the bound it parses; one byte over, the credential reads as invalid)
//   500-caps-F  the omp model catalog read answers a parsed selector map or an unreadable null
//   500-caps-H  the bounds with no hermetic seam (process-boundary exec options, the
//               process-local catalog memo, the published refusal text bound, the wire frame
//               default, the verification output ceiling) keep their live literals — source
//               pins, the same last-resort register as the scanner doc-comment rows
//
// Hermetic: temp dirs under os.tmpdir(), one MockAdapter route, no provider process, no network.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  museRouteReadiness, ompModelCatalog, openBatonDeployment,
} from '../src/application-deployment.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';

const dirs = [];
function tmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-500-caps-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repository(name) {
  const root = tmp(`repo-${name}`);
  const git = (args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  git(['init', '-q']);
  git(['config', 'user.email', 'issue500@example.invalid']);
  git(['config', 'user.name', 'Issue 500']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  // A small installed dependency tree, so the open attests one and publishes the projection
  // limits on the driver options (a repo with no dependency directory projects null).
  mkdirSync(join(root, 'node_modules', 'fixture'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'fixture', 'index.js'), 'module.exports = 1;\n');
  git(['add', '.']);
  git(['commit', '-qm', 'issue 500 capacity fixture']);
  return root;
}
const ROUTE = Object.freeze({ harness: 'mock-500-caps', model: 'mock-500-caps-1', effort: 'high' });
const fixtureAdapter = (harness) => {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  // The route card facts a readiness row needs to read ready (the issue444/phase78 fixture
  // decoration): a deterministic local adapter with one exact route.
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: 4,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue-500-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
};

async function openDeployment(t, name, { advanced = {}, onDriver = null } = {}) {
  const deployment = await openBatonDeployment({
    repo: repository(name),
    advanced: {
      deploymentRoot: join(tmp(`owner-${name}`), 'deployment'),
      adapters: { [ROUTE.harness]: fixtureAdapter(ROUTE.harness) },
      routes: [ROUTE],
      verification: { command: process.execPath, arguments: ['--version'] },
      ...advanced,
    },
  }, (options) => { if (onDriver) onDriver(options); return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* already closed */ } });
  return deployment;
}

/** An open that must refuse during option validation: the driver factory replaces itself with a
 * tripwire, so a case that unexpectedly PASSES validation fails loudly instead of opening. */
async function openFailure(name, advanced) {
  return openBatonDeployment({
    repo: repository(name),
    advanced,
  }, () => { throw new Error('the driver must never be created: validation passed'); });
}

const duplicateRoutes = [ROUTE, { ...ROUTE }];

test('500-caps-A: the open publishes the declared capacity and stop-envelope defaults verbatim', async (t) => {
  let driverOptions = null;
  await openDeployment(t, 'defaults', { onDriver: (options) => { driverOptions = options; } });
  assert(driverOptions, 'the open handed the driver its options');
  assert.deepEqual(driverOptions.worktreeCapacity, {
    maxReservedBytes: null, maxReservedInodes: null, minFreeBytes: null, minFreeInodes: null,
    runtimeReserveBytes: 64 * 1024 * 1024, runtimeReserveInodes: 10_000,
  }, 'the per-runtime reserve stays the shipped 64 MiB / 10 000-inode allowance with a derived floor');
  assert.equal(driverOptions.stopDeadlineMs, 15_000, 'the stop deadline');
  assert.equal(driverOptions.progressNudgeWindowMs, 300_000, 'the steering nudge window');
  assert.deepEqual(driverOptions.drainPolicy, { maxWorkers: 64, timeoutMs: 90_000, pollMs: 10 },
    'the drain: 64 workers, a 90 s window, a 10 ms poll');
  assert.deepEqual(driverOptions.budgetPolicy, { terminalGraceMs: 2_000 }, 'the budget terminal grace');
  assert.deepEqual(driverOptions.toolchainProjection.limits, {
    maxMappings: 128, maxFiles: 1_000_000, maxDirectories: 250_000,
    maxBytes: 2 * 1024 * 1024 * 1024, maxFileBytes: 512 * 1024 * 1024,
    maxPathBytes: 4096, maxDepth: 256,
  }, 'the dependency projection limits ride the attested descriptor verbatim');
});

test('500-caps-B: a capacity observation is quantized down before any verdict or published row', async (t) => {
  const BYTE_QUANTUM = 64 * 1024 * 1024;
  const INODE_QUANTUM = 10_000;
  const deployment = await openDeployment(t, 'quantum', {
    advanced: {
      // #561: the derived floor carries a swap-growth reserve measured from the host; this
      // fixture stages a debt-free host so the row judges quantization alone, never the real
      // machine's memory pressure.
      capacity: {
        hostObservation: () => ({
          totalBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, swapFreeBytes: 0, cores: 4,
        }),
        observe: () => ({
          freeBytes: 3 * BYTE_QUANTUM + 12_345, freeInodes: 2 * INODE_QUANTUM + 999,
        }),
      },
    },
  });
  const doctor = await deployment.doctor();
  assert.equal(doctor.workspace.state, 'ready');
  assert.equal(doctor.workspace.freeBytes, 3 * BYTE_QUANTUM, 'free bytes snap down to a 64 MiB step');
  assert.equal(doctor.workspace.freeInodes, 2 * INODE_QUANTUM, 'free inodes snap down to a 10 000-inode step');
});

test('500-caps-C: the adapter wire frame corridor refuses outside 64 KiB–16 MiB and admits the bounds', async (t) => {
  await assert.rejects(
    openFailure('wire-below', { adapterOptions: { maxWireFrameBytes: 64 * 1024 - 1 }, routes: duplicateRoutes }),
    (error) => {
      assert.equal(error.code, 'deployment_config_invalid');
      assert.match(error.message, /maxWireFrameBytes must be an integer between/);
      return true;
    },
  );
  await assert.rejects(
    openFailure('wire-min', { adapterOptions: { maxWireFrameBytes: 64 * 1024 }, routes: duplicateRoutes }),
    /duplicate/,
    'the 64 KiB minimum passes the corridor (validation reached the routes check)',
  );
  await assert.rejects(
    openFailure('wire-max', { adapterOptions: { maxWireFrameBytes: 16 * 1024 * 1024 }, routes: duplicateRoutes }),
    /duplicate/,
    'the 16 MiB maximum passes the corridor',
  );
  await assert.rejects(
    openFailure('wire-above', { adapterOptions: { maxWireFrameBytes: 16 * 1024 * 1024 + 1 }, routes: duplicateRoutes }),
    /maxWireFrameBytes must be an integer between/,
    'one byte over the corridor refuses',
  );
});

test('500-caps-D: the resident command deadline default is 30 s — pollMs sits on its boundary', async (t) => {
  await assert.rejects(
    openFailure('deadline-over', { resident: { pollMs: 30_001 }, routes: duplicateRoutes }),
    (error) => {
      assert.equal(error.code, 'deployment_config_invalid');
      assert.match(error.message, /advanced resident configuration is invalid/);
      return true;
    },
    'a poll past the default 30 s deadline refuses',
  );
  await assert.rejects(
    openFailure('deadline-at', { resident: { pollMs: 30_000 }, routes: duplicateRoutes }),
    /duplicate/,
    'a poll AT 30 s passes with no explicit commandTimeoutMs — the default is exactly 30 s',
  );
  await assert.rejects(
    openFailure('deadline-explicit', { resident: { pollMs: 30_001, commandTimeoutMs: 30_002 }, routes: duplicateRoutes }),
    /duplicate/,
    'an explicit commandTimeoutMs moves the boundary',
  );
});

test('500-caps-E: the muse auth.json read enforces the registry credential.file boundary', (t) => {
  const path = join(tmp('muse-auth'), 'auth.json');
  const base = JSON.stringify({
    providers: { meta: { mechanism: 'oauth', access_token: 'muse-token' } },
  });
  const bound = FRAME_LIMITS['credential.file'].value;
  const atBound = base + ' '.repeat(bound - Buffer.byteLength(base));
  writeFileSync(path, atBound);
  assert.equal(museRouteReadiness({ authPath: path }).state, 'ready',
    'an auth.json at the registry bound parses and reads ready');
  writeFileSync(path, `${atBound} `);
  const blocked = museRouteReadiness({ authPath: path });
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.code, 'authentication_metadata_invalid',
    'one byte over the boundary the credential reads as invalid, never as absent-and-quiet');
});

test('500-caps-F: the omp model catalog read answers a parsed selector map or an unreadable null', () => {
  const body = JSON.stringify({ models: [
    { provider: 'deepseek', id: 'deepseek-flash', thinking: ['low', 'high'] },
    { provider: 'deepseek', id: 'deepseek-v4-pro' },
    { provider: 'zai', id: 'glm-5.3', selector: 'zai/glm-5.3-flash', thinking: ['low', 7, null] },
    { not: 'a row' },
    [1, 2],
  ] });
  const catalog = ompModelCatalog({ catalogRead: () => body });
  assert.deepEqual([...catalog.get('deepseek/deepseek-flash').thinking], ['low', 'high']);
  assert.equal(catalog.get('deepseek/deepseek-v4-pro').thinking, null);
  assert.deepEqual([...catalog.get('zai/glm-5.3-flash').thinking], ['low'],
    'non-string thinking entries are filtered out');
  assert.equal(ompModelCatalog({ catalogRead: () => null }), null, 'an unreadable catalog reads as null');
  assert.equal(ompModelCatalog({ catalogRead: () => 'not json' }), null);
  assert.equal(ompModelCatalog({ catalogRead: () => '{}' }), null, 'a modelless catalog reads as null');
});

test('500-caps-H: the bounds with no hermetic seam keep their live literals (source pins)', () => {
  const source = readFileSync(new URL('../src/application-deployment.mjs', import.meta.url), 'utf8');
  const count = (pattern, label, expected) => {
    const hits = [...source.matchAll(new RegExp(pattern.source, 'gu'))];
    assert.equal(hits.length, expected, `${label}: expected ${expected} occurrence(s), found ${hits.length}`);
  };
  count(/const OMP_CATALOG_MEMO_MS = 60_000;/u, 'omp catalog memo window', 1);
  count(/timeout: 20_000, maxBuffer: 8 \* 1024 \* 1024,/u, 'omp catalog exec bound', 1);
  count(/encoding: 'utf8', timeout: 5_000,/u, 'which PATH probe deadline', 1);
  count(/stdio: 'ignore', timeout: 5_000, maxBuffer: 1024 \* 1024,/u, 'codex/muse capability probe bounds', 2);
  count(/timeout: 10_000,?/u, 'reincarnation local git read deadlines', 3);
  count(/timeout: 60_000,/u, 'reincarnation remote fetch and serving-checkout move deadlines', 2);
  // MAX_KIMI_CREDENTIAL_METADATA_BYTES, MAX_GROK_CREDENTIAL_METADATA_BYTES and
  // MAX_MUSE_AUTH_FILE_BYTES read FRAME_LIMITS['credential.file'].value (#500, ea9040d6) rather
  // than a live literal; issue500-credential-divergence.test.mjs S500-2 pins that reference.
  count(/const GROK_AUTH_EARLY_INVALIDATION_MS = 5 \* 60 \* 1000;/u, 'grok early invalidation window', 1);
  count(/const WORKSPACE_OBSERVATION_BYTE_QUANTUM = FRAME_LIMITS\['workspace\.observation_quantum_bytes'\]\.value;/u, 'workspace byte quantum (registry row, #377 landing two)', 1);
  count(/const PROVIDER_REFUSAL_TEXT_BYTES = 1024;/u, 'published provider refusal text bound', 1);
  count(/commandTimeoutMs: rawResident\.commandTimeoutMs \?\? 30_000,/u, 'resident command deadline default', 1);
  count(/stopDeadlineMs: FRAME_LIMITS\['run\.stop_deadline_ms'\]\.value,/u, 'stop deadline (registry row, #498 landing two)', 1);
  count(/progressNudgeWindowMs: 300_000,/u, 'steering nudge window', 1);
  count(/drainPolicy: \{ maxWorkers: 64, timeoutMs: 90_000, pollMs: 10 \},/u, 'drain policy', 1);
  count(/budgetPolicy: \{ terminalGraceMs: 2_000, \.\.\.budgetPolicy \},/u, 'budget terminal grace default', 1);
  // #497: the corridor moved into the registry — the floor and ceiling are row reads, and the
  // default is half the ceiling row, so no corridor literal survives in this module.
  count(/const MIN_ADAPTER_WIRE_FRAME_BYTES = FRAME_LIMITS\['adapter\.wire_frame_min'\]\.value;/u, 'wire-frame corridor floor (registry row)', 1);
  count(/const MAX_ADAPTER_WIRE_FRAME_BYTES = FRAME_LIMITS\['adapter\.wire_frame_max'\]\.value;/u, 'wire-frame corridor ceiling (registry row)', 1);
  count(/const DEFAULT_DEPLOYMENT_WIRE_FRAME_BYTES = MAX_ADAPTER_WIRE_FRAME_BYTES \/ 2;/u, 'deployment wire frame default (half the ceiling row)', 1);
  count(/maxOutputBytes: 1024 \* 1024,/u, 'verification capture output ceiling', 1);
});
