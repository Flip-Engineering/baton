import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, rmSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { APPLICATION_SEMANTIC_REGISTRY, canonicalRunPhase } from './application-semantics.mjs';
import { bindBatonPort } from './application-client.mjs';
import { foldCanonicalCase } from './canonical-order.mjs';
import { createLocalSocketFetch } from './local-web-transport.mjs';
import { publishResultExportNoReplace } from './result-export.mjs';

export const CLI_WEB_COMMANDS = new Set([
  'application.help',
  'runs.list',
  'run.start', 'run.inspect', 'run.episode', 'run.workstreams',
  'run.workstream.notify', 'run.workstream.stop', 'run.act',
  'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer',
  'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification',
  'run.resume_work', 'run.review', 'run.integrate', 'run.export',
  // S-1 v2: portable atomic attach-and-harvest.
  'waves.attach',
]);
// CS-2 (control-surface v2): the five web-admitted verbs (run.episode, run.workstreams,
// run.workstream.notify, run.workstream.stop; run.result folds to run.episode) join the
// CLI web-client whitelist. Host-local-only verbs stay out: run.debug (CS-3) and
// application.context_eval (parse-time refusal naming embedded/MCP paths).
// docs/36 §7.1 / §9 M5 — the CLI's wait/follow stop set is the canonical settled/terminal
// vocabulary (legacy `work_completed` resolves to `result_ready`). Every membership check
// canonicalizes its input, so a still-legacy view phase and its canonical spelling behave alike.
const TERMINAL_RUN_PHASES = new Set(['result_ready', 'completed', 'failed', 'cancelled', 'denied', 'stopped']);
const CONNECTION_ENV = Object.freeze(['BATON_URL', 'BATON_ORIGIN', 'BATON_REPO_ID', 'BATON_TOKEN']);
const DEFAULT_APPLICATION_WAIT_MS = 30_000;
const WEB_WAIT_TRANSPORT_SLACK_MS = 15_000;
const RESIDENT_PROFILE_FIELDS = Object.freeze([
  'schemaVersion', 'transport', 'socketPath', 'url', 'origin', 'tokenFile', 'deploymentId',
  'incarnation', 'registryDigest', 'startedAt',
]);
const RESIDENT_PROFILE_OWNER_FIELDS = Object.freeze(['ownerPid', 'ownerPidStart']);

function cliError(message, code = 'cli_invalid') { return Object.assign(new Error(message), { code }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function exactKeys(value, keys, label) {
  if (!record(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw cliError(`${label} has unknown or missing fields`, 'cli_config_invalid');
  }
}
function residentProfileKeys(value) {
  const ownerFields = RESIDENT_PROFILE_OWNER_FIELDS.filter((field) => Object.hasOwn(value ?? {}, field));
  return ownerFields.length === RESIDENT_PROFILE_OWNER_FIELDS.length
    ? [...RESIDENT_PROFILE_FIELDS, ...RESIDENT_PROFILE_OWNER_FIELDS]
    : RESIDENT_PROFILE_FIELDS;
}
function residentProfileOwnerValid(value) {
  const fields = RESIDENT_PROFILE_OWNER_FIELDS.filter((field) => Object.hasOwn(value ?? {}, field));
  return fields.length === 0 || (fields.length === RESIDENT_PROFILE_OWNER_FIELDS.length
    && Number.isSafeInteger(value.ownerPid) && value.ownerPid > 0
    && nonempty(value.ownerPidStart) && Buffer.byteLength(value.ownerPidStart) <= 256);
}
function take(args, name, { required = false } = {}) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw cliError(`${name} is required`);
    return null;
  }
  if (index === args.length - 1 || args[index + 1].startsWith('--')) throw cliError(`${name} requires a value`);
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}
function takeAll(args, name) {
  const values = [];
  for (;;) {
    const index = args.indexOf(name);
    if (index === -1) return values;
    if (index === args.length - 1 || args[index + 1].startsWith('--')) {
      throw cliError(`${name} requires a value`);
    }
    values.push(args[index + 1]);
    args.splice(index, 2);
  }
}
function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}
function noRemainder(args) { if (args.length > 0) throw cliError(`unexpected argument ${args[0]}`); }
function id(value, label) {
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? '')) throw cliError(`${label} is invalid`);
  return value;
}
function digest(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? '')) throw cliError(`${label} is invalid`);
  return value;
}
function route(value) {
  const slash = value?.indexOf('/') ?? -1;
  const at = value?.lastIndexOf('@') ?? -1;
  if (slash <= 0 || at <= slash + 1 || at === value.length - 1) throw cliError('--exact must be HARNESS/MODEL@EFFORT');
  return { harness: value.slice(0, slash), model: value.slice(slash + 1, at), effort: value.slice(at + 1) };
}
function duration(value) {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(value ?? '');
  if (!match) throw cliError('duration must use ms, s, m, or h');
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  const milliseconds = Number(match[1]) * scale;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 86_400_000) throw cliError('duration is outside the Run wait ceiling');
  return milliseconds;
}

function readBoundedFile(path, label, { ownerOnly = false, ownerUid = null } = {}) {
  let before;
  try { before = lstatSync(path); }
  catch { throw cliError(`${label} is unavailable`, 'cli_config_invalid'); }
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > 16 * 1024) {
    throw cliError(`${label} must be a bounded regular non-symlink file`, 'cli_config_invalid');
  }
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { throw cliError(`${label} is unavailable`, 'cli_config_invalid'); }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino
      || stat.size <= 0 || stat.size > 16 * 1024) {
      throw cliError(`${label} must be a bounded regular non-symlink file`, 'cli_config_invalid');
    }
    if (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid) {
      throw cliError(`${label} must be owned by the current user`, 'cli_config_invalid');
    }
    if (ownerOnly && (stat.mode & 0o077) !== 0) {
      throw cliError(`${label} must have owner-only permissions`, 'cli_config_invalid');
    }
    return readFileSync(descriptor, 'utf8');
  } finally { closeSync(descriptor); }
}

function readConnectionJson(path, label, options = {}) {
  const source = readBoundedFile(path, label, options);
  try { return JSON.parse(source); }
  catch { throw cliError(`${label} must contain JSON`, 'cli_config_invalid'); }
}

function readGitPointer(path, label) {
  const source = readBoundedFile(path, label).trim();
  if (!nonempty(source) || source.includes('\0') || source.includes('\n') || source.includes('\r')) {
    throw cliError(`${label} is invalid`, 'cli_config_invalid');
  }
  return source;
}

function findRepositoryMetadata(start) {
  let current = resolve(start);
  while (true) {
    const dotGit = join(current, '.git');
    if (existsSync(dotGit)) {
      let stat;
      try { stat = lstatSync(dotGit); }
      catch { throw cliError('Git metadata is unavailable', 'cli_config_invalid'); }
      if (stat.isSymbolicLink()) throw cliError('Git metadata must not be symlinked', 'cli_config_invalid');
      let gitDir;
      if (stat.isDirectory()) gitDir = dotGit;
      else if (stat.isFile()) {
        const pointer = readGitPointer(dotGit, 'Git worktree pointer');
        if (!pointer.startsWith('gitdir: ') || !nonempty(pointer.slice(8))) {
          throw cliError('Git worktree pointer is invalid', 'cli_config_invalid');
        }
        gitDir = resolve(current, pointer.slice(8));
      } else throw cliError('Git metadata is invalid', 'cli_config_invalid');
      let gitStat;
      try { gitStat = lstatSync(gitDir); }
      catch { throw cliError('Git directory is unavailable', 'cli_config_invalid'); }
      if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) {
        throw cliError('Git directory is unsafe', 'cli_config_invalid');
      }
      const commonPointer = join(gitDir, 'commondir');
      const commonDir = existsSync(commonPointer)
        ? resolve(gitDir, readGitPointer(commonPointer, 'Git common-directory pointer'))
        : gitDir;
      let commonStat;
      try { commonStat = lstatSync(commonDir); }
      catch { throw cliError('Git common directory is unavailable', 'cli_config_invalid'); }
      if (!commonStat.isDirectory() || commonStat.isSymbolicLink()) {
        throw cliError('Git common directory is unsafe', 'cli_config_invalid');
      }
      return Object.freeze({ repositoryRoot: current, gitDir, commonDir });
    }
    const parent = dirname(current);
    if (parent === current) throw cliError('Baton repository connection is unavailable', 'cli_config_invalid');
    current = parent;
  }
}

function repositoryIdentityFromMetadata(start) {
  const metadata = findRepositoryMetadata(start);
  const common = realpathSync(metadata.commonDir);
  return Object.freeze({
    ...metadata,
    repoId: `repo-${createHash('sha256').update(common).digest('hex').slice(0, 32)}`,
  });
}

/** Resolve one complete connection authority: either the compatibility environment or discovery. */
export function discoverBatonConnection({
  cwd = process.cwd(), env = process.env, home = env.HOME,
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const present = CONNECTION_ENV.filter((name) => nonempty(env[name]));
  if (present.length > 0) {
    if (present.length !== CONNECTION_ENV.length) {
      throw cliError(`incomplete connection environment override: ${CONNECTION_ENV.filter((name) => !present.includes(name)).join(', ')}`, 'cli_config_invalid');
    }
    return Object.freeze({
      baseUrl: env.BATON_URL, origin: env.BATON_ORIGIN, repoId: env.BATON_REPO_ID,
      token: env.BATON_TOKEN, authority: 'environment-compatibility',
    });
  }
  const { repositoryRoot, commonDir } = findRepositoryMetadata(cwd);
  const repositoryPath = join(commonDir, 'baton', 'connection.json');
  const repository = readConnectionJson(repositoryPath, 'repository connection configuration');
  const resident = repository.schemaVersion === 2;
  exactKeys(repository, resident
    ? ['schemaVersion', 'profile', 'repoId', 'deploymentId', 'incarnation', 'transport', 'registryDigest', 'startedAt']
    : ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration');
  if (![1, 2].includes(repository.schemaVersion)) {
    throw cliError('repository connection schema is unsupported', 'cli_config_invalid');
  }
  id(repository.profile, 'connection profile');
  id(repository.repoId, 'repository ID');
  if (resident) {
    id(repository.deploymentId, 'resident deployment ID');
    id(repository.incarnation, 'resident incarnation');
    if (repository.transport !== 'local'
      || repository.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest
      || !Number.isFinite(Date.parse(repository.startedAt))) {
      throw cliError('resident repository connection authority is invalid', 'cli_config_invalid');
    }
  }
  if (nonempty(env.XDG_CONFIG_HOME) && !isAbsolute(env.XDG_CONFIG_HOME)) {
    throw cliError('XDG_CONFIG_HOME must be absolute', 'cli_config_invalid');
  }
  const configRoot = nonempty(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME
    : nonempty(home) && isAbsolute(home) ? join(home, '.config') : null;
  if (!configRoot) throw cliError('user configuration home is unavailable', 'cli_config_invalid');
  const profilePath = join(configRoot, 'baton', 'connections', `${repository.profile}.json`);
  const profile = readConnectionJson(profilePath, 'user connection profile', { ownerOnly: true, ownerUid });
  exactKeys(profile, resident
    ? residentProfileKeys(profile)
    : ['schemaVersion', 'url', 'origin', 'tokenFile'], 'user connection profile');
  if (profile.schemaVersion !== repository.schemaVersion || !nonempty(profile.url)
    || !nonempty(profile.origin) || !nonempty(profile.tokenFile)
    || (resident && (!residentProfileOwnerValid(profile)
      || profile.transport !== 'local' || !isAbsolute(profile.socketPath)
      || profile.socketPath.includes('\0') || Buffer.byteLength(profile.socketPath) > 103
      || profile.deploymentId !== repository.deploymentId
      || profile.incarnation !== repository.incarnation
      || profile.registryDigest !== repository.registryDigest
      || profile.startedAt !== repository.startedAt))) {
    throw cliError('user connection profile is invalid', 'cli_config_invalid');
  }
  const tokenPath = isAbsolute(profile.tokenFile) ? profile.tokenFile : resolve(dirname(profilePath), profile.tokenFile);
  const token = readBoundedFile(tokenPath, 'private Baton token file', { ownerOnly: true, ownerUid }).trim();
  if (!nonempty(token) || token.includes('\0') || token.includes('\n') || token.includes('\r')) {
    throw cliError('private Baton token file content is invalid', 'cli_config_invalid');
  }
  return Object.freeze({
    baseUrl: profile.url, origin: profile.origin, repoId: repository.repoId, token,
    authority: 'repository-user-profile', repositoryRoot, profile: repository.profile,
    ...(resident ? {
      transport: 'local', socketPath: profile.socketPath,
      deploymentId: repository.deploymentId, incarnation: repository.incarnation,
    } : {}),
  });
}

function connectionConfigRoot(env, home) {
  if (nonempty(env.XDG_CONFIG_HOME) && !isAbsolute(env.XDG_CONFIG_HOME)) {
    throw cliError('XDG_CONFIG_HOME must be absolute', 'cli_config_invalid');
  }
  const root = nonempty(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME
    : nonempty(home) && isAbsolute(home) ? join(home, '.config') : null;
  if (!root) throw cliError('user configuration home is unavailable', 'cli_config_invalid');
  return root;
}

function setupProfileNames(configRoot) {
  const directory = join(configRoot, 'baton', 'connections');
  if (!existsSync(directory)) return [];
  let stat;
  try { stat = lstatSync(directory); }
  catch { throw cliError('Baton connection profile directory is unavailable', 'cli_config_invalid'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw cliError('Baton connection profile directory is unsafe', 'cli_config_invalid');
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -5))
    .filter((name) => {
      try { id(name, 'connection profile'); return true; } catch { return false; }
    })
    // Issue #37: resident-published profiles (schema v2, `baton serve` publications) share this
    // directory but are a different artifact class — never schema-v1 setup candidates. Content,
    // not name, decides: an unreadable or malformed file stays a candidate so its selection
    // fails with the file-naming validation error instead of silently vanishing.
    .filter((name) => {
      try {
        const parsed = JSON.parse(readFileSync(join(directory, `${name}.json`), 'utf8'));
        return !(record(parsed) && (parsed.schemaVersion === 2
          || Object.hasOwn(parsed, 'transport') || Object.hasOwn(parsed, 'socketPath')));
      } catch { return true; }
    })
    .sort();
}

function readSetupProfile(configRoot, profileName, ownerUid) {
  const profilePath = join(configRoot, 'baton', 'connections', `${profileName}.json`);
  const label = `user connection profile ${profileName}.json`;
  const profile = readConnectionJson(profilePath, label, { ownerOnly: true, ownerUid });
  exactKeys(profile, ['schemaVersion', 'url', 'origin', 'tokenFile'], label);
  if (profile.schemaVersion !== 1 || !nonempty(profile.url) || !nonempty(profile.origin) || !nonempty(profile.tokenFile)) {
    throw cliError(`${label} is invalid`, 'cli_config_invalid');
  }
  let base;
  let origin;
  try { base = new URL(profile.url); origin = new URL(profile.origin); }
  catch { throw cliError('user connection profile URL is invalid', 'cli_config_invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw cliError('user connection profile requires secure URL and origin', 'cli_config_invalid');
  }
  const tokenPath = isAbsolute(profile.tokenFile) ? profile.tokenFile : resolve(dirname(profilePath), profile.tokenFile);
  const token = readBoundedFile(tokenPath, 'private Baton token file', { ownerOnly: true, ownerUid }).trim();
  if (!nonempty(token) || token.includes('\0') || token.includes('\n') || token.includes('\r')) {
    throw cliError('private Baton token file content is invalid', 'cli_config_invalid');
  }
  return Object.freeze({
    baseUrl: base.href.replace(/\/$/u, ''), origin: origin.origin, token, profilePath,
  });
}

async function setupRemoteRead(fetchImpl, connection, path) {
  let response;
  try {
    response = await fetchImpl(`${connection.baseUrl}${path}`, {
      method: 'GET', redirect: 'error',
      headers: {
        authorization: `Bearer ${connection.token}`,
        origin: connection.origin,
        'sec-fetch-site': 'none',
      },
    });
  } catch { throw cliError('Baton setup could not authenticate the remote application', 'cli_setup_remote_unavailable'); }
  let body;
  try { body = await response.json(); }
  catch { throw cliError('Baton setup received an invalid remote response', 'cli_setup_remote_invalid'); }
  if (!response.ok || body?.ok !== true) {
    throw cliError('Baton setup authentication or repository authorization was refused', 'cli_setup_remote_refused');
  }
  return body;
}

function readInstalledSelector(path) {
  const installed = readConnectionJson(path, 'repository connection configuration');
  exactKeys(installed, ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration');
  if (installed.schemaVersion !== 1) throw cliError('repository connection schema is unsupported', 'cli_config_invalid');
  id(installed.profile, 'connection profile');
  id(installed.repoId, 'repository ID');
  return installed;
}

function installRepositorySelector(commonDir, selector, ownerUid) {
  const directory = join(commonDir, 'baton');
  const target = join(directory, 'connection.json');
  if (existsSync(target)) {
    const installed = readInstalledSelector(target);
    if (installed.profile === selector.profile && installed.repoId === selector.repoId) return 'already_configured';
    throw cliError('repository connection already selects a different authenticated authority', 'cli_setup_conflict');
  }
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (cause) { if (cause?.code !== 'EEXIST') throw cause; }
  let directoryStat;
  try { directoryStat = lstatSync(directory); }
  catch { throw cliError('repository Baton metadata directory is unavailable', 'cli_setup_failed'); }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || (ownerUid !== null && Number.isInteger(directoryStat.uid) && directoryStat.uid !== ownerUid)) {
    throw cliError('repository Baton metadata directory is unsafe', 'cli_setup_failed');
  }
  if ((directoryStat.mode & 0o077) !== 0) chmodSync(directory, 0o700);
  const temporary = join(directory, `.connection-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, profile: selector.profile, repoId: selector.repoId })}\n`, 'utf8');
    fsyncSync(descriptor);
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw Object.assign(cliError('repository connection could not be installed', 'cli_setup_failed'), { cause });
  }
  closeSync(descriptor);
  try {
    linkSync(temporary, target);
    unlinkSync(temporary);
    let directoryDescriptor;
    try {
      directoryDescriptor = openSync(directory, constants.O_RDONLY);
      fsyncSync(directoryDescriptor);
    } catch { /* The selector itself is already durable on filesystems that reject directory fsync. */ }
    finally { if (directoryDescriptor !== undefined) closeSync(directoryDescriptor); }
    return 'configured';
  } catch (cause) {
    rmSync(temporary, { force: true });
    if (cause?.code === 'EEXIST') {
      const installed = readInstalledSelector(target);
      if (installed.profile === selector.profile && installed.repoId === selector.repoId) return 'already_configured';
      throw cliError('repository connection already selects a different authenticated authority', 'cli_setup_conflict');
    }
    throw Object.assign(cliError('repository connection could not be installed', 'cli_setup_failed'), { cause });
  }
}

/** Authenticate one user profile, bind it to the remote served repository, then install only the
 * non-secret repository selector. No bearer value is accepted on argv or returned to the caller. */
export async function setupBatonConnection({
  cwd = process.cwd(), env = process.env, home = env.HOME,
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  profile = null, fetchImpl = globalThis.fetch,
} = {}) {
  const present = CONNECTION_ENV.filter((name) => nonempty(env[name]));
  if (present.length > 0) {
    if (present.length !== CONNECTION_ENV.length) {
      throw cliError(`incomplete connection environment override: ${CONNECTION_ENV.filter((name) => !present.includes(name)).join(', ')}`, 'cli_config_invalid');
    }
    if (profile !== null) throw cliError('--profile cannot be combined with a connection environment override');
    return Object.freeze({
      schemaVersion: 1, state: 'configured', authority: 'environment-compatibility',
      next: Object.freeze([{ action: 'check', command: 'baton doctor --check' }]),
    });
  }
  if (typeof fetchImpl !== 'function') throw cliError('Baton setup transport is unavailable', 'cli_setup_remote_unavailable');
  const { commonDir } = findRepositoryMetadata(cwd);
  const configRoot = connectionConfigRoot(env, home);
  const profiles = setupProfileNames(configRoot);
  if (profile !== null) id(profile, 'connection profile');
  if (profile === null && profiles.length !== 1) {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_user_input',
      outline: Object.freeze({ repository: 'ready', profiles: profiles.length === 0 ? 'missing' : 'select_profile', connection: 'not_written' }),
      profiles: Object.freeze(profiles),
      next: Object.freeze(profiles.length === 0
        ? [{ action: 'create_profile', command: 'baton help connection' }]
        : [{ action: 'select_profile', command: 'baton setup --profile PROFILE' }]),
    });
  }
  const selected = profile ?? profiles[0];
  if (!profiles.includes(selected)) throw cliError('selected Baton connection profile is unavailable', 'cli_config_invalid');
  const connection = readSetupProfile(configRoot, selected, ownerUid);
  const card = await setupRemoteRead(fetchImpl, connection, '/v1/application-card');
  const session = await setupRemoteRead(fetchImpl, connection, '/v1/session');
  const repoId = card?.application?.repoId;
  if (card?.application?.schemaVersion !== 1 || !record(card.application) || !id(repoId, 'repository ID')
    || !record(session.identity) || !Array.isArray(session.identity.repoIds) || !session.identity.repoIds.includes(repoId)
    || !Array.isArray(session.identity.capabilities) || !session.identity.capabilities.includes('observe')) {
    throw cliError('Baton setup could not prove one authenticated repository authority', 'cli_setup_remote_invalid');
  }
  const installState = installRepositorySelector(commonDir, { profile: selected, repoId }, ownerUid);
  return Object.freeze({
    schemaVersion: 1, state: installState, authority: 'repository-user-profile',
    connection: Object.freeze({ profile: selected, repoId }),
    next: Object.freeze([{ action: 'check', command: 'baton doctor --check' }]),
  });
}

/** Read-only local diagnosis. It deliberately never opens the bearer-token file or contacts the
 * remote application; `doctor --check` performs those explicit deeper checks separately. */
export function inspectBatonConnection({
  cwd = process.cwd(), env = process.env, home = env.HOME,
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  depth = 'outline',
} = {}) {
  if (!['outline', 'connection', 'profile', 'evidence'].includes(depth)) {
    throw cliError('doctor depth is invalid');
  }
  const present = CONNECTION_ENV.filter((name) => nonempty(env[name]));
  if (present.length > 0) {
    const complete = present.length === CONNECTION_ENV.length;
    return Object.freeze({
      schemaVersion: 1, state: complete ? 'configured' : 'needs_setup', depth,
      outline: Object.freeze({
        repository: 'environment_override', connection: complete ? 'ready' : 'incomplete',
        profile: 'not_applicable', credential: 'not_read', remote: 'not_checked',
      }),
      ...(complete ? {} : { missing: Object.freeze(CONNECTION_ENV.filter((name) => !present.includes(name))) }),
      next: Object.freeze(complete
        ? [{ action: 'check', command: 'baton doctor --check' }]
        : [{ action: 'complete_or_clear_environment', command: 'baton help connection' }]),
    });
  }
  let metadata;
  try { metadata = findRepositoryMetadata(cwd); } catch {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'missing', connection: 'not_checked', profile: 'not_checked', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'enter_repository', command: 'cd REPOSITORY' }]),
    });
  }
  const repositoryPath = join(metadata.commonDir, 'baton', 'connection.json');
  if (!existsSync(repositoryPath)) {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'missing', profile: 'not_checked', credential: 'not_read', remote: 'not_checked' }),
      // Issue #36: `baton serve` is the ordinary zero-assembly path; `baton setup` is the
      // advanced explicit-network flow. Offer both, ordinary first.
      next: Object.freeze([
        { action: 'serve', command: 'baton serve' },
        { action: 'setup', command: 'baton setup' },
      ]),
      ...(depth === 'evidence' ? { evidence: Object.freeze({ selector: 'absent', gitCommonDirectory: 'resolved' }) } : {}),
    });
  }
  let repository;
  let resident = false;
  try {
    repository = readConnectionJson(repositoryPath, 'repository connection configuration');
    resident = repository.schemaVersion === 2;
    exactKeys(repository, resident
      ? ['schemaVersion', 'profile', 'repoId', 'deploymentId', 'incarnation', 'transport', 'registryDigest', 'startedAt']
      : ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration');
    if (![1, 2].includes(repository.schemaVersion)) throw cliError('repository connection schema is unsupported', 'cli_config_invalid');
    id(repository.profile, 'connection profile'); id(repository.repoId, 'repository ID');
    if (resident && (!id(repository.deploymentId, 'resident deployment ID')
      || !id(repository.incarnation, 'resident incarnation') || repository.transport !== 'local'
      || repository.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest
      || !Number.isFinite(Date.parse(repository.startedAt)))) {
      throw cliError('resident repository connection authority is invalid', 'cli_config_invalid');
    }
  } catch {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'invalid', profile: 'not_checked', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'repair_setup', command: 'baton setup' }]),
    });
  }
  const configRoot = nonempty(env.XDG_CONFIG_HOME) && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : nonempty(home) && isAbsolute(home) ? join(home, '.config') : null;
  if (!configRoot) {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'ready', profile: 'unavailable', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'configure_home', command: 'baton help connection' }]),
    });
  }
  const profilePath = join(configRoot, 'baton', 'connections', `${repository.profile}.json`);
  let profile;
  try {
    profile = readConnectionJson(profilePath, 'user connection profile', { ownerOnly: true, ownerUid });
    exactKeys(profile, resident
      ? residentProfileKeys(profile)
      : ['schemaVersion', 'url', 'origin', 'tokenFile'], 'user connection profile');
    if (profile.schemaVersion !== repository.schemaVersion || !nonempty(profile.url)
      || !nonempty(profile.origin) || !nonempty(profile.tokenFile)
      || (resident && (!residentProfileOwnerValid(profile)
        || profile.transport !== 'local' || !isAbsolute(profile.socketPath)
        || profile.socketPath.includes('\0') || Buffer.byteLength(profile.socketPath) > 103
        || profile.deploymentId !== repository.deploymentId
        || profile.incarnation !== repository.incarnation
        || profile.registryDigest !== repository.registryDigest
        || profile.startedAt !== repository.startedAt))) {
      throw cliError('user connection profile is invalid', 'cli_config_invalid');
    }
  } catch {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'ready', profile: existsSync(profilePath) ? 'invalid' : 'missing', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'setup', command: 'baton setup' }]),
      ...(depth === 'connection' || depth === 'profile' ? { connection: Object.freeze({ profile: repository.profile, repoId: repository.repoId }) } : {}),
    });
  }
  if (resident) {
    let socketState = 'absent';
    try {
      const socket = lstatSync(profile.socketPath);
      socketState = socket.isSocket() && !socket.isSymbolicLink()
        && (socket.mode & 0o077) === 0
        && (ownerUid === null || !Number.isInteger(socket.uid) || socket.uid === ownerUid)
        ? 'ready' : 'unsafe';
    } catch (error) {
      if (error?.code !== 'ENOENT') socketState = 'unsafe';
    }
    if (socketState !== 'ready') {
      return Object.freeze({
        schemaVersion: 1, state: socketState === 'absent' ? 'stale' : 'needs_setup', depth,
        outline: Object.freeze({
          repository: 'ready', connection: socketState === 'absent' ? 'stale_authority' : 'invalid',
          profile: 'ready', credential: 'not_read',
          remote: socketState === 'absent' ? 'absent' : 'not_checked',
        }),
        ...(depth === 'connection' || depth === 'profile' ? { connection: Object.freeze({
          profile: repository.profile, repoId: repository.repoId, origin: profile.origin,
          transport: 'local', deploymentId: repository.deploymentId,
          incarnation: repository.incarnation,
        }) } : {}),
        ...(depth === 'evidence' ? { evidence: Object.freeze({
          selector: 'valid', profile: 'valid', credential: 'not_opened',
          remote: socketState === 'absent' ? 'socket_absent' : 'socket_unsafe',
        }) } : {}),
        next: Object.freeze([{ action: socketState === 'absent' ? 'recover' : 'repair_setup',
          command: socketState === 'absent' ? 'baton serve' : 'baton setup' }]),
      });
    }
  }
  return Object.freeze({
    schemaVersion: 1, state: 'configured', depth,
    outline: Object.freeze({ repository: 'ready', connection: 'ready', profile: 'ready', credential: 'not_read', remote: 'not_checked' }),
    ...(depth === 'connection' || depth === 'profile' ? { connection: Object.freeze({
      profile: repository.profile, repoId: repository.repoId, origin: profile.origin,
      ...(resident ? {
        transport: 'local', deploymentId: repository.deploymentId,
        incarnation: repository.incarnation,
      } : {}),
    }) } : {}),
    ...(depth === 'evidence' ? { evidence: Object.freeze({ selector: 'valid', profile: 'valid', credential: 'not_opened', remote: 'not_contacted' }) } : {}),
    next: Object.freeze([{ action: 'check', command: 'baton doctor --check' }]),
  });
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalJson = (value) => `${JSON.stringify(canonical(value))}\n`;

function tarText(header, start, width, { utf8 = false } = {}) {
  const field = header.subarray(start, start + width);
  const end = field.indexOf(0);
  const bytes = end === -1 ? field : field.subarray(0, end);
  if (end !== -1 && field.subarray(end).some((byte) => byte !== 0)) throw cliError('archive text field has trailing bytes', 'cli_export_archive_invalid');
  try { return new TextDecoder(utf8 ? 'utf-8' : 'ascii', { fatal: true }).decode(bytes); }
  catch { throw cliError('archive text field is invalid', 'cli_export_archive_invalid'); }
}

function tarNumber(header, start, width) {
  const raw = header.subarray(start, start + width);
  if (raw[0] & 0x80) throw cliError('base-256 tar numbers are not allowed', 'cli_export_archive_invalid');
  const text = raw.toString('ascii').replace(/\0.*$/u, '').trim();
  if (text !== '' && !/^[0-7]+$/u.test(text)) throw cliError('archive numeric field is invalid', 'cli_export_archive_invalid');
  const value = Number.parseInt(text || '0', 8);
  if (!Number.isSafeInteger(value) || value < 0) throw cliError('archive numeric field is invalid', 'cli_export_archive_invalid');
  return value;
}

function safeArchivePath(path) {
  if (!path || isAbsolute(path) || path.includes('\\') || Buffer.from(path, 'utf8').toString('utf8') !== path
    || path.split('/').some((part) => !part || part === '.' || part === '..'
      || foldCanonicalCase(part.normalize('NFKC')) === '.git')) {
    throw cliError('archive path is unsafe', 'cli_export_archive_invalid');
  }
  return path;
}

function parseResultExportArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length % 512 !== 0) {
    throw cliError('archive framing is invalid', 'cli_export_archive_invalid');
  }
  const records = [];
  const names = new Set();
  let offset = 0;
  let terminators = 0;
  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      terminators += 1;
      if (terminators === 2) break;
      continue;
    }
    if (terminators !== 0) throw cliError('archive contains records after a zero block', 'cli_export_archive_invalid');
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const expectedChecksum = [...checksumHeader].reduce((sum, byte) => sum + byte, 0);
    if (tarNumber(header, 148, 8) !== expectedChecksum
      || tarText(header, 257, 6) !== 'ustar' || tarText(header, 263, 2) !== '00'
      || tarText(header, 156, 1) !== '0' || tarText(header, 157, 100) !== ''
      || tarText(header, 265, 32) !== '' || tarText(header, 297, 32) !== ''
      || tarNumber(header, 108, 8) !== 0 || tarNumber(header, 116, 8) !== 0
      || tarNumber(header, 136, 12) !== 0 || tarNumber(header, 329, 8) !== 0
      || tarNumber(header, 337, 8) !== 0) {
      throw cliError('archive header is outside baton-export-tar-v1', 'cli_export_archive_invalid');
    }
    const name = tarText(header, 0, 100, { utf8: true });
    const prefix = tarText(header, 345, 155, { utf8: true });
    const path = safeArchivePath(prefix ? `${prefix}/${name}` : name);
    if (names.has(path)) throw cliError('archive contains duplicate paths', 'cli_export_archive_invalid');
    names.add(path);
    const size = tarNumber(header, 124, 12);
    const mode = tarNumber(header, 100, 8);
    const padded = Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(padded) || offset > bytes.length - padded) {
      throw cliError('archive record is truncated', 'cli_export_archive_invalid');
    }
    const data = Buffer.from(bytes.subarray(offset, offset + size));
    if (bytes.subarray(offset + size, offset + padded).some((byte) => byte !== 0)) {
      throw cliError('archive padding is non-zero', 'cli_export_archive_invalid');
    }
    offset += padded;
    records.push({ path, mode, size, data });
  }
  if (terminators !== 2 || offset !== bytes.length) throw cliError('archive terminator is invalid', 'cli_export_archive_invalid');
  const sorted = [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  if (records.some((record, index) => record.path !== sorted[index].path)) {
    throw cliError('archive inventory is not bytewise ordered', 'cli_export_archive_invalid');
  }
  return records;
}

function validateArchiveDescriptor(descriptor, archiveBytes) {
  const fields = ['schemaVersion', 'format', 'mediaType', 'exportId', 'manifestDigest', 'archiveDigest', 'archiveBytes'];
  if (!record(descriptor) || Object.keys(descriptor).sort().join(',') !== fields.sort().join(',')
    || descriptor.schemaVersion !== 1 || descriptor.format !== 'baton-export-tar-v1'
    || descriptor.mediaType !== 'application/x-tar' || !/^[a-f0-9]{64}$/u.test(descriptor.exportId ?? '')
    || !/^[a-f0-9]{64}$/u.test(descriptor.manifestDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(descriptor.archiveDigest ?? '')
    || !Number.isSafeInteger(descriptor.archiveBytes) || descriptor.archiveBytes !== archiveBytes.length) {
    throw cliError('archive descriptor is invalid', 'cli_export_archive_invalid');
  }
  if (sha256(archiveBytes) !== descriptor.archiveDigest) {
    throw cliError('archive digest differs from its descriptor', 'cli_export_archive_digest_mismatch');
  }
}

function preflightResultExportArchive(archiveBytes, descriptor) {
  validateArchiveDescriptor(descriptor, archiveBytes);
  const records = parseResultExportArchive(archiveBytes);
  const manifestRecord = records.find((record) => record.path === 'manifest.json');
  if (!manifestRecord || manifestRecord.mode !== 0o600 || sha256(manifestRecord.data) !== descriptor.manifestDigest) {
    throw cliError('archive manifest is invalid', 'cli_export_archive_invalid');
  }
  let manifest;
  try { manifest = JSON.parse(manifestRecord.data); }
  catch { throw cliError('archive manifest is invalid', 'cli_export_archive_invalid'); }
  if (canonicalJson(manifest) !== manifestRecord.data.toString('utf8')
    || manifest.schemaVersion !== 1 || manifest.format !== 'directory-v1'
    || manifest.exportId !== descriptor.exportId || !Array.isArray(manifest.files)
    || manifest.fileCount !== manifest.files.length) {
    throw cliError('archive manifest is invalid', 'cli_export_archive_invalid');
  }
  const expected = new Map([['manifest.json', { mode: 0o600, size: manifestRecord.data.length, digest: descriptor.manifestDigest }]]);
  for (const file of manifest.files) {
    if (!record(file) || Object.keys(file).sort().join(',') !== ['blob', 'digest', 'mode', 'path', 'size'].join(',')
      || !['100644', '100755'].includes(file.mode) || !Number.isSafeInteger(file.size) || file.size < 0
      || !/^[a-f0-9]{64}$/u.test(file.digest ?? '')) throw cliError('archive manifest file is invalid', 'cli_export_archive_invalid');
    const path = `tree/${safeArchivePath(file.path)}`;
    if (expected.has(path)) throw cliError('archive manifest paths collide', 'cli_export_archive_invalid');
    expected.set(path, { mode: file.mode === '100755' ? 0o755 : 0o644, size: file.size, digest: file.digest });
  }
  if (records.length !== expected.size) throw cliError('archive inventory differs from its manifest', 'cli_export_archive_invalid');
  for (const record of records) {
    const wanted = expected.get(record.path);
    if (!wanted || record.mode !== wanted.mode || record.size !== wanted.size || sha256(record.data) !== wanted.digest) {
      throw cliError('archive record differs from its manifest', 'cli_export_archive_invalid');
    }
  }
  return { manifest, files: records.filter((record) => record.path.startsWith('tree/')) };
}

function clientChild(root, path) {
  const candidate = resolve(root, path);
  const within = relative(root, candidate);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw cliError('archive path escapes client destination', 'cli_export_archive_invalid');
  }
  return candidate;
}

function ensureClientDirectories(root, path) {
  const within = relative(root, path);
  if (!within) return;
  let current = root;
  for (const component of within.split(sep)) {
    current = join(current, component);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw cliError('client destination directory is unsafe', 'cli_export_archive_invalid');
  }
}

function writeClientFile(path, bytes, mode) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), mode);
  try { fchmodSync(fd, mode); writeFileSync(fd, bytes); fsyncSync(fd); }
  finally { closeSync(fd); }
}

export function extractResultExportArchive({ archiveBytes, descriptor, destination }) {
  if (!Buffer.isBuffer(archiveBytes) || !nonempty(destination) || destination.includes('\0')) {
    throw cliError('archive extraction request is invalid', 'cli_export_archive_invalid');
  }
  const extracted = preflightResultExportArchive(archiveBytes, descriptor);
  const final = resolve(destination);
  if (existsSync(final)) throw cliError('export destination already exists', 'cli_export_destination_exists');
  const parent = dirname(final);
  let parentReal;
  try { parentReal = realpathSync(parent); } catch { throw cliError('export destination parent is unavailable', 'cli_export_destination_invalid'); }
  const parentStat = lstatSync(parentReal);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw cliError('export destination parent is unsafe', 'cli_export_destination_invalid');
  const temporary = mkdtempSync(join(parentReal, `.baton-export-${basename(final)}-`));
  try {
    for (const file of extracted.files) {
      const relativePath = file.path.slice('tree/'.length);
      const target = clientChild(temporary, relativePath);
      ensureClientDirectories(temporary, dirname(target));
      writeClientFile(target, file.data, file.mode);
    }
    try { publishResultExportNoReplace({ root: parentReal, temporary, final }); }
    catch (cause) {
      if (cause?.code === 'EEXIST') throw cliError('export destination already exists', 'cli_export_destination_exists');
      throw cause;
    }
    return Object.freeze({
      schemaVersion: 1, state: 'delivered', exportId: descriptor.exportId, destination: final,
    });
  } catch (cause) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    if (cause?.code?.startsWith?.('cli_')) throw cause;
    throw Object.assign(cliError('export extraction failed', 'cli_export_extract_failed'), { cause });
  }
}

// docs/36 §6.1 / §9 M4 (CLI renderer) — the canonical CLI verb model is DERIVED from the registry
// v2 entries, not a hand table: for every cli-enabled canonical operation it carries the one
// mechanically derived `baton …` spelling, its legacy cli aliases (the spellings parseBatonCli
// rewrites), the H4 flag aliases, and the H8 example. batonCliHelp and the golden-pair contracts
// consume exactly these rows, so a §6 change lands in one place (M4A-1/M4A-4).
export function canonicalCliRenderModel(registry = APPLICATION_SEMANTIC_REGISTRY) {
  return registry.canonicalOperations
    .filter((operation) => operation.surfaces.includes('cli'))
    .map((operation) => Object.freeze({
      key: operation.key,
      cli: operation.names.cli,
      example: operation.example,
      helpTopic: operation.helpTopic,
      flagAliases: operation.flagAliases,
      aliases: Object.freeze(operation.aliases
        .filter((alias) => alias.surface === 'cli')
        .map((alias) => alias.name)),
    }));
}

const CANONICAL_CLI_RENDER_MODEL = Object.freeze(canonicalCliRenderModel());
const CANONICAL_CLI_BY_KEY = new Map(CANONICAL_CLI_RENDER_MODEL.map((row) => [row.key, row]));

export function batonCliHelp(topic = 'application') {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const commandById = new Map(registry.cli.commands.map((command) => [command.id, command]));
  let definition = registry.cli.helpTopics[topic];
  const aliasTopic = definition?.aliasFor ?? null;
  if (aliasTopic) definition = registry.cli.helpTopics[aliasTopic];
  const actionEntry = Object.entries(registry.actions).find(([, candidate]) => candidate.helpTopic === topic);
  const action = actionEntry?.[1];
  if (!definition && action) {
    const commands = registry.cli.commands.filter((command) => command.action
      && registry.actions[command.action]?.helpTopic === topic);
    const usage = commands.length > 0
      ? commands.map((command) => command.usage)
      : [`baton run do RUN_ID ${actionEntry[0]} [--inputs JSON]`];
    return `usage:\n${usage.map((line) => `  ${line}`).join('\n')}\n\n${action.label}\n${action.summary}`;
  }
  if (!definition && CANONICAL_CLI_BY_KEY.has(topic)) {
    // docs/36 §9 M4 — a canonical operation key renders its help from the registry v2 entry: the
    // derived spelling, the H8 example, and (when present) the legacy cli spellings it replaced.
    const row = CANONICAL_CLI_BY_KEY.get(topic);
    const usage = [...new Set([row.cli, row.example])].map((line) => `  ${line}`).join('\n');
    const blocks = [`usage:\n${usage}`];
    if (row.aliases.length > 0) blocks.push(`Replaces: ${row.aliases.join(', ')}.`);
    return blocks.join('\n\n');
  }
  if (!definition) return `No local help is available for ${topic}.\nUse baton help for the application overview.`;
  const usage = [
    ...(definition.commandIds ?? []).map((id) => commandById.get(id)?.usage),
    ...(definition.usage ?? []),
  ].filter(nonempty);
  const blocks = [`usage:\n${usage.map((line) => `  ${line}`).join('\n')}`];
  for (const section of definition.sections ?? []) {
    blocks.push(`${section.title}:\n${section.lines.map((line) => `  ${line}`).join('\n')}`);
  }
  const selectorRule = definition.selectorRule && registry.cli.selectorRules[definition.selectorRule];
  if (selectorRule) blocks.push(selectorRule.description);
  blocks.push(...(definition.paragraphs ?? []));
  if (action) blocks.push(`${action.label}\n${action.summary}`);
  const operation = registry.operations[topic];
  if (!aliasTopic && operation?.deprecated && operation.aliases.length > 0) {
    blocks.push(`Deprecated: use baton ${operation.aliases[0].replaceAll('.', ' ')}.`);
  }
  return blocks.join('\n\n');
}

export const BATON_CLI_HELP = batonCliHelp(APPLICATION_SEMANTIC_REGISTRY.cli.defaultHelpTopic);

const RUN_VIEW_OUTPUT_KINDS = new Set([
  'command', 'semantic-action', 'adopt', 'integrate',
]);

function compactRunResult(result) {
  if (!record(result)) return null;
  const keys = [
    'state', 'status', 'nodeKey', 'sha', 'verdict', 'summary', 'adopted',
    'reviewed', 'integrated', 'strategy',
  ];
  const projected = Object.fromEntries(keys
    .filter((key) => result[key] !== undefined)
    .map((key) => [key, result[key]]));
  return Object.keys(projected).length === 0 ? null : projected;
}

function compactNextActions(actions) {
  if (!Array.isArray(actions)) return [];
  const allowed = new Set([
    'kind', 'actionId', 'planDigest', 'requestId', 'role', 'reason', 'state', 'do',
  ]);
  return actions.map((action) => Object.fromEntries(Object.entries(action ?? {})
    .filter(([key]) => allowed.has(key))));
}

function compactSemanticActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((action) => ({
    actionId: action.actionId,
    kind: action.kind,
    label: action.label,
    summary: action.summary,
    destructive: action.destructive === true,
    ...(record(action.do) ? { do: action.do } : {}),
    ...(Array.isArray(action.choices) && action.choices.length > 0
      ? { choices: action.choices } : {}),
    ...(action.help?.topic ? { help: `baton help ${action.help.topic}` } : {}),
  }));
}

function compactInspectOutline(result) {
  const outline = record(result.outline) ? result.outline : {};
  const route = record(outline.route) ? {
    ...(record(outline.route.requested) ? { requested: outline.route.requested } : {}),
    ...(record(outline.route.resolved) ? { resolved: outline.route.resolved } : {}),
    ...(record(outline.route.observed) ? { observed: outline.route.observed } : {}),
  } : null;
  return Object.freeze({
    schemaVersion: 1,
    runId: result.runId,
    depth: 'outline',
    terminal: result.terminal === true,
    outline: {
      objective: outline.objective ?? null,
      resultIntent: outline.resultIntent ?? null,
      phase: outline.phase ?? null,
      stage: outline.stage ?? null,
      narrative: outline.narrative ?? null,
      ...(record(outline.progress) ? { progress: {
        current: outline.progress.current ?? null,
        summary: outline.progress.summary ?? null,
      } } : {}),
      ...(record(outline.attention) ? { attention: outline.attention } : {}),
      ...(route && Object.keys(route).length > 0 ? { route } : {}),
      ...(record(outline.terminalCause) ? { terminalCause: outline.terminalCause } : {}),
      ...(record(outline.resources) ? { resources: outline.resources } : {}),
      ...(record(outline.preservation) ? { preservation: outline.preservation } : {}),
      actions: compactSemanticActions(outline.actions),
    },
    expand: { command: `baton run show ${result.runId} --depth index` },
  });
}

function compactInspectIndex(result) {
  const sections = Array.isArray(result.sections) ? result.sections : [];
  return Object.freeze({
    schemaVersion: 1, runId: result.runId, depth: 'index', terminal: result.terminal === true,
    sections: sections.map((section) => ({
      id: section.id, state: section.state, items: section.itemCount,
      summary: section.summary,
      inspect: `baton run show ${result.runId} --depth section --section ${section.id}`,
    })),
    collapse: { command: `baton run show ${result.runId}` },
  });
}

function compactInspectSection(result) {
  const section = record(result.section) ? result.section : {};
  const items = Array.isArray(section.items) ? section.items : [];
  return Object.freeze({
    schemaVersion: 1, runId: result.runId, depth: 'section', terminal: result.terminal === true,
    section: {
      id: section.id, state: section.state, summary: section.summary,
      items: items.map((item) => ({
        id: item.id, state: item.state, summary: item.summary,
        inspect: `baton run show ${result.runId} --depth item --section ${section.id} --item ${item.id}`,
      })),
      truncated: section.truncated === true,
    },
    collapse: { command: `baton run show ${result.runId} --depth index` },
  });
}

/**
 * Project mutation/status RunViews into the CLI's ordinary outline. The authenticated
 * application response remains available through progressive `run show` inspection;
 * routine commands must not force agents to consume internal budgets, fences, task IDs,
 * policy attestations, or full lifecycle chapters after every action.
 */
export function projectBatonCliResult(parsed, result) {
  if (!record(parsed) || !record(result)) return result;
  if (parsed.kind === 'stream' && nonempty(result.runId) && record(result.content)) {
    if (parsed.channel === 'progress') return Object.freeze({
      ...result.content,
      follow: result.terminal ? null : `baton run progress ${result.runId} --follow`,
    });
    return Object.freeze({
      schemaVersion: 1, runId: result.runId, channel: parsed.channel,
      terminal: result.terminal === true,
      items: Array.isArray(result.content.items) ? result.content.items : [],
      follow: result.terminal ? null
        : `baton run ${parsed.channel} ${result.runId}${parsed.recipient ? ` --to ${parsed.recipient}` : ''} --follow`,
    });
  }
  if (parsed.name === 'run.inspect' && result.depth === 'outline'
    && nonempty(result.runId)) return compactInspectOutline(result);
  if (parsed.name === 'run.inspect' && result.depth === 'index'
    && nonempty(result.runId)) return compactInspectIndex(result);
  if (parsed.name === 'run.inspect' && result.depth === 'section'
    && nonempty(result.runId)) return compactInspectSection(result);
  if (!RUN_VIEW_OUTPUT_KINDS.has(parsed.kind)
    || !nonempty(result.runId) || !nonempty(result.phase) || result.depth !== undefined
    // Issue #53: run.debug's result is already the bounded, whitelisted projection rule 4
    // requires the CLI and the embedded accessor to share byte-for-byte — never the generic
    // run-view compact form (which would drop members/lastMessages/writeReceipts/failure).
    || parsed.name === 'run.evidence' || parsed.name === 'run.debug') return result;
  const route = record(result.route) ? {
    ...(record(result.route.requested) ? { requested: result.route.requested } : {}),
    ...(record(result.route.resolved) ? { resolved: result.route.resolved } : {}),
    ...(record(result.route.observed) ? { observed: result.route.observed } : {}),
  } : null;
  const attention = Array.isArray(result.attention) ? result.attention : [];
  const compact = {
    schemaVersion: 1,
    runId: result.runId,
    ...(nonempty(result.objective) ? { objective: result.objective } : {}),
    ...(nonempty(result.resultIntent) ? { resultIntent: result.resultIntent } : {}),
    ...(record(result.objectiveResultPolicy)
      ? { objectiveResultPolicy: result.objectiveResultPolicy } : {}),
    phase: result.phase,
    ...(record(result.progress) ? { progress: {
      current: result.progress.current ?? null,
      summary: result.progress.summary ?? null,
    } } : {}),
    ...(nonempty(result.narrative) ? { narrative: result.narrative } : {}),
    ...(route && Object.keys(route).length > 0 ? { route } : {}),
    attention: {
      count: attention.length,
      required: attention.length > 0,
      ...(attention.length > 0 ? { items: attention } : {}),
    },
    blockedInteraction: record(result.blockedInteraction) ? result.blockedInteraction : null,
    progressClass: record(result.progressClass) ? result.progressClass : null,
    requiredAction: record(result.requiredAction) ? result.requiredAction : null,
    nextActions: compactNextActions(result.nextActions),
    ...(record(result.lastAction) ? { lastAction: result.lastAction } : {}),
    ...(compactRunResult(result.result) ? { result: compactRunResult(result.result) } : {}),
    ...(record(result.terminalCause) ? { terminalCause: result.terminalCause } : {}),
    ...(record(result.ownership) ? { resources: {
      ownedWorkers: result.ownership.workers ?? 0,
      reaped: (result.ownership.workers ?? 0) === 0
        && TERMINAL_RUN_PHASES.has(canonicalRunPhase(result.phase)),
    } } : {}),
    inspect: { command: `baton run show ${result.runId}` },
  };
  return Object.freeze(compact);
}

function parseStart(args, objective, idempotencyKey, resultIntent = 'change') {
  if (!nonempty(objective)) throw cliError('OBJECTIVE is required');
  const profile = take(args, '--profile');
  const exactValue = take(args, '--exact');
  const model = take(args, '--model');
  const harness = take(args, '--harness');
  const effort = take(args, '--effort');
  const runId = take(args, '--run-id');
  const rawScope = take(args, '--scope');
  const selectorRules = APPLICATION_SEMANTIC_REGISTRY.cli.selectorRules;
  const selected = { model, harness, effort };
  if (exactValue !== null && selectorRules.exactRoute.exclusiveWith.some((name) => selected[name] !== null)) {
    throw cliError('--exact cannot be combined with model, harness, or effort selectors');
  }
  const hasManualRoute = selectorRules.manualRoute.selectors.some((name) => selected[name] !== null);
  if (exactValue === null && hasManualRoute
    && selectorRules.manualRoute.requiredTogether.some((name) => selected[name] === null)) {
    throw cliError('manual routing requires --model and --effort together');
  }
  noRemainder(args);
  const intent = { objective, resultIntent };
  if (profile !== null) intent.profile = id(profile, 'profile');
  if (exactValue !== null) intent.route = route(exactValue);
  else {
    const selector = {};
    if (model !== null) selector.model = id(model, 'model');
    if (harness !== null) selector.harness = id(harness, 'harness');
    if (effort !== null) selector.effort = id(effort, 'effort');
    if (Object.keys(selector).length > 0) intent.route = selector;
  }
  if (runId !== null) intent.runId = id(runId, 'Run ID');
  if (rawScope !== null) {
    const scope = rawScope.split(',').map((item) => item.trim()).filter(Boolean);
    if (scope.length === 0 || new Set(scope).size !== scope.length) throw cliError('scope is invalid');
    intent.scope = scope;
  }
  return { kind: 'command', name: 'run.start', args: { intent }, idempotencyKey };
}

function parseReviewStart(args, objective, idempotencyKey) {
  if (!nonempty(objective)) throw cliError('review OBJECTIVE is required');
  const exactRoutes = takeAll(args, '--exact').map(route);
  const profile = take(args, '--profile');
  const runId = take(args, '--run-id');
  const rawScope = take(args, '--scope');
  noRemainder(args);
  if (exactRoutes.length !== 2) {
    throw cliError('review requires exactly two --exact HARNESS/MODEL@EFFORT routes');
  }
  const intent = {
    objective,
    resultIntent: 'read_only_evidence',
    composition: {
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      team: [
        { role: 'reviewer', route: exactRoutes[0] },
        { role: 'challenger', route: exactRoutes[1] },
      ],
    },
  };
  if (profile !== null) intent.profile = id(profile, 'profile');
  if (runId !== null) intent.runId = id(runId, 'Run ID');
  if (rawScope !== null) {
    const scope = rawScope.split(',').map((item) => item.trim()).filter(Boolean);
    if (scope.length === 0 || new Set(scope).size !== scope.length) {
      throw cliError('scope is invalid');
    }
    intent.scope = scope;
  }
  return { kind: 'command', name: 'run.start', args: { intent }, idempotencyKey };
}

function resolveCanonicalCliArgs(rawArgs) {
  const args = [...rawArgs];
  const aliases = [...APPLICATION_SEMANTIC_REGISTRY.aliases.cli]
    .sort((left, right) => right.canonical.length - left.canonical.length);
  for (const alias of aliases) {
    if (alias.canonical.length > args.length
      || !alias.canonical.every((part, index) => args[index] === part)) continue;
    return [...alias.legacy, ...args.slice(alias.canonical.length)];
  }
  return args;
}

// docs/36 §4.1‡ / §9 M3 — the Episode fold. `run view --section episode.CHAPTER` and the legacy
// `run episode CHAPTER` both compile through this one builder, so the Episode chapter selector and
// its {role, generation?} axes are byte-identical across the folded and legacy spellings. The four
// cross-argument admission rules (application.mjs) are re-enforced downstream; here we mirror the
// legacy Episode selector arithmetic exactly.
function buildEpisodeCommand(args, runId, topic, role, idempotencyKey) {
  const rawGeneration = take(args, '--generation');
  const pageCursor = take(args, '--page-cursor');
  const rawCursor = take(args, '--cursor');
  const rawWait = take(args, '--wait');
  const evidence = flag(args, '--evidence');
  const content = flag(args, '--content');
  noRemainder(args);
  if (!id(topic, 'Episode topic') || (role !== null && !id(role, 'workstream role'))
    || evidence && content) throw cliError('Episode selector is invalid');
  const generation = rawGeneration === null ? null : Number(rawGeneration);
  const cursor = rawCursor === null ? null : Number(rawCursor);
  if ((generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
    || (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0))
    || (rawWait !== null && cursor === null)) throw cliError('Episode continuation is invalid');
  const detail = evidence ? 'evidence' : content ? 'content'
    : topic === 'output' ? 'content' : 'item';
  return {
    kind: 'command', name: 'run.episode', args: {
      runId, topic, ...(role === null ? {} : { role }),
      ...(generation === null ? {} : { generation }), detail,
      ...(pageCursor === null ? {} : { pageCursor }),
      ...(cursor === null ? {} : { cursor }),
      ...(rawWait === null ? {} : { waitMs: duration(rawWait) }),
    }, idempotencyKey,
  };
}

export function parseBatonCli(rawArgs) {
  const args = resolveCanonicalCliArgs(rawArgs);
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
    return { kind: 'help', topic: 'application' };
  }
  const idempotencyKey = take(args, '--idempotency-key') ?? randomUUID();
  if (args[0] === 'credentials') {
    args.shift();
    const longHelp = flag(args, '--help');
    const shortHelp = flag(args, '-h');
    if (longHelp || shortHelp) {
      if (args.length !== 0 && !(args.length === 2 && args[0] === 'install' && args[1] === 'kimi')) {
        throw cliError('expected credentials install kimi');
      }
      return { kind: 'credential-help' };
    }
    if (args.length === 0) return { kind: 'credential-help' };
    if (args.shift() !== 'install' || args.shift() !== 'kimi') {
      throw cliError('expected credentials install kimi');
    }
    noRemainder(args);
    return { kind: 'credential-install', provider: 'kimi' };
  }
  if (args[0] === 'help' && args[1] === 'credentials') {
    args.splice(0, 2);
    noRemainder(args);
    return { kind: 'credential-help' };
  }
  if (args.includes('--help') || args.includes('-h')) {
    flag(args, '--help'); flag(args, '-h');
    let topic = 'application';
    if (args[0] === 'run') {
      const commandTopics = Object.fromEntries(APPLICATION_SEMANTIC_REGISTRY.cli.commands
        .map((command) => [command.subcommand, command.helpTopic]));
      topic = commandTopics[args[1]]
        ?? (args.length > 1 ? 'run.start' : 'run');
    } else if (['explore', 'review', 'workflow'].includes(args[0])) {
      topic = args[0];
    } else if (args[0] === 'route') {
      topic = 'routing';
    }
    return {
      kind: 'command', name: 'application.help',
      args: { topic, depth: 'outline' }, idempotencyKey,
    };
  }
  if (args[0] === 'help') {
    args.shift();
    const topic = args.shift() ?? 'application';
    if (!id(topic, 'help topic')) throw cliError('help topic is invalid');
    noRemainder(args);
    return { kind: 'command', name: 'application.help', args: { topic, depth: 'outline' }, idempotencyKey };
  }
  if (args[0] === 'doctor') {
    args.shift();
    const depth = take(args, '--depth') ?? 'outline';
    const check = flag(args, '--check');
    noRemainder(args);
    if (!['outline', 'connection', 'profile', 'evidence'].includes(depth)) throw cliError('doctor depth is invalid');
    return { kind: 'doctor', depth, check };
  }
  if (args[0] === 'setup') {
    args.shift();
    const profile = take(args, '--profile');
    noRemainder(args);
    return { kind: 'setup', profile: profile === null ? null : id(profile, 'connection profile') };
  }
  if (args[0] === 'serve') {
    args.shift();
    const configPath = args.shift() ?? null;
    if (configPath !== null && !nonempty(configPath)) throw cliError('CONFIG_MODULE is invalid');
    noRemainder(args);
    return { kind: 'serve', configPath };
  }
  if (args[0] === 'route') {
    args.shift();
    const exact = route(args.shift());
    noRemainder(args);
    return { kind: 'route', exact };
  }
  if (args[0] === 'runs' && args[1] === 'list') {
    args.splice(0, 2);
    noRemainder(args);
    return { kind: 'command', name: 'runs.list', args: {}, idempotencyKey };
  }
  if (args[0] === 'review') {
    args.shift();
    return parseReviewStart(args, args.shift(), idempotencyKey);
  }
  if (args[0] === 'explore') {
    args.shift();
    return parseStart(args, args.shift(), idempotencyKey, 'read_only_evidence');
  }
  if (args[0] === 'context') {
    args.shift();
    if (args.shift() !== 'eval') throw cliError('expected context eval');
    // CS-2: context eval has no CLI web route. Refuse at parse with a typed corrective naming
    // the live paths (embedded BatonRun.context().evaluate / MCP baton_context_eval).
    throw cliError(
      'context eval is host-local: use embedded BatonRun.context().evaluate(...) or MCP baton_context_eval',
      'cli_command_host_local',
    );
  }
  // S-1 v2: baton waves attach WAVE_ID --members JSON (plural spelling only).
  if (args[0] === 'wave') {
    throw cliError(
      'wave attach is not a verb; use the plural spelling: baton waves attach WAVE_ID --members JSON',
      'cli_command_unavailable',
    );
  }
  if (args[0] === 'waves') {
    args.shift();
    const action = args.shift();
    if (action !== 'attach') {
      throw cliError('expected waves attach', 'cli_command_unavailable');
    }
    const waveId = id(args.shift(), 'wave ID');
    const membersRaw = take(args, '--members');
    const timeoutRaw = take(args, '--timeout');
    const repoRoot = take(args, '--repo-root');
    noRemainder(args);
    if (!waveId || typeof waveId !== 'string' || !/^wave:[a-f0-9]{32}$/u.test(waveId)) {
      throw cliError('wave ID is invalid');
    }
    if (membersRaw === null) throw cliError('--members is required');
    let members;
    try { members = JSON.parse(membersRaw); }
    catch { throw cliError('--members must be JSON'); }
    if (!Array.isArray(members)) {
      throw cliError('--members must be a JSON array');
    }
    const timeoutMs = timeoutRaw === null ? null : Number(timeoutRaw);
    if (timeoutRaw !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
      throw cliError('--timeout is invalid');
    }
    return {
      kind: 'command',
      name: 'waves.attach',
      args: {
        waveId,
        members,
        ...(timeoutMs === null ? {} : { timeoutMs }),
        ...(repoRoot === null ? {} : { repoRoot }),
      },
      idempotencyKey,
    };
  }
  if (args.shift() !== 'run') {
    throw cliError('expected credentials, setup, doctor, route, explore, review, context, waves, or run');
  }
  const action = args.shift();
  if (action === 'follow') {
    throw cliError(`${action} is not shipped by the Run application`, 'cli_command_unavailable');
  }
  if (action === 'start') {
    return parseStart(args, args.shift(), idempotencyKey);
  }
  const lifecycleActions = new Set(['show', 'do', 'recover', 'status', 'approve', 'answer', 'steer',
    'send', 'interrupt', 'progress', 'events', 'output', 'episode', 'workstreams', 'notify', 'result',
    'stop', 'evidence', 'adopt', 'select', 'feedback', 'revise', 'stop-member',
    'retry', 'resume', 'review', 'integrate', 'export', 'debug']);
  if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey);
  const runId = id(args.shift(), 'Run ID');
  if (action === 'episode' || action === 'result') {
    const topic = action === 'result' ? 'result'
      : args[0] && !args[0].startsWith('--') ? args.shift() : 'outline';
    const role = take(args, '--workstream');
    return buildEpisodeCommand(args, runId, topic, role, idempotencyKey);
  }
  if (action === 'workstreams') {
    const role = args[0] && !args[0].startsWith('--') ? args.shift() : null;
    const rawGeneration = take(args, '--generation');
    const rawCursor = take(args, '--cursor');
    const rawWait = take(args, '--wait');
    noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    const cursor = rawCursor === null ? null : Number(rawCursor);
    if ((role !== null && !id(role, 'workstream role'))
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
      || (generation !== null && role === null)
      || (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0))
      || (rawWait !== null && cursor === null)) throw cliError('workstream selector is invalid');
    return { kind: 'command', name: 'run.workstreams', args: {
      runId, ...(role === null ? {} : { role }),
      ...(generation === null ? {} : { generation }),
      ...(cursor === null ? {} : { cursor }),
      ...(rawWait === null ? {} : { waitMs: duration(rawWait) }),
    }, idempotencyKey };
  }
  if (action === 'notify') {
    const role = id(args.shift(), 'workstream role');
    const message = args.shift();
    const rawGeneration = take(args, '--generation');
    const modes = [['--nudge', 'nudge'], ['--now', 'now'], ['--turn', 'turn']]
      .filter(([name]) => flag(args, name));
    noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    if (!nonempty(message) || modes.length > 1
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))) {
      throw cliError('workstream notification is invalid');
    }
    return { kind: 'command', name: 'run.workstream.notify', args: {
      runId, role, message, delivery: modes[0]?.[1] ?? 'nudge',
      ...(generation === null ? {} : { generation }),
    }, idempotencyKey };
  }
  if (['progress', 'events', 'output'].includes(action)) {
    const follow = flag(args, '--follow');
    const recipient = action === 'output' ? take(args, '--to') : null;
    noRemainder(args);
    return {
      kind: 'stream', runId, channel: action, follow,
      ...(recipient === null ? {} : { recipient: id(recipient, 'recipient') }),
      idempotencyKey,
    };
  }
  if (action === 'show') {
    const section = take(args, '--section');
    // docs/36 §4.1‡ / §9 M3 — the Episode fold. `run view --section episode.CHAPTER` folds the
    // Episode read (carrying its --role/--generation axes) into run.view; it compiles through the
    // one shared Episode builder so it is byte-identical to the legacy `run episode CHAPTER`.
    if (section !== null && section.startsWith('episode.')) {
      // docs/36 §4.1‡ — the explicit `--role none` selects the run-level aggregate (a distinct
      // projection), spelled the same as omitting --role: both address the aggregate, never a
      // literal role named "none".
      const roleFlag = take(args, '--role');
      const role = roleFlag === 'none' ? null : roleFlag;
      return buildEpisodeCommand(args, runId, section.slice('episode.'.length), role, idempotencyKey);
    }
    // docs/36 §4.1 read row / R-OP-9 — `run view --until settled|terminal` absorbs run.wait's
    // deployment-bounded condition wait; the condition resolves through the registry predicates.
    const until = take(args, '--until');
    if (until !== null) {
      const wait = take(args, '--wait');
      noRemainder(args);
      if (!['settled', 'terminal'].includes(until)) throw cliError('run view --until must be settled or terminal');
      if (section !== null) throw cliError('run view --until takes no --section');
      return {
        kind: 'command', name: 'run.wait',
        args: { runId, until, timeoutMs: wait === null ? DEFAULT_APPLICATION_WAIT_MS : duration(wait) },
        idempotencyKey,
      };
    }
    const depth = take(args, '--depth') ?? 'outline';
    const item = take(args, '--item');
    const rawOffset = take(args, '--offset');
    noRemainder(args);
    if (!APPLICATION_SEMANTIC_REGISTRY.depths.includes(depth)) {
      throw cliError('show depth is invalid');
    }
    const sectionRequired = ['section', 'item', 'content', 'evidence'].includes(depth);
    const itemRequired = ['item', 'content', 'evidence'].includes(depth);
    if ((sectionRequired && section === null) || (!sectionRequired && section !== null)
      || (itemRequired && item === null) || (!itemRequired && item !== null)
      || (depth !== 'content' && rawOffset !== null)) {
      throw cliError('show selectors do not match the requested depth');
    }
    let offset;
    if (rawOffset !== null) {
      offset = Number(rawOffset);
      if (!Number.isSafeInteger(offset) || offset < 0) throw cliError('show offset is invalid');
    }
    return {
      kind: 'command', name: 'run.inspect',
      args: {
        runId, depth,
        ...(section === null ? {} : { section: id(section, 'Run section') }),
        ...(item === null ? {} : { item: id(item, 'Run item') }),
        ...(offset === undefined ? {} : { offset }),
      },
      idempotencyKey,
    };
  }
  if (action === 'do') {
    const actionId = id(args.shift(), 'action ID');
    const rawInputs = take(args, '--inputs');
    noRemainder(args);
    let inputs = {};
    if (rawInputs !== null) {
      try { inputs = JSON.parse(rawInputs); } catch { throw cliError('action inputs must be JSON', 'cli_action_inputs_invalid'); }
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw cliError('action inputs must be an object', 'cli_action_inputs_invalid');
    }
    return { kind: 'command', name: 'run.act', args: { runId, actionId, inputs }, idempotencyKey };
  }
  if (action === 'recover') {
    noRemainder(args);
    return { kind: 'command', name: 'run.recover', args: { runId }, idempotencyKey };
  }
  if (action === 'status') {
    const wait = take(args, '--wait');
    const follow = flag(args, '--follow');
    noRemainder(args);
    if (follow) return { kind: 'follow', runId, timeoutMs: wait === null ? null : duration(wait), idempotencyKey };
    return wait === null
      ? { kind: 'command', name: 'run.status', args: { runId }, idempotencyKey }
      : { kind: 'command', name: 'run.wait', args: { runId, timeoutMs: duration(wait) }, idempotencyKey };
  }
  if (action === 'approve') {
    const planDigest = digest(take(args, '--plan', { required: true }), 'Plan digest'); noRemainder(args);
    return { kind: 'command', name: 'run.approve', args: { runId, planDigest }, idempotencyKey };
  }
  if (action === 'answer') {
    const requestId = id(args.shift(), 'request ID');
    const decisions = [['--allow', 'allow'], ['--deny', 'deny'], ['--cancel', 'cancel']].filter(([name]) => flag(args, name));
    const text = take(args, '--text');
    // Part B (issue #16): `baton run answer RUN --option ID` — the typed decision-channel form.
    const optionId = take(args, '--option');
    noRemainder(args);
    const forms = decisions.length + (text === null ? 0 : 1) + (optionId === null ? 0 : 1);
    if (forms !== 1) throw cliError('choose exactly one answer form: --allow | --deny | --cancel | --text | --option');
    const answer = optionId !== null ? { optionId } : text === null ? { decision: decisions[0][1] } : { text };
    return { kind: 'command', name: 'run.answer', args: { runId, requestId, answer }, idempotencyKey };
  }
  if (action === 'send') {
    const message = args.shift();
    const recipient = take(args, '--to');
    const modes = [['--nudge', 'nudge'], ['--now', 'now'], ['--turn', 'turn']]
      .filter(([name]) => flag(args, name));
    noRemainder(args);
    if (!nonempty(message) || modes.length > 1
      || (recipient !== null && !id(recipient, 'semantic recipient'))) {
      throw cliError('send requires bounded guidance and at most one delivery mode');
    }
    return {
      kind: 'semantic-action', actionKind: 'send', runId,
      inputs: {
        message, ...(recipient === null ? {} : { recipient }),
        ...(modes.length === 0 ? {} : { delivery: modes[0][1] }),
      },
      idempotencyKey,
    };
  }
  if (action === 'interrupt') {
    // docs/36 §3 / §9 M3 — `run member interrupt RUN ROLE [--generation N]` rewrites onto this
    // verb (a positional member role is its {role, generation?} address); the run-level form keeps
    // `--to RECIPIENT` and resolves the live recipient with no generation axis.
    const positional = args[0] && !args[0].startsWith('--') ? args.shift() : null;
    const recipient = positional ?? take(args, '--to');
    const rawGeneration = take(args, '--generation');
    const reason = take(args, '--reason');
    noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    if ((recipient !== null && !id(recipient, 'semantic recipient'))
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
      || (generation !== null && recipient === null)
      || (reason !== null && !nonempty(reason))) {
      throw cliError('interrupt recipient or reason is invalid');
    }
    return {
      kind: 'semantic-action', actionKind: 'interrupt', runId,
      inputs: {
        ...(recipient === null ? {} : { recipient }),
        ...(generation === null ? {} : { generation }),
        ...(reason === null ? {} : { reason }),
      },
      idempotencyKey,
    };
  }
  if (action === 'steer') {
    // docs/36 §9 M5 — the alias sunset: run.steer is deleted as a surface alias. The corrective
    // naming is the run-level `run send` verb (live-recipient-resolving, no worker-id target).
    throw cliError('steer was deleted at the M5 alias sunset; use run send', 'cli_command_unavailable');
  }
  if (action === 'stop') {
    const reason = take(args, '--reason') ?? 'Operator requested Run stop.'; noRemainder(args);
    return { kind: 'command', name: 'run.stop', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'evidence') { noRemainder(args); return { kind: 'command', name: 'run.evidence', args: { runId }, idempotencyKey }; }
  if (action === 'debug') {
    // Issue #53: `baton run debug RUN [--member ROLE] [--limit N]` — parity with the embedded
    // run.debug({member,limit}) accessor; both read the same bounded, whitelisted projection.
    const role = take(args, '--member');
    const rawLimit = take(args, '--limit');
    noRemainder(args);
    const limit = rawLimit === null ? null : Number(rawLimit);
    if ((role !== null && !id(role, 'debug member role'))
      || (rawLimit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 10))) {
      throw cliError('debug selector is invalid');
    }
    return {
      kind: 'command', name: 'run.debug',
      args: {
        runId, ...(role === null ? {} : { member: role }), ...(limit === null ? {} : { limit }),
      },
      idempotencyKey,
    };
  }
  if (action === 'adopt') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'adopt', runId, reason, idempotencyKey };
  }
  if (action === 'select') {
    const role = id(args.shift(), 'Workflow role');
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return {
      kind: 'semantic-action', actionKind: 'select_candidate', runId,
      inputs: { role, reason }, idempotencyKey,
    };
  }
  if (action === 'feedback') {
    const role = id(args.shift(), 'Workflow role');
    const feedback = take(args, '--text', { required: true }); noRemainder(args);
    return {
      kind: 'semantic-action', actionKind: 'send_feedback', runId,
      inputs: { role, feedback }, idempotencyKey,
    };
  }
  if (action === 'revise') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return {
      kind: 'semantic-action', actionKind: 'revise_candidate', runId,
      inputs: { reason }, idempotencyKey,
    };
  }
  if (action === 'stop-member') {
    const role = id(args.shift(), 'Workflow role');
    const rawGeneration = take(args, '--generation');
    const reason = take(args, '--reason'); noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    if (generation !== null && (!Number.isSafeInteger(generation) || generation < 1)) {
      throw cliError('workstream generation is invalid');
    }
    return {
      kind: 'command', name: 'run.workstream.stop',
      args: {
        runId, role, ...(generation === null ? {} : { generation }),
        ...(reason === null ? {} : { reason }),
      }, idempotencyKey,
    };
  }
  if (action === 'retry') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.retry_verification', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'resume') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.resume_work', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'review') {
    const exact = route(take(args, '--exact', { required: true }));
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.review', args: { runId, route: exact, reason }, idempotencyKey };
  }
  if (action === 'integrate') {
    const strategy = take(args, '--strategy', { required: true });
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    if (!['ff-only', 'structured'].includes(strategy)) throw cliError('integration strategy must be ff-only or structured');
    return { kind: 'integrate', runId, strategy, reason, idempotencyKey };
  }
  if (action === 'export') {
    const destination = args.shift();
    if (!nonempty(destination) || destination.includes('\0')) throw cliError('export destination is required');
    noRemainder(args);
    return { kind: 'export', runId, destination, idempotencyKey };
  }
  throw cliError(`unknown run action ${action ?? ''}`);
}

export class BatonWebClient {
  #token;

  constructor(options) {
    exactKeys(options, ['baseUrl', 'origin', 'repoId', 'token', 'commandTimeoutMs', 'pollMs', 'fetchImpl', 'clock', 'sleep'], 'Web client configuration');
    const base = new URL(options.baseUrl);
    const origin = new URL(options.origin);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
      || base.search || base.hash
      || origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash
      || !id(options.repoId, 'repository ID') || !nonempty(options.token)
      || !Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0
      || !Number.isSafeInteger(options.pollMs) || options.pollMs <= 0 || options.pollMs > options.commandTimeoutMs
      || typeof options.fetchImpl !== 'function' || typeof options.clock !== 'function' || typeof options.sleep !== 'function') {
      throw cliError('Web client configuration is invalid', 'cli_config_invalid');
    }
    this.baseUrl = base.href.replace(/\/$/u, '');
    this.origin = origin.origin;
    this.repoId = options.repoId;
    this.#token = options.token;
    this.commandTimeoutMs = options.commandTimeoutMs;
    this.pollMs = options.pollMs;
    this.requestTimeoutMs = Math.min(options.commandTimeoutMs,
      DEFAULT_APPLICATION_WAIT_MS + WEB_WAIT_TRANSPORT_SLACK_MS);
    this.maxJsonResponseBytes = 2 * 1024 * 1024;
    this.fetch = options.fetchImpl;
    this.clock = options.clock;
    this.sleep = options.sleep;
  }

  _headers(json = false) {
    return { authorization: `Bearer ${this.#token}`, origin: this.origin, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  async _json(path, options = {}, requestTimeoutMs = this.requestTimeoutMs) {
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0
      || requestTimeoutMs > (24 * 60 * 60 * 1_000) + WEB_WAIT_TRANSPORT_SLACK_MS) {
      throw cliError('Baton Web request timeout is invalid', 'cli_config_invalid');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      let response;
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, {
          ...options, redirect: 'error', signal: controller.signal,
        });
      } catch {
        throw cliError('Baton Web connection failed', 'cli_transport_failed');
      }
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > this.maxJsonResponseBytes) {
        throw cliError('Baton Web response exceeds its safe boundary', 'cli_protocol_failed');
      }
      let body;
      try {
        if (typeof response.text === 'function') {
          const raw = await response.text();
          if (Buffer.byteLength(raw) > this.maxJsonResponseBytes) {
            throw cliError('Baton Web response exceeds its safe boundary', 'cli_protocol_failed');
          }
          body = JSON.parse(raw);
        } else {
          // Narrow test transports may expose only json(); production fetch responses always
          // take the bounded text path above.
          body = await response.json();
        }
      } catch (error) {
        if (error?.code === 'cli_protocol_failed') throw error;
        throw cliError('Baton Web returned invalid JSON', 'cli_protocol_failed');
      }
      if (!response.ok) {
        const receivedCode = body?.error?.code;
        const code = typeof receivedCode === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(receivedCode)
          ? receivedCode : 'cli_command_failed';
        // Issue #41: say what was refused and how — the path and status are the caller's own
        // request facts, never a secret.
        throw cliError(`Baton Web request was refused (${options.method ?? 'GET'} ${path}, HTTP ${response.status})`, code);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async doctor() {
    const readiness = await this._json('/readyz', { headers: { origin: this.origin } });
    const card = await this._json('/v1/application-card', { headers: { ...this._headers(), 'sec-fetch-site': 'none' } });
    const deployment = record(card?.application?.readiness)
      ? card.application.readiness : null;
    const routes = Array.isArray(deployment?.routes) ? deployment.routes : [];
    return {
      schemaVersion: 1,
      ready: readiness.ready === true,
      deployment,
      routes,
      application: card.application,
    };
  }

  async session() {
    const body = await this._json('/v1/session', { headers: { ...this._headers(), 'sec-fetch-site': 'none' } });
    const identity = body?.identity;
    const expiresAt = Date.parse(body?.expiresAt);
    const identityFields = ['capabilities', 'repoIds', 'sessionId', 'userId'];
    if (!record(body) || Object.keys(body).sort().join(',') !== ['expiresAt', 'identity', 'ok'].join(',')
      || body.ok !== true || !record(identity)
      || Object.keys(identity).sort().join(',') !== identityFields.sort().join(',')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(identity.userId ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(identity.sessionId ?? '')
      || !Array.isArray(identity.capabilities) || identity.capabilities.length === 0
      || identity.capabilities.length > 256
      || identity.capabilities.some((value) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? ''))
      || new Set(identity.capabilities).size !== identity.capabilities.length
      || !Array.isArray(identity.repoIds) || identity.repoIds.length === 0 || identity.repoIds.length > 256
      || identity.repoIds.some((value) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? ''))
      || new Set(identity.repoIds).size !== identity.repoIds.length
      || !identity.capabilities.includes('observe') || !identity.repoIds.includes(this.repoId)
      || !Number.isFinite(expiresAt) || expiresAt <= this.clock()) {
      throw cliError('Baton Web returned an invalid authenticated session', 'cli_protocol_failed');
    }
    return Object.freeze({
      schemaVersion: 1,
      identity: Object.freeze({
        userId: identity.userId, sessionId: identity.sessionId,
        capabilities: Object.freeze([...identity.capabilities]),
        repoIds: Object.freeze([...identity.repoIds]),
      }),
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  async command(name, args, idempotencyKey = randomUUID()) {
    if (!CLI_WEB_COMMANDS.has(name)) throw cliError(`unsupported Run command ${name}`, 'cli_command_unavailable');
    id(idempotencyKey, 'idempotency key');
    const command = name.replaceAll('.', '_');
    const runId = name === 'run.start' ? args.intent.runId ?? null : args.runId;
    const envelope = {
      schemaVersion: 1, commandId: randomUUID(), idempotencyKey, command, args,
      repoId: this.repoId, ...(runId ? { runId } : {}), origin: this.origin,
    };
    const body = await this._json('/v1/commands', {
      method: 'POST', headers: this._headers(true), body: JSON.stringify(envelope),
    }, this._requestTimeoutForCommand(name, args));
    if (body.status !== 'admitted') return body.result ?? body;
    return this.reconcile(envelope.commandId);
  }

  _requestTimeoutForCommand(name, args) {
    let serverWaitMs = 0;
    if (['run.follow', 'run.wait'].includes(name)) serverWaitMs = args.timeoutMs;
    if (name === 'run.inspect' && args.cursor !== undefined) {
      serverWaitMs = args.waitMs ?? DEFAULT_APPLICATION_WAIT_MS;
    }
    return Number.isSafeInteger(serverWaitMs) && serverWaitMs > 0
      ? Math.max(this.requestTimeoutMs, serverWaitMs + WEB_WAIT_TRANSPORT_SLACK_MS)
      : this.requestTimeoutMs;
  }

  async actionAuthority(args, idempotencyKey) {
    id(idempotencyKey, 'idempotency key');
    const body = await this._json('/v1/action-authority', {
      method: 'POST',
      headers: this._headers(true),
      body: JSON.stringify({
        schemaVersion: 1, repoId: this.repoId, idempotencyKey, args,
      }),
    });
    const authority = body?.semanticAuthority;
    if (body?.ok !== true || !record(authority)
      || authority.schemaVersion !== 1
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(authority.actionId ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(authority.kind ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(authority.effect ?? '')
      || !Array.isArray(authority.requiredCapabilities)
      || authority.requiredCapabilities.length === 0
      || authority.requiredCapabilities.some(
        (capability) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(capability ?? ''),
      )
      || new Set(authority.requiredCapabilities).size !== authority.requiredCapabilities.length
      || !/^[a-f0-9]{64}$/u.test(authority.authorityDigest ?? '')) {
      throw cliError('Baton Web returned invalid semantic action authority',
        'cli_protocol_failed');
    }
    return Object.freeze({
      ...authority,
      requiredCapabilities: Object.freeze([...authority.requiredCapabilities]),
    });
  }

  async reconcile(commandId) {
    id(commandId, 'command ID');
    const deadline = this.clock() + this.commandTimeoutMs;
    while (this.clock() < deadline) {
      const body = await this._json(`/v1/commands/${encodeURIComponent(commandId)}`, { headers: this._headers() });
      if (body.command?.status !== 'admitted') {
        const outcome = body.command?.outcome;
        if (!outcome || outcome.httpStatus >= 400) throw cliError(outcome?.body?.error?.code ?? 'command outcome unavailable', outcome?.body?.error?.code ?? 'cli_command_failed');
        return outcome.body?.result ?? outcome.body;
      }
      await this.sleep(this.pollMs);
    }
    throw cliError('Baton Web command remains admitted', 'cli_command_pending');
  }

  async downloadExport({ runId, receipt, destination }) {
    if (!id(runId, 'Run ID') || !record(receipt) || receipt.state !== 'completed'
      || !/^[a-f0-9]{64}$/u.test(receipt.exportId ?? '')
      || !/^[a-f0-9]{64}$/u.test(receipt.manifestDigest ?? '')
      || !nonempty(destination) || destination.includes('\0')) {
      throw cliError('export delivery request is invalid', 'cli_export_delivery_invalid');
    }
    const issued = await this._json('/v1/export-downloads', {
      method: 'POST', headers: this._headers(true), body: JSON.stringify({
        repoId: this.repoId, runId, exportId: receipt.exportId,
      }),
    });
    const descriptor = issued?.delivery;
    if (!nonempty(issued?.ticket) || descriptor?.exportId !== receipt.exportId
      || descriptor?.manifestDigest !== receipt.manifestDigest) {
      throw cliError('Baton Web returned an invalid export ticket', 'cli_protocol_failed');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response;
    let archiveBytes;
    try {
      response = await this.fetch(`${this.baseUrl}/v1/exports/${receipt.exportId}/archive`, {
        method: 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: {
          ...this._headers(), 'x-baton-export-ticket': issued.ticket,
        },
      });
      if (!response.ok) throw cliError('Baton export download was refused', 'cli_export_download_failed');
      const expectedContentDigest = `sha-256=:${Buffer.from(descriptor.archiveDigest ?? '', 'hex').toString('base64')}:`;
      if (response.headers.get('content-type') !== descriptor.mediaType
        || response.headers.get('content-length') !== String(descriptor.archiveBytes)
        || response.headers.get('content-digest') !== expectedContentDigest
        || response.headers.get('cache-control') !== 'no-store') {
        throw cliError('Baton export response headers differ from the ticket', 'cli_protocol_failed');
      }
      archiveBytes = Buffer.from(await response.arrayBuffer());
      if (archiveBytes.length !== descriptor.archiveBytes) {
        throw cliError('Baton export response length differs from the ticket', 'cli_protocol_failed');
      }
    } catch (error) {
      if (error?.code?.startsWith('cli_')) throw error;
      throw cliError('Baton export download failed', 'cli_transport_failed');
    } finally { clearTimeout(timeout); }
    const delivered = extractResultExportArchive({ archiveBytes, descriptor, destination });
    return Object.freeze({ ...delivered, runId });
  }
}

export async function connectBaton({
  repo = process.cwd(),
  advanced = {},
} = {}) {
  if (!nonempty(repo) || repo.includes('\0') || !record(advanced)
    || Object.keys(advanced).some((key) => ![
      'commandTimeoutMs', 'pollMs', 'fetchImpl', 'clock', 'sleep', 'env', 'home', 'ownerUid',
    ].includes(key))) {
    throw cliError('Baton connection options are invalid', 'cli_config_invalid');
  }
  const env = advanced.env ?? process.env;
  const connection = discoverBatonConnection({
    cwd: resolve(repo), env,
    home: advanced.home ?? env.HOME,
    ownerUid: advanced.ownerUid
      ?? (typeof process.getuid === 'function' ? process.getuid() : null),
  });
  if (connection.authority === 'repository-user-profile') {
    const local = repositoryIdentityFromMetadata(resolve(repo));
    if (connection.repoId !== local.repoId) {
      throw cliError('Baton repository selector does not match this Git repository',
        'cli_connection_incompatible');
    }
  }
  const fetchImpl = advanced.fetchImpl ?? (connection.transport === 'local'
    ? createLocalSocketFetch({
      socketPath: connection.socketPath,
      baseUrl: connection.baseUrl,
      ownerUid: advanced.ownerUid
        ?? (typeof process.getuid === 'function' ? process.getuid() : null),
    })
    : globalThis.fetch);
  if (typeof fetchImpl !== 'function') {
    throw cliError('Baton Web transport is unavailable', 'cli_config_invalid');
  }
  const client = new BatonWebClient({
    baseUrl: connection.baseUrl,
    origin: connection.origin,
    repoId: connection.repoId,
    token: connection.token,
    // A normal `run.inspect` continuation may use the deployment's 30-second wait policy.
    // Reconciliation must outlive that server-owned wait plus admission/completion publication;
    // otherwise an ordinary `--follow` command deterministically races its own timeout.
    commandTimeoutMs: advanced.commandTimeoutMs ?? 90_000,
    pollMs: advanced.pollMs ?? 100,
    fetchImpl,
    clock: advanced.clock ?? Date.now,
    sleep: advanced.sleep ?? ((milliseconds) => new Promise((resolveSleep) => {
      setTimeout(resolveSleep, milliseconds);
    })),
  });
  const [doctor, session] = await Promise.all([client.doctor(), client.session()]);
  const requiredCommands = ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop'];
  if (doctor.ready !== true
    || doctor.application?.schemaVersion !== 1
    || doctor.application?.repoId !== connection.repoId
    || !Array.isArray(doctor.application?.commands)
    || requiredCommands.some((command) => !doctor.application.commands.includes(command))
    || doctor.application?.agentExperience?.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest
    || !session.identity.repoIds.includes(connection.repoId)
    || (connection.transport === 'local'
      && (doctor.application?.resident?.schemaVersion !== 1
        || doctor.application.resident.deploymentId !== connection.deploymentId
        || doctor.application.resident.incarnation !== connection.incarnation))) {
    throw cliError('Baton resident authority is incompatible or not ready',
      'cli_connection_incompatible');
  }
  return bindBatonPort(Object.freeze({
    command: (name, args) => client.command(name, args),
    doctor: () => client.doctor(),
  }));
}

export async function runBatonCli(parsed, client, options = {}) {
  if (parsed.kind === 'help') return { help: BATON_CLI_HELP };
  if (parsed.kind === 'doctor') return client.doctor();
  if (parsed.kind === 'route') {
    const doctor = await client.doctor();
    const routes = Array.isArray(doctor?.routes)
      ? doctor.routes : doctor?.application?.readiness?.routes;
    const matches = routes?.filter((candidate) => (
      candidate.harness === parsed.exact.harness && candidate.model === parsed.exact.model
      && candidate.effort === parsed.exact.effort
    )) ?? [];
    if (matches.length !== 1) {
      throw cliError('Exact route is not configured by this deployment',
        'application_route_unavailable');
    }
    return matches[0];
  }
  if (parsed.kind === 'command') return client.command(parsed.name, parsed.args, parsed.idempotencyKey);
  if (parsed.kind === 'stream') {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'onFollowPage')
      || (options.onFollowPage !== undefined && typeof options.onFollowPage !== 'function')) {
      throw cliError('CLI stream options are invalid', 'cli_config_invalid');
    }
    const item = `execution:${parsed.channel}`;
    const request = (extra = {}) => client.command('run.inspect', {
      runId: parsed.runId, depth: 'content', section: 'execution', item,
      ...(parsed.recipient ? { recipient: parsed.recipient } : {}), ...extra,
    }, `${parsed.idempotencyKey}:${parsed.channel}:${extra.pageCursor ?? 'initial'}:${extra.cursor ?? 'now'}`);
    let view = await request();
    if (parsed.channel === 'progress') {
      const assertProgress = (candidate) => {
        if (candidate?.runId !== parsed.runId || candidate.content?.runId !== parsed.runId
          || candidate.content?.kind !== 'baton.run_progress') {
          throw cliError('Baton returned progress for a different Run or channel',
            'cli_protocol_failed');
        }
      };
      assertProgress(view);
      if (!parsed.follow) return view;
      await options.onFollowPage?.(view);
      while (!view.terminal) {
        view = await request({ cursor: view.cursor });
        assertProgress(view);
        if (view.changed || view.terminal) await options.onFollowPage?.(view);
      }
      return view;
    }
    const assertTimeline = (candidate) => {
      const content = candidate?.content;
      if (candidate?.runId !== parsed.runId || content?.runId !== parsed.runId
        || content?.kind !== 'baton.run_timeline.page'
        || content.channel !== parsed.channel || !Array.isArray(content.items)
        || content.items.some((entry) => entry?.runId !== parsed.runId)
        || typeof content.cursor !== 'string' || typeof content.hasMore !== 'boolean'
        || (content.hasMore && content.items.length === 0)) {
        throw cliError('Baton returned an invalid or cross-Run timeline page',
          'cli_protocol_failed');
      }
    };
    assertTimeline(view);
    if (!parsed.follow) return view;
    if ((view.content?.items?.length ?? 0) > 0) await options.onFollowPage?.(view);
    for (;;) {
      if (view.terminal && !view.content.hasMore) return view;
      view = await request({
        pageCursor: view.content.cursor,
        ...(!view.content.hasMore ? { cursor: view.cursor } : {}),
      });
      assertTimeline(view);
      if ((view.content?.items?.length ?? 0) > 0) await options.onFollowPage?.(view);
    }
  }
  if (parsed.kind === 'follow') {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'onFollowPage')
      || (options.onFollowPage !== undefined && typeof options.onFollowPage !== 'function')) {
      throw cliError('CLI follow options are invalid', 'cli_config_invalid');
    }
    let view = await client.command('run.status', { runId: parsed.runId }, `${parsed.idempotencyKey}:status`);
    if (TERMINAL_RUN_PHASES.has(canonicalRunPhase(view?.phase))) return view;
    let timeoutMs = parsed.timeoutMs;
    if (timeoutMs === null) {
      const doctor = await client.doctor();
      const profile = doctor?.application?.profiles?.find((candidate) => candidate.name === view?.profile?.name
        && candidate.digest === view?.profile?.digest);
      timeoutMs = profile?.followPolicy?.mode === 'enabled' ? profile.followPolicy.maxWaitMs : null;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw cliError('Run profile does not enable follow', 'application_follow_unavailable');
      }
    }
    let cursor = view.cursor;
    for (let page = 0; ; page += 1) {
      view = await client.command('run.follow', {
        runId: parsed.runId, afterCursor: cursor, timeoutMs,
      }, `${parsed.idempotencyKey}:follow:${page}:${cursor}`);
      await options.onFollowPage?.(view);
      if (!view?.follow || !Number.isSafeInteger(view.follow.throughCursor)
        || view.follow.throughCursor < cursor) {
        throw cliError('Baton Web returned an invalid follow page', 'cli_protocol_failed');
      }
      cursor = view.follow.throughCursor;
      if (view.follow.terminal || TERMINAL_RUN_PHASES.has(canonicalRunPhase(view.phase))) return view;
    }
  }
  if (parsed.kind === 'adopt') {
    const evidence = await client.command('run.evidence', { runId: parsed.runId }, `${parsed.idempotencyKey}:evidence`);
    if (!evidence?.result?.nodeKey || !evidence?.result?.sha || !evidence?.manifestDigest) {
      throw cliError('Run has no preserved result available for adoption', 'application_result_unavailable');
    }
    return client.command('run.adopt', {
      runId: parsed.runId, nodeKey: evidence.result.nodeKey, resultSha: evidence.result.sha,
      evidenceDigest: evidence.manifestDigest, reason: parsed.reason,
    }, `${parsed.idempotencyKey}:adopt`);
  }
  if (parsed.kind === 'semantic-action') {
    const view = await client.command('run.inspect', {
      runId: parsed.runId, depth: 'outline',
    }, `${parsed.idempotencyKey}:inspect`);
    const matching = (view?.outline?.actions ?? []).filter((action) => action?.kind === parsed.actionKind);
    if (matching.length !== 1 || !nonempty(matching[0]?.actionId)) {
      throw cliError(`Run does not currently advertise ${parsed.actionKind}`, 'application_action_unavailable');
    }
    return client.command('run.act', {
      runId: parsed.runId, actionId: matching[0].actionId, inputs: parsed.inputs,
    }, `${parsed.idempotencyKey}:act`);
  }
  if (parsed.kind === 'integrate') {
    const evidence = await client.command('run.evidence', { runId: parsed.runId }, `${parsed.idempotencyKey}:evidence`);
    if (!evidence?.manifestDigest) throw cliError('Run has no terminal evidence available for integration', 'application_run_not_terminal');
    return client.command('run.integrate', {
      runId: parsed.runId, evidenceDigest: evidence.manifestDigest,
      strategy: parsed.strategy, reason: parsed.reason,
    }, `${parsed.idempotencyKey}:integrate`);
  }
  if (parsed.kind === 'export') {
    const evidence = await client.command('run.evidence', { runId: parsed.runId }, `${parsed.idempotencyKey}:evidence`);
    if (!evidence?.manifestDigest) throw cliError('Run has no terminal evidence available for export', 'application_run_not_terminal');
    const view = await client.command('run.export', {
      runId: parsed.runId, evidenceDigest: evidence.manifestDigest,
    }, `${parsed.idempotencyKey}:export`);
    if (!view?.export || view.export.state !== 'completed') {
      throw cliError('Run export did not produce a completed receipt', 'application_export_incomplete');
    }
    return client.downloadExport({
      runId: parsed.runId, receipt: view.export, destination: parsed.destination,
    });
  }
  throw cliError('unsupported CLI operation');
}
