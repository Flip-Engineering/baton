// Per-worker runtime/config-home isolation. This is an environment and credential boundary, not
// a claim of kernel filesystem/network sandboxing; adapter cards describe those separately.

import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { projectCredentialTree } from './credential-projection.mjs';

const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
const PROVIDER_OR_INJECTION = /^(ANTHROPIC_|OPENAI_|XAI_|ZAI_|Z_AI_|MOONSHOT_|KIMI_|AWS_|GOOGLE_|GCLOUD_|CLOUD_ML_|AZURE_|FOUNDRY_|GITHUB_|NODE_OPTIONS$|PYTHONPATH$|PYTHONHOME$|RUBYOPT$|PERL5OPT$|BASH_ENV$|ENV$|CDPATH$|GIT_CONFIG|GIT_DIR$|GIT_WORK_TREE$|DYLD_|LD_|.*_PROXY$)/i;
const ALWAYS_KEEP = new Set(['PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'TZ']);

// #234: exported so deployment readiness resolves the SAME family/credential-state facts the
// dispatch path (RuntimeIsolation.create) resolves — one derivation, never a drifting copy.
export function runtimeIdentity(selection) {
  // Coordinator callers supply the selected adapter card. A registry key is only a private map
  // coordinate and cannot determine provider credentials or the executable's configuration home.
  // String support remains for direct/legacy RuntimeIsolation embedders.
  if (typeof selection === 'string') {
    const family = selection === 'z-code' ? 'glm' : selection;
    const surface = family === 'codex' || family === 'grok' ? family : 'claude';
    return { family, surface, authPosture: 'unknown', adapterCredentialState: null };
  }
  const card = selection?.card ?? selection;
  if (!card || typeof card.harness !== 'string' || card.harness.length === 0) {
    throw new TypeError('runtime isolation requires a selected adapter card');
  }
  const harness = card.harness;
  // #230: omp is its own surface. Its provider auth (deepseek/glm keys, oauth) lives in
  // ~/.omp/agent — projected as a HOME-relative tree (omp resolves $HOME/.omp), never the
  // claude config-dir fallback that left members auth-less and provider-silent for hours.
  const surface = harness === 'codex' ? 'codex'
    : harness === 'grok' ? 'grok'
      : harness === 'kimi-code' ? 'kimi-code'
        : harness === 'omp' ? 'omp' : 'claude';
  const provider = card.modelSelection?.family;
  const family = surface === 'claude' && typeof provider === 'string' && provider.length > 0
    ? provider : surface;
  return {
    family,
    surface,
    authPosture: card.authPosture ?? 'unknown',
    adapterCredentialState: card.providerCompatibility?.credentialState ?? null,
  };
}

function privateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

export class RuntimeIsolation {
  constructor(opts) {
    this.repoRoot = opts.repoRoot;
    this.root = opts.root ?? join(opts.repoRoot, '.baton', 'runtime');
    this.baseEnv = { ...(opts.baseEnv ?? process.env) };
    this.credentialEnv = opts.credentialEnv ?? {};
    this.credentialFiles = opts.credentialFiles ?? {};
    this.credentialTrees = opts.credentialTrees ?? {};
    this.keepEnv = new Set([...(opts.keepEnv ?? []), ...ALWAYS_KEEP]);
    // Admission constructs policy only. The first accepted worker creates the runtime root so a
    // pre-worktree capacity refusal leaves no runtime filesystem authority behind.
  }

  create(workerId, selection) {
    const { family, surface, authPosture, adapterCredentialState } = runtimeIdentity(selection);
    const root = privateDir(join(this.root, workerId));
    const home = privateDir(join(root, 'home'));
    const tmp = privateDir(join(root, 'tmp'));
    // Grok's native sandbox grants its expected ~/.grok tree, not an arbitrary GROK_HOME outside
    // HOME. Keep HOME private and place the projected config at that vendor-native path.
    const config = privateDir(surface === 'grok' ? join(home, '.grok') : join(root, 'config', family));

    const env = {};
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value === undefined) continue;
      if ((SECRET_NAME.test(key) || PROVIDER_OR_INJECTION.test(key)) && !this.keepEnv.has(key)) continue;
      env[key] = value;
    }
    env.HOME = home;
    env.TMPDIR = tmp;
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CODEX_HOME;
    delete env.GROK_HOME;
    delete env.KIMI_CODE_HOME;
    if (surface === 'codex') env.CODEX_HOME = config;
    else if (surface === 'grok') env.GROK_HOME = config;
    else if (surface === 'kimi-code') env.KIMI_CODE_HOME = config;
    // #230: omp reads $HOME/.omp — no config-dir override; the credential tree projects
    // HOME-relative (below), exactly omp's native resolution.
    else if (surface === 'omp') { /* HOME-relative; no config env var */ }
    else env.CLAUDE_CONFIG_DIR = config;

    if (surface === 'kimi-code') {
      env.KIMI_DISABLE_TELEMETRY = '1';
      env.KIMI_CODE_NO_AUTO_UPDATE = '1';
      env.KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT = '0';
    }

    if (surface === 'claude') {
      const settingsPath = join(config, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        sandbox: {
          enabled: false,
          failIfUnavailable: false,
          autoAllowBashIfSandboxed: false,
          allowUnsandboxedCommands: true,
        },
      }));
      chmodSync(settingsPath, 0o600);
    }

    const projectedEnv = this.credentialEnv[family] ?? {};
    let projectedEnvCount = 0;
    for (const [key, value] of Object.entries(projectedEnv)) {
      if (value !== undefined && value !== null) {
        env[key] = String(value);
        projectedEnvCount += 1;
      }
    }

    const frameRedactors = [];
    let projectedFileCount = 0;
    for (const source of this.credentialFiles[family] ?? []) {
      if (!existsSync(source)) continue;
      const projected = projectCredentialTree({
        sourceRoot: dirname(source), targetRoot: config, relativeFiles: [basename(source)],
      });
      projectedFileCount += projected.count;
      frameRedactors.push(projected.redactProviderFrame);
    }

    let projectedTreeCount = 0;
    // #230: omp resolves credentials at $HOME/.omp — its tree projects INTO the isolated
    // home (HOME-relative), not the config root. Same law as grok's ~/.grok placement.
    const treeTarget = surface === 'omp' ? home : config;
    for (const tree of this.credentialTrees[family] ?? []) {
      if (!tree || typeof tree.sourceRoot !== 'string' || !Array.isArray(tree.relativeFiles)) {
        throw new TypeError('runtime credential tree requires sourceRoot and relativeFiles');
      }
      const fromRepo = relative(this.repoRoot, tree.sourceRoot);
      if (fromRepo === '' || (!fromRepo.startsWith(`..${sep}`) && fromRepo !== '..' && !isAbsolute(fromRepo))) {
        throw Object.assign(new Error('runtime credential tree cannot originate inside the repository'), { code: 'credential_source_in_repository' });
      }
      const projected = projectCredentialTree({
        sourceRoot: tree.sourceRoot, targetRoot: treeTarget, relativeFiles: tree.relativeFiles,
        ...(tree.maxFileBytes ? { maxFileBytes: tree.maxFileBytes } : {}),
        ...(tree.maxTotalBytes ? { maxTotalBytes: tree.maxTotalBytes } : {}),
      });
      projectedTreeCount += projected.count;
      frameRedactors.push(projected.redactProviderFrame);
    }

    const projectedCredentialCount = projectedEnvCount + projectedFileCount + projectedTreeCount;
    const adapterManaged = projectedCredentialCount === 0 && adapterCredentialState === 'available';
    const credentialCount = adapterManaged ? 1 : projectedCredentialCount;
    const credentialMechanism = adapterManaged ? 'adapter'
      : projectedEnvCount > 0 && projectedFileCount > 0
      ? 'mixed'
      : projectedEnvCount > 0 ? 'environment' : (projectedFileCount > 0 || projectedTreeCount > 0) ? 'file' : 'none';

    return {
      env,
      replaceEnv: true,
      ...(frameRedactors.length > 0 ? {
        redactProviderFrame: (frame) => frameRedactors.reduce((value, redact) => redact(value), frame),
      } : {}),
      // Operational paths stay on the private lease. `posture` is logged and returned by public
      // status surfaces, so it must never carry host/runtime paths or credential inventory names.
      paths: Object.freeze({ root, home, tmp, config }),
      posture: Object.freeze({
        schemaVersion: 1,
        family,
        authPosture,
        credential: Object.freeze({
          mechanism: credentialMechanism,
          state: credentialCount > 0 ? 'materialized' : 'absent',
          count: credentialCount,
        }),
        permissions: Object.freeze({ directories: '0700', credentialFiles: '0600' }),
        sandboxPolicy: 'full-access-private-runtime-only',
        active: true,
      }),
    };
  }

  remove(workerId) {
    const target = join(this.root, workerId);
    rmSync(target, { recursive: true, force: true });
    if (existsSync(target)) {
      throw Object.assign(new Error('runtime isolation cleanup did not reach an exact absent state'), {
        code: 'runtime_cleanup_failed',
      });
    }
    return Object.freeze({ state: 'absent', workerId });
  }

  reconcile(expectedWorkerIds = []) {
    const expected = new Set(expectedWorkerIds);
    if (!existsSync(this.root)) return;
    for (const name of readdirSync(this.root)) {
      if (!expected.has(name)) this.remove(name);
    }
  }
}

export function isSecretEnvName(name) {
  return SECRET_NAME.test(name);
}
