import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const typed = (message, code, fields = {}) => Object.assign(new Error(message), { code, ...fields });

function boundedExec(file, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, shell: false, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure = null; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const stop = (error) => { failure ??= error; try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    const append = (stream, chunk) => {
      if (stream === 'stdout') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > opts.maxOutputBytes) stop(typed('structured merge resolver output exceeded deployment budget', 'structured_tool_output_too_large'));
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append('stdout', chunk)); child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => finish(error?.code === 'ENOENT' ? typed('structured merge resolver is unavailable', 'structured_tool_unavailable') : typed(`structured merge resolver spawn failed: ${error.message}`, 'structured_tool_failed')));
    child.on('close', (exitCode) => failure ? finish(failure) : finish(null, { stdout, stderr, exitCode }));
    const timer = setTimeout(() => stop(typed('structured merge resolver timed out', 'structured_tool_timeout')), opts.timeoutMs);
  });
}

export class MergirafResolver {
  constructor(opts = {}) {
    if (typeof opts.binary !== 'string' || opts.binary.length === 0) throw new TypeError('Mergiraf binary required');
    if (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs <= 0) throw new TypeError('Mergiraf timeoutMs must be deployment-derived');
    if (!Number.isSafeInteger(opts.maxOutputBytes) || opts.maxOutputBytes <= 0) throw new TypeError('Mergiraf maxOutputBytes must be deployment-derived');
    if (!Number.isSafeInteger(opts.maxFileBytes) || opts.maxFileBytes <= 0) throw new TypeError('Mergiraf maxFileBytes must be deployment-derived');
    this.binary = opts.binary; this.timeoutMs = opts.timeoutMs; this.maxOutputBytes = opts.maxOutputBytes; this.maxFileBytes = opts.maxFileBytes;
    this.execFile = opts.execFile ?? boundedExec;
  }

  identity() { return Object.freeze({ tool: 'mergiraf', binary: this.binary }); }

  async resolve({ cwd, relativePath }) {
    if (typeof cwd !== 'string' || typeof relativePath !== 'string' || relativePath.length === 0) throw new TypeError('structured merge resolver requires cwd and relativePath');
    let observed;
    try {
      observed = await this.execFile(this.binary, ['solve', relativePath], {
        cwd, shell: false, timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes,
        env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
      });
    } catch (error) {
      if (error?.code?.startsWith('structured_')) throw error;
      if (error?.code === 'ENOENT') throw typed('structured merge resolver is unavailable', 'structured_tool_unavailable');
      throw typed(`structured merge resolver failed: ${error?.message ?? error}`, 'structured_tool_failed');
    }
    const stdout = String(observed?.stdout ?? ''); const stderr = String(observed?.stderr ?? '');
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > this.maxOutputBytes) throw typed('structured merge resolver output exceeded deployment budget', 'structured_tool_output_too_large');
    const evidence = { exitCode: observed?.exitCode ?? null, stdoutDigest: digest(stdout), stderrDigest: digest(stderr) };
    if (/fall(?:ing)?\s+back|line[- ]based\s+merge/i.test(`${stdout}\n${stderr}`)) return Object.freeze({ status: 'parse_fallback', ...evidence });
    if (observed?.exitCode !== 0) return Object.freeze({ status: 'unresolved', ...evidence });
    if (!/solved\s+\d+\s+conflict/i.test(stdout)) return Object.freeze({ status: 'unknown', ...evidence });
    return Object.freeze({ status: 'resolved', ...evidence });
  }
}
