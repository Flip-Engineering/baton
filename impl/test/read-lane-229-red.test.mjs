import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalAuthenticatedWebServer, WebNorthbound } from '../src/web-northbound.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { BatonWebHost } from '../src/application-host.mjs';
import { BatonWebClient } from '../src/application-cli.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY } from '../src/application.mjs';

// #229 red pin — the resident read-lane starvation wedge, measured 3x in production:
// with N live member drives churning evidence, the resident's transport accepts
// connections but NEVER answers HTTP — readiness GETs included. Recovery needs a restart.
//
// Two fixture shapes, both from the issue's own suspect list:
//  W1 — four concurrent member-drive polls holding command dispatches (the load shape).
//       PASSED at HEAD: readiness answers in ~330ms — concurrent dispatches do NOT queue
//       reads. This narrows the production cause (recorded here as evidence).
//  W2 — one wedged drive whose dispatch promise NEVER settles (the promise-hang suspect:
//       'a member-observability read that blocks on a worker handle whose event never
//       fires'). THE PIN: readiness and fresh reads must still answer while the wedged
//       dispatch holds its admission forever.

const ORIGIN = 'https://baton.local';
const REPO = 'issue-229-repo';

function root(t) {
  const directory = mkdtempSync('/tmp/bt229-read-lane-');
  t.after(() => { try { rmSync(directory, { recursive: true, force: true }); } catch {} });
  return directory;
}

function fixture(t, holdMs) {
  const directory = root(t);
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({
    userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop', 'export_result'],
    repoIds: [REPO], ttlMs: 60_000,
  }, { actor: 'deployment:resident' });
  const commands = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
    .filter(([, definition]) => definition.web)
    .map(([name]) => name);
  const application = {
    repoId: REPO,
    ready: Promise.resolve(),
    card() {
      return {
        schemaVersion: 1, repoId: REPO, commands,
        agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
      };
    },
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      if (name === 'runs.list' && args?.wedge === true) {
        // The measured production shape (#229): a dispatch promise that NEVER settles —
        // the wedged reconcile/read the issue suspects. It holds its admission forever.
        await new Promise(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      return { schemaVersion: 1, items: [], continuation: null };
    },
    async shutdown() { return { schemaVersion: 1, state: 'closed', ownership: { workers: 0 } }; },
  };
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: () => () => [] }),
    coordination,
    sessions,
    application,
    repoIds: [REPO],
    allowedOrigins: [ORIGIN],
  });
  const server = createLocalAuthenticatedWebServer(web);
  const socketPath = join(directory, 'resident.sock');
  const host = new BatonWebHost({
    application, server,
    shutdownPrincipal: {
      actor: 'deployment:resident', principalId: 'local-owner', sessionId: 'local-owner-session',
    },
    listen: { path: socketPath },
    webDrainMs: 2_000,
  });
  return { host, issued, socketPath };
}

function client(t, f) {
  return new BatonWebClient({
    baseUrl: ORIGIN, origin: ORIGIN, repoId: REPO, token: f.issued.token,
    commandTimeoutMs: 15_000, pollMs: 10,
    fetchImpl: createLocalSocketFetch({ socketPath: f.socketPath, baseUrl: ORIGIN }),
    clock: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

function fetchImpl(t, f) {
  const localFetch = createLocalSocketFetch({ socketPath: f.socketPath, baseUrl: ORIGIN });
  return (path) => localFetch(`${ORIGIN}${path}`, { method: 'GET' });
}

test('W1 (narrowing evidence): readiness answers while 4 concurrent member-drive polls hold the command lane', async (t) => {
  const HOLD_MS = 300;
  const f = fixture(t, HOLD_MS);
  t.after(async () => { try { await f.host.shutdown(); } catch {} });
  await f.host.start();

  const drives = [client(t, f), client(t, f), client(t, f), client(t, f)];
  const polls = drives.map((c) => c.command('runs.list', {}));
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS / 2));
  const started = Date.now();
  const probe = await fetchImpl(t, f)('/readyz');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2_000, `readiness answered in ${elapsed}ms while 4 drives hold the command lane`);
  assert.equal(probe.status, 200);
  await Promise.allSettled(polls);
});

test('W2 THE PIN: readiness and fresh reads answer while one wedged drive holds its dispatch forever', async (t) => {
  const HOLD_MS = 100;
  const f = fixture(t, HOLD_MS);
  t.after(async () => { try { await f.host.shutdown(); } catch {} });
  await f.host.start();

  // The wedged member drive — a dispatch that never settles (production wedge shape).
  void client(t, f).command('runs.list', { wedge: true }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Three healthy drives behind it on the lane.
  const polls = [client(t, f), client(t, f), client(t, f)].map((c) => c.command('runs.list', {}));
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS / 2));

  const started = Date.now();
  const probe = await fetchImpl(t, f)('/readyz');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2_000, `readiness answered in ${elapsed}ms while a wedged drive holds its dispatch forever`);
  assert.equal(probe.status, 200);
  await Promise.allSettled(polls);
  // And a FRESH read after the wedge — the lane must still admit new reads.
  const after = await client(t, f).command('runs.list', {});
  assert.equal(after.items.length, 0);
});
