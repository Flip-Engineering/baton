import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';
import { foldCanonicalCase } from './canonical-order.mjs';
import { publishResultExportNoReplace } from './result-export.mjs';

const COMMANDS = new Set(['run.start', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.review', 'run.integrate', 'run.export']);
const TERMINAL_RUN_PHASES = new Set(['work_completed', 'completed', 'failed', 'cancelled', 'denied', 'stopped', 'closed']);
const CONNECTION_ENV = Object.freeze(['BATON_URL', 'BATON_ORIGIN', 'BATON_REPO_ID', 'BATON_TOKEN']);

function cliError(message, code = 'cli_invalid') { return Object.assign(new Error(message), { code }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function exactKeys(value, keys, label) {
  if (!record(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw cliError(`${label} has unknown or missing fields`, 'cli_config_invalid');
  }
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
  exactKeys(repository, ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration');
  if (repository.schemaVersion !== 1) throw cliError('repository connection schema is unsupported', 'cli_config_invalid');
  id(repository.profile, 'connection profile');
  id(repository.repoId, 'repository ID');
  if (nonempty(env.XDG_CONFIG_HOME) && !isAbsolute(env.XDG_CONFIG_HOME)) {
    throw cliError('XDG_CONFIG_HOME must be absolute', 'cli_config_invalid');
  }
  const configRoot = nonempty(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME
    : nonempty(home) && isAbsolute(home) ? join(home, '.config') : null;
  if (!configRoot) throw cliError('user configuration home is unavailable', 'cli_config_invalid');
  const profilePath = join(configRoot, 'baton', 'connections', `${repository.profile}.json`);
  const profile = readConnectionJson(profilePath, 'user connection profile', { ownerOnly: true, ownerUid });
  exactKeys(profile, ['schemaVersion', 'url', 'origin', 'tokenFile'], 'user connection profile');
  if (profile.schemaVersion !== 1 || !nonempty(profile.url) || !nonempty(profile.origin) || !nonempty(profile.tokenFile)) {
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
    try { publishResultExportNoReplace({ temporary, final }); }
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

export function batonCliHelp(topic = 'application') {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const commandById = new Map(registry.cli.commands.map((command) => [command.id, command]));
  let definition = registry.cli.helpTopics[topic];
  if (definition?.aliasFor) definition = registry.cli.helpTopics[definition.aliasFor];
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
  return blocks.join('\n\n');
}

export const BATON_CLI_HELP = batonCliHelp(APPLICATION_SEMANTIC_REGISTRY.cli.defaultHelpTopic);

function parseStart(args, objective, idempotencyKey) {
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
  const intent = { objective };
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

export function parseBatonCli(rawArgs) {
  const args = [...rawArgs];
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
    return { kind: 'help', topic: 'application' };
  }
  const idempotencyKey = take(args, '--idempotency-key') ?? randomUUID();
  if (args.includes('--help') || args.includes('-h')) {
    flag(args, '--help'); flag(args, '-h');
    let topic = 'application';
    if (args[0] === 'run') {
      const commandTopics = Object.fromEntries(APPLICATION_SEMANTIC_REGISTRY.cli.commands
        .map((command) => [command.subcommand, command.helpTopic]));
      topic = commandTopics[args[1]]
        ?? (args.length > 1 ? 'run.start' : 'run');
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
  if (args[0] === 'doctor') { args.shift(); noRemainder(args); return { kind: 'doctor' }; }
  if (args[0] === 'serve') {
    args.shift();
    const configPath = args.shift();
    if (!nonempty(configPath)) throw cliError('CONFIG_MODULE is required');
    noRemainder(args);
    return { kind: 'serve', configPath };
  }
  if (args.shift() !== 'run') throw cliError('expected doctor or run');
  const action = args.shift();
  if (action === 'follow') {
    throw cliError(`${action} is not shipped by the Run application`, 'cli_command_unavailable');
  }
  if (action === 'start') {
    return parseStart(args, args.shift(), idempotencyKey);
  }
  const lifecycleActions = new Set(['show', 'do', 'recover', 'status', 'approve', 'answer', 'steer',
    'stop', 'evidence', 'adopt', 'retry', 'review', 'integrate', 'export']);
  if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey);
  const runId = id(args.shift(), 'Run ID');
  if (action === 'show') {
    noRemainder(args);
    return { kind: 'command', name: 'run.inspect', args: { runId, depth: 'outline' }, idempotencyKey };
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
    const text = take(args, '--text'); noRemainder(args);
    if (decisions.length + (text === null ? 0 : 1) !== 1) throw cliError('choose exactly one answer form');
    const answer = text === null ? { decision: decisions[0][1] } : { text };
    return { kind: 'command', name: 'run.answer', args: { runId, requestId, answer }, idempotencyKey };
  }
  if (action === 'steer') {
    const target = id(args.shift(), 'worker target');
    const modes = [['--nudge', 'nudge'], ['--now', 'now'], ['--turn', 'turn']].filter(([name]) => flag(args, name));
    const message = args.shift();
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    if (modes.length !== 1 || !nonempty(message) || !nonempty(reason)) throw cliError('steer requires one mode, direction text, and reason');
    return { kind: 'command', name: 'run.steer', args: { runId, target, mode: modes[0][1], message, reason }, idempotencyKey };
  }
  if (action === 'stop') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.stop', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'evidence') { noRemainder(args); return { kind: 'command', name: 'run.evidence', args: { runId }, idempotencyKey }; }
  if (action === 'adopt') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'adopt', runId, reason, idempotencyKey };
  }
  if (action === 'retry') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.retry_verification', args: { runId, reason }, idempotencyKey };
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
  constructor(options) {
    exactKeys(options, ['baseUrl', 'origin', 'repoId', 'token', 'commandTimeoutMs', 'pollMs', 'fetchImpl', 'clock', 'sleep'], 'Web client configuration');
    const base = new URL(options.baseUrl);
    const origin = new URL(options.origin);
    if (base.protocol !== 'https:' || origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
      || !id(options.repoId, 'repository ID') || !nonempty(options.token)
      || !Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0
      || !Number.isSafeInteger(options.pollMs) || options.pollMs <= 0 || options.pollMs > options.commandTimeoutMs
      || typeof options.fetchImpl !== 'function' || typeof options.clock !== 'function' || typeof options.sleep !== 'function') {
      throw cliError('Web client configuration is invalid', 'cli_config_invalid');
    }
    this.baseUrl = base.href.replace(/\/$/u, '');
    this.origin = origin.origin;
    this.repoId = options.repoId;
    this.token = options.token;
    this.commandTimeoutMs = options.commandTimeoutMs;
    this.pollMs = options.pollMs;
    this.fetch = options.fetchImpl;
    this.clock = options.clock;
    this.sleep = options.sleep;
  }

  _headers(json = false) {
    return { authorization: `Bearer ${this.token}`, origin: this.origin, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  async _json(path, options = {}) {
    let response;
    try { response = await this.fetch(`${this.baseUrl}${path}`, options); }
    catch { throw cliError('Baton Web connection failed', 'cli_transport_failed'); }
    let body;
    try { body = await response.json(); } catch { throw cliError('Baton Web returned invalid JSON', 'cli_protocol_failed'); }
    if (!response.ok) throw cliError(body?.error?.code ?? 'Baton Web command failed', body?.error?.code ?? 'cli_command_failed');
    return body;
  }

  async doctor() {
    const readiness = await this._json('/readyz', { headers: { origin: this.origin } });
    const card = await this._json('/v1/application-card', { headers: { ...this._headers(), 'sec-fetch-site': 'none' } });
    return { schemaVersion: 1, ready: readiness.ready === true, application: card.application };
  }

  async command(name, args, idempotencyKey = randomUUID()) {
    if (!COMMANDS.has(name)) throw cliError(`unsupported Run command ${name}`, 'cli_command_unavailable');
    id(idempotencyKey, 'idempotency key');
    const command = name.replaceAll('.', '_');
    const runId = name === 'run.start' ? args.intent.runId ?? null : args.runId;
    const envelope = {
      schemaVersion: 1, commandId: randomUUID(), idempotencyKey, command, args,
      repoId: this.repoId, ...(runId ? { runId } : {}), origin: this.origin,
    };
    const body = await this._json('/v1/commands', {
      method: 'POST', headers: this._headers(true), body: JSON.stringify(envelope),
    });
    if (body.status !== 'admitted') return body.result ?? body;
    return this.reconcile(envelope.commandId);
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
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/v1/exports/${receipt.exportId}/archive`, {
        method: 'GET', cache: 'no-store', headers: {
          ...this._headers(), 'x-baton-export-ticket': issued.ticket,
        },
      });
    } catch { throw cliError('Baton export download failed', 'cli_transport_failed'); }
    if (!response.ok) throw cliError('Baton export download was refused', 'cli_export_download_failed');
    const expectedContentDigest = `sha-256=:${Buffer.from(descriptor.archiveDigest ?? '', 'hex').toString('base64')}:`;
    if (response.headers.get('content-type') !== descriptor.mediaType
      || response.headers.get('content-length') !== String(descriptor.archiveBytes)
      || response.headers.get('content-digest') !== expectedContentDigest
      || response.headers.get('cache-control') !== 'no-store') {
      throw cliError('Baton export response headers differ from the ticket', 'cli_protocol_failed');
    }
    let archiveBytes;
    try { archiveBytes = Buffer.from(await response.arrayBuffer()); }
    catch { throw cliError('Baton export response is unreadable', 'cli_transport_failed'); }
    const delivered = extractResultExportArchive({ archiveBytes, descriptor, destination });
    return Object.freeze({ ...delivered, runId });
  }
}

export async function runBatonCli(parsed, client, options = {}) {
  if (parsed.kind === 'help') return { help: BATON_CLI_HELP };
  if (parsed.kind === 'doctor') return client.doctor();
  if (parsed.kind === 'command') return client.command(parsed.name, parsed.args, parsed.idempotencyKey);
  if (parsed.kind === 'follow') {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'onFollowPage')
      || (options.onFollowPage !== undefined && typeof options.onFollowPage !== 'function')) {
      throw cliError('CLI follow options are invalid', 'cli_config_invalid');
    }
    let view = await client.command('run.status', { runId: parsed.runId }, `${parsed.idempotencyKey}:status`);
    if (TERMINAL_RUN_PHASES.has(view?.phase)) return view;
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
      if (view.follow.terminal || TERMINAL_RUN_PHASES.has(view.phase)) return view;
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
