#!/usr/bin/env node
// bend2/scripts/resident-fold-baseline.mjs — the JS arm of the Phase 1 shadow core.
//
// It prints the Contract B projection for a Contract A stream, and in the same run it folds the
// same rows with the RESIDENT'S OWN fold — `foldSwarmEvent` from impl/src/swarm-state.mjs, the
// function the coordination store replays through (impl/src/coordination-ledger.mjs) — so the
// baseline stands on the resident's machinery rather than on a fold written here.
//
// The printed numbers are Contract B's own: joined, left, contrib, review, accept, integrated,
// work and assign are counts of stream rows, active is joined minus left, closed is one when a
// swarm.closed row exists, and a participant reads left when a swarm.participant_left row names it
// for that swarm. That projection is the parity object both arms print, so the harness's verdict
// compares the Bend2 module against it.
//
// The fold answers the same fields from its own state, and the two disagree where the stream's
// grain differs from the fold's: Contract A carries one line per EVENT, and the fold keeps one row
// per identity (participant, contribution, work item, assignment), so a family whose events repeat
// an identity reads lower in the fold than its row count. Every such difference is printed to
// stderr, one line per swarm and family, naming both numbers. That report is the finding; stdout
// stays the Contract B text.
//
// The stream is five fields wide and drops the identities the fold's referential integrity needs
// (contributionId, workId, assignmentId, reviewerId, the integration receipt), so the fold is
// driven from the ledger rows the stream names, with the `swarm.created` row the fold needs to
// have a swarm to attach an event to. When the fold refuses, the arm reports the refusal by name
// and still prints the Contract B projection.
//
// Usage:
//   node bend2/scripts/resident-fold-baseline.mjs <stream-file> [--ledger <events.jsonl>]
//
// Exit: 0 when the projection printed; 1 when the stream could not be read, with the refusal's
// own name on stderr.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_LEDGER, LedgerDecodeRefusal, effectiveKind, readLedgerLines } from './ledger-stream.mjs';
import { foldSwarmEvent } from '../../impl/src/swarm-state.mjs';

const STREAM_FIELDS = 5;

/** Ascending byte order of a set of identifiers. */
export function byteOrder(ids) {
  return [...ids].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
}

function emptyCounts() {
  return {
    joined: 0, left: 0, recorded: 0, reviewed: 0, accept: 0, integrated: 0, work: 0, assign: 0, closed: 0,
  };
}

function countFor(counts, kind, decision) {
  switch (kind) {
    case 'swarm.participant_joined': counts.joined += 1; break;
    case 'swarm.participant_left': counts.left += 1; break;
    case 'swarm.contribution_recorded': counts.recorded += 1; break;
    case 'swarm.contribution_reviewed':
      counts.reviewed += 1;
      if (decision === 'accept') counts.accept += 1;
      break;
    case 'swarm.contribution_integrated': counts.integrated += 1; break;
    case 'swarm.work_updated': counts.work += 1; break;
    case 'swarm.assignment_updated': counts.assign += 1; break;
    case 'swarm.closed': counts.closed += 1; break;
    default: break;
  }
}

/** The stream's own reading: the seqs it names, the rows per swarm and family, and the seat sets. */
export async function readStream(streamPath) {
  const seqs = new Set();
  const counts = new Map();
  const joined = new Map();
  const left = new Map();
  const order = [];
  let rows = 0;
  let head = 0;

  const { trailing } = await readLedgerLines(streamPath, (line, lineNo) => {
    if (line.length === 0) {
      throw new LedgerDecodeRefusal(`stream line ${lineNo} is empty`, 'stream_row_malformed', { line: lineNo });
    }
    const parts = line.split('\t');
    if (parts.length !== STREAM_FIELDS) {
      throw new LedgerDecodeRefusal(
        `stream line ${lineNo} carries ${parts.length} fields where ${STREAM_FIELDS} are expected`,
        'stream_row_malformed', { line: lineNo, fields: parts.length },
      );
    }
    const [seqText, kind, swarmId, participantId, decision] = parts;
    const seq = Number(seqText);
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new LedgerDecodeRefusal(
        `stream line ${lineNo} carries seq ${seqText}`, 'stream_seq_not_scalar', { line: lineNo, seq: seqText },
      );
    }
    rows += 1;
    if (seq > head) head = seq;
    seqs.add(seq);
    if (!counts.has(swarmId)) {
      counts.set(swarmId, emptyCounts());
      joined.set(swarmId, new Set());
      left.set(swarmId, new Set());
      order.push(swarmId);
    }
    countFor(counts.get(swarmId), kind, decision);
    if (kind === 'swarm.participant_joined') joined.get(swarmId).add(participantId);
    if (kind === 'swarm.participant_left') left.get(swarmId).add(participantId);
  });

  if (trailing.length !== 0) {
    throw new LedgerDecodeRefusal(
      `stream ends with ${Buffer.byteLength(trailing)} bytes that are not a terminated line`,
      'stream_trailing_partial', { bytes: Buffer.byteLength(trailing) },
    );
  }
  return { streamPath, seqs, counts, joined, left, order, rows, head };
}

/**
 * Folds every ledger row the stream names, plus the `swarm.created` rows the fold needs to have a
 * swarm to attach an event to. Returns the fold's swarm map or the refusal it raised.
 */
export async function foldStream({ ledgerPath, seqs }) {
  const swarms = new Map();
  const foldedKinds = new Map();
  const seen = new Set();
  let folded = 0;
  let seeds = 0;

  try {
    await readLedgerLines(ledgerPath, (line) => {
      const row = JSON.parse(line);
      const kind = effectiveKind(row);
      const isSeed = kind === 'swarm.created';
      if (!isSeed && !seqs.has(row.seq)) return;
      const event = kind === row.kind ? row : { ...row, kind };
      foldSwarmEvent(swarms, event);
      if (isSeed) {
        seeds += 1;
        return;
      }
      seen.add(row.seq);
      folded += 1;
      foldedKinds.set(kind, (foldedKinds.get(kind) ?? 0) + 1);
    });
  } catch (error) {
    const code = error?.code ?? 'resident_fold_failed';
    return { ok: false, refusal: { code, message: String(error?.message ?? error) } };
  }
  const missing = [...seqs].filter((seq) => !seen.has(seq)).length;
  return { ok: true, swarms, foldedKinds, folded, seeds, missing };
}

function reviewsOf(swarm) {
  let review = 0;
  let accept = 0;
  for (const rows of Object.values(swarm.reviews)) {
    review += rows.length;
    for (const row of rows) if (row.decision === 'accept') accept += 1;
  }
  return { review, accept };
}

/** The resident fold's own reading of one swarm, in the fields Contract B names. */
function foldedFields(swarm) {
  const participants = Object.values(swarm.participants);
  const joined = participants.length;
  const left = participants.filter((participant) => participant.status === 'left').length;
  const { review, accept } = reviewsOf(swarm);
  return {
    joined,
    left,
    active: Math.max(0, joined - left),
    contrib: Object.keys(swarm.contributions).length,
    accept,
    review,
    integrated: Object.values(swarm.contributions)
      .filter((contribution) => contribution.integration !== undefined).length,
    work: Object.keys(swarm.work).length,
    assign: Object.keys(swarm.assignments).length,
    closed: swarm.status === 'closed' ? 1 : 0,
  };
}

/** The Contract B text for a stream, and the resident fold's own numbers for every swarm. */
export function contractLines(scope) {
  const swarmIds = byteOrder(scope.counts.keys());
  const lines = [];
  const folded = new Map();
  let participantLines = 0;

  for (const swarmId of swarmIds) {
    const counts = scope.counts.get(swarmId);
    const active = Math.max(0, counts.joined - counts.left);
    const closed = counts.closed === 0 ? 0 : 1;
    const participants = byteOrder(scope.joined.get(swarmId));
    lines.push(`swarm ${swarmId} joined=${counts.joined} active=${active} left=${counts.left}`
      + ` contrib=${counts.recorded} accept=${counts.accept} review=${counts.reviewed}`
      + ` integrated=${counts.integrated} work=${counts.work} assign=${counts.assign} closed=${closed}`);
    for (const participantId of participants) {
      if (participantId === '-') continue;
      const status = scope.left.get(swarmId).has(participantId) ? 'left' : 'active';
      lines.push(`participant ${swarmId} ${participantId} status=${status}`);
      participantLines += 1;
    }
    folded.set(swarmId, {
      joined: counts.joined,
      active,
      left: counts.left,
      contrib: counts.recorded,
      accept: counts.accept,
      review: counts.reviewed,
      integrated: counts.integrated,
      work: counts.work,
      assign: counts.assign,
      closed,
    });
  }

  lines.push(`total rows=${scope.rows} head=${scope.head} swarms=${swarmIds.length}`
    + ` participants=${participantLines}`);
  return { lines, asRows: folded };
}

/** Every (swarm, field) where the resident fold's own number differs from the Contract B count. */
export function divergences({ swarms, asRows }) {
  const rows = [];
  for (const swarmId of byteOrder(asRows.keys())) {
    const swarm = swarms.get(swarmId);
    if (swarm === undefined) {
      rows.push({ swarmId, field: '(swarm)', residentFold: null, streamRows: null, note: 'no ledger row' });
      continue;
    }
    const own = foldedFields(swarm);
    const stream = asRows.get(swarmId);
    for (const field of Object.keys(own)) {
      if (own[field] !== stream[field]) {
        rows.push({ swarmId, field, residentFold: own[field], streamRows: stream[field] });
      }
    }
  }
  return rows;
}

const USAGE = 'usage: node bend2/scripts/resident-fold-baseline.mjs <stream-file> [--ledger <events.jsonl>]';

export async function main(argv) {
  let streamPath = null;
  let ledgerPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ledger') {
      if (i + 1 >= argv.length) throw new LedgerDecodeRefusal('--ledger needs a file', 'resident_fold_usage');
      ledgerPath = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n');
      return 0;
    } else if (arg.startsWith('--')) {
      throw new LedgerDecodeRefusal(`unknown option ${arg}`, 'resident_fold_usage', { option: arg });
    } else if (streamPath === null) {
      streamPath = resolve(arg);
    } else {
      throw new LedgerDecodeRefusal(`unexpected argument ${arg}`, 'resident_fold_usage', { argument: arg });
    }
  }
  if (streamPath === null) throw new LedgerDecodeRefusal('a stream file is required', 'resident_fold_usage');
  ledgerPath = ledgerPath === null ? DEFAULT_LEDGER : resolve(ledgerPath);

  const scope = await readStream(streamPath);
  const { lines, asRows } = contractLines(scope);
  process.stdout.write(lines.join('\n') + '\n');

  const fold = await foldStream({ ledgerPath, seqs: scope.seqs });
  if (!fold.ok) {
    process.stderr.write('resident-fold-baseline:'
      + ` stream=${streamPath} ledger=${ledgerPath} stream_rows=${scope.rows}`
      + ` resident_fold=refused code=${fold.refusal.code} message=${fold.refusal.message}\n`);
    return 0;
  }
  const differing = divergences({ swarms: fold.swarms, asRows });
  process.stderr.write('resident-fold-baseline:'
    + ` stream=${streamPath} ledger=${ledgerPath}`
    + ` stream_rows=${scope.rows} events_folded=${fold.folded} fold_seeds=${fold.seeds}`
    + ` stream_rows_absent_from_ledger=${fold.missing} swarms=${asRows.size}`
    + ` divergences=${differing.length}\n`);
  for (const row of differing) {
    process.stderr.write('resident-fold-baseline: divergence'
      + ` swarm=${row.swarmId} field=${row.field}`
      + ` resident_fold=${row.residentFold} contract_rows=${row.streamRows}\n`);
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
        process.stderr.write(`resident-fold-baseline: refused ${error.code}: ${error.message}\n`);
      } else {
        process.stderr.write(`resident-fold-baseline: failed: ${error?.stack ?? error}\n`);
      }
      process.exitCode = 1;
    },
  );
}
