// Issue #99/#179 — the result-materialization accessor (`run.resultpin`).
// Pure, additive helpers for the facade direct port (harvest-accessor contract v1.1,
// docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md,
// Decisions 1-2 + 6). Everything here is count- and byte-bounded and byte-wise sorted. The kernel
// lanes (worktree.mjs structured integration, index.mjs worktrees wrappers, coordinator
// preservation) are consumers, never dependents.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FRAME_LIMITS } from './limits.mjs';

// v1 is sha1-only: the delta lane (changedPathsAtCommit) is 40-hex-only, so the accessor's
// shape gates refuse 64-hex shas rather than degrading to an unmapped kernel code (Decision 6).
export const SHA1_HEX = /^[a-f0-9]{40}$/u;
export const RESULT_REF_ROOT = 'refs/baton/results/';
// The serialized changedFiles page ceiling (#89 doctrine: cap + graceful spill) — Decision 6.
export const CHANGED_FILES_PAGE_BYTES = FRAME_LIMITS['view.resultpin.page'].value;

/** One typed accessor refusal. Every refusal carries a string .code — no bare TypeError. */
export function typedError(message, code, detail = null) {
  return Object.assign(new Error(message), { code, ...(detail == null ? {} : { detail }) });
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Closed `{runId}` shape — refuses BEFORE any state lookup or authorization (HA-01). */
export function validateResultPinArgs(args) {
  if (!isPlainObject(args)) throw typedError('run.resultpin args are invalid', 'application_run_resultpin_invalid');
  for (const key of Object.keys(args)) {
    if (key !== 'runId') throw typedError(`run.resultpin carries undeclared field ${key}`, 'application_run_resultpin_invalid');
  }
  if (typeof args.runId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(args.runId)) {
    throw typedError('run.resultpin requires one valid runId', 'application_run_resultpin_invalid');
  }
  return { runId: args.runId };
}



/** The content-addressed ownership ref for one result sha (coordination-store ref law). */
export function resultRefOf(sha) { return `${RESULT_REF_ROOT}${sha}`; }

/**
 * The physical pin verification BOTH lanes share (contract Decision 2): the single-ref
 * re-verification lane is authoritative. Absent lane → `unverifiable`; missing ref →
 * `missing`; ref resolving elsewhere → `mismatch`; resolved-to-the-sha → `pinned`.
 */
export async function verifyPin(worktrees, ref, expectedSha) {
  if (!worktrees || typeof worktrees.resolveResult !== 'function') return 'unverifiable';
  let resolved;
  try { resolved = await worktrees.resolveResult(ref); } catch { return 'unverifiable'; }
  if (resolved === null || resolved === undefined) return 'missing';
  if (resolved !== expectedSha) return 'mismatch';
  return 'pinned';
}

function git(repoRoot, args, opts = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function gitOk(repoRoot, args) {
  try {
    execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/** The ancestry consistency gate: the recorded base must be an ancestor of the pin. */
export function isAncestor(repoRoot, baseSha, sha) {
  return typeof baseSha === 'string' && typeof sha === 'string' && gitOk(repoRoot, ['merge-base', '--is-ancestor', baseSha, sha]);
}


/**
 * One bounded changedFiles page over the recorded delta (Decision 1/6): closed
 * `{blob, digest, mode, path, size}` rows for exactly the changed paths, byte-wise path
 * order, sha256 content digests read in ONE `git cat-file --batch` process, serialized
 * total ≤ 256 KiB — an oversize page truncates with a full-set digest and a cursor.
 */
export function changedFilesPage(repoRoot, resultSha, changedPaths) {
  const wanted = new Set(changedPaths);
  const rows = [];
  for (const entry of git(repoRoot, ['ls-tree', '-z', '-r', '-l', resultSha]).split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const [mode, type, blob, sizeRaw] = entry.slice(0, tab).trim().split(/\s+/u);
    const path = entry.slice(tab + 1);
    if (!wanted.has(path) || type !== 'blob' || (mode !== '100644' && mode !== '100755')) continue;
    const size = Number(sizeRaw);
    if (!Number.isSafeInteger(size) || size < 0) continue;
    rows.push({ path, blob, mode, size });
  }
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const ordered = changedPaths.map((path) => byPath.get(path)).filter(Boolean);
  const digests = blobContentDigests(repoRoot, ordered.map((row) => row.blob));
  const full = ordered.map((row) => ({
    blob: row.blob, digest: digests.get(row.blob), mode: row.mode, path: row.path, size: row.size,
  }));
  const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value));
  const changedFiles = [];
  let bytes = 0;
  for (const row of full) {
    const encoded = Buffer.byteLength(JSON.stringify(row));
    if (bytes + encoded > CHANGED_FILES_PAGE_BYTES) break;
    changedFiles.push(row);
    bytes += encoded;
  }
  const truncated = changedFiles.length < full.length;
  return {
    changedFiles,
    truncated,
    ...(truncated ? {
      changedFilesDigest: createHash('sha256').update(JSON.stringify(canonical(full))).digest('hex'),
      cursor: changedFiles.length,
    } : {}),
  };
}

/** sha256 content digests for N blobs in one `git cat-file --batch` process (row-git-batch law). */
function blobContentDigests(repoRoot, oids) {
  const map = new Map();
  if (oids.length === 0) return map;
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input: Buffer.from(`${oids.join('\n')}\n`, 'utf8'),
    maxBuffer: 1024 * 1024 * 1024,
  });
  let off = 0;
  for (const oid of oids) {
    const nl = out.indexOf(0x0A, off);
    if (nl === -1) break;
    const header = out.slice(off, nl).toString('utf8');
    off = nl + 1;
    const parts = header.split(' ');
    if (parts.length < 3 || parts[2] === 'missing') { map.set(oid, null); continue; }
    const size = Number(parts[2]);
    if (!Number.isSafeInteger(size) || size < 0 || off + size > out.length) { map.set(oid, null); continue; }
    map.set(oid, createHash('sha256').update(out.slice(off, off + size)).digest('hex'));
    off += size + 1;
  }
  return map;
}
