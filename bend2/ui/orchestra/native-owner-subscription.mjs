import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const DECIMAL = /^\d+$/;

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error('The native owner subscription returned invalid JSON.');
  }
}

function readiness(value) {
  if (!value || !DECIMAL.test(String(value.generation))
      || !DECIMAL.test(String(value.cursor)) || typeof value.gap !== 'boolean') {
    throw new Error('The native owner subscription returned invalid readiness.');
  }
  return {
    generation: String(value.generation),
    cursor: String(value.cursor),
    gap: value.gap,
  };
}

function notice(value) {
  if (!value || !['commit', 'gap'].includes(value.kind)
      || !DECIMAL.test(String(value.generation))
      || !DECIMAL.test(String(value.cursor))) {
    throw new Error('The native owner subscription returned an invalid notice.');
  }
  return {
    kind: value.kind,
    generation: String(value.generation),
    cursor: String(value.cursor),
  };
}

// The short-lived client speaks to Instance.subscribe/notice in the normal
// Baton2 process. That API connects to the elected database owner and returns
// cursor-only hints; the HTTP server rereads authorized rows from SQLite.
export function createNativeOwnerSubscriber(executable) {
  return async function subscribeCommittedChanges({
    databasePath,
    afterCursor,
    expectedGeneration,
    onNotice,
  }) {
    const child = spawn(executable, [
      databasePath,
      'ui-subscribe',
      String(afterCursor),
      String(expectedGeneration || '0'),
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    let closed = false;
    let ready = false;

    const stop = () => {
      if (closed) return;
      closed = true;
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    };

    try {
      const first = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => child.once('error', () => reject(
          new Error('The Baton2 UI subscription client could not start.')))),
        new Promise((_, reject) => child.once('exit', (code) => {
          if (!ready) reject(new Error(`The Baton2 UI subscription client exited (${code}).`));
        })),
      ]);
      if (first.done) throw new Error('The Baton2 UI subscription client closed before readiness.');
      const facts = readiness(parseLine(first.value));
      ready = true;

      void (async () => {
        try {
          for (;;) {
            const next = await iterator.next();
            if (next.done || closed) break;
            onNotice(notice(parseLine(next.value)));
          }
          if (!closed) onNotice({ kind: 'unavailable' });
        } catch {
          if (!closed) onNotice({ kind: 'unavailable' });
        }
      })();

      return {
        ready: true,
        ...facts,
        close: stop,
      };
    } catch (error) {
      stop();
      throw error;
    }
  };
}
