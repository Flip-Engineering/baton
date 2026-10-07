// Resolve the selected package from the installed Baton prefix containing this file.
// The native coordinator supplies the frozen invocation over stdin. The module identity
// chooses one manifest-scoped package directory below this installation's lib tree.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

function refused(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
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
    const modules = [];
    const refusals = [];
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const moduleId = moduleIdFromDirectory(entry.name);
      if (moduleId === null) {
        refusals.push(Object.freeze({ directory: entry.name, reason: 'selectedModuleDirectoryNameInvalid' }));
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--inventory') {
    const result = installedModuleInventory();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'refused') process.exitCode = 2;
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
