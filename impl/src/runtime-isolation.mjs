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
    const stripped = [];
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value === undefined) continue;
      if ((SECRET_NAME.test(key) || PROVIDER_OR_INJECTION.test(key)) && !this.keepEnv.has(key)) { stripped.push(key); continue; }
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
    for (const [key, value] of Object.entries(projectedEnv)) {
      if (value !== undefined && value !== null) env[key] = String(value);
    }

    const projectedFiles = [];
    for (const source of this.credentialFiles[family] ?? this.credentialFiles[vendor] ?? []) {
      if (!existsSync(source)) continue;
      const target = join(config, basename(source));
      copyFileSync(source, target);
      chmodSync(target, 0o600);
      projectedFiles.push(basename(target));
    }

    return {
      env,
      replaceEnv: true,
      posture: Object.freeze({
        root, home, tmp, config, family,
        strippedEnvKeys: Object.freeze(stripped.sort()),
        projectedEnvKeys: Object.freeze(Object.keys(projectedEnv).sort()),
        projectedFiles: Object.freeze(projectedFiles.sort()),
        permissions: { directories: '0700', credentialFiles: '0600' },
        sandboxPolicy: family === 'codex'
          ? 'wire-workspaceWrite-network-deny'
          : family === 'grok' ? 'native-workspace-profile' : 'settings-enabled-network-deny',
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
