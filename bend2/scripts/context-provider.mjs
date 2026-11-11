// Resolve the selected package from the installed Baton prefix containing this file.
// The native coordinator supplies the invocation over stdin. Its module identity
// chooses one package directory below this installation's lib tree.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

function refused(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function moduleDirectoryName(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return `m-${Buffer.from(value, 'utf8').toString('hex')}`;
}

export function resolveSelectedPackageRoot(wrapperPath, moduleId) {
  const directoryName = moduleDirectoryName(moduleId);
  if (directoryName === null) return refused('selectedModuleIdInvalid');
  try {
    const wrapper = realpathSync(wrapperPath);
    if (!statSync(wrapper).isFile()) return refused('providerWrapperUnavailable');
    const prefix = realpathSync(join(dirname(wrapper), '..', '..'));
    const modulesRoot = join(prefix, 'lib', 'context', 'modules');
    const candidate = join(modulesRoot, directoryName);
    const root = realpathSync(candidate);
    const rel = relative(modulesRoot, root);
    if (rel !== directoryName || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return refused('selectedModuleOutsideInstallation');
    if (!statSync(root).isDirectory()) return refused('selectedModulePackageUnavailable');
    return Object.freeze({ status: 'resolved', prefix, root, moduleId });
  } catch (error) {
    return refused('selectedModulePackageUnavailable', error.message);
  }
}

function moduleIdFromDirectory(name) {
  if (!/^m-(?:[0-9a-f]{2})+$/.test(name)) return null;
  const id = Buffer.from(name.slice(2), 'hex').toString('utf8');
  return moduleDirectoryName(id) === name ? id : null;
}

function moduleTools(declaration) {
  return (declaration.operations ?? []).map((operation) => ({
    operation: operation.operation ?? operation.id ?? null,
    implements: operation.implements ?? null,
    description: operation.description ?? null,
    optionsSchema: operation.optionsJsonSchema ?? null,
    requestExample: operation.requestExample ?? null,
    projections: operation.projections ?? [],
    effects: operation.effects ?? [],
  }));
}

export function installedModuleInventory({ wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  try {
    const wrapper = realpathSync(wrapperPath);
    const prefix = realpathSync(join(dirname(wrapper), '..', '..'));
    const modulesRoot = join(prefix, 'lib', 'context', 'modules');
    try {
      if (realpathSync(modulesRoot) !== modulesRoot) return refused('selectedModuleInventoryOutsideInstallation');
    } catch (error) {
      if (error.code === 'ENOENT') return Object.freeze({ status: 'available', modules: Object.freeze([]), refusals: Object.freeze([]) });
      throw error;
    }
    const modules = [];
    const refusals = [];
    let entries;
    try {
      entries = readdirSync(modulesRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return Object.freeze({ status: 'available', modules: Object.freeze([]), refusals: Object.freeze([]) });
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.name.startsWith('m-')) continue;
      const moduleId = moduleIdFromDirectory(entry.name);
      if (moduleId === null) {
        refusals.push(Object.freeze({ directory: entry.name, reason: 'selectedModuleDirectoryNameInvalid' }));
        continue;
      }
      if (!entry.isDirectory()) {
        refusals.push(Object.freeze({ moduleId, reason: 'selectedModuleEntryNotDirectory' }));
        continue;
      }
      const selected = resolveSelectedPackageRoot(wrapper, moduleId);
      if (selected.status !== 'resolved') {
        refusals.push(Object.freeze({ moduleId, reason: selected.reason }));
        continue;
      }
      try {
        const declarationBytes = readFileSync(join(selected.root, 'native-provider.declaration.json'));
        const declaration = JSON.parse(declarationBytes.toString('utf8'));
        modules.push(Object.freeze({ moduleId, declarationDigest: sha256(declarationBytes), declaration,
          tools: moduleTools(declaration) }));
      } catch (error) {
        refusals.push(Object.freeze({ moduleId, reason: 'selectedDeclarationUnavailable', detail: error.message }));
      }
    }
    return Object.freeze({ status: 'available', modules: Object.freeze(modules), refusals: Object.freeze(refusals) });
  } catch (error) {
    return refused('selectedModuleInventoryUnavailable', error.message);
  }
}

export async function sessionModuleInventory({ owner, worktree, wrapperPath } = {}) {
  const inventory = installedModuleInventory({ wrapperPath });
  if (inventory.status !== 'available') return inventory;
  const { decodePolicy } = await import('./context-project-policy.mjs');
  const path = join(worktree, '.baton', 'context.json');
  let projectPolicy;
  try {
    const policy = decodePolicy(readFileSync(path, 'utf8'));
    projectPolicy = policy.status === 'decoded'
      ? { status: 'present', path, disabled: policy.disabled, preferred: policy.preferred }
      : { status: 'malformed', path, reason: policy.reason, detail: policy.detail };
  } catch (error) {
    projectPolicy = error.code === 'ENOENT'
      ? { status: 'absent', path, disabled: [], preferred: [] }
      : { status: 'unavailable', path, reason: error.code, detail: error.message };
  }
  const known = projectPolicy.status === 'present' || projectPolicy.status === 'absent';
  return { ...inventory, scope: { session: owner, workspace: worktree }, projectPolicy,
    modules: inventory.modules.map((module) => ({ ...module,
      enabled: known ? !projectPolicy.disabled.includes(module.moduleId) : null,
      preferred: known ? projectPolicy.preferred.includes(module.moduleId) : null,
    })) };
}

export function installContextModule({ moduleId, source,
  wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  let staging;
  try {
    const directory = moduleDirectoryName(moduleId);
    const supplied = resolve(source);
    const moduleSource = realpathSync(existsSync(join(supplied, 'native-provider.declaration.json'))
      ? supplied : join(supplied, 'lib', 'context', 'modules', directory));
    const declaration = JSON.parse(readFileSync(join(moduleSource, 'native-provider.declaration.json'), 'utf8'));
    if (declaration.moduleId !== moduleId) {
      return refused('moduleIdentityMismatch', { requested: moduleId, supplied: declaration.moduleId });
    }
    const wrapper = realpathSync(wrapperPath);
    const modulesRoot = join(dirname(wrapper), '..', '..', 'lib', 'context', 'modules');
    const destination = resolve(modulesRoot, directory);
    mkdirSync(modulesRoot, { recursive: true });
    if (existsSync(destination)) {
      if (!statSync(destination).isDirectory()) {
        throw Object.assign(new Error('Module destination is not a directory'), { code: 'ENOTDIR' });
      }
      return { status: 'present', moduleId, path: destination, source: moduleSource };
    }
    staging = mkdtempSync(join(modulesRoot, '.install-'));
    const copied = join(staging, directory);
    cpSync(moduleSource, copied, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    try {
      renameSync(copied, destination);
    } catch (error) {
      if ((error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
          && statSync(destination).isDirectory()) {
        return { status: 'present', moduleId, path: destination, source: moduleSource };
      }
      throw error;
    }
    return { status: 'installed', moduleId, path: destination, source: moduleSource };
  } catch (error) {
    return refused('moduleInstallFailed', { code: error.code ?? null, message: error.message });
  } finally {
    if (staging !== undefined) rmSync(staging, { recursive: true, force: true });
  }
}

export async function runSelectedInvocation(invocation, { wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  const moduleId = invocation?.moduleBinding?.id;
  const selected = resolveSelectedPackageRoot(wrapperPath, moduleId);
  if (selected.status !== 'resolved') return selected;
  const providerPath = join(selected.root, 'native-provider.mjs');
  try {
    const declaration = JSON.parse(readFileSync(join(selected.root, 'native-provider.declaration.json'), 'utf8'));
    const provider = await import(pathToFileURL(realpathSync(providerPath)).href);
    return await provider.executeInvocation(invocation, {
      packageRoot: selected.root,
      cwd: invocation.request.cwd,
      declaration,
    });
  } catch (error) {
    return refused('selectedProviderUnavailable', error.message);
  }
}

export async function runSelectedRuntimeAdapterFile(path, { wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  const setup = JSON.parse(readFileSync(path, 'utf8'));
  const selected = resolveSelectedPackageRoot(wrapperPath, setup.invocation?.moduleBinding?.id);
  if (selected.status !== 'resolved') throw new Error(selected.reason);
  const provider = await import(pathToFileURL(realpathSync(join(selected.root, 'native-provider.mjs'))).href);
  await provider.runRuntimeAdapter({ setup });
}

// Selected producers with capture support contribute their own records.
// Acquisition failures propagate; providers without this capability contribute none.
export async function captureSelectedInputs(invocation, { wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  if (!Array.isArray(invocation?.operationPlan) || invocation.operationPlan.length === 0) return refused('capturePlanMissing');
  const captures = [];
  try {
    for (const step of invocation.operationPlan) {
      const binding = step?.binding;
      const selected = resolveSelectedPackageRoot(wrapperPath, binding?.id);
      if (selected.status !== 'resolved') return selected;
      const provider = await import(pathToFileURL(realpathSync(join(selected.root, 'native-provider.mjs'))).href);
      if (typeof provider.captureInputs !== 'function') continue;
      const declaration = JSON.parse(readFileSync(join(selected.root, 'native-provider.declaration.json'), 'utf8'));
      const answer = await provider.captureInputs({ ...invocation, moduleBinding: binding }, {
        packageRoot: selected.root, cwd: invocation.request.cwd,
        declaration,
      });
      if (answer?.status !== 'captured') return answer ?? refused('captureSupplierAnswerMissing', binding.id);
      if (answer.query !== invocation.query || answer.owner !== invocation.owner || !Array.isArray(answer.captures)) return refused('captureSupplierIdentityMismatch', binding.id);
      for (const capture of answer.captures) {
        if (capture.producerModule !== binding.id || capture.producerDigest !== binding.declarationDigest
            || capture.producerOperation !== binding.operation) return refused('captureProducerMismatch', capture.path);
        captures.push(capture);
      }
    }
    return Object.freeze({ status: 'captured', query: invocation.query, owner: invocation.owner,
      captures: Object.freeze(captures) });
  } catch (error) {
    return refused('captureSupplierFailed', error.message);
  }
}

export function verifyInvocationText(text, { wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  try {
    const invocation = JSON.parse(text);
    const moduleId = invocation?.moduleBinding?.id;
    const selected = resolveSelectedPackageRoot(wrapperPath, moduleId);
    if (selected.status !== 'resolved') return selected;
    realpathSync(join(selected.root, 'native-provider.mjs'));
    return Object.freeze({ status: 'verified', query: invocation.query,
      owner: invocation.owner, moduleId,
      declarationDigest: invocation.moduleBinding.declarationDigest ?? '',
      artifactSha256: sha256(Buffer.from(text, 'utf8')) });
  } catch (error) {
    return refused('invocationArtifactVerificationFailed', error.message);
  }
}

export function verifyInvocationArtifact(path, options = {}) {
  try {
    const bytes = readFileSync(path);
    return verifyInvocationText(bytes.toString('utf8'), options);
  } catch (error) {
    return refused('invocationArtifactVerificationFailed', error.message);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--runtime-adapter-file') {
    await runSelectedRuntimeAdapterFile(process.argv[3]);
  } else if (process.argv[2] === '--inventory') {
    let result;
    if (process.argv[3] === '--session') {
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      try {
        result = await sessionModuleInventory(JSON.parse(input));
      } catch (error) {
        result = refused('sessionInventoryUnavailable', error.message);
      }
    } else {
      result = installedModuleInventory();
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'refused') process.exitCode = 2;
  } else if (process.argv[2] === '--install-module') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    let result;
    try {
      result = installContextModule(JSON.parse(input));
    } catch (error) {
      result = refused('moduleInstallFailed', { code: error.code ?? null, message: error.message });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'refused') process.exitCode = 2;
  } else if (process.argv[2] === '--capture-inputs') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const result = await captureSelectedInputs(JSON.parse(input));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status !== 'captured') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refused('captureRequestMalformed', error.message))}\n`);
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--project-policy') {
    const { observeProjectPolicy } = await import('./context-project-policy.mjs');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const authority = JSON.parse(input);
      const result = observeProjectPolicy({ owner: authority.owner, worktree: authority.worktree });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status === 'refused') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refused('projectPolicyAuthorityMalformed', error.message))}\n`);
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--prepare-query-artifact') {
    const { prepareQueryArtifact } = await import('./context-query-artifact.mjs');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const authority = JSON.parse(input);
      const result = prepareQueryArtifact({ owner: authority.owner, worktree: authority.worktree, query: authority.query });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status !== 'prepared') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refused('queryArtifactAuthorityMalformed', error.message))}\n`);
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--examine-query-source') {
    const { examineQuerySource } = await import('./context-query-artifact.mjs');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const authority = JSON.parse(input);
      const result = examineQuerySource({ owner: authority.owner, worktree: authority.worktree,
        cwd: authority.cwd, path: authority.path });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status !== 'examined') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refused('querySourceAuthorityMalformed', error.message))}\n`);
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--persist-query-bootstrap') {
    const { persistQueryBootstrap } = await import('./context-query-artifact.mjs');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const authority = JSON.parse(input);
      const result = persistQueryBootstrap(authority);
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.status !== 'persisted') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(JSON.stringify(refused('queryBootstrapAuthorityMalformed', error.message)) + '\n');
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--read-query-bootstrap') {
    const { readQueryBootstrap } = await import('./context-query-artifact.mjs');
    try {
      if (process.argv.length !== 8) throw new Error('database, owner, worktree, query and path are required');
      const result = readQueryBootstrap({ database: process.argv[3], owner: process.argv[4],
        worktree: process.argv[5], query: process.argv[6], bootstrapPath: process.argv[7] });
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.status !== 'loaded') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(JSON.stringify(refused('queryBootstrapReadAuthorityMalformed', error.message)) + '\n');
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--persist-query-outcome') {
    const { persistQueryOutcome } = await import('./context-query-artifact.mjs');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const authority = JSON.parse(input);
      const result = persistQueryOutcome(authority);
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.status !== 'persisted') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(JSON.stringify(refused('queryOutcomeAuthorityMalformed', error.message)) + '\n');
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--invoke-file') {
    try {
      if (process.argv.length !== 4) throw new Error('invocation artifact path is required');
      const artifactPath = process.argv[3];
      const bytes = readFileSync(artifactPath);
      const text = bytes.toString('utf8');
      const result = await runSelectedInvocation(JSON.parse(text));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status === 'refused') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refused('invocationArtifactExecutionFailed', error.message))}\n`);
      process.exitCode = 3;
    }
  } else if (process.argv[2] === '--verify-invocation-file') {
    const result = process.argv.length === 4
      ? verifyInvocationArtifact(process.argv[3])
      : refused('invocationArtifactPathMissing');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'verified') process.exitCode = 2;
  } else {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const result = await runSelectedInvocation(JSON.parse(input));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status === 'refused') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refused('invocationExecutionFailed', error.message))}\n`);
      process.exitCode = 3;
    }
  }
}
