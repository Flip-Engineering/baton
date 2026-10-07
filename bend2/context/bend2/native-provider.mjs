// Selected Bend2 sourceAnalysis provider. It validates the frozen native invocation, admits only
// the packaged frontend artifacts named by its declaration, and runs the pinned frontend through
// its retained hook and source-reader boundary.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRetainedWorktreeCapture } from './worktree-capture.mjs';
import { createFrontendAdapter } from './frontend-adapter.mjs';
import { runFrontendInvocation } from './frontend-invocation.mjs';
import { deriveHookedSource, UPSTREAM_INPUTS, UPSTREAM_PIN } from './frontend-hooks.mjs';

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = join(PACKAGE_ROOT, 'native-provider.declaration.json');
const PACKAGE_MANIFEST_PATH = join(PACKAGE_ROOT, 'manifest.json');
const SOURCE_MANIFEST_PATH = join(PACKAGE_ROOT, 'selected-module.source.json');
const FRONTEND_FILES = Object.freeze({
  bend: 'bend.ts', main: 'main.ts', comp: 'comp.ts', base: 'base.bend',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function refusal(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

const INVOCATION_KEYS = Object.freeze([
  'version', 'query', 'owner', 'moduleBinding', 'request',
  'inputIdentities', 'operationPlan', 'role', 'incarnation',
]);

export function validateInvocation(value) {
  if (!exactKeys(value, INVOCATION_KEYS)) return refusal('invocationShape');
  if (value.version !== 2) return refusal('invocationVersion');
  if (![value.query, value.owner, value.role, value.incarnation].every((field) => typeof field === 'string')) {
    return refusal('invocationIdentityKind');
  }
  if (!value.query || !value.owner) return refusal('invocationIdentityMissing');
  if (value.moduleBinding === null || typeof value.moduleBinding !== 'object' || Array.isArray(value.moduleBinding)) return refusal('moduleBindingKind');
  if (!['id', 'revision', 'declarationDigest', 'protocolVersion', 'operation', 'artifactIdentities', 'schemaIdentities']
      .every((key) => Object.hasOwn(value.moduleBinding, key))
      || !Array.isArray(value.moduleBinding.artifactIdentities) || !Array.isArray(value.moduleBinding.schemaIdentities)) {
    return refusal('moduleBindingShape');
  }
  if (value.request === null || typeof value.request !== 'object' || Array.isArray(value.request)) return refusal('requestKind');
  if (!Array.isArray(value.inputIdentities) || !Array.isArray(value.operationPlan)) return refusal('invocationArrayKind');
  return Object.freeze({ status: 'accepted', invocation: value });
}

function readJson(path, reason) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return refusal(reason, error.message);
  }
}

function verifyManifestFiles(root, manifest) {
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.files)) return refusal('packageManifestMalformed');
  const listed = new Map();
  for (const row of manifest.files) {
    if (row === null || typeof row !== 'object' || typeof row.path !== 'string'
        || !Number.isSafeInteger(row.bytes) || typeof row.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/.test(row.sha256) || isAbsolute(row.path)
        || row.path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      return refusal('packageManifestEntryMalformed');
    }
    if (listed.has(row.path)) return refusal('packageManifestDuplicatePath', row.path);
    const packagePath = row.path;
    let bytes;
    try {
      bytes = readFileSync(join(root, ...packagePath.split('/')));
    } catch (error) {
      return refusal('packageArtifactUnavailable', `${row.path}: ${error.message}`);
    }
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) return refusal('packageArtifactDigestMismatch', row.path);
    listed.set(packagePath, row.sha256);
  }
  return Object.freeze({ status: 'verified', listed });
}

function equalArtifactRows(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const normalize = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.every((entry, index) => entry === b[index]);
}

export function loadSelectedFrontendPackage({ packageRoot = PACKAGE_ROOT } = {}) {
  const root = realpathSync(packageRoot);
  const declaration = readJson(join(root, 'native-provider.declaration.json'), 'providerDeclarationUnavailable');
  const manifest = readJson(join(root, 'manifest.json'), 'packageManifestUnavailable');
  const sourceManifest = readJson(join(root, 'selected-module.source.json'), 'sourceManifestUnavailable');
  for (const item of [declaration, manifest, sourceManifest]) {
    if (item === null || typeof item !== 'object' || item.status === 'refused') return item;
  }
  if (declaration.schema !== 'baton2-native-module-declaration-v1'
      || declaration.moduleId !== sourceManifest.moduleId || declaration.moduleId !== manifest.moduleId
      || declaration.protocolVersion !== '2' || sourceManifest.protocolVersion !== '2'
      || manifest.protocolVersion !== '2') return refusal('selectedModuleMetadataMismatch');
  if (sourceManifest.schema !== 'baton2-selected-context-payload-v1'
      || !Array.isArray(sourceManifest.files)) return refusal('sourceManifestMalformed');
  if (manifest.sourceManifest === null || typeof manifest.sourceManifest !== 'object'
      || manifest.sourceManifest.path !== 'selected-module.source.json') return refusal('sourceManifestAssociationMissing');
  try {
    const sourceManifestBytes = readFileSync(join(root, manifest.sourceManifest.path));
    if (sourceManifestBytes.length !== manifest.sourceManifest.bytes
        || sha256(sourceManifestBytes) !== manifest.sourceManifest.sha256) return refusal('sourceManifestDigestMismatch');
  } catch (error) {
    return refusal('sourceManifestUnavailable', error.message);
  }
  const verified = verifyManifestFiles(root, manifest);
  if (verified.status !== 'verified') return verified;
  if (manifest.files.length !== sourceManifest.files.length) return refusal('packageSourceInventoryMismatch');
  const sourceRows = new Map(sourceManifest.files.map((row) => [row.path, row]));
  for (const row of manifest.files) {
    const sourceRow = sourceRows.get(row.path);
    if (sourceRow === undefined || sourceRow.bytes !== row.bytes || sourceRow.sha256 !== row.sha256) {
      return refusal('packageSourceInventoryMismatch', row.path);
    }
  }
  for (const artifact of declaration.artifactIdentities ?? []) {
    if (artifact === null || typeof artifact !== 'object'
        || verified.listed.get(artifact.packagePath) !== artifact.sha256) {
      return refusal('providerArtifactIdentityMismatch', artifact?.packagePath ?? null);
    }
  }
  const sourceFiles = new Map(sourceManifest.files.map((row) => [row.path, row]));
  for (const [kind, path] of Object.entries(FRONTEND_FILES)) {
    const relativePath = `upstream/${path}`;
    const row = sourceFiles.get(relativePath);
    const pin = kind === 'base' ? { sha256: UPSTREAM_INPUTS.base.sha256 }
      : UPSTREAM_INPUTS[kind];
    if (row === undefined || row.sha256 !== pin.sha256 || verified.listed.get(relativePath) !== pin.sha256) {
      return refusal('selectedFrontendIdentityMismatch', relativePath);
    }
  }
  if (sourceManifest.upstreamPin !== UPSTREAM_PIN) return refusal('selectedFrontendPinMismatch');
  const binding = declaration.artifactIdentities;
  const packaged = sourceManifest.providerArtifacts;
  if (!equalArtifactRows(binding, packaged)) return refusal('providerArtifactMetadataMismatch');
  const dir = mkdtempSync(join(tmpdir(), 'baton2-selected-bend2-'));
  try {
    const readPinned = (kind) => readFileSync(join(root, 'upstream', FRONTEND_FILES[kind]));
    const bendBytes = readPinned('bend');
    const mainBytes = readPinned('main');
    const bend = deriveHookedSource({ target: 'bend', text: bendBytes.toString('utf8') });
    const main = deriveHookedSource({ target: 'main', text: mainBytes.toString('utf8') });
    if (bend.status !== 'derived' || main.status !== 'derived') return refusal('selectedFrontendDerivationRefused', { bend: bend.status, main: main.status });
    writeFileSync(join(dir, 'bend.ts'), bend.text, { flag: 'wx' });
    writeFileSync(join(dir, 'main.ts'), main.text, { flag: 'wx' });
    writeFileSync(join(dir, 'comp.ts'), readPinned('comp'), { flag: 'wx' });
    writeFileSync(join(dir, 'base.bend'), readPinned('base'), { flag: 'wx' });
    return Object.freeze({ status: 'loaded', root, manifest, declaration, sourceManifest, dir,
      files: Object.freeze({ bend: bendBytes, main: mainBytes, comp: readPinned('comp'), base: readPinned('base') }),
      async load() {
        try {
          const frontend = await import(pathToFileURL(join(dir, 'bend.ts')).href);
          const comp = await import(pathToFileURL(join(dir, 'comp.ts')).href);
          return Object.freeze({ status: 'loaded', frontend, comp, basePath: join(dir, 'base.bend') });
        } catch (error) {
          return refusal('selectedFrontendLoadFailed', error.message);
        }
      },
      close() { rmSync(dir, { recursive: true, force: true }); },
    });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    return refusal('selectedFrontendMaterializationFailed', error.message);
  }
}

function sourcePathOf(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return refusal('requestMalformed');
  const subject = request.subject;
  if (subject === null || typeof subject !== 'object' || Array.isArray(subject)
      || typeof subject.path !== 'string' || subject.path.length === 0) return refusal('sourcePathMissing');
  if (typeof request.cwd !== 'string' || request.cwd.length === 0) return refusal('requestCwdMissing');
  return Object.freeze({ status: 'accepted', cwd: request.cwd, path: subject.path });
}

function lazyAcquisition({ reader, owner, basePath }) {
  const queryReader = reader.forOwner(owner);
  function resolve(name) {
    const answer = queryReader.resolve(name);
    if (answer.status !== 'resolved') return undefined;
    return Object.freeze({ exists: answer.exists, identity: answer.identity });
  }
  function read(name) {
    const answer = queryReader.read(name);
    if (answer.status !== 'captured') return Object.freeze({ refuse: answer.reason ?? answer.status });
    return Object.freeze({ bytes: answer.bytes });
  }
  return Object.freeze({ resolve, read, baseBend: () => basePath });
}

function eventFrame(invocation, payload) {
  return Object.freeze({ version: 2, query: invocation.query, owner: invocation.owner,
    moduleBinding: invocation.moduleBinding, runtime: null, role: invocation.role,
    incarnation: invocation.incarnation, sequence: '1', type: 'event', payload });
}

export async function invokeSourceAnalysis(invocation, { cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = {}) {
  const admitted = validateInvocation(invocation);
  if (admitted.status !== 'accepted') return admitted;
  const frame = admitted.invocation;
  const normalize = (value) => Array.isArray(value) ? value.map(normalize)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])])) : value;
  const bindingIdentity = JSON.stringify(normalize(frame.moduleBinding));
  const step = frame.operationPlan.find((row) => row !== null && typeof row === 'object'
    && row.common === 'sourceAnalysis' && row.binding !== undefined
    && JSON.stringify(normalize(row.binding)) === bindingIdentity);
  if (step === undefined) return refusal('selectedPlanBindingMismatch');
  const source = sourcePathOf(frame.request);
  if (source.status !== 'accepted') return source;
  let actualCwd;
  let requestedCwd;
  try {
    actualCwd = realpathSync(cwd);
    requestedCwd = realpathSync(source.cwd);
  } catch (error) {
    return refusal('requestCwdUnavailable', error.message);
  }
  if (actualCwd !== requestedCwd) return refusal('requestCwdMismatch', { requested: requestedCwd, actual: actualCwd });
  const selected = loadSelectedFrontendPackage({ packageRoot });
  if (selected.status !== 'loaded') return selected;
  const binding = frame.moduleBinding;
  if (binding.id !== selected.declaration.moduleId || binding.revision !== selected.declaration.revision
      || binding.protocolVersion !== selected.declaration.protocolVersion || binding.operation !== 'sourceAnalysis'
      || !equalArtifactRows(binding.artifactIdentities, selected.declaration.artifactIdentities)
      || JSON.stringify([...binding.schemaIdentities].sort()) !== JSON.stringify([...selected.declaration.schemaIdentities].sort())) {
    selected.close();
    return refusal('moduleBindingDoesNotNameSelectedPayload');
  }
  const frontendLoaded = await selected.load();
  if (frontendLoaded.status !== 'loaded') {
    selected.close();
    return frontendLoaded;
  }
  let worktree;
  try {
    const { execFileSync } = await import('node:child_process');
    worktree = realpathSync(execFileSync('git', ['-C', actualCwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  } catch (error) {
    selected.close();
    return refusal('requestWorktreeUnavailable', error.message);
  }
  const packageRows = [
    { id: 'selected-bend2-provider', path: selected.root,
      artifacts: selected.sourceManifest.files.map((row) => ({ path: row.path, sha256: row.sha256 })) },
    { id: 'selected-bend2-frontend-runtime', path: selected.dir,
      artifacts: [{ path: 'base.bend', sha256: sha256(frontendLoaded.status === 'loaded' ? selected.files.base : new Uint8Array()) }] },
  ];
  const retained = createRetainedWorktreeCapture({ owner: frame.owner, worktree, packages: packageRows });
  if (retained.status !== 'ready') {
    selected.close();
    return retained;
  }
  const requestPath = isAbsolute(source.path) ? source.path : resolve(actualCwd, source.path);
  const queryReader = retained.capture.forOwner(frame.owner);
  const pathAnswer = queryReader.resolve(requestPath);
  if (pathAnswer.status !== 'resolved' || pathAnswer.exists !== true) {
    selected.close();
    retained.capture.seal(frame.owner);
    return refusal('sourceTargetUnavailable', { status: pathAnswer.status, reason: pathAnswer.reason ?? null });
  }
  const acquisition = lazyAcquisition({ reader: retained.capture, owner: frame.owner, basePath: frontendLoaded.basePath });
  const adapter = createFrontendAdapter({ acquisition, captureOnly: true });
  const phases = ['parse', 'check'];
  try {
    const result = await runFrontendInvocation({ frontend: frontendLoaded.frontend, comp: frontendLoaded.comp,
      adapter, root: pathAnswer.identity, phases, seen: new Map(), owner: frame.owner });
    const sealed = retained.capture.seal(frame.owner);
    const payload = Object.freeze({ schema: 'baton2.context.bend2.source-analysis.result.v1',
      status: result.status, phasesRun: result.phasesRun ?? [], outcome: result.outcome ?? null,
      session: result.session ?? null, retainedReadSet: sealed.status === 'sealed'
        ? Object.freeze({ status: 'sealed', fileCount: sealed.fileCount, descriptors: sealed.descriptors }) : sealed });
    return eventFrame(frame, payload);
  } catch (error) {
    retained.capture.seal(frame.owner);
    return eventFrame(frame, Object.freeze({ schema: 'baton2.context.bend2.source-analysis.result.v1',
      status: 'unavailable', reason: 'frontendInvocationFailed', detail: error.message }));
  } finally {
    selected.close();
  }
}

export async function executeInvocation(value, options = {}) {
  const outcome = await invokeSourceAnalysis(value, options);
  if (outcome.status === 'refused') return outcome;
  return outcome;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const result = await executeInvocation(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(refusal('invocationExecutionFailed', error.message))}\n`);
    process.exitCode = 3;
  }
}
