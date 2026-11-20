import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const safeRole = (role) => {
  if (typeof role !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(role)) {
    throw new TypeError('bee role must be a filesystem-safe identifier');
  }
  return role;
};

/**
 * A small durable peer bus compatible with the pi-intercom operational model:
 * join/role registration, send, receive/tail, status, and broadcast. It is a
 * transport bridge, not an authority source; Baton remains the authority for
 * task admission, assignment, and completion.
 */
export class BeeBus {
  constructor({ dir = process.env.BATON_BEES_BUS || '.baton-bees' } = {}) {
    this.dir = dir;
    this.messagesPath = join(dir, 'messages.jsonl');
    this.rolesDir = join(dir, 'roles');
  }

  async ensure() {
    await mkdir(this.rolesDir, { recursive: true });
    await appendFile(this.messagesPath, '', 'utf8');
  }

  async join(role, metadata = {}) {
    await this.ensure();
    const id = safeRole(role);
    const record = { role: id, joined_at: new Date().toISOString(), metadata };
    await writeFile(join(this.rolesDir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
    await this.append({ from: id, to: '*', kind: 'join', text: 'joined', metadata });
    return record;
  }

  async send({ from, to = '*', text, kind = 'note', metadata = {} }) {
    await this.ensure();
    const sender = safeRole(from);
    const recipients = Array.isArray(to) ? to : [to];
    const normalized = recipients.map((recipient) => recipient === '*' ? '*' : safeRole(recipient));
    if (typeof text !== 'string' || !text.length) throw new TypeError('message text is required');
    await this.append({ from: sender, to: normalized, kind, text, metadata });
  }

  async append(message) {
    const record = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...message
    };
    await appendFile(this.messagesPath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async all() {
    await this.ensure();
    const text = await readFile(this.messagesPath, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }

  async recv(role, { limit = 20, cursor = null } = {}) {
    const id = safeRole(role);
    const messages = await this.all();
    const selected = messages.filter((message) =>
      message.to === '*' || (Array.isArray(message.to) && (message.to.includes('*') || message.to.includes(id))));
    const start = cursor ? Math.max(0, selected.findIndex((message) => message.id === cursor) + 1) : 0;
    const items = selected.slice(start, start + limit);
    return { role: id, messages: items, cursor: items.at(-1)?.id ?? cursor };
  }

  async status() {
    await this.ensure();
    const roleFiles = (await readdir(this.rolesDir)).filter((name) => name.endsWith('.json')).sort();
    const roles = [];
    for (const name of roleFiles) {
      roles.push(JSON.parse(await readFile(join(this.rolesDir, name), 'utf8')));
    }
    const messages = await this.all();
    return { dir: this.dir, roles, message_count: messages.length, last_messages: messages.slice(-10) };
  }
}
