import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalJson } from './canonical-order.mjs';
import { acquireResidentLease } from './resident-authority.mjs';

const MAGIC = Buffer.from('BATON592');
const CHECKPOINT_MAGIC = Buffer.from('BATON59C');
const HEADER_BYTES = 76;
const ZERO = '0'.repeat(64);
const hash = (value) => createHash('sha256').update(value).digest();
const json = (value) => JSON.stringify(canonicalJson(value));
const digest = (value) => hash(json(value)).toString('hex');
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = (value) => typeof value === 'string' && value.length > 0;
const exact = (value, keys) => value && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function frame(value) {
  const body = Buffer.from(json(value));
  const header = Buffer.alloc(HEADER_BYTES);
  (value.kind === 'checkpoint' ? CHECKPOINT_MAGIC : MAGIC).copy(header);
  header.writeUInt32BE(body.length, 8);
  hash(header.subarray(0, 12)).copy(header, 12);
  hash(body).copy(header, 44);
  return Buffer.concat([header, body]);
}

function decode(bytes) {
  let offset = 0;
  const records = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < HEADER_BYTES) {
      if (bytes.subarray(offset, offset + 8).equals(CHECKPOINT_MAGIC)) {
        throw fail('delivery_journal_corrupt', 'delivery checkpoint is incomplete');
      }
      break;
    }
    const header = bytes.subarray(offset, offset + HEADER_BYTES);
    const checkpoint = header.subarray(0, 8).equals(CHECKPOINT_MAGIC);
    if ((!checkpoint && !header.subarray(0, 8).equals(MAGIC))
      || !header.subarray(12, 44).equals(hash(header.subarray(0, 12)))) {
      throw fail('delivery_journal_corrupt', 'delivery journal frame header is corrupt');
    }
    const end = offset + HEADER_BYTES + header.readUInt32BE(8);
    if (end > bytes.length) {
      if (checkpoint) throw fail('delivery_journal_corrupt', 'delivery checkpoint is incomplete');
      break;
    }
    const body = bytes.subarray(offset + HEADER_BYTES, end);
    if (!header.subarray(44).equals(hash(body))) {
      throw fail('delivery_journal_corrupt', 'delivery journal frame checksum is corrupt');
    }
    try {
      const record = JSON.parse(body.toString('utf8'));
      if ((record.kind === 'checkpoint') !== checkpoint) throw new Error('frame kind mismatch');
      records.push(record);
    }
    catch { throw fail('delivery_journal_corrupt', 'delivery journal frame JSON is invalid'); }
    offset = end;
  }
  return { records, validBytes: offset };
}

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeAll(fd, bytes) {
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(fd, bytes, written, bytes.length - written);
    if (count <= 0) throw fail('delivery_journal_write_failed', 'delivery journal write made no progress');
    written += count;
  }
}

function validateBatch(batch) {
  if (!exact(batch, ['dispatchId', 'recipient', 'generation', 'requestKey', 'itemKeys', 'input'])
    || ![batch.dispatchId, batch.generation, batch.requestKey].every(text)
    || !batch.recipient || !['root', 'seat'].includes(batch.recipient.kind)
    || (batch.recipient.kind === 'root' ? !exact(batch.recipient, ['kind'])
      : !exact(batch.recipient, ['kind', 'participantId', 'swarmId'])
        || !text(batch.recipient.participantId) || !text(batch.recipient.swarmId))
    || !Array.isArray(batch.itemKeys) || batch.itemKeys.length === 0
    || !batch.itemKeys.every(text) || new Set(batch.itemKeys).size !== batch.itemKeys.length
    || !text(batch.input)) throw fail('delivery_batch_invalid', 'delivery batch is invalid');
  return copy(canonicalJson(batch));
}

function validateReceipt(receipt) {
  if (!exact(receipt, ['receiptId', 'generation', 'state', 'evidence'])
    || !text(receipt.receiptId) || !text(receipt.generation)
    || !['offered_unknown', 'accepted', 'processing', 'processed', 'uncertain', 'refused'].includes(receipt.state)
    || !receipt.evidence || typeof receipt.evidence !== 'object' || Array.isArray(receipt.evidence)) {
    throw fail('delivery_receipt_invalid', 'delivery receipt is invalid');
  }
  return copy(canonicalJson(receipt));
}

/** The host commits input and native evidence here before acknowledging either over IPC.
 * Import acknowledgments name coordination commits. Business resolution stays in source state. */
export class DeliveryJournal {
  #lease;
  #fd;
  #poison = null;
  #seq = 0;
  #tail = ZERO;
  #entries = new Map();
  #batches = new Map();
  #boundary;
  #identity;

  constructor({ root, repoId, deploymentId, onPersistenceBoundary = () => {} }) {
    if (![repoId, deploymentId].every((value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value))
      || typeof onPersistenceBoundary !== 'function') {
      throw new TypeError('delivery journal requires deployment identity and a persistence callback');
    }
    try { mkdirSync(root, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = lstatSync(root);
    const uid = process.getuid?.() ?? null;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || (uid !== null && stat.uid !== uid)) {
      throw fail('delivery_journal_unsafe', 'delivery journal directory must be private and owned');
    }
    Object.defineProperties(this, {
      root: { value: realpathSync(root), enumerable: true },
      path: { value: join(realpathSync(root), 'delivery.journal'), enumerable: true },
    });
    this.#boundary = onPersistenceBoundary;
    this.#identity = { repoId, deploymentId };
    this.#lease = acquireResidentLease(this.root, repoId, deploymentId, uid, Date.now,
      { name: 'delivery.lease' });
    try {
      syncDirectory(dirname(this.root));
      this.#fd = openSync(this.path, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND
        | (constants.O_NOFOLLOW ?? 0), 0o600);
      const file = fstatSync(this.#fd);
      if (!file.isFile() || file.nlink !== 1 || (file.mode & 0o077) !== 0
        || (uid !== null && file.uid !== uid)) throw fail('delivery_journal_unsafe', 'delivery journal file is unsafe');
      const bytes = readFileSync(this.#fd);
      const { records, validBytes } = decode(bytes);
      for (const record of records) this.#replay(record);
      if (validBytes !== bytes.length) ftruncateSync(this.#fd, validBytes);
      fsyncSync(this.#fd);
      for (const name of readdirSync(this.root)) {
        if (/^\.delivery-[a-f0-9-]{36}\.tmp$/.test(name)) unlinkSync(join(this.root, name));
      }
      syncDirectory(this.root);
    } catch (error) {
      if (this.#fd !== undefined) closeSync(this.#fd);
      this.#fd = undefined;
      this.#lease.release();
      throw error;
    }
  }

  #assertOpen() {
    if (this.#fd === undefined) throw fail('delivery_journal_closed', 'delivery journal is closed');
    if (this.#poison) throw fail('delivery_journal_unsynced', 'delivery journal requires recovery after a storage failure');
    this.#lease.assertHeld();
  }

  #replay(record) {
    if (record?.version !== 1 || json(record.identity ?? null) !== json(this.#identity)
      || !Number.isSafeInteger(record.seq) || record.seq < 1) {
      throw fail('delivery_journal_corrupt', 'delivery journal record is invalid');
    }
    if (record.kind === 'checkpoint') {
      if (this.#seq !== 0 || !Array.isArray(record.entries) || !/^[a-f0-9]{64}$/.test(record.tail ?? '')) {
        throw fail('delivery_journal_corrupt', 'delivery journal checkpoint is invalid');
      }
      for (const entry of record.entries) this.#restoreEntry(entry);
      this.#seq = record.seq;
      this.#tail = record.tail;
      return;
    }
    if (record.seq !== this.#seq + 1 || record.previous !== this.#tail) {
      throw fail('delivery_journal_corrupt', 'delivery journal sequence or predecessor changed');
    }
    if (record.kind === 'entry') this.#restoreEntry(record.entry);
    else if (record.kind === 'imported') {
      const entry = this.#entries.get(record.entryId);
      if (!entry || !Number.isSafeInteger(record.coordinationSeq) || record.coordinationSeq < 1
        || entry.importedAt !== null) throw fail('delivery_journal_corrupt', 'delivery import acknowledgment is invalid');
      entry.importedAt = record.coordinationSeq;
    } else throw fail('delivery_journal_corrupt', 'delivery journal record kind is invalid');
    this.#seq = record.seq;
    this.#tail = digest(record);
  }

  #restoreEntry(entry) {
    if (!entry || !text(entry.entryId) || this.#entries.has(entry.entryId)
      || !['prepared', 'receipt'].includes(entry.kind) || !text(entry.dispatchId)
      || !/^[a-f0-9]{64}$/.test(entry.digest ?? '')
      || !(entry.importedAt === null || (Number.isSafeInteger(entry.importedAt) && entry.importedAt > 0))) {
      throw fail('delivery_journal_corrupt', 'delivery journal entry is invalid');
    }
    if (entry.body !== null && digest(entry.body) !== entry.digest) {
      throw fail('delivery_journal_corrupt', 'delivery entry digest changed');
    }
    if (entry.kind === 'prepared') {
      const batch = validateBatch(entry.body);
      if (batch.dispatchId !== entry.dispatchId || entry.entryId !== `prepared:${batch.dispatchId}`
        || this.#batches.has(batch.dispatchId)) throw fail('delivery_journal_corrupt', 'prepared batch identity changed');
      this.#batches.set(batch.dispatchId, batch);
    } else {
      const batch = this.#batches.get(entry.dispatchId);
      if (!batch || !entry.summary || entry.summary.generation !== batch.generation
        || entry.entryId !== `receipt:${digest([entry.dispatchId, entry.summary.receiptId])}`
        || (entry.body === null && entry.importedAt === null)) {
        throw fail('delivery_journal_corrupt', 'delivery receipt identity changed');
      }
      if (entry.body !== null) {
        const receipt = validateReceipt(entry.body);
        const { evidence, ...summary } = receipt;
        if (json(summary) !== json(entry.summary)) throw fail('delivery_journal_corrupt', 'delivery receipt summary changed');
      }
    }
    this.#entries.set(entry.entryId, copy(entry));
  }

  #append(fields) {
    this.#assertOpen();
    const record = { version: 1, identity: this.#identity, seq: this.#seq + 1, previous: this.#tail, ...fields };
    const bytes = frame(record);
    try {
      // Splitting the write exposes a deterministic crash boundary in subprocess tests.
      writeAll(this.#fd, bytes.subarray(0, HEADER_BYTES));
      this.#boundary('append_header');
      writeAll(this.#fd, bytes.subarray(HEADER_BYTES));
      this.#boundary('append_body');
      fsyncSync(this.#fd);
      this.#boundary('append_sync');
      this.#replay(record);
    } catch (error) { this.#poison = error; throw error; }
  }

  prepare(input) {
    this.#assertOpen();
    const batch = validateBatch(input);
    const entryId = `prepared:${batch.dispatchId}`;
    const prior = this.#entries.get(entryId);
    const batchDigest = digest(batch);
    if (prior) {
      if (prior.digest !== batchDigest) throw fail('delivery_batch_conflict', 'dispatch identity already names another input');
      return copy(prior);
    }
    const entry = { entryId, dispatchId: batch.dispatchId, kind: 'prepared', digest: batchDigest,
      body: batch, importedAt: null };
    this.#append({ kind: 'entry', entry });
    return copy(entry);
  }

  recordReceipt(dispatchId, input) {
    this.#assertOpen();
    const receipt = validateReceipt(input);
    const batch = this.#batches.get(dispatchId);
    if (!batch) throw fail('delivery_batch_unknown', 'receipt requires a prepared batch');
    if (receipt.generation !== batch.generation) throw fail('delivery_generation_mismatch', 'receipt belongs to another controller generation');
    const entryId = `receipt:${digest([dispatchId, receipt.receiptId])}`;
    const receiptDigest = digest(receipt);
    const prior = this.#entries.get(entryId);
    if (prior) {
      if (prior.digest !== receiptDigest) throw fail('delivery_receipt_conflict', 'receipt identity already names other evidence');
      return copy(prior);
    }
    const { evidence, ...summary } = receipt;
    const entry = { entryId, dispatchId, kind: 'receipt', digest: receiptDigest,
      summary, body: receipt, importedAt: null };
    this.#append({ kind: 'entry', entry });
    return copy(entry);
  }

  entries() { this.#assertOpen(); return [...this.#entries.values()].map(copy); }
  pendingImports() { return this.entries().filter((entry) => entry.importedAt === null); }

  acknowledgeImport(entryId, coordinationSeq) {
    this.#assertOpen();
    const entry = this.#entries.get(entryId);
    if (!entry || !Number.isSafeInteger(coordinationSeq) || coordinationSeq < 1) {
      throw fail('delivery_import_invalid', 'import acknowledgment requires an entry and committed coordination sequence');
    }
    if (entry.importedAt !== null) {
      if (entry.importedAt !== coordinationSeq) throw fail('delivery_import_conflict', 'entry already has another import identity');
      return;
    }
    this.#append({ kind: 'imported', entryId, coordinationSeq });
  }

  async importPending(store, { actor = 'session-host', signal } = {}) {
    for (const entry of this.pendingImports()) {
      const { event } = store.recordDriver('attention.delivery_recorded', {
        entryId: entry.entryId, dispatchId: entry.dispatchId, deliveryKind: entry.kind,
        digest: entry.digest, body: entry.body,
      }, { actor, key: `attention-delivery:${entry.entryId}` });
      await store.waitForCommit(event.seq - 1, { signal });
      this.acknowledgeImport(entry.entryId, event.seq);
    }
  }

  checkpoint() {
    this.#assertOpen();
    if (this.#seq === 0) return;
    const entries = this.entries().map((entry) => entry.kind === 'receipt' && entry.importedAt !== null
      ? { ...entry, body: null } : entry);
    const snapshot = frame({ version: 1, identity: this.#identity, kind: 'checkpoint', seq: this.#seq, tail: this.#tail, entries });
    const temporary = join(this.root, `.delivery-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeAll(fd, snapshot);
      this.#boundary('checkpoint_write');
      fsyncSync(fd);
      this.#boundary('checkpoint_sync');
      closeSync(fd); fd = undefined;
      renameSync(temporary, this.path);
      this.#boundary('checkpoint_rename');
      syncDirectory(this.root);
      this.#boundary('checkpoint_directory_sync');
      closeSync(this.#fd); this.#fd = undefined;
      this.#fd = openSync(this.path, constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
      this.#entries = new Map(entries.map((entry) => [entry.entryId, entry]));
    } catch (error) { this.#poison = error; throw error; }
    finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  close() {
    if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; }
    return this.#lease.release();
  }
}
