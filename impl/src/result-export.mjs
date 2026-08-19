import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { foldCanonicalCase } from './canonical-order.mjs';

function exportError(message, code) { return Object.assign(new Error(message), { code }); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function canonicalJson(value) { return `${JSON.stringify(canonical(value))}\n`; }
function canonicalDigest(value) { return sha256(JSON.stringify(canonical(value))); }
function exactObject(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');
}

const NO_REPLACE_PYTHON = String.raw`
import ctypes
import errno
import os
import platform
import sys

def fail(token):
    sys.stderr.write(token)
    sys.exit(1)

try:
    root_fd = 3
    source = os.fsencode(sys.argv[1])
    destination = os.fsencode(sys.argv[2])
    expected_dev = int(sys.argv[3])
    expected_ino = int(sys.argv[4])
    root = os.fstat(root_fd)
    if root.st_dev != expected_dev or root.st_ino != expected_ino:
        fail("ROOT_MISMATCH")
    libc = ctypes.CDLL(None, use_errno=True)
    system = platform.system()
    if system == "Darwin":
        operation = libc.renameatx_np
        operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        operation.restype = ctypes.c_int
        result = operation(root_fd, source, root_fd, destination, 0x00000004)
    elif system == "Linux":
        try:
            operation = libc.renameat2
        except AttributeError:
            fail("UNSUPPORTED")
        operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        operation.restype = ctypes.c_int
        result = operation(root_fd, source, root_fd, destination, 1)
    else:
        fail("UNSUPPORTED")
    if result != 0:
        observed = ctypes.get_errno()
        if observed == errno.EEXIST:
            fail("EEXIST")
        if observed == errno.ENOENT:
            fail("SOURCE_MISSING")
        if observed in (errno.ENOSYS, errno.EOPNOTSUPP):
            fail("UNSUPPORTED")
        fail("FAILED")
except SystemExit:
    raise
except Exception:
    fail("FAILED")
`;

function trustedNoReplaceInterpreter() {
  let path;
  let stat;
  try {
    path = realpathSync('/usr/bin/python3');
    stat = lstatSync(path);
  } catch {
    throw exportError('atomic no-replace publication helper is unavailable',
      'result_export_publication_unavailable');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0
    || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
    throw exportError('atomic no-replace publication helper is untrusted',
      'result_export_publication_unavailable');
  }
  return { path, dev: stat.dev, ino: stat.ino };
}

function directChildName(root, path, label) {
  const absolute = resolve(path);
  let parent;
  try { parent = realpathSync(dirname(absolute)); } catch { parent = null; }
  if (parent !== root) {
    throw exportError(`${label} is outside the result export root`, 'result_export_output_mismatch');
  }
  const name = basename(absolute);
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')
    || Buffer.byteLength(name) > 255) {
    throw exportError(`${label} name is invalid`, 'result_export_output_mismatch');
  }
  return name;
}

/** Invoke the host's actual rename-no-replace primitive. The bridge is an absolute, root-owned
 * system interpreter launched in isolated mode with a minimal environment. It receives an already
 * opened export-root directory as fd 3 and only direct child names, so neither PATH nor child-side
 * path resolution participates in the publication effect. */
export function publishResultExportNoReplace({ root: rawRoot, temporary, final }) {
  const root = validateNoReplaceRoot(rawRoot);
  const temporaryName = directChildName(root, temporary, 'result export temporary entry');
  const finalName = directChildName(root, final, 'result export destination');
  if (!ownedPrivateDirectory(temporary)) {
    throw exportError('result export temporary entry is unavailable', 'result_export_output_mismatch');
  }
  const rootFd = openSync(root,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const rootStat = fstatSync(rootFd);
    const interpreter = trustedNoReplaceInterpreter();
    const observedInterpreter = lstatSync(interpreter.path);
    if (observedInterpreter.dev !== interpreter.dev || observedInterpreter.ino !== interpreter.ino) {
      throw exportError('atomic no-replace publication helper changed',
        'result_export_publication_unavailable');
    }
    const result = spawnSync(interpreter.path, [
      '-I', '-S', '-B', '-c', NO_REPLACE_PYTHON,
      temporaryName, finalName, String(rootStat.dev), String(rootStat.ino),
    ], {
      encoding: 'utf8', env: { LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'ignore', 'pipe', rootFd], timeout: 5_000,
      maxBuffer: 4_096, killSignal: 'SIGKILL',
    });
    if (result.status === 0 && result.signal === null && !result.error) return;
    const token = result.stderr?.trim() ?? '';
    if (token === 'EEXIST') throw exportError('result export destination is occupied', 'EEXIST');
    if (['ROOT_MISMATCH', 'SOURCE_MISSING'].includes(token)) {
      throw exportError('result export publication inputs changed', 'result_export_output_mismatch');
    }
    throw exportError('atomic no-replace publication is unavailable',
      'result_export_publication_unavailable');
  } finally {
    closeSync(rootFd);
  }
}

export function validateResultExportRoot(rawRoot) {
  if (typeof rawRoot !== 'string' || !isAbsolute(rawRoot) || !existsSync(rawRoot)) {
    throw exportError('result export root must be one existing absolute deployment directory', 'result_export_root_invalid');
  }
  let stat;
  try { stat = lstatSync(rawRoot); } catch { throw exportError('result export root cannot be inspected', 'result_export_root_invalid'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw exportError('result export root must not be a link or special entry', 'result_export_root_invalid');
  }
  let real;
  try { real = realpathSync(rawRoot); } catch { throw exportError('result export root cannot be resolved', 'result_export_root_invalid'); }
  if ((stat.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw exportError('result export root is not private deployment authority', 'result_export_root_invalid');
  }
  return real;
}

function validateNoReplaceRoot(rawRoot) {
  if (typeof rawRoot !== 'string' || !isAbsolute(rawRoot) || !existsSync(rawRoot)) {
    throw exportError('publication root must be one existing absolute directory',
      'result_export_root_invalid');
  }
  let stat;
  let real;
  try {
    stat = lstatSync(rawRoot);
    real = realpathSync(rawRoot);
  } catch {
    throw exportError('publication root cannot be inspected', 'result_export_root_invalid');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    || (stat.mode & 0o022) !== 0) {
    throw exportError('publication root is unsafe', 'result_export_root_invalid');
  }
  return real;
}

export function identifyResultExportRoot(rawRoot) {
  const root = validateResultExportRoot(rawRoot);
  const stat = lstatSync(root);
  return Object.freeze({
    root,
    identityDigest: sha256(canonicalJson({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o777 })),
  });
}

function processLiveness(pid) {
  try {
    process.kill(pid, 0);
    // #238: a ZOMBIE (killed, not yet reaped) answers kill(0) like a live process with the
    // same start identity — its lease was un-reapable until manual rm (the resident's
    // successor couldn't boot: result_export_root_busy). ps stat 'Z' is positive death
    // evidence: a zombie is a dead process pending reap and can never hold authority.
    return statIsZombie(pid) ? 'dead' : 'alive';
  } catch (cause) {
    if (cause?.code === 'ESRCH') return 'dead';
    if (cause?.code === 'EPERM') return 'alive';
    return 'unknown';
  }
}

/** #238: the zombie-state evidence primitive. A process whose ps state marker starts with
 * 'Z' is dead-pending-reap (kill(0) still answers; the start identity still matches). Never
 * authoritative for an absent pid — absence remains ESRCH's case. */
export function statIsZombie(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    const state = execFileSync('/bin/ps', ['-o', 'state=', '-p', String(pid)], {
      encoding: 'utf8', maxBuffer: 64, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return state.startsWith('Z');
  } catch { return false; }
}

function processStartIdentity(pid) {
  try {
    const output = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output && Buffer.byteLength(output) <= 256 ? output : undefined;
  } catch { return undefined; }
}

function parsedLeaseOwner(bytes, rootIdentityDigest) {
  let owner;
  try { owner = JSON.parse(bytes.toString('utf8')); } catch { return null; }
  const versionOne = exactObject(owner, ['schemaVersion', 'pid', 'nonce', 'rootIdentityDigest'])
    && owner.schemaVersion === 1;
  const versionTwo = exactObject(owner, ['schemaVersion', 'pid', 'pidStart', 'nonce', 'rootIdentityDigest'])
    && owner.schemaVersion === 2 && typeof owner.pidStart === 'string'
    && owner.pidStart.length > 0 && Buffer.byteLength(owner.pidStart) <= 256;
  if ((!versionOne && !versionTwo)
    || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(owner.nonce ?? '')
    || owner.rootIdentityDigest !== rootIdentityDigest) return null;
  return owner;
}

/** Reclaim only one structurally exact lease whose process owner is proved gone. Unknown or
 * malformed residue remains a busy root: recovery never turns ambiguity into deletion authority. */
function reapDeadResultExportRootLease({ root, rootIdentity, lease, rootIdentityDigest }) {
  try {
    assertRootIdentity(root, rootIdentity);
    const leaseIdentity = ownedPrivateDirectory(lease);
    if (!leaseIdentity || bytewiseNames(lease).join('\0') !== 'owner.json') return false;
    const ownerStat = lstatSync(join(lease, 'owner.json'));
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.nlink !== 1
      || (ownerStat.mode & 0o777) !== 0o600 || ownerStat.size <= 0 || ownerStat.size > 16_384) return false;
    const ownerBytes = readExactRegular(join(lease, 'owner.json'), { mode: 0o600, size: ownerStat.size });
    const owner = parsedLeaseOwner(ownerBytes, rootIdentityDigest);
    if (!owner) return false;

    const liveness = processLiveness(owner.pid);
    if (liveness === 'unknown') return false;
    if (liveness === 'alive') {
      if (owner.schemaVersion === 1) return false;
      const observedStart = processStartIdentity(owner.pid);
      if (observedStart === undefined || observedStart === owner.pidStart) return false;
    }

    // Revalidate the exact directory and bytes immediately before removal. A concurrent claimant
    // that changes either identity wins the race and leaves this deployment fail-closed.
    assertRootIdentity(root, rootIdentity);
    const observedLease = ownedPrivateDirectory(lease);
    if (!observedLease || observedLease.dev !== leaseIdentity.dev || observedLease.ino !== leaseIdentity.ino
      || bytewiseNames(lease).join('\0') !== 'owner.json') return false;
    const observedOwner = readExactRegular(join(lease, 'owner.json'), { mode: 0o600, size: ownerBytes.length });
    if (!observedOwner.equals(ownerBytes)) return false;
    rmSync(lease, { recursive: true, force: false });
    fsyncDirectory(root);
    return true;
  } catch { return false; }
}

/** Hold one fail-closed deployment lease for the private export root. A replacement deployment
 * may reconcile one exact dead-process owner; live, malformed, or ambiguous ownership stays busy. */
export function acquireResultExportRootLease(rawRoot) {
  const root = validateResultExportRoot(rawRoot);
  const rootIdentity = lstatSync(root);
  const rootIdentityDigest = sha256(canonicalJson({
    dev: rootIdentity.dev, ino: rootIdentity.ino, uid: rootIdentity.uid, mode: rootIdentity.mode & 0o777,
  }));
  const lease = confinedChild(root, '.baton-export-root-lease');
  let reclaimed = false;
  while (true) {
    try { mkdirSync(lease, { mode: 0o700 }); break; }
    catch (cause) {
      if (cause?.code === 'EEXIST' && !reclaimed
        && reapDeadResultExportRootLease({ root, rootIdentity, lease, rootIdentityDigest })) {
        reclaimed = true;
        continue;
      }
      throw exportError('result export root is already leased', cause?.code === 'EEXIST' ? 'result_export_root_busy' : 'result_export_root_invalid');
    }
  }
  const leaseIdentity = lstatSync(lease);
  const pidStart = processStartIdentity(process.pid);
  const owner = Buffer.from(canonicalJson(pidStart === undefined
    ? { schemaVersion: 1, pid: process.pid, nonce: randomUUID(), rootIdentityDigest }
    : { schemaVersion: 2, pid: process.pid, pidStart, nonce: randomUUID(), rootIdentityDigest }));
  try {
    writeExactFile(join(lease, 'owner.json'), owner, 0o600);
    fsyncDirectory(lease);
    fsyncDirectory(root);
  } catch (cause) {
    try { rmSync(lease, { recursive: true, force: true }); } catch { /* original lease failure wins */ }
    throw exportError('result export root lease could not be recorded', 'result_export_root_invalid');
  }
  let active = true;
  const assertHeld = () => {
    if (!active) throw exportError('result export root lease is released', 'result_export_root_lease_lost');
    assertRootIdentity(root, rootIdentity);
    const observedLease = ownedPrivateDirectory(lease);
    if (!observedLease || observedLease.dev !== leaseIdentity.dev || observedLease.ino !== leaseIdentity.ino) {
      throw exportError('result export root lease changed', 'result_export_root_lease_lost');
    }
    const observedOwner = readExactRegular(join(lease, 'owner.json'), { mode: 0o600, size: owner.length });
    if (!observedOwner.equals(owner)) throw exportError('result export root lease owner changed', 'result_export_root_lease_lost');
    return true;
  };
  const release = () => {
    if (!active) return false;
    assertHeld();
    rmSync(lease, { recursive: true, force: false });
    fsyncDirectory(root);
    active = false;
    return true;
  };
  return Object.freeze({ root, identityDigest: identifyResultExportRoot(root).identityDigest, assertHeld, release });
}

/** One deployment authority for every operation rooted in the result-export directory. Closing
 * seals admission before draining already-admitted asynchronous work, then releases its lease. */
export class ResultExportLifecycle {
  #lease;
  #closing = null;
  #active = new Set();

  constructor(rawRoot, { acquireLease = acquireResultExportRootLease } = {}) {
    this.#lease = acquireLease(rawRoot);
  }

  get root() { return this.#lease.root; }
  get identityDigest() { return this.#lease.identityDigest; }

  #operate(operation) {
    if (this.#closing) {
      throw exportError('result export lifecycle is closing', 'result_export_lifecycle_closed');
    }
    this.#lease.assertHeld();
    const result = operation(this.#lease.root);
    if (!result || typeof result.then !== 'function') {
      this.#lease.assertHeld();
      return result;
    }
    let tracked;
    tracked = Promise.resolve(result)
      .then((value) => {
        this.#lease.assertHeld();
        return value;
      })
      .finally(() => { this.#active.delete(tracked); });
    this.#active.add(tracked);
    return tracked;
  }

  reconcile(exports) {
    return this.#operate((exportRoot) => reconcileResultExportStaging({ exportRoot, exports }));
  }

  deriveArchive({ receipt, maxArchiveBytes }) {
    return this.#operate((exportRoot) => deriveResultExportArchive({ exportRoot, receipt, maxArchiveBytes }));
  }

  materialize(operation) {
    if (typeof operation !== 'function') throw exportError('result export materializer is invalid', 'result_export_invalid');
    return this.#operate((exportRoot) => operation(exportRoot));
  }

  close() {
    if (this.#closing) return this.#closing;
    this.#closing = (async () => {
      await Promise.allSettled([...this.#active]);
      this.#lease.release();
    })();
    return this.#closing;
  }
}

function assertRootIdentity(root, expected) {
  const observed = lstatSync(root);
  if (!observed.isDirectory() || observed.isSymbolicLink()
    || observed.dev !== expected.dev || observed.ino !== expected.ino
    || (observed.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && observed.uid !== process.getuid())) {
    throw exportError('result export root changed during materialization', 'result_export_root_invalid');
  }
}

function git(repoRoot, args, options = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
  };
  try {
    return execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: repoRoot,
      env,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      ...(options.encoding ? { encoding: options.encoding } : {}),
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw exportError('accepted Git object is unavailable', cause?.code === 'ENOBUFS' ? 'result_export_tree_oversize' : 'result_export_source_unavailable');
  }
}

function splitNul(buffer) {
  const rows = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    rows.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) throw exportError('Git tree inventory is not NUL complete', 'result_export_tree_unsafe');
  return rows.filter((row) => row.length > 0);
}

function decodePath(bytes) {
  let path;
  try { path = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw exportError('Git tree path is not valid UTF-8', 'result_export_tree_unsafe'); }
  if (!path || Buffer.from(path, 'utf8').compare(bytes) !== 0 || isAbsolute(path) || path.includes('\\')
    || path.split('/').some((part) => !part || part === '.' || part === '..'
      || foldCanonicalCase(part.normalize('NFKC')) === '.git')
    || Buffer.byteLength(path) > 4_096) {
    throw exportError('Git tree path is unsafe for materialization', 'result_export_tree_unsafe');
  }
  return path;
}

function inventory(repoRoot, resultSha, policy) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(resultSha ?? '')) throw exportError('result SHA is invalid', 'result_export_source_unavailable');
  git(repoRoot, ['cat-file', '-e', `${resultSha}^{commit}`], { stdio: 'ignore' });
  const objectFormat = git(repoRoot, ['rev-parse', '--show-object-format'], { encoding: 'utf8', maxBuffer: 128 }).trim();
  if (!['sha1', 'sha256'].includes(objectFormat)) throw exportError('Git object format is unsupported', 'result_export_source_unavailable');
  const oidLength = objectFormat === 'sha1' ? 40 : 64;
  const metadataCeiling = Math.max(64 * 1024, Math.min(Number.MAX_SAFE_INTEGER, policy.maxBytes + (policy.maxFiles * 4_096)));
  const rows = splitNul(git(repoRoot, ['ls-tree', '-rz', '--full-tree', resultSha], { maxBuffer: metadataCeiling }));
  if (rows.length > policy.maxFiles) throw exportError('result tree exceeds its file ceiling', 'result_export_tree_oversize');
  const decoder = new TextDecoder('ascii', { fatal: true });
  const names = new Set();
  const portableEntries = new Map();
  const files = [];
  let byteCount = 0;
  for (const row of rows) {
    const tab = row.indexOf(9);
    if (tab <= 0) throw exportError('Git tree inventory row is malformed', 'result_export_tree_unsafe');
    let header;
    try { header = decoder.decode(row.subarray(0, tab)); }
    catch { throw exportError('Git tree metadata is malformed', 'result_export_tree_unsafe'); }
    const match = /^(100644|100755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)$/u.exec(header);
    if (!match || match[2].length !== oidLength) throw exportError('links, gitlinks, and special Git entries cannot be exported', 'result_export_tree_unsafe');
    const path = decodePath(row.subarray(tab + 1));
    const components = path.split('/');
    const rawPrefix = [];
    const portablePrefix = [];
    for (let index = 0; index < components.length; index += 1) {
      rawPrefix.push(components[index]);
      portablePrefix.push(foldCanonicalCase(components[index].normalize('NFC')));
      const raw = rawPrefix.join('/');
      const portable = portablePrefix.join('/');
      const kind = index === components.length - 1 ? 'file' : 'directory';
      const prior = portableEntries.get(portable);
      if (prior && (prior.kind !== kind || prior.raw !== raw || kind === 'file')) {
        throw exportError('result tree paths collide', 'result_export_tree_unsafe');
      }
      if (!prior) portableEntries.set(portable, { raw, kind });
    }
    if (names.has(path)) throw exportError('result tree paths collide', 'result_export_tree_unsafe');
    names.add(path);
    const sizeText = git(repoRoot, ['cat-file', '-s', match[2]], { encoding: 'utf8', maxBuffer: 128 }).trim();
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0 || size > policy.maxBytes - byteCount) {
      throw exportError('result tree exceeds its byte ceiling', 'result_export_tree_oversize');
    }
    const bytes = git(repoRoot, ['cat-file', 'blob', match[2]], { maxBuffer: size + 1 });
    if (bytes.length !== size) throw exportError('Git blob changed during materialization', 'result_export_source_unavailable');
    const objectIdentity = createHash(objectFormat).update(`blob ${size}\0`).update(bytes).digest('hex');
    if (objectIdentity !== match[2]) throw exportError('Git blob identity differs from its bytes', 'result_export_source_unavailable');
    byteCount += size;
    files.push({ path, mode: match[1], blob: match[2], digest: sha256(bytes), size, bytes });
  }
  files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const treeOid = git(repoRoot, ['rev-parse', `${resultSha}^{tree}`], { encoding: 'utf8', maxBuffer: 128 }).trim();
  if (!new RegExp(`^[a-f0-9]{${oidLength}}$`, 'u').test(treeOid)) throw exportError('result tree identity is invalid', 'result_export_source_unavailable');
  return { treeOid, files, byteCount };
}

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function fsyncDirectoryTree(root) {
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const child = join(directory, name);
      const stat = lstatSync(child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(child);
    }
    fsyncDirectory(directory);
  };
  visit(root);
}

function writeExactFile(path, bytes, mode) {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags, mode);
  try {
    fchmodSync(fd, mode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function ensurePrivateDirectoryPath(root, path) {
  const relativePath = relative(root, path);
  if (relativePath === '') return;
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw exportError('result export directory escapes deployment ownership', 'result_export_root_invalid');
  }
  let current = root;
  for (const component of relativePath.split(sep)) {
    current = join(current, component);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
      throw exportError('result export directory is unsafe', 'result_export_root_invalid');
    }
  }
}

function confinedChild(root, child) {
  const candidate = resolve(root, child);
  const within = relative(root, candidate);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw exportError('result export destination escapes deployment ownership', 'result_export_root_invalid');
  }
  return candidate;
}

function bytewiseNames(directory) {
  return readdirSync(directory).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function ownedPrivateDirectory(path) {
  let stat;
  try { stat = lstatSync(path); } catch { return null; }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) return null;
  return stat;
}

function moveReservedEntry(root, source, prefix, exportId) {
  while (true) {
    const quarantineName = `${prefix}-${exportId}-${randomUUID()}`;
    const destination = confinedChild(root, quarantineName);
    try {
      publishResultExportNoReplace({ root, temporary: source, final: destination });
      return { destination, quarantineName };
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
  }
}

/** Reconcile only the closed, nonce-bound staging namespace. Unknown but structurally safe stages
 * are moved aside atomically; unrelated entries are deliberately invisible to this authority. */
export function reconcileResultExportStaging({ exportRoot, exports }) {
  const root = validateResultExportRoot(exportRoot);
  if (!Array.isArray(exports)) throw exportError('result export replay state is invalid', 'result_export_invalid');
  const bound = new Map();
  for (const entry of exports) {
    const fields = entry?.receipt === undefined
      ? ['exportId', 'status', 'stagingNonce']
      : ['exportId', 'status', 'stagingNonce', 'receipt'];
    if (!exactObject(entry, fields)
      || !/^[a-f0-9]{64}$/u.test(entry.exportId ?? '')
      || !['pending', 'cancelled', 'completed'].includes(entry.status)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(entry.stagingNonce ?? '')) {
      throw exportError('result export replay state is invalid', 'result_export_invalid');
    }
    const name = `.tmp-${entry.exportId}-${entry.stagingNonce.toLowerCase()}`;
    if (bound.has(name)) throw exportError('result export replay state is ambiguous', 'result_export_invalid');
    bound.set(name, entry);
  }
  const examined = [];
  const removed = [];
  const retained = [];
  const quarantined = [];
  for (const name of bytewiseNames(root)) {
    if (!name.startsWith('.tmp-')) continue;
    examined.push(Object.freeze({ name }));
    const match = /^\.tmp-([a-f0-9]{64})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.exec(name);
    const source = confinedChild(root, name);
    const before = ownedPrivateDirectory(source);
    const entry = match ? bound.get(name) : null;
    if (entry && before && ['pending', 'cancelled'].includes(entry.status)) {
      const moved = moveReservedEntry(root, source, '.reap-stage', entry.exportId);
      const after = ownedPrivateDirectory(moved.destination);
      if (!after || after.dev !== before.dev || after.ino !== before.ino) {
        throw exportError('result export stage identity changed during reconciliation', 'result_export_output_mismatch');
      }
      rmSync(moved.destination, { recursive: true, force: false });
      removed.push(Object.freeze({ name, reason: `${entry.status}_stage` }));
      continue;
    }
    if (entry?.status === 'completed' && before && entry.receipt !== undefined) {
      try {
        deriveResultExportArchive({
          exportRoot: root, receipt: entry.receipt, maxArchiveBytes: Number.MAX_SAFE_INTEGER,
        });
        const moved = moveReservedEntry(root, source, '.reap-stage', entry.exportId);
        const after = ownedPrivateDirectory(moved.destination);
        if (!after || after.dev !== before.dev || after.ino !== before.ino) {
          throw exportError('result export stage identity changed during reconciliation', 'result_export_output_mismatch');
        }
        rmSync(moved.destination, { recursive: true, force: false });
        removed.push(Object.freeze({ name, reason: 'completed_stage' }));
        continue;
      } catch (cause) {
        if (cause?.code === 'result_export_publication_unavailable') throw cause;
        // A completed row is not permission to delete a stage beside an unproved final. The stage
        // is still an owned private directory, so isolate it atomically for operator inspection.
      }
    }
    if (!before) {
      retained.push(Object.freeze({ name, reason: 'unproved_stage' }));
      continue;
    }
    if (!match) {
      const moved = moveReservedEntry(root, source, '.quarantine-stage', sha256(name));
      const after = ownedPrivateDirectory(moved.destination);
      if (!after || after.dev !== before.dev || after.ino !== before.ino) {
        throw exportError('malformed result export stage changed during quarantine', 'result_export_output_mismatch');
      }
      quarantined.push(Object.freeze({
        name, reason: 'malformed_stage', quarantineName: moved.quarantineName,
      }));
      continue;
    }
    if (entry?.status === 'completed') {
      const moved = moveReservedEntry(root, source, '.quarantine-stage', entry.exportId);
      const after = ownedPrivateDirectory(moved.destination);
      if (!after || after.dev !== before.dev || after.ino !== before.ino) {
        throw exportError('completed result export stage changed during quarantine', 'result_export_output_mismatch');
      }
      quarantined.push(Object.freeze({
        name, reason: 'completed_stage_unproved', quarantineName: moved.quarantineName,
      }));
      continue;
    }
    if (!entry && before) {
      const moved = moveReservedEntry(root, source, '.quarantine-stage', match[1]);
      const after = ownedPrivateDirectory(moved.destination);
      if (!after || after.dev !== before.dev || after.ino !== before.ino) {
        throw exportError('result export stage identity changed during quarantine', 'result_export_output_mismatch');
      }
      quarantined.push(Object.freeze({
        name, reason: 'unbound_stage', quarantineName: moved.quarantineName,
      }));
    }
  }
  fsyncDirectory(root);
  return Object.freeze({
    examined: Object.freeze(examined), removed: Object.freeze(removed),
    retained: Object.freeze(retained), quarantined: Object.freeze(quarantined),
  });
}

function readExactRegular(path, { mode = null, size = null } = {}) {
  let before;
  try { before = lstatSync(path); }
  catch { throw exportError('completed result export entry is missing', 'result_export_output_mismatch'); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || (mode !== null && (before.mode & 0o777) !== mode)
    || (size !== null && before.size !== size)) {
    throw exportError('completed result export entry type or mode differs', 'result_export_output_mismatch');
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || (mode !== null && (opened.mode & 0o777) !== mode)
      || (size !== null && opened.size !== size)) {
      throw exportError('completed result export entry changed during verification', 'result_export_output_mismatch');
    }
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

function exactTreeFiles(treeRoot) {
  const rootStat = lstatSync(treeRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700) {
    throw exportError('completed result export tree root differs', 'result_export_output_mismatch');
  }
  const files = [];
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw exportError('completed result export contains a link', 'result_export_output_mismatch');
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o700) throw exportError('completed result export directory mode differs', 'result_export_output_mismatch');
        visit(absolute, path);
      } else if (stat.isFile()) files.push(path);
      else throw exportError('completed result export contains a special entry', 'result_export_output_mismatch');
    }
  };
  visit(treeRoot, '');
  return files.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function verifyMaterialization(exportDirectory, manifestBytes, manifest) {
  const exportStat = lstatSync(exportDirectory);
  if (!exportStat.isDirectory() || exportStat.isSymbolicLink() || (exportStat.mode & 0o777) !== 0o700) {
    throw exportError('completed result export directory differs', 'result_export_output_mismatch');
  }
  const topLevel = readdirSync(exportDirectory).sort();
  if (topLevel.length !== 2 || topLevel[0] !== 'manifest.json' || topLevel[1] !== 'tree') {
    throw exportError('completed result export contains unexpected top-level entries', 'result_export_output_mismatch');
  }
  const observed = readExactRegular(join(exportDirectory, 'manifest.json'), { mode: 0o600, size: manifestBytes.length });
  if (!observed.equals(manifestBytes)) throw exportError('completed result export manifest differs', 'result_export_output_mismatch');
  const treeRoot = join(exportDirectory, 'tree');
  const expectedPaths = manifest.files.map((file) => file.path);
  const observedPaths = exactTreeFiles(treeRoot);
  if (observedPaths.length !== expectedPaths.length
    || observedPaths.some((path, index) => path !== expectedPaths[index])) {
    throw exportError('completed result export file inventory differs', 'result_export_output_mismatch');
  }
  for (const file of manifest.files) {
    const path = confinedChild(treeRoot, file.path);
    const bytes = readExactRegular(path, { mode: file.mode === '100755' ? 0o755 : 0o644, size: file.size });
    if (sha256(bytes) !== file.digest) {
      throw exportError('completed result export file differs', 'result_export_output_mismatch');
    }
  }
}

function tarOctal(value, width) {
  const text = value.toString(8).padStart(width - 1, '0');
  if (text.length !== width - 1) throw exportError('result export archive field exceeds USTAR', 'result_export_archive_oversize');
  return `${text}\0`;
}

function writeTarBytes(target, offset, width, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'ascii');
  if (bytes.length > width) throw exportError('result export path exceeds USTAR', 'result_export_archive_path_unsupported');
  bytes.copy(target, offset);
}

function splitUstarPath(path) {
  const bytes = Buffer.from(path, 'utf8');
  if (bytes.length <= 100) return { name: bytes, prefix: Buffer.alloc(0) };
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = Buffer.from(path.slice(0, index), 'utf8');
    const name = Buffer.from(path.slice(index + 1), 'utf8');
    if (prefix.length <= 155 && name.length <= 100) return { name, prefix };
  }
  throw exportError('result export path exceeds USTAR', 'result_export_archive_path_unsupported');
}

function ustarHeader({ path, mode, size }) {
  const header = Buffer.alloc(512);
  const split = splitUstarPath(path);
  writeTarBytes(header, 0, 100, split.name);
  writeTarBytes(header, 100, 8, tarOctal(mode, 8));
  writeTarBytes(header, 108, 8, tarOctal(0, 8));
  writeTarBytes(header, 116, 8, tarOctal(0, 8));
  writeTarBytes(header, 124, 12, tarOctal(size, 12));
  writeTarBytes(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeTarBytes(header, 257, 6, 'ustar\0');
  writeTarBytes(header, 263, 2, '00');
  writeTarBytes(header, 345, 155, split.prefix);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  writeTarBytes(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

/** Reverify a completed directory-v1 export and derive its versioned deterministic wire archive. */
export function deriveResultExportArchive({ exportRoot, receipt, maxArchiveBytes }) {
  const root = validateResultExportRoot(exportRoot);
  const receiptFields = [
    'schemaVersion', 'state', 'format', 'runId', 'nodeKey', 'resultSha', 'evidenceDigest',
    'exportId', 'locator', 'treeOid', 'manifestDigest', 'fileCount', 'byteCount', 'checks',
    'effects', 'receiptDigest',
  ];
  if (!exactObject(receipt, receiptFields) || receipt.schemaVersion !== 1
    || receipt.state !== 'completed' || receipt.format !== 'directory-v1'
    || !/^[a-f0-9]{64}$/u.test(receipt.exportId ?? '')
    || receipt.locator !== `export:${receipt.exportId}`
    || !/^[a-f0-9]{64}$/u.test(receipt.manifestDigest ?? '')
    || !Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes <= 0) {
    throw exportError('completed result export receipt is invalid', 'result_export_invalid');
  }
  const { receiptDigest, ...receiptCore } = receipt;
  if (receiptDigest !== canonicalDigest(receiptCore)) {
    throw exportError('completed result export receipt digest differs', 'result_export_output_mismatch');
  }
  const directory = confinedChild(root, receipt.exportId);
  const manifestBytes = readExactRegular(join(directory, 'manifest.json'), { mode: 0o600 });
  if (sha256(manifestBytes) !== receipt.manifestDigest) {
    throw exportError('completed result export manifest differs', 'result_export_output_mismatch');
  }
  let manifest;
  try { manifest = JSON.parse(manifestBytes); }
  catch { throw exportError('completed result export manifest is malformed', 'result_export_output_mismatch'); }
  if (canonicalJson(manifest) !== manifestBytes.toString('utf8')
    || manifest.schemaVersion !== 1 || manifest.format !== 'directory-v1'
    || manifest.exportId !== receipt.exportId || manifest.resultSha !== receipt.resultSha
    || manifest.treeOid !== receipt.treeOid || manifest.fileCount !== receipt.fileCount
    || manifest.byteCount !== receipt.byteCount || manifest.evidenceDigest !== receipt.evidenceDigest) {
    throw exportError('completed result export manifest differs from its receipt', 'result_export_output_mismatch');
  }
  verifyMaterialization(directory, manifestBytes, manifest);
  const entries = [
    { path: 'manifest.json', mode: 0o600, bytes: manifestBytes },
    ...manifest.files.map((file) => ({
      path: `tree/${file.path}`,
      mode: file.mode === '100755' ? 0o755 : 0o644,
      bytes: readExactRegular(confinedChild(join(directory, 'tree'), file.path), {
        mode: file.mode === '100755' ? 0o755 : 0o644, size: file.size,
      }),
    })),
  ].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  let archiveBytes = 1024;
  for (const entry of entries) {
    splitUstarPath(entry.path);
    const padded = Math.ceil(entry.bytes.length / 512) * 512;
    if (!Number.isSafeInteger(padded) || archiveBytes > maxArchiveBytes - 512 - padded) {
      throw exportError('result export archive exceeds its byte ceiling', 'result_export_archive_oversize');
    }
    archiveBytes += 512 + padded;
  }
  if (archiveBytes > maxArchiveBytes) {
    throw exportError('result export archive exceeds its byte ceiling', 'result_export_archive_oversize');
  }
  const chunks = [];
  for (const entry of entries) {
    chunks.push(ustarHeader({ path: entry.path, mode: entry.mode, size: entry.bytes.length }), entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  const bytes = Buffer.concat(chunks, archiveBytes);
  const descriptor = Object.freeze({
    schemaVersion: 1, format: 'baton-export-tar-v1', mediaType: 'application/x-tar',
    exportId: receipt.exportId, manifestDigest: receipt.manifestDigest,
    archiveDigest: sha256(bytes), archiveBytes: bytes.length,
  });
  return Object.freeze({ descriptor, bytes });
}

export function materializeResultTree({
  repoRoot, exportRoot, exportId, stagingNonce, resultSha, manifestCore, policy,
  publishNoReplace = publishResultExportNoReplace,
}) {
  const root = validateResultExportRoot(exportRoot);
  const rootIdentity = lstatSync(root);
  if (!/^[a-f0-9]{64}$/u.test(exportId ?? '')
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(stagingNonce ?? '')
    || policy?.format !== 'directory-v1'
    || !Number.isSafeInteger(policy.maxFiles) || policy.maxFiles <= 0
    || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0
    || !exactObject(manifestCore, [
      'repoId', 'runId', 'nodeKey', 'taskId', 'resultSha', 'evidenceDigest',
      'profileDigest', 'exportPolicyDigest', 'goal', 'plan', 'adoptionReceiptDigest',
      'semanticReviewReceiptDigest', 'integrationAfterSha',
    ]) || manifestCore.resultSha !== resultSha) {
    throw exportError('result export request or policy is invalid', 'result_export_invalid');
  }
  const source = inventory(repoRoot, resultSha, policy);
  const manifest = {
    ...manifestCore,
    schemaVersion: 1,
    format: 'directory-v1',
    exportId,
    treeOid: source.treeOid,
    fileCount: source.files.length,
    byteCount: source.byteCount,
    files: source.files.map(({ path, mode, blob, digest, size }) => ({ path, mode, blob, digest, size })),
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const manifestDigest = sha256(manifestBytes);
  const final = confinedChild(root, exportId);
  assertRootIdentity(root, rootIdentity);
  if (existsSync(final)) {
    const stat = lstatSync(final);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw exportError('result export destination is occupied', 'result_export_output_mismatch');
    verifyMaterialization(final, manifestBytes, manifest);
    assertRootIdentity(root, rootIdentity);
    return Object.freeze({ treeOid: source.treeOid, manifestDigest, fileCount: source.files.length, byteCount: source.byteCount, replayed: true });
  }
  const temporary = confinedChild(root, `.tmp-${exportId}-${stagingNonce}`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    const treeRoot = join(temporary, 'tree');
    mkdirSync(treeRoot, { mode: 0o700 });
    for (const file of source.files) {
      const destination = confinedChild(treeRoot, file.path);
      ensurePrivateDirectoryPath(treeRoot, dirname(destination));
      writeExactFile(destination, file.bytes, file.mode === '100755' ? 0o755 : 0o644);
    }
    writeExactFile(join(temporary, 'manifest.json'), manifestBytes, 0o600);
    fsyncDirectoryTree(treeRoot);
    fsyncDirectory(temporary);
    assertRootIdentity(root, rootIdentity);
    try { publishNoReplace({ root, temporary, final, exportId }); }
    catch (cause) {
      if (!existsSync(final)) throw cause;
      verifyMaterialization(final, manifestBytes, manifest);
      rmSync(temporary, { recursive: true, force: true });
    }
    fsyncDirectory(root);
    verifyMaterialization(final, manifestBytes, manifest);
    assertRootIdentity(root, rootIdentity);
    return Object.freeze({ treeOid: source.treeOid, manifestDigest, fileCount: source.files.length, byteCount: source.byteCount, replayed: false });
  } catch (cause) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    if (cause?.code?.startsWith?.('result_export_')) throw cause;
    throw exportError('result export materialization failed', 'result_export_incomplete');
  }
}
