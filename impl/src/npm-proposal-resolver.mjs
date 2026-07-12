import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const typed = (message, code) => Object.assign(new Error(message), { code });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const semver = '(?:0|[1-9]\\d*|[xX*])(?:\\.(?:0|[1-9]\\d*|[xX*])){0,2}(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const comparator = new RegExp(`^(?:\\^|~|<=|>=|<|>|=)?\\s*${semver}$`);
const hyphenRange = new RegExp(`^${semver}\\s+-\\s+${semver}$`);
const exactNpm = (name, version) => packageName.test(name) && exactVersion.test(version);
const npmPackageRoot = (entry) => { let cursor = dirname(entry); for (let depth = 0; depth < 8; depth += 1) { const manifest = join(cursor, 'package.json'); try { if (JSON.parse(readFileSync(manifest)).name === 'npm') return realpathSync(cursor); } catch {} const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; } return null; };
const packageTreeDigest = (root, entryDigest) => {
  if (root === null) return entryDigest;
  const hash = createHash('sha256'); let files = 0; let bytes = 0;
  const walk = (directory, prefix = '') => { for (const name of readdirSync(directory).sort()) { const path = join(directory, name); const logical = prefix ? `${prefix}/${name}` : name; const stat = lstatSync(path); hash.update(`${logical}\0${stat.mode & 0o777}\0`); if (stat.isDirectory()) walk(path, logical); else if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(path)}\0`); else if (stat.isFile()) { files += 1; bytes += stat.size; if (files > 20_000 || bytes > 128 * 1024 * 1024) throw new TypeError('npm package tree exceeds identity bounds'); hash.update(readFileSync(path)); } else throw new TypeError('npm package tree contains unsupported entry'); } };
  walk(root); return hash.digest('hex');
};
const registrySpec = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[:/@\\]/.test(value)) return false;
  return value.split('||').every((set) => {
    const trimmed = set.trim();
    if (!trimmed) return false;
    if (hyphenRange.test(trimmed)) return true;
    return trimmed.replace(/([<>]=?|[~^=])\s+/g, '$1').split(/\s+/).every((token) => comparator.test(token));
  });
};
const validDependencyMaps = (item) => ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'].every((field) =>
  item[field] === undefined || (item[field] && typeof item[field] === 'object' && !Array.isArray(item[field])
    && Object.entries(item[field]).every(([name, spec]) => packageName.test(name) && registrySpec(spec))));
const validResolutionMetadata = (item) => item && typeof item === 'object' && !Array.isArray(item) && validDependencyMaps(item)
  && ['workspaces', 'overrides', 'resolutions', 'pnpm'].every((field) => !Object.hasOwn(item, field));
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const processIdentity = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try { process.kill(pid, 0); } catch (error) { return error?.code === 'ESRCH' ? null : undefined; }
  try { const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (value) return value; } catch {}
  try { process.kill(pid, 0); return undefined; } catch (error) { return error?.code === 'ESRCH' ? null : undefined; }
};
const ownerState = (owner) => { if (!owner || typeof owner.pidStart !== 'string') return 'stale'; const observed = processIdentity(owner.pid); return observed === undefined ? 'unknown' : observed === owner.pidStart ? 'active' : 'stale'; };
const publishExclusive = (path, bytes) => {
  const candidate = `${path}.candidate-${randomUUID()}`; let fd;
  try { fd = openSync(candidate, 'wx', 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined; try { linkSync(candidate, path); const directoryFd = openSync(dirname(path), 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); } return true; } catch (error) { if (error?.code === 'EEXIST') return false; throw error; } }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} rmSync(candidate, { force: true }); }
};
const markerPids = (invocationId) => {
  let output;
  try { output = execFileSync('/bin/ps', ['eww', '-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { return null; }
  const marker = `BATON_INVOCATION_ID=${invocationId}`;
  return output.split('\n').flatMap((line) => {
    if (!line.includes(marker)) return [];
    const match = /^\s*(\d+)\s/.exec(line); const pid = Number(match?.[1]);
    return Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid ? [pid] : [];
  });
};
const descendants = (rootPid) => {
  let output; try { output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); } catch { return null; }
  const children = new Map(); for (const line of output.split('\n')) { const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line); if (!match) continue; const pid = Number(match[1]); const ppid = Number(match[2]); if (!children.has(ppid)) children.set(ppid, []); children.get(ppid).push(pid); }
  const found = []; const pending = [rootPid]; while (pending.length) { const pid = pending.pop(); if (!Number.isSafeInteger(pid) || found.includes(pid)) continue; found.push(pid); pending.push(...(children.get(pid) ?? [])); } return found;
};
function reapInvocation(invocationId, groupPid = null, tracked = []) {
  if (typeof invocationId !== 'string' || !/^[0-9a-f-]{36}$/.test(invocationId)) return false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pids = markerPids(invocationId); if (pids === null) return false;
    const observedTracked = tracked.map((row) => ({ row, observed: Number.isSafeInteger(row?.pid) && typeof row?.identity === 'string' ? processIdentity(row.pid) : null })); if (observedTracked.some(({ observed }) => observed === undefined)) return false;
    const trackedAlive = observedTracked.filter(({ row, observed }) => observed === row.identity).map(({ row }) => row.pid);
    if (pids.length === 0 && trackedAlive.length === 0) return true;
    if (Number.isSafeInteger(groupPid) && pids.includes(groupPid)) { try { process.kill(-groupPid, 'SIGKILL'); } catch {} }
    for (const pid of [...new Set([...pids, ...trackedAlive])]) try { process.kill(pid, 'SIGKILL'); } catch {}
    pause(10);
  }
  const markers = markerPids(invocationId); const trackedObserved = tracked.map((row) => ({ row, observed: processIdentity(row.pid) })); if (trackedObserved.some(({ observed }) => observed === undefined)) return false; const trackedAlive = trackedObserved.filter(({ row, observed }) => observed === row.identity);
  return markers?.length === 0 && trackedAlive.length === 0;
}
const sandboxQuote = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const sandboxProfile = (root, port) => `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath "${sandboxQuote(root)}"))\n(deny network*)\n(allow network-outbound (remote tcp "localhost:${port}"))\n`;

async function exactRegistryProxy(origin, credential) {
  const target = new URL(origin); const authority = `${target.hostname}:${target.port || '443'}`; const sockets = new Set();
  const expectedCredential = Buffer.from(`baton:${credential}`).toString('base64');
  let accepted = 0; let rejected = 0;
  const server = createServer((client) => {
    sockets.add(client); client.on('close', () => sockets.delete(client)); let header = Buffer.alloc(0); let decided = false;
    const refuse = () => { rejected += 1; client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); };
    client.on('data', function inspect(chunk) {
      if (decided) return; header = Buffer.concat([header, chunk]);
      if (header.length > 8192) { decided = true; refuse(); return; }
      const end = header.indexOf('\r\n\r\n'); if (end < 0) return; decided = true; client.removeListener('data', inspect);
      const lines = header.subarray(0, end).toString('ascii').split('\r\n'); const line = lines[0];
      const authorization = lines.slice(1).find((value) => value.toLowerCase().startsWith('proxy-authorization:'))?.slice('proxy-authorization:'.length).trim();
      const [scheme, encoded, extra] = authorization?.split(/\s+/) ?? [];
      if (line !== `CONNECT ${authority} HTTP/1.1` || scheme?.toLowerCase() !== 'basic' || encoded !== expectedCredential || extra !== undefined) { refuse(); return; }
      accepted += 1; const upstream = connect(Number(target.port || 443), target.hostname); sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); const remainder = header.subarray(end + 4); if (remainder.length) upstream.write(remainder); client.pipe(upstream); upstream.pipe(client); });
      upstream.once('error', () => client.destroy()); client.once('error', () => upstream.destroy());
    });
  });
  server.on('connection', (socket) => socket.setTimeout(60_000, () => socket.destroy()));
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolvePromise(); }); });
  const port = server.address().port;
  return { port, authority, stats: () => ({ accepted, rejected }), close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolvePromise) => server.close(() => resolvePromise())); } };
}

export class NpmProposalResolver {
  constructor(opts = {}) {
    if (typeof opts.root !== 'string' || opts.root.length === 0 || typeof opts.npmPath !== 'string' || !isAbsolute(opts.npmPath)
      || !Array.isArray(opts.allowedRegistryOrigins) || opts.allowedRegistryOrigins.length !== 1
      || !Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs <= 0 || !Number.isSafeInteger(opts.maxOutputBytes) || opts.maxOutputBytes <= 0) throw new TypeError('npm proposal resolver requires owned root, absolute npm identity, registry, timeout, and output ceiling');
    const registry = new URL(opts.allowedRegistryOrigins[0]); if (registry.protocol !== 'https:' || registry.origin !== opts.allowedRegistryOrigins[0] || registry.username || registry.password) throw new TypeError('npm proposal registry must be one exact HTTPS origin');
    const sandboxPath = opts.sandboxPath ?? '/usr/bin/sandbox-exec'; const nodePath = opts.nodePath ?? process.execPath;
    if (typeof sandboxPath !== 'string' || !isAbsolute(sandboxPath) || typeof nodePath !== 'string' || !isAbsolute(nodePath)) throw new TypeError('npm proposal resolver requires absolute OS sandbox and Node runtime identities');
    this.npmPath = realpathSync(opts.npmPath); this.sandboxPath = realpathSync(sandboxPath); this.nodePath = realpathSync(nodePath);
    this.runtimePath = `${dirname(this.nodePath)}:/usr/bin:/bin`;
    this.npmVersion = execFileSync(this.nodePath, [this.npmPath, '--version'], { encoding: 'utf8', timeout: opts.timeoutMs, env: { PATH: this.runtimePath } }).trim();
    if (!this.npmVersion || (opts.npmVersion !== undefined && opts.npmVersion !== this.npmVersion)) throw new TypeError('configured npm version does not match executable');
    this.npmDigest = sha(readFileSync(this.npmPath)); this.npmPackageRoot = npmPackageRoot(this.npmPath); this.npmPackageDigest = packageTreeDigest(this.npmPackageRoot, this.npmDigest); this.sandboxDigest = sha(readFileSync(this.sandboxPath)); this.nodeDigest = sha(readFileSync(this.nodePath));
    const root = resolve(opts.root); mkdirSync(root, { recursive: true, mode: 0o700 }); this.root = realpathSync(root); this.leasePath = join(this.root, 'supervisor.lock'); this.takeoverPath = join(this.root, 'supervisor.takeover'); this.leaseToken = randomUUID(); this.pidStart = processIdentity(process.pid);
    if (!this.pidStart) throw typed('npm proposal supervisor process identity is unavailable', 'proposal_reconcile_failed');
    this._acquireLease();
    try {
      for (const entry of readdirSync(this.root)) if (entry.startsWith('invocation-')) {
        const invocationId = entry.slice('invocation-'.length); let owner = null;
        try { owner = JSON.parse(readFileSync(join(this.root, entry, 'owner.json'))); } catch {}
        if (owner && owner.invocationId !== invocationId) throw typed('npm proposal orphan identity is invalid', 'proposal_reconcile_failed');
        if (/^[0-9a-f-]{36}$/.test(invocationId) && !reapInvocation(invocationId, owner?.pid, owner?.tracked)) throw typed('npm proposal orphan subprocesses could not be reaped', 'proposal_reconcile_failed');
        rmSync(join(this.root, entry), { recursive: true, force: true });
      }
    } catch (error) { this.close(); throw error; }
    this.registryOrigins = Object.freeze([...opts.allowedRegistryOrigins]); this.timeoutMs = opts.timeoutMs; this.maxOutputBytes = opts.maxOutputBytes; this.reconciled = true;
  }

  _acquireLease() {
    const ownerBytes = `${JSON.stringify({ pid: process.pid, pidStart: this.pidStart, token: this.leaseToken, startedAt: new Date().toISOString() })}\n`;
    const takeoverBytes = `${JSON.stringify({ pid: process.pid, pidStart: this.pidStart, token: this.leaseToken })}\n`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (existsSync(this.takeoverPath)) {
        let fd; let incumbent; let observed;
        try { fd = openSync(this.takeoverPath, 'r'); const raw = readFileSync(fd, { encoding: 'utf8' }); observed = fstatSync(fd); try { incumbent = JSON.parse(raw); } catch { incumbent = null; } } catch { if (fd !== undefined) try { closeSync(fd); } catch {} continue; } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
        const takeoverState = ownerState(incumbent); if (takeoverState === 'active') throw typed('npm proposal resolver root is being acquired', 'proposal_supervisor_busy'); if (takeoverState === 'unknown') throw typed('npm proposal takeover liveness is unknown', 'proposal_reconcile_failed');
        const quarantine = join(this.root, `supervisor.takeover.stale-${randomUUID()}`);
        try { renameSync(this.takeoverPath, quarantine); } catch (error) { if (error?.code === 'ENOENT') continue; throw typed('npm proposal supervisor takeover reconciliation failed', 'proposal_reconcile_failed'); }
        const moved = statSync(quarantine);
        if (moved.dev !== observed.dev || moved.ino !== observed.ino) { try { if (!existsSync(this.takeoverPath)) renameSync(quarantine, this.takeoverPath); } catch {} throw typed('npm proposal resolver root is being acquired', 'proposal_supervisor_busy'); }
        rmSync(quarantine, { force: true }); continue;
      }
      try { if (publishExclusive(this.leasePath, ownerBytes)) return; throw Object.assign(new Error('lease exists'), { code: 'EEXIST' }); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let owner = null; try { owner = JSON.parse(readFileSync(this.leasePath)); } catch {}
        const leaseState = ownerState(owner); if (leaseState === 'active') throw typed('npm proposal resolver root already has a live supervisor', 'proposal_supervisor_busy'); if (leaseState === 'unknown') throw typed('npm proposal supervisor liveness is unknown', 'proposal_reconcile_failed');
        try { if (!publishExclusive(this.takeoverPath, takeoverBytes)) continue; } catch { throw typed('npm proposal supervisor takeover failed', 'proposal_reconcile_failed'); }
        let owns = false; try { const claim = JSON.parse(readFileSync(this.takeoverPath)); owns = claim.pid === process.pid && claim.pidStart === this.pidStart && claim.token === this.leaseToken; } catch {}
        if (!owns) continue;
        try {
          let current = null; try { current = JSON.parse(readFileSync(this.leasePath)); } catch {}
          const currentState = ownerState(current); if (currentState === 'active') throw typed('npm proposal resolver root became active', 'proposal_supervisor_busy'); if (currentState === 'unknown') throw typed('npm proposal supervisor liveness became unknown', 'proposal_reconcile_failed');
          rmSync(this.leasePath, { force: true }); if (!publishExclusive(this.leasePath, ownerBytes)) throw typed('npm proposal supervisor lease race', 'proposal_supervisor_busy'); rmSync(this.takeoverPath, { force: true }); return;
        } catch (takeoverError) { try { const claim = JSON.parse(readFileSync(this.takeoverPath)); if (claim.token === this.leaseToken) rmSync(this.takeoverPath, { force: true }); } catch {} throw takeoverError; }
      }
    }
    throw typed('npm proposal supervisor lease could not be acquired', 'proposal_supervisor_busy');
  }

  close() {
    try { const owner = JSON.parse(readFileSync(this.leasePath)); if (owner.pid === process.pid && owner.pidStart === this.pidStart && owner.token === this.leaseToken) rmSync(this.leasePath, { force: true }); } catch {}
    this.reconciled = false;
  }

  card() { return Object.freeze({ resolverId: 'npm-isolated-supervisor', tool: 'npm', toolVersion: this.npmVersion, toolDigest: this.npmDigest, toolPackageDigest: this.npmPackageDigest, runtime: 'node', runtimeDigest: this.nodeDigest, sandbox: 'macos-seatbelt-exact-proxy-tracked', sandboxDigest: this.sandboxDigest, reconciled: this.reconciled }); }

  verifyReceipt(receipt, expected) {
    const id = receipt?.isolation?.invocationId;
    const ok = typeof id === 'string' && receipt.isolation.rootHandle === `owned:${id}:root` && receipt.isolation.cacheHandle === `owned:${id}:cache` && receipt.isolation.rootPath === join(this.root, `invocation-${id}`)
      && receipt.resolverId === 'npm-isolated-supervisor' && receipt.tool === 'npm' && receipt.toolVersion === this.npmVersion && receipt.toolPath === this.npmPath && receipt.toolDigest === this.npmDigest && receipt.toolPackageRoot === this.npmPackageRoot && receipt.toolPackageDigest === this.npmPackageDigest
      && receipt.runtime === 'node' && receipt.runtimePath === this.nodePath && receipt.runtimeDigest === this.nodeDigest
      && receipt.sandbox === 'macos-seatbelt-exact-proxy-tracked' && receipt.sandboxPath === this.sandboxPath && receipt.sandboxDigest === this.sandboxDigest
      && receipt.baseDigest === expected.baseDigest && receipt.manifestDigest === expected.manifestDigest && receipt.proposedDigest === expected.proposedDigest
      && receipt.coordinate?.ecosystem === expected.coordinate.ecosystem && receipt.coordinate?.package === expected.coordinate.package && receipt.coordinate?.version === expected.coordinate.version
      && Array.isArray(receipt.argv) && receipt.argv.length === expected.argv.length && receipt.argv.every((value, index) => value === expected.argv[index])
      && Array.isArray(receipt.registryOrigins) && receipt.registryOrigins.length === expected.allowedRegistryOrigins.length && receipt.registryOrigins.every((value, index) => value === expected.allowedRegistryOrigins[index])
      && receipt.network?.directOutbound === false && receipt.network?.proxyAuthenticated === true && receipt.network?.proxyAuthority === `${new URL(this.registryOrigins[0]).hostname}:${new URL(this.registryOrigins[0]).port || '443'}` && Number.isSafeInteger(receipt.network?.localProxyPort) && receipt.network.localProxyPort > 0 && receipt.network?.rejected === 0
      && receipt.sandboxProfile?.processContainment === 'tracked-ancestry+marker' && receipt.sandboxProfile?.writeRoot === receipt.isolation?.rootPath
      && receipt.sandboxProfile?.digest === sha(sandboxProfile(receipt.isolation.rootPath, receipt.network.localProxyPort))
      && receipt.isolatedRoot === true && receipt.ownedCache === true && receipt.exitCode === 0
      && receipt.cleanup?.processes === true && receipt.cleanup?.root === true && receipt.cleanup?.cache === true && receipt.cleanup?.credentials === true && receipt.cleanup?.proxy === true;
    return { ok, reason: ok ? null : 'receipt_mismatch' };
  }

  async resolve(request, ctx = {}) {
    if (!this.reconciled || request?.coordinate?.ecosystem !== 'npm' || !exactNpm(request.coordinate.package, request.coordinate.version)
      || !Buffer.isBuffer(request.baseLockfile) || sha(request.baseLockfile) !== request.baseDigest || !Buffer.isBuffer(request.manifest) || sha(request.manifest) !== request.manifestDigest) throw typed('npm proposal request is invalid', 'invalid_proposal');
    if (ctx.signal?.aborted) throw typed('npm proposal cancelled', 'cancelled');
    try { if (realpathSync(this.npmPath) !== this.npmPath || realpathSync(this.nodePath) !== this.nodePath || realpathSync(this.sandboxPath) !== this.sandboxPath || sha(readFileSync(this.nodePath)) !== this.nodeDigest || sha(readFileSync(this.sandboxPath)) !== this.sandboxDigest || packageTreeDigest(this.npmPackageRoot, sha(readFileSync(this.npmPath))) !== this.npmPackageDigest) throw new Error('identity changed'); }
    catch { throw typed('npm proposal tool identity changed', 'proposal_policy_violation'); }
    let base; let manifest; try { base = JSON.parse(request.baseLockfile); manifest = JSON.parse(request.manifest); } catch { throw typed('npm proposal base is invalid', 'proposal_schema_invalid'); }
    const rootEntry = base.packages?.[''];
    if (base.lockfileVersion !== 3 || !rootEntry || typeof rootEntry.name !== 'string' || typeof rootEntry.version !== 'string' || manifest?.name !== rootEntry.name || manifest?.version !== rootEntry.version
      || !validResolutionMetadata(rootEntry) || !validResolutionMetadata(manifest)) throw typed('npm proposal base root contains unsupported dependency sources', 'proposal_policy_violation');
    let setupAborted = false; const setupAbort = () => { setupAborted = true; }; ctx.signal?.addEventListener?.('abort', setupAbort, { once: true });
    const invocationId = randomUUID(); const invocationRoot = join(this.root, `invocation-${invocationId}`); const work = join(invocationRoot, 'work'); const cache = join(invocationRoot, 'cache');
    mkdirSync(work, { recursive: true, mode: 0o700 }); mkdirSync(cache, { recursive: true, mode: 0o700 });
    const coordinate = request.coordinate; const argv = ['install', `${coordinate.package}@${coordinate.version}`, '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'];
    let proposedLockfile; let failure = null; let childPid = null; let cleanupFailure = null; let proxy = null; let proxyStats = null; let trackingFailed = false; const tracked = new Map();
    try {
      writeFileSync(join(work, 'package-lock.json'), request.baseLockfile, { mode: 0o600 });
      const proposedManifest = structuredClone(manifest); proposedManifest.dependencies = { ...(proposedManifest.dependencies ?? {}), [coordinate.package]: coordinate.version };
      if (proposedManifest.optionalDependencies) delete proposedManifest.optionalDependencies[coordinate.package];
      writeFileSync(join(work, 'package.json'), `${JSON.stringify(proposedManifest)}\n`, { mode: 0o600 });
      const userConfig = join(invocationRoot, 'user.npmrc'); const globalConfig = join(invocationRoot, 'global.npmrc'); writeFileSync(userConfig, '', { mode: 0o600 }); writeFileSync(globalConfig, '', { mode: 0o600 });
      mkdirSync(join(invocationRoot, 'tmp'), { recursive: true, mode: 0o700 }); const proxyCredential = randomUUID(); proxy = await exactRegistryProxy(this.registryOrigins[0], proxyCredential);
      if (setupAborted || ctx.signal?.aborted) throw typed('npm proposal cancelled', 'cancelled');
      const profileText = sandboxProfile(invocationRoot, proxy.port); const profilePath = join(invocationRoot, 'sandbox.sb'); writeFileSync(profilePath, profileText, { mode: 0o600 });
      ctx.signal?.removeEventListener?.('abort', setupAbort);
      await new Promise((resolvePromise, reject) => {
        const proxyUrl = `http://baton:${proxyCredential}@127.0.0.1:${proxy.port}`;
        const child = spawn(this.sandboxPath, ['-f', profilePath, this.nodePath, this.npmPath, ...argv], { cwd: work, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: this.runtimePath, HOME: invocationRoot, TMPDIR: join(invocationRoot, 'tmp'), BATON_INVOCATION_ID: invocationId, HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, NO_PROXY: '', npm_config_proxy: proxyUrl, npm_config_https_proxy: proxyUrl, npm_config_cache: cache, npm_config_registry: `${this.registryOrigins[0]}/`, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig } }); childPid = child.pid;
        const ownerPath = join(invocationRoot, 'owner.json'); const ownerNext = join(invocationRoot, 'owner.next');
        const persistOwner = () => { writeFileSync(ownerNext, `${JSON.stringify({ pid: childPid, npmPath: this.npmPath, invocationId, tracked: [...tracked].map(([pid, identity]) => ({ pid, identity })) })}\n`, { mode: 0o600 }); renameSync(ownerNext, ownerPath); };
        const capture = () => { try { const pids = descendants(childPid); if (pids === null) { trackingFailed = true; return; } let changed = false; for (const pid of pids) if (!tracked.has(pid)) { const identity = processIdentity(pid); if (identity === undefined) { trackingFailed = true; continue; } if (identity !== null) { tracked.set(pid, identity); changed = true; } } if (changed) persistOwner(); } catch { trackingFailed = true; } };
        capture(); const monitor = setInterval(capture, 5); monitor.unref?.();
        let bytes = 0; let settled = false; let timer; const abort = () => finish(typed('npm proposal cancelled', 'cancelled'));
        const finish = (error) => { if (settled) return; settled = true; clearInterval(monitor); capture(); clearTimeout(timer); ctx.signal?.removeEventListener?.('abort', abort); if (childPid) reapInvocation(invocationId, childPid, [...tracked].map(([pid, identity]) => ({ pid, identity }))); error ? reject(error) : resolvePromise(); };
        const boundedOutput = (chunk) => { bytes += chunk.length; if (bytes > this.maxOutputBytes) finish(typed('npm proposal output exceeded ceiling', 'proposal_oversize')); };
        child.stdout.on('data', boundedOutput); child.stderr.on('data', boundedOutput); child.on('error', finish); child.on('close', (code, signal) => code === 0 ? finish() : finish(Object.assign(new Error('npm proposal failed'), { exitCode: code, signal })));
        timer = setTimeout(() => finish(typed('npm proposal timed out', 'proposal_timeout')), this.timeoutMs); timer.unref?.(); ctx.signal?.addEventListener?.('abort', abort, { once: true });
      });
      const proposedPath = join(work, 'package-lock.json'); if (statSync(proposedPath).size > this.maxOutputBytes) throw typed('npm proposal lockfile exceeded ceiling', 'proposal_oversize'); proposedLockfile = readFileSync(proposedPath);
    } catch (error) { failure = error; }
    finally {
      if (trackingFailed || (childPid && !reapInvocation(invocationId, childPid, [...tracked].map(([pid, identity]) => ({ pid, identity }))))) cleanupFailure = typed('npm proposal subprocess cleanup failed', 'proposal_cleanup_failed');
      if (proxy) { try { await proxy.close(); } catch (error) { cleanupFailure ??= error; } proxyStats = proxy.stats(); }
      try { rmSync(invocationRoot, { recursive: true, force: true }); } catch (error) { cleanupFailure ??= error; }
      ctx.signal?.removeEventListener?.('abort', setupAbort);
    }
    if (cleanupFailure) throw typed('npm proposal cleanup failed', 'proposal_cleanup_failed');
    if (failure) {
      if (failure?.code && typeof failure.code === 'string' && (failure.code.startsWith('proposal_') || failure.code === 'cancelled')) throw failure;
      const error = typed('npm proposal resolver failed', 'proposal_resolver_failed'); error.resolverExitCode = failure?.exitCode ?? null; error.resolverSignal = failure?.signal ?? null; throw error;
    }
    if (proxyStats?.rejected !== 0) throw typed('npm proposal attempted network access outside the configured registry', 'proposal_network_violation');
    if (!proposedLockfile || existsSync(invocationRoot)) throw typed('npm proposal isolation failed', 'proposal_cleanup_failed');
    const profileDigest = sha(sandboxProfile(invocationRoot, proxy.port));
    return Object.freeze({ proposedLockfile, receipt: Object.freeze({ schemaVersion: 1, resolverId: 'npm-isolated-supervisor', tool: 'npm', toolVersion: this.npmVersion, toolPath: this.npmPath, toolDigest: this.npmDigest, toolPackageRoot: this.npmPackageRoot, toolPackageDigest: this.npmPackageDigest, runtime: 'node', runtimePath: this.nodePath, runtimeDigest: this.nodeDigest, sandbox: 'macos-seatbelt-exact-proxy-tracked', sandboxPath: this.sandboxPath, sandboxDigest: this.sandboxDigest, sandboxProfile: { digest: profileDigest, writeRoot: invocationRoot, processContainment: 'tracked-ancestry+marker' }, argv, baseDigest: request.baseDigest, manifestDigest: request.manifestDigest, proposedDigest: sha(proposedLockfile), coordinate, isolatedRoot: true, ownedCache: true, isolation: { invocationId, rootHandle: `owned:${invocationId}:root`, cacheHandle: `owned:${invocationId}:cache`, rootPath: invocationRoot }, registryOrigins: [...this.registryOrigins], network: { directOutbound: false, proxyAuthenticated: true, proxyAuthority: proxy.authority, localProxyPort: proxy.port, accepted: proxyStats.accepted, rejected: proxyStats.rejected }, exitCode: 0, cleanup: { processes: true, root: true, cache: true, credentials: true, proxy: true } }) });
  }
}
