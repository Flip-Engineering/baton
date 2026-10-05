// Domain provider tests: PostgreSQL 14.18 catalog and plan facts through psql.
//
// The suite owns a dedicated fixture database and drops it afterwards. It
// never reads or writes a research database.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SERVICE_NAME,
  joinPostgresRelations,
  openPostgresSession,
  postgresEnvironment,
} from '../../context/catalogs/index.mjs';
import { makePostgresFixture, PSQL } from './helpers/fixtures.mjs';

const FIXTURE_DATABASE = 'baton_context_domain_fixture';

function sessionOptions(fixture) {
  return { psql: PSQL, serviceFile: fixture.serviceFile, home: fixture.home, tempDirectory: fixture.tempDirectory };
}

test('the child environment is the fixed base with the fixed service name and an empty password file', () => {
  const env = postgresEnvironment({ serviceFile: '/private/pg_service.conf', home: '/private/home', tempDirectory: '/private/tmp' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LC_ALL', 'PATH', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'TMPDIR']);
  assert.equal(env.PGSERVICE, SERVICE_NAME);
  assert.equal(env.PGPASSFILE, '');
  assert.equal(env.HOME, '/private/home');
  assert.equal(process.env.PGHOST, undefined, 'the test process itself carries no ambient PGHOST');
  assert.equal(Object.prototype.hasOwnProperty.call(env, 'PGHOST'), false);
});

test('a catalog capture reports entities, columns, constraints, indexes, types and policies of the subject database', () => {
  const fixture = makePostgresFixture({ name: FIXTURE_DATABASE });
  try {
    const session = openPostgresSession(sessionOptions(fixture));
    assert.equal(session.status, 'captured');
    assert.equal(session.identity.engine, 'postgres-schema');
    assert.match(session.identity.version, /^14\.18/);
    assert.equal(session.identity.versionNum, 140018);
    assert.equal(session.identity.database, FIXTURE_DATABASE);
    assert.equal(session.identity.role, process.env.USER);
    assert.equal(typeof session.identity.searchPath, 'string');
    assert.equal(session.identity.searchPath.length > 0, true);
    assert.equal(session.identity.transactionReadOnly, true);
    assert.ok(session.identity.catalogDigest.match(/^[0-9a-f]{64}$/));
    assert.equal(session.client.serviceName, SERVICE_NAME);

    const names = session.catalog.entities.map(entity => `${entity.schema}.${entity.name}:${entity.kind}`);
    assert.ok(names.includes('public.users:table'));
    assert.ok(names.includes('public.orders:table'));
    assert.ok(names.includes('public.paid:view'));
    assert.ok(names.includes('public.order_totals:materialized-view'));

    const email = session.catalog.columns.find(column => column.table === 'users' && column.name === 'email');
    assert.equal(email.type, 'text');
    assert.equal(email.notNull, true);
    const id = session.catalog.columns.find(column => column.table === 'users' && column.name === 'id');
    assert.match(id.type, /^integer/);
    assert.equal(id.notNull, true);

    const primaryKey = session.catalog.constraints.find(entry => entry.table === 'users' && entry.kind === 'primaryKey');
    assert.equal(primaryKey.validated, true);
    assert.deepEqual(primaryKey.columns, ['id']);

    const foreignKey = session.catalog.relationships.find(entry => entry.table === 'orders');
    assert.equal(foreignKey.references.table, 'users');
    assert.deepEqual(foreignKey.from, ['customer_id']);
    assert.deepEqual(foreignKey.to, ['id']);
    assert.equal(foreignKey.onDelete, undefined);
    assert.equal(foreignKey.validated, true);

    const check = session.catalog.constraints.find(entry => entry.table === 'orders' && entry.kind === 'check');
    assert.match(check.definition, /CHECK/);

    const partial = session.catalog.indexes.find(index => index.name === 'orders_large');
    assert.match(partial.predicate, /total/);
    const uniqueKey = session.catalog.indexes.find(index => index.name === 'users_email_key');
    assert.equal(uniqueKey.unique, true);
    assert.deepEqual(uniqueKey.columns, ['email']);

    const mood = session.catalog.types.find(type => type.name === 'mood');
    assert.equal(mood.kind, 'enum');
    assert.deepEqual(mood.labels, ['sad', 'ok', 'happy']);
    const domain = session.catalog.types.find(type => type.name === 'positive_cents');
    assert.equal(domain.kind, 'domain');
    assert.match(domain.baseType, /integer/);

    assert.equal(session.catalog.policies.length, 0);
    assert.ok(session.limits.some(limit => limit.code === 'enforcementNotObserved'));
    assert.ok(session.limits.some(limit => limit.code === 'roleSearchPathAssumption'));
    assert.ok(session.limits.some(limit => limit.code === 'materializedViewDefinition'));
    const revalidate = session.revalidate();
    assert.equal(revalidate.applicability, 'current');
    session.close();
  } finally {
    fixture.remove();
  }
});

test('planning refuses without the planTargetSql grant before any client starts', () => {
  const fixture = makePostgresFixture({ name: FIXTURE_DATABASE });
  try {
    const session = openPostgresSession(sessionOptions(fixture));
    const refused = session.analyze({ sql: 'SELECT id FROM users', effects: [] });
    assert.equal(refused.status, 'refused');
    assert.equal(refused.spawned, false);
    assert.equal(refused.refusal.reason, 'missingEffectGrant');
    assert.match(refused.refusal.detail, /planTargetSql/);
    session.close();
  } finally {
    fixture.remove();
  }
});

test('an admitted plan reports the relations the engine resolves, and its facts join the catalog', () => {
  const fixture = makePostgresFixture({ name: FIXTURE_DATABASE });
  try {
    const session = openPostgresSession(sessionOptions(fixture));
    const plan = session.analyze({
      sql: 'SELECT o.id, u.email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.total > 10',
      effects: ['planTargetSql'],
    });
    assert.equal(plan.status, 'analyzed');
    assert.equal(plan.kind, 'read');
    assert.equal(plan.planMode, 'force_generic_plan');
    assert.equal(plan.snapshotId, session.identity.snapshotId);
    assert.deepEqual(plan.relations.map(relation => `${relation.schema}.${relation.name}`).sort().join(' '), 'public.orders public.users',
      'unqualified relation names resolve under the recorded connection search_path');

    const joined = joinPostgresRelations({ plan, catalog: session.catalog, session });
    assert.equal(joined.relations.length, 2);
    const orders = joined.relations.find(relation => relation.value.object.name === 'orders');
    assert.equal(orders.classification, 'static-possible');
    assert.equal(orders.value.snapshotId, session.identity.snapshotId);
    assert.equal(orders.value.object.type, 'table');
    assert.deepEqual(orders.evidence.map(entry => entry.kind), ['schema']);
    assert.ok(orders.limits.some(limit => limit.code === 'planModePinned'));
    assert.ok(orders.limits.some(limit => limit.code === 'valueDependenceUnobserved'));

    const unavailable = joinPostgresRelations({
      plan: { ...plan, relations: [{ name: 'absent_relation', schema: 'public', alias: null, nodeType: 'Seq Scan', status: 'pending-catalog-join' }] },
      catalog: session.catalog,
      session,
    });
    assert.equal(unavailable.relations.length, 0);
    assert.equal(unavailable.unknownAccess[0].reason, 'relationNotInCatalog');
    session.close();
  } finally {
    fixture.remove();
  }
});

test('a two-statement text and an unknown relation refuse with the engine reason', () => {
  const fixture = makePostgresFixture({ name: FIXTURE_DATABASE });
  try {
    const session = openPostgresSession(sessionOptions(fixture));
    const multiple = session.analyze({ sql: 'SELECT 1; DROP TABLE users', effects: ['planTargetSql'] });
    assert.equal(multiple.status, 'refused');
    assert.equal(multiple.spawned, false);
    assert.equal(multiple.refusal.reason, 'multipleStatements');

    const unknown = session.analyze({ sql: 'SELECT * FROM no_such_relation', effects: ['planTargetSql'] });
    assert.equal(unknown.status, 'refused');
    assert.equal(unknown.spawned, true);
    assert.equal(unknown.refusal.reason, 'psqlFailed');
    assert.match(unknown.refusal.engineError.stderr, /no_such_relation/);
    session.close();
  } finally {
    fixture.remove();
  }
});

test('a plan whose subject catalog moved during the plan transaction is refused as changed', async () => {
  const fixture = makePostgresFixture({ name: FIXTURE_DATABASE });
  try {
    const session = openPostgresSession(sessionOptions(fixture));
    const { psqlRun } = await import('./helpers/fixtures.mjs');
    psqlRun(['-d', FIXTURE_DATABASE, '-c', 'ALTER TABLE orders ADD COLUMN extra integer']);
    const plan = session.analyze({ sql: 'SELECT id FROM orders', effects: ['planTargetSql'] });
    assert.equal(plan.status, 'refused');
    assert.equal(plan.refusal.reason, 'snapshotChanged');
    assert.deepEqual(plan.refusal.observed.catalogDigest !== session.identity.catalogDigest, true);
    session.close();
  } finally {
    fixture.remove();
  }
});
