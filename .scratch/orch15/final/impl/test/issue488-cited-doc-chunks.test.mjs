// Issue #488 — a cited document longer than one context source string RIDES THE PACKAGE in ordered
// chunks, and a document a secret-shaped line keeps out is a NAMED GAP instead of a refusal of the
// recruit the issue was read for.
//
// The defect: the reading leg handed each document to the deployment's context store as ONE branch
// string, and the store's source scan answered `context_source_sensitive` for anything over the
// deployment policy's own `maxTextBytes` (16 KiB) — conflating "oversized" with "secret-shaped", so
// a 40 KB cited design doc refused the whole recruit with a code that says the document holds a
// credential. The runtime had always projected repository text through chunk branches; the reading
// leg was the one reader that did not.
//
// The rows run the CLI's OWN parser and runner in a CHILD process against the real stack (the #480
// fixture: CoordinationStore behind WebNorthbound over the deployment's own Context CAS,
// SwarmRuntime, BatonWebClient) with the issue reader injected and the cwd a subdirectory of the
// fixture checkout, so the production resolution root is what these rows exercise. The #480 driver
// carries the two #488 scenarios and reports every branch as a reader gets it back, through the
// store's own resolver.
//
// Rows:
//   488-a  a cited document of ~40 KB admits: the package carries it in ordered chunk branches of
//          at most the runtime's chunk width, each naming the revision and its place in the order,
//          and concatenating them in that order reproduces the document byte for byte;
//   488-b  a cited document with one keyed-secret line becomes a NAMED GAP ({path, state:
//          'unreadable', reason: 'sensitive', line}) while the recruit is admitted, the readable
//          document still rides, and the seat's brief names the gap;
//   488-c  the two facts answer two typed codes with their details — `context_source_oversize`
//          {bytes, bound, limit: 'maxTextBytes'} and `context_source_sensitive` {pattern, line},
//          never the matched text (unit rows on the Bench's own scan, #488 item 2);
//   488-d  a document whose chunks would overflow the package the port admits refuses typed,
//          BEFORE any effect, naming the bound — instead of the wire's shape refusal afterwards;
//   488-e  a cited document with NO bytes is a named gap too, never a silent hole.
//
// Every await a row takes is BOUNDED and NAMED (#460, docs/42 §8): the bound is the registry's own
// probe deadline and a bound miss carries `fixture_wait_unsettled`, so a hung child can never read
// as a deployment refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTEXT_PACKAGE_BRANCH_CEILING } from '../src/web-northbound.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, contextSourceChunkBytes,
} from '../src/context-program-policy.mjs';
import { normalizeContextSource } from '../src/context-program.mjs';

const DRIVER = fileURLToPath(new URL('./issue480-citation-driver.mjs', import.meta.url));
const WAIT_BOUND_MS = FRAME_LIMITS['route.probe_deadline_ms'].value;
const WAIT_UNSETTLED = 'fixture_wait_unsettled';
const CHUNK_BYTES = contextSourceChunkBytes(DEFAULT_CONTEXT_PROGRAM_POLICY);

// The two documents the fixture's issue cites: the long one the leg must chunk, and the one whose
// fifth line carries a keyed secret. Their markers are what a row asserts the seat read.
const CHUNKED_DOC = 'docs/488-cited-chunks.md';
const SENSITIVE_DOC = 'docs/488-keyed-secret.md';
const LONG_MARK = 'MARK-488-LONG-CITED-DOC';
const SENSITIVE_MARK = 'MARK-488-KEYED-SECRET-DOC';
const SENSITIVE_LINE = 5;
const LONG_DOC_LINES = 520;
// The one document that cannot fit a package: its chunks alone (at the runtime's chunk width) are
// more than the port admits, so the leg must refuse before it hands anything over.
const OVERFLOW_DOC = 'docs/488-overflow.md';
const OVERFLOW_BYTES = 800 * 1024;
const EMPTY_DOC = 'docs/488-empty.md';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue488-${label}-`));
  roots.push(root);
  return root;
}

/** The long document: ~40 KB of plain markdown, no secret shape anywhere, one line per entry so a
 * chunk boundary is a line boundary the row can see. */
function longDocText() {
  const lines = [`# ${LONG_MARK}`, ''];
  for (let index = 0; index < LONG_DOC_LINES; index += 1) {
    lines.push(`${String(index).padStart(4, '0')} ${'x'.repeat(60)} MARK-488-LINE-${index}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** The document a real secret shape keeps out: everything but the keyed line is ordinary prose. */
function sensitiveDocText() {
  return [
    `# ${SENSITIVE_MARK}`,
    '',
    'The deployment note follows.',
    '',
    'api_key = "AKIAIOSFODNN7EXAMPLE1"',
    '',
    'and the rest of this note reads fine.',
    '',
  ].join('\n');
}

/** A document too large to ride any package: one line per ~80 bytes, all of them ordinary. */
function overflowDocText() {
  const lines = ['# MARK-488-OVERFLOW-DOC', ''];
  let bytes = 0;
  for (let index = 0; bytes < OVERFLOW_BYTES; index += 1) {
    const line = `${String(index).padStart(6, '0')} ${'y'.repeat(68)}`;
    lines.push(line);
    bytes += Buffer.byteLength(line, 'utf8') + 1;
  }
  return lines.join('\n');
}

/** One fixture checkout of the served repository: the root resolves at this directory because the
 * derivation reads git METADATA only (a bare `.git` is a checkout whose root is exactly here). */
function checkout() {
  const root = scratch('checkout');
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(join(root, 'impl'), { recursive: true });
  return root;
}

function writeDoc(root, relativePath, text) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
  return Buffer.from(text, 'utf8');
}

/** One CLI child: the #480 driver runs the real parser and runner with the cwd this row chose and
 * answers one JSON report. The wait is bounded and a bound miss is named, never swallowed. */
function recruit(cwd, { scenario = 'chunks', docs = [] } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      DRIVER, '--scenario', scenario, ...docs.flatMap((doc) => ['--doc', doc]),
    ], {
      cwd, timeout: WAIT_BOUND_MS, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error !== null && error !== undefined) {
        if (error.killed === true || error.signal !== null) {
          reject(Object.assign(
            new Error(`${WAIT_UNSETTLED}: the CLI child from ${cwd} never settled within ${WAIT_BOUND_MS}ms`),
            { code: WAIT_UNSETTLED },
          ));
          return;
        }
        reject(new Error(`the issue488 driver failed under ${cwd}: ${error.message}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch {
        reject(new Error(`the issue488 driver answered no report under ${cwd}: ${stdout}\n${stderr}`));
      }
    });
  });
}

/** The branches one document rode as, in CHUNK ORDER, with the revision they all name. */
function chunksOf(report, path) {
  const prefix = `doc:${path.replaceAll('/', '.').replace(/[^A-Za-z0-9._-]/gu, '-')}:`;
  const rows = report.branches
    .filter((branch) => branch.name.startsWith(prefix))
    .map((branch) => {
      const match = new RegExp(`^${prefix.replaceAll('.', '\\.')}([a-f0-9]{64}):(\\d{4})-(\\d{4})$`, 'u')
        .exec(branch.name);
      return match === null ? null : { ...branch, sha: match[1], index: Number(match[2]), of: Number(match[3]) };
    });
  assert.equal(rows.every((row) => row !== null), true,
    `every branch of ${path} names its revision, chunk and count (${report.branchNames.join(', ')})`);
  return rows.sort((left, right) => left.index - right.index);
}

// ── 488-a: a cited document longer than one source string rides the package in ordered chunks ────

test('488-a: a ~40 KB cited doc rides the package in ordered chunks and reads back byte-exact', async () => {
  const repoRoot = checkout();
  const bytes = writeDoc(repoRoot, CHUNKED_DOC, longDocText());
  writeDoc(repoRoot, SENSITIVE_DOC, sensitiveDocText());
  assert.ok(bytes.length > 40 * 1024, `the cited document really is over 40 KB (${bytes.length})`);

  const report = await recruit(join(repoRoot, 'impl'));
  assert.equal(report.refusal, null, `the recruit is admitted: ${JSON.stringify(report.refusal)}`);
  assert.equal(report.seatJoined, true, 'the seat joined');
  assert.equal(report.admittedPackages, 1, 'exactly ONE package was admitted');
  assert.equal(report.attached, 1, 'the package is attached to the seat run');
  assert.ok(report.branchNames.includes('issue:480'), 'the package carries the issue branch');

  const chunks = chunksOf(report, CHUNKED_DOC);
  assert.ok(chunks.length > 1,
    `a document longer than one source string is CHUNKED, never one branch (${report.branchNames.join(', ')})`);
  assert.equal(new Set(chunks.map((row) => row.sha)).size, 1,
    'every chunk names the ONE revision the document was read at');
  assert.equal(chunks.length, chunks[0].of, 'the chunk count is the one every chunk names');
  assert.deepEqual(chunks.map((row) => row.index),
    chunks.map((_row, index) => index), 'the chunks are numbered 0..of-1 with no hole');
  for (const row of chunks) {
    assert.ok(row.bytes !== null && row.bytes <= CHUNK_BYTES,
      `chunk ${row.name} is at most the runtime's chunk width (${row.bytes} <= ${CHUNK_BYTES})`);
    assert.ok(row.text !== null, `chunk ${row.name} resolves through the store's own reader`);
  }

  const reassembled = Buffer.from(chunks.map((row) => row.text).join(''), 'utf8');
  assert.equal(reassembled.compare(bytes), 0,
    'concatenating the chunks in order reproduces the cited document byte for byte');
  assert.ok(report.brief.includes(LONG_MARK),
    'the seat reads the cited document\'s own head through the brief');
});

// ── 488-b: a secret-shaped line makes a document a NAMED GAP, never a refused recruit ────────────

test('488-b: a cited doc a keyed-secret line keeps out is a named gap, and the recruit is admitted', async () => {
  const repoRoot = checkout();
  const longBytes = writeDoc(repoRoot, CHUNKED_DOC, longDocText());
  writeDoc(repoRoot, SENSITIVE_DOC, sensitiveDocText());

  const report = await recruit(join(repoRoot, 'impl'));
  assert.equal(report.refusal, null, `the recruit is admitted: ${JSON.stringify(report.refusal)}`);
  assert.equal(report.seatJoined, true, 'the seat joined');
  assert.equal(report.admittedPackages, 1, 'the package is admitted with the members it could read');
  assert.equal(report.attached, 1, 'the package is attached to the seat run');
  assert.deepEqual(report.receipt?.docs, [
    { path: SENSITIVE_DOC, state: 'unreadable', reason: 'sensitive', line: SENSITIVE_LINE },
  ], 'the receipt names the withheld document, why, and the line the shape sits on');

  assert.equal(
    report.branchNames.some((name) => name.includes('488-keyed-secret')), false,
    'a document that must not ride has no branch',
  );
  const chunks = chunksOf(report, CHUNKED_DOC);
  assert.ok(chunks.length > 1, 'the readable citation still rides the package, chunked');
  assert.equal(Buffer.from(chunks.map((row) => row.text).join(''), 'utf8').compare(longBytes), 0,
    'the readable document is unharmed by the gap beside it');

  assert.ok(report.brief.includes('Unreadable citations:'),
    'the brief names the gap the leg read about');
  assert.ok(report.brief.includes(SENSITIVE_DOC), 'the brief names the document the seat did not get');
  assert.ok(report.brief.includes('"reason":"sensitive"'),
    'the brief says WHY it was withheld — the same row shape an absent citation gets');
  assert.ok(report.brief.includes(`"line":${SENSITIVE_LINE}`),
    'the brief names the line the shape sits on');
  assert.equal(report.brief.includes('AKIAIOSFODNN7EXAMPLE1'), false,
    'the brief never carries the withheld line\'s text, only where it is');
  assert.ok(report.brief.includes(LONG_MARK), 'the readable document still rides the brief');
});

// ── 488-c: the two facts answer two typed codes with their own details (#488 item 2) ────────────

test('488-c1: an oversized source string answers context_source_oversize with its measured bound', () => {
  const text = 'x'.repeat(DEFAULT_CONTEXT_PROGRAM_POLICY.maxTextBytes + 1);
  assert.throws(() => normalizeContextSource(text, DEFAULT_CONTEXT_PROGRAM_POLICY), (error) => {
    assert.equal(error.code, 'context_source_oversize', 'oversize is its own code, never sensitive');
    assert.deepEqual(error.detail, {
      bytes: Buffer.byteLength(text, 'utf8'),
      bound: DEFAULT_CONTEXT_PROGRAM_POLICY.maxTextBytes,
      limit: 'maxTextBytes',
    }, 'the refusal measures the document and names the policy field that bounded it');
    return true;
  });
  // The same text at the bound is admitted: the code judges bytes over the bound, not bytes near it.
  assert.equal(
    typeof normalizeContextSource('y'.repeat(DEFAULT_CONTEXT_PROGRAM_POLICY.maxTextBytes),
      DEFAULT_CONTEXT_PROGRAM_POLICY),
    'string',
    'a document AT the bound is admitted',
  );
});

test('488-c2: a secret-shaped source string answers context_source_sensitive naming shape and line', () => {
  const line = 'ghp_' + 'A'.repeat(24);
  const text = ['plain', 'plain', line, 'plain'].join('\n');
  assert.throws(() => normalizeContextSource(text, DEFAULT_CONTEXT_PROGRAM_POLICY), (error) => {
    assert.equal(error.code, 'context_source_sensitive', 'a secret shape is the sensitive code');
    assert.deepEqual(error.detail, { pattern: 'gh_token', line: 3 },
      'the refusal names the shape and the line, and NOTHING of the matched text');
    return true;
  });
  // Every shape in the ONE table reports its own name (the four the table holds).
  const shapes = [
    ['-----BEGIN RSA PRIVATE KEY-----', 'private_key'],
    ['api_key = "abcdefghijklmnopqrst"', 'keyed_secret'],
    ['token = sk-proj-abcdefghijklmnopqrst', 'sk_token'],
    ['ghp_' + 'B'.repeat(24), 'gh_token'],
  ];
  for (const [matched, pattern] of shapes) {
    assert.throws(() => normalizeContextSource(matched, DEFAULT_CONTEXT_PROGRAM_POLICY),
      (error) => error.code === 'context_source_sensitive' && error.detail.pattern === pattern,
      `the scan and the detail read the same table row for ${pattern}`);
  }
  assert.throws(() => normalizeContextSource('sk-proj-abcdefghijklmnopqrst\nrest', DEFAULT_CONTEXT_PROGRAM_POLICY),
    (error) => error.detail.line === 1 && !JSON.stringify(error.detail).includes('abcdefghijklmnopqrst'),
    'a first-line shape is line 1 and the matched text never travels');
});

// ── 488-d: a document too large for the package refuses typed, before any effect ──────────────────

test('488-d: a document whose chunks would overflow the package refuses typed before any effect', async () => {
  const repoRoot = checkout();
  writeDoc(repoRoot, CHUNKED_DOC, longDocText());
  writeDoc(repoRoot, SENSITIVE_DOC, sensitiveDocText());
  writeDoc(repoRoot, OVERFLOW_DOC, overflowDocText());
  const report = await recruit(join(repoRoot, 'impl'), { docs: [OVERFLOW_DOC] });

  // The issue cites the chunked pair and this row names the overflowing document as well: the leg
  // reads every member, then refuses rather than hand the port a package it would answer as a
  // malformed request — the operator's own bound, refused BEFORE any effect.
  assert.equal(report.receipt, null, 'nothing was admitted');
  assert.equal(report.seatJoined, false, 'no seat joined');
  assert.equal(report.admittedPackages, 0, 'no package was admitted');
  assert.equal(report.refusal?.code, 'context_source_oversize', 'the refusal is the oversize code');
  assert.equal(report.refusal?.detail?.path, OVERFLOW_DOC, 'the refusal names the document');
  assert.equal(report.refusal?.detail?.bound, CONTEXT_PACKAGE_BRANCH_CEILING,
    'the refusal measures against the branch ceiling the port admits');
  assert.equal(report.refusal?.detail?.limit, 'branches',
    'the refusal names the bound it hit, not the byte bound it did not');
  assert.equal(report.refusal?.detail?.rule, 'the document exceeds the context package branch ceiling',
    'the reading leg\'s own closed rule text explains it');
  assert.match(report.refusal.message, /recruit without --issue/u,
    'the remedy names the reading leg the operator can drop');
});

// ── 488-e: a document with no bytes is a named gap, never a silent hole ──────────────────────────

test('488-e: an empty cited document is a named gap, never a silent hole', async () => {
  const repoRoot = checkout();
  writeDoc(repoRoot, CHUNKED_DOC, longDocText());
  writeDoc(repoRoot, SENSITIVE_DOC, sensitiveDocText());
  writeDoc(repoRoot, EMPTY_DOC, '');
  const report = await recruit(join(repoRoot, 'impl'), { docs: [EMPTY_DOC] });

  // An empty document has nothing to hand over and the port refuses an empty branch document as a
  // malformed request, so the leg must name it: a seat that reads no branch AND no gap would read
  // a silent hole as a complete package.
  assert.equal(report.refusal, null, `the recruit is admitted: ${JSON.stringify(report.refusal)}`);
  assert.equal(report.seatJoined, true, 'the seat joined');
  assert.deepEqual(report.receipt?.docs, [
    { path: EMPTY_DOC, state: 'unreadable', reason: 'empty' },
    { path: SENSITIVE_DOC, state: 'unreadable', reason: 'sensitive', line: SENSITIVE_LINE },
  ], 'both withheld documents are named, in citation order');
  assert.equal(
    report.branchNames.some((name) => name.includes('488-empty')), false,
    'a document with no bytes has no branch',
  );
  assert.ok(report.brief.includes(EMPTY_DOC), 'the brief names the empty document too');
  assert.ok(chunksOf(report, CHUNKED_DOC).length > 1, 'the readable document still rides chunked');
});
