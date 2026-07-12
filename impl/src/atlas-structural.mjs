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

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
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
    if (!existsSync(artifactPath)) writeFileSync(artifactPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const budgetBytes = ctx.budgetTokens * 4;
    const payload = [];
    for (const change of changes) { if (Buffer.byteLength(JSON.stringify([...payload, change])) > budgetBytes) break; payload.push(change); }
    const parseErrorCount = left.errors.length + right.errors.length;
    const truncated = payload.length < changes.length;
    const status = truncated ? 'needs_resume' : (parseErrorCount > 0 ? 'partial' : 'ok');
    const wallMs = Math.max(0, this.now() - started);
    const result = Object.freeze({
      op, status, summary: `${counts.added} added, ${counts.removed} removed, ${counts.modified} modified${parseErrorCount ? `; ${parseErrorCount} parse errors` : ''}`,
      payload, refs: [{ handle: `art:sha256:${artifactDigest}`, kind: 'structural_delta', digest: artifactDigest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-structural+json', path: artifactPath }],
      ...(truncated ? { cursor: `atlas:${artifactDigest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: `@ast-grep/napi@${AST_GREP_VERSION}` },
      provenance: { tool: `@ast-grep/napi@${AST_GREP_VERSION}`, language, beforeDigest, afterDigest, deterministic: true, parseErrors: { before: left.errors.length, after: right.errors.length }, artifactDigest },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, beforeDigest, afterDigest, artifactDigest, status, wallMs });
    return result;
  }
  async reverify(claim, op, args, ctx) {
    const rerun = await this.invoke(op, args, ctx);
    return Object.freeze({ ok: rerun.provenance.artifactDigest === claim?.provenance?.artifactDigest, observedDigest: rerun.provenance.artifactDigest });
  }
}
