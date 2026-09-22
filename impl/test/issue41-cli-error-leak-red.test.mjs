// Issue #41's remaining acceptance clause: a CLI refusal names the seam that failed and a
// sanitized target, and never the material it was judging. `cli-truthfulness-red.test.mjs` pins
// the three observed seams (CT1-CT7); this file pins the MATERIAL: a bearer token and a socket path
// under a private runtime root must appear in no composed message nor in the `detail` a refusal
// carries. Worker and fence coordinates are pinned at their BOUNDARY instead: two landed contracts
// put a coordinate in operator text on purpose — #231 (a typed wire refusal carries the resident's
// own message verbatim) and #473 item (c) (the run-stop block names the worker it is reaping) — so
// rows 3a/3b pin the CLI-composed half of each and the coordinate the block must never add.
//
// Every row drives a real composition seam — `discoverBatonConnection` for the config read,
// `BatonWebClient._json` for the transport leg (over the owner-socket transport the CLI actually
// binds, and over a stub), `followWakes` for the wake attachment and `swarmStopRefusalBlock` for
// the run-stop block — and every row carries a POSITIVE CONTROL: the refusal must name its
// sanitized target (the transport rule and the request, the judged field, the profile or token
// file's own name, the HTTP status, the run and the next step), so a refusal that carries nothing
// cannot pass this file.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BatonWebClient, discoverBatonConnection, followWakes, swarmStopRefusalBlock,
} from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';

const CLI_REGISTRY_DIGEST = APPLICATION_SEMANTIC_REGISTRY.digest;
const STARTED_AT = '2026-09-22T00:00:00.000Z';
// A bearer token in the shape the resident publishes: if any leg echoes it, the whole value is
// the leak (never a hash, never a prefix).
const SECRET_TOKEN = 'sk-live-0123456789abcdef0123456789abcdef';
// The private runtime root the issue names: one directory per deployment, under the temp root a
// deployment derives its owner-only socket path from.
const PRIVATE_ROOT_PARENT = existsSync('/private/tmp') ? '/private/tmp' : tmpdir();

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue41-${label}-`));
  roots.push(root);
  return root;
}
function privateRoot() {
  const root = mkdtempSync(join(PRIVATE_ROOT_PARENT, 'baton-private-'));
  roots.push(root);
  return root;
}
function repository(label) {
  const repo = join(scratch(`${label}-repo`), 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  mkdirSync(join(repo, '.git', 'baton'), { recursive: true });
  return repo;
}

/** One published authority: the repository selector plus the resident's user profile and token.
 * Mirrors `issue288-cli-refusal-causes.test.mjs`'s fixture, which is the discovery path the CLI
 * itself walks. */
function authority({ label, socketPath, tokenContent }) {
  const repo = repository(label);
  const configRoot = join(scratch(`${label}-home`), 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  mkdirSync(profilesRoot, { recursive: true });
  const profileName = `issue41-${label}`;
  writeFileSync(join(repo, '.git', 'baton', 'connection.json'), JSON.stringify({
    schemaVersion: 2, profile: profileName, repoId: 'repo-issue41',
    deploymentId: 'deploy-issue41', incarnation: 'incarnation-issue41', transport: 'local',
    registryDigest: CLI_REGISTRY_DIGEST, startedAt: STARTED_AT,
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, `${profileName}.json`), JSON.stringify({
    schemaVersion: 2, transport: 'local', socketPath,
    url: 'https://baton.local', origin: 'https://baton.local', tokenFile: `${profileName}.token`,
    deploymentId: 'deploy-issue41', incarnation: 'incarnation-issue41',
    registryDigest: CLI_REGISTRY_DIGEST, startedAt: STARTED_AT,
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, `${profileName}.token`), tokenContent, { mode: 0o600 });
  return { repo, env: { XDG_CONFIG_HOME: configRoot }, home: configRoot, profileName };
}

const discover = (fixture) => discoverBatonConnection({
  cwd: fixture.repo, env: fixture.env, home: fixture.home,
});

/** The whole surface one refusal is printed through: the composed message, and the `detail` the
 * envelope, the MCP bridge and `baton doctor` all render. */
function refusalSurface(error) {
  return `${error?.message ?? ''}\n${JSON.stringify(error?.detail ?? null)}`;
}
function assertAbsent(error, forbidden, label) {
  const surface = refusalSurface(error);
  for (const value of forbidden) {
    assert.ok(!surface.includes(value),
      `${label}: ${value} must never reach a CLI error string, but it rode the refusal:\n${surface}`);
  }
}

const SOCKET_LISTENER = 'const net = require("node:net");'
  + ' const server = net.createServer(() => {});'
  + ' server.listen(process.argv[1], () => process.stdout.write("up"));';

/** A socket file that EXISTS, is owner-only, and has NO listener behind it — the resident that
 * was killed without unbinding. It is the only shape that reaches the transport's own connect leg
 * (a missing path is refused by the transport's own authority check with fixed text), so it is the
 * shape that decides whether Node's connect error text rides the CLI refusal. */
async function staleOwnerSocket(socketPath) {
  const child = spawn(process.execPath, ['-e', SOCKET_LISTENER, socketPath], { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const probe = connect(socketPath);
        probe.once('connect', () => { probe.destroy(); resolve(); });
        probe.once('error', reject);
      });
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error('the socket fixture never began listening');
      }
      await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
  }
  child.kill('SIGKILL');
  await once(child, 'exit');
  chmodSync(socketPath, 0o600);
  return socketPath;
}

function webClient(fetchImpl, socketPath = null) {
  return new BatonWebClient({
    baseUrl: 'https://baton.local', origin: 'https://baton.local', repoId: 'repo-issue41',
    token: SECRET_TOKEN, commandTimeoutMs: 5_000, pollMs: 50,
    ...(socketPath === null ? {} : { socketPath }),
    fetchImpl, clock: () => 0, sleep: () => Promise.resolve(),
  });
}

// -------------------------------------------------------------------------------------------
// 1 — the bearer token
// -------------------------------------------------------------------------------------------

test('#41 leak 1a: the transport refusal never carries the bearer token', async () => {
  const client = webClient(async () => {
    throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNREFUSED' });
  });
  await assert.rejects(client.command('run.start', { intent: { runId: 'run-1' } }), (error) => {
    assert.equal(error.code, 'cli_transport_failed');
    assert.equal(error.detail.cause, 'web_transport_failed', 'positive control: the typed cause is named');
    assert.match(error.message, /the Baton Web connection failed/u, 'positive control: the transport seam is named');
    assert.match(error.message, /POST \/v1\/commands/u, 'positive control: the refused request is named');
    assertAbsent(error, [SECRET_TOKEN], 'the transport refusal');
    return true;
  });
});

test('#41 leak 1b: the config-read refusal names the token file, never its content', () => {
  const fixture = authority({
    label: 'token',
    socketPath: join(PRIVATE_ROOT_PARENT, 'baton-501', 'resident.sock'),
    // Two lines: the file is what a hand-edited or truncated publication looks like, and its first
    // line is the resident's real bearer token.
    tokenContent: `${SECRET_TOKEN}\nEXTRA LINE\n`,
  });
  assert.throws(() => discover(fixture), (error) => {
    assert.equal(error.cause, 'token_file_content_invalid', 'positive control: the typed cause is named');
    assert.match(error.message, new RegExp(`${fixture.profileName}\\.token`, 'u'),
      'positive control: the operator is told WHICH token file is invalid');
    assert.match(error.message, /token file content is invalid/u, 'positive control: the rule is named');
    assertAbsent(error, [SECRET_TOKEN], 'the token-file refusal');
    return true;
  });
});

// -------------------------------------------------------------------------------------------
// 2 — a socket path under a private runtime root
// -------------------------------------------------------------------------------------------

test('#41 leak 2a: the transport refusal never carries a private runtime socket path', async (t) => {
  const root = privateRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const socketPath = await staleOwnerSocket(join(root, 'resident.sock'));
  const client = webClient(createLocalSocketFetch({ socketPath }), socketPath);
  await assert.rejects(client.command('run.start', { intent: { runId: 'run-1' } }), (error) => {
    assert.equal(error.code, 'cli_transport_failed', 'positive control: the transport failure is typed');
    assert.equal(error.detail.field, 'transport', 'positive control: the judged field is named');
    assert.match(error.message, /POST \/v1\/commands/u, 'positive control: the refused request is named');
    assert.match(refusalSurface(error), /ECONNREFUSED/u, 'positive control: the socket cause is named');
    assertAbsent(error, [socketPath, root], 'the transport refusal');
    return true;
  });
});

test('#41 leak 2b: the config-read refusal never carries a private runtime socket path', () => {
  // A profile published from a deep private runtime root: the path is over the 103-byte
  // sockaddr_un ceiling, which is exactly the refusal `user_profile_socket_path_invalid` exists
  // for, and the private root is the material the refusal must not reprint.
  const root = privateRoot();
  const socketPath = join(root, 'sessions', 'a'.repeat(48), 'b'.repeat(48), 'resident.sock');
  assert.ok(Buffer.byteLength(socketPath) > 103, 'fixture: the path must exceed the socket ceiling');
  const fixture = authority({ label: 'socket', socketPath, tokenContent: `${SECRET_TOKEN}\n` });
  assert.throws(() => discover(fixture), (error) => {
    assert.equal(error.cause, 'user_profile_socket_path_invalid', 'positive control: the typed cause is named');
    assert.equal(error.field, 'socketPath', 'positive control: the judged field is named');
    assert.match(error.message, /unusable resident socket path/u, 'positive control: the rule is named');
    assert.match(error.message, /absolute owner-only Unix socket path/u, 'positive control: the remedy names the shape');
    assertAbsent(error, [socketPath, root, SECRET_TOKEN], 'the socket-path refusal');
    return true;
  });
});

test('#41 leak 2c: the wake-attachment refusal never carries a private runtime socket path', async (t) => {
  const root = privateRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const socketPath = join(root, 'resident.sock');
  const client = webClient(async () => { throw new Error('the wake attachment never rides _json'); }, socketPath);
  await assert.rejects(
    followWakes({ kinds: null, swarms: null, since: null, stopOnClosedWake: false }, client, {}),
    (error) => {
      assert.match(error.message, /the deployment wake stream could not be attached/u,
        'positive control: the wake-attachment seam is named');
      assert.equal(error.detail.attachmentClosed.kind, 'baton.wake_attachment_closed',
        'positive control: the typed final frame rides the refusal');
      assertAbsent(error, [socketPath, root, SECRET_TOKEN], 'the wake-attachment refusal');
      return true;
    },
  );
});

// -------------------------------------------------------------------------------------------
// 3 — fence and worker coordinates
// -------------------------------------------------------------------------------------------

test('#41 leak 3a (boundary): the CLI prefix adds no coordinate, and #231 keeps the resident\'s own wire text verbatim', async () => {
  const wire = {
    code: 'stale_fence', field: 'fence',
    message: 'worker w-78 holds fence 12; the session fence is 15',
    detail: { workerId: 'w-78', taskId: 'task-3', expectedFence: 12, observedFence: 15 },
  };
  const client = webClient(async () => ({
    ok: false, status: 409, headers: { get: () => null },
    text: async () => JSON.stringify({ ok: false, error: wire }),
  }));
  await assert.rejects(client.command('swarm.stop', {
    swarmId: 'swarm-1', participantId: 'seat-1', reason: 'contract',
  }), (error) => {
    assert.equal(error.code, 'stale_fence', 'positive control: the wire code is preserved');
    assert.equal(error.field, 'fence', 'positive control: the judged field is named');
    // The CLI's OWN half of this refusal is the prefix — request facts only. #231 (commented at
    // the composition site) makes everything after it the resident's text verbatim and its error
    // object the `detail`, so a coordinate there is the resident's to drop, not this leg's.
    const prefix = 'Baton Web request was refused (POST /v1/commands, HTTP 409)';
    assert.equal(error.message, `${prefix}: ${wire.message}`,
      '#231: the resident\'s message rides verbatim after the CLI prefix');
    assertAbsent({ message: prefix, detail: null },
      ['w-78', 'fence 12', 'fence is 15', '"expectedFence"', '"observedFence"'],
      'the CLI-composed prefix');
    return true;
  });
});

test('#41 leak 3b (boundary): the run-stop block names the worker it holds (#473 c) and no fence or task coordinate', () => {
  const error = Object.assign(
    new Error('Baton Web request was refused (POST /v1/commands, HTTP 409)'),
    {
      code: 'coordinator_run_stop_incomplete',
      detail: {
        detail: {
          runId: 'run-7', timeoutMs: 30_000,
          waitingOn: [{
            workerId: 'w-78', taskId: 'task-3', status: 'running', disposition: 'reaping', fence: 12,
            waiting: [{ resource: 'process', reaper: 'runner', since: STARTED_AT }],
          }],
        },
      },
    },
  );
  const block = swarmStopRefusalBlock(error, { swarmId: 'swarm-1', participantId: 'seat-1' });
  assert.ok(block !== null, 'positive control: the run-stop refusal renders its own block');
  assert.match(block, /named run run-7/u, 'positive control: the run the stop named is named');
  assert.match(block, /did not converge inside 30000ms/u, 'positive control: the deadline it held is named');
  assert.match(block, /process since 2026-09-22T00:00:00.000Z/u,
    'positive control: the held resource is named');
  assert.match(block, /^next: /mu, 'positive control: the one step that converges the seat is named');
  // #473 item (c) pins the held worker's id in this block on purpose (the row at
  // test/issue473-stop-incomplete-typed.test.mjs asserts it): it is the operator's own diagnosis
  // fact. The coordinates the block must not add are the fence generation and the task id riding
  // the same detail row, and they must not leak the moment a second seat is held.
  assert.match(block, /w-78/u, 'positive control: the held worker is named by #473 item (c)');
  assertAbsent({ message: block, detail: null }, ['fence 12', '"fence"', 'task-3'],
    'the run-stop refusal block');
});
