import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const selfDir = dirname(fileURLToPath(import.meta.url));
const oracleUrl = pathToFileURL(join(selfDir, '../src/supply-chain-oracle.mjs')).href;

function writeChild(t, lines) {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-lc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'child.mjs');
  writeFileSync(path, [`process.env.TMPDIR = ${JSON.stringify(dir)};`, ...lines].join('\n'));
  return path;
}

// A fetch that only resolves when its signal fires — no other handles keep the event loop alive.
// If the deadline timer is unreffed, the process exits before the timer fires and stdout is empty.
// After the fix (timer is ref'd), the timer fires, the signal aborts, and the promise settles.
const hangingFetchLines = [
  `const hangingFetch = (_url, init) => new Promise((_resolve, reject) => {`,
  `  if (init.signal.aborted) reject(new Error('aborted'));`,
  `  else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });`,
  `});`,
];

test('_json deadline timer fires and settles the promise before process exit', async (t) => {
  const childPath = writeChild(t, [
    `import { PublicSupplyChainOracle } from '${oracleUrl}';`,
    `import { mkdtempSync } from 'node:fs';`,
    `import { tmpdir } from 'node:os';`,
    `import { join } from 'node:path';`,
    ...hangingFetchLines,
    `const oracle = new PublicSupplyChainOracle({`,
    `  fetch: hangingFetch,`,
    `  artifactRoot: mkdtempSync(join(tmpdir(), 'oracle-lc-')),`,
    `  timeoutMs: 80,`,
    `  maxResponseBytes: 1024,`,
    `  maxAdvisories: 4,`,
    `});`,
    `try {`,
    `  await oracle.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' });`,
    `  process.stdout.write('no_error' + String.fromCharCode(10));`,
    `} catch (error) {`,
    `  process.stdout.write((error?.code ?? 'unknown') + String.fromCharCode(10));`,
    `}`,
  ]);
  // If the timer were unreffed the event loop would drain immediately and stdout would be empty.
  const { stdout } = await execFileAsync(process.execPath, [childPath], { timeout: 5000 });
  assert.equal(stdout.trim(), 'oracle_timeout', '_json deadline must fire and settle the promise');
});

test('scan wall deadline timer fires and settles the promise before process exit', async (t) => {
  const childPath = writeChild(t, [
    `import { PublicSupplyChainOracle } from '${oracleUrl}';`,
    `import { mkdtempSync } from 'node:fs';`,
    `import { tmpdir } from 'node:os';`,
    `import { join } from 'node:path';`,
    ...hangingFetchLines,
    `const oracle = new PublicSupplyChainOracle({`,
    `  fetch: hangingFetch,`,
    `  artifactRoot: mkdtempSync(join(tmpdir(), 'oracle-lc-')),`,
    `  timeoutMs: 5000,`,
    `  maxResponseBytes: 1024,`,
    `  maxAdvisories: 4,`,
    `  maxScanWallMs: 80,`,
    `});`,
    `try {`,
    `  await oracle.scan([{ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' }]);`,
    `  process.stdout.write('no_error' + String.fromCharCode(10));`,
    `} catch (error) {`,
    `  process.stdout.write((error?.code ?? 'unknown') + String.fromCharCode(10));`,
    `}`,
  ]);
  const { stdout } = await execFileAsync(process.execPath, [childPath], { timeout: 5000 });
  assert.equal(stdout.trim(), 'oracle_timeout', 'scan wall deadline must fire and settle the promise');
});

test('pre-aborted caller signal yields cancelled before process exit', async (t) => {
  const childPath = writeChild(t, [
    `import { PublicSupplyChainOracle } from '${oracleUrl}';`,
    `import { mkdtempSync } from 'node:fs';`,
    `import { tmpdir } from 'node:os';`,
    `import { join } from 'node:path';`,
    ...hangingFetchLines,
    `const oracle = new PublicSupplyChainOracle({`,
    `  fetch: hangingFetch,`,
    `  artifactRoot: mkdtempSync(join(tmpdir(), 'oracle-lc-')),`,
    `  timeoutMs: 5000,`,
    `  maxResponseBytes: 1024,`,
    `  maxAdvisories: 4,`,
    `});`,
    `const ctrl = new AbortController();`,
    `ctrl.abort('test cancellation');`,
    `try {`,
    `  await oracle.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' }, { signal: ctrl.signal });`,
    `  process.stdout.write('no_error' + String.fromCharCode(10));`,
    `} catch (error) {`,
    `  process.stdout.write((error?.code ?? 'unknown') + String.fromCharCode(10));`,
    `}`,
  ]);
  const { stdout } = await execFileAsync(process.execPath, [childPath], { timeout: 5000 });
  assert.equal(stdout.trim(), 'cancelled', 'pre-aborted signal must yield cancelled code');
});

test('successful vet clears its deadline timer so the process exits promptly', async (t) => {
  // timeoutMs is deliberately long (8000 ms). If clearTimeout were absent or broken the ref'd
  // timer would hold the event loop for 8 s and execFileAsync would time out (3 s budget).
  const childPath = writeChild(t, [
    `import { PublicSupplyChainOracle } from '${oracleUrl}';`,
    `import { mkdtempSync } from 'node:fs';`,
    `import { tmpdir } from 'node:os';`,
    `import { join } from 'node:path';`,
    `const immediate = (value) => { const raw = Buffer.from(JSON.stringify(value)); return { ok: true, status: 200, arrayBuffer: async () => raw }; };`,
    `const mockFetch = async (url) => {`,
    `  const u = String(url);`,
    `  if (u.includes('api.osv.dev')) return immediate({ vulns: [] });`,
    `  return immediate({ versionKey: { system: 'NPM', name: 'safe-pkg', version: '1.2.3' }, publishedAt: '2026-01-01T00:00:00Z', isDeprecated: false, licenses: ['MIT'], advisoryKeys: [], attestations: [], relatedProjects: [] });`,
    `};`,
    `const oracle = new PublicSupplyChainOracle({`,
    `  fetch: mockFetch,`,
    `  artifactRoot: mkdtempSync(join(tmpdir(), 'oracle-lc-')),`,
    `  timeoutMs: 8000,`,
    `  maxResponseBytes: 1024 * 1024,`,
    `  maxAdvisories: 4,`,
    `});`,
    `try {`,
    `  await oracle.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' });`,
    `  process.stdout.write('ok' + String.fromCharCode(10));`,
    `} catch (error) {`,
    `  process.stdout.write('error:' + (error?.code ?? 'unknown') + String.fromCharCode(10));`,
    `}`,
  ]);
  // 3 s timeout proves the 8 s timer was cleared when the call returned successfully.
  const { stdout } = await execFileAsync(process.execPath, [childPath], { timeout: 3000 });
  assert.equal(stdout.trim(), 'ok', 'successful vet must complete and release its deadline timer');
});

test('successful scan clears its wall timer so the process exits promptly', async (t) => {
  // maxScanWallMs deliberately long (8000 ms) to prove clearTimeout runs in finally.
  const childPath = writeChild(t, [
    `import { PublicSupplyChainOracle } from '${oracleUrl}';`,
    `import { mkdtempSync } from 'node:fs';`,
    `import { tmpdir } from 'node:os';`,
    `import { join } from 'node:path';`,
    `const immediate = (value) => { const raw = Buffer.from(JSON.stringify(value)); return { ok: true, status: 200, arrayBuffer: async () => raw }; };`,
    `const mockFetch = async () => immediate({ results: [{ vulns: [] }] });`,
    `const oracle = new PublicSupplyChainOracle({`,
    `  fetch: mockFetch,`,
    `  artifactRoot: mkdtempSync(join(tmpdir(), 'oracle-lc-')),`,
    `  timeoutMs: 8000,`,
    `  maxResponseBytes: 1024 * 1024,`,
    `  maxAdvisories: 4,`,
    `  maxScanWallMs: 8000,`,
    `});`,
    `try {`,
    `  await oracle.scan([{ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' }]);`,
    `  process.stdout.write('ok' + String.fromCharCode(10));`,
    `} catch (error) {`,
    `  process.stdout.write('error:' + (error?.code ?? 'unknown') + String.fromCharCode(10));`,
    `}`,
  ]);
  const { stdout } = await execFileAsync(process.execPath, [childPath], { timeout: 3000 });
  assert.equal(stdout.trim(), 'ok', 'successful scan must complete and release its wall timer');
});
