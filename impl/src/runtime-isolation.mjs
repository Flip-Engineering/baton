// Per-worker runtime/config-home isolation. This is an environment and credential boundary, not
// a claim of kernel filesystem/network sandboxing; adapter cards describe those separately.

import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, closeSync, constants as fsConstants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
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

/** Issue #12 (the nested-orchestration rung): the child connection projection a lease is minted
 * under, normalized for the posture. The projection is a POINTER — the profile and the token file
 * INSIDE the worker-private runtime — never the credential: a value carrying `token` refuses
 * outright, and both relative paths must stay inside the runtime root (an absolute path or a `..`
 * escape refuses), so the posture a status surface publishes can never carry a host path or a
 * secret. Absent (null/undefined) means the lease was not minted under a child connection. */
function connectionProjectionOf(value) {
  if (value === null || value === undefined) return null;
  if (!recordValue(value)) throw new TypeError('connectionProjection must be an object');
  if (Object.hasOwn(value, 'token')) {
    throw new TypeError('connectionProjection must never carry a token: it names the credential file (mode 0600 inside the worker-private runtime), never the credential');
  }
  if (value.schemaVersion !== 1) throw new TypeError('connectionProjection.schemaVersion must be 1');
  const fields = {};
  for (const field of ['profile', 'tokenFile', 'url', 'origin']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new TypeError(`connectionProjection.${field} must be a non-empty string`);
    }
    fields[field] = value[field];
  }
  for (const field of ['profile', 'tokenFile']) {
    const relative = fields[field];
    if (isAbsolute(relative) || relative === '..' || relative.startsWith(`..${sep}`)) {
      throw new TypeError(`connectionProjection.${field} must stay inside the worker-private runtime`);
    }
  }
  return Object.freeze({ schemaVersion: 1, ...fields });
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

// Issue #357: the verification guidance the brief carries — the safe baseline comparison
// in one sentence, plus the lane-worktree stash refusal. It lives here (not in the brief
// renderer) so the renderer keeps reading the lane-contract text it already reads.
export const WORKTREE_STASH_BRIEF_SENTENCE = 'Compare a failure against a clean baseline with `git worktree add <scratch-dir> <base>` (or `git show <base>:<path>` for one file) — `git stash` is refused in a lane worktree because the worktrees of one repository share a single `refs/stash` stack.';

// Issue #425: the brief guidance the writer-coupling rule is taught by — the ONE constant the
// native guidance (swarm-native-access.mjs) composes and the projected wrapper embeds in its
// own header, so the rule enforced at the seat's git seam and the sentence every brief teaches
// are one text, never a retyped copy.
export const WORKTREE_WRITER_BRIEF_SENTENCE = 'Every `git commit` in the checkout is attributed to your seat as a `worktree.commit_recorded` row; while another seat holds the declared exclusive `writer` coupling over the checkout, the commit still lands — recorded as a `swarm.coupling_writer_bypassed` bypass naming both seats — so release or take the coupling instead of writing silently.';

// Issue #425: the projected live-writer state, one KEY=VALUE line per field — the flat format
// the wrapper parses with the shell's own read, never a JSON parser in sh. An absent value
// means the checkout names no live exclusive writer (or the seat has no checkout identity yet).
function writeWriterState(target, state) {
  const value = (key) => (state && typeof state[key] === 'string' ? state[key] : '');
  writeFileSync(target, `workspaceId=${value('workspaceId')}\ncouplingId=${value('couplingId')}\nwriter=${value('writer')}\n`, { mode: 0o600 });
}

// Issue #447: the checkout a lease's projected wrapper scopes its commit observations to — one
// KEY=VALUE line in the same flat format the wrapper parses with the shell's own read. Absent
// value: the lease has no recorded checkout yet, and the wrapper keeps the #425 behavior
// (every commit attributed to the seat) rather than dropping a real row; the coordinator
// records the seat's checkout before its process can reach a commit. Rewritten atomically, so
// a wrapper reading it mid-write sees the old identity or the new one, never a torn path.
function writeCheckoutIdentity(target, checkout) {
  const value = normalizedCheckout(checkout);
  const temporary = join(dirname(target), `.${process.pid}.${randomBytes(8).toString('hex')}.checkout.tmp`);
  try {
    writeFileSync(temporary, `checkout=${value ?? ''}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The absolute checkout path a lease can record as its own, or null. */
function normalizedCheckout(checkout) {
  return typeof checkout === 'string' && checkout.length > 0 && isAbsolute(checkout) ? checkout : null;
}

// Issue #357: the typed one-line refusal the projected git wrapper prints on stderr with
// exit 1. It names all three alternatives: a scratch worktree for a clean baseline, git
// show for one file, a wip commit to set work aside.
const STASH_REFUSAL = "baton:stash_refused_in_lane_worktree: 'git stash' is refused in a lane worktree (worktrees of one repository share refs/stash); use 'git worktree add <scratch-dir> <base>' for a clean baseline, 'git show <base>:<path>' for one file, or 'git commit -m wip' to set work aside.";

function shSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Issue #357: resolve the real git binary at wrapper-write time from the host PATH, never
// from inside the projected bin dir (which would self-resolve to the wrapper). Returns the
// canonical absolute path, or null when this machine has no git — the wrapper then falls
// back to a runtime PATH search that excludes its own directory.
function resolveRealGit(searchPath, excludeDir) {
  let excluded = null;
  try {
    excluded = realpathSync(excludeDir);
  } catch {
    excluded = null;
  }
  for (const entry of String(searchPath ?? '').split(':')) {
    if (!entry) continue;
    const candidate = join(entry, 'git');
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, fsConstants.X_OK);
      const canonical = realpathSync(candidate);
      if (excluded !== null && (dirname(canonical) === excluded || canonical.startsWith(excluded + sep))) continue;
      // Issue #520: a projected wrapper (#357) is a shell script answering the name `git`;
      // real git is a binary. A lease created inside a lane seat sees the seat's own
      // wrapper leading PATH — resolving it as the real git would run one wrapper behind
      // another and resurrect the refusal this lease's own wrapper just scoped.
      const head = Buffer.alloc(2);
      const fd = openSync(canonical, 'r');
      try {
        readSync(fd, head, 0, 2, 0);
      } finally {
        closeSync(fd);
      }
      if (head.toString('latin1') === '#!') continue;
      return canonical;
    } catch {
      continue;
    }
  }
  return null;
}

// Issue #357: the projected git wrapper. Refuses 'git stash' — bare 'stash' and every
// subcommand (push/save/pop/apply/drop/list/branch), including behind git's global
// options ('git -C <dir> stash') — for the checkout the lease was installed for (#520
// below), and execs the real git for everything else with argv and env intact.
// Issue #425 adds the writer-coupling observation: every
// successful commit is reported to the lease's spool (the runtime drains it into
// worktree.commit_recorded and, when another seat holds the live writer coupling,
// swarm.coupling_writer_bypassed) — observed, never refused; a failed or no-op commit
// records nothing.
//
// Issue #447: the observation is scoped to the checkout the lease was installed for. The
// wrapper reads that identity from the lease's own file at commit time and compares the
// repository's `git rev-parse --show-toplevel` against it — so a temporary repository a test
// fixture created under the checkout is never attributed to the seat. Another repository is
// NOT refused: the wrapper stays transparent to git.
//
// Issue #520: the stash refusal carries the same checkout scope. The wrapper resolves the
// stash command's own target — the cwd plus every leading -C — and refuses when the
// target's `git rev-parse --show-toplevel` equals the recorded checkout's toplevel, the
// shared refs/stash stack the refusal protects. A stash a test runs against its own
// scratch repository forwards to the real git with argv and env intact. A lease with no
// recorded checkout, an unresolvable target, or an explicit --git-dir keeps the #357
// refusal.
function renderGitWrapper(realGit, writerFile, commitSpool, checkoutFile) {
  return `#!/bin/sh
# Baton lane-worktree git wrapper (issue #357): the worktrees of one repository share a
# single refs/stash stack, so a stash round-trip in one seat can move another seat's
# uncommitted edits. This wrapper refuses stash in the lease's own checkout and forwards
# every other invocation to the real git with argv and env unchanged.
#
# Baton writer-coupling honesty (issue #425): every commit through this wrapper is
# attributed to its seat; a commit made while ANOTHER seat holds the checkout's declared
# exclusive writer coupling is recorded as a bypass — never refused.
#
# Baton checkout scope (issue #447): a commit is attributed only when the repository it was
# made in IS this lease's checkout — the toplevel of the repository the wrapper runs in must
# equal the toplevel of the checkout recorded on this lease. A fixture repository under the
# checkout (or any other repository) spools nothing and is never refused.
#
# Baton stash scope (issue #520): the refusal covers this lease's own checkout only. The
# wrapper resolves the stash target — the cwd plus every leading -C — and refuses when the
# target's "git rev-parse --show-toplevel" equals the recorded checkout's toplevel: the
# shared refs/stash stack is what the refusal protects. A stash a test runs against its
# own scratch repository forwards to the real git with argv and env intact. With no
# recorded checkout, an unresolvable target, or an explicit --git-dir, the wrapper refuses.
# ${WORKTREE_WRITER_BRIEF_SENTENCE}
BATON_REAL_GIT=${shSingleQuote(realGit ?? '')}
BATON_STASH_REFUSAL=${shSingleQuote(STASH_REFUSAL)}
BATON_WRITER_FILE=${shSingleQuote(writerFile ?? '')}
BATON_COMMIT_SPOOL=${shSingleQuote(commitSpool ?? '')}
BATON_CHECKOUT_FILE=${shSingleQuote(checkoutFile ?? '')}
real_git() {
  if [ -n "$BATON_REAL_GIT" ] && [ -x "$BATON_REAL_GIT" ] && [ ! -d "$BATON_REAL_GIT" ]; then
    printf '%s' "$BATON_REAL_GIT";
    return 0;
  fi;
  _selfdir=$(dirname "$0");
  _oldifs=$IFS; IFS=:;
  for _dir in $PATH; do
    [ -z "$_dir" ] && _dir=.;
    case "$_dir" in
      "$_selfdir"|"$_selfdir"/*) ;;
      *) if [ -x "$_dir/git" ] && [ ! -d "$_dir/git" ]; then printf '%s' "$_dir/git"; IFS=$_oldifs; return 0; fi ;;
    esac;
  done;
  IFS=$_oldifs;
  return 1;
}
_baton_observe_commit() {
  _rg=$1;
  [ -n "$BATON_COMMIT_SPOOL" ] || return 0;
  [ -n "$BATON_SWARM_BRIDGE_SWARM_ID" ] || return 0;
  [ -n "$BATON_SWARM_BRIDGE_PARTICIPANT_ID" ] || return 0;
  _own='';
  if [ -n "$BATON_CHECKOUT_FILE" ] && [ -f "$BATON_CHECKOUT_FILE" ]; then
    while IFS='=' read -r _k _v || [ -n "$_k" ]; do
      case "$_k" in
        checkout) _own=$_v ;;
      esac;
    done < "$BATON_CHECKOUT_FILE";
  fi;
  if [ -n "$_own" ]; then
    _here=$("$_rg" rev-parse --show-toplevel 2>/dev/null) || return 0;
    _there=$(cd "$_own" 2>/dev/null && "$_rg" rev-parse --show-toplevel 2>/dev/null) || return 0;
    [ -n "$_here" ] && [ "$_here" = "$_there" ] || return 0;
  fi;
  _sha=$("$_rg" rev-parse HEAD 2>/dev/null) || return 0;
  _ws=''; _cid=''; _w='';
  if [ -f "$BATON_WRITER_FILE" ]; then
    while IFS='=' read -r _k _v || [ -n "$_k" ]; do
      case "$_k" in
        workspaceId) _ws=$_v ;;
        couplingId) _cid=$_v ;;
        writer) _w=$_v ;;
      esac;
    done < "$BATON_WRITER_FILE";
  fi;
  _at=\$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null) || _at='';
  _items='';
  while IFS= read -r _p; do
    [ -n "$_p" ] || continue;
    _esc=\$(printf '%s' "$_p" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g');
    _items="$_items,\\"$_esc\\"";
  done <<EOF
\$("$_rg" diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)
EOF
  _items=\${_items#,};
  printf '{"kind":"commit","swarmId":"%s","participantId":"%s","workspaceId":"%s","couplingId":"%s","writer":"%s","sha":"%s","at":"%s","paths":[%s]}\\n' \\
    "$BATON_SWARM_BRIDGE_SWARM_ID" "$BATON_SWARM_BRIDGE_PARTICIPANT_ID" \\
    "$_ws" "$_cid" "$_w" "$_sha" "$_at" "$_items" >> "$BATON_COMMIT_SPOOL" 2>/dev/null || true;
  return 0;
}
_cmd=""; _skip=0; _pending=''; _gitdir=''; _target=$PWD;
_baton_chdir() {
  case "$1" in
    /*) _cand=$1 ;;
    *) _cand="$_target/$1" ;;
  esac;
  _cand=$(cd "$_cand" 2>/dev/null && pwd -P) || _cand='';
  _target=$_cand;
}
for _arg in "$@"; do
  if [ "$_skip" = "1" ]; then
    _skip=0;
    if [ -n "$_pending" ]; then _pending=''; _baton_chdir "$_arg"; fi;
    continue;
  fi;
  case "$_arg" in
    -C) _pending=1; _skip=1 ;;
    -C?*) _baton_chdir "\${_arg#-C}" ;;
    -c) _skip=1 ;;
    -c?*) ;;
    --git-dir) _gitdir=1; _skip=1 ;;
    --git-dir=*) _gitdir=1 ;;
    --work-tree) _skip=1 ;;
    --namespace) _skip=1 ;;
    --) _cmd=""; break ;;
    -*) ;;
    *) _cmd="$_arg"; break ;;
  esac;
done;
if [ "$_cmd" = "stash" ]; then
  _refuse=1;
  _own='';
  if [ -n "$BATON_CHECKOUT_FILE" ] && [ -f "$BATON_CHECKOUT_FILE" ]; then
    while IFS='=' read -r _k _v || [ -n "$_k" ]; do
      case "$_k" in
        checkout) _own=$_v ;;
      esac;
    done < "$BATON_CHECKOUT_FILE";
  fi;
  if [ -n "$_own" ] && [ -n "$_target" ] && [ -z "$_gitdir" ]; then
    _real=$(real_git) || _real='';
    if [ -n "$_real" ]; then
      _here='';
      _here=$(cd "$_target" 2>/dev/null && "$_real" rev-parse --show-toplevel 2>/dev/null) || _here='';
      _there=$(cd "$_own" 2>/dev/null && "$_real" rev-parse --show-toplevel 2>/dev/null) || _there='';
      if [ -n "$_here" ] && [ -n "$_there" ] && [ "$_here" != "$_there" ]; then _refuse=0; fi;
    fi;
  fi;
  if [ "$_refuse" = "1" ]; then printf '%s\\n' "$BATON_STASH_REFUSAL" >&2; exit 1; fi;
fi;
_real=$(real_git) || { echo "baton:git_unavailable_in_lane_runtime: no real git outside the projected bin dir" >&2; exit 127; };
if [ "$_cmd" = "commit" ]; then
  "$_real" "$@";
  _rc=$?;
  [ "$_rc" -eq 0 ] || exit "$_rc";
  _baton_observe_commit "$_real";
  exit 0;
fi;
exec "$_real" "$@"
`;
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

  create(workerId, selection, opts = {}) {
    const { family, surface, authPosture, adapterCredentialState } = runtimeIdentity(selection);
    const root = privateDir(join(this.root, workerId));
    const home = privateDir(join(root, 'home'));
    const tmp = privateDir(join(root, 'tmp'));
    // Issue #357: the seat's private runtime PATH leads with a bin dir holding a git
    // wrapper that refuses `git stash` in the lease's own checkout (lane worktrees of one
    // repository share a single refs/stash stack; #520 scopes the refusal to that
    // checkout) and forwards everything else to the real git — resolved and pinned here,
    // at lease creation, never looked up by the seat.
    const bin = privateDir(join(root, 'bin'));
    const wrapperPath = join(bin, 'git');
    // Issue #425: the checkout's live-writer projection and the commit spool live on the
    // private lease. The wrapper embeds their absolute paths at write time; the runtime (the
    // ONE component that folds coupling events) rewrites the projection on every coupling
    // change and binding, and drains the spool into the durable rows — the seat itself only
    // ever appends observations to the spool. Issue #447 adds the checkout identity, the ONE
    // repository the wrapper spools observations for: the deployment records the seat's own
    // checkout here the moment it confirms it (projectCheckout below).
    const writerFile = join(root, 'writer-coupling.env');
    const commitSpool = join(root, 'worktree-commits.jsonl');
    const checkoutFile = join(root, 'checkout-identity.env');
    writeFileSync(wrapperPath, renderGitWrapper(
      resolveRealGit(this.baseEnv.PATH ?? process.env.PATH, bin), writerFile, commitSpool, checkoutFile), { mode: 0o700 });
    chmodSync(wrapperPath, 0o700);
    writeWriterState(writerFile, null);
    writeCheckoutIdentity(checkoutFile, normalizedCheckout(recordValue(selection) ? selection.checkout : null));
    // Grok's native sandbox grants its expected ~/.grok tree, not an arbitrary GROK_HOME outside
    // HOME. Keep HOME private and place the projected config at that vendor-native path.
    const config = privateDir(surface === 'grok' ? join(home, '.grok') : join(root, 'config', family));
    // #346: the lease is registered BEFORE any credential is written, so a refresh that lands
    // between the two writes re-projects into this lease rather than skipping it.
    this.leases.set(workerId, Object.freeze({ family, surface, config, writerFile, commitSpool, checkoutFile }));
    const connectionProjection = connectionProjectionOf(recordValue(opts) ? opts.connectionProjection : null);
    const env = {};
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value === undefined) continue;
      if ((SECRET_NAME.test(key) || PROVIDER_OR_INJECTION.test(key)) && !this.keepEnv.has(key)) continue;
      env[key] = value;
    }
    env.HOME = home;
    env.TMPDIR = tmp;
    // Issue #357: the projected wrapper answers `git` for the seat. The coordinator's
    // runtime.scope_created payload carries the wrapper record on the posture (below),
    // which stays path-free — the bin path itself rides `paths`, never the posture.
    env.PATH = typeof env.PATH === 'string' && env.PATH.length > 0
      ? `${bin}${delimiter}${env.PATH}`
      : `${bin}${delimiter}/usr/bin${delimiter}/bin`;
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CODEX_HOME;
    delete env.GROK_HOME;
    delete env.KIMI_CODE_HOME;
    // Issue #12 (the nested-orchestration rung): the child runtime never inherits the
    // orchestrator's XDG_CONFIG_HOME. The connection discovery contract resolves a connection
    // profile from that variable when it is set, so an inherited value would make the child read
    // the PARENT's connection profile instead of the projection minted for it. A surface whose
    // own resolution needs the variable (muse, below) sets it explicitly, after this delete.
    delete env.XDG_CONFIG_HOME;
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
      paths: Object.freeze({ root, home, tmp, config, bin, writerFile, commitSpool, checkoutFile }),
      posture: Object.freeze({
        schemaVersion: 1,
        family,
        authPosture,
        credential: Object.freeze({
          mechanism: credentialMechanism,
          state: credentialCount > 0 ? 'materialized' : 'absent',
          count: credentialCount,
        }),
        // Issue #357: the refusing git wrapper, recorded path-free — the mechanism and the
        // refused subcommand only. The coordinator maps this posture onto
        // runtime.scope_created, so the record of the wrapper rides that event.
        git: Object.freeze({ mechanism: 'wrapper', refuses: Object.freeze(['stash']) }),
        permissions: Object.freeze({ directories: '0700', credentialFiles: '0600' }),
        // Issue #12 (the nested-orchestration rung): a child lease minted under a connection
        // projection PUBLISHES that projection on the posture, so status/debug surfaces can
        // attest which profile the runtime was minted under. The projection names the profile
        // and its 0600 token file RELATIVE to the worker-private runtime; it never carries the
        // token (connectionProjectionOf refuses one), and never a host path.
        ...(connectionProjection === null ? {} : { connectionProjection }),
        sandboxPolicy: 'full-access-private-runtime-only',
        active: true,
      }),
    };
  }
  /** Issue #425: project the checkout's live exclusive writer for one lease. The runtime —
   * the ONE component that folds coupling events — calls this inside the same synchronous
   * apply path that appended the coupling change (and again at every binding), so the file
   * the projected wrapper reads at commit time cannot go stale: a bridge query would make
   * every commit a network round trip, put the bridge credential at the wrapper layer, and
   * fail exactly when the resident is down, while this file sits on the lease already and
   * is rewritten before the mutating answer ever returns. Absent state names no writer. */
  projectWriterCoupling(workerId, state) {
    const lease = this.leases.get(workerId);
    if (!lease) return false;
    try {
      writeWriterState(lease.writerFile, state);
      return true;
    } catch { return false; /* the lease's own reconciliation owns a vanished directory */ }
  }

  /** Issue #447: record the seat's own checkout on the lease — the ONE repository its projected
   * wrapper spools commit observations for. The coordinator calls this the moment it confirms
   * the checkout a seat works in (a minted lane worktree, a resumed or attached one), so a
   * commit made in any other repository — a test fixture's temporary repository under it, a
   * nested clone, a hand-made worktree — is observed by nobody and refused by nobody. A lease
   * with no recorded checkout keeps the #425 behavior: its commits are attributed to its seat. */
  projectCheckout(workerId, checkout) {
    const lease = this.leases.get(workerId);
    const value = normalizedCheckout(checkout);
    if (!lease || value === null) return false;
    try {
      writeCheckoutIdentity(lease.checkoutFile, value);
      return true;
    } catch { return false; /* the lease's own reconciliation owns a vanished directory */ }
  }

  /** Issue #425: drain the commit observations the projected wrapper spooled (one JSON line
   * per successful commit, carrying what the writer projection said at commit time). The
   * spool is truncated as it is read — the runtime composes the durable rows, and a torn
   * line is dropped, never replayed. */
  takeCommitObservations() {
    const observations = [];
    for (const [workerId, lease] of this.leases.entries()) {
      let raw = '';
      try { raw = readFileSync(lease.commitSpool, 'utf8'); } catch { continue; }
      if (raw.length === 0) continue;
      try { truncateSync(lease.commitSpool, 0); } catch { /* a vanished lease reconciles elsewhere */ }
      for (const line of raw.split('\n')) {
        if (line.trim().length === 0) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.sha === 'string') {
            observations.push(Object.freeze({ ...parsed, workerId }));
          }
        } catch { /* a torn line is dropped */ }
      }
    }
    return observations;
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
