#!/usr/bin/env node
// Independent verifier for sharded bend2 law/mutation control receipts.
//
// A sharded run replaces one long serial laws-check with one job per module
// group on the same qualified xcode-27 image. This module is the packager side
// of that split. It rediscovers the expected case set from the pinned source by
// asking the pinned checker for its own plan, then accepts a shard set only when
// the union is complete, disjoint, bound to that source and checker, bound to one
// toolchain, and backed by intact logs.
//
// Usage:
//   node verify-laws-shards.mjs --pin <dir> --plan <plan.json> --shards <dir>
//        [--checker <path>] [--toolchain <json>] [--no-rediscover]
//        [--report <path>] [--json]
//
// Exit codes: 0 accepted, 2 rejected, 1 invalid invocation.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const LAW_LINE = /^law ([A-Za-z0-9_]+):/;
const SOURCE_PREFIX = 'bend2/src/';

function fail(message) {
  console.error(`verify-laws-shards: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = { pin: null, plan: null, shards: null, checker: null, toolchain: null, report: null, rediscover: true, json: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--pin') values.pin = argv[++index];
    else if (flag === '--plan') values.plan = argv[++index];
    else if (flag === '--shards') values.shards = argv[++index];
    else if (flag === '--checker') values.checker = argv[++index];
    else if (flag === '--toolchain') values.toolchain = argv[++index];
    else if (flag === '--report') values.report = argv[++index];
    else if (flag === '--no-rediscover') values.rediscover = false;
    else if (flag === '--json') values.json = true;
    else fail(`unknown argument ${flag}`);
  }
  for (const required of ['pin', 'plan', 'shards']) {
    if (!values[required]) fail(`--${required} is required`);
  }
  return values;
}

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const digestFile = (path) => digest(readFileSync(path));

function walk(dir, suffix) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, suffix));
    else if (entry.isFile() && (!suffix || entry.name.endsWith(suffix))) found.push(full);
  }
  return found;
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function pinSnapshot(dir) {
  return {
    head: git(dir, ['rev-parse', 'HEAD']),
    tree: git(dir, ['rev-parse', 'HEAD^{tree}']),
    bend2Tree: git(dir, ['rev-parse', 'HEAD:bend2']),
    status: git(dir, ['status', '--porcelain=v1']),
  };
}

// The law ids stated by the pinned source, with the module that states each one.
function discoverLaws(pinDir) {
  const rows = new Map();
  for (const file of walk(join(pinDir, 'bend2', 'src'), '.bend')) {
    const module = relative(pinDir, file).split(sep).join('/');
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = LAW_LINE.exec(line);
      if (match) rows.set(`law:${match[1]}`, module);
    }
  }
  return rows;
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count++;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function caseId(row) {
  if (typeof row.mutation === 'string') return `mutation:${row.mutation}`;
  if (typeof row.law === 'string') return `law:${row.law}`;
  return null;
}

function fingerprint(plan) {
  return JSON.stringify({
    source: plan.source ?? null,
    checker: plan.checker ?? null,
    groups: plan.groups ?? null,
    cases: (plan.cases ?? []).map((row) => ({
      id: row.id, kind: row.kind, module: row.module, group: row.group, law: row.law ?? null, anchor: row.anchor ?? null,
    })),
  });
}

class Violations {
  constructor() { this.rows = []; this.notices = []; }
  add(cls, detail) { this.rows.push({ class: cls, detail }); return this; }
  note(cls, detail) { this.notices.push({ class: cls, detail }); return this; }
  get empty() { return this.rows.length === 0; }
}

function verifySource(violations, label, observed, expected) {
  for (const key of ['head', 'tree', 'bend2Tree', 'status']) {
    if (observed?.[key] !== expected[key]) {
      violations.add(`${label}-source-mismatch`, `${key}: ${JSON.stringify(observed?.[key])} does not match ${JSON.stringify(expected[key])}`);
    }
  }
}

function toolchainFingerprint(toolchain) {
  if (!toolchain) return null;
  return JSON.stringify({
    compiler: { version: toolchain.compiler?.version ?? null, sha256: toolchain.compiler?.sha256 ?? null },
    libraries: [...(toolchain.libraries ?? [])].map((row) => ({ path: row.path, sha256: row.sha256 })).sort((left, right) => (left.path < right.path ? -1 : 1)),
    cc: toolchain.cc ? { sha256: toolchain.cc.sha256 ?? null } : null,
  });
}

function verifyShard(violations, shardDir, shardFile, pin, plan, checkerSha, expected, ledger) {
  const path = join(shardDir, shardFile);
  const label = shardFile;
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    violations.add('unfinished-shard', `${label} is not readable JSON: ${error.message}`);
    return;
  }
  if (receipt.schema !== 'bend2-laws-shard-v1') {
    violations.add('unfinished-shard', `${label} declares schema ${JSON.stringify(receipt.schema)}`);
    return;
  }
  verifySource(violations, 'shard', receipt.source, pin);
  if (receipt.checker?.sha256 !== checkerSha || receipt.checker?.path !== plan.checker?.path) {
    violations.add('shard-checker-mismatch', `${label} checker ${JSON.stringify(receipt.checker?.sha256)} does not match ${checkerSha}`);
  }
  if (receipt.plan?.sha256 !== digestFile(plan.__path)) {
    violations.add('shard-plan-mismatch', `${label} plan sha256 ${JSON.stringify(receipt.plan?.sha256)} does not match ${digestFile(plan.__path)}`);
  }
  if (receipt.group === undefined || !(plan.groups ?? []).some((group) => group.group === receipt.group)) {
    violations.add('unexpected-case', `${label} claims group ${JSON.stringify(receipt.group)}, which the plan does not declare`);
  }

  const execution = receipt.execution ?? {};
  if (execution.exitCode !== 0 || typeof execution.endedUnix !== 'number' || typeof execution.startedUnix !== 'number') {
    violations.add('unfinished-shard', `${label} has no completed execution record (${JSON.stringify(execution)})`);
  }
  if (execution.maxConcurrentCompiles !== 1) {
    violations.add('serial-violation', `${label} declares maxConcurrentCompiles ${JSON.stringify(execution.maxConcurrentCompiles)}; one serial compiler per isolated VM`);
  }

  const cases = Array.isArray(receipt.cases) ? receipt.cases : [];
  for (const row of cases) {
    if (typeof row.id !== 'string') { violations.add('unfinished-shard', `${label} carries a case without an id`); continue; }
    const planned = expected.get(row.id);
    if (!planned) { violations.add('unexpected-case', `${label} carries ${row.id}, which the pinned plan does not state`); continue; }
    if (planned.group !== receipt.group) { violations.add('unexpected-case', `${label} carries ${row.id} from group ${planned.group}`); }
    if (ledger.has(row.id)) violations.add('duplicate-case', `${row.id} is claimed by ${ledger.get(row.id)} and ${label}`);
    else ledger.set(row.id, label);
    if (row.passed !== true || row.gate !== 'refuses') {
      violations.add('failed-case', `${label} reports ${row.id} as ${JSON.stringify({ passed: row.passed, gate: row.gate })}`);
    }
  }

  const counts = receipt.counts ?? {};
  const lawRows = cases.filter((row) => row.kind === 'law').length;
  const mutationRows = cases.filter((row) => row.kind === 'mutation').length;
  if (counts.laws !== lawRows || counts.mutations !== mutationRows || counts.compiles !== cases.length + 1 || counts.failures !== 0) {
    violations.add('unfinished-shard', `${label} counts ${JSON.stringify(counts)} do not match ${cases.length} cases (${lawRows} laws, ${mutationRows} mutations)`);
  }

  const log = receipt.log ?? {};
  const logPath = typeof log.path === 'string' ? resolve(shardDir, log.path) : null;
  if (!logPath || !logPath.startsWith(resolve(shardDir) + sep) || !existsSync(logPath)) {
    violations.add('altered-log', `${label} references log ${JSON.stringify(log.path)} outside its shard directory`);
    return;
  }
  const logBytes = readFileSync(logPath);
  if (log.bytes !== logBytes.length || log.sha256 !== digest(logBytes)) {
    violations.add('altered-log', `${label} log ${log.path} has ${logBytes.length} B / ${digest(logBytes)} instead of the recorded ${log.bytes} B / ${log.sha256}`);
  }
  const rows = logBytes.toString('utf8').split('\n').filter((line) => line.trim() !== '');
  const observed = new Map();
  for (const line of rows) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const id = caseId(parsed);
    if (id) observed.set(id, parsed);
  }
  const summaryLines = rows.filter((line) => line.includes('failures')).length;
  if (summaryLines > 1) violations.add('log-case-mismatch', `${label} log carries ${summaryLines} summary lines`);
  for (const row of cases) {
    const logged = observed.get(row.id);
    if (!logged) { violations.add('log-case-mismatch', `${label} log is missing a row for ${row.id}`); continue; }
    if ((logged.passed === true) !== (row.passed === true)) {
      violations.add('log-case-mismatch', `${label} log says ${row.id} passed=${logged.passed}, receipt says passed=${row.passed}`);
    }
  }
  for (const id of observed.keys()) {
    if (!cases.some((row) => row.id === id)) violations.add('log-case-mismatch', `${label} log states ${id}, which the receipt does not`);
  }
  const summary = rows.findLast((line) => /^laws-check: (green|red) - \d+ laws, \d+ mutations, \d+ compiles, \d+ failures$/.test(line));
  if (!summary) {
    violations.add('unfinished-shard', `${label} log has no complete laws-check summary line`);
  } else if (summary !== `laws-check: green - ${lawRows} laws, ${mutationRows} mutations, ${cases.length + 1} compiles, 0 failures`) {
    violations.add('altered-log', `${label} summary line ${JSON.stringify(summary)} does not match its receipt`);
  }
}

// The packager regenerates the inventory with the pinned checker and requires
// the shard plan to be that inventory, so no case can be dropped from a plan.
function rediscover(violations, pinDir, checkerPath, plan) {
  const scratch = mkdtempSync(join(tmpdir(), 'bend2-laws-rediscover-'));
  try {
    const target = join(scratch, 'plan.json');
    try {
      execFileSync(process.execPath, [checkerPath, '--plan', target], { cwd: pinDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      violations.add('rediscovery-mismatch', `the pinned checker could not write a plan: ${(error.stderr ?? '').trim() || error.message}`);
      return;
    }
    const fresh = JSON.parse(readFileSync(target, 'utf8'));
    if (fingerprint(fresh) === fingerprint(plan)) return;
    const freshIds = new Set(fresh.cases.map((row) => row.id));
    const planIds = new Set(plan.cases.map((row) => row.id));
    const absent = [...freshIds].filter((id) => !planIds.has(id));
    const extra = [...planIds].filter((id) => !freshIds.has(id));
    const detail = absent.length || extra.length
      ? `missing from the shard plan: ${absent.slice(0, 8).join(', ') || 'none'}; not in the rediscovered plan: ${extra.slice(0, 8).join(', ') || 'none'}`
      : 'case fields, groups or checker identity differ from the rediscovered plan';
    violations.add('rediscovery-mismatch', detail);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pinDir = resolve(args.pin);
  const shardDir = resolve(args.shards);
  if (!existsSync(pinDir) || !statSync(pinDir).isDirectory()) fail(`--pin ${pinDir} is not a directory`);
  if (!existsSync(shardDir) || !statSync(shardDir).isDirectory()) fail(`--shards ${shardDir} is not a directory`);

  const pin = pinSnapshot(pinDir);
  if (pin.status !== '') fail('--pin must be a clean checkout; the shard set binds to one source snapshot');
  const planPath = resolve(args.plan);
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  plan.__path = planPath;
  if (plan.schema !== 'bend2-laws-plan-v1') fail(`--plan declares schema ${JSON.stringify(plan.schema)}`);
  const checkerPath = resolve(args.checker ?? join(pinDir, plan.checker?.path ?? ''));
  if (!existsSync(checkerPath)) fail(`checker ${checkerPath} is missing`);
  const checkerSha = digestFile(checkerPath);

  const violations = new Violations();
  verifySource(violations, 'plan', plan.source, pin);
  if (plan.checker?.sha256 !== checkerSha) {
    violations.add('plan-checker-mismatch', `plan checker ${JSON.stringify(plan.checker?.sha256)} does not match ${checkerSha}`);
  }

  const discovered = discoverLaws(pinDir);
  const plannedLaws = new Map();
  const expected = new Map();
  for (const row of plan.cases ?? []) {
    expected.set(row.id, row);
    if (row.kind === 'law') plannedLaws.set(row.id, row);
  }
  for (const [id, module] of discovered) {
    if (!plannedLaws.has(id)) violations.add('law-set-mismatch', `plan omits ${id} stated by ${module}`);
  }
  for (const [id, row] of plannedLaws) {
    const module = discovered.get(id);
    if (module === undefined) violations.add('law-set-mismatch', `plan states ${id}, which the pin does not state`);
    else if (module !== row.module) violations.add('law-module-mismatch', `${id} is stated by ${module}, plan says ${row.module}`);
  }
  for (const row of plan.cases ?? []) {
    if (row.kind !== 'mutation') continue;
    const file = row.anchor?.file ?? row.module;
    if (!String(file).startsWith(SOURCE_PREFIX)) {
      violations.add('case-file-outside-source', `${row.id} mutates ${JSON.stringify(file)}`);
      continue;
    }
    const target = join(pinDir, file);
    if (!existsSync(target)) {
      violations.add('anchor-missing', `${row.id} mutates ${file}, which the pin does not contain`);
      continue;
    }
    const occurrences = countOccurrences(readFileSync(target, 'utf8'), row.anchor?.find);
    if (occurrences === 0) violations.add('anchor-missing', `${row.id} anchor text is absent from ${file}; the control is stale`);
    else if (occurrences > 1) violations.note('anchor-ambiguous', `${row.id} anchor text occurs ${occurrences} times in ${file}; the run applies the first occurrence`);
    if (!discovered.has(`law:${row.law}`)) violations.add('law-set-mismatch', `${row.id} names law ${JSON.stringify(row.law)}, which the pin does not state`);
  }
  for (const group of plan.groups ?? []) {
    const cases = (plan.cases ?? []).filter((row) => row.group === group.group);
    const laws = cases.filter((row) => row.kind === 'law').length;
    if (group.laws !== laws || group.mutations !== cases.length - laws) {
      violations.add('law-set-mismatch', `group ${group.group} claims ${group.laws} laws and ${group.mutations} mutations against ${laws} and ${cases.length - laws}`);
    }
  }
  if (args.rediscover) rediscover(violations, pinDir, checkerPath, plan);

  const ledger = new Map();
  const shardFiles = readdirSync(shardDir).filter((name) => name.endsWith('.json')).sort();
  if (shardFiles.length === 0) violations.add('unfinished-shard', `no shard receipts in ${shardDir}`);
  const fingerprints = new Set();
  for (const name of shardFiles) {
    const before = violations.rows.length;
    verifyShard(violations, shardDir, name, pin, plan, checkerSha, expected, ledger);
    if (violations.rows.length !== before) continue;
    const receipt = JSON.parse(readFileSync(join(shardDir, name), 'utf8'));
    fingerprints.add(JSON.stringify({ name, toolchain: toolchainFingerprint(receipt.toolchain) }));
  }
  for (const id of expected.keys()) {
    if (!ledger.has(id)) violations.add('missing-case', `${id} is not covered by any shard receipt`);
  }

  const distinctToolchains = new Set([...fingerprints].map((entry) => JSON.parse(entry).toolchain));
  if (distinctToolchains.size > 1) {
    violations.add('shard-toolchain-mismatch', `the shard set was produced by ${distinctToolchains.size} different toolchains`);
  }
  if (args.toolchain) {
    const expectedToolchain = toolchainFingerprint(JSON.parse(readFileSync(resolve(args.toolchain), 'utf8')));
    const observed = [...distinctToolchains];
    if (observed.length === 1 && observed[0] !== expectedToolchain) {
      violations.add('shard-toolchain-mismatch', `the shard toolchain ${observed[0]} does not match the packaging toolchain ${expectedToolchain}`);
    }
  }

  const report = {
    schema: 'bend2-laws-shard-verification-v1',
    status: violations.empty ? 'accepted' : 'rejected',
    pin,
    plan: { path: planPath, sha256: digestFile(planPath), cases: expected.size, groups: plan.groups?.length ?? 0 },
    checker: { path: relative(pinDir, checkerPath), sha256: checkerSha },
    rediscovered: args.rediscover,
    shards: shardFiles.length,
    coverage: { expected: expected.size, observed: ledger.size },
    violations: violations.rows,
    notices: violations.notices,
  };
  if (args.report) writeFileSync(resolve(args.report), JSON.stringify(report, null, 2) + '\n');
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`verify-laws-shards: ${report.status} - ${shardFiles.length} shards, ${ledger.size}/${expected.size} cases, ${violations.notices.length} notices`);
    for (const row of violations.rows) console.log(`  ${row.class}: ${row.detail}`);
    for (const row of violations.notices) console.log(`  notice ${row.class}: ${row.detail}`);
  }
  process.exit(violations.empty ? 0 : 2);
}

main();
