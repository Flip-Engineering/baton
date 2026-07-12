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
const EXTENSION = Object.freeze({
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.html': 'html', '.htm': 'html', '.css': 'css',
});

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function typed(message, code) { return Object.assign(new Error(message), { code }); }
function position(node) {
  const value = node.range();
  return { start: { line: value.start.line + 1, column: value.start.column + 1 }, end: { line: value.end.line + 1, column: value.end.column + 1 } };
}
function checkAbort(ctx) { if (ctx?.signal?.aborted) throw typed('Atlas structural operation cancelled', 'cancelled'); }
function safeFile(root, path) {
  if (typeof root !== 'string' || root.length === 0) throw typed('Atlas root required', 'invalid_root');
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) throw typed('source path must be relative', 'path_escape');
  let realRoot;
  try { realRoot = realpathSync(root); } catch { throw typed('Atlas root unavailable', 'invalid_root'); }
  if (!lstatSync(realRoot).isDirectory()) throw typed('Atlas root must be a directory', 'invalid_root');
  const candidate = resolve(realRoot, path);
  const rel = relative(realRoot, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw typed('source path escapes root', 'path_escape');
  let real;
  try { real = realpathSync(candidate); } catch { throw typed('source is unavailable', 'invalid_source'); }
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) throw typed('source symlink escapes root', 'path_escape');
  if (!lstatSync(real).isFile()) throw typed('source is not a regular file', 'invalid_source');
  return real;
}
function collectErrors(root) {
  const errors = [];
  function visit(node) {
    if (node.kind() === 'ERROR') errors.push(position(node));
    for (const child of node.children()) if (child.isNamed()) visit(child);
  }
  visit(root);
  return errors;
}
function capturesIn(pattern) {
  const names = new Map();
  const re = /\$\$\$([A-Z][A-Z0-9_]*)|\$([A-Z][A-Z0-9_]*)/g;
  for (const match of pattern.matchAll(re)) names.set(match[1] ?? match[2], match[1] ? 'multiple' : 'single');
  return names;
}
function captureRecord(node, names) {
  const result = {};
  for (const [name, cardinality] of names) {
    if (cardinality === 'multiple') {
      result[name] = node.getMultipleMatches(name).map((match) => ({ text: match.text(), textDigest: sha(match.text()), range: position(match) }));
    } else {
      const match = node.getMatch(name);
      if (match) result[name] = { text: match.text(), textDigest: sha(match.text()), range: position(match) };
    }
  }
  return result;
}
function renderReplacement(template, node, sourceBytes) {
  return template.replace(/\$\$\$([A-Z][A-Z0-9_]*)|\$([A-Z][A-Z0-9_]*)/g, (_token, multiple, single) => {
    const name = multiple ?? single;
    if (multiple) {
      const matches = node.getMultipleMatches(name);
      if (matches.length === 0) return '';
      const first = matches[0].range(); const last = matches.at(-1).range();
      return sourceBytes.subarray(first.start.index, last.end.index).toString('utf8');
    }
    const match = node.getMatch(name);
    if (!match) throw typed(`replacement references missing metavariable ${name}`, 'missing_metavariable');
    return match.text();
  });
}
function bounded(items, budgetTokens) {
  const budgetBytes = budgetTokens * 4;
  const payload = [];
  for (const item of items) {
    if (Buffer.byteLength(JSON.stringify([...payload, item])) > budgetBytes) break;
    payload.push(item);
  }
  return payload;
}

export class AtlasStructuralRewrite {
  constructor(opts = {}) {
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('Atlas artifactRoot required');
    if (!Number.isSafeInteger(opts.maxSourceBytes) || opts.maxSourceBytes <= 0) throw new TypeError('Atlas maxSourceBytes must be a deployment-derived positive safe integer');
    if (!Number.isSafeInteger(opts.maxArtifactBytes) || opts.maxArtifactBytes <= 0) throw new TypeError('Atlas maxArtifactBytes must be a deployment-derived positive safe integer');
    this.artifactRoot = opts.artifactRoot;
    this.maxSourceBytes = opts.maxSourceBytes;
    this.maxArtifactBytes = opts.maxArtifactBytes;
    this.record = opts.record ?? null;
    this.now = opts.now ?? Date.now;
    mkdirSync(join(this.artifactRoot, 'manifests'), { recursive: true, mode: 0o700 });
    mkdirSync(join(this.artifactRoot, 'sources'), { recursive: true, mode: 0o700 });
  }

  card() {
    return Object.freeze({
      name: 'atlas-structural-rewrite', version: '0.1.0', underlying: [`@ast-grep/napi@${AST_GREP_VERSION}`],
      ops: {
        'search.structural': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'rewrite.structural': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_proposal_artifacts_only', reverifiable: true },
      },
      languages: Object.keys(LANGUAGE), sandbox_required: 'read_only_worktree', cost_model: 'cpu_bound_local',
      limitations: ['pattern matcher only; no full rule-config surface', 'replacement formatting is ast-grep edit output', 'no direct worktree apply authority', 'no CPG/IR/semantic equivalence'],
    });
  }

  _writeArtifact(directory, digest, extension, content) {
    const path = join(this.artifactRoot, directory, `${digest}.${extension}`);
    if (existsSync(path)) {
      if (sha(readFileSync(path)) !== digest) throw typed('existing Atlas artifact failed integrity', 'artifact_integrity');
      return path;
    }
    writeFileSync(path, content, { mode: 0o600, flag: 'wx' });
    return path;
  }

  async invoke(op, args, ctx) {
    if (!['search.structural', 'rewrite.structural'].includes(op)) throw typed(`unsupported Atlas op ${op}`, 'unsupported_op');
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    if (!args || typeof args.pattern !== 'string' || args.pattern.length === 0) throw typed('non-empty structural pattern required', 'invalid_pattern');
    if (op === 'rewrite.structural' && (typeof args.replacement !== 'string' || args.replacement.length === 0)) throw typed('non-empty structural replacement required', 'invalid_replacement');
    checkAbort(ctx);
    const sourcePath = safeFile(ctx.root, args.path);
    const language = String(args.language ?? EXTENSION[extname(args.path).toLowerCase()] ?? '').toLowerCase();
    if (!LANGUAGE[language]) throw typed(`unsupported Atlas language ${language}`, 'unsupported_language');
    const bytes = readFileSync(sourcePath);
    if (bytes.includes(0) || bytes.length > this.maxSourceBytes) throw typed('source is binary or exceeds Atlas limit', 'invalid_source');
    let source;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw typed('source is not valid UTF-8', 'invalid_source'); }
    const inputDigest = sha(bytes); const patternDigest = sha(args.pattern);
    const replacementDigest = op === 'rewrite.structural' ? sha(args.replacement) : null;
    const started = this.now();
    this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, inputDigest, patternDigest, replacementDigest });
    checkAbort(ctx);
    let parsed; let matches;
    try {
      parsed = parse(LANGUAGE[language], source).root();
      matches = parsed.findAll(args.pattern);
    } catch { throw typed('invalid structural pattern', 'invalid_pattern'); }
    const captureNames = capturesIn(args.pattern);
    matches.sort((a, b) => a.range().start.index - b.range().start.index || a.range().end.index - b.range().end.index);
    const matchRecords = [];
    const edits = [];
    for (let index = 0; index < matches.length; index += 1) {
      checkAbort(ctx);
      const node = matches[index]; const text = node.text();
      matchRecords.push({ index, kind: node.kind(), range: position(node), textDigest: sha(text), captures: captureRecord(node, captureNames) });
      if (op === 'rewrite.structural') edits.push({ ...node.replace(renderReplacement(args.replacement, node, bytes)), matchIndex: index });
    }
    for (let index = 1; index < edits.length; index += 1) if (edits[index].startPos < edits[index - 1].endPos) throw typed('structural matches produce overlapping edits', 'overlapping_matches');
    let proposedSource = null; let outputDigest = null; let outputErrors = [];
    if (op === 'rewrite.structural') {
      try { proposedSource = parsed.commitEdits(edits.map(({ matchIndex: _index, ...edit }) => edit)); }
      catch { throw typed('structural edits could not be committed', 'invalid_replacement'); }
      if (Buffer.byteLength(proposedSource) > this.maxSourceBytes) throw typed('proposed source exceeds Atlas limit', 'output_too_large');
      outputDigest = sha(proposedSource);
      outputErrors = collectErrors(parse(LANGUAGE[language], proposedSource).root());
    }
    const inputErrors = collectErrors(parsed);
    const items = op === 'search.structural' ? matchRecords : edits.map((edit) => ({ matchIndex: edit.matchIndex, range: matchRecords[edit.matchIndex].range, insertedText: edit.insertedText, insertedDigest: sha(edit.insertedText) }));
    const manifest = { schemaVersion: 1, op, language, path: args.path, inputDigest, patternDigest, replacementDigest, outputDigest, parseErrors: { input: inputErrors, output: outputErrors }, items };
    const serialized = `${JSON.stringify(manifest)}\n`; const manifestDigest = sha(serialized);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('structural manifest exceeds Atlas artifact budget', 'result_too_large');
    const manifestPath = this._writeArtifact('manifests', manifestDigest, 'json', serialized);
    const refs = [{ handle: `art:sha256:${manifestDigest}`, kind: op === 'search.structural' ? 'structural_search' : 'structural_rewrite_manifest', digest: manifestDigest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-structural-rewrite+json', path: manifestPath }];
    if (proposedSource !== null) {
      const proposedPath = this._writeArtifact('sources', outputDigest, 'txt', proposedSource);
      refs.push({ handle: `art:sha256:${outputDigest}`, kind: 'proposed_source', digest: outputDigest, bytes: Buffer.byteLength(proposedSource), mediaType: 'text/plain; charset=utf-8', path: proposedPath });
    }
    const payload = bounded(items, ctx.budgetTokens);
    const parseErrorCount = inputErrors.length + outputErrors.length;
    const truncated = payload.length < items.length;
    const status = truncated ? 'needs_resume' : parseErrorCount > 0 ? 'partial' : 'ok';
    const wallMs = Math.max(0, this.now() - started);
    const result = Object.freeze({
      op, status, summary: `${matches.length} structural matches${op === 'rewrite.structural' ? `; ${edits.length} proposed edits` : ''}${parseErrorCount ? `; ${parseErrorCount} parse errors` : ''}`,
      payload, refs, ...(truncated ? { cursor: `atlas-structural:${manifestDigest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: `@ast-grep/napi@${AST_GREP_VERSION}` },
      provenance: { tool: `@ast-grep/napi@${AST_GREP_VERSION}`, language, inputDigest, patternDigest, replacementDigest, outputDigest, manifestDigest, parseErrors: { input: inputErrors.length, output: outputErrors.length }, deterministic: true, applyAuthority: false },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, inputDigest, patternDigest, replacementDigest, outputDigest, manifestDigest, status, wallMs });
    return result;
  }

  async resume(ref, cursor, ctx) {
    if (!ref || typeof ref.path !== 'string' || typeof ref.digest !== 'string') throw typed('Atlas artifact ref required', 'artifact_integrity');
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    const match = /^atlas-structural:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? '');
    if (!match || match[1] !== ref.digest) throw typed('invalid Atlas structural cursor', 'invalid_cursor');
    const root = realpathSync(join(this.artifactRoot, 'manifests'));
    let path;
    try { path = realpathSync(ref.path); } catch { throw typed('Atlas artifact unavailable', 'artifact_integrity'); }
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw typed('Atlas artifact escapes manifest root', 'artifact_integrity');
    const bytes = readFileSync(path);
    if (sha(bytes) !== ref.digest) throw typed('Atlas artifact digest mismatch', 'artifact_integrity');
    let manifest;
    try { manifest = JSON.parse(bytes.toString('utf8')); } catch { throw typed('Atlas artifact is invalid', 'artifact_integrity'); }
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.items)) throw typed('Atlas artifact schema mismatch', 'artifact_integrity');
    const offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > manifest.items.length) throw typed('invalid Atlas structural cursor offset', 'invalid_cursor');
    const payload = bounded(manifest.items.slice(offset), ctx.budgetTokens);
    const next = offset + payload.length; const truncated = next < manifest.items.length;
    return Object.freeze({ op: manifest.op, status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} structural items`, payload, refs: [ref], ...(truncated ? { cursor: `atlas-structural:${ref.digest}:${next}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `@ast-grep/napi@${AST_GREP_VERSION}` }, provenance: { manifestDigest: ref.digest, resumed_from: offset, deterministic: true } });
  }

  async reverify(claim, op, args, ctx) {
    const rerun = await this.invoke(op, args, ctx);
    return Object.freeze({ ok: rerun.provenance.manifestDigest === claim?.provenance?.manifestDigest && rerun.provenance.outputDigest === claim?.provenance?.outputDigest, observedManifestDigest: rerun.provenance.manifestDigest, observedOutputDigest: rerun.provenance.outputDigest });
  }
}
