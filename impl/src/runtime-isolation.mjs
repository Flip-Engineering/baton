// Per-worker runtime/config-home isolation. This is an environment and credential boundary, not
// a claim of kernel filesystem/network sandboxing; adapter cards describe those separately.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
    const surface = family === 'codex' || family === 'grok' || family === 'muse' ? family : 'claude';
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
        : harness === 'muse' ? 'muse'
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

// ── #346: the live credential DOCUMENT ─────────────────────────────────────────────────────────
//
// A claude-code subscription seat authenticates from the credential file under its own
// CLAUDE_CONFIG_DIR. Projecting it at spawn is not enough — that is the spawn-time snapshot #346
// observed dying mid-lane ("401 OAuth access token has expired") while nothing re-projected the
// deployment's refreshed credential into the running worker. So the family's credential document
// is written here at lease creation AND rewritten IN PLACE for every live lease whenever the
// deployment's credential cache adopts a refresh, atomically (0600, temp + rename): a running seat
// reads a live access token before its next provider call, with no harness cooperation.
//
// The document carries the access token only; the refresh token never enters a worker scope.

/** The bounded, relative path a projected document lands at inside the lease's config dir. */
function normalizedDocumentPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 256
    || relativePath.includes('\0') || isAbsolute(relativePath)) return null;
  const segments = relativePath.split(/[\\/]/u);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

/** The document a family's projection currently names, or null. One derivation, read at lease
 * creation and again on every re-projection — never a cached copy that could go stale. */
function credentialDocumentOf(projection) {
  if (!projection || typeof projection.read !== 'function') return null;
  let document;
  try { document = projection.read(); } catch { return null; }
  if (!recordValue(document)) return null;
  const relativePath = normalizedDocumentPath(document.relativePath);
  if (relativePath === null || typeof document.content !== 'string' || document.content.length === 0) {
    return null;
  }
  return Object.freeze({ relativePath, content: document.content });
}

function recordValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Atomic, owner-only write of one credential document. */
function writeCredentialDocument(config, document) {
  const target = join(config, ...document.relativePath.split('/'));
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  const temporary = join(parent, `.${process.pid}.${randomBytes(8).toString('hex')}.credential.tmp`);
  try {
    writeFileSync(temporary, document.content, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return target;
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
    this.credentialDocuments = opts.credentialDocuments ?? {};
    // #346: every LIVE lease, keyed by worker id — the registry the deployment's refresh
    // re-projection walks. Removed with the lease, so a reaped worker is never written to.
    this.leases = new Map();
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
    // #346: the lease is registered BEFORE any credential is written, so a refresh that lands
    // between the two writes re-projects into this lease rather than skipping it.
    this.leases.set(workerId, Object.freeze({ family, surface, config }));

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
    // Muse resolves $XDG_CONFIG_HOME/muse/auth.json (else ~/.config/muse). Point the
    // config home at the projected config root so the isolated runtime resolves the
    // projected `muse/auth.json` — never the host's ambient config. The OS keyring is the
    // operator's PRIMARY credential (#328), but a private runtime cannot reach it: macOS
    // resolves the login keychain under the real ~/Library/Keychains, and lending the
    // worker the real HOME would also import the operator's ambient agent rules and skills
    // (muse reads ~/.claude and ~/.codex). So the deployment reads the keyring at the root
    // and projects a file-backed `auth.json` (the same file a file-backed login already
    // is), and the worker is pinned to that projected file — the pin is the projection
    // mechanism, not the operator's login method.
    else if (surface === 'muse') {
      env.XDG_CONFIG_HOME = dirname(config);
      env.TBH_CREDENTIAL_BACKEND = 'file';
    }
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

    // #346: the live credential document (claude-code subscription routes) — written here and
    // rewritten in place by projectCredentialDocument() on every cache refresh.
    const document = credentialDocumentOf(this.credentialDocuments[family]);
    let projectedDocumentCount = 0;
    if (document) {
      writeCredentialDocument(config, document);
      projectedDocumentCount = 1;
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

    const projectedFileAxis = projectedFileCount + projectedDocumentCount;
    const projectedCredentialCount = projectedEnvCount + projectedFileAxis + projectedTreeCount;
    const adapterManaged = projectedCredentialCount === 0 && adapterCredentialState === 'available';
    const credentialCount = adapterManaged ? 1 : projectedCredentialCount;
    const credentialMechanism = adapterManaged ? 'adapter'
      : projectedEnvCount > 0 && projectedFileAxis > 0
      ? 'mixed'
      : projectedEnvCount > 0 ? 'environment' : (projectedFileAxis > 0 || projectedTreeCount > 0) ? 'file' : 'none';

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

  /** #346: rewrite a family's credential document for every LIVE lease of that family. The
   * deployment calls this the moment its credential cache adopts a refreshed credential, so a
   * running seat holds the rollover before its next provider call. Returns how many leases the
   * document reached (a lease whose directory vanished is reconciled away, never repaired here). */
  projectCredentialDocument(family) {
    const document = credentialDocumentOf(this.credentialDocuments[family]);
    if (!document) return 0;
    let reached = 0;
    for (const lease of this.leases.values()) {
      if (lease.family !== family) continue;
      try {
        writeCredentialDocument(lease.config, document);
        reached += 1;
      } catch { /* best effort: the lease's own reconciliation owns a vanished directory */ }
    }
    return reached;
  }

  remove(workerId) {
    this.leases.delete(workerId);
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
