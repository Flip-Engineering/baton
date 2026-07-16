// Phase 66 CE17/RD1-RD4 acceptance reds. Production intentionally does not satisfy these yet.
// Keep each red at one missing delivery boundary so progress does not hide the next retained gap.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as cliModule from '../src/application-cli.mjs';
import * as baton from '../src/index.mjs';
import * as exportModule from '../src/result-export.mjs';

const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-phase66-retained-delivery';
const NOW = Date.parse('2026-07-14T20:00:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalDigest = (value) => sha256(JSON.stringify(canonical(value)));

function temporary(t, label) {
  const path = mkdtempSync(join(tmpdir(), `baton-phase66-retained-${label}-`));
  t.after(() => {
    try { chmodSync(path, 0o700); } catch {}
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}

function materializedExport(t, label) {
  const repoRoot = temporary(t, `${label}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'phase66@example.invalid'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Phase 66'], { cwd: repoRoot });
  mkdirSync(join(repoRoot, 'bin'));
  writeFileSync(join(repoRoot, 'alpha.txt'), 'alpha\n');
  writeFileSync(join(repoRoot, 'bin', 'run.sh'), '#!/bin/sh\necho retained\n', { mode: 0o755 });
  chmodSync(join(repoRoot, 'bin', 'run.sh'), 0o755);
  execFileSync('git', ['add', '--all'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'retained export fixture'], { cwd: repoRoot });
  const resultSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const exportRoot = temporary(t, `${label}-exports`);
  chmodSync(exportRoot, 0o700);
  const exportId = sha256(`retained-export:${label}`);
  const evidenceDigest = 'a'.repeat(64);
  const materialized = exportModule.materializeResultTree({
    repoRoot, exportRoot, exportId, stagingNonce: '00000000-0000-4000-8000-000000000066', resultSha,
    manifestCore: {
      repoId: REPO_ID, runId: `run-${label}`, nodeKey: 'work', taskId: `task-${label}`,
      resultSha, evidenceDigest, profileDigest: 'b'.repeat(64), exportPolicyDigest: 'c'.repeat(64),
      goal: { id: `goal-${label}`, version: 1, digest: 'd'.repeat(64) },
      plan: { id: `plan-${label}`, version: 1, digest: 'e'.repeat(64), approvalDigest: 'f'.repeat(64) },
      adoptionReceiptDigest: '1'.repeat(64), semanticReviewReceiptDigest: null,
      integrationAfterSha: null,
    },
    policy: { format: 'directory-v1', maxFiles: 32, maxBytes: 1024 * 1024 },
  });
  const manifestBytes = readFileSync(join(exportRoot, exportId, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const core = {
    schemaVersion: 1, state: 'completed', format: 'directory-v1', runId: `run-${label}`,
    nodeKey: 'work', resultSha, evidenceDigest, exportId, locator: `export:${exportId}`,
    treeOid: materialized.treeOid, manifestDigest: materialized.manifestDigest,
    fileCount: materialized.fileCount, byteCount: materialized.byteCount,
    checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: true },
    effects: { adopted: false, checkoutChanged: false, deployed: false, integrated: false, published: false },
  };
  const receipt = Object.freeze({ ...core, receiptDigest: canonicalDigest(core) });
  return { repoRoot, exportRoot, exportId, resultSha, receipt, manifest, manifestBytes };
}

function putAscii(target, offset, width, value) {
  const bytes = Buffer.from(value, 'ascii');
  if (bytes.length > width) throw new RangeError(`tar field exceeds ${width} bytes`);
  bytes.copy(target, offset);
}

function tarOctal(value, width) {
  const text = value.toString(8).padStart(width - 1, '0');
  if (text.length !== width - 1) throw new RangeError('tar octal field overflow');
  return `${text}\0`;
}

function tarHeader(entry) {
  const header = Buffer.alloc(512);
  putAscii(header, 0, 100, entry.name);
  putAscii(header, 100, 8, tarOctal(entry.mode ?? 0o644, 8));
  putAscii(header, 108, 8, tarOctal(entry.uid ?? 0, 8));
  putAscii(header, 116, 8, tarOctal(entry.gid ?? 0, 8));
  putAscii(header, 124, 12, tarOctal(entry.data?.length ?? 0, 12));
  putAscii(header, 136, 12, tarOctal(entry.mtime ?? 0, 12));
  header.fill(0x20, 148, 156);
  putAscii(header, 156, 1, entry.type ?? '0');
  putAscii(header, 157, 100, entry.linkName ?? '');
  putAscii(header, 257, 6, 'ustar\0');
  putAscii(header, 263, 2, '00');
  putAscii(header, 265, 32, entry.uname ?? '');
  putAscii(header, 297, 32, entry.gname ?? '');
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  putAscii(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function makeTar(entries) {
  const chunks = [];
  for (const raw of entries) {
    const entry = { ...raw, data: Buffer.from(raw.data ?? Buffer.alloc(0)) };
    chunks.push(tarHeader(entry), entry.data);
    const padding = (512 - (entry.data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function parseTar(bytes) {
  const records = [];
  let offset = 0;
  let terminators = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      terminators += 1;
      if (terminators === 2) break;
      continue;
    }
    assert.equal(terminators, 0, 'non-zero archive record follows a zero block');
    const text = (start, width) => header.subarray(start, start + width).toString('utf8').replace(/\0.*$/u, '');
    const octal = (start, width) => Number.parseInt(text(start, width).trim() || '0', 8);
    const name = text(0, 100);
    const size = octal(124, 12);
    const data = bytes.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    records.push({
      name, mode: octal(100, 8), uid: octal(108, 8), gid: octal(116, 8), size,
      mtime: octal(136, 12), type: text(156, 1) || '0', linkName: text(157, 100),
      magic: text(257, 6), uname: text(265, 32), gname: text(297, 32), data,
    });
  }
  assert.equal(offset, bytes.length, 'archive has trailing bytes after its two zero blocks');
  assert.equal(terminators, 2, 'archive lacks its closed two-block terminator');
  return records;
}

function archiveEntries(fixture) {
  return [
    { name: 'manifest.json', mode: 0o600, data: fixture.manifestBytes },
    ...fixture.manifest.files.map((file) => ({
      name: `tree/${file.path}`, mode: file.mode === '100755' ? 0o755 : 0o644,
      data: readFileSync(join(fixture.exportRoot, fixture.exportId, 'tree', ...file.path.split('/'))),
    })),
  ].sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
}

function descriptor(fixture, bytes) {
  return {
    schemaVersion: 1, format: 'baton-export-tar-v1', mediaType: 'application/x-tar',
    exportId: fixture.exportId, manifestDigest: fixture.receipt.manifestDigest,
    archiveDigest: sha256(bytes), archiveBytes: bytes.length,
  };
}

function principal(overrides = {}) {
  return {
    userId: 'operator', sessionId: 'session', credentialId: 'credential', authMethod: 'bearer',
    capabilities: ['observe', 'export_result'], repoIds: [REPO_ID],
    expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, ...overrides,
  };
}

test('RD1 RED: completed directory-v1 derives one deterministic closed bounded tar-v1 archive', (t) => {
  assert.equal(typeof exportModule.deriveResultExportArchive, 'function',
    'retained red: deterministic archive derivation is not implemented');
  const fixture = materializedExport(t, 'deterministic');
  const args = { exportRoot: fixture.exportRoot, receipt: fixture.receipt, maxArchiveBytes: 2 * 1024 * 1024 };
  const first = exportModule.deriveResultExportArchive(args);
  const second = exportModule.deriveResultExportArchive(args);
  assert.ok(Buffer.isBuffer(first.bytes));
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.descriptor).sort(), [
    'archiveBytes', 'archiveDigest', 'exportId', 'format', 'manifestDigest', 'mediaType', 'schemaVersion',
  ]);
  assert.equal(first.descriptor.archiveDigest, sha256(first.bytes));
  assert.equal(first.descriptor.archiveBytes, first.bytes.length);
  assert.equal(first.descriptor.manifestDigest, fixture.receipt.manifestDigest);
  assert.equal(JSON.stringify(first.descriptor).includes(fixture.exportRoot), false);
  assert.deepEqual(readdirSync(fixture.exportRoot), [fixture.exportId], 'archive temporaries leaked into deployment root');

  const records = parseTar(first.bytes);
  const expectedNames = ['manifest.json', ...fixture.manifest.files.map((file) => `tree/${file.path}`)]
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  assert.deepEqual(records.map((record) => record.name), expectedNames);
  const expectedModes = new Map([
    ['manifest.json', 0o600],
    ...fixture.manifest.files.map((file) => [`tree/${file.path}`, file.mode === '100755' ? 0o755 : 0o644]),
  ]);
  for (const record of records) {
    assert.equal(record.type, '0');
    assert.equal(record.magic, 'ustar');
    assert.equal(record.mode, expectedModes.get(record.name));
    assert.equal(record.uid, 0); assert.equal(record.gid, 0); assert.equal(record.mtime, 0);
    assert.equal(record.uname, ''); assert.equal(record.gname, ''); assert.equal(record.linkName, '');
  }
  assert.throws(() => exportModule.deriveResultExportArchive({
    ...args, maxArchiveBytes: first.bytes.length - 1,
  }), (error) => error?.code === 'result_export_archive_oversize');

  writeFileSync(join(fixture.exportRoot, fixture.exportId, 'tree', 'alpha.txt'), 'mutated\n');
  assert.throws(() => exportModule.deriveResultExportArchive(args),
    (error) => error?.code === 'result_export_output_mismatch');
});

test('RD2 RED: export-scoped Web delivery tickets are one-use and reauthorize before headers and chunks', async () => {
  assert.equal(typeof baton.WebResultExportDelivery, 'function',
    'retained red: export-scoped Web delivery authority is not implemented');
  const bytes = makeTar([{ name: 'manifest.json', mode: 0o600, data: '{}\n' }]);
  const exportId = '3'.repeat(64);
  const archiveDescriptor = {
    schemaVersion: 1, format: 'baton-export-tar-v1', mediaType: 'application/x-tar', exportId,
    manifestDigest: '4'.repeat(64), archiveDigest: sha256(bytes), archiveBytes: bytes.length,
  };
  const receipt = { schemaVersion: 1, state: 'completed', format: 'directory-v1', runId: 'run-web', exportId };
  let active = true;
  let authorizations = 0;
  let registrations = 0;
  let releases = 0;
  const audits = [];
  const delivery = new baton.WebResultExportDelivery({
    coordination: { recordWebAudit(fields) { audits.push(fields); return { seq: audits.length }; } },
    allowedOrigins: [ORIGIN], repoIds: [REPO_ID], now: () => NOW, ticketTtlMs: 1_000,
    isPrincipalActive: () => active,
    authorizeExport(candidate, coordinates) {
      authorizations += 1;
      return active && candidate.userId === 'operator' && coordinates.repoId === REPO_ID
        && coordinates.runId === 'run-web' && coordinates.exportId === exportId;
    },
    resolveCompletedExport(coordinates) {
      return active && coordinates.runId === receipt.runId && coordinates.exportId === receipt.exportId ? receipt : null;
    },
    async openArchive() {
      const split = Math.floor(bytes.length / 2);
      return {
        descriptor: archiveDescriptor,
        chunks: (async function* chunks() { yield bytes.subarray(0, split); yield bytes.subarray(split); }()),
      };
    },
    registerDelivery({ runId, exportId: registeredId, signal }) {
      assert.equal(runId, 'run-web'); assert.equal(registeredId, exportId); assert.ok(signal instanceof AbortSignal);
      registrations += 1;
      return { release() { releases += 1; } };
    },
  });
  const coordinates = { repoId: REPO_ID, runId: 'run-web', exportId };
  const issued = await delivery.issue(principal(), ORIGIN, coordinates);
  assert.equal(issued.status, 201);
  assert.match(issued.body.ticket, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,}$/u);
  assert.deepEqual(issued.body.delivery, archiveDescriptor);

  class BinaryResponse extends EventEmitter {
    constructor(onWrite = null) { super(); this.chunks = []; this.onWrite = onWrite; }
    writeHead(status, headers) { this.status = status; this.headers = headers; }
    write(chunk) { this.chunks.push(Buffer.from(chunk)); this.onWrite?.(); return true; }
    end(chunk = null) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.ended = true; }
    destroy() { this.destroyed = true; this.emit('close'); }
  }

  active = false;
  const revokedResponse = new BinaryResponse();
  const revoked = await delivery.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, requestHeaders: {} }, revokedResponse);
  assert.equal(revoked.status, 403);
  assert.equal(revokedResponse.status, undefined, 'revoked delivery wrote archive headers');
  active = true;
  const replayAfterRefusal = await delivery.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, requestHeaders: {} }, new BinaryResponse());
  assert.equal(replayAfterRefusal.status, 403, 'a refused one-use ticket became reusable');

  const ranged = await delivery.issue(principal(), ORIGIN, coordinates);
  const rangedResponse = new BinaryResponse();
  const rangeRefusal = await delivery.open({
    ticket: ranged.body.ticket, principal: principal(), origin: ORIGIN, requestHeaders: { range: 'bytes=0-1' },
  }, rangedResponse);
  assert.equal(rangeRefusal.status, 400);
  assert.equal(rangedResponse.status, undefined);

  const streaming = await delivery.issue(principal(), ORIGIN, coordinates);
  const streamed = new BinaryResponse(() => { active = false; });
  const opened = await delivery.open({ ticket: streaming.body.ticket, principal: principal(), origin: ORIGIN, requestHeaders: {} }, streamed);
  assert.equal(opened, null);
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers['cache-control'], 'no-store');
  assert.equal(streamed.headers['content-type'], 'application/x-tar');
  assert.equal(streamed.headers['content-length'], String(bytes.length));
  assert.equal(streamed.headers['x-content-type-options'], 'nosniff');
  assert.equal(streamed.headers['content-disposition'], `attachment; filename="baton-export-${exportId}.tar"`);
  assert.equal(streamed.headers['content-digest'], `sha-256=:${Buffer.from(archiveDescriptor.archiveDigest, 'hex').toString('base64')}:`);
  assert.equal(Buffer.concat(streamed.chunks).equals(bytes), false, 'revocation did not stop the remaining archive suffix');
  assert.equal(streamed.ended || streamed.destroyed, true);
  assert.equal(registrations, 1); assert.equal(releases, 1);
  assert.ok(authorizations >= 6, 'delivery was not reauthorized across issue/open/chunk boundaries');
  assert.equal((await delivery.open({
    ticket: streaming.body.ticket, principal: principal(), origin: ORIGIN, requestHeaders: {},
  }, new BinaryResponse())).status, 403);
  assert.equal(JSON.stringify(audits).includes(issued.body.ticket), false, 'raw delivery ticket entered audit state');
});

test('RD2 RED: WebNorthbound routes strict issue and download requests without path or range authority', async (t) => {
  const exportId = '5'.repeat(64);
  const calls = [];
  const exportDelivery = {
    authorizeIssue(candidate, origin, coordinates) {
      calls.push({ op: 'authorizeIssue', candidate, origin, coordinates }); return true;
    },
    issue(candidate, origin, coordinates) {
      calls.push({ op: 'issue', candidate, origin, coordinates });
      return { status: 201, body: { ok: true, ticket: 'ticket.secret', expiresAt: '2026-07-14T20:00:01.000Z' } };
    },
    open(args, response) {
      calls.push({ op: 'open', args });
      response.writeHead(200, { 'content-type': 'application/x-tar', 'cache-control': 'no-store' });
      response.end(Buffer.from('archive'));
      return null;
    },
  };
  const coordination = new baton.CoordinationStore(temporary(t, 'web-routing'));
  const web = new baton.WebNorthbound({
    coordinator: {}, coordination, exportDelivery, repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
    authenticate: async (req) => req.headers.authorization === 'Bearer opaque' ? principal() : null,
  });
  const issueBody = { repoId: REPO_ID, runId: 'run-web-route', exportId };
  const issueReq = new EventEmitter();
  Object.assign(issueReq, {
    method: 'POST', url: '/v1/export-downloads',
    headers: { origin: ORIGIN, authorization: 'Bearer opaque', 'content-type': 'application/json' },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const issueRes = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body = body ? JSON.parse(body) : null; },
  };
  const issuing = web.handle(issueReq, issueRes);
  queueMicrotask(() => { issueReq.emit('data', Buffer.from(JSON.stringify(issueBody))); issueReq.emit('end'); });
  await issuing;
  assert.equal(issueRes.status, 201);
  assert.deepEqual(calls.filter((call) => call.op === 'issue').map((call) => call.coordinates), [issueBody]);

  class DownloadResponse extends EventEmitter {
    constructor() { super(); this.chunks = []; }
    writeHead(status, headers) { this.status = status; this.headers = headers; }
    write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; }
    end(chunk = null) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.ended = true; }
  }
  const downloadReq = new EventEmitter();
  Object.assign(downloadReq, {
    method: 'GET', url: `/v1/exports/${exportId}/archive`,
    headers: { origin: ORIGIN, authorization: 'Bearer opaque', 'x-baton-export-ticket': 'ticket.secret' },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const downloadRes = new DownloadResponse();
  await web.handle(downloadReq, downloadRes);
  assert.equal(downloadRes.status, 200);
  assert.equal(Buffer.concat(downloadRes.chunks).toString(), 'archive');
  const opened = calls.find((call) => call.op === 'open');
  assert.equal(opened.args.ticket, 'ticket.secret');
  assert.equal(opened.args.requestHeaders.range, undefined);
  assert.equal(JSON.stringify(opened.args).includes('/archive'), false);

  for (const request of [
    { url: `/v1/exports/${exportId}/archive?path=/srv/private`, headers: {} },
    { url: `/v1/exports/${exportId}/archive`, headers: { range: 'bytes=0-1' } },
    { url: `/v1/exports/${exportId}/archive`, headers: { 'x-baton-filename': '../../stolen' } },
  ]) {
    const req = new EventEmitter();
    Object.assign(req, {
      method: 'GET', url: request.url,
      headers: { origin: ORIGIN, authorization: 'Bearer opaque', 'x-baton-export-ticket': 'unused', ...request.headers },
      socket: { encrypted: true }, destroy() {},
    });
    const res = new DownloadResponse();
    await web.handle(req, res);
    assert.equal(res.status, 400);
  }
  assert.equal(calls.filter((call) => call.op === 'open').length, 1);

  for (const request of [
    {
      url: '/v1/export-downloads',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
      expectedMethod: 'POST', expectedHeaders: 'content-type,x-baton-csrf',
    },
    {
      url: `/v1/exports/${exportId}/archive`,
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
      expectedMethod: 'GET', expectedHeaders: 'x-baton-export-ticket',
    },
  ]) {
    const req = new EventEmitter();
    Object.assign(req, {
      method: 'OPTIONS', url: request.url, headers: request.headers,
      socket: { encrypted: true }, destroy() {},
    });
    const res = new DownloadResponse();
    await web.handle(req, res);
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(res.headers['access-control-allow-methods'], request.expectedMethod);
    assert.equal(res.headers['access-control-allow-headers'], request.expectedHeaders);
  }
});

test('RD3 RED: client extractor preflights hostile tar-v1 and atomically publishes only an absent destination', (t) => {
  assert.equal(typeof cliModule.extractResultExportArchive, 'function',
    'retained red: safe client archive extraction is not implemented');
  const fixture = materializedExport(t, 'client-extract');
  const safeEntries = archiveEntries(fixture);
  const safeBytes = makeTar(safeEntries);
  const safeDescriptor = descriptor(fixture, safeBytes);
  const parent = temporary(t, 'client-target');
  const destination = join(parent, 'result');
  const delivered = cliModule.extractResultExportArchive({
    archiveBytes: safeBytes, descriptor: safeDescriptor, destination,
  });
  assert.equal(delivered.state, 'delivered');
  assert.equal(readFileSync(join(destination, 'alpha.txt'), 'utf8'), 'alpha\n');
  assert.equal(readFileSync(join(destination, 'bin', 'run.sh'), 'utf8'), '#!/bin/sh\necho retained\n');
  assert.equal(statSync(join(destination, 'alpha.txt')).mode & 0o777, 0o644);
  assert.equal(statSync(join(destination, 'bin', 'run.sh')).mode & 0o777, 0o755);
  assert.equal(existsSync(join(destination, 'manifest.json')), false);
  assert.deepEqual(readdirSync(parent), ['result']);

  const wrongDigestParent = temporary(t, 'wrong-digest');
  assert.throws(() => cliModule.extractResultExportArchive({
    archiveBytes: safeBytes,
    descriptor: { ...safeDescriptor, archiveDigest: '0'.repeat(64) },
    destination: join(wrongDigestParent, 'result'),
  }), (error) => error?.code === 'cli_export_archive_digest_mismatch');
  assert.deepEqual(readdirSync(wrongDigestParent), []);

  const alpha = safeEntries.find((entry) => entry.name === 'tree/alpha.txt');
  const hostileSets = [
    [...safeEntries, { name: '/absolute.txt', mode: 0o644, data: 'escape\n' }],
    [...safeEntries, { name: 'tree/../escape.txt', mode: 0o644, data: 'escape\n' }],
    [...safeEntries, { name: 'tree/link', mode: 0o777, type: '2', linkName: '../../escape', data: Buffer.alloc(0) }],
    [...safeEntries, { name: 'tree/device', mode: 0o600, type: '3', data: Buffer.alloc(0) }],
    [...safeEntries, { ...alpha }],
    safeEntries.filter((entry) => entry.name !== 'tree/alpha.txt'),
    safeEntries.map((entry) => entry.name === 'tree/alpha.txt' ? { ...entry, data: Buffer.from('corrupt\n') } : entry),
    [...safeEntries, { name: 'tree/extra.txt', mode: 0o644, data: 'extra\n' }],
  ];
  for (let index = 0; index < hostileSets.length; index += 1) {
    const hostileParent = temporary(t, `hostile-${index}`);
    const bytes = makeTar(hostileSets[index]);
    assert.throws(() => cliModule.extractResultExportArchive({
      archiveBytes: bytes, descriptor: descriptor(fixture, bytes), destination: join(hostileParent, 'result'),
    }), (error) => error?.code === 'cli_export_archive_invalid', `hostile archive ${index} was not refused`);
    assert.deepEqual(readdirSync(hostileParent), [], `hostile archive ${index} left authoritative residue`);
  }

  const occupiedParent = temporary(t, 'occupied-target');
  const occupied = join(occupiedParent, 'result');
  mkdirSync(occupied);
  assert.throws(() => cliModule.extractResultExportArchive({
    archiveBytes: safeBytes, descriptor: safeDescriptor, destination: occupied,
  }), (error) => error?.code === 'cli_export_destination_exists');
  assert.deepEqual(readdirSync(occupied), []);
});

test('RD3 RED: runBatonCli continues from strict run.export receipt into local authenticated delivery', async () => {
  const exportReceipt = {
    schemaVersion: 1, state: 'completed', format: 'directory-v1', runId: 'run-cli-delivery',
    exportId: '6'.repeat(64), manifestDigest: '7'.repeat(64), receiptDigest: '8'.repeat(64),
  };
  const calls = [];
  const client = {
    async command(name, args, key) {
      calls.push({ op: 'command', name, args, key });
      if (name === 'run.evidence') return { manifestDigest: '9'.repeat(64) };
      return { runId: 'run-cli-delivery', export: exportReceipt };
    },
    async downloadExport(input) {
      calls.push({ op: 'downloadExport', input });
      return { schemaVersion: 1, state: 'delivered', runId: input.runId,
        exportId: input.receipt.exportId, destination: input.destination };
    },
  };
  const result = await cliModule.runBatonCli({
    kind: 'export', runId: 'run-cli-delivery', destination: '/clean/client/result', idempotencyKey: 'cli-delivery',
  }, client);
  assert.equal(result.state, 'delivered');
  assert.deepEqual(calls, [
    { op: 'command', name: 'run.evidence', args: { runId: 'run-cli-delivery' }, key: 'cli-delivery:evidence' },
    { op: 'command', name: 'run.export', args: { runId: 'run-cli-delivery', evidenceDigest: '9'.repeat(64) }, key: 'cli-delivery:export' },
    { op: 'downloadExport', input: {
      runId: 'run-cli-delivery', receipt: exportReceipt, destination: '/clean/client/result',
    } },
  ]);
  assert.equal(JSON.stringify(calls.filter((call) => call.op === 'command')).includes('/clean/client/result'), false);
});

test('RD3 RED: BatonWebClient uses bearer issue/download endpoints and keeps destination client-local', async (t) => {
  assert.equal(typeof cliModule.BatonWebClient.prototype.downloadExport, 'function',
    'retained red: authenticated client archive delivery is not implemented');
  const fixture = materializedExport(t, 'web-client');
  const archiveBytes = makeTar(archiveEntries(fixture));
  const archiveDescriptor = descriptor(fixture, archiveBytes);
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/v1/export-downloads')) {
      return {
        ok: true, status: 201,
        async json() { return { ok: true, ticket: 'one-use.secret', delivery: archiveDescriptor }; },
      };
    }
    if (url.endsWith(`/v1/exports/${fixture.exportId}/archive`)) {
      return {
        ok: true, status: 200,
        headers: new Headers({
          'content-type': 'application/x-tar', 'content-length': String(archiveBytes.length),
          'content-digest': `sha-256=:${Buffer.from(archiveDescriptor.archiveDigest, 'hex').toString('base64')}:`,
          'cache-control': 'no-store',
        }),
        async arrayBuffer() { return archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength); },
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const client = new cliModule.BatonWebClient({
    baseUrl: 'https://baton.example.test', origin: ORIGIN, repoId: REPO_ID, token: 'opaque-bearer',
    commandTimeoutMs: 1_000, pollMs: 10, fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  const destination = join(temporary(t, 'web-client-target'), 'result');
  const delivered = await client.downloadExport({
    runId: fixture.receipt.runId, receipt: fixture.receipt, destination,
  });
  assert.equal(delivered.state, 'delivered');
  assert.equal(readFileSync(join(destination, 'alpha.txt'), 'utf8'), 'alpha\n');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://baton.example.test/v1/export-downloads');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    repoId: REPO_ID, runId: fixture.receipt.runId, exportId: fixture.exportId,
  });
  assert.equal(requests[1].url, `https://baton.example.test/v1/exports/${fixture.exportId}/archive`);
  assert.equal(requests[1].options.headers['x-baton-export-ticket'], 'one-use.secret');
  assert.equal(requests[1].options.headers.authorization, 'Bearer opaque-bearer');
  assert.equal(JSON.stringify(requests).includes(destination), false);
});
