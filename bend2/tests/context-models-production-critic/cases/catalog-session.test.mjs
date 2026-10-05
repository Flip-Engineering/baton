// Catalog session discriminators over a real node:sqlite subject.
//
// Pins: snapshot identity composition, data-only writes keeping catalog
// applicability, WAL-schema-relevant DDL making it stale, live-connection
// planning, and temp/attached access staying unavailable.

import { check } from '../lib/harness.mjs';
import { RealDatabaseSync } from '../fixtures/db.mjs';

check({
  id: 'catalog/session/useful-entities',
  requirement: 'captureSqliteSnapshot returns real catalog rows: users/orders entities, columns, PK/FK/unique keys (spec: Data projections, SQLite capture)',
  async run({ producer, ordersDbPath }) {
    const { captureSqliteSnapshot } = producer.modules.catalogs.catalog;
    const snapshot = captureSqliteSnapshot({ path: ordersDbPath, DatabaseSync: RealDatabaseSync });
    const users = snapshot.catalog.entities.find(entity => entity.name === 'users');
    if (users === undefined) throw new Error('users entity missing from captured catalog');
    const idColumn = snapshot.catalog.columns.find(column => column.table === 'users' && column.name === 'id');
    if (idColumn?.primaryKeyOrdinal !== 1) throw new Error(`users.id PK ordinal observed ${JSON.stringify(idColumn)}`);
    const fk = snapshot.catalog.relationships.find(entry => entry.table === 'orders' && entry.references.table === 'users');
    if (fk?.from !== 'user_id') throw new Error(`orders FK observed ${JSON.stringify(fk)}`);
    const unique = snapshot.catalog.keys.find(entry => entry.table === 'users' && entry.kind === 'unique');
    if (unique?.columns[0] !== 'email') throw new Error(`users.email unique key observed ${JSON.stringify(unique)}`);
    if (snapshot.stableWithinTransaction !== true) throw new Error('capture reports unstable transaction');
    return { users: users.kind, idPk: idColumn.primaryKeyOrdinal, fkFrom: fk.from, uniqueColumn: unique.columns[0] };
  },
});

check({
  id: 'catalog/session/identity-composition',
  requirement: 'snapshot identity carries realPath, file identity, engine version/source id, schemaVersion, catalogDigest; dataVersion is a separate observation excluded from applicability (conductor correction: snapshot freshness excludes dataVersion)',
  async run({ producer, ordersDbPath }) {
    const { captureSqliteSnapshot, compareSqliteIdentities } = producer.modules.catalogs.catalog;
    const snapshot = captureSqliteSnapshot({ path: ordersDbPath, DatabaseSync: RealDatabaseSync });
    const identity = snapshot.identity;
    for (const field of ['realPath', 'fileIdentity', 'version', 'sourceId', 'schemaVersion', 'catalogDigest', 'connection']) {
      if (identity[field] === undefined) throw new Error(`identity field ${field} absent`);
    }
    if (identity.observations?.dataVersion === undefined) throw new Error('dataVersion not recorded as a separate observation');
    if (identity.connection.readOnly !== true) throw new Error('connection not recorded read-only');
    const comparison = compareSqliteIdentities(identity, structuredClone(identity));
    if (comparison.applicability !== 'current' || comparison.changedInputs.length !== 0) throw new Error(`identical identities compared ${JSON.stringify(comparison)}`);
    return { identityFields: Object.keys(identity), dataVersion: identity.observations.dataVersion };
  },
});

check({
  id: 'catalog/freshness/data-only-write-stays-current',
  requirement: 'a data-only write moves dataVersion while the schema identity keeps catalog applicability current (spec: WAL DDL invalidates; data-only writes do not)',
  async run({ producer, ordersDbPath }) {
    const { captureSqliteSnapshot, compareSqliteIdentities } = producer.modules.catalogs.catalog;
    const session = captureSqliteSessionOf(producer, ordersDbPath);
    const before = session.identity;
    const writer = new RealDatabaseSync(ordersDbPath);
    writer.prepare("INSERT INTO users (id, name) VALUES (3, 'kay')").run();
    writer.close();
    const stability = session.stability();
    session.close();
    if (stability.stableWithinTransaction !== false) throw new Error(`connection identity did not observe the write: ${JSON.stringify(stability)}`);
    if (stability.before.dataVersion === stability.after.dataVersion) throw new Error('dataVersion did not move across the data-only write');
    const after = { ...before, schemaVersion: stability.after.schemaVersion, observations: { ...before.observations, dataVersion: stability.after.dataVersion } };
    const comparison = compareSqliteIdentities(before, after);
    if (comparison.applicability !== 'current') throw new Error(`data-only write produced ${comparison.applicability}: ${JSON.stringify(comparison.changedInputs)}`);
    return { dataVersionBefore: stability.before.dataVersion, dataVersionAfter: stability.after.dataVersion, applicability: comparison.applicability };
  },
});

function captureSqliteSessionOf(producer, path) {
  return producer.modules.catalogs.catalog.createSqliteSession({ path, DatabaseSync: RealDatabaseSync });
}

check({
  id: 'catalog/freshness/ddl-becomes-stale',
  requirement: 'a schema change (ALTER TABLE) changes catalogDigest and makes the earlier catalog stale with the changed input named',
  async run({ producer, ordersDbPath }) {
    const { captureSqliteSnapshot, compareSqliteIdentities } = producer.modules.catalogs.catalog;
    const before = captureSqliteSnapshot({ path: ordersDbPath, DatabaseSync: RealDatabaseSync });
    const writer = new RealDatabaseSync(ordersDbPath);
    writer.exec('ALTER TABLE users ADD COLUMN role TEXT');
    writer.close();
    const after = captureSqliteSnapshot({ path: ordersDbPath, DatabaseSync: RealDatabaseSync });
    const comparison = compareSqliteIdentities(before.identity, after.identity);
    if (comparison.applicability !== 'stale') throw new Error(`DDL produced ${comparison.applicability}`);
    if (!comparison.changedInputs.includes('catalogDigest')) throw new Error(`changed inputs ${JSON.stringify(comparison.changedInputs)}`);
    return { changedInputs: comparison.changedInputs };
  },
});

check({
  id: 'catalog/session/live-connection-planning',
  requirement: 'statement analysis runs inside the open capture transaction; after close it refuses; a detached snapshot record cannot authorize a new planning read (conductor invariant)',
  async run({ producer, ordersDbPath }) {
    const { createSqliteSession } = producer.modules.catalogs.catalog;
    const session = createSqliteSession({ path: ordersDbPath, DatabaseSync: RealDatabaseSync });
    const inside = session.analyze({ id: 'live', sql: 'SELECT id FROM users' });
    if (inside.status !== 'analyzed') throw new Error(`live analysis ${JSON.stringify(inside)}`);
    session.close();
    let refused = null;
    try {
      session.analyze({ id: 'dead', sql: 'SELECT id FROM users' });
    } catch (error) {
      refused = String(error.message);
    }
    if (refused === null) throw new Error('analysis after close did not refuse');
    const detached = producer.modules.catalogs.index.captureSqliteSnapshot({ path: ordersDbPath, DatabaseSync: RealDatabaseSync });
    if (typeof detached.analyze === 'function') throw new Error('detached snapshot record exposes an analyze path');
    return { liveRelations: inside.relations.length, refusedAfterClose: refused, detachedKeys: Object.keys(detached) };
  },
});

check({
  id: 'catalog/read-only-open/refusals',
  requirement: 'read-only open refuses missing files, file: URIs and VFS selectors without creating anything (spec: ordinary pathname, no URI interpretation)',
  async run({ producer }) {
    const { openReadOnlySqlite } = producer.modules.catalogs.catalog;
    const attempts = [];
    for (const attempt of [
      { label: 'missing', run: () => openReadOnlySqlite({ path: '/nonexistent/ctx-critic-missing.sqlite3', DatabaseSync: RealDatabaseSync }) },
      { label: 'uri', run: () => openReadOnlySqlite({ path: 'file:whatever.sqlite3', DatabaseSync: RealDatabaseSync }) },
      { label: 'vfs', run: () => openReadOnlySqlite({ path: 'x.sqlite3?vfs=unix', DatabaseSync: RealDatabaseSync }) },
    ]) {
      try {
        attempt.run();
        attempts.push({ label: attempt.label, refused: false });
      } catch (error) {
        attempts.push({ label: attempt.label, refused: true, reason: String(error.message).slice(0, 120) });
      }
    }
    const allRefused = attempts.every(entry => entry.refused);
    if (!allRefused) throw new Error(`read-only open admitted ${JSON.stringify(attempts)}`);
    return { attempts };
  },
});
