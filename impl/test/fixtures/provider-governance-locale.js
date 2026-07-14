import { normalizeProviderGovernancePolicy } from '../../src/provider-governance.mjs';

if (process.argv[2] === 'run') {
  const route = (harness) => ({
    harness, model: 'model', effort: 'low', terminalReserve: { tokens: 0, usd: 0 }, mode: 'observe',
  });
  const normalized = normalizeProviderGovernancePolicy({
    schemaVersion: 1,
    maxWireFrameBytes: 1024,
    maxProviderCallsPerTurn: 1,
    maxToolCallsPerTurn: 1,
    routes: [route('i'), route('I')],
  }, ['i', 'I']);

  process.stdout.write(`${JSON.stringify({
    digest: normalized.digest,
    harnesses: normalized.projection.routes.map((item) => item.harness),
  })}\n`);
}
