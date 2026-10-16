// U1 Text.read backend parity: the Node-backend vectors.
// Spec: rewrite-native/text-read-parity-spec.md at 2036666; review:
// review-muse/text-read-parity.md at 2a48dbc. Failures assert the exact
// code and never the message (B4 opacity); successes assert the exact
// value. The shipped bend2/src/host/text-read.js source is executed
// exactly as stored, with the runtime helpers it binds to supplied
// verbatim from the compiler JS runtime (comp.ts io_tup/io_done/io_text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/host/text-read.js', import.meta.url), 'utf8');

// comp.ts:6503-6517, verbatim behavior.
const HELPERS = `
function io_tup(...xs) {
  return xs.reduceRight((snd, fst) => ({ $: "Tuple", fst, snd }));
}
function io_done(value) {
  return { $: "Done", value };
}
function io_text(b, n) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(b.subarray(0, n));
}`;


function text_read(source = SOURCE) {
  const scope = {
    io_tup: (...xs) => xs.reduceRight((snd, fst) => ({ $: 'Tuple', fst, snd })),
    io_done: (value) => ({ $: 'Done', value }),
    io_text: (b, n) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b.subarray(0, n)),
    require: createRequire(import.meta.url),
  };
  return new Function(...Object.keys(scope), `${source}\nreturn text_read;`)(
    ...Object.values(scope));
}

function code(result) {
  return result.$ === 'Fail' ? result.error.fst : null;
}

function value(result) {
  return result.$ === 'Done' ? result.value : null;
}

function fixtures(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-text-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'dir'));
  // 0x41 'A'; 0xC0 invalid lead; 0xAF orphan continuation; 0xE2 0x82 truncated.
  writeFileSync(join(root, 'utf8'), Buffer.from([0x41, 0xc0, 0xaf, 0xe2, 0x82]));
  writeFileSync(join(root, 'empty'), '');
  return root;
}

test('vector 1: missing file refuses ENOENT on the Node backend', (t) => {
  const read = text_read();
  const result = read(join(fixtures(t), 'absent'));
  assert.equal(result.$, 'Fail');
  assert.equal(code(result), 2);
});

test('vector 2: directory as path refuses EISDIR on the Node backend', (t) => {
  const read = text_read();
  const result = read(join(fixtures(t), 'dir'));
  assert.equal(result.$, 'Fail');
  assert.equal(code(result), 21);
});

test('vector 3: NUL in path refuses EINVAL before any host call', (t) => {
  const read = text_read();
  const result = read(`cases/nul\u0000`);
  assert.equal(result.$, 'Fail');
  assert.equal(code(result), 22);
});

test('vector 4: invalid UTF-8 content succeeds with WHATWG replacement', (t) => {
  const read = text_read();
  const result = read(join(fixtures(t), 'utf8'));
  assert.equal(result.$, 'Done');
  assert.equal(value(result), 'A\uFFFD\uFFFD\uFFFD');
});

test('vector 5: the dash path reads stdin bytes exactly', (t) => {
  const payload = 'caf\u00e9 \u03bb\n';
  const child = spawnSync(process.execPath, ['-e',
    `${HELPERS}${SOURCE}\nprocess.stdout.write(JSON.stringify(text_read('-')));`],
    { input: Buffer.from(payload, 'utf8') });
  assert.ifError(child.error);
  assert.equal(child.status, 0);
  const result = JSON.parse(child.stdout.toString('utf8'));
  assert.equal(result.$, 'Done');
  assert.equal(result.value, payload);
});

test('vector 6: empty file succeeds with the empty string', (t) => {
  const read = text_read();
  const result = read(join(fixtures(t), 'empty'));
  assert.equal(result.$, 'Done');
  assert.equal(value(result), '');
});

test('vector 7: unreadable file refuses EACCES when non-root', (t) => {
  if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
    t.skip('root reads a 000 file; vector 2 covers a root-proof refusal');
  }
  const root = fixtures(t);
  const locked = join(root, 'locked');
  writeFileSync(locked, 'secret');
  chmodSync(locked, 0o000);
  const read = text_read();
  const result = read(locked);
  assert.equal(result.$, 'Fail');
  assert.equal(code(result), 13);
});
