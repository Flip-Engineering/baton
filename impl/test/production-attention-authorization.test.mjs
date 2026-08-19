import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decorateAttentionApplication } from '../src/production-attention-authorization.mjs';

function application() {
  const seen = [];
  return {
    seen,
    async authorizeReplay(command, args, principal) {
      seen.push({ stage: 'authorize', command, args, principal });
    },
    async attentionWatch(args, principal) {
      seen.push({ stage: 'attention', args, principal });
      return { runId: args.runId, viewer: principal };
    },
    async command(name, args, principal, context) {
      if (name === 'run.attention.watch') return this.attentionWatch(args, principal, context);
      return { name, args };
    },
  };
}

test('one application receives independent Web and MCP attention wrappers', async () => {
  const original = application();
  const web = decorateAttentionApplication(original, { transport: 'web' });
  const mcp = decorateAttentionApplication(web, { transport: 'mcp' });
  assert.notEqual(web, mcp);
  assert.equal(decorateAttentionApplication(original, { transport: 'web' }), web);
  assert.equal(decorateAttentionApplication(mcp, { transport: 'mcp' }), mcp);

  const webResult = await web.command('run.attention.watch', { runId: 'run:web', cursor: 0 }, {
    principalId: 'operator:web', sessionId: 'session:web',
  });
  const mcpResult = await mcp.command('run.attention.watch', { runId: 'run:mcp', cursor: 0 }, {
    principalId: 'operator:mcp', sessionId: 'session:mcp',
  });

  assert.equal(webResult.viewer.actor, 'web:operator:web:session:web');
  assert.equal(mcpResult.viewer.actor, 'mcp:operator:mcp:session:mcp');
  assert.equal(webResult.viewer.principalId, 'wave-owner');
  assert.equal(mcpResult.viewer.principalId, 'wave-owner');
  assert.deepEqual(original.seen.map((entry) => entry.stage), [
    'authorize', 'attention', 'authorize', 'attention',
  ]);
});

test('attention observation replay is authorized through the same existing Run read seam', async () => {
  const original = application();
  const web = decorateAttentionApplication(original, { transport: 'web' });
  await web.authorizeReplay('run.attention.watch', {
    runId: 'run:replay', cursor: 11,
  }, {
    principalId: 'operator:web', sessionId: 'session:web',
  });
  assert.deepEqual(original.seen, [{
    stage: 'authorize',
    command: 'run.inspect',
    args: { runId: 'run:replay', depth: 'outline' },
    principal: { principalId: 'operator:web', sessionId: 'session:web' },
  }]);
});
