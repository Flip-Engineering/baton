// Result-name origin discriminators (conductor correction 3 / round14):
// origins come from actual binding metadata qualification only; name
// equality between a result name and a stored column establishes nothing;
// the Node22.15.0 floor is explicitly unavailable.

import { DatabaseSync } from 'node:sqlite';

import { check } from '../lib/harness.mjs';

// The exported functions pin a (db, capability) shape; the capture session
// keeps its connection private, so these checks present a parallel read-only
// connection over the same subject file, exactly as a consumer of the
// exported functions would.
function readOnlyDb(path) {
  return new DatabaseSync(path, { readOnly: true });
}

check({
  id: 'origins/metadata-qualified-useful',
  requirement: 'with a qualified capability probe, statementOrigins returns real base-table/column identities for a plain column projection',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const capability = session.originCapability;
    if (capability.available !== true) throw new Error(`probe not qualified on this host: ${JSON.stringify(capability)}`);
    const db = readOnlyDb(ordersDbPath);
    const origins = producer.modules.catalogs.statement.statementOrigins({ db, sql: 'SELECT id, name FROM users', originCapability: capability });
    db.close();
    session.close();
    if (origins.availability !== 'available') throw new Error(JSON.stringify(origins));
    const idOrigin = origins.columns.find(column => column.resultName === 'id');
    if (idOrigin?.table !== 'users' || idOrigin?.column !== 'id') throw new Error(`origin observed ${JSON.stringify(idOrigin)}`);
    return { idOrigin, tier: origins.tier };
  },
});

check({
  id: 'origins/expression-partial-no-fabrication',
  requirement: 'an expression result reports partial/expression_origin_absent and fabricates no table or column',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const capability = session.originCapability;
    const db = readOnlyDb(ordersDbPath);
    const origins = producer.modules.catalogs.statement.statementOrigins({ db, sql: 'SELECT 1 + 1 AS id FROM users', originCapability: capability });
    db.close();
    session.close();
    if (origins.availability !== 'partial') throw new Error(`expression origins observed ${origins.availability}`);
    const expression = origins.columns.find(column => column.resultName === 'id');
    if (expression?.table !== null || expression?.column !== null) throw new Error(`expression origin fabricated ${JSON.stringify(expression)}`);
    return { availability: origins.availability, reason: origins.reason, expression };
  },
});

check({
  id: 'origins/no-name-equality-fallback',
  requirement: 'with capability unavailable, a result name matching a stored column name produces no origin: name equality establishes nothing (conductor correction 3; observed 7f9574bf joined resultName id to users.id by name alone)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const statement = producer.modules.catalogs.statement;
    // Capability unavailable even though the catalog really contains users.id.
    const origins = statement.statementOrigins({
      db: readOnlyDb(ordersDbPath),
      sql: 'SELECT id FROM users',
      originCapability: { available: false, reason: 'column_origin_metadata_unavailable', detail: 'Node22.15.0 floor qualification stub' },
    });
    session.close();
    if (origins.availability !== 'unavailable') throw new Error(`name-equality fallback produced ${JSON.stringify(origins)}`);
    if (Array.isArray(origins.columns) && origins.columns.length !== 0) throw new Error(`origins fabricated under unavailable capability: ${JSON.stringify(origins.columns)}`);
    return { availability: origins.availability, reason: origins.reason, requiredEvidence: origins.requiredEvidence ?? null };
  },
});

check({
  id: 'origins/node-floor-contract',
  requirement: 'a binding exposing no columns() metadata reports the explicit unavailable reason (Node22.15.0 floor contract), qualified through the probe path',
  async run({ producer }) {
    const statement = producer.modules.catalogs.statement;
    const floorDb = { prepare: () => ({}) };
    const probe = statement.probeOriginCapability({ db: floorDb, catalog: { entities: [], columns: [] } });
    if (probe.available !== false || probe.reason !== 'column_origin_metadata_unavailable') throw new Error(JSON.stringify(probe));
    return { reason: probe.reason };
  },
});
