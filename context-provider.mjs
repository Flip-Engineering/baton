// Resolve the selected package from the installed Baton prefix containing this file.
// The native coordinator supplies the frozen invocation over stdin. The module identity
// chooses one manifest-scoped package directory below this installation's lib tree.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

function refused(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function exactObjectShape(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function moduleDirectoryName(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return `m-${Buffer.from(value, 'utf8').toString('hex')}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactArtifactRows(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const normalize = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.every((row, index) => row === b[index]);
}

function packageBytesMatch(root, manifest) {
  if (!Array.isArray(manifest.files)) return false;
  const seen = new Set();
  for (const row of manifest.files) {
    if (row === null || typeof row !== 'object' || typeof row.path !== 'string'
        || row.path.startsWith('/') || row.path.split('/').some((part) => !part || part === '.' || part === '..')
        || !Number.isSafeInteger(row.bytes) || typeof row.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/.test(row.sha256) || seen.has(row.path)) return false;
    seen.add(row.path);
    const path = join(root, ...row.path.split('/'));
    if (realpathSync(path) !== path) return false;
    const bytes = readFileSync(path);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) return false;
  }
  return true;
}

function packageMatchesInvocation(root, manifest, invocation) {
  try {
    const binding = invocation.moduleBinding;
    const declarationBytes = readFileSync(join(root, 'native-provider.declaration.json'));
    const declaration = JSON.parse(declarationBytes.toString('utf8'));
    const sourceBytes = readFileSync(join(root, manifest.sourceManifest.path));
    const source = JSON.parse(sourceBytes.toString('utf8'));
    if (sourceBytes.length !== manifest.sourceManifest.bytes
        || sha256(sourceBytes) !== manifest.sourceManifest.sha256
        || !packageBytesMatch(root, manifest)
        || !Array.isArray(source.files) || source.files.length !== manifest.files.length) return false;
    const sourceFiles = new Map(source.files.map((row) => [row.path, row]));
    if (!manifest.files.every((row) => {
      const sourceRow = sourceFiles.get(row.path);
      return sourceRow !== undefined && sourceRow.bytes === row.bytes && sourceRow.sha256 === row.sha256;
    })) return false;
    if (!Array.isArray(declaration.artifactIdentities) || !declaration.artifactIdentities.every((artifact) => {
      if (artifact === null || typeof artifact !== 'object' || typeof artifact.packagePath !== 'string'
          || artifact.packagePath.startsWith('/')
          || artifact.packagePath.split('/').some((part) => !part || part === '.' || part === '..')
          || typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(artifact.sha256)) return false;
      const artifactPath = join(root, ...artifact.packagePath.split('/'));
      return realpathSync(artifactPath) === artifactPath && sha256(readFileSync(artifactPath)) === artifact.sha256;
    })) return false;
    return declaration.moduleId === binding.id && declaration.revision === binding.revision
      && declaration.protocolVersion === binding.protocolVersion
      && sha256(declarationBytes) === binding.declarationDigest
      && exactArtifactRows(declaration.artifactIdentities, binding.artifactIdentities)
      && JSON.stringify([...declaration.schemaIdentities].sort()) === JSON.stringify([...binding.schemaIdentities].sort());
  } catch {
    return false;
  }
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
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    if (manifest === null || typeof manifest !== 'object' || manifest.moduleId !== moduleId
        || manifest.schema !== 'baton2-selected-module-artifact-v1') return refused('selectedModuleManifestMismatch');
    return Object.freeze({ status: 'resolved', prefix, root, manifest });
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
        const binding = {
          id: moduleId,
          revision: declaration.revision,
          declarationDigest: sha256(declarationBytes),
          protocolVersion: declaration.protocolVersion,
          operation: '',
          artifactIdentities: declaration.artifactIdentities,
          schemaIdentities: declaration.schemaIdentities,
        };
        if (!packageMatchesInvocation(selected.root, selected.manifest, { moduleBinding: binding })) {
          refusals.push(Object.freeze({ moduleId, reason: 'selectedPackageIdentityMismatch' }));
          continue;
        }
        modules.push(Object.freeze({ moduleId, declarationDigest: binding.declarationDigest, declaration }));
      } catch (error) {
        refusals.push(Object.freeze({ moduleId, reason: 'selectedPackageUnavailable', detail: error.message }));
      }
    }
    return Object.freeze({ status: 'available', modules: Object.freeze(modules), refusals: Object.freeze(refusals) });
  } catch (error) {
    return refused('selectedModuleInventoryUnavailable', error.message);
  }
}

export async function runSelectedInvocation(invocation, { wrapperPath = fileURLToPath(import.meta.url) } = {}) {
  const nodeVersion = process.versions.node.split('.').map((part) => Number(part));
  if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 15)) {
    return refused('providerRuntimeTooOld', process.versions.node);
  }
  const moduleId = invocation?.moduleBinding?.id;
  const selected = resolveSelectedPackageRoot(wrapperPath, moduleId);
  if (selected.status !== 'resolved') return selected;
  if (!packageMatchesInvocation(selected.root, selected.manifest, invocation)) {
    return refused('selectedPackageDoesNotMatchFrozenBinding');
  }
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
    if (text.includes('\n')) return refused('invocationArtifactFramingInvalid');
    const invocation = JSON.parse(text);
    if (JSON.stringify(invocation) !== text) return refused('invocationArtifactCanonicalMismatch');
    const admitted = validateInvocation(invocation);
    if (admitted.status !== 'accepted') return admitted;
    const moduleId = invocation.moduleBinding.id;
    const selected = resolveSelectedPackageRoot(wrapperPath, moduleId);
    if (selected.status !== 'resolved') return selected;
    if (!packageMatchesInvocation(selected.root, selected.manifest, invocation)) {
      return refused('selectedPackageDoesNotMatchFrozenBinding');
    }
    return Object.freeze({ status: 'verified', query: invocation.query,
      owner: invocation.owner, moduleId, declarationDigest: invocation.moduleBinding.declarationDigest,
      artifactSha256: sha256(Buffer.from(text, 'utf8')), artifactBytes: Buffer.byteLength(text, 'utf8') });
  } catch (error) {
    return refused('invocationArtifactVerificationFailed', error.message);
  }
}

export function verifyInvocationArtifact(path, options = {}) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o222) !== 0
        || realpathSync(path) !== path) return refused('invocationArtifactFileInvalid');
    const bytes = readFileSync(path);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return refused('invocationArtifactFramingInvalid');
    return verifyInvocationText(text, options);
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
      if (!exactObjectShape(authority, ['owner', 'worktree', 'query', 'bootstrapText'])) {
        throw new Error('query bootstrap authority has an unsupported shape');
      }
      const result = persistQueryBootstrap(authority);
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.status !== 'persisted') process.exitCode = 2;
    } catch (error) {
      process.stdout.write(JSON.stringify(refused('queryBootstrapAuthorityMalformed', error.message)) + '\n');
      process.exitCode = 2;
    }
  } else if (process.argv[2] === '--persist-query-outcome') {
    const { persistQueryOutcome } = await import('./context-query-artifact.mjs');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const authority = JSON.parse(input);
      if (!exactObjectShape(authority, ['owner', 'worktree', 'query', 'bootstrapSha256', 'exitStatus', 'eventFrame'])) {
        throw new Error('query outcome authority has an unsupported shape');
      }
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
      const stat = lstatSync(artifactPath);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o222) !== 0
          || realpathSync(artifactPath) !== artifactPath) {
        throw new Error('invocation artifact must be a read-only regular file');
      }
      const bytes = readFileSync(artifactPath);
      const text = bytes.toString('utf8');
      if (Buffer.from(text, 'utf8').compare(bytes) !== 0 || text.includes('\n')) {
        throw new Error('invocation artifact framing is invalid');
      }
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
  } else if (process.argv[2] === '--verify-invocation') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const frame = input.endsWith('\n') ? input.slice(0, -1) : input;
    const result = verifyInvocationText(frame);
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
