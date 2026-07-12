import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deserialize } from 'node:v8';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const typed = (message, code, fields = {}) => Object.assign(new Error(message), { code, ...fields });
const abort = (ctx) => { if (ctx?.signal?.aborted) throw typed('behavior observation cancelled', 'cancelled'); };
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const RUNNER = String.raw`
const [targetUrl, exportName, encoded] = process.argv.slice(1);
const emit = process.stdout.write.bind(process.stdout);
const hardExit = process.exit.bind(process);
const removeAllListeners = process.removeAllListeners.bind(process);
const parse = JSON.parse.bind(JSON);
const arrayIsArray = Array.isArray.bind(Array);
const arrayPush = Function.call.bind(Array.prototype.push);
const objectCreate = Object.create.bind(Object);
const objectIs = Object.is.bind(Object);
const numberIsNaN = Number.isNaN.bind(Number);
const stringValue = String;
const bufferToString = Function.call.bind(Buffer.prototype.toString);
const { serialize } = await import('node:v8');
let nonce = ''; for await (const chunk of process.stdin) nonce += chunk;
const corpus = parse(Buffer.from(encoded, 'base64').toString('utf8'));
const finish = (payload) => {
  const frame = bufferToString(serialize({ nonce, nodeVersion: process.version, ...payload }), 'base64');
  removeAllListeners('beforeExit'); removeAllListeners('exit');
  emit('\nBATON_BEHAVIOR_RESULT:' + frame + '\n'); hardExit(0);
};
let fn;
try {
  const module = await import(targetUrl); fn = module[exportName];
  if (typeof fn !== 'function') throw Object.assign(new Error('named export is not a function'), { code: 'EXPORT_NOT_FUNCTION' });
} catch (error) {
  finish({ error: { name: stringValue(error?.name ?? 'Error'), message: stringValue(error?.message ?? error), code: error?.code ?? null } });
}
const observations = [];
for (let caseIndex = 0; caseIndex < corpus.length; caseIndex += 1) {
  try {
    const value = await fn(corpus[caseIndex]);
    const item = objectCreate(null); item.caseIndex = caseIndex; item.kind = 'return'; item.valueBytes = bufferToString(serialize(value), 'base64');
    if (value === undefined) item.valueType = 'undefined';
    else if (typeof value === 'number' && numberIsNaN(value)) { item.valueType = 'number'; item.numberClass = 'NaN'; }
    else if (typeof value === 'number' && objectIs(value, -0)) { item.valueType = 'number'; item.numberClass = '-0'; }
    else if (value === Infinity || value === -Infinity) { item.valueType = 'number'; item.numberClass = stringValue(value); }
    else if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') item.value = value;
    else if (typeof value === 'bigint') { item.valueType = 'bigint'; item.value = stringValue(value); }
    else item.valueType = arrayIsArray(value) ? 'array' : typeof value;
    arrayPush(observations, item);
  } catch (error) {
    const item = objectCreate(null); item.caseIndex = caseIndex; item.kind = 'throw'; item.name = stringValue(error?.name ?? 'Error'); item.message = stringValue(error?.message ?? error); item.code = error?.code ?? error?.cause?.code ?? null;
    arrayPush(observations, item);
  }
}
finish({ observations });
`;

function executeNode(nodePath, args, { timeoutMs, maxOutputBytes, signal, env, input }) {
  return new Promise((resolve, reject) => {
    let settled = false; let stdout = ''; let stderr = ''; let failure = null;
    const child = spawn(nodePath, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const stop = (error) => { failure ??= error; try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    const append = (which, chunk) => {
      if (which === 'stdout') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxOutputBytes) stop(typed('behavior child output exceeds deployment budget', 'output_too_large'));
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append('stdout', chunk)); child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => finish(typed(`behavior child spawn failed: ${error.message}`, 'execution_failed')));
    child.on('close', (code, childSignal) => {
      if (failure) { finish(failure); return; }
      if (code !== 0) { finish(typed(`behavior child exited ${code}${childSignal ? ` (${childSignal})` : ''}: ${stderr.slice(-1000)}`, 'execution_failed')); return; }
      finish(null, stdout);
    });
    const timer = setTimeout(() => stop(typed('behavior observation exceeded execution deadline', 'execution_timeout')), timeoutMs);
    const onAbort = () => stop(typed('behavior observation cancelled', 'cancelled'));
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

function bounded(items, tokens) {
  const out = [];
  for (const item of items) {
    if (Buffer.byteLength(JSON.stringify([...out, item])) > tokens * 4) break;
    out.push(item);
  }
  return out;
}

function validatePath(path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.split(/[\\/]+/).includes('..')) throw typed('behavior target path escapes root', 'path_escape');
  if (!['.js', '.mjs'].includes(extname(path).toLowerCase())) throw typed('behavior fingerprint supports dependency-free JavaScript ESM only', 'unsupported_language');
  return path;
}

function target(root, path, maxSourceBytes) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('behavior root required');
  const realRoot = realpathSync(root); let realTarget;
  try { realTarget = realpathSync(resolve(realRoot, validatePath(path))); }
  catch (error) { if (error?.code === 'path_escape' || error?.code === 'unsupported_language') throw error; throw typed('behavior target unavailable', 'target_unavailable'); }
  const rel = relative(realRoot, realTarget);
  if (rel === '' || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw typed('behavior target escapes root', 'path_escape');
  if (!statSync(realTarget).isFile()) throw typed('behavior target must be a file', 'target_unavailable');
  const source = readFileSync(realTarget); if (source.byteLength > maxSourceBytes) throw typed('behavior source exceeds deployment budget', 'source_too_large');
  return { realTarget, source, sourceDigest: sha(source) };
}

function corpusBytes(corpus, maxCorpusCases, maxInputBytes) {
  if (!Array.isArray(corpus)) throw new TypeError('behavior corpus must be an array');
  if (corpus.length === 0 || corpus.length > maxCorpusCases) throw typed('behavior corpus exceeds deployment case budget', 'corpus_too_large');
  const json = (value, seen = new Set()) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw typed('behavior corpus must contain finite JSON numbers', 'invalid_corpus'); return; }
    if (typeof value !== 'object' || seen.has(value)) throw typed('behavior corpus must contain only acyclic JSON values', 'invalid_corpus');
    seen.add(value);
    if (Array.isArray(value)) for (const item of value) json(item, seen);
    else {
      const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) throw typed('behavior corpus objects must be plain JSON objects', 'invalid_corpus');
      for (const item of Object.values(value)) json(item, seen);
    }
    seen.delete(value);
  };
  json(corpus);
  let serialized;
  try { serialized = JSON.stringify(corpus); } catch { throw typed('behavior corpus must be JSON serializable', 'invalid_corpus'); }
  if (serialized === undefined || Buffer.byteLength(serialized) > maxInputBytes) throw typed('behavior corpus exceeds deployment byte budget', 'corpus_too_large');
  return { serialized, digest: sha(serialized) };
}

export class AtlasBehaviorFingerprint {
  constructor(opts = {}) {
    if (!opts.artifactRoot) throw new TypeError('behavior artifactRoot required');
    for (const key of ['maxSourceBytes', 'maxCorpusCases', 'maxInputBytes', 'maxOutputBytes', 'maxArtifactBytes', 'timeoutMs']) {
      if (!Number.isSafeInteger(opts[key]) || opts[key] <= 0) throw new TypeError(`${key} must be deployment-derived`);
    }
    this.artifactRoot = opts.artifactRoot;
    this.maxSourceBytes = opts.maxSourceBytes;
    this.maxCorpusCases = opts.maxCorpusCases;
    this.maxInputBytes = opts.maxInputBytes;
    this.maxOutputBytes = opts.maxOutputBytes;
    this.maxArtifactBytes = opts.maxArtifactBytes;
    this.timeoutMs = opts.timeoutMs;
    this.nodePath = opts.nodePath ?? process.execPath;
    this.now = opts.now ?? Date.now;
    this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }

  card() {
    return Object.freeze({
      name: 'atlas-behavior-fingerprint', version: '0.1.0', underlying: [`node-permission-model@${process.version}`],
      ops: {
        'behavior.fingerprint': { deterministic: true, latency_class: 'bounded_batch', side_effects: 'executes_target_in_throwaway_permission_sandbox', reverifiable: true },
        'behavior.compare': { deterministic: true, latency_class: 'bounded_batch', side_effects: 'executes_targets_in_throwaway_permission_sandboxes', reverifiable: true },
      },
      limitations: ['dependency-free JavaScript ESM named exports only', 'pinned-corpus observation is not semantic equivalence', 'no input generation or coverage claim', 'filesystem writes, network, child processes, and workers denied'],
    });
  }

  async _once(source, exportName, corpus, ctx) {
    abort(ctx);
    // macOS exposes its temp root through /var -> /private/var. Node's permission resolver uses
    // canonical paths, so grant the canonical sandbox rather than the lexical symlink path.
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'baton-behavior-sandbox-')));
    const targetPath = join(sandbox, 'target.mjs'); writeFileSync(targetPath, source, { mode: 0o400 });
    try {
      const encoded = Buffer.from(corpus).toString('base64');
      const nonce = randomBytes(32).toString('hex');
      const stdout = await executeNode(this.nodePath, [
        '--permission', `--allow-fs-read=${sandbox}`, '--input-type=module', '-e', RUNNER,
        pathToFileURL(targetPath).href, exportName, encoded,
      ], {
        timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes, signal: ctx?.signal, input: nonce,
        env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_NO_WARNINGS: '1' },
      });
      const frames = stdout.split('\n').filter((line) => line.startsWith('BATON_BEHAVIOR_RESULT:'));
      if (frames.length !== 1) throw typed('behavior child produced an ambiguous result channel', 'observation_protocol');
      let envelope;
      try { envelope = deserialize(Buffer.from(frames[0].slice('BATON_BEHAVIOR_RESULT:'.length), 'base64')); }
      catch { throw typed('behavior child result frame is invalid', 'observation_protocol'); }
      if (!envelope || envelope.nonce !== nonce || typeof envelope.nodeVersion !== 'string') throw typed('behavior child result frame failed runner authentication', 'observation_protocol');
      if (envelope.error) throw typed(`behavior runner failed: ${envelope.error.message}`, envelope.error.code === 'EXPORT_NOT_FUNCTION' ? 'invalid_export' : 'execution_failed');
      if (!Array.isArray(envelope.observations)) throw typed('behavior child result frame has invalid schema', 'observation_protocol');
      const observations = envelope.observations;
      if (Buffer.byteLength(JSON.stringify(observations)) > this.maxOutputBytes) throw typed('behavior observations exceed deployment budget', 'output_too_large');
      if (observations.some((item) => item.kind === 'throw' && item.code === 'ERR_ACCESS_DENIED')) throw typed('target attempted an operation denied by the permission sandbox', 'sandbox_violation');
      return { observations, nodeVersion: envelope.nodeVersion };
    } catch (error) {
      if (['sandbox_violation', 'output_too_large', 'execution_failed', 'observation_protocol', 'invalid_export', 'execution_timeout', 'cancelled'].includes(error?.code)) throw error;
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw typed('behavior observation cancelled', 'cancelled');
      throw typed(`behavior child failed: ${error?.message ?? error}`, error?.message?.includes('EXPORT_NOT_FUNCTION') ? 'invalid_export' : 'execution_failed');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }

  async _observe(root, path, exportName, corpus, ctx) {
    if (typeof exportName !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(exportName)) throw typed('valid named export required', 'invalid_export');
    const resolved = target(root, path, this.maxSourceBytes); const input = corpusBytes(corpus, this.maxCorpusCases, this.maxInputBytes);
    const first = await this._once(resolved.source, exportName, input.serialized, ctx); abort(ctx);
    const second = await this._once(resolved.source, exportName, input.serialized, ctx);
    if (first.nodeVersion !== second.nodeVersion || stable(first.observations) !== stable(second.observations)) throw typed('target observations differ across isolated repetitions', 'nondeterministic');
    return {
      path, exportName, sourceDigest: resolved.sourceDigest, corpusDigest: input.digest, observations: first.observations,
      nodeVersion: first.nodeVersion,
      sandbox: { permissionModel: true, fsRead: 'isolated_target_only', fsWrite: 'denied', network: 'denied', childProcess: 'denied', workers: 'denied' },
    };
  }

  _writeResult(op, artifact, items, ctx, started) {
    const serialized = `${JSON.stringify(artifact)}\n`; const digest = sha(serialized);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('behavior artifact exceeds deployment budget', 'artifact_too_large');
    const path = join(this.artifactRoot, `${digest}.json`);
    if (existsSync(path) && sha(readFileSync(path)) !== digest) throw typed('behavior artifact integrity failure', 'artifact_integrity');
    if (!existsSync(path)) writeFileSync(path, serialized, { mode: 0o600, flag: 'wx' });
    const payload = bounded(items, ctx.budgetTokens); const truncated = payload.length < items.length;
    const kind = op === 'behavior.fingerprint' ? 'behavior_fingerprint' : 'behavior_comparison';
    const meaning = op === 'behavior.fingerprint' ? 'observed_pinned_corpus_not_semantic_equivalence' : 'observed_corpus_agreement_not_semantic_equivalence';
    const result = Object.freeze({
      op, status: truncated ? 'needs_resume' : 'ok', summary: op === 'behavior.fingerprint' ? `observed ${artifact.observations.length} pinned cases` : `${artifact.divergences.length} observed divergences`, payload,
      refs: [{ handle: `art:sha256:${digest}`, kind, digest, bytes: Buffer.byteLength(serialized), mediaType: `application/vnd.baton.atlas-${kind.replaceAll('_', '-')}+json`, path }],
      ...(truncated ? { cursor: `atlas-behavior:${digest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: Math.max(0, this.now() - started), usd: 0, underlying: `node-permission-model@${artifact.nodeVersion}` },
      provenance: { artifactDigest: digest, sourceDigests: artifact.sourceDigests ?? [artifact.sourceDigest], corpusDigest: artifact.corpusDigest, exportName: artifact.exportName, nodeVersion: artifact.nodeVersion, sandbox: artifact.sandbox, deterministic: true, meaning },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, digest, status: result.status });
    return result;
  }

  async invoke(op, args, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    if (!['behavior.fingerprint', 'behavior.compare'].includes(op)) throw typed(`unsupported behavior operation: ${op}`, 'unsupported_op');
    abort(ctx); const started = this.now(); this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op });
    if (op === 'behavior.fingerprint') {
      const observed = await this._observe(ctx.root, validatePath(args?.path), args?.exportName, args?.corpus, ctx);
      const artifact = { schemaVersion: 1, op, ...observed };
      return this._writeResult(op, artifact, observed.observations, ctx, started);
    }
    const before = await this._observe(ctx.beforeRoot, validatePath(args?.beforePath), args?.exportName, args?.corpus, ctx); abort(ctx);
    const after = await this._observe(ctx.afterRoot, validatePath(args?.afterPath), args?.exportName, args?.corpus, ctx);
    const divergences = [];
    for (let caseIndex = 0; caseIndex < before.observations.length; caseIndex += 1) {
      if (stable(before.observations[caseIndex]) !== stable(after.observations[caseIndex])) divergences.push({ caseIndex, before: before.observations[caseIndex], after: after.observations[caseIndex] });
    }
    const comparison = { recordType: 'behavior_comparison', agree: divergences.length === 0, cases: before.observations.length, divergences };
    const artifact = {
      schemaVersion: 1, op, exportName: args.exportName, corpusDigest: before.corpusDigest,
      sourceDigests: [before.sourceDigest, after.sourceDigest], before: { path: before.path, observations: before.observations }, after: { path: after.path, observations: after.observations },
      nodeVersion: before.nodeVersion, sandbox: before.sandbox, divergences,
    };
    return this._writeResult(op, artifact, [comparison], ctx, started);
  }

  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required'); abort(ctx);
    const match = /^atlas-behavior:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? ''); if (!match || match[1] !== ref?.digest) throw typed('invalid behavior cursor', 'invalid_cursor');
    let path; try { path = realpathSync(ref.path); } catch { throw typed('behavior artifact unavailable', 'artifact_integrity'); }
    const root = realpathSync(this.artifactRoot); if (path !== join(root, `${ref.digest}.json`)) throw typed('behavior artifact path escape', 'artifact_integrity');
    const bytes = readFileSync(path); if (sha(bytes) !== ref.digest) throw typed('behavior artifact digest mismatch', 'artifact_integrity');
    let artifact; try { artifact = JSON.parse(bytes); } catch { throw typed('behavior artifact JSON invalid', 'artifact_integrity'); }
    if (artifact.schemaVersion !== 1 || !['behavior.fingerprint', 'behavior.compare'].includes(artifact.op)) throw typed('behavior artifact schema mismatch', 'artifact_integrity');
    const items = artifact.op === 'behavior.fingerprint' ? artifact.observations : [{ recordType: 'behavior_comparison', agree: artifact.divergences.length === 0, cases: artifact.before.observations.length, divergences: artifact.divergences }];
    const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw typed('invalid behavior cursor offset', 'invalid_cursor');
    const payload = bounded(items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < items.length;
    return Object.freeze({ op: artifact.op, status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} behavior records`, payload, refs: [ref], ...(truncated ? { cursor: `atlas-behavior:${ref.digest}:${next}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `node-permission-model@${process.version}` }, provenance: { artifactDigest: ref.digest, resumed_from: offset, deterministic: true } });
  }

  async reverify(claim, op, args, ctx) {
    const rerun = await this.invoke(op, args, ctx);
    return Object.freeze({ ok: rerun.refs[0].digest === claim?.refs?.[0]?.digest, observedDigest: rerun.refs[0].digest });
  }
}
