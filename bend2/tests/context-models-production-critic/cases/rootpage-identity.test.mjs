// Rootpage identity discriminators (conductor correction 4 / round15):
// the join binds database number AND rootpage AND schema against the captured
// main catalog; temp/attached/ambiguous/unknown stay explicitly unavailable.

import { DatabaseSync } from 'node:sqlite';

import { check } from '../lib/harness.mjs';

function planFrom(controlDb, sql) {
  const rows = controlDb.prepare(`EXPLAIN ${sql}`).all();
  return {
    status: 'analyzed',
    sql,
    relations: rows
      .filter(row => row.opcode === 'OpenRead' || row.opcode === 'OpenWrite')
      .map(row => ({ opcode: row.opcode, cursor: row.p1, database: row.p3, rootpage: String(row.p2), engineName: typeof row.p4 === 'string' && Number.isNaN(Number(row.p4)) ? row.p4 : null, name: null, object: null, status: 'pending-catalog-join' })),
    unknownAccess: [],
    kind: 'read',
    limits: [],
  };
}

check({
  id: 'rootpages/useful-main-join',
  requirement: 'OpenRead database 0 joins to the captured main.users object with schema identity (round14 observed this working; kept as the useful positive)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const plan = session.analyze({ id: 'u1', sql: 'SELECT id FROM users' });
    session.close();
    const joined = plan.relations.find(entry => entry.status === 'joined');
    if (joined?.object?.schema !== 'main' || joined?.object?.table !== 'users') throw new Error(`join observed ${JSON.stringify(plan.relations)}`);
    return { object: joined.object, rootpage: joined.rootpage };
  },
});

check({
  id: 'rootpages/attached-database-unavailable',
  requirement: 'an OpenRead naming another database number stays modeledAccessUnavailable with nonMainDatabaseAccess (conductor correction 4: rootpage is not global identity)',
  async run({ producer, ordersDbPath, auxDbPath }) {
    const statement = producer.modules.catalogs.statement;
    const control = new DatabaseSync(ordersDbPath);
    control.exec(`ATTACH '${auxDbPath}' AS aux`);
    const plan = planFrom(control, 'SELECT line FROM aux.aux_log');
    control.close();
    const session = producer.modules.catalogs.catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const catalogRows = session.catalog;
    session.close();
    const result = statement.joinRootpages({ plan, catalog: catalogRows });
    const access = result.unknownAccess.find(entry => entry.opcode === 'OpenRead');
    if (access?.status !== 'modeledAccessUnavailable' || access?.reason !== 'nonMainDatabaseAccess') throw new Error(`attached access observed ${JSON.stringify(access)}`);
    if (result.relations.some(entry => entry.status === 'joined')) throw new Error('attached plan produced a joined object');
    return { reason: access.reason, database: access.database };
  },
});

check({
  id: 'rootpages/ambiguous-and-unknown',
  requirement: 'a rootpage naming several objects stays unavailable as ambiguousRootpage; a page outside the catalog stays rootpageNotInCatalog',
  async run({ producer }) {
    const statement = producer.modules.catalogs.statement;
    const catalog = {
      schema: 'main',
      entities: [], columns: [], keys: [], indexes: [], relationships: [], constraints: [], views: [], triggers: [],
      rootpages: { '7': [{ schema: 'main', name: 'alpha', type: 'table', table: 'alpha' }, { schema: 'main', name: 'bravo', type: 'index', table: 'alpha' }] },
    };
    const plan = { status: 'analyzed', sql: 'SELECT 1', relations: [
      { opcode: 'OpenRead', cursor: 1, database: 0, rootpage: '7', engineName: 'alpha', name: null, object: null, status: 'pending-catalog-join' },
      { opcode: 'OpenRead', cursor: 2, database: 0, rootpage: '999', engineName: 'ghost', name: null, object: null, status: 'pending-catalog-join' },
    ], unknownAccess: [], kind: 'read', limits: [] };
    const result = statement.joinRootpages({ plan, catalog });
    const ambiguous = result.unknownAccess.find(entry => entry.rootpage === '7');
    const unknown = result.unknownAccess.find(entry => entry.rootpage === '999');
    if (ambiguous?.reason !== 'ambiguousRootpage') throw new Error(`ambiguous observed ${JSON.stringify(ambiguous)}`);
    if (unknown?.reason !== 'rootpageNotInCatalog') throw new Error(`unknown observed ${JSON.stringify(unknown)}`);
    if (result.relations.length !== 0) throw new Error('unavailable pages joined');
    return { reasons: [ambiguous.reason, unknown.reason] };
  },
});

check({
  id: 'rootpages/temp-object-unavailable',
  requirement: 'temp-database access (database number 1) stays unavailable: temp objects are outside the captured catalog',
  async run({ producer, ordersDbPath }) {
    const statement = producer.modules.catalogs.statement;
    const control = new DatabaseSync(':memory:');
    control.exec('CREATE TEMP TABLE scratch (id INTEGER)');
    const plan = planFrom(control, 'SELECT id FROM scratch');
    control.close();
    const session = producer.modules.catalogs.catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const catalogRows = session.catalog;
    session.close();
    const result = statement.joinRootpages({ plan, catalog: catalogRows });
    const access = result.unknownAccess[0];
    if (access?.reason !== 'nonMainDatabaseAccess') throw new Error(`temp access observed ${JSON.stringify(access)}`);
    return { reason: access.reason, database: access.database };
  },
});
