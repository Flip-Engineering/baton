// Aggregate acceptance tests. Positive and adversarial bundle routes are
// fixture-scoped end to end: the fixture's own records, definitions, tree
// root and entry travel together through grouping and aggregation. The
// per-case endpoint tests use the real discovery work set, because the
// endpoint binds against this checkout's own discovery. No compiler runs.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MUTATIONS } from '../laws-mutations.mjs';
import { proofBlockRange, ROOT } from '../laws-check.mjs';
import { TODO_REFUSAL } from './classify.mjs';
import { accepted, aggregate } from './aggregate.mjs';
import { bindingOf, definitionExpectation, discoveryRecords, sha256Hex } from './work-set.mjs';

const sha256 = (text) => sha256Hex(Buffer.from(text, 'utf8'));

const FIXTURE_BEND2 = join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'fixtures', 'mini-laws', 'bend2');
const FIXTURE_MUTATION = {
  name: 'mini-admitted-returns-refused-gate',
  file: 'bend2/src/mini.bend',
  find: 'def admitted() -> Gate:\n  Gate{True{}}',
  replace: 'def admitted() -> Gate:\n  Gate{False{}}',
  law: 'mini_admitted_gate_is_open',
  expected: 'Gate{True{}}',
  observed: 'Gate{False{}}',
  location: 'mini.mini_admitted_gate_is_open',
};
const FIXTURE_DEFINITIONS = [FIXTURE_MUTATION];

function fixtureRecords() {
  const moduleDir = join(FIXTURE_BEND2, 'src');
  const miniText = readFileSync(join(moduleDir, 'mini.bend'), 'utf8');
  const mainText = readFileSync(join(moduleDir, 'main.bend'), 'utf8');
  const lawRecord = (law, module, text) => ({
    id: `proof:${law}`, kind: 'proof-removal', law, module,
    definition_sha256: sha256Hex(proofDefinitionBytes(text, law)),
  });
  const proofDefinitionBytes = (text, law) => {
    const lines = text.split('\n');
    const index = lines.findIndex((line) => line.startsWith(`law ${law}:`));
    let end = index + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    return lines[index] + '\n' + lines.slice(index + 1, end).join('\n');
  };
  const records = [
    lawRecord('mini_admitted_gate_is_open', 'bend2/src/mini.bend', miniText),
    lawRecord('mini_refused_gate_is_closed', 'bend2/src/mini.bend', miniText),
    lawRecord('mini_entry_answer_is_true', 'bend2/src/main.bend', mainText),
    {
      id: `mutation:${FIXTURE_MUTATION.name}`,
      kind: 'mutation',
      law: FIXTURE_MUTATION.law,
      module: FIXTURE_MUTATION.file,
      definition_sha256: sha256Hex(mutationDefinitionBytes(FIXTURE_MUTATION)),
      expectation: definitionExpectation(FIXTURE_MUTATION),
      location: FIXTURE_MUTATION.location,
    },
  ];
  return records;
}

function mutationDefinitionBytes(mutation) {
  const definition = { file: mutation.file, find: mutation.find, replace: mutation.replace, law: mutation.law };
  if (mutation.expected !== undefined) definition.expected = mutation.expected;
  if (mutation.observed !== undefined) definition.observed = mutation.observed;
  if (mutation.location !== undefined) definition.location = mutation.location;
  return JSON.stringify(definition);
}

function ownSource() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity }).trim();
  return { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), bend2_tree: git('rev-parse', 'HEAD:bend2') };
}

function changedBytes(originalText, record) {
  if (record.kind === 'proof-removal') {
    const block = proofBlockRange(originalText, record.law);
    const lines = originalText.split('\n');
    lines.splice(block.start, block.end - block.start);
    return lines.join('\n');
  }
  const definition = FIXTURE_DEFINITIONS.find((mutation) => `mutation:${mutation.name}` === record.id);
  return originalText.replace(definition.find, definition.replace);
}

function refusalStderr(law) {
  return [
    'Error:',
    `- expected : ${FIXTURE_MUTATION.expected}`,
    `- observed : ${FIXTURE_MUTATION.observed}`,
    `Location: ${FIXTURE_MUTATION.location}`,
    '9 | def admitted() -> Gate:',
    '10>|   Gate{False{}}',
    '11 |',
    '',
  ].join('\n');
}

const TIME_SUFFIX = '       12.34 real         5.67 user         1.23 sys\n'
  + '             123456 maximum resident set size\n'
  + '               789 page reclaims\n'
  + '              1234 page faults\n';

const COMPILER = { path: '/qualified/bend', version: 'bend 2.0.25', sha256: 'a'.repeat(64) };
const ARCHIVE_SHA = 'b'.repeat(64);
const RUNTIME_SHA = 'c'.repeat(64);

function streamOf(bundle, name, text) {
  writeFileSync(join(bundle, name), text);
  return { path: name, bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

function writeBundle(dir, records, module) {
  const bundle = join(dir, module.replaceAll('/', '_'));
  mkdirSync(bundle, { recursive: true });
  const nonce = 'n0';
  const results = records.map((record, index) => {
    const originalText = readFileSync(join(FIXTURE_BEND2, record.module.slice('bend2/'.length)), 'utf8');
    const changed = changedBytes(originalText, record);
    const stem = record.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    const stderrText = record.kind === 'proof-removal' ? TODO_REFUSAL + '\n' : refusalStderr(record.law);
    writeFileSync(join(bundle, `${stem}.changed`), changed);
    return {
      case: record,
      setup: 'applied',
      expectation: record.expectation ?? null,
      delta: { original_sha256: sha256(originalText), changed_sha256: sha256(changed), changed_path: `${stem}.changed` },
      process: {
        state: 'exited', exit_code: 1, signal: null, spawn_error: null,
        started: 100 + index, ended: 101 + index, attempt: `${record.id}-${nonce}-${index}`, wrapper_pid: 4000 + index,
      },
      diagnostic: { class: 'intended-law-refusal', attributed_law: record.law, sha256: sha256(stderrText) },
      stdout: streamOf(bundle, `${stem}.stdout`, ''),
      stderr: streamOf(bundle, `${stem}.stderr`, stderrText + TIME_SUFFIX),
      resource: {
        profile: 'darwin-usr-bin-time', real_seconds: 12.34, user_seconds: 5.67, sys_seconds: 1.23,
        max_rss_bytes: 123456, max_rss_source_unit: 'bytes', page_reclaims: 789,
      },
    };
  });
  const manifest = {
    module,
    binding: bindingOf(records),
    entry: 'bend2/src/main.bend',
    checker_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'))),
    source: ownSource(),
    origin: { workflow: null, run_id: null, run_attempt: null, jobs: [], image_os: null, image_version: null },
    producing: {
      source: ownSource(),
      compiler: COMPILER,
      checker_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'))),
      archive: { path: '/qualified/archive.tar.gz', bytes: 1, sha256: ARCHIVE_SHA },
      runtime: { directory: '/qualified/bend2', files: 1, sha256: RUNTIME_SHA },
      runtime_set_sha256: RUNTIME_SHA,
      origin: {
        workflow: null, run_id: null, run_attempt: null, jobs: [], image_os: null, image_version: null,
        job: `local:0:${module}:${nonce}`,
      },
    },
    instrument: { tool: '/usr/bin/time', flag: '-l' },
    baseline: {
      argv: [COMPILER.path, 'bend2/src/main.bend', '--check-only'],
      process: {
        state: 'exited', exit_code: 0, signal: null, spawn_error: null,
        started: 10, ended: 20, attempt: `${module}-baseline-${nonce}`, wrapper_pid: 3999,
      },
      stdout: streamOf(bundle, 'baseline.stdout', 'baseline output\n'),
      stderr: streamOf(bundle, 'baseline.stderr', TIME_SUFFIX),
      inputs: {
        compiler_sha256: COMPILER.sha256,
        checker_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'))),
        archive_sha256: ARCHIVE_SHA,
        runtime_set_sha256: RUNTIME_SHA,
      },
    },
    results,
    compiler: COMPILER,
  };
  writeFileSync(join(bundle, 'group-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { bundle, manifest };
}

const readManifest = (bundle) => JSON.parse(readFileSync(join(bundle, 'group-manifest.json'), 'utf8'));
const writeBack = (bundle, manifest) => writeFileSync(join(bundle, 'group-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Each variant runs in a fresh directory; a failed variant keeps its
// directory for diagnosis, and cleanup happens only on success.
function scenario(run) {
  const dir = mkdtempSync(join(tmpdir(), 'capacity-controls-aggregate-'));
  try {
    const outcome = run(dir);
    rmSync(dir, { recursive: true, force: true });
    return outcome;
  } catch (error) {
    console.error(`scenario evidence retained at ${dir}`);
    throw error;
  }
}

const fixtureProof = () => fixtureRecords().find((record) => record.id === 'proof:mini_admitted_gate_is_open');
const fixtureMutation = () => fixtureRecords().find((record) => record.kind === 'mutation');
const kinds = (summary) => new Set(summary.rejections.map((r) => r.kind));
const FIXTURE_SCOPE = { definitions: FIXTURE_DEFINITIONS, moduleRoot: FIXTURE_BEND2 };

test('the complete fixture work set aggregates acceptably across both groups', () => {
  scenario((dir) => {
    const records = fixtureRecords();
    for (const moduleName of ['bend2/src/mini.bend', 'bend2/src/main.bend']) {
      writeBundle(dir, records.filter((record) => record.module === moduleName), moduleName);
    }
    const { summary } = aggregate({ dir, records, ...FIXTURE_SCOPE });
    assert.deepEqual(summary.rejections, []);
    assert.equal(accepted(summary), true);
    assert.equal(summary.distinct_cases, records.length);
    assert.equal(summary.groups, 2);
  });
});

test('altered stream bytes reject as stream-mismatch', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle } = writeBundle(dir, [proof], proof.module);
    const path = join(bundle, `${proof.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.stderr`);
    const bytes = Buffer.from(readFileSync(path, 'utf8'));
    bytes[0] = bytes[0] ^ 0x20;
    writeFileSync(path, bytes);
    const summary = aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary;
    assert.ok(kinds(summary).has('stream-mismatch'));
    assert.equal(accepted(summary), false);
  });
});

test('a coherent lying label over digest-correct unrelated diagnostics rejects', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    const unrelated = 'Error: unrelated compiler infrastructure failure\n';
    writeFileSync(join(bundle, `${stem}.stderr`), unrelated);
    manifest.results[0].stderr = { path: `${stem}.stderr`, bytes: Buffer.byteLength(unrelated), sha256: sha256(unrelated) };
    manifest.results[0].diagnostic.sha256 = sha256(unrelated);
    writeBack(bundle, manifest);
    const summary = aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary;
    assert.ok(kinds(summary).has('diagnostic-mismatch'));
  });
});

test('a misreported label over intact refusal bytes rejects', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].diagnostic.class = 'unclassified-rejection';
    writeBack(bundle, manifest);
    const summary = aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary;
    assert.ok(kinds(summary).has('misreported-diagnostic'));
  });
});

test('wrong delta bytes reject as delta-mismatch', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    const originalText = readFileSync(join(FIXTURE_BEND2, proof.module.slice('bend2/'.length)), 'utf8');
    const wrong = originalText.replace('law ', 'lawx ');
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    writeFileSync(join(bundle, `${stem}.changed`), wrong);
    manifest.results[0].delta.changed_sha256 = sha256(wrong);
    writeBack(bundle, manifest);
    const summary = aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary;
    assert.ok(kinds(summary).has('delta-mismatch') || kinds(summary).has('delta-shape-mismatch'));
  });
});

test('missing, unexpected, unapplied and unfinished cases reject by kind', () => {
  scenario((dir) => {
    const records = fixtureRecords();
    const proof = fixtureProof();
    writeBundle(dir, [proof], proof.module);
    const partial = aggregate({ dir, records, ...FIXTURE_SCOPE }).summary;
    assert.ok(kinds(partial).has('missing-case'));
    assert.equal(accepted(partial), false);
  });
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].case = { ...manifest.results[0].case, id: 'mutation:not-in-set' };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('unexpected-case'));
  });
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].setup = 'missing';
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('unapplied-case'));
  });
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].process = { ...manifest.results[0].process, state: 'not-run', exit_code: null };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('unfinished-case'));
  });
});

test('reversed and early-started intervals reject', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].process = { ...manifest.results[0].process, started: 5, ended: 4 };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('unfinished-case'));
  });
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].process = { ...manifest.results[0].process, started: 15 };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('interval-before-baseline'));
  });
});

test('stream paths cannot escape the bundle directory', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    manifest.results[0].stderr = { ...manifest.results[0].stderr, path: `../${stem}.stderr` };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('stream-mismatch'));
  });
});

test('baseline command and input bindings reject mismatches', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.baseline.argv = ['/other/program', '--version'];
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('baseline-argv-mismatch'));
  });
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.baseline.inputs = { ...manifest.baseline.inputs, compiler_sha256: 'f'.repeat(64) };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('baseline-inputs-mismatch'));
  });
});

test('duplicate producing origin jobs across groups reject', () => {
  scenario((dir) => {
    const records = fixtureRecords();
    const first = records.find((record) => record.module === 'bend2/src/mini.bend');
    const second = records.find((record) => record.module === 'bend2/src/main.bend');
    const a = writeBundle(dir, [first], first.module);
    const b = writeBundle(dir, [second], second.module);
    const merged = readManifest(b.bundle);
    merged.producing.origin.job = readManifest(a.bundle).producing.origin.job;
    writeBack(b.bundle, merged);
    const summary = aggregate({ dir, records, ...FIXTURE_SCOPE }).summary;
    assert.ok(kinds(summary).has('producing-job-duplicate'));
  });
});

test('bundle source must match the selected checkout', () => {
  scenario((dir) => {
    const proof = fixtureProof();
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.source = { ...manifest.source, head: '0'.repeat(40) };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof], ...FIXTURE_SCOPE }).summary).has('source-checkout-mismatch'));
  });
});

test('empty discovery and empty evidence can never satisfy acceptance', () => {
  scenario((dir) => {
    const empty = aggregate({ dir, records: [] });
    assert.ok(kinds(empty.summary).has('empty-work-set'));
    assert.equal(accepted(empty.summary), false);
    const none = aggregate({ dir, records: fixtureRecords(), ...FIXTURE_SCOPE });
    assert.equal(accepted(none.summary), false);
  });
});

// The endpoint binds against this checkout's real discovery, so its requests
// use a real proof record and the checkout's own module bytes.
function discoveryProofRecord() {
  const records = discoveryRecords();
  return records.find((entry) => entry.kind === 'proof-removal' && entry.module === 'bend2/src/coordinator/usage.bend')
    ?? records.find((entry) => entry.kind === 'proof-removal');
}

function buildEndpointRequest(bundleDir, record) {
  const originalText = readFileSync(join(ROOT, 'bend2', record.module.slice('bend2/'.length)), 'utf8');
  const block = proofBlockRange(originalText, record.law);
  const lines = originalText.split('\n');
  lines.splice(block.start, block.end - block.start);
  const changed = lines.join('\n');
  const stderrText = TODO_REFUSAL + '\n';
  writeFileSync(join(bundleDir, 'case.stdout'), '');
  writeFileSync(join(bundleDir, 'case.stderr'), stderrText + TIME_SUFFIX);
  writeFileSync(join(bundleDir, 'baseline.stdout'), 'baseline\n');
  writeFileSync(join(bundleDir, 'baseline.stderr'), TIME_SUFFIX);
  writeFileSync(join(bundleDir, 'case.changed'), changed);
  return {
    case: record,
    outcome: { state: 'exited', exit_code: 1, signal: null, spawn_error: null },
    streams: {
      stdout: { path: join(bundleDir, 'case.stdout'), bytes: 0, sha256: sha256('') },
      stderr: { path: join(bundleDir, 'case.stderr'), bytes: Buffer.byteLength(stderrText + TIME_SUFFIX), sha256: sha256(stderrText + TIME_SUFFIX) },
    },
    baseline: {
      outcome: { state: 'exited', exit_code: 0, signal: null, spawn_error: null },
      streams: {
        stdout: { path: join(bundleDir, 'baseline.stdout'), bytes: Buffer.byteLength('baseline\n'), sha256: sha256('baseline\n') },
        stderr: { path: join(bundleDir, 'baseline.stderr'), bytes: Buffer.byteLength(TIME_SUFFIX), sha256: sha256(TIME_SUFFIX) },
      },
    },
    evidence_root: bundleDir,
    source: ownSource(),
    toolchain: { compiler_sha256: 'a'.repeat(64) },
    delta: {
      changed_path: 'case.changed',
      original_sha256: sha256(originalText),
      changed_sha256: sha256(changed),
    },
  };
}

function runEndpoint(request) {
  return spawnSync(process.execPath, [join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'), '--classify'], {
    input: JSON.stringify(request), encoding: 'utf8', maxBuffer: Infinity,
    env: { ...process.env, BEND: join(ROOT, '.scratch', 'capacity-controls-absent-bend') },
  });
}

test('the endpoint answers a complete qualified request with one verdict', () => {
  scenario((dir) => {
    const record = discoveryProofRecord();
    const request = buildEndpointRequest(dir, record);
    const run = runEndpoint(request);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
    const lines = run.stdout.split('\n').filter((line) => line !== '');
    assert.equal(lines.length, 1, 'the endpoint must answer exactly one verdict line');
    const verdict = JSON.parse(lines[0]);
    assert.equal(verdict.class, 'intended-law-refusal');
    assert.equal(verdict.attributed_law, record.law);
    assert.equal(verdict.match, true);
    assert.equal(verdict.qualified, true);
    assert.equal(verdict.evidence_verified, true);
    assert.equal(verdict.definition_sha256, record.definition_sha256);
    for (const field of ['checker_sha256', 'aggregate_module_sha256', 'classifier_module_sha256',
      'work_set_module_sha256', 'laws_common_module_sha256', 'definitions_module_sha256']) {
      assert.match(String(verdict.verifier[field]), /^[0-9a-f]{64}$/, `verifier ${field} must bind`);
    }
  });
});

test('the endpoint refuses unknown, malformed and prerequisite-missing requests', () => {
  scenario((dir) => {
    const record = discoveryProofRecord();
    const complete = buildEndpointRequest(dir, record);

    const unknown = runEndpoint({ ...complete, case: { ...record, id: 'proof:not_in_the_work_set' } });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /classify: case proof:not_in_the_work_set is not in the rediscovered work set/);
    assert.equal(unknown.stdout, '');

    const malformed = runEndpoint({ ...complete, outcome: { state: 'exited', exit_code: '1', signal: null, spawn_error: null } });
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /classify: request outcome is malformed for a terminal child/);

    const missingDelta = runEndpoint({ ...complete, delta: undefined });
    assert.equal(missingDelta.status, 2);
    assert.match(missingDelta.stderr, /classify: request delta is required/);

    const badDigest = runEndpoint({ ...complete, streams: { ...complete.streams, stderr: { ...complete.streams.stderr, sha256: '0'.repeat(64) } } });
    assert.equal(badDigest.status, 2);
    assert.match(badDigest.stderr, /classify: stderr stream sha256 mismatch/);

    const wrongSource = runEndpoint({ ...complete, source: { head: '0'.repeat(40), tree: complete.source.tree, bend2_tree: complete.source.bend2_tree } });
    assert.equal(wrongSource.status, 2);
    assert.match(wrongSource.stderr, /classify: request source binding differs from this checkout/);
  });
});
