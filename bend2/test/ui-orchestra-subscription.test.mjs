import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeOwnerSubscriber } from '../ui/orchestra/native-owner-subscription.mjs';

function stub(directory, lines) {
  const path = join(directory, 'baton2-stub');
  const argvPath = join(directory, 'argv.json');
  const exitPath = join(directory, 'exit.txt');
  writeFileSync(path, `#!/usr/bin/env node
const fs = require('node:fs');
const [database, command, after, generation] = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify({ database, command, after, generation }));
process.on('SIGTERM', () => {
  fs.writeFileSync(${JSON.stringify(exitPath)}, 'terminated\\n');
  process.exit(0);
});
${lines.map((line) => `process.stdout.write(${JSON.stringify(line + '\n')});`).join('\n')}
setInterval(() => {}, 1000);
`);
  chmodSync(path, 0o755);
  return { path, argvPath, exitPath };
}

async function eventually(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('the fixture did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('the native owner adapter forwards readiness and notices under the CLI argv', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-ui-subscription-'));
  const fixture = stub(directory, [
    '{"generation":"7","cursor":"42","gap":false}',
    '{"kind":"commit","generation":"7","cursor":"43"}',
    '{"kind":"gap","generation":"7","cursor":"44"}',
  ]);
  const database = join(directory, 'state.db');
  const notices = [];
  let arrived;
  const received = new Promise((resolve) => { arrived = resolve; });
  const subscription = await createNativeOwnerSubscriber(fixture.path)({
    databasePath: database,
    afterCursor: '41',
    expectedGeneration: '6',
    onNotice: (notice) => {
      notices.push(notice);
      if (notices.length === 2) arrived();
    },
  });
  assert.equal(subscription.ready, true);
  assert.equal(subscription.generation, '7');
  assert.equal(subscription.cursor, '42');
  assert.equal(subscription.gap, false);
  await received;
  assert.deepEqual(notices, [
    { kind: 'commit', generation: '7', cursor: '43' },
    { kind: 'gap', generation: '7', cursor: '44' },
  ]);
  assert.deepEqual(JSON.parse(readFileSync(fixture.argvPath, 'utf8')), {
    database,
    command: 'ui-subscribe',
    after: '41',
    generation: '6',
  });
  subscription.close();
  await eventually(() => existsSync(fixture.exitPath));
  assert.equal(readFileSync(fixture.exitPath, 'utf8'), 'terminated\n');
});

test('the native owner adapter refuses malformed readiness and stops its client', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-ui-subscription-'));
  const fixture = stub(directory, ['{"generation":"7"}']);
  await assert.rejects(
    createNativeOwnerSubscriber(fixture.path)({
      databasePath: join(directory, 'state.db'),
      afterCursor: '41',
      expectedGeneration: '6',
      onNotice: () => {},
    }),
    /invalid readiness/,
  );
  await eventually(() => existsSync(fixture.exitPath));
});
