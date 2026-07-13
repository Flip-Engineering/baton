// Per-worker runtime/config-home isolation. This is an environment and credential boundary, not
// a claim of kernel filesystem/network sandboxing; adapter cards describe those separately.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
const PROVIDER_OR_INJECTION = /^(ANTHROPIC_|OPENAI_|XAI_|ZAI_|Z_AI_|AWS_|GOOGLE_|AZURE_|GITHUB_|NODE_OPTIONS$|PYTHONPATH$|PYTHONHOME$|RUBYOPT$|PERL5OPT$|BASH_ENV$|ENV$|CDPATH$|GIT_CONFIG|GIT_DIR$|GIT_WORK_TREE$|DYLD_|LD_|.*_PROXY$)/i;
const ALWAYS_KEEP = new Set(['PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'TZ']);

function vendorFamily(vendor) {
  if (vendor === 'codex') return 'codex';
  if (vendor === 'grok') return 'grok';
  if (vendor === 'glm' || vendor === 'z-code') return 'glm';
  return 'claude';
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
    this.keepEnv = new Set([...(opts.keepEnv ?? []), ...ALWAYS_KEEP]);
    privateDir(this.root);
  }

  create(workerId, vendor) {
    const family = vendorFamily(vendor);
    const root = privateDir(join(this.root, workerId));
    const home = privateDir(join(root, 'home'));
    const tmp = privateDir(join(root, 'tmp'));
    // Grok's native sandbox grants its expected ~/.grok tree, not an arbitrary GROK_HOME outside
    // HOME. Keep HOME private and place the projected config at that vendor-native path.
    const config = privateDir(family === 'grok' ? join(home, '.grok') : join(root, 'config', family));

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
    if (family === 'codex') env.CODEX_HOME = config;
    else if (family === 'grok') env.GROK_HOME = config;
    else env.CLAUDE_CONFIG_DIR = config;

    if (family === 'claude' || family === 'glm') {
      const settingsPath = join(config, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          network: { allowedDomains: [], allowUnixSockets: [] },
        },
      }));
      chmodSync(settingsPath, 0o600);
    }

    const projectedEnv = this.credentialEnv[family] ?? this.credentialEnv[vendor] ?? {};
    let projectedEnvCount = 0;
    for (const [key, value] of Object.entries(projectedEnv)) {
      if (value !== undefined && value !== null) {
        env[key] = String(value);
        projectedEnvCount += 1;
      }
    }

    let projectedFileCount = 0;
    for (const source of this.credentialFiles[family] ?? this.credentialFiles[vendor] ?? []) {
      if (!existsSync(source)) continue;
      const target = join(config, basename(source));
      copyFileSync(source, target);
      chmodSync(target, 0o600);
      projectedFileCount += 1;
    }

    const credentialCount = projectedEnvCount + projectedFileCount;
    const credentialMechanism = projectedEnvCount > 0 && projectedFileCount > 0
      ? 'mixed'
      : projectedEnvCount > 0 ? 'environment' : projectedFileCount > 0 ? 'file' : 'none';

    return {
      env,
      replaceEnv: true,
      // Operational paths stay on the private lease. `posture` is logged and returned by public
      // status surfaces, so it must never carry host/runtime paths or credential inventory names.
      paths: Object.freeze({ root, home, tmp, config }),
      posture: Object.freeze({
        schemaVersion: 1,
        family,
        credential: Object.freeze({
          mechanism: credentialMechanism,
          state: credentialCount > 0 ? 'materialized' : 'absent',
          count: credentialCount,
        }),
        permissions: Object.freeze({ directories: '0700', credentialFiles: '0600' }),
        sandboxPolicy: family === 'codex'
          ? 'wire-workspaceWrite-network-deny'
          : family === 'grok' ? 'native-workspace-profile' : 'settings-enabled-network-deny',
        active: true,
      }),
    };
  }

  remove(workerId) {
    rmSync(join(this.root, workerId), { recursive: true, force: true });
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
