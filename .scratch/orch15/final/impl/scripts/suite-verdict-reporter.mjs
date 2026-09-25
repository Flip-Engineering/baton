// The runner's reporter (issue #260): TAP-compatible lines for humans and logs, plus a JSON
// summary the runner turns into the suite verdict. Selected by run-suite.mjs through
// --test-reporter; BATON_SUITE_SUMMARY_FILE names the summary path.
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Row keys are impl-relative (`test/foo.test.mjs`) whatever the caller's cwd, so the manifest
// is stable across invocations.
const IMPL_ROOT = fileURLToPath(new URL('..', import.meta.url));

function nameOf(data) {
  return typeof data?.name === 'string' ? data.name : '(unnamed)';
}
function fileOf(data) {
  const file = typeof data?.file === 'string' ? data.file : '';
  return file ? relative(IMPL_ROOT, file) : '(no file)';
}
function indent(text, depth) {
  return String(text).split('\n').map((line) => `${'  '.repeat(depth)}${line}`).join('\n');
}

export default async function* suiteVerdictReporter(source) {
  const passed = [];
  const failed = [];
  let counter = 0;
  // Nested tests are keyed by their ancestor chain (`parent > child`): a bare subtest name such
  // as `kimi` is ambiguous across parents and would let one parent's expectation absolve another.
  const stack = [];
  const qualified = (data) => [...stack.slice(0, data.nesting ?? 0), nameOf(data)].join(' > ');
  for await (const event of source) {
    const data = event.data;
    switch (event.type) {
      case 'test:start':
        stack[data.nesting ?? 0] = nameOf(data);
        stack.length = (data.nesting ?? 0) + 1;
        break;
      case 'test:pass': {
        if (data.nesting === 0) { counter += 1; yield `ok ${counter} - ${nameOf(data)}\n`; }
        else yield indent(`ok - ${nameOf(data)}`, data.nesting) + '\n';
        passed.push({ file: fileOf(data), name: qualified(data), nesting: data.nesting });
        break;
      }
      case 'test:fail': {
        const error = data.details?.error;
        const failureType = error?.failureType ?? null;
        const message = error?.cause?.message ?? error?.message ?? String(error ?? 'failed');
        if (data.nesting === 0) { counter += 1; yield `not ok ${counter} - ${nameOf(data)}\n`; }
        else yield indent(`not ok - ${nameOf(data)}`, data.nesting) + '\n';
        yield indent(`  ---\n  location: '${fileOf(data)}:${data.line ?? 0}:${data.column ?? 0}'\n  failureType: '${failureType ?? 'testCodeFailure'}'\n  error: |-\n${indent(message, 2)}\n  ...`, data.nesting) + '\n';
        failed.push({ file: fileOf(data), name: qualified(data), nesting: data.nesting, failureType, message });
        break;
      }
      case 'test:diagnostic':
        if (typeof data?.message === 'string') yield `# ${data.message}\n`;
        break;
      case 'test:stderr':
      case 'test:stdout':
        if (typeof data?.message === 'string' && data.message.length > 0) yield data.message;
        break;
      default:
        break;
    }
  }
  const summary = { schemaVersion: 1, passed, failed };
  if (process.env.BATON_SUITE_SUMMARY_FILE) writeFileSync(process.env.BATON_SUITE_SUMMARY_FILE, JSON.stringify(summary));
  yield `# tests ${passed.length + failed.length}\n# pass ${passed.length}\n# fail ${failed.length}\n`;
}
