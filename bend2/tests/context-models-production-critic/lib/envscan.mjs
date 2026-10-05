// Reference structural environment allowlist over real target files.
//
// Automatic value fields are structurally restricted (spec, "Environment and
// general projections"): validated package version strings; recognized
// compiler option enums/booleans/numbers and explicit path fields; resolved
// executable paths and validated version tokens; file presence and key
// names. Free-form strings never become automatic values. This module
// implements the reference behavior the fixture asserts and mutates.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const VERSION = /^(?:\^|~|>=?)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Declared dependencies: name plus validated version string only. Other
// manifest fields contribute no automatic value.
export function declaredDependencies(manifestPath) {
  const manifest = readJson(manifestPath);
  const declared = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, requirement] of Object.entries(manifest[section] ?? {})) {
      if (typeof requirement === 'string' && VERSION.test(requirement)) {
        declared.push({ name, requirement, origin: manifestPath, classification: 'declared' });
      }
    }
  }
  return { declared, excluded: freeFormManifestFields(manifest) };
}

function freeFormManifestFields(manifest) {
  const excluded = [];
  for (const key of ['description', 'homepage', 'scripts']) {
    if (manifest[key] !== undefined) excluded.push({ field: key, reason: 'free-form manifest text stays outside automatic values' });
  }
  for (const [key, value] of Object.entries(manifest.urls ?? {})) excluded.push({ field: `urls.${key}`, reason: 'URLs have no automatic value field' });
  return excluded;
}

// Installed resolution: version read from the resolved package manifest on
// disk, separately attributed from the declaration. Disagreements are named.
export function installedResolution({ manifestPath, readRoots, packageName }) {
  const manifest = readJson(manifestPath);
  const requirement = manifest.dependencies?.[packageName];
  for (const root of readRoots) {
    const packageManifest = join(resolve(root), 'node_modules', packageName, 'package.json');
    if (existsSync(packageManifest)) {
      const installed = readJson(packageManifest);
      return {
        name: packageName,
        requirement: typeof requirement === 'string' ? requirement : null,
        installedVersion: installed.version,
        installedPath: packageManifest,
        classification: 'observed',
        agreement: typeof requirement === 'string' && installed.version === requirement.replace(/^[\^~>=]+/, ''),
      };
    }
  }
  return { name: packageName, requirement: requirement ?? null, installedVersion: null, disagreement: 'declared but not resolved under admitted read roots' };
}

// Dotenv: path and key presence only. Values never enter the output.
export function dotenvFacts(path, bytes) {
  const keys = [];
  for (const line of bytes.toString('utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match !== null) keys.push(match[1]);
  }
  return { path, present: existsSync(path), keys };
}

// Compose service topology: structural fields only. Command strings,
// credential-bearing image/endpoint strings and env values are excluded.
export function composeTopology(document) {
  const services = [];
  for (const [name, service] of Object.entries(document.services ?? {})) {
    services.push({
      id: name,
      dependsOn: Object.entries(service.depends_on ?? {}).map(([id, condition]) => ({ id, condition: condition?.condition ?? null })),
      ports: (service.ports ?? []).map(port => (typeof port === 'string' ? port : `${port.published ?? ''}:${port.target}`)),
      networks: Object.keys(service.networks ?? {}),
      volumes: (service.volumes ?? []).map(volume => {
        if (typeof volume !== 'string') return volume.target;
        const parts = volume.split(':');
        // Short syntax "host:container[:mode]": the container path is the target.
        return parts.length >= 2 ? parts[1] : parts[0];
      }),
      secretKeys: Object.keys(service.secrets ?? {}),
      configKeys: Object.keys(service.configs ?? {}),
    });
  }
  return { services, excluded: ['command', 'image', 'environment', 'env_file values'] };
}

// Tool override admission: any request-local tools override requires the
// executeTarget grant, including an override naming the deployment path.
export function admitToolOverride({ tools, overrides, grants, spawn }) {
  if (overrides === undefined || Object.keys(overrides).length === 0) return { granted: true, executed: [] };
  if (!grants.includes('executeTarget')) {
    return { granted: false, reason: 'executeTargetRequired', executed: [] };
  }
  const executed = [];
  for (const [name, path] of Object.entries(overrides)) {
    if (!isAbsolute(path)) return { granted: false, reason: 'overridePathNotAbsolute', executed };
    executed.push(spawn(path));
  }
  return { granted: true, executed };
}
