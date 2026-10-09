import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modules = [['source', fileURLToPath(new URL('../context/typescript/', import.meta.url))]];
if (process.env.BATON_TYPESCRIPT_MODULE_ROOT) {
  modules.push(['installed', resolve(process.env.BATON_TYPESCRIPT_MODULE_ROOT)]);
}

function moduleBinding(root) {
  const declarationPath = join(root, 'native-provider.declaration.json');
  if (!existsSync(declarationPath)) {
    return { id: 'typescript', revision: 'source', protocolVersion: '2',
      declarationDigest: 'typescript-source-fixture', operation: 'sourceAnalysis' };
  }
  const bytes = readFileSync(declarationPath);
  const declaration = JSON.parse(bytes.toString('utf8'));
  return { id: declaration.moduleId, revision: declaration.revision,
    protocolVersion: declaration.protocolVersion,
    declarationDigest: createHash('sha256').update(bytes).digest('hex'),
    operation: 'sourceAnalysis' };
}

for (const [mode, moduleRoot] of modules) {
  test(`${mode} TypeScript replays retained project inputs after live inputs change`, async () => {
    const { captureInputs, executeInvocation } = await import(pathToFileURL(join(moduleRoot, 'native-provider.mjs')).href);
    const cwd = mkdtempSync(join(tmpdir(), 'baton-ts-retained-'));
    try {
      const subject = join(cwd, 'subject.ts');
      const value = join(cwd, 'src/value.ts');
      const missing = join(cwd, 'missing.ts');
      const config = join(cwd, 'tsconfig.json');
      const baseConfig = join(cwd, 'tsconfig.base.json');
      const unusualName = 'notes\nretained.txt';
      mkdirSync(join(cwd, 'src'));
      writeFileSync(subject, [
        "import { value } from '@lib/value';",
        "import { missing } from './missing';",
        'export const answer: number = value;',
        'export const unresolved = missing;',
      ].join('\n'));
      writeFileSync(value, 'export const value: number = 7;\n');
      writeFileSync(join(cwd, unusualName), 'a directory member with a newline in its name\n');
      writeFileSync(baseConfig, JSON.stringify({ compilerOptions: {
        target: 'ES2022', module: 'commonjs', moduleResolution: 'node', strict: true,
        baseUrl: '.', paths: { '@lib/*': ['src/*'] }, types: [],
      } }));
      writeFileSync(config, JSON.stringify({ extends: './tsconfig.base.json', include: ['*.ts', 'src/**/*.ts'] }));

      const binding = moduleBinding(moduleRoot);
      const invocation = { version: 2, query: 'retained-ts-query', owner: 'retained-ts-owner',
        role: 'analysis', incarnation: '0', moduleBinding: binding,
        operationPlan: [{ binding, common: 'sourceAnalysis', dependencies: [] }],
        request: { version: 1, cwd, subject: { kind: 'program', path: subject },
          select: ['diagnostics'], options: { project: config } } };
      const options = { packageRoot: moduleRoot, cwd };
      if (mode === 'source' && process.env.BATON2_CONTEXT_TYPESCRIPT) {
        options.compilerPath = join(resolve(process.env.BATON2_CONTEXT_TYPESCRIPT), 'lib/typescript.js');
      }
      const captured = await captureInputs(invocation, options);
      assert.equal(captured.status, 'captured', JSON.stringify(captured));
      for (const path of [subject, value, config, baseConfig]) {
        assert.ok(captured.captures.some((record) => record.path === path
          && ['file', 'config'].includes(record.captureKind)), `missing captured input: ${path}`);
      }
      assert.ok(captured.captures.some((record) => /lib\.es2022(?:\.full)?\.d\.ts$/.test(record.path)),
        'the actual service default libraries must be captured');
      assert.ok(captured.captures.some((record) => record.path === missing && record.captureKind === 'absent'),
        'module resolution must retain the missing import');
      const directory = captured.captures.find((record) => record.path === cwd && record.captureKind === 'dir');
      assert.ok(directory, 'project include discovery must retain its directory listing');
      assert.ok(JSON.parse(Buffer.from(directory.payload, directory.payloadEncoding).toString('utf8')).includes(unusualName));
      for (const record of captured.captures) {
        assert.equal(record.producerModule, binding.id);
        assert.equal(record.producerDigest, binding.declarationDigest);
        assert.equal(record.producerOperation, binding.operation);
      }

      const retainedInvocation = { ...invocation, inputIdentities: captured.captures };
      const before = await executeInvocation(retainedInvocation, options);
      assert.equal(before.payload.status, 'completed', JSON.stringify(before));
      assert.ok(before.payload.facts.some((fact) => fact.kind === 'diagnostic' && fact.value.code === 2307),
        'the original missing import must be visible in diagnostics');

      rmSync(value);
      rmSync(baseConfig);
      rmSync(join(cwd, unusualName));
      writeFileSync(subject, 'export const answer: string = "changed";\n');
      writeFileSync(missing, 'export const missing = 1;\n');
      writeFileSync(config, JSON.stringify({ compilerOptions: { target: 'ES2022', types: [] }, files: ['subject.ts'] }));

      const replayed = await executeInvocation(retainedInvocation, options);
      assert.equal(replayed.payload.status, 'completed', JSON.stringify(replayed));
      assert.deepEqual(replayed.payload, before.payload,
        'retained bytes, configuration, directory membership and absences must determine the result');

      const live = await executeInvocation(invocation, options);
      assert.equal(live.payload.status, 'completed', JSON.stringify(live));
      assert.notEqual(live.payload.snapshot.snapshotId, before.payload.snapshot.snapshotId);
      assert.ok(!live.payload.facts.some((fact) => fact.kind === 'diagnostic' && fact.value.code === 2307),
        'ordinary live execution must observe the changed program');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
