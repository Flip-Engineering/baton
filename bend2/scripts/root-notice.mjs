#!/usr/bin/env node
// Forward committed root input to a native background job over stdout (#1463).
// The database owner pushes changes through ui-subscribe. The job exits after
// writing complete input so the owning harness can deliver its completion.
import { spawn } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export async function rootNotice({ database, coordinator, session, native, fresh = false, index = false }, output = process.stdout) {
  database = realpathSync(database);
  coordinator = realpathSync(coordinator);
  const db = new DatabaseSync(database, { readOnly: true });
  const selected = db.prepare('SELECT id FROM sessions WHERE id=? AND parent IS NULL').get(session);
  if (!selected) { db.close(); throw new Error('The selected root session is not recorded.'); }
  const after = fresh ? db.prepare('SELECT coalesce(max(seq),0) AS seq FROM messages').get().seq : 0;
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
          SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)) ORDER BY m.seq`)
        .all(session, after, fresh ? 1 : 0);
      if (!rows.length) continue;
      const content = rows.map(row => index
        ? `Message (${row.kind}) from ${row.sender} [id: ${row.id}] retained ${Buffer.byteLength(row.body)} bytes; read the complete body with baton read ${row.id}.`
        : `Message (${row.kind}) from ${row.sender} [id: ${row.id}]:\n${row.body}`
        + (row.kind === 'completion-request' ? `\nReview ${row.sender}'s assignment and supplied evidence. Confirm completion when satisfied, or guide the remaining work.` : '')).join('\n\n');
      const messages = index ? rows.map(({ body, ...row }) => ({ ...row, bodyBytes: Buffer.byteLength(body) })) : rows;
      const notice = { type: 'baton-root-input', recipient: session, native, messages, content,
        rearm: 'Read the complete pending input through Baton, then start this background subscription again with --new omitted. Pending replay includes input committed while the previous batch was handled.' };
      await new Promise((resolve, reject) => output.write(JSON.stringify(notice) + '\n', error => error ? reject(error) : resolve()));
      appendFileSync(database + '.root.log', JSON.stringify({ type: 'root-notice-written', recipient: session,
        native, messages: rows.map(row => row.id), state: 'written-to-background-job', read: 'unrecorded' }) + '\n');
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

function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--new') options.fresh = true;
    else if (flag === '--index') options.index = true;
    else if (['--database', '--coordinator', '--session', '--native'].includes(flag)) {
      const value = argv[++i];
      if (!value) throw new Error(flag + ' requires a value.');
      options[flag.slice(2)] = value;
    } else throw new Error('Unknown option: ' + flag);
  }
  for (const name of ['database', 'coordinator', 'session', 'native']) {
    if (!options[name]) throw new Error('--' + name + ' is required.');
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { await rootNotice(parse(process.argv.slice(2))); }
  catch (error) { process.stderr.write('root-notice: ' + error.message + '\n'); process.exitCode = 1; }
}
