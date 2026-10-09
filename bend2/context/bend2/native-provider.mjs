// Selected Bend2 sourceAnalysis provider. It reads the installed frontend files, applies the
// frontend hooks, and runs source analysis through retained source capture.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRetainedWorktreeCapture } from './worktree-capture.mjs';
import { createFrontendAdapter } from './frontend-adapter.mjs';
import { runFrontendInvocation } from './frontend-invocation.mjs';
import { applyHookOperations } from './frontend-hooks.mjs';

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND_FILES = Object.freeze({
  bend: 'bend.ts', main: 'main.ts', comp: 'comp.ts', base: 'base.bend',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runtimeIdentity() {
  const executable = realpathSync(process.execPath);
  return `${executable};node=${process.versions.node}`;
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
  if (![value.query, value.owner].every((field) => typeof field === 'string')
      || ![value.role, value.incarnation].every((field) => field === null || typeof field === 'string')) {
    return refusal('invocationIdentityKind');
  }
  if (!value.query || !value.owner) return refusal('invocationIdentityMissing');
  if (value.moduleBinding === null || typeof value.moduleBinding !== 'object' || Array.isArray(value.moduleBinding)) return refusal('moduleBindingKind');
  if (typeof value.moduleBinding.id !== 'string' || value.moduleBinding.id.length === 0) return refusal('moduleBindingModuleMissing');
  if (value.request === null || typeof value.request !== 'object' || Array.isArray(value.request)) return refusal('requestKind');
  if (!Array.isArray(value.inputIdentities) || !Array.isArray(value.operationPlan)) return refusal('invocationArrayKind');
  return Object.freeze({ status: 'accepted', invocation: value });
}

export function loadSelectedFrontendPackage({ packageRoot = PACKAGE_ROOT } = {}) {
  let root;
  try {
    root = realpathSync(packageRoot);
    if (!statSync(root).isDirectory()) return refusal('selectedPackageUnavailable', root);
  } catch (error) {
    return refusal('selectedPackageUnavailable', error.message);
  }
  const dir = mkdtempSync(join(tmpdir(), 'baton2-selected-bend2-'));
  try {
    const files = Object.fromEntries(Object.entries(FRONTEND_FILES).map(([kind, path]) => [
      kind, readFileSync(join(root, 'upstream', path)),
    ]));
    const bend = applyHookOperations({ target: 'bend', text: files.bend.toString('utf8') });
    const main = applyHookOperations({ target: 'main', text: files.main.toString('utf8') });
    if (bend.status !== 'applied' || main.status !== 'applied') {
      rmSync(dir, { recursive: true, force: true });
      return refusal('selectedFrontendDerivationFailed', { bend: bend.status, main: main.status });
    }
    const frontendFiles = Object.freeze({ bend: Buffer.from(bend.text), main: Buffer.from(main.text),
      comp: files.comp, base: files.base });
    for (const [kind, path] of Object.entries(FRONTEND_FILES)) {
      writeFileSync(join(dir, path), frontendFiles[kind], { flag: 'wx' });
    }
    return Object.freeze({ status: 'loaded', dir, frontendFiles,
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
    return refusal('selectedFrontendUnavailable', error.message);
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
    moduleBinding: invocation.moduleBinding, runtime: runtimeIdentity(), role: invocation.role,
    incarnation: invocation.incarnation, sequence: '1', type: 'event', payload });
}

export async function invokeSourceAnalysis(invocation, { cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = {}) {
  const admitted = validateInvocation(invocation);
  if (admitted.status !== 'accepted') return admitted;
  const frame = admitted.invocation;
  const step = frame.operationPlan.find((row) => row !== null && typeof row === 'object'
    && row.common === 'sourceAnalysis');
  if (step === undefined) return refusal('sourceAnalysisOperationUnavailable');
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
  const packageRows = [{ id: 'selected-bend2-frontend-runtime', path: selected.dir,
    artifacts: Object.entries(FRONTEND_FILES).map(([kind, path]) => ({
      path, sha256: sha256(selected.frontendFiles[kind]),
    })) }];
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
