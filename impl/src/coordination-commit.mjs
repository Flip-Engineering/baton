// Commit cursors belong to one live writer. Reopening a store verifies its replayed tail
// with fsync before publishing a cursor to a delivery consumer.
const subscriptions = new WeakMap();
const failure = (code, message) => Object.assign(new Error(message), { code });

export function closeCommitWaiters(store, error = failure('coordination_commit_closed', 'coordination writer released')) {
  const state = subscriptions.get(store);
  if (!state) return;
  subscriptions.delete(store);
  for (const waiter of [...state.waiters]) waiter.finish(null, error);
}

export function ledgerCommitFailed(store) {
  closeCommitWaiters(store, Object.assign(failure('coordination_ledger_unsynced',
    'coordination ledger sync failed; commit remains unconfirmed'), {
    causeCode: store._ledgerSyncFailure?.code ?? 'coordination_ledger_sync_failed',
  }));
}

export function ledgerCommitted(store, throughSeq) {
  const state = subscriptions.get(store);
  if (!state) return;
  try {
    if (store._writerLease?.token !== state.owner) {
      throw failure('coordination_writer_lost', 'coordination commit writer changed');
    }
    store._assertWriterLease();
  } catch (error) {
    closeCommitWaiters(store, error);
    return;
  }
  state.throughSeq = throughSeq;
  for (const waiter of [...state.waiters]) {
    if (state.throughSeq > waiter.afterSeq) waiter.finish(Object.freeze({ upperBound: state.throughSeq }));
  }
}

/** Resolve after a successful ledger sync covers rows beyond the cursor. The caller reads
 * only through upperBound and resumes from that cursor. Abort and writer release end the
 * subscription; neither changes a source obligation or a delivery disposition. */
export async function waitForCommit(store, afterSeq, options = {}) {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > store._events.length
    || !options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => key !== 'signal')
    || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
    throw new TypeError('coordination commit wait requires a current cursor and optional AbortSignal');
  }
  const { signal } = options;
  if (signal?.aborted) throw failure('coordination_commit_aborted', 'coordination commit wait aborted');
  if (store._deferredLoad) throw failure('coordination_store_loading', 'coordination store is still replaying');
  if (!store._writerLease) throw failure('coordination_writer_lost', 'coordination commit wait requires the writer lease');
  store._assertWriterLease();
  let state = subscriptions.get(store);
  if (state && state.owner !== store._writerLease.token) {
    closeCommitWaiters(store, failure('coordination_writer_lost', 'coordination commit writer changed'));
    state = null;
  }
  if (!state) {
    state = { owner: store._writerLease.token, throughSeq: 0, waiters: new Set() };
    subscriptions.set(store, state);
  }
  if (state.throughSeq > afterSeq) return Object.freeze({ upperBound: state.throughSeq });
  return new Promise((resolve, reject) => {
    const abort = () => waiter.finish(null, failure('coordination_commit_aborted', 'coordination commit wait aborted'));
    const waiter = {
      afterSeq,
      finish(value, error) {
        if (!state.waiters.delete(waiter)) return;
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      },
    };
    state.waiters.add(waiter);
    signal?.addEventListener('abort', abort, { once: true });
    // A previously synced or replayed tail may precede this first subscription. Appends
    // arriving after registration already schedule the same group-commit operation.
    if (store._events.length > state.throughSeq) store._scheduleLedgerSync();
  });
}
