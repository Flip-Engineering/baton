#!/usr/bin/env node
// Code-security acceptance runner.
//
// Modes:
//   --verify    static checks over the fixture corpus; no coordinator needed
//   --selftest  checker mutation control over recorded payloads
//   --auth      independent verification of the retained Fossil records
//   default     run the case catalog against the installed coordinator
//
// The catalog run calls the real coordinator. A missing binary, a missing
// session or an unimplemented command is reported as providerUnavailable.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { checkExpectation } from './lib/assert.mjs';
import { recordPhases, setPhase, sourceDigestSet, startMutator } from './lib/capture.mjs';
import {
  HERE, isSymlink, listFixtureFiles, materializeDeclaration, materializeTree, sha256File, writeLauncher,
} from './lib/fixtures.mjs';
import { Coordinator, isUnavailable } from './lib/provider.mjs';

const FIXTURES = join(HERE, 'fixtures');
const DEFAULT_CLANG = process.env.BATON_CONTEXT_CLANG ?? '/opt/homebrew/opt/llvm/bin/clang-20';
const DEFAULT_CLANGD = process.env.BATON_CONTEXT_CLANGD ?? '/opt/homebrew/opt/llvm/bin/clangd';

function parseArgs(argv) {
  const options = { mode: 'run', cases: [], tools: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[(index += 1)];
    if (arg === '--verify') options.mode = 'verify';
    else if (arg === '--selftest') options.mode = 'selftest';
    else if (arg === '--auth') options.mode = 'auth';
    else if (arg === '--list') options.mode = 'list';
    else if (arg === '--baton2') options.baton2 = next();
    else if (arg === '--database') options.database = next();
    else if (arg === '--session') options.session = next();
    else if (arg === '--case') options.cases.push(next());
    else if (arg === '--clang') options.clang = next();
    else if (arg === '--clangd') options.clangd = next();
    else if (arg === '--evidence-root') options.evidenceRoot = next();
    else if (arg === '--work') options.work = next();
    else if (arg === '--tool') {
      const [name, ...rest] = String(next()).split('=');
      options.tools[name] = rest.join('=');
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function log(row) {
  process.stdout.write(`${JSON.stringify(row)}\n`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------
// --verify

function verifyFixtures(options) {
  const clang = options.clang ?? DEFAULT_CLANG;
  const results = [];
  const record = (id, ok, detail) => results.push({ id, ok, detail });

  record('clang-present', existsSync(clang), clang);
  if (existsSync(clang)) {
    const version = spawnSync(clang, ['--version'], { encoding: 'utf8' });
    record('clang-version', version.stdout.includes('20.1.8'), version.stdout.split('\n')[0].trim());
  }

  // Compile every C fixture. A tree with a compilation database is compiled
  // through its own recorded command with the pinned front end substituted for
  // argv[0]; the trees that deliberately carry a refused flag or an executable
  // driver are compiled with plain flags instead.
  const refusedCommands = new Set(['clangd/plugin-flag', 'clangd/driver-shim']);
  const plainFlags = new Map([
    ['c', []],
    ['capture/three-file', ['-Iinclude']],
    ['clangd/admitted-sdk', ['-Isdk']],
    ['clangd/symlink-escape', ['-Iinclude']],
    ['clangd/symlink-inside', ['-Iinclude']],
    ['clangd/unadmitted-root', ['-I.']],
    ['clangd/response-file', ['-Iinclude']],
    ['clangd/plugin-flag', []],
    ['clangd/driver-shim', []],
    ['clangd/project-config', []],
    ['clangd/project-config-control', []],
    ['clangd/outside-root', []],
  ]);

  for (const [tree, flags] of plainFlags) {
    const treeDir = join(FIXTURES, tree);
    if (!existsSync(treeDir)) {
      record(`tree-missing:${tree}`, false, treeDir);
      continue;
    }
    const databases = listFixtureFiles(treeDir, (path) => path.endsWith('.json') && !path.endsWith('compile_commands.json'))
      .filter((path) => {
        try {
          const parsed = JSON.parse(readFileSync(path, 'utf8'));
          return Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].arguments);
        } catch {
          return false;
        }
      });
    const files = listFixtureFiles(treeDir, (path) => path.endsWith('.c') || path.endsWith('.h'));
    for (const file of files) {
      let argv;
      if (!refusedCommands.has(tree) && !tree.startsWith('capture') && databases.length === 0) {
        const database = join(treeDir, 'compile_commands.json');
        if (existsSync(database)) {
          const entry = JSON.parse(readFileSync(database, 'utf8'))[0];
          const args = entry.arguments.slice(1)
            .map((item) => item.split('__FIXTURE_ROOT__').join(treeDir))
            .map((item) => (item === '-c' ? '-fsyntax-only' : item));
          if (args.some((item) => item.startsWith('@'))) args.push('-fsyntax-only');
          argv = [clang, ...args];
        }
      }
      if (!argv) argv = [clang, '-std=gnu89', '-fsyntax-only', ...flags, file];
      const run = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: treeDir });
      const ok = run.status === 0;
      record(`compiles:${relative(FIXTURES, file)}`, ok, ok ? 'clean' : (run.stderr || '').trim().split('\n')[0] ?? `exit ${run.status}`);
    }
    for (const database of databases) {
      const entries = JSON.parse(readFileSync(database, 'utf8'));
      const entry = Array.isArray(entries) ? entries[0] : entries;
      if (!entry?.arguments) {
        record(`database-shape:${relative(FIXTURES, database)}`, false, 'no arguments array');
        continue;
      }
      const needle = entry.arguments.slice(1).filter((item) => !item.startsWith('-'));
      record(`database-arguments:${relative(FIXTURES, database)}`, needle.length > 0, `${entry.arguments.length} arguments`);
    }
  }

  for (const json of listFixtureFiles(FIXTURES, (path) => path.endsWith('.json'))) {
    let detail = 'parsed';
    let ok = true;
    try {
      JSON.parse(readFileSync(json, 'utf8'));
    } catch (error) {
      ok = false;
      detail = String(error.message);
    }
    record(`json:${relative(FIXTURES, json)}`, ok, detail);
  }

  const escapeLink = join(FIXTURES, 'clangd/symlink-escape/include/escape.h');
  const insideLink = join(FIXTURES, 'clangd/symlink-inside/include/alias.h');
  record('symlink-escape-is-link', isSymlink(escapeLink), relative(HERE, escapeLink));
  record('symlink-inside-is-link', isSymlink(insideLink), relative(HERE, insideLink));
  if (isSymlink(escapeLink)) {
    const target = realpathSync(escapeLink);
    const includeRoot = join(FIXTURES, 'clangd/symlink-escape/include');
    record('symlink-escape-target', !target.startsWith(`${includeRoot}/`), target);
  }
  if (isSymlink(insideLink)) {
    const target = realpathSync(insideLink);
    const includeRoot = join(FIXTURES, 'clangd/symlink-inside/include');
    record('symlink-inside-target', target.startsWith(`${includeRoot}/`), target);
  }

  const clangdDir = join(FIXTURES, 'clangd');
  if (existsSync(clangdDir)) {
    for (const tree of readdirSync(clangdDir, { withFileTypes: true })) {
      if (!tree.isDirectory()) continue;
      const compileDb = join(clangdDir, tree.name, 'compile_commands.json');
      const pluginDbs = ['plugin.json', 'load.json', 'fplugin.json'].map((name) => join(clangdDir, tree.name, name));
      const hasDb = existsSync(compileDb) || pluginDbs.some((path) => existsSync(path));
      record(`tree:${tree.name}`, hasDb || tree.name === 'outside-root', hasDb ? 'has a compilation database' : 'no database');
    }
  }

  const cases = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
  const caseKeys = new Set(['id', 'group', 'default', 'subjectPath', 'request', 'expect', 'declaration',
    'sameFactsAs', 'scenario', 'polls', 'release', 'exportedMarkers', 'probeMarker', 'captureTree',
    'mutateAfter', 'mutateDuring']);
  const expectKeys = new Set(['outcome', 'exitCode', 'refusalCondition', 'refusalConditionIncludes',
    'relations', 'forbiddenRelations', 'limits', 'forbiddenLimits', 'mustNotMention',
    'sourceIdentitiesVerified', 'snapshotInputs', 'phaseConsistent', 'ordering', 'oneGuardPerCall',
    'applicability', 'forbiddenOutcome', 'waitingForAll', 'eitherOf', 'marker', 'probeMarkerPresent',
    'probeMarkerAbsent', 'probeEnvExcludes', 'probeEnvIncludes']);
  const relationKeys = new Set(['kind', 'classification', 'count', 'minAcceptedRoutes',
    'cutSetCoversAccepted', 'deniedRouteReachesReturn', 'callsite']);
  const groups = new Set(['security', 'boundary', 'lifecycle', 'capture', 'environment']);
  const defaults = Object.keys(cases.defaults ?? {});
  const ids = new Set();
  const unknown = (row, allowed) => Object.keys(row).filter((key) => !allowed.has(key));
  for (const entry of cases.cases) {
    if (!entry.id) record('case-id-missing', false, JSON.stringify(entry).slice(0, 120));
    if (!groups.has(entry.group)) record(`case-group:${entry.id ?? '?'}`, false, `unknown group ${entry.group}`);
    if (entry.default && !defaults.includes(entry.default)) record(`case-default:${entry.id}`, false, entry.default);
    const strayCase = unknown(entry, caseKeys);
    if (strayCase.length > 0) record(`case-fields:${entry.id}`, false, strayCase.join(','));
    const strayExpect = unknown(entry.expect ?? {}, expectKeys);
    if (strayExpect.length > 0) record(`expect-fields:${entry.id}`, false, strayExpect.join(','));
    for (const relation of [...(entry.expect?.relations ?? []), ...(entry.expect?.forbiddenRelations ?? [])]) {
      const strayRelation = unknown(relation, relationKeys);
      if (strayRelation.length > 0) record(`relation-fields:${entry.id}`, false, strayRelation.join(','));
    }
    if (ids.has(entry.id)) record(`case-id:${entry.id}`, false, 'duplicate id');
    ids.add(entry.id);
    const subject = entry.subjectPath ?? entry.request?.subject?.path;
    if (subject && !existsSync(join(FIXTURES, subject))) record(`case-subject:${entry.id}`, false, subject);
    const project = entry.request?.options?.project;
    if (project && !project.startsWith('__') && !existsSync(join(FIXTURES, project))) record(`case-project:${entry.id}`, false, project);
    if (entry.declaration) {
      const template = join(FIXTURES, entry.declaration.template);
      if (!existsSync(template)) record(`case-template:${entry.id}`, false, entry.declaration.template);
    }
  }
  record('case-ids-unique', ids.size === cases.cases.length, `${ids.size} ids`);
  record('cases-present', cases.cases.length > 0, `${cases.cases.length} cases`);

  const failed = results.filter((row) => !row.ok);
  for (const row of results) log(row);
  log({ summary: 'verify', checks: results.length, failed: failed.length, ok: failed.length === 0 });
  return failed.length === 0;
}

// ---------------------------------------------------------------------------
// --selftest

function selftest() {
  const path = join(HERE, 'selftest/checker-cases.json');
  if (!existsSync(path)) {
    log({ summary: 'selftest', ok: false, detail: 'selftest/checker-cases.json is missing' });
    return false;
  }
  const raw = readFileSync(path, 'utf8');
  const substituted = raw
    .split('__HERE__').join(HERE)
    .replace(/__SHA256_OF:([^_]+(?:_[^_]+)*)__/g, (match, relativePath) => {
      const target = join(HERE, relativePath);
      return existsSync(target) ? sha256File(target) : `missing:${relativePath}`;
    });
  const catalog = JSON.parse(substituted);
  let failed = 0;
  for (const entry of catalog) {
    const result = checkExpectation(entry.expect, entry.answer, entry.context ?? {});
    const ok = result.ok === entry.wantOk;
    if (!ok) failed += 1;
    log({ id: entry.id, ok, wantOk: entry.wantOk, observedOk: result.ok, failures: result.failures.slice(0, 3) });
  }
  log({ summary: 'selftest', checks: catalog.length, failed, ok: failed === 0 });
  return failed === 0;
}

// ---------------------------------------------------------------------------
// catalog run

function deepMerge(base, overlay) {
  if (Array.isArray(base) || Array.isArray(overlay)) return overlay ?? base;
  if (base && overlay && typeof base === 'object' && typeof overlay === 'object') {
    const out = { ...base };
    for (const [key, value] of Object.entries(overlay)) out[key] = key in base ? deepMerge(base[key], value) : value;
    return out;
  }
  return overlay === undefined ? base : overlay;
}

function substituteRequest(value, tokens) {
  if (typeof value === 'string') {
    let out = value;
    for (const [name, replacement] of Object.entries(tokens)) out = out.split(`__${name}__`).join(replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => substituteRequest(item, tokens));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = substituteRequest(item, tokens);
    return out;
  }
  return value;
}

function prepareWork(options) {
  const root = options.work ?? mkdtempSync(join(tmpdir(), 'bend2-code-security-'));
  const tokens = { CLANG: options.clang ?? DEFAULT_CLANG };
  const launchers = join(root, 'launchers');
  mkdirSync(launchers, { recursive: true });

  const clangdTransport = join(FIXTURES, 'providers/clangd-transport.mjs');
  const envProbe = join(FIXTURES, 'providers/env-probe.mjs');
  const node = process.execPath;
  const launcherFor = (label, script, scenario) => writeLauncher(
    launchers,
    `${label}.sh`,
    [node, script],
    scenario ? { CLANGD_FIXTURE_SCENARIO: scenario } : {},
  );

  // Each tree materializes into its own root so its __FIXTURE_ROOT__ token
  // points at itself. The request cwd is the work root.
  const roots = ['c'];
  const clangdRoot = join(FIXTURES, 'clangd');
  if (existsSync(clangdRoot)) {
    for (const entry of readdirSync(clangdRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join('clangd', entry.name));
    }
  }
  for (const tree of roots) {
    const dest = join(root, tree);
    materializeTree(join(FIXTURES, tree), dest, { ...tokens, FIXTURE_ROOT: dest });
  }
  const providers = join(root, 'providers');
  materializeTree(join(FIXTURES, 'providers'), providers, tokens);

  return { root, tokens, launchers, clangdTransport, envProbe, node, launcherFor };
}

function prepareCapture(work, name) {
  const dest = join(work.root, 'capture', name);
  materializeTree(join(FIXTURES, 'capture', name), dest, { ...work.tokens, FIXTURE_ROOT: dest });
  return dest;
}

function readCaseCatalog() {
  return JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
}

function buildRequest(entry, defaults, work, cwd) {
  const base = entry.default ? (defaults[entry.default]?.request ?? {}) : {};
  let request = deepMerge(base, entry.request ?? {});
  if (entry.subjectPath) {
    request = deepMerge(request, { subject: { path: entry.subjectPath } });
  }
  request = { ...request, cwd };
  const tokens = {
    CLANGD_LAUNCHER: work.launcherFor(`clangd-${entry.scenario ?? 'default'}`, work.clangdTransport, entry.scenario),
    ENV_PROBE_LAUNCHER: work.launcherFor('env-probe', work.envProbe),
  };
  request = substituteRequest(request, tokens);
  if (request.subject?.declaration?.sha256 === 'computed') {
    request.subject.declaration.sha256 = sha256File(join(cwd, request.subject.declaration.path));
  }
  return request;
}

function sideChecks(entry, cwd) {
  const failures = [];
  const spec = entry.expect.marker;
  if (spec) {
    const path = join(cwd, spec.path);
    const present = existsSync(path);
    if (spec.mustExist === true && !present) failures.push(`marker: ${spec.path} absent`);
    if (spec.mustExist === false && present) failures.push(`marker: ${spec.path} present`);
  }
  if (entry.probeMarker) {
    const path = join(cwd, entry.probeMarker);
    const present = existsSync(path);
    if (entry.expect.probeMarkerAbsent && present) failures.push(`probeMarker: ${entry.probeMarker} present despite the refusal`);
    if (entry.expect.probeMarkerPresent && !present) failures.push(`probeMarker: ${entry.probeMarker} absent after the granted override`);
    if (present && entry.expect.probeEnvExcludes) {
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      if (lines.length === 0) failures.push('probeMarker: the probe recorded no invocation');
      const merged = new Set();
      for (const line of lines) {
        let record = null;
        try {
          record = JSON.parse(line);
        } catch {
          failures.push('probeMarker: a recorded line is not JSON');
          continue;
        }
        for (const name of Object.keys(record.env ?? {})) merged.add(name);
      }
      for (const name of entry.expect.probeEnvExcludes) {
        if (merged.has(name)) failures.push(`probeEnvExcludes: ${name} reached the provider child`);
      }
      if (merged.size > 0 && entry.expect.probeEnvIncludes) {
        for (const name of entry.expect.probeEnvIncludes) {
          if (!merged.has(name)) failures.push(`probeEnvIncludes: ${name} absent from the provider child`);
        }
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

async function runCatalog(options) {
  const work = prepareWork(options);
  const catalog = readCaseCatalog();
  const defaults = catalog.defaults ?? {};
  const selected = options.cases.length > 0 ? catalog.cases.filter((entry) => options.cases.includes(entry.id)) : catalog.cases;
  if (selected.length === 0) {
    log({ summary: 'run', ok: false, detail: 'no case selected' });
    return false;
  }

  const coordinator = new Coordinator({
    baton2: options.baton2,
    database: options.database,
    session: options.session,
    cwd: work.root,
  });
  if (!coordinator.installed()) {
    log({ summary: 'run', ok: false, providerUnavailable: true, detail: 'no coordinator binary was supplied or found', baton2: options.baton2 ?? null });
    return false;
  }

  let failures = 0;
  let unavailable = 0;
  const answers = new Map();

  for (const entry of selected) {
    const capture = entry.captureTree ? prepareCapture(work, entry.captureTree) : null;
    const cwd = capture ?? work.root;
    if (entry.declaration) {
      materializeDeclaration(
        join(FIXTURES, entry.declaration.template),
        join(cwd, entry.declaration.out),
        join(cwd, entry.declaration.target),
        entry.declaration.spans,
      );
    }
    const request = buildRequest(entry, defaults, work, cwd);
    const requestText = JSON.stringify(request);

    const env = {};
    for (const [name, value] of Object.entries(entry.exportedMarkers ?? {})) env[name] = value;
    if (entry.probeMarker) env.ENV_PROBE_MARKER = join(cwd, entry.probeMarker);
    coordinator.env = { ...process.env, ...env };

    let phases = [];
    let mutator = null;
    if (entry.mutateDuring) {
      phases = recordPhases(cwd);
      mutator = startMutator(cwd);
    }

    const queryId = `accept-${entry.id}`;
    let answer = coordinator.submitAndRead(queryId, requestText);
    if (isUnavailable(answer)) {
      unavailable += 1;
      log({ id: entry.id, ok: false, providerUnavailable: true, detail: answer.detail ?? `exit ${answer.submission.exitCode}`, stderr: answer.submission.stderr.slice(0, 400) });
      continue;
    }

    // Managed queries: poll the retained envelope.
    const polls = entry.polls ?? 0;
    for (let attempt = 0; attempt < polls; attempt += 1) {
      const state = answer.envelope?.state;
      if (state && state !== 'accepted' && state !== 'running') break;
      sleep(100);
      const retained = coordinator.retrieve(queryId);
      if (retained.kind === 'retained') answer = { kind: 'retained', submission: retained.submission, envelope: retained.envelope };
    }

    if (entry.release && (answer.envelope?.state === 'running' || answer.envelope?.state === 'accepted')) {
      coordinator.control(`${queryId}-release`, queryId, 'release', 'SIGTERM');
      for (let attempt = 0; attempt < (entry.polls ?? 4); attempt += 1) {
        sleep(100);
        const retained = coordinator.retrieve(queryId);
        if (retained.kind === 'retained') answer = { kind: 'retained', submission: retained.submission, envelope: retained.envelope };
        const state = answer.envelope?.state;
        if (state && state !== 'accepted' && state !== 'running') break;
      }
    }

    if (mutator) {
      mutator.kill('SIGTERM');
      mutator = null;
    }

    let digestDrift = null;
    if (entry.mutateAfter) {
      const before = sourceDigestSet(answer.envelope);
      setPhase(join(cwd, entry.mutateAfter), '1');
      const retained = coordinator.retrieve(queryId);
      if (retained.kind === 'retained') {
        answer = { kind: 'retained', submission: retained.submission, envelope: retained.envelope };
      }
      const after = sourceDigestSet(answer.envelope);
      if (before.length > 0 && JSON.stringify(before) !== JSON.stringify(after)) {
        digestDrift = `stored source digests changed after an input change (${before.length} recorded)`;
      }
    }

    const evaluated = { exitCode: answer.submission.exitCode, stdout: answer.submission.stdout, stderr: answer.submission.stderr, envelope: answer.envelope };
    const result = checkExpectation(entry.expect, evaluated, { phases });
    const side = sideChecks(entry, cwd);
    const failuresForCase = [...result.failures, ...side.failures];
    if (digestDrift) failuresForCase.push(digestDrift);

    if (entry.sameFactsAs) {
      const other = answers.get(entry.sameFactsAs);
      const shape = (envelope) => JSON.stringify((envelope?.result?.relations ?? []).map((item) => [item.kind, item.classification]));
      if (!other) failuresForCase.push(`sameFactsAs: ${entry.sameFactsAs} produced no answer to compare`);
      else if (shape(other) !== shape(evaluated.envelope)) failuresForCase.push(`sameFactsAs: relation shape differs from ${entry.sameFactsAs}`);
    }
    answers.set(entry.id, evaluated.envelope);

    const ok = failuresForCase.length === 0;
    if (!ok) failures += 1;
    log({ id: entry.id, ok, state: evaluated.envelope?.state ?? null, failures: failuresForCase.slice(0, 4) });
  }

  log({ summary: 'run', cases: selected.length, failed: failures, providerUnavailable: unavailable, ok: failures === 0 && unavailable === 0 });
  return failures === 0 && unavailable === 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('usage: run.mjs [--verify|--selftest|--auth|--list] [--baton2 PATH --database PATH --session ID] [--case ID] [--clang PATH] [--clangd PATH] [--tool NAME=PATH]\n');
    return 0;
  }
  if (options.mode === 'list') {
    const catalog = readCaseCatalog();
    for (const entry of catalog.cases) log({ id: entry.id, group: entry.group });
    return 0;
  }
  if (options.mode === 'verify') return verifyFixtures(options) ? 0 : 1;
  if (options.mode === 'selftest') return selftest() ? 0 : 1;
  if (options.mode === 'auth') {
    const modulePath = join(HERE, 'verify/authentic.mjs');
    if (!existsSync(modulePath)) {
      log({ summary: 'auth', ok: false, detail: 'verify/authentic.mjs is missing' });
      return 1;
    }
    const { verifyAuthentic } = await import(modulePath);
    const evidenceRoot = options.evidenceRoot ?? '/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/semantic-context-20261005/probes/semantic-models-security-critic/fossil-qualification';
    const result = await verifyAuthentic(evidenceRoot, options);
    for (const check of result.checks) log({ id: check.id, ok: check.ok, detail: check.detail });
    log({ summary: 'auth', checks: result.checks.length, failed: result.checks.filter((check) => !check.ok).length, ok: result.ok });
    return result.ok ? 0 : 1;
  }
  return (await runCatalog(options)) ? 0 : 2;
}

main().then((code) => process.exit(code)).catch((error) => {
  log({ summary: 'error', ok: false, detail: String(error?.stack ?? error) });
  process.exit(1);
});
