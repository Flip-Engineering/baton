#!/usr/bin/env node
// ledger-extract.mjs — reduce one real deployment coordination ledger to the rows the swarm
// fold consumes (issue #304).
//
//   node impl/scripts/ledger-extract.mjs <events.jsonl> <out.jsonl>
//
// The input is READ-ONLY. The output keeps the swarm-relevant rows VERBATIM — the original
// ledger bytes for each kept row, because the fold reads actor/seq/ts/idempotencyKey off the
// row and a re-serialization could drift any of them:
//   • every row whose kind is in SWARM_EVENT_KINDS, and
//   • every `driver.recorded` row whose inner payload kind is a swarm operation record
//     (`swarm.operation_*`) — the swarm's own durable refusal/audit lane.
// Nothing the fold needs is stripped, and nothing is redacted that is there: the extractor
// ASSERTS that no token-shaped value survives (refusing typed, naming the row, if one does —
// sanitization happens by shrinking the extract upstream, never by silently editing rows).
//
// Bounding: a committed fixture must not exceed the repository's existing fixture ceiling —
// the largest file already committed under impl/test/fixtures, measured at run time (no
// hardcoded byte literal here). An extract over that ceiling keeps the EARLIEST swarms whole
// (every row of every kept swarm, both families) rather than truncating rows, because a
// swarm's history is exactly the unit a fold-time rule change must be tested against; a
// truncated row would fake the replay.
// folded through foldSwarmEvent from an empty state with replay semantics (no admission flag —
// a resident must never refuse its own recorded history), exactly as the suite replays them.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { SWARM_EVENT_KINDS, foldSwarmEvent, swarmSnapshot } from '../src/swarm-state.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(SCRIPT_DIR, '..', 'test', 'fixtures');

// Token shapes that must never survive into a committed fixture. Named provider prefixes and
// the bearer/256-bit-secret shapes; hex-40/64 are commit SHAs and digests the fold carries and
// are deliberately NOT token-shaped.
export const TOKEN_SHAPES = Object.freeze([
  { name: 'github-classic', pattern: /\bgh[posur]_[A-Za-z0-9]{20,}\b/u },
  { name: 'github-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u },
  { name: 'openai-style', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/u },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: 'slack', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  { name: 'bearer', pattern: /\bBearer [A-Za-z0-9._+/=-]{16,}\b/u },
  // One 256-bit secret, base64url-encoded, unpadded — the bridge token shape.
  { name: 'base64url-256-bit', pattern: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/u },
]);

/** Scan one ledger row (as a string) for token-shaped values. Returns the matches found. */
export function findTokenShaped(text) {
  const found = [];
  for (const { name, pattern } of TOKEN_SHAPES) {
    const match = pattern.exec(text);
    if (match) found.push({ shape: name });
  }
  return found;
}

const isSwarmRow = (event) => SWARM_EVENT_KINDS.has(event.kind);
const isSwarmOperationRow = (event) => event.kind === 'driver.recorded'
  && typeof event.payload?.kind === 'string' && event.payload.kind.startsWith('swarm.');
const rowSwarmId = (event) => event.payload?.swarmId ?? null;

/** The repository's existing fixture ceiling: the byte size of the largest file already
 * committed under impl/test/fixtures. Derived at run time — a new larger fixture raises the
 * ceiling for the next one, and no control number is written here. */
export function fixtureCeilingBytes(fixturesDir = FIXTURES_DIR) {
  let ceiling = 0;
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) ceiling = Math.max(ceiling, stat.size);
    }
  };
  walk(fixturesDir);
  return ceiling;
}

/** The sha256 of the folded projection: the rows fold through foldSwarmEvent from an empty
 * state with replay semantics (no admission flag), and the snapshot digests byte-identically
 * to the same fold inside the store's replay. */
export function projectionDigest(rows) {
  const swarms = new Map();
  for (const event of rows) {
    if (!isSwarmRow(event)) continue;
    foldSwarmEvent(swarms, event);
  }
  return createHash('sha256').update(JSON.stringify(swarmSnapshot(swarms))).digest('hex');
}

/** Reduce one ledger to the swarm-relevant rows, bounded whole-swarms to the fixture ceiling. */
export function extractLedger(inputPath, { ceilingBytes = fixtureCeilingBytes() } = {}) {
  const text = readFileSync(inputPath, 'utf8');
  if (Buffer.from(text, 'utf8').byteLength !== statSync(inputPath).size) {
    throw Object.assign(new Error('coordination ledger is not exact UTF-8'), { code: 'ledger_extract_invalid_utf8' });
  }
  const lines = text.length === 0 ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  const kept = [];
  for (const [index, line] of lines.entries()) {
    if (line === '') continue;
    let event;
    try { event = JSON.parse(line); }
    catch {
      throw Object.assign(new Error(`coordination ledger line ${index + 1} is not valid JSON`), { code: 'ledger_extract_invalid_json' });
    }
    if (isSwarmRow(event) || isSwarmOperationRow(event)) kept.push({ line, event });
  }
  // Bounding: keep the earliest swarms whole. A swarm enters the kept set at its first kept
  // row; once the next whole swarm would cross the ceiling, every swarm after it is dropped
  // entire — its rows (both families) never appear truncated in the fixture.
  const swarmOrder = [];
  const rowsBySwarm = new Map();
  for (const row of kept) {
    const swarmId = rowSwarmId(row.event);
    if (swarmId === null) continue;
    if (!rowsBySwarm.has(swarmId)) { swarmOrder.push(swarmId); rowsBySwarm.set(swarmId, []); }
    rowsBySwarm.get(swarmId).push(row);
  }
  const included = new Set();
  let bytes = 0;
  for (const swarmId of swarmOrder) {
    const swarmBytes = rowsBySwarm.get(swarmId).reduce((sum, row) => sum + Buffer.byteLength(row.line, 'utf8') + 1, 0);
    if (bytes > 0 && bytes + swarmBytes > ceilingBytes) break;
    included.add(swarmId);
    bytes += swarmBytes;
  }
  const fixtureRows = kept.filter((row) => {
    const swarmId = rowSwarmId(row.event);
    return swarmId === null ? included.size === 0 : included.has(swarmId);
  });
  const tokenFindings = [];
  for (const row of fixtureRows) {
    for (const finding of findTokenShaped(row.line)) {
      tokenFindings.push({ seq: row.event.seq, kind: row.event.kind, ...finding });
    }
  }
  if (tokenFindings.length > 0) {
    throw Object.assign(
      new Error(`ledger extract holds ${tokenFindings.length} token-shaped value(s); redact upstream — a committed fixture never carries one`),
      { code: 'ledger_extract_token_shaped', detail: tokenFindings.slice(0, 5) },
    );
  }
  const rows = fixtureRows.map((row) => row.event);
  return {
    fixture: fixtureRows.map((row) => row.line),
    digest: projectionDigest(rows),
    source: {
      path: inputPath,
      bytes: statSync(inputPath).size,
      rows: lines.filter((line) => line !== '').length,
    },
    ceilingBytes,
    swarmIdsKept: swarmOrder.filter((swarmId) => included.has(swarmId)),
    swarmIdsDropped: swarmOrder.filter((swarmId) => !included.has(swarmId)),
    rowsKept: fixtureRows.length,
  };
}

export function main(argv = process.argv.slice(2)) {
  const [inputArg, outArg] = argv;
  if (!inputArg || !outArg || argv.length !== 2) {
    process.stderr.write('usage: node impl/scripts/ledger-extract.mjs <events.jsonl> <out.jsonl>\n');
    return 2;
  }
  const inputPath = resolve(inputArg);
  const outPath = resolve(outArg);
  if (!existsSync(inputPath)) {
    process.stderr.write(`ledger-extract: input ledger ${inputPath} does not exist\n`);
    return 1;
  }
  if (inputPath === outPath) {
    process.stderr.write('ledger-extract: the extract must not overwrite its own input ledger\n');
    return 1;
  }
  const extraction = extractLedger(inputPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${extraction.fixture.join('\n')}\n`);
  const sidecar = {
    schemaVersion: 1,
    digest: extraction.digest,
    algorithm: 'sha256 of JSON.stringify(swarmSnapshot(foldSwarmEvent from empty, replay semantics)) over the fixture rows',
    source: extraction.source,
    fixture: { rows: extraction.rowsKept, ceilingBytes: extraction.ceilingBytes, swarmsKept: extraction.swarmIdsKept.length, swarmsDropped: extraction.swarmIdsDropped.length },
    swarmIdsKept: extraction.swarmIdsKept,
    swarmIdsDropped: extraction.swarmIdsDropped,
  };
  writeFileSync(`${outPath}.digest`, `${JSON.stringify(sidecar, null, 2)}\n`);
  process.stdout.write(`ledger-extract: ${extraction.rowsKept} rows (${extraction.swarmIdsKept.length} swarms kept, ${extraction.swarmIdsDropped.length} dropped) -> ${outPath}\n`);
  process.stdout.write(`ledger-extract: projection digest ${extraction.digest}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) process.exitCode = main();
