import { Database } from './db';
import { User } from './barrel';

// A local function that shares the client method's spelling: a resolution that
// matches by name attributes this call to the database client.
function prepare(sql: string): string {
  return `local:${sql}`;
}

export function handle(db: Database, id: number) {
  const constant = db.prepare('SELECT display_name FROM users WHERE id = 1');
  const dynamic = db.prepare(`SELECT id FROM users WHERE id = ${id}`);
  const shadowed = prepare('SELECT id FROM orders');
  const model = new User({ email: 'a@b.co', display_name: 'ann', total_cents: 1250 });
  return { constant, dynamic, shadowed, model };
}
