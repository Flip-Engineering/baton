// Structural environment allowlist discriminators over real target files.
//
// SCOPE: this case exercises the suite's own reference allowlist
// (lib/envscan.mjs) as a contract oracle for the structural-value rules.
// It is NOT qualification of a production environment provider; the
// catalogs provider names environmentRead and toolsProbe unsupported.
// Production assertions bind to the environment author's native entry when
// it exists.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { check } from '../lib/harness.mjs';
import { composeTopology, declaredDependencies, dotenvFacts, admitToolOverride, installedResolution } from '../lib/envscan.mjs';

function buildProject(workspace) {
  const root = join(workspace, 'env-target');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'env-target',
    version: '1.0.0',
    description: 'free-form description stays out of automatic values',
    homepage: 'https://example.invalid/env-target',
    dependencies: { 'left-pad': '^1.3.0', zod: '4.3.6' },
    devDependencies: { typescript: '~5.9.2' },
    scripts: { build: 'echo would-not-run' },
  }, null, 2));
  writeFileSync(join(root, '.env'), 'API_TOKEN=supersecret\nPORT=8080\n');
  writeFileSync(join(root, 'compose.json'), JSON.stringify({
    services: {
      api: {
        image: 'registry.example.invalid/api@sha256:deadbeef',
        command: '--insecure --token-from-env',
        environment: { API_TOKEN: 'supersecret' },
        depends_on: { db: { condition: 'service_healthy' } },
        ports: ['8080:80', { published: '9090', target: 90 }],
        networks: ['backend'],
        volumes: ['data:/var/lib/api'],
        secrets: ['api_cert'],
      },
      db: { image: 'postgres:14.18', ports: ['5432:5432'] },
    },
  }, null, 2));
  return root;
}

check({
  id: 'env/declared-dependencies-restricted',
  requirement: 'declared dependency versions are validated strings with their origin; description/homepage/scripts/URL fields contribute no automatic value (spec structural restriction)',
  async run({ workspace }) {
    const root = buildProject(workspace);
    const { declared, excluded } = declaredDependencies(join(root, 'package.json'));
    const names = declared.map(entry => entry.name).sort();
    if (JSON.stringify(names) !== '["left-pad","typescript","zod"]') throw new Error(`declared observed ${JSON.stringify(names)}`);
    const excludedFields = excluded.map(entry => entry.field);
    for (const field of ['description', 'homepage', 'scripts']) {
      if (!excludedFields.includes(field)) throw new Error(`free-form field ${field} not excluded`);
    }
    return { declared: names, excluded: excludedFields };
  },
});

check({
  id: 'env/installed-resolution-separately-attributed',
  requirement: 'installed versions come from resolved disk manifests with their own classification and agreement flag; declaration and installation never merge',
  async run({ workspace }) {
    const root = buildProject(workspace);
    mkdirSync(join(root, 'node_modules', 'zod'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'zod', 'package.json'), JSON.stringify({ name: 'zod', version: '4.3.6' }));
    const resolution = installedResolution({ manifestPath: join(root, 'package.json'), readRoots: [root], packageName: 'zod' });
    if (resolution.installedVersion !== '4.3.6') throw new Error(`installed observed ${JSON.stringify(resolution)}`);
    if (resolution.classification !== 'observed' || resolution.agreement !== true) throw new Error(`attribution observed ${JSON.stringify(resolution)}`);
    const missing = installedResolution({ manifestPath: join(root, 'package.json'), readRoots: [root], packageName: 'left-pad' });
    if (missing.installedVersion !== null || missing.disagreement === undefined) throw new Error(`unresolved observed ${JSON.stringify(missing)}`);
    return { zod: { installed: resolution.installedVersion, agreement: resolution.agreement }, leftPad: missing.disagreement };
  },
});

check({
  id: 'env/dotenv-presence-only',
  requirement: 'dotenv contributes path and key names only; values never enter facts (spec: dotenv files contribute path/key presence only)',
  async run({ workspace }) {
    const root = buildProject(workspace);
    const { readFileSync } = await import('node:fs');
    const facts = dotenvFacts(join(root, '.env'), readFileSync(join(root, '.env')));
    if (JSON.stringify(facts.keys) !== '["API_TOKEN","PORT"]') throw new Error(`keys observed ${JSON.stringify(facts.keys)}`);
    if (JSON.stringify(facts).includes('supersecret')) throw new Error('dotenv value leaked into facts');
    return { keys: facts.keys, present: facts.present };
  },
});

check({
  id: 'env/compose-structural-only',
  requirement: 'compose topology returns service ids, dependency conditions, ports, networks, volume targets and secret/config key names; command strings, image endpoints and env values are excluded',
  async run({ workspace }) {
    const root = buildProject(workspace);
    const { readFileSync } = await import('node:fs');
    const topology = composeTopology(JSON.parse(readFileSync(join(root, 'compose.json'), 'utf8')));
    const api = topology.services.find(service => service.id === 'api');
    if (api.dependsOn[0].id !== 'db' || api.dependsOn[0].condition !== 'service_healthy') throw new Error(`depends_on observed ${JSON.stringify(api.dependsOn)}`);
    if (api.ports[0] !== '8080:80' || api.ports[1] !== '9090:90') throw new Error(`ports observed ${JSON.stringify(api.ports)}`);
    if (api.volumes[0] !== '/var/lib/api') throw new Error(`volume target observed ${JSON.stringify(api.volumes)}`);
    if (JSON.stringify(api.secretKeys) !== '["api_cert"]') throw new Error(`secrets observed ${JSON.stringify(api.secretKeys)}`);
    const serialized = JSON.stringify(topology);
    for (const secret of ['supersecret', 'sha256:deadbeef', 'token-from-env']) {
      if (serialized.includes(secret)) throw new Error(`excluded value leaked: ${secret}`);
    }
    return { services: topology.services.map(entry => entry.id), excluded: topology.excluded };
  },
});

check({
  id: 'env/tool-override-requires-execute-target',
  requirement: 'any request-local tools override requires executeTarget, including one naming the deployment path; without the grant nothing executes (spec effect admission)',
  async run() {
    const executed = [];
    const spawn = path => { executed.push(path); return { path, version: '1.2.3' }; };
    const refused = admitToolOverride({ tools: {}, overrides: { clangd: '/usr/bin/clangd' }, grants: [], spawn });
    if (refused.granted !== false || executed.length !== 0) throw new Error(`grant-less override observed ${JSON.stringify(refused)}`);
    const deploymentPath = '/opt/baton2/providers/clangd';
    const samePath = admitToolOverride({ tools: { clangd: deploymentPath }, overrides: { clangd: deploymentPath }, grants: [], spawn });
    if (samePath.granted !== false || executed.length !== 0) throw new Error('override naming the deployment path executed without the grant');
    const granted = admitToolOverride({ tools: {}, overrides: { clangd: '/usr/bin/clangd' }, grants: ['executeTarget'], spawn });
    if (granted.granted !== true || executed.length !== 1) throw new Error(`granted override observed ${JSON.stringify(granted)}`);
    return { refusedReason: refused.reason, samePathRefused: samePath.granted === false, grantedExecutions: executed };
  },
});

check({
  id: 'env/ambient-credential-exclusion',
  requirement: 'no automatic environment fact VALUE carries ambient harness/credential values; explicit caller-supplied path fields are retained evidence and are not ambient leaks (spec: never reads the coordinator/harness environment)',
  async run({ workspace }) {
    const root = buildProject(workspace);
    const { readFileSync } = await import('node:fs');
    const declared = declaredDependencies(join(root, 'package.json'));
    const dotenv = dotenvFacts(join(root, '.env'), readFileSync(join(root, '.env')));
    const compose = composeTopology(JSON.parse(readFileSync(join(root, 'compose.json'), 'utf8')));
    // Only value fields, never explicit path fields: paths are retained
    // evidence for admitted inputs by the spec's path-resolution rule.
    const values = JSON.stringify({
      declared: declared.declared,
      dotenvKeys: dotenv.keys,
      compose: { services: compose.services.map(({ id, dependsOn, ports, networks, volumes, secretKeys }) => ({ id, dependsOn, ports, networks, volumes, secretKeys })) },
    });
    for (const ambient of [process.env.HOME ?? 'wahargis', process.env.SHELL ?? '/bin/zsh', process.env.USER ?? 'operator']) {
      if (values.includes(ambient)) throw new Error(`ambient value leaked into environment fact values: ${ambient}`);
    }
    return { ambientValuesChecked: 3, leak: false, valueFieldsScanned: ['declared', 'dotenvKeys', 'compose'] };
  },
});
