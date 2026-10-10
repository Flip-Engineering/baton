// Adapter fixtures for the clangd diagnose completion contract, exercised
// end-to-end against the scripted fake clangd over real LSP framing. These
// run under the hosted qualifier's node; no timers and no file fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const adapterPath = fileURLToPath(new URL('../../adapter/clangd.mjs', import.meta.url));
const fakePath = fileURLToPath(new URL('./fake-clangd.mjs', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./', import.meta.url));

function diagnoseDocument(overrides = {}) {
  return {
    version: 1,
    command: 'diagnose',
    executable: fakePath,
    root: fixtureRoot,
    file: '/fixtures/t.c',
    uriFile: '/fixtures/t.c',
    docVersion: 1,
    languageId: 'c',
    text: 'int main(void) { return 0; }\n',
    compileArguments: ['clang', '-std=c11', 't.c'],
    methods: [
      {
        method: 'textDocument/definition',
        params: { textDocument: { uri: 'file:///fixtures/t.c' }, position: { line: 0, character: 5 } },
      },
    ],
    requireDiagnosticPublication: false,
    ...overrides,
  };
}

function runAdapter(document) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [adapterPath, '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FAKE_CLANGD_SCENARIO: document.scenario },
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let code = null;
    child.stdout.on('data', (d) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr.on('data', (d) => {
      stderr = Buffer.concat([stderr, d]);
    });
    child.on('close', (c) => {
      code = c;
      resolvePromise({ code, stdout, stderr });
    });
    const { scenario, ...documentWithoutScenario } = document;
    child.stdin.write(JSON.stringify(documentWithoutScenario));
    child.stdin.end();
  });
}

test('a protocol error on the only request classifies as failure instead of completing clean', async () => {
  const result = await runAdapter(diagnoseDocument({ scenario: 'definition-error' }));
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout.toString('utf-8'));
  assert.equal(output.failure.code, 'protocolError');
  assert.match(output.failure.detail, /boom/);
  assert.equal(output.responses[0].response.error.code, -32603);
  assert.deepEqual(output.limits, []);
});

test('definition without a diagnostics projection completes on its response', async () => {
  const result = await runAdapter(diagnoseDocument({ scenario: 'definition-ok' }));
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout.toString('utf-8'));
  assert.equal(output.failure, null);
  assert.equal(output.responses[0].response.result[0].uri, 'file:///fixtures/t.c');
  assert.equal(output.diagnostics.completed, false);
  assert.deepEqual(output.limits, []);
});

test('a diagnostic publication carries its complete entries and completes the projection', async () => {
  const result = await runAdapter(
    diagnoseDocument({
      scenario: 'publish-entry',
      methods: [],
      requireDiagnosticPublication: true,
    }),
  );
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout.toString('utf-8'));
  assert.equal(output.failure, null);
  assert.equal(output.diagnostics.completed, true);
  assert.equal(output.diagnostics.matchingPublication.version, 1);
  const entry = output.diagnostics.matchingPublication.diagnostics[0];
  assert.equal(entry.message, 'unused variable');
  assert.equal(entry.severity, 1);
  assert.equal(entry.code, 'unused-variable');
  assert.equal(entry.source, 'clangd');
  assert.equal(entry.range.start.line, 2);
});

test('an explicit empty publication completes the diagnostics projection with none', async () => {
  const result = await runAdapter(
    diagnoseDocument({
      scenario: 'publish-empty',
      methods: [],
      requireDiagnosticPublication: true,
    }),
  );
  const output = JSON.parse(result.stdout.toString('utf-8'));
  assert.equal(output.failure, null);
  assert.equal(output.diagnostics.completed, true);
  assert.deepEqual(output.diagnostics.matchingPublication.diagnostics, []);
});

test('a versionless publication cannot complete the diagnostics projection', async () => {
  const result = await runAdapter(
    diagnoseDocument({
      scenario: 'publish-versionless',
      methods: [],
      requireDiagnosticPublication: true,
    }),
  );
  const output = JSON.parse(result.stdout.toString('utf-8'));
  // The provider ended its work; the versionless publication stays retained
  // evidence while the projection stays unobserved.
  assert.equal(output.failure.code, 'providerExit');
  assert.equal(output.diagnostics.completed, false);
  assert.equal(output.diagnostics.matchingPublication, null);
  assert.equal(output.diagnostics.publications[0].version, null);
  assert.equal(output.limits[0].code, 'diagnosticsUnobserved');
});

test('an empty method selection without diagnostics reports the unsupported selection after initialization', async () => {
  const result = await runAdapter(
    diagnoseDocument({ scenario: 'definition-ok', methods: [] }),
  );
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout.toString('utf-8'));
  assert.equal(output.failure.code, 'unsupportedSelection');
  assert.equal(output.serverIdentity.name, 'fake-clangd');
});

test('provider exit before completion reports the provider failure', async () => {
  const result = await runAdapter(
    diagnoseDocument({
      scenario: 'exit-early',
      methods: [],
      requireDiagnosticPublication: true,
    }),
  );
  const output = JSON.parse(result.stdout.toString('utf-8'));
  assert.equal(output.failure.code, 'providerExit');
  assert.equal(output.diagnostics.completed, false);
  assert.equal(output.limits[0].code, 'diagnosticsUnobserved');
});
