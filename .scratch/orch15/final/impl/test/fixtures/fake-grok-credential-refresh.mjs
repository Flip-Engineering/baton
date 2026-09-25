#!/usr/bin/env node
// Deterministic #84 grok refresh fixture (readiness-credentials epic, RT-10/RT-11).
// Mirrors fixtures/fake-claude-credential-refresh.mjs. Node's test discovery executes fixture
// .mjs files; stay inert unless invoked through the refresh runtime with the fixture argv gate.
if (!process.argv.includes('--baton-grok-refresh-fixture')) process.exit(0);

const { existsSync, readFileSync, realpathSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { dirname, join, resolve, sep } = await import('node:path');

// SAFETY GATE (blue-team fold 2026-08-03, RT-10p): this fixture writes fake tokens to
// HOME/.grok/auth.json. A red-first suite runs against WRONG implementations by design — one
// that spawns the vendor CLI without scoping HOME (the exact F-3 bug class the suite exists to
// catch) would make this fixture overwrite the developer's REAL ~/.grok/auth.json. Fail closed
// (non-zero exit, named reason on stderr) unless BOTH the suite sentinel is present AND HOME
// resolves under os.tmpdir().
function refuse(reason) {
  process.stderr.write(`fake-grok-credential-refresh: refusing to run — ${reason}\n`);
  process.exit(1);
}
if (process.env.BATON_FAKE_GROK_FIXTURE !== '1') {
  refuse('the BATON_FAKE_GROK_FIXTURE=1 suite sentinel is not set');
}
const home = process.env.HOME;
if (typeof home !== 'string' || home.length === 0) {
  refuse('HOME is not set — tmpdir confinement cannot be confirmed');
}
// realpath absorbs macOS /var→/private/var symlink drift; walk up to the nearest existing
// ancestor so a not-yet-created confined HOME still validates.
function nearestRealpath(path) {
  let cursor = resolve(path);
  for (;;) {
    if (existsSync(cursor)) {
      try { return realpathSync(cursor); } catch { return null; }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}
const realHome = nearestRealpath(home);
const realTmp = nearestRealpath(tmpdir());
if (realHome === null || realTmp === null
  || (realHome !== realTmp && !realHome.startsWith(`${realTmp}${sep}`))) {
  refuse(`HOME ${home} does not resolve under the suite tmpdir (${realTmp ?? tmpdir()})`);
}

// The grok vendor-native write-back target (contract fold F-3): the runtime projects the
// credential at HOME/.grok/auth.json and harvests from the same path — never the claude flat
// sibling (HOME/.credentials.json). The fixture records exactly what it observed so the suite
// can pin the target shape without trusting the runtime's self-report.
const grokPath = join(home, '.grok', 'auth.json');
const flatPath = join(home, '.credentials.json');
const observation = {
  projectedGrokTree: existsSync(grokPath),
  flatClaudeSibling: existsSync(flatPath),
  target: grokPath,
};

const countPath = join(dirname(home), 'fixture-spawns');
let count = 0;
try { count = Number.parseInt(readFileSync(countPath, 'utf8'), 10) || 0; } catch {}
writeFileSync(countPath, String(count + 1));
writeFileSync(join(dirname(home), 'fixture-writeback.json'), JSON.stringify(observation));

if (process.argv.includes('--revoke')) {
  process.stderr.write('OIDC refresh failed: invalid_grant (refresh token revoked)\n');
  process.exit(1);
}

const current = observation.projectedGrokTree
  ? JSON.parse(readFileSync(grokPath, 'utf8'))
  : {};
const scope = typeof current['xai::oauth'] === 'object' && current['xai::oauth'] !== null
  ? current['xai::oauth']
  : {};
writeFileSync(grokPath, `${JSON.stringify({
  'xai::oauth': {
    ...scope,
    key: 'access-fresher-9000',
    refresh_token: 'refresh-fresher-9000',
    expires_at: '2099-01-01T00:00:00Z',
  },
})}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ type: 'result', is_error: false, result: 'ok' })}\n`);
