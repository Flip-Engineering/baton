// Reference migration replay and prefix/head comparison over real node:sqlite.
//
// This qualifies the replay CONTRACT (foreign execution evidence over the
// real SQLite provider): chain/admitted shapes, checksum semantics,
// prefix-vs-head catalogs, history-unknown and pre-replay refusals. The
// production native operation over the linked library is a separate native
// owner qualification; these are the executable semantics its results must
// reproduce.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function digestText(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export function writeRevision(directory, revision, sql) {
  const file = join(directory, `${revision}.sql`);
  writeFileSync(file, Buffer.from(sql, 'utf8'));
  return { revision, path: file, sha256: digestText(sql) };
}

export function prepareAppliedDatabase(path, { table = 'schema_migrations', revisionColumn = 'revision', checksumColumn = 'checksum', applied }) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE ${table} (${revisionColumn} TEXT PRIMARY KEY, ${checksumColumn} TEXT NOT NULL)`);
  for (const entry of applied) {
    db.prepare(`INSERT INTO ${table} (${revisionColumn}, ${checksumColumn}) VALUES (?, ?)`).run(entry.revision, entry.sha256);
  }
  db.close();
  return { table, revisionColumn, checksumColumn };
}

// One replay into a private in-memory database through one connection.
// Chain shape validation precedes every file read: revision identities are
// strings, so a numeric revision refuses before replay (spec ordering).
export function replayChain(chain, { into = null } = {}) {
  for (const entry of chain) {
    if (typeof entry.revision !== 'string' || entry.revision.length === 0) {
      return { status: 'refused', reason: 'revisionIdentityNotString', revision: entry.revision, applied: [] };
    }
  }
  const db = into ?? new DatabaseSync(':memory:');
  const applied = [];
  let openTransaction = false;
  for (const entry of chain) {
    const bytes = readFileSync(entry.path);
    const text = bytes.toString('utf8');
    const nul = text.indexOf('\u0000');
    if (nul !== -1) return { status: 'refused', reason: 'nulInScript', revision: entry.revision, applied };
    const statements = splitStatements(text);
    if (statements.trailingMalformed) return { status: 'failed', reason: 'malformedTrailingStatement', revision: entry.revision, applied };
    for (const statement of statements.executable) {
      try {
        db.exec(statement);
      } catch (error) {
        return { status: 'failed', reason: 'statementFailed', revision: entry.revision, detail: error.message, applied };
      }
    }
    if (db.isTransaction) openTransaction = true;
    applied.push(entry.revision);
  }
  if (openTransaction) {
    return { status: 'failed', reason: 'transactionLeftOpen', applied };
  }
  return { status: 'replayed', applied };
}

// Whitespace/comment-aware statement split for the reference runner only.
// A trailing fragment that is neither empty nor comment terminates malformed.
function splitStatements(text) {
  const executable = [];
  let current = '';
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "'" ) {
      const close = text.indexOf("'", index + 1);
      if (close === -1) return { executable, trailingMalformed: true };
      current += text.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    if (character === '-' && text[index + 1] === '-') {
      const newline = text.indexOf('\n', index + 2);
      index = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      if (close === -1) return { executable, trailingMalformed: true };
      index = close + 2;
      continue;
    }
    if (character === ';') {
      if (current.trim().length > 0) executable.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  const rest = current.trim();
  if (rest.length > 0) return { executable, trailingMalformed: true };
  return { executable, trailingMalformed: false };
}

export function captureCatalog(db) {
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

// Compare the recorded applied prefix against the replayed chain:
// pending revisions, checksum divergence, catalog drift, head constraints.
export function comparePrefixHead({ chain, applied, appliedRecord, liveCatalogDigest }) {
  const appliedRevisions = new Set(applied.map(entry => entry.revision));
  const checksumByRevision = new Map(applied.map(entry => [entry.revision, entry.sha256]));
  const checksumColumn = appliedRecord?.checksumColumn ?? 'checksum';
  const pending = chain.filter(entry => !appliedRevisions.has(entry.revision)).map(entry => entry.revision);

  const checksumDivergence = [];
  for (const entry of chain) {
    const recorded = checksumByRevision.get(entry.revision);
    if (recorded !== undefined && recorded !== entry.sha256) {
      checksumDivergence.push({ revision: entry.revision, recordedChecksum: recorded, chainChecksum: entry.sha256, checksumColumn });
    }
  }
  const headDatabase = new DatabaseSync(':memory:');
  const headResult = replayChain(chain, { into: headDatabase });
  const headCatalogDigest = captureCatalog(headDatabase);
  headDatabase.close();
  const prefixDatabase = new DatabaseSync(':memory:');
  replayChain(chain.filter(entry => appliedRevisions.has(entry.revision)), { into: prefixDatabase });
  const prefixCatalogDigest = captureCatalog(prefixDatabase);
  prefixDatabase.close();

  return {
    pending,
    checksumDivergence,
    catalogDifferences: {
      liveVsPrefix: liveCatalogDigest === prefixCatalogDigest ? [] : ['catalog differs from the recorded applied prefix'],
      prefixVsHead: prefixCatalogDigest === headCatalogDigest ? [] : ['full-chain head catalog differs from the recorded prefix catalog'],
    },
    headConstraints: headResult.status === 'replayed' ? { headCatalogDigest, replayed: headResult.applied } : { error: headResult },
  };
}
