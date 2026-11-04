import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerCompletionRequestTool } from '../scripts/omp-completion.mjs';

const directory = mkdtempSync(join(tmpdir(), 'baton-omp-completion-'));
try {
  const calls = join(directory, 'calls.json');
  const gate = join(directory, 'gate.json');
  const executable = join(directory, 'baton');
  writeFileSync(gate, JSON.stringify({ decision: 'block', reason: 'Complete the assignment first.' }));
  writeFileSync(executable, `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);\nif(args[0]==='--stop-hook'){process.stdout.write(fs.readFileSync(${JSON.stringify(gate)},'utf8'));process.exit(0);}\nfs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify(args));\nprocess.stdout.write('{"status":"requested"}\\n');\n`);
  chmodSync(executable, 0o755);

  let tool;
  let onSessionStop;
  const schema = { describe() { return this; } };
  const pi = {
    zod: { object: value => value, string: () => schema },
    on(name, handler) { if (name === 'session_stop') onSessionStop = handler; },
    registerTool(value) { tool = value; },
  };
  registerCompletionRequestTool(pi, {
    ...process.env,
    BATON_COORDINATOR: executable,
    BATON_STOP_HOOK: executable,
    BATON_SESSION: 'omp-seat',
  });
  assert.equal(tool.name, 'baton_completion_request');
  assert.deepEqual(await onSessionStop({}),
    { decision: 'block', reason: 'Complete the assignment first.' });
  writeFileSync(gate, '');
  assert.deepEqual(await onSessionStop({}), { continue: true });

  const result = await tool.execute('call-1', { summary: 'Finished the assigned work.' });
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')),
    ['completion-request', '--text', 'Finished the assigned work.']);
  assert.match(result.content[0].text, /requested/);
  process.stdout.write('OMP session_stop gate and completion tool invoke Baton:ok\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
