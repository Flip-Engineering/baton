// Scratch recon: run my cluster's test files in isolation and record per-row verdicts.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const all = readFileSync(new URL('./.recon-files.txt', import.meta.url), 'utf8').split('\n').filter(Boolean);
const priorPath = new URL('./.recon-domain.json', import.meta.url);
let prior = [];
try { prior = JSON.parse(readFileSync(priorPath, 'utf8')); } catch { prior = []; }
const byFile = new Map(prior.map((row) => [row.file, row]));
const TIMEOUT_MS = Number(process.env.RECON_TIMEOUT_MS || 300000);

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--test', file], { cwd: new URL('.', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let buf = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { buf += d; });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const failed = [];
      const passed = [];
      let pass = null; let fail = null; let cancelled = null;
      for (const raw of buf.split('\n')) {
        const line = raw.trim();
        const tapNotOk = /^not ok \d+ - (.+)$/.exec(line);
        if (tapNotOk) failed.push(tapNotOk[1].trim());
        const tapOk = /^ok \d+ - (.+)$/.exec(line);
        if (tapOk) passed.push(tapOk[1].trim());
        const specFail = /^\u2716\s+(.+?)\s+\(\d/.exec(line);
        if (specFail) failed.push(specFail[1].trim());
        const specOk = /^\u2714\s+(.+?)\s+\(\d/.exec(line);
        if (specOk) passed.push(specOk[1].trim());
        const p = /^(?:#|\u2139)\s*pass (\d+)$/.exec(line);
        const f = /^(?:#|\u2139)\s*fail (\d+)$/.exec(line);
        const c = /^(?:#|\u2139)\s*cancelled (\d+)$/.exec(line);
        if (p) pass = Number(p[1]);
        if (f) fail = Number(f[1]);
        if (c) cancelled = Number(c[1]);
      }
      resolve({
        file, code, killed, seconds: Math.round((Date.now() - started) / 100) / 10,
        pass, fail, cancelled,
        failed: [...new Set(failed)].slice(0, 200),
        passed: [...new Set(passed)].slice(0, 400),
      });
    });
  });
}

for (const file of all) {
  if (byFile.has(file)) { process.stdout.write(`SKIP  ${file} (already recorded)\n`); continue; }
  const r = await runOne(file);
  byFile.set(file, r);
  try { writeFileSync(priorPath, JSON.stringify([...byFile.values()], null, 1)); } catch (error) { process.stdout.write(`  (result file write failed: ${error.code})
`); }
  process.stdout.write(`${(r.fail === 0 && !r.killed && r.code === 0) ? 'GREEN' : 'RED  '} ${file} pass=${r.pass ?? '?'} fail=${r.fail ?? 0} ${r.killed ? 'TIMEOUT' : ''} ${r.seconds}s\n`);
}
