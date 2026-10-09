// Resolve the selected package from the installed Baton prefix containing this file.
// The native coordinator supplies the invocation over stdin. Its module identity
// chooses one package directory below this installation's lib tree.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
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
        modules.push(Object.freeze({ moduleId, declarationDigest: sha256(declarationBytes), declaration }));
      } catch (error) {
        refusals.push(Object.freeze({ moduleId, reason: 'selectedDeclarationUnavailable', detail: error.message }));
      }
    }
    return Object.freeze({ status: 'available', modules: Object.freeze(modules), refusals: Object.freeze(refusals) });
  } catch (error) {
    return refused('selectedModuleInventoryUnavailable', error.message);
  }
}

export async function runSelectedInvocation(invocation, { wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  const moduleId = invocation?.moduleBinding?.id;
  const selected = resolveSelectedPackageRoot(wrapperPath, moduleId);
  if (selected.status !== 'resolved') return selected;
  const providerPath = join(selected.root, 'native-provider.mjs');
  try {
    const provider = await import(pathToFileURL(realpathSync(providerPath)).href);
    return await provider.executeInvocation(invocation, {
      packageRoot: selected.root,
      cwd: invocation.request.cwd,
    });
  } catch (error) {
    return refused('selectedProviderUnavailable', error.message);
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
  if (process.argv[2] === '--inventory') {
    const result = installedModuleInventory();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'refused') process.exitCode = 2;
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
