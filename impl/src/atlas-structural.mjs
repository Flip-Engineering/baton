import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Lang, parse } from '@ast-grep/napi';

const require = createRequire(import.meta.url);
const AST_GREP_VERSION = require('@ast-grep/napi/package.json').version;
const LANGUAGE = Object.freeze({
  javascript: Lang.JavaScript, js: Lang.JavaScript, jsx: Lang.JavaScript,
  typescript: Lang.TypeScript, ts: Lang.TypeScript, tsx: Lang.Tsx,
  html: Lang.Html, css: Lang.Css,
});
const EXTENSION = Object.freeze({ '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx', '.html': 'html', '.htm': 'html', '.css': 'css' });
const UNIT_KINDS = new Set([
  'function_declaration', 'function_definition', 'generator_function_declaration', 'class_declaration',
  'class_definition', 'method_definition', 'method_signature', 'lexical_declaration',
  'variable_declaration', 'import_statement', 'export_statement', 'interface_declaration',
  'type_alias_declaration', 'enum_declaration', 'namespace_declaration',
]);
const CHANGE_ORDER = Object.freeze({ removed: 0, modified: 1, added: 2 });
const PRIMARY_KIND = 'structural_delta';
const PRIMARY_MEDIA_TYPE = 'application/vnd.baton.atlas-structural+json';

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function typed(message, code = 'artifact_integrity') { return Object.assign(new Error(message), { code }); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function primaryRefProjection(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const projection = { handle: ref.handle, kind: ref.kind, digest: ref.digest, bytes: ref.bytes, mediaType: ref.mediaType };
  return typeof projection.handle === 'string' && projection.kind === PRIMARY_KIND
    && /^[a-f0-9]{64}$/u.test(projection.digest ?? '') && Number.isSafeInteger(projection.bytes) && projection.bytes > 0
    && projection.mediaType === PRIMARY_MEDIA_TYPE ? projection : null;
}
function stableRefProjection(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const projection = { handle: ref.handle, kind: ref.kind, digest: ref.digest, bytes: ref.bytes, mediaType: ref.mediaType };
  return typeof projection.handle === 'string' && typeof projection.kind === 'string'
    && /^[a-f0-9]{64}$/u.test(projection.digest ?? '') && Number.isSafeInteger(projection.bytes) && projection.bytes > 0
    && typeof projection.mediaType === 'string' ? projection : null;
}
function stableResultProjection(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.refs) || !result.cost || typeof result.cost !== 'object') return null;
  const refs = result.refs.map(stableRefProjection);
  if (refs.some((ref) => ref === null)) return null;
  const { wall_ms: _volatileWallMs, ...cost } = result.cost;
  const { refs: _refs, cost: _cost, ...rest } = result;
  return { ...rest, refs, cost };
}
function reverifyBudget(claim, ctx) {
  const claimed = claim?.cost?.tokens_out;
  return Number.isSafeInteger(claimed) && claimed > 0 && claimed <= ctx.budgetTokens ? claimed : ctx.budgetTokens;
}
function validateStructuralArtifact(artifact) {
  const fields = ['after', 'before', 'changes', 'counts', 'language', 'op', 'schemaVersion'];
  const side = (value) => value && Object.keys(value).sort().join(',') === ['digest', 'parseErrors', 'path'].sort().join(',')
    && typeof value.path === 'string' && /^[a-f0-9]{64}$/u.test(value.digest ?? '') && Array.isArray(value.parseErrors);
  const counts = artifact?.counts;
  if (!artifact || Object.keys(artifact).sort().join(',') !== fields.sort().join(',') || artifact.schemaVersion !== 1
    || artifact.op !== 'diff.structural' || !Object.hasOwn(LANGUAGE, artifact.language)
    || !side(artifact.before) || !side(artifact.after) || !Array.isArray(artifact.changes)
    || !counts || Object.keys(counts).sort().join(',') !== ['added', 'modified', 'removed'].sort().join(',')
    || Object.values(counts).some((value) => !Number.isSafeInteger(value) || value < 0)
    || counts.added + counts.removed + counts.modified !== artifact.changes.length) {
    throw typed('structural artifact schema mismatch');
  }
  return artifact;
}
function loadStructuralArtifact(root, ref) {
  const projected = primaryRefProjection(ref);
  if (!projected || projected.handle !== `art:sha256:${projected.digest}`) throw typed('structural artifact reference malformed');
  let artifactRoot; let path;
  try { artifactRoot = realpathSync(root); path = realpathSync(ref.path); } catch { throw typed('structural artifact unavailable'); }
  if (path !== join(artifactRoot, `${projected.digest}.json`)) throw typed('structural artifact escape');
  const bytes = readFileSync(path);
  if (bytes.length !== projected.bytes || sha(bytes) !== projected.digest) throw typed('structural artifact digest mismatch');
  let artifact;
  try { artifact = JSON.parse(bytes); } catch { throw typed('structural artifact JSON invalid'); }
  return { artifact: validateStructuralArtifact(artifact), ref: projected };
}
function pos(range) { return { start: { line: range.start.line + 1, column: range.start.column + 1 }, end: { line: range.end.line + 1, column: range.end.column + 1 } }; }
function safePath(root, path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) throw Object.assign(new Error('source path must be relative'), { code: 'path_escape' });
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, path);
  const rel = relative(realRoot, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Object.assign(new Error('source path escapes root'), { code: 'path_escape' });
  const real = realpathSync(candidate);
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) throw Object.assign(new Error('source symlink escapes root'), { code: 'path_escape' });
  if (!lstatSync(real).isFile()) throw Object.assign(new Error('source is not a file'), { code: 'invalid_source' });
  return real;
}
function fingerprint(node) {
  if (node.kind() === 'comment' || node.kind() === ';') return '';
  const children = node.children().filter((child) => child.kind() !== 'comment');
  if (children.length === 0) return `${node.kind()}:${JSON.stringify(node.text())}`;
  return `${node.kind()}(${children.map(fingerprint).filter(Boolean).join(',')})`;
}
function firstName(node) {
  try { const named = node.field('name'); if (named) return named.text(); } catch { /* grammar lacks name */ }
  const wanted = new Set(['identifier', 'property_identifier', 'type_identifier']);
  const queue = [...node.children()];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (wanted.has(candidate.kind())) return candidate.text();
    queue.push(...candidate.children());
  }
  return null;
}
function parseUnits(language, source) {
  const root = parse(LANGUAGE[language], source).root();
  const units = []; const errors = []; const occurrences = new Map();
  function visit(node, containers = []) {
    if (node.kind() === 'ERROR') errors.push(pos(node.range()));
    const selected = UNIT_KINDS.has(node.kind());
    const name = selected ? firstName(node) : null;
    const container = containers.join('::');
    if (selected) {
      const anonymous = name ?? '<anonymous>';
      const base = `${container}/${node.kind()}:${anonymous}`;
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      units.push({
        id: `${base}#${occurrence}`, kind: node.kind(), name: anonymous,
        container: container || null, range: pos(node.range()), fingerprint: sha(fingerprint(node)),
      });
    }
    const nextContainers = selected && ['class_declaration', 'class_definition', 'interface_declaration', 'namespace_declaration'].includes(node.kind())
      ? [...containers, name ?? '<anonymous>'] : containers;
    for (const child of node.children()) if (child.isNamed()) visit(child, nextContainers);
  }
  visit(root);
  return { units, errors };
}
function delta(before, after) {
  const left = new Map(before.map((unit) => [unit.id, unit]));
  const right = new Map(after.map((unit) => [unit.id, unit]));
  const changes = [];
  for (const [id, unit] of left) {
    const current = right.get(id);
    if (!current) changes.push({ change: 'removed', id, kind: unit.kind, name: unit.name, container: unit.container, beforeRange: unit.range, beforeFingerprint: unit.fingerprint, afterRange: null, afterFingerprint: null });
    else if (current.fingerprint !== unit.fingerprint) changes.push({ change: 'modified', id, kind: unit.kind, name: unit.name, container: unit.container, beforeRange: unit.range, afterRange: current.range, beforeFingerprint: unit.fingerprint, afterFingerprint: current.fingerprint });
  }
  for (const [id, unit] of right) if (!left.has(id)) changes.push({ change: 'added', id, kind: unit.kind, name: unit.name, container: unit.container, beforeRange: null, beforeFingerprint: null, afterRange: unit.range, afterFingerprint: unit.fingerprint });
  return changes.sort((a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] || a.id.localeCompare(b.id) || (a.beforeRange?.start.line ?? a.afterRange.start.line) - (b.beforeRange?.start.line ?? b.afterRange.start.line));
}

export class AtlasStructuralDelta {
  constructor(opts = {}) {
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('Atlas artifactRoot required');
    this.artifactRoot = opts.artifactRoot;
    this.maxSourceBytes = opts.maxSourceBytes ?? 2 * 1024 * 1024;
    this.now = opts.now ?? Date.now;
    this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }
  card() {
    return Object.freeze({
      name: 'atlas-structural', version: '0.1.0', underlying: [`@ast-grep/napi@${AST_GREP_VERSION}`],
      ops: { 'diff.structural': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true } },
      languages: Object.keys(LANGUAGE), shared_state: { artifacts: 'content-addressed' }, sandbox_required: 'read_only_worktrees', cost_model: 'cpu_bound_local',
      limitations: ['no move/rename matching', 'no semantic equivalence', 'no base-overlay index', 'no SCIP/CPG/IR'],
    });
  }
  async invoke(op, args, ctx) {
    if (op !== 'diff.structural') throw Object.assign(new Error(`unsupported Atlas op ${op}`), { code: 'unsupported_op' });
    if (!ctx || !ctx.beforeRoot || !ctx.afterRoot || !Number.isInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('Atlas roots and positive budgetTokens required');
    const started = this.now();
    const beforePath = safePath(ctx.beforeRoot, args.beforePath);
    const afterPath = safePath(ctx.afterRoot, args.afterPath);
    const language = String(args.language ?? EXTENSION[extname(args.afterPath).toLowerCase()] ?? EXTENSION[extname(args.beforePath).toLowerCase()] ?? '').toLowerCase();
    if (!LANGUAGE[language]) throw Object.assign(new Error(`unsupported Atlas language ${language}`), { code: 'unsupported_language' });
    const before = readFileSync(beforePath);
    const after = readFileSync(afterPath);
    if (before.includes(0) || after.includes(0) || before.length > this.maxSourceBytes || after.length > this.maxSourceBytes) throw Object.assign(new Error('source is binary or exceeds Atlas limit'), { code: 'invalid_source' });
    const beforeText = before.toString('utf8'); const afterText = after.toString('utf8');
    const beforeDigest = sha(before); const afterDigest = sha(after);
    this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, beforeDigest, afterDigest });
    const left = parseUnits(language, beforeText); const right = parseUnits(language, afterText);
    const changes = delta(left.units, right.units);
    const counts = { added: changes.filter((item) => item.change === 'added').length, removed: changes.filter((item) => item.change === 'removed').length, modified: changes.filter((item) => item.change === 'modified').length };
    const complete = { schemaVersion: 1, op, language, before: { path: args.beforePath, digest: beforeDigest, parseErrors: left.errors }, after: { path: args.afterPath, digest: afterDigest, parseErrors: right.errors }, counts, changes };
    const serialized = `${JSON.stringify(complete)}\n`; const artifactDigest = sha(serialized);
    const artifactPath = join(this.artifactRoot, `${artifactDigest}.json`);
    const primaryRef = { handle: `art:sha256:${artifactDigest}`, kind: PRIMARY_KIND, digest: artifactDigest, bytes: Buffer.byteLength(serialized), mediaType: PRIMARY_MEDIA_TYPE, path: artifactPath };
    if (!existsSync(artifactPath)) writeFileSync(artifactPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    loadStructuralArtifact(this.artifactRoot, primaryRef);
    const budgetBytes = ctx.budgetTokens * 4;
    const payload = [];
    for (const change of changes) { if (Buffer.byteLength(JSON.stringify([...payload, change])) > budgetBytes) break; payload.push(change); }
    const parseErrorCount = left.errors.length + right.errors.length;
    const truncated = payload.length < changes.length;
    const status = parseErrorCount > 0 ? 'partial' : (truncated ? 'needs_resume' : 'ok');
    const wallMs = Math.max(0, this.now() - started);
    const result = Object.freeze({
      op, status, summary: `${counts.added} added, ${counts.removed} removed, ${counts.modified} modified${parseErrorCount ? `; ${parseErrorCount} parse errors` : ''}`,
      payload, refs: [primaryRef],
      ...(status === 'needs_resume' ? { cursor: `atlas:${artifactDigest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: `@ast-grep/napi@${AST_GREP_VERSION}` },
      provenance: { tool: `@ast-grep/napi@${AST_GREP_VERSION}`, language, beforeDigest, afterDigest, deterministic: true, parseErrors: { before: left.errors.length, after: right.errors.length }, artifactDigest },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, beforeDigest, afterDigest, artifactDigest, status, wallMs });
    return result;
  }
  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    const match = /^atlas:([a-f0-9]{64}):(\d+)$/u.exec(cursor ?? '');
    if (!match || match[1] !== ref?.digest) throw typed('invalid structural cursor', 'invalid_cursor');
    const loaded = loadStructuralArtifact(this.artifactRoot, ref); const items = loaded.artifact.changes;
    const offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw typed('invalid structural cursor offset', 'invalid_cursor');
    const payload = [];
    for (const change of items.slice(offset)) { if (Buffer.byteLength(JSON.stringify([...payload, change])) > ctx.budgetTokens * 4) break; payload.push(change); }
    const next = offset + payload.length; const truncated = next < items.length;
    const parseErrorCount = loaded.artifact.before.parseErrors.length + loaded.artifact.after.parseErrors.length;
    const status = parseErrorCount > 0 ? 'partial' : (truncated ? 'needs_resume' : 'ok');
    return Object.freeze({
      op: 'diff.structural', status, summary: `resumed ${payload.length} structural delta records`, payload, refs: [{ ...loaded.ref, path: ref.path }],
      ...(status === 'needs_resume' ? { cursor: `atlas:${ref.digest}:${next}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `@ast-grep/napi@${AST_GREP_VERSION}` },
      provenance: { artifactDigest: ref.digest, resumed_from: offset, deterministic: true },
    });
  }
  async reverify(claim, op, args, ctx) {
    const rerun = await this.invoke(op, args, { ...ctx, budgetTokens: reverifyBudget(claim, ctx) });
    const primaryRefs = Array.isArray(claim?.refs) ? claim.refs.filter((ref) => ref?.kind === PRIMARY_KIND) : [];
    const observed = loadStructuralArtifact(this.artifactRoot, rerun.refs[0]);
    const resultProjection = stableResultProjection(rerun); const claimProjection = stableResultProjection(claim);
    const resultProjectionDigest = resultProjection ? sha(stable(resultProjection)) : null;
    const ok = primaryRefs.length === 1 && primaryRefProjection(primaryRefs[0]) !== null
      && stable(primaryRefProjection(primaryRefs[0])) === stable(observed.ref)
      && claim?.provenance?.artifactDigest === observed.ref.digest
      && resultProjection !== null && claimProjection !== null && stable(resultProjection) === stable(claimProjection);
    return Object.freeze({ ok, primaryRef: observed.ref, resultProjection, resultProjectionDigest, observedDigest: observed.ref.digest });
  }
}
