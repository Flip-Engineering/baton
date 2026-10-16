import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const baton = await openBaton({
  repo,
  advanced: {
    verification: {
      command: 'node',
      arguments: [
        '--test',
        'impl/test/phase67-progressive-agent-experience.test.mjs',
        'impl/test/phase77-recursive-application-red.test.mjs',
      ],
    },
  },
});
let group = null;
try {
  group = await baton.startMany([
    {
      objective: [
        'Audit Baton Atlas and its intended code-representation plane exhaustively against SYSTEM.md, specs, docs, reviews, tests, and implementation.',
        'Cover AST, CST, symbol graphs and SCIP, CPG, compiler IR, semantic delta, behavioral fingerprints, structured and semantic merge, and e-graph research bets.',
        'Distinguish implemented production capability from scaffold, test-only behavior, documentation-only intention, and missing work.',
        'Write only reviews/dogfood/phase79-atlas-representation-audit.md with a dependency-ordered implementation plan, exact source pointers, acceptance criteria, and red-test recommendations.',
        'Do not modify production code.',
      ].join(' '),
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['reviews/dogfood/phase79-atlas-representation-audit.md'],
    },
    {
      objective: [
        'Audit Baton shared knowledge, causal graph, recursive orchestration, and agent-experience surfaces exhaustively against the pre-implementation design body and current implementation.',
        'Focus on typed causal knowledge, temporal integrity, contradiction, promotion and recall, multi-tempo memory, Run lineage, recipient authority, and how Atlas representations should feed one shared graph without creating a spaghettified control surface.',
        'Assess the Outline to index to section to item to evidence cascade and propose intuitive Pythonic high-level methods that derive coordinates server-side.',
        'Write only reviews/dogfood/phase79-shared-knowledge-ax-audit.md with exact source pointers, capability gaps, dependency order, acceptance criteria, and red-test recommendations.',
        'Do not modify production code.',
      ].join(' '),
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
      scope: ['reviews/dogfood/phase79-shared-knowledge-ax-audit.md'],
    },
  ]);

  const completed = await Promise.all(group.runs.map((run) => run.complete({ signal: controller.signal })));
  const results = await Promise.all(group.runs.map(async (run, index) => {
    const sections = Object.fromEntries(await Promise.all(
      ['execution', 'route', 'result', 'cleanup'].map(async (section) => {
        const projection = await run.inspect({ depth: 'section', section });
        return [section, projection.section];
      }),
    ));
    return {
      runId: run.id,
      phase: completed[index]?.outline?.phase ?? null,
      terminalCause: completed[index]?.outline?.terminalCause ?? null,
      sections,
    };
  }));
  process.stdout.write(`${JSON.stringify({ group: group.ids, results })}\n`);
} finally {
  if (controller.signal.aborted && group) {
    await group.stop('Signal received; stop and reap the parallel representation audit.').catch(() => {});
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership })}\n`);
}
