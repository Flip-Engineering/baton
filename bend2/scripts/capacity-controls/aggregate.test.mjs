// Aggregate acceptance tests over synthetic-but-valid bundles built from real
// discovery records and the retained diagnostic fixtures. No compiler runs:
// streams and deltas are authored bytes, every variant runs in its own fresh
// directory, and each fault asserts its exact rejection kind.

import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MUTATIONS } from '../laws-mutations.mjs';
import { proofBlockRange, ROOT } from '../laws-check.mjs';
import { TODO_REFUSAL } from './classify.mjs';
import { accepted, aggregate } from './aggregate.mjs';
import { bindingOf, discoveryRecords, sha256Hex } from './work-set.mjs';

const sha256 = (text) => sha256Hex(Buffer.from(text, 'utf8'));

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
  const definition = MUTATIONS.find((mutation) => `mutation:${mutation.name}` === record.id);
  return originalText.replace(definition.find, definition.replace);
}

function mutantStderr(law) {
  return [
    'Error:',
    '- expected : commands.Invalid{}',
    '- observed : commands.Help{}',
    `Location: commands.${law}`,
    '395 | def proof():',
    '396>|   {==}',
    '397 |',
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

// One valid bundle for the selected records: baseline plus each case with
// retained streams, exact deltas and intended refusals.
function writeBundle(dir, records, module) {
  const bundle = join(dir, module.replaceAll('/', '_'));
  mkdirSync(bundle, { recursive: true });
  const nonce = 'n0';
  const results = records.map((record, index) => {
    const originalText = readFileSync(join(ROOT, record.module), 'utf8');
    const changed = changedBytes(originalText, record);
    const stem = record.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    const stderrText = record.kind === 'proof-removal' ? TODO_REFUSAL + '\n' : mutantStderr(record.law);
    writeFileSync(join(bundle, `${stem}.changed`), changed);
    return {
      case: record,
      setup: 'applied',
      expectation: null,
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
    binding: bindingOf(discoveryRecords()),
    entry: 'bend2/src/coordinator/main.bend',
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
      argv: [COMPILER.path, 'bend2/src/coordinator/main.bend', '--check-only'],
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

// Each variant runs in a fresh directory; the runner cleans up.
function scenario(run) {
  const dir = mkdtempSync(join(tmpdir(), 'capacity-controls-aggregate-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pick = (kind) => discoveryRecords().find((record) => record.kind === kind);
const kinds = (summary) => new Set(summary.rejections.map((r) => r.kind));

test('a complete valid bundle set is accepted', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const mutation = pick('mutation');
    writeBundle(dir, [proof], proof.module);
    writeBundle(dir, [mutation], mutation.module);
    const { summary } = aggregate({ dir, records: [proof, mutation] });
    assert.deepEqual(summary.rejections, []);
    assert.equal(accepted(summary), true);
    assert.equal(summary.distinct_cases, 2);
  });
});

test('altered stream bytes reject as stream-mismatch', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle } = writeBundle(dir, [proof], proof.module);
    const path = join(bundle, `${proof.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.stderr`);
    const bytes = Buffer.from(readFileSync(path, 'utf8'));
    bytes[0] = bytes[0] ^ 0x20;
    writeFileSync(path, bytes);
    const summary = aggregate({ dir, records: [proof] }).summary;
    assert.ok(kinds(summary).has('stream-mismatch'));
    assert.equal(accepted(summary), false);
  });
});

test('a coherent lying label over digest-correct unrelated diagnostics rejects', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    const unrelated = 'Error: unrelated compiler infrastructure failure\n';
    writeFileSync(join(bundle, `${stem}.stderr`), unrelated);
    manifest.results[0].stderr = { path: `${stem}.stderr`, bytes: Buffer.byteLength(unrelated), sha256: sha256(unrelated) };
    manifest.results[0].diagnostic.sha256 = sha256(unrelated);
    writeBack(bundle, manifest);
    const summary = aggregate({ dir, records: [proof] }).summary;
    assert.ok(kinds(summary).has('diagnostic-mismatch'));
  });
});

test('a misreported label over intact refusal bytes rejects', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].diagnostic.class = 'unclassified-rejection';
    writeBack(bundle, manifest);
    const summary = aggregate({ dir, records: [proof] }).summary;
    assert.ok(kinds(summary).has('misreported-diagnostic'));
  });
});

test('wrong delta bytes reject as delta-mismatch', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    const originalText = readFileSync(join(ROOT, proof.module), 'utf8');
    const wrong = originalText.replace('law ', 'lawx ');
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    writeFileSync(join(bundle, `${stem}.changed`), wrong);
    manifest.results[0].delta.changed_sha256 = sha256(wrong);
    writeBack(bundle, manifest);
    const summary = aggregate({ dir, records: [proof] }).summary;
    assert.ok(kinds(summary).has('delta-mismatch') || kinds(summary).has('delta-shape-mismatch'));
  });
});

test('missing, unexpected, unapplied and unfinished cases reject by kind', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const mutation = pick('mutation');
    writeBundle(dir, [proof], proof.module);
    const partial = aggregate({ dir, records: [proof, mutation] }).summary;
    assert.ok(kinds(partial).has('missing-case'));
    assert.equal(accepted(partial), false);
  });
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].case = { ...manifest.results[0].case, id: 'mutation:not-in-set' };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('unexpected-case'));
  });
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].setup = 'missing';
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('unapplied-case'));
  });
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].process = { ...manifest.results[0].process, state: 'not-run', exit_code: null };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('unfinished-case'));
  });
});

test('reversed and early-started intervals reject', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].process = { ...manifest.results[0].process, started: 5, ended: 4 };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('unfinished-case'));
  });
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.results[0].process = { ...manifest.results[0].process, started: 15 };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('interval-before-baseline'));
  });
});

test('stream paths cannot escape the bundle directory', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    manifest.results[0].stderr = { ...manifest.results[0].stderr, path: `../${stem}.stderr` };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('stream-mismatch'));
  });
});

test('baseline command and input bindings reject mismatches', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.baseline.argv = ['/other/program', '--version'];
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('baseline-argv-mismatch'));
  });
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.baseline.inputs = { ...manifest.baseline.inputs, compiler_sha256: 'f'.repeat(64) };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('baseline-inputs-mismatch'));
  });
});

test('duplicate producing origin jobs across bundles reject', () => {
  scenario((dir) => {
    const records = discoveryRecords().filter((record) => record.kind === 'proof-removal');
    assert.ok(records.length >= 2, 'the work set must hold at least two proof records for this variant');
    const [first, second] = records;
    const a = writeBundle(dir, [first], first.module);
    const b = writeBundle(dir, [second], second.module);
    const merged = readManifest(b.bundle);
    merged.producing.origin.job = readManifest(a.bundle).producing.origin.job;
    writeBack(b.bundle, merged);
    const summary = aggregate({ dir, records }).summary;
    assert.ok(kinds(summary).has('producing-job-duplicate'));
  });
});

test('bundle source must match the selected checkout', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle, manifest } = writeBundle(dir, [proof], proof.module);
    manifest.source = { ...manifest.source, head: '0'.repeat(40) };
    writeBack(bundle, manifest);
    assert.ok(kinds(aggregate({ dir, records: [proof] }).summary).has('source-checkout-mismatch'));
  });
});

test('empty discovery and empty evidence can never satisfy acceptance', () => {
  scenario((dir) => {
    const empty = aggregate({ dir, records: [] });
    assert.ok(kinds(empty.summary).has('empty-work-set'));
    assert.equal(accepted(empty.summary), false);
    const none = aggregate({ dir, records: discoveryRecords() });
    assert.equal(accepted(none.summary), false);
  });
});

test('the per-case classify endpoint answers one structured verdict and refuses unknown cases', () => {
  scenario((dir) => {
    const proof = pick('proof-removal');
    const { bundle } = writeBundle(dir, [proof], proof.module);
    const stem = proof.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    const request = {
      case: proof,
      outcome: { state: 'exited', exit_code: 1, signal: null, spawn_error: null },
      stdout: join(bundle, `${stem}.stdout`),
      stderr: join(bundle, `${stem}.stderr`),
      baseline: {
        outcome: { state: 'exited', exit_code: 0, signal: null, spawn_error: null },
        stdout: join(bundle, 'baseline.stdout'),
        stderr: join(bundle, 'baseline.stderr'),
      },
    };
    const run = spawnSync(process.execPath, [join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'), '--classify'], {
      input: JSON.stringify(request), encoding: 'utf8', maxBuffer: Infinity,
      env: { ...process.env, BEND: join(dir, 'absent-bend') },
    });
    assert.equal(run.status, 0, run.stderr);
    const verdict = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(verdict.class, 'intended-law-refusal');
    assert.equal(verdict.attributed_law, proof.law);
    assert.equal(verdict.match, true);
    assert.equal(verdict.baseline.ok, true);

    // A coherent lying label over unrelated raw bytes classifies, and does
    // not match: the verdict is produced, the refusal is not accepted.
    const lying = {
      ...request,
      supplied: { class: 'intended-law-refusal', attributed_law: proof.law },
    };
    const unrelated = 'Error: unrelated compiler infrastructure failure\n';
    writeFileSync(join(bundle, `${stem}.stderr`), unrelated);
    const lyingRun = spawnSync(process.execPath, [join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'), '--classify'], {
      input: JSON.stringify(lying), encoding: 'utf8', maxBuffer: Infinity,
      env: { ...process.env, BEND: join(dir, 'absent-bend') },
    });
    assert.equal(lyingRun.status, 0);
    const lyingVerdict = JSON.parse(lyingRun.stdout.trim().split('\n').pop());
    assert.equal(lyingVerdict.class, 'unclassified-rejection');
    assert.equal(lyingVerdict.match, false);
    assert.equal(lyingVerdict.supplied_agrees, false);

    // Unknown case identity is a refusal with exit 2 and a stderr reason.
    const unknown = spawnSync(process.execPath, [join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'), '--classify'], {
      input: JSON.stringify({ ...request, case: { ...proof, id: 'proof:not_in_the_work_set' } }),
      encoding: 'utf8', maxBuffer: Infinity,
      env: { ...process.env, BEND: join(dir, 'absent-bend') },
    });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /classify: case proof:not_in_the_work_set is not in the rediscovered work set/);
    assert.equal(unknown.stdout, '');

    // Malformed request JSON refuses with exit 2.
    const malformed = spawnSync(process.execPath, [join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'), '--classify'], {
      input: '{not json', encoding: 'utf8', maxBuffer: Infinity,
      env: { ...process.env, BEND: join(dir, 'absent-bend') },
    });
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /classify: request is not JSON/);
  });
});
