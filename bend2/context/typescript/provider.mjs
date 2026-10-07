// The TypeScript semantic provider entry.
//
// Core launches this file as <absolute node> <absolute provider.mjs> with a sanitized environment
// and passes the admitted canonical request bytes on stdin. Core owns the launch contract and the
// frame wrapper; this entry reads exactly one request from stdin (the admitted canonical bytes, or
// a single-member {"requestCanonical": "..."} frame while the transport is provisional), writes
// exactly one JSON frame to stdout, and uses the exit status to separate the outcomes:
//
//   0  one result frame on stdout
//   2  one refusal frame on stdout; stderr carries no request content
//   1  provider failure on stderr only; no result is published
//
// `--engines` answers the discovery line core composes into context-engines and runs no target
// code. `--query <id>` names the query the caller is running; core may also stamp the id itself.

import { FAILURE_EXIT, REFUSAL_EXIT, Refusal, parseRequestBytes, refusalFrame, validateResult, writeFrame } from './lib/protocol.mjs';
import { enginesProbe, resolveTypeScript } from './lib/resolve.mjs';
import { runQuery } from './lib/query.mjs';

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  const argv = process.argv.slice(2);
  const resolved = resolveTypeScript();

  if (argv.includes('--engines')) {
    writeFrame(enginesProbe(resolved));
    return 0;
  }

  const queryId = argumentValue(argv, '--query');
  const bytes = await readStdin();
  let request;
  try {
    ({ request } = parseRequestBytes(bytes));
  } catch (error) {
    if (error instanceof Refusal) {
      writeFrame(refusalFrame(error.condition, queryId));
      return REFUSAL_EXIT;
    }
    throw error;
  }

  if (!resolved.ok) {
    writeFrame({
      version: 1,
      engine: 'typescript',
      query: queryId,
      error: {
        kind: 'validationRefusal',
        condition: resolved.reason,
        limits: [{ projection: 'provider', code: resolved.reason, detail: resolved.detail }],
      },
    });
    return REFUSAL_EXIT;
  }

  try {
    const result = runQuery({ resolved, request, queryId });
    writeFrame(validateResult(result));
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      writeFrame(refusalFrame(error.condition, queryId));
      return REFUSAL_EXIT;
    }
    process.stderr.write(`${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n`);
    return FAILURE_EXIT;
  }
}

process.exitCode = await main();
