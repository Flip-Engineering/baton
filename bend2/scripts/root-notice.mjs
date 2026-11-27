#!/usr/bin/env node
// Forward committed root input to a native background job over stdout (#1463).
// The database owner pushes changes through ui-subscribe. The job exits after
// writing complete input so the owning harness can deliver its completion.
//
// Three selections of the root's messages:
// - default: every message with no recorded read (retained unread input);
// - --new: messages committed after this command starts;
// - --after SEQ: messages whose sequence number is greater than SEQ, read or
//   unread. Each notice reports the highest sequence number it carries as
//   `through`. An independent root that shares its recipient with another root
//   keeps that number as its own position and passes it to the next
//   subscription (#1217).
// - --after-message ID: messages committed after the recorded message ID, read or
//   unread. A dispatch names its own task here, so input the new seat sends
//   before the subscription starts is selected.
// --from SENDER, repeatable, limits any selection to the named senders.
// --native names the root's native conversation in each notice. A root that
// works from scripts has no native conversation and omits it.
//
// Several --database values, --root SEAT_HOME (every seat database under that
// home), --follow, --cursor, --notify or a period option select the seat events
// of seat-events.mjs: messages for the recipient plus blocked seats, ended
// natives, untaken operator input, unconfirmed completion requests and silent
// natives, over every selected database.
import { spawn } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export async function rootNotice({ database, coordinator, session, native = null, fresh = false, index = false, after = null, afterMessage = null, from = [] }, output = process.stdout) {
  if ([fresh, after !== null, afterMessage !== null].filter(Boolean).length > 1) throw new Error('--new, --after and --after-message select different starting points; pass one of them.');
  database = realpathSync(database);
  coordinator = realpathSync(coordinator);
  const db = new DatabaseSync(database, { readOnly: true });
  const selected = db.prepare('SELECT id FROM sessions WHERE id=? AND parent IS NULL').get(session);
  if (!selected) { db.close(); throw new Error('The selected root session is not recorded.'); }
  if (afterMessage !== null) {
    const recorded = db.prepare('SELECT seq FROM messages WHERE id=?').get(afterMessage);
    if (!recorded) { db.close(); throw new Error(`The message ${afterMessage} is not recorded in ${database}.`); }
    after = recorded.seq;
  }
  // A position, from --new, --after or --after-message, selects by sequence number alone.
  const positioned = fresh || after !== null;
  const start = after !== null ? after : fresh ? db.prepare('SELECT coalesce(max(seq),0) AS seq FROM messages').get().seq : 0;
  const senders = JSON.stringify(from);
  const env = { ...process.env };
  for (const name of ['BATON_SESSION', 'BATON_DATABASE', 'BATON_ATTEMPT_DIRECTORY', 'BATON_MCP_INPUT']) delete env[name];
  const child = spawn(coordinator, [database, 'ui-subscribe', '0', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const lines = createInterface({ input: child.stdout });
  let delivered = false;
  try {
    for await (const line of lines) {
      JSON.parse(line); // Readiness and commit notices both trigger a committed snapshot.
      const stopped = db.prepare('SELECT 1 FROM session_stops WHERE session=?').get(session);
      if (stopped) throw new Error('The root session is explicitly stopped.');
      const rows = db.prepare(`SELECT m.seq,m.id,m.sender,m.recipient,m.kind,m.body FROM messages m
        WHERE m.recipient=? AND m.seq>? AND (? OR NOT EXISTS(
          SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient))
          AND (? OR m.sender IN (SELECT value FROM json_each(?))) ORDER BY m.seq`)
        .all(session, start, positioned ? 1 : 0, from.length ? 0 : 1, senders);
      if (!rows.length) continue;
      const through = rows[rows.length - 1].seq;
      const content = rows.map(row => index
        ? `Message (${row.kind}) from ${row.sender} [id: ${row.id}] retained ${Buffer.byteLength(row.body)} bytes; read the complete body with baton read ${row.id}.`
        : `Message (${row.kind}) from ${row.sender} [id: ${row.id}]:\n${row.body}`
        + (row.kind === 'completion-request' ? `\nReview ${row.sender}'s assignment and supplied evidence. Confirm completion when satisfied, or guide the remaining work.` : '')).join('\n\n');
      const messages = index ? rows.map(({ body, ...row }) => ({ ...row, bodyBytes: Buffer.byteLength(body) })) : rows;
      const rearm = positioned
        ? `Handle this batch, then start this background subscription again with --after ${through} in place of --new, --after-message or the earlier --after value. That selects every message committed after this batch, including input committed while it was handled.`
        : 'Read the complete pending input through Baton, then start this background subscription again with --new omitted. Pending replay includes input committed while the previous batch was handled.';
      const notice = { type: 'baton-root-input', recipient: session, native, through, messages, content, rearm };
      await new Promise((resolve, reject) => output.write(JSON.stringify(notice) + '\n', error => error ? reject(error) : resolve()));
      appendFileSync(database + '.root.log', JSON.stringify({ type: 'root-notice-written', recipient: session,
        native, through, messages: rows.map(row => row.id), state: 'written-to-background-job', read: 'unrecorded' }) + '\n');
      delivered = true;
      break;
    }
    if (!delivered) {
      const ended = await closed;
      throw new Error(`The root subscription ended before input was written: ${JSON.stringify(ended)} ${error}`);
    }
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    db.close();
  }
}

const PERIODS = { '--silent-seconds': 'silentSeconds', '--untaken-seconds': 'untakenSeconds',
  '--unconfirmed-seconds': 'unconfirmedSeconds' };

function parse(argv) {
  const options = { from: [], databases: [], roots: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--new') options.fresh = true;
    else if (flag === '--index') options.index = true;
    else if (flag === '--follow') options.follow = true;
    else if (['--root', '--cursor', '--notify', ...Object.keys(PERIODS)].includes(flag)) {
      const value = argv[++i];
      if (!value) throw new Error(flag + ' requires a value.');
      if (flag === '--root') options.roots.push(value);
      else if (flag === '--cursor') options.cursor = value;
      else if (flag === '--notify') {
        const command = JSON.parse(value);
        if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== 'string')) {
          throw new Error('--notify requires a JSON array of strings: the command and its arguments.');
        }
        options.notify = command;
      } else {
        if (!/^[1-9][0-9]*$/.test(value)) throw new Error(flag + ' requires a positive number of seconds.');
        options[PERIODS[flag]] = Number(value);
      }
    }
    else if (['--database', '--coordinator', '--session', '--native', '--after', '--after-message', '--from'].includes(flag)) {
      const value = argv[++i];
      if (!value) throw new Error(flag + ' requires a value.');
      if (flag === '--from') options.from.push(value);
      else if (flag === '--database') { options.databases.push(value); options.database ??= value; }
      else if (flag === '--after') {
        if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('--after requires a message sequence number.');
        options.after = Number(value);
      } else if (flag === '--after-message') options.afterMessage = value;
      else options[flag.slice(2)] = value;
    } else throw new Error('Unknown option: ' + flag);
  }
  options.events = options.databases.length > 1 || options.roots.length > 0 || options.follow
    || options.cursor !== undefined || options.notify !== undefined
    || Object.values(PERIODS).some((name) => options[name] !== undefined);
  if (options.events && !options.roots.length && !options.databases.length) {
    throw new Error('--database or --root is required.');
  }
  for (const name of options.events ? ['coordinator', 'session'] : ['database', 'coordinator', 'session']) {
    if (!options[name]) throw new Error('--' + name + ' is required.');
  }
  return options;
}

// The event wait loads its modules only when selected, so the one-database wait
// runs from root-notice.mjs alone.
async function main(options) {
  if (!options.events) return rootNotice(options);
  const { seatEvents } = await import('./seat-events.mjs');
  const { seatDatabases } = await import('./seats.mjs');
  const databases = seatDatabases(options.roots, options.databases);
  if (!databases.length) throw new Error('No seat database was found under the selected roots and databases.');
  return seatEvents({ ...options, databases });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { await main(parse(process.argv.slice(2))); }
  catch (error) { process.stderr.write('root-notice: ' + error.message + '\n'); process.exitCode = 1; }
}
