import { AttentionSource, attentionRecipientKey as recipientKey } from './attention-source.mjs';
import { randomUUID } from 'node:crypto';
import { SWARM_EVENT_KINDS } from './swarm-state.mjs';

const sourceChange = (event) => SWARM_EVENT_KINDS.has(event.kind)
  || ['swarm.turn_reported', 'swarm.guidance_sent', 'swarm.guidance_parked', 'swarm.root_attention_owed']
    .includes(event.payload?.kind);

/** resolveRecipient reads authenticated runtime attachments. sendAttention resolves when the
 * native input arbiter can accept further input; its result describes observed native evidence.
 * A ready callback follows attachment, reconnection, or the end of an independently busy turn. */
export class AttentionDispatcher {
  #store;
  #resolve;
  #fault;
  #source = new AttentionSource();
  #abort = new AbortController();
  #serial = Promise.resolve();
  #loop;
  #recipients = new Map();
  #closed = false;

  constructor({ store, resolveRecipient, onFault }) {
    this.#store = store;
    this.#resolve = resolveRecipient;
    this.#fault = onFault;
  }

  start() {
    this.#loop ??= this.#watch().catch((error) => {
      if (!this.#closed) this.#fault(error);
    });
    return this;
  }

  #enqueue(work) {
    const result = this.#serial.then(() => this.#closed ? undefined : work());
    this.#serial = result.catch((error) => { if (!this.#closed) this.#fault(error); });
    return result;
  }

  async #watch() {
    while (!this.#closed) {
      const { upperBound } = await this.#store.waitForCommit(this.#source.cursor, { signal: this.#abort.signal });
      await this.#enqueue(() => {
        this.#consume(upperBound);
        this.#dispatch();
      });
    }
  }

  #consume(upperBound) {
    if (upperBound <= this.#source.cursor) return;
    const events = this.#store.eventsView(this.#source.cursor + 1, upperBound - this.#source.cursor);
    this.#source.consume(events);
    if (events.some(sourceChange)) {
      for (const state of this.#recipients.values()) {
        for (const id of state.failed) state.offered.delete(id);
        state.failed.clear();
      }
    }
  }

  async #readCurrent() {
    const head = this.#store.eventCursor();
    if (head <= this.#source.cursor) return;
    const { upperBound } = await this.#store.waitForCommit(head - 1, { signal: this.#abort.signal });
    this.#consume(upperBound);
  }

  /** Process source writes already present when this method is called. */
  flush() {
    return this.#enqueue(async () => { await this.#readCurrent(); this.#dispatch(); });
  }

  ready(recipient) {
    return this.#enqueue(async () => {
      await this.#readCurrent();
      const state = this.#recipients.get(recipientKey(recipient));
      if (state && !state.busy) { state.offered.clear(); state.failed.clear(); }
      this.#dispatch();
    });
  }

  #record(kind, payload, key = `attention-observation:${randomUUID()}`) {
    this.#store.recordDriver(kind, payload, { actor: 'session-host', key });
  }

  #dispatch() {
    if (this.#store.eventCursor() > this.#source.cursor) return;
    const groups = new Map();
    for (const obligation of this.#source.obligations()) {
      const recipient = this.#source.recipientFor(obligation.recipient);
      const key = recipientKey(recipient);
      const rows = groups.get(key) ?? [];
      rows.push({ ...obligation, logicalRecipient: obligation.recipient, recipient }); groups.set(key, rows);
    }
    for (const [key, state] of this.#recipients) {
      if (!groups.has(key) && !state.busy) this.#recipients.delete(key);
    }
    for (const [key, rows] of groups) {
      if (this.#store.eventCursor() > this.#source.cursor) return;
      const recipient = rows[0].recipient;
      const attachment = this.#resolve(recipient);
      if (!attachment) {
        const code = recipient.kind === 'root' ? 'root_unattached' : 'seat_unattached';
        for (const row of rows) this.#record('attention.undelivered', {
          obligationId: row.obligationId, recipient, source: row.source, code,
        }, `attention-undelivered:${row.obligationId}:${key}:${code}`);
        continue;
      }
      let state = this.#recipients.get(key);
      if (!state || state.attachment !== attachment) {
        state = { attachment, offered: new Set(), failed: new Set(), busy: false };
        this.#recipients.set(key, state);
      }
      const owed = new Set(rows.map((row) => row.obligationId));
      for (const id of state.offered) if (!owed.has(id)) state.offered.delete(id);
      if (state.busy || attachment.busy) continue;
      if (rows.every((row) => state.offered.has(row.obligationId))) continue;
      const pending = rows;
      for (const row of pending) state.offered.add(row.obligationId);
      state.busy = true;
      // The source projection was read synchronously at this input boundary. Native input is
      // serialized per recipient; another recipient can receive work while this one is busy.
      let submission;
      try { submission = attachment.sendAttention({ recipient, obligations: pending }); }
      catch (error) { submission = Promise.reject(error); }
      Promise.resolve(submission).then(
        (result) => this.#settled(state, pending, result, null),
        (error) => this.#settled(state, pending, null, error),
      );
    }
  }

  #settled(state, rows, result, error) {
    this.#enqueue(async () => {
      state.busy = false;
      if (error) for (const row of rows) state.failed.add(row.obligationId);
      for (const row of rows) this.#record(error ? 'attention.undelivered' : 'attention.delivery_observed', {
        obligationId: row.obligationId, source: row.source, recipient: row.recipient,
        principalId: state.attachment.principalId, harness: state.attachment.harness,
        ...(error ? { code: error.code ?? 'native_input_failed' } : { result: result ?? { state: 'offered_unknown' } }),
      });
      if (!error && ['accepted', 'delivered', 'processed'].includes(result?.state)) {
        const cursors = new Map();
        for (const row of rows) cursors.set(recipientKey(row.logicalRecipient), { recipient: row.logicalRecipient, cursor: row.seq });
        for (const cursor of cursors.values()) this.#record('attention.delivered', { ...cursor,
          principalId: state.attachment.principalId, harness: state.attachment.harness, result });
      }
      await this.#readCurrent();
      this.#dispatch();
    }).catch(() => {}); // #enqueue reports the storage or projection failure to the owner.
  }

  async close() {
    this.#closed = true;
    this.#abort.abort();
    await this.#loop;
    await this.#serial;
    this.#recipients.clear();
  }
}
