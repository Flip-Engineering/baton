// Issue #480: the child process the citation rows drive. The CLI's OWN parser and runner
// (application-cli.mjs `parseBatonCli` / `runBatonCli`) run here against the real stack — a real
// CoordinationStore behind a real WebNorthbound over the deployment's own Context CAS writer, a
// real SwarmRuntime, the real BatonWebClient — with the cwd the parent chose. The cwd is the ONE
// thing a parent process cannot vary in-process, and it is exactly what the incident's defect
// depended on (every CLI call in that loop ran from `<repo>/impl`).
//
// TWO injections, and nothing else: the issue READER (the host's `gh` is not authenticated in this
// suite, and the #441 leg takes the reader as an injected seam) and the recruit's argv. The
// deployment's checkout root is NOT injected — `contextRepoRoot` is absent, so the production
// default (`deploymentCheckoutRoot`) is the derivation under test.
//
// One JSON report to stdout; a fixture failure exits non-zero with its own cause on stderr, so a
// broken harness can never read as a deployment refusal.
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { StatelessContextBench } from '../src/context-program.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { BatonWebClient, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const NOW = Date.parse('2026-09-18T17:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue480';
const SWARM_ID = 's-480';
const ISSUE = 480;
const SEAT = 'lane-480';
const OWNER = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const PRESENT_DOC = 'docs/480-in-the-checkout.md';
const ABSENT_DOC = 'docs/480-never-committed.md';
// Issue #488: the two documents the chunk rows cite — the long one the leg must CHUNK (the parent
// writes it into the fixture checkout at its root) and the one a secret-shaped line keeps out.
const CHUNKED_DOC = 'docs/488-cited-chunks.md';
const SENSITIVE_DOC = 'docs/488-keyed-secret.md';
// Every await the fixture takes on the deployment's own settle chain is BOUNDED and NAMED (#460,
// docs/42 §8): the bound is the registry's own probe deadline, and a bound miss carries
// `fixture_wait_unsettled` so a row can never read a hung wait as a deployment refusal.
const WAIT_BOUND_MS = FRAME_LIMITS['route.probe_deadline_ms'].value;

function flagValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function bounded(promise, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(
        new Error(`fixture_wait_unsettled: ${label} never settled within ${WAIT_BOUND_MS}ms`),
        { code: 'fixture_wait_unsettled' },
      )), WAIT_BOUND_MS);
    }),
  ]).finally(() => { clearTimeout(timer); });
}

/** The issue the reader answers for one scenario: a body citing the two documents (`cited` names
 * only the one the checkout carries, `gap` names both, `chunks` names #488's long and
 * secret-shaped pair), or an issue that carries no text at all (the leg's one path to a package
 * with no readable member). */
function issueFor(scenario) {
  const url = `https://github.com/owner/repo/issues/${ISSUE}`;
  if (scenario === 'empty') return { number: ISSUE, title: '', body: '', labels: [], url };
  const body = scenario === 'gap'
    ? [`The item cites ${PRESENT_DOC} and one note that was never committed: ${ABSENT_DOC}.`].join('\n')
    : scenario === 'chunks'
      // The body names the two paths and nothing that reads like a keyed line itself: the issue
      // branch is minted into the same context store, so the FIXTURE's own prose must stay clean.
      ? [`The item cites ${CHUNKED_DOC} and ${SENSITIVE_DOC}.`].join('\n')
      : [`The item cites ${PRESENT_DOC}.`].join('\n');
  const title = scenario === 'chunks'
    ? 'One cited document is long and one is secret-shaped'
    : 'One citation the checkout does not carry';
  return { number: ISSUE, title, body, labels: ['bug'], url };
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }

  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}

async function send(web, { method = 'POST', path, body, headers = {} }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}

/** The REAL stack, as issue441a wires it: the coordination store whose context resolver is a real
 * Context Bench (the deployment's own CAS), the real swarm runtime, the real web bus, the real CLI
 * client. The scratch roots live under the ambient temp root, never under the fixture checkout. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue480-driver-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  const sessions = new WebSessionStore(join(root, 'sessions'), { now: () => NOW });
  const bench = new StatelessContextBench({
    artifactRoot: join(root, 'context'), sources: {},
    environmentDigest: '2'.repeat(64), policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const coordination = new CoordinationStore(join(root, 'coordination'), {
    repoId: REPO_ID, deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: bench.environmentDigest,
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('context source attestation is not used here'); },
    clock: () => new Date(NOW).toISOString(),
  });
  const workers = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => workers },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({
        id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working',
      });
    },
    stopRun: async () => {},
  });
  const application = {
    repoId: REPO_ID,
    card: () => ({
      schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
    }),
    async authorizeReplay() { return true; },
    async command(name, args, sessionPrincipal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${sessionPrincipal.userId}:${sessionPrincipal.sessionId}`,
        principalId: sessionPrincipal.userId, sessionId: sessionPrincipal.sessionId,
      }, context);
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
    contextSourceAdmit: (value) => bench.admitSource(value),
  });
  const issued = sessions.issue({
    userId: 'issue480-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'issue480-fixture' });
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: issued.token,
    commandTimeoutMs: 30_000, pollMs: 20,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      const response = await send(web, {
        method: init.method ?? 'GET', path: `${parsed.pathname}${parsed.search}`,
        body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers ?? {},
      });
      return {
        ok: response.status >= 200 && response.status < 300, status: response.status,
        text: async () => response.rawBody ?? '',
      };
    },
    clock: () => NOW, sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  });
  return { root, coordination, web, swarmRuntime, client };
}

async function main() {
  const scenario = flagValues('--scenario')[0] ?? 'cited';
  const docs = flagValues('--doc');
  const f = fixture();
  const report = {
    scenario, cwd: process.cwd(), docs,
    receipt: null, refusal: null, brief: null,
    branchNames: [], branches: [], attached: 0, admittedPackages: 0, seatJoined: false,
  };
  const argv = [
    'swarm', 'recruit', SWARM_ID, SEAT, 'Read the issue and land its item 1.',
    '--issue', String(ISSUE), ...docs.flatMap((doc) => ['--doc', doc]),
  ];
  try {
    await f.swarmRuntime.command('swarm.create', {
      swarmId: SWARM_ID, purpose: 'issue480', idempotencyKey: 'issue480:create',
    }, OWNER);
    const parsed = parseBatonCli(argv);
    try {
      const answer = await bounded(
        runBatonCli(parsed, f.client, { issueReader: async () => issueFor(scenario) }),
        'runBatonCli',
      );
      report.receipt = answer?.contextPackage ?? null;
    } catch (error) {
      report.refusal = {
        code: error?.code ?? null,
        message: error?.message ?? String(error),
        detail: error?.detail ?? null,
      };
    }
    const swarm = f.coordination.swarm(SWARM_ID);
    const seat = swarm?.participants?.[SEAT] ?? null;
    report.seatJoined = seat !== null;
    report.brief = seat?.brief ?? null;
    report.admittedPackages = f.coordination.eventsView()
      .filter((event) => event.kind === 'package.admitted').length;
    const attachments = seat?.runId ? f.coordination.contextPackageAttachments(seat.runId) : [];
    report.attached = attachments.length;
    if (attachments.length > 0) {
      const record = f.coordination.contextPackage(attachments[0].packageDigest);
      const branches = record?.branches ?? [];
      report.branchNames = branches.map((branch) => branch.name);
      // Issue #488: the branch TEXTS as a reader gets them back — the store's own resolver, the
      // same one the brief and `run.package.read` read through (the brief's three-way coercion,
      // never a second reader) — so a chunk row can reassemble a document from what the package
      // really carries instead of from what it was handed.
      report.branches = branches.map((branch) => {
        let source = null;
        try {
          source = f.coordination.resolveContextPackageBranch(
            attachments[0].packageDigest, branch.name,
          ).source;
        } catch { source = null; }
        const text = source === null ? null
          : typeof source === 'string' ? source : JSON.stringify(source);
        return {
          name: branch.name, bytes: text === null ? null : Buffer.byteLength(text, 'utf8'),
          text,
        };
      });
    }
  } finally {
    try { f.coordination.releaseWriterLease?.(); } catch { /* a fixture that cannot release still reports */ }
    try { rmSync(f.root, { recursive: true, force: true }); } catch { /* the scratch root is the OS's */ }
  }
  // Issue #488: the report now carries the branch TEXTS a reader gets back, so it is far larger
  // than a handshake — and `process.exit` truncates a pipe's pending writes. Wait for the flush,
  // then exit (the fixture's own handles are why this process exits explicitly at all).
  await new Promise((resolve) => { process.stdout.write(`${JSON.stringify(report)}\n`, resolve); });
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`issue480 driver failed: ${error?.stack ?? error}\n`);
  process.exit(2);
});
