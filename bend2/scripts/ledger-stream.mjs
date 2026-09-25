#!/usr/bin/env node
// bend2/scripts/ledger-stream.mjs — the ledger decoder of the Phase 1 shadow core.
//
// It reads the resident's coordination ledger (`events.jsonl`) and writes the Contract A stream:
// one line per ledger row the projection reads, the five fields seq, kind, swarmId, participantId
// and decision separated by one tab and terminated by LF. Exactly eight kinds are written:
//
//   swarm.participant_joined  swarm.participant_left       swarm.contribution_recorded
//   swarm.contribution_reviewed  swarm.contribution_integrated  swarm.work_updated
//   swarm.assignment_updated  swarm.closed
//
// A row's effective kind is `payload.kind` when the top-level kind is `driver.recorded`, and the
// top-level kind otherwise. A row of any other effective kind is not written.
//
//   swarmId        payload.swarmId, or "-" when absent
//   participantId  payload.participantId, or "-" when absent
//   decision       payload.decision for swarm.contribution_reviewed, "-" for every other kind
//
// The ledger is read in chunks and only the current line is held, so the run's memory does not
// follow the file's size. A row whose swarmId or participantId carries a tab, LF or CR is refused
// by name (`ledger_field_not_tab_safe`) rather than written as a corrupt line.
//
// Usage:
//   node bend2/scripts/ledger-stream.mjs [ledger] [--out <file>]
//
//   ledger   the ledger to decode; defaults to the coordination ledger this deployment runs on
//   --out    the file to write the stream to; defaults to stdout
//
// Exit: 0 when the whole ledger decoded; 1 on a named refusal printed to stderr with its code.
//
// The stderr summary is one line: the rows read and written, the per-kind counts, and the evidence
// for the compaction question — the seq range the file carries, whether that range is contiguous,
// and whether the store keeps archived segment files beside the ledger.

import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

/** The eight kinds Contract A writes. */
export const PROJECTION_KINDS = Object.freeze([
  'swarm.participant_joined',
  'swarm.participant_left',
  'swarm.contribution_recorded',
  'swarm.contribution_reviewed',
  'swarm.contribution_integrated',
  'swarm.work_updated',
  'swarm.assignment_updated',
  'swarm.closed',
]);

const KIND_SET = new Set(PROJECTION_KINDS);
const REVIEW_DECISIONS = new Set(['accept', 'reject', 'comment']);
const TAB_UNSAFE = /[\t\n\r]/;
const DRIVER_KIND = 'driver.recorded';

/** The coordination ledger this deployment serves. */
export const DEFAULT_LEDGER = join(
  '/Users/wahargis/Development/Experiments/baton-resident/.git/baton',
  'application-v3', 'state', 'coordination', 'events.jsonl',
);

/** A decode that stops: the row and field ride the error, so a caller can name what to fix. */
export class LedgerDecodeRefusal extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'LedgerDecodeRefusal';
    this.code = code;
    this.detail = detail;
  }
}

/** The kind the projection reads for one ledger row, or null when the row is outside its set. */
export function effectiveKind(row) {
  const top = row?.kind;
  if (top !== DRIVER_KIND) return typeof top === 'string' ? top : null;
  const inner = row.payload?.kind;
  return typeof inner === 'string' ? inner : null;
}

function projectionField(payload, name, seq) {
  const value = payload?.[name];
  if (value === undefined || value === null) return '-';
  if (typeof value !== 'string') {
    throw new LedgerDecodeRefusal(
      `ledger row ${seq} carries a non-string ${name}`, 'ledger_field_not_string',
      { seq, field: name, type: typeof value },
    );
  }
  if (TAB_UNSAFE.test(value)) {
    throw new LedgerDecodeRefusal(
      `ledger row ${seq} carries a ${name} holding a tab, LF or CR`, 'ledger_field_not_tab_safe',
      { seq, field: name, value: JSON.stringify(value) },
    );
  }
  return value;
}

/**
 * One Contract A line for one ledger row, or null when the row's effective kind is outside the
 * eight the projection reads.
 */
export function decodeRow(row) {
  const kind = effectiveKind(row);
  if (kind === null || !KIND_SET.has(kind)) return null;
  if (!Number.isSafeInteger(row?.seq)) {
    throw new LedgerDecodeRefusal(
      `ledger row ${row?.seq} carries no integer seq`, 'ledger_seq_not_scalar', { seq: row?.seq ?? null },
    );
  }
  const payload = row.payload;
  const swarmId = projectionField(payload, 'swarmId', row.seq);
  const participantId = projectionField(payload, 'participantId', row.seq);
  let decision = '-';
  if (kind === 'swarm.contribution_reviewed') {
    const recorded = payload?.decision;
    if (!REVIEW_DECISIONS.has(recorded)) {
      throw new LedgerDecodeRefusal(
        `ledger row ${row.seq} carries a review decision outside the admitted set`,
        'ledger_decision_not_admitted',
        { seq: row.seq, decision: recorded ?? null, admitted: [...REVIEW_DECISIONS] },
      );
    }
    decision = recorded;
  }
  return [row.seq, kind, swarmId, participantId, decision].join('\t');
}

/** Calls `onLine` for every LF-terminated line, holding one line at a time. */
export async function readLedgerLines(path, onLine) {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let carry = '';
  let lineNo = 0;
  for await (const chunk of stream) {
    carry += chunk;
    let start = 0;
    for (;;) {
      const nl = carry.indexOf('\n', start);
      if (nl === -1) break;
      lineNo += 1;
      await onLine(carry.slice(start, nl), lineNo);
      start = nl + 1;
    }
    carry = carry.slice(start);
  }
  return { lines: lineNo, trailing: carry };
}

/**
 * Decodes `ledgerPath` through `write`, one Contract A line at a time. Returns the counts the
 * stderr summary reports.
 */
export async function decodeLedger({ ledgerPath, write, writeFailure }) {
  const counts = new Map(PROJECTION_KINDS.map((kind) => [kind, 0]));
  let rowsRead = 0;
  let rowsEmitted = 0;
  let seqFirst = null;
  let seqLast = null;
  let seqBreaks = 0;

  const { lines, trailing } = await readLedgerLines(ledgerPath, async (line, lineNo) => {
    rowsRead += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new LedgerDecodeRefusal(
        `ledger line ${lineNo} is not JSON`, 'ledger_row_unparseable',
        { line: lineNo, bytes: Buffer.byteLength(line) },
      );
    }
    const kind = effectiveKind(row);
    if (kind === null || !KIND_SET.has(kind)) return;
    const decoded = decodeRow(row);
    if (Number.isSafeInteger(row.seq)) {
      if (seqFirst === null) seqFirst = row.seq;
      else if (row.seq !== seqLast + 1) seqBreaks += 1;
      seqLast = row.seq;
    }
    counts.set(kind, counts.get(kind) + 1);
    rowsEmitted += 1;
    if (!write(decoded + '\n') && writeFailure !== undefined) {
      await Promise.race([once(write, 'drain'), writeFailure]);
    }
  });

  return {
    ledgerPath,
    rowsRead,
    rowsEmitted,
    lines,
    seqFirst,
    seqLast,
    seqBreaks,
    trailingBytes: Buffer.byteLength(trailing),
    counts,
    segmentsDir: existsSync(join(dirname(ledgerPath), 'segments')),
    ledgerBytes: statSync(ledgerPath).size,
  };
}

function summaryLine(stats) {
  const kinds = PROJECTION_KINDS
    .map((kind) => `${kind.slice('swarm.'.length)}:${stats.counts.get(kind)}`)
    .join(',');
  return 'ledger-stream:'
    + ` ledger=${stats.ledgerPath}`
    + ` bytes=${stats.ledgerBytes}`
    + ` rows_read=${stats.rowsRead}`
    + ` rows_emitted=${stats.rowsEmitted}`
    + ` seq_first=${stats.seqFirst ?? 'none'}`
    + ` seq_last=${stats.seqLast ?? 'none'}`
    + ` seq_breaks=${stats.seqBreaks}`
    + ` trailing_partial_bytes=${stats.trailingBytes}`
    + ` segments_dir=${stats.segmentsDir ? 'present' : 'absent'}`
    + ` kinds=${kinds}`;
}

const USAGE = 'usage: node bend2/scripts/ledger-stream.mjs [ledger] [--out <file>]';

export async function main(argv) {
  let ledgerPath = null;
  let outPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      if (i + 1 >= argv.length) throw new LedgerDecodeRefusal('--out needs a file', 'ledger_stream_usage');
      outPath = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n');
      return 0;
    } else if (arg.startsWith('--')) {
      throw new LedgerDecodeRefusal(`unknown option ${arg}`, 'ledger_stream_usage', { option: arg });
    } else if (ledgerPath === null) {
      ledgerPath = arg;
    } else {
      throw new LedgerDecodeRefusal(`unexpected argument ${arg}`, 'ledger_stream_usage', { argument: arg });
    }
  }
  ledgerPath = ledgerPath ?? DEFAULT_LEDGER;
  if (!existsSync(ledgerPath)) {
    throw new LedgerDecodeRefusal(`ledger ${ledgerPath} is not readable`, 'ledger_missing', { path: ledgerPath });
  }

  const out = outPath === null ? process.stdout : createWriteStream(outPath, { encoding: 'utf8' });
  const writeFailure = new Promise((_, reject) => { out.once('error', reject); });
  try {
    const stats = await decodeLedger({ ledgerPath, write: (text) => out.write(text), writeFailure });
    process.stderr.write(summaryLine(stats) + '\n');
  } finally {
    if (outPath !== null) {
      out.end();
      await once(out, 'finish');
    }
  }
  return 0;
}

/** True when this module is the process entry, given either a path or a file URL in argv[1]. */
function invokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === (entry.startsWith('file:') ? entry : pathToFileURL(entry).href);
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      if (error instanceof LedgerDecodeRefusal) {
        process.stderr.write(`ledger-stream: refused ${error.code}: ${error.message}\n`);
      } else {
        process.stderr.write(`ledger-stream: failed: ${error?.stack ?? error}\n`);
      }
      process.exitCode = 1;
    },
  );
}
