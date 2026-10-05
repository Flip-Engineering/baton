// Adapter entry for the sqlite-schema and postgres-schema providers.
//
// Launch: <absolute node> <absolute libexec/baton2/context/catalogs/adapter.mjs>
// argv after the entry is empty; the provider is named in the input frame.
//
// stdin: exactly one frame, then EOF:
//   {"version":1,"provider":"sqlite-schema"|"postgres-schema","query":"<query id>",
//    "request":<canonical request text>,
//    "inputs":{"records":[<sqlCall facts>],
//              "psql":"<absolute psql>","home":"<private HOME>","tempDirectory":"<private TMPDIR>"}}
// The launch inputs are required for postgres-schema: this provider performs no
// executable discovery and reads no ambient HOME or TMPDIR. `inputs.records` is
// required for a codeAccessJoin request and is supplied by the native core from
// its own TypeScript provider run; the adapter runs no second resolver.
//
// stdout: exactly one frame, newline terminated, and nothing else:
//   success (exit 0):
//   {"version":1,"provider":..,"query":..,"operation":"catalogCapture"|"codeAccessJoin",
//    "requiredEffects":[..],"subject":..,"snapshot":..,"facts":[..],"relations":[..],
//    "refs":[..],"limits":[..],"coverage":{..},"applicability":..,"changedInputs":[..]}
//   refusal (exit 2): {"version":1,"provider":..,"query":..,
//     "error":{"kind":"validationRefusal"|"operationRefused","condition":"<fixed text>","limits":[]}}
//   failure (exit 1): stderr only; the core publishes no result.
//
// Closed request validation, canonical result composition, managed admission
// and the sole effect constructor remain with the codec, the core and the
// lifecycle.

import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { createSqliteSession } from './sqlite-catalog.mjs';
import { openPostgresSession } from './postgres-catalog.mjs';
import { admitSqlCallRecord, joinPostgresRelations } from './sql-join.mjs';
import { CATALOG_OPERATIONS } from './operations.mjs';

const PROVIDERS = new Set(['sqlite-schema', 'postgres-schema']);
const SERVED_PROJECTIONS = new Set(['entities', 'columns', 'relationships', 'constraints', 'keys', 'indexes', 'codeAccesses', 'columnOrigins']);

function operationFor({ select, records }) {
  if (records.length > 0 || select.includes('codeAccesses')) return 'codeAccessJoin';
  return 'catalogCapture';
}

function requiredEffectsFor(operation) {
  return CATALOG_OPERATIONS.find(row => row.operation === operation)?.requiredEffects ?? [];
}

function refusal(query, provider, condition, kind = 'validationRefusal') {
  return { version: 1, provider, query, error: { kind, condition, limits: [] } };
}

function selectedEntity(entity, subject) {
  if (typeof subject.schema === 'string' && entity.schema !== subject.schema) return false;
  if (typeof subject.name === 'string' && entity.name !== subject.name) return false;
  return true;
}

function factsFromSnapshot({ provider, snapshot, select, subject }) {
  const facts = [];
  const selected = new Set(snapshot.catalog.entities.filter(entity => selectedEntity(entity, subject)).map(entity => `${entity.schema}\u0000${entity.name}`));
  const inScope = row => selected.size === 0 || selected.has(`${row.schema}\u0000${row.table}`);
  const evidence = object => [{
    kind: 'schema',
    databaseIdentity: snapshot.identity.snapshotId,
    schemaDigest: snapshot.identity.catalogDigest,
    object,
    column: null,
  }];
  if (select.includes('entities')) {
    for (const entity of snapshot.catalog.entities.filter(entity => selectedEntity(entity, subject))) {
      facts.push({
        id: `entity:${entity.schema}.${entity.name}`,
        kind: 'entity',
        classification: 'observed',
        value: {
          schema: entity.schema,
          name: entity.name,
          type: entity.kind,
          withoutRowid: entity.withoutRowid ?? null,
          strict: entity.strict ?? null,
          rowidAliasColumn: entity.rowidAliasColumn ?? null,
          persistence: entity.persistence ?? null,
          rowSecurity: entity.rowSecurity ?? entity.rowsecurity ?? null,
        },
        evidence: evidence(`${entity.schema}.${entity.name}`),
        limits: [],
      });
    }
  }
  if (select.includes('columns')) {
    for (const column of snapshot.catalog.columns.filter(inScope)) {
      facts.push({
        id: `column:${column.schema}.${column.table}.${column.name}`,
        kind: 'column',
        classification: 'observed',
        value: {
          schema: column.schema,
          table: column.table,
          name: column.name,
          ordinal: column.ordinal,
          declaredType: column.declaredType ?? column.type ?? null,
          notNull: column.notNull,
          defaultValue: column.defaultValue ?? column.default ?? null,
          primaryKeyOrdinal: column.primaryKeyOrdinal ?? null,
          identity: column.identity ?? null,
          generated: column.generated ?? column.hidden ?? null,
        },
        evidence: evidence(`${column.schema}.${column.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('relationships')) {
    for (const relationship of snapshot.catalog.relationships.filter(inScope)) {
      facts.push({
        id: `relationship:${relationship.schema}.${relationship.table}.${relationship.name ?? relationship.id}`,
        kind: 'relationship',
        classification: 'observed',
        value: {
          schema: relationship.schema,
          table: relationship.table,
          from: relationship.from,
          to: relationship.to,
          references: relationship.references,
          onUpdate: relationship.onUpdate ?? null,
          onDelete: relationship.onDelete ?? null,
          match: relationship.match ?? null,
          validated: relationship.validated ?? null,
          deferrable: relationship.deferrable ?? null,
        },
        evidence: evidence(`${relationship.schema}.${relationship.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('constraints')) {
    for (const constraint of snapshot.catalog.constraints.filter(inScope)) {
      facts.push({
        id: `constraint:${constraint.schema}.${constraint.table}.${constraint.kind}.${constraint.name ?? 'definition'}`,
        kind: 'constraint',
        classification: constraint.definition === 'ddl-text' ? 'declared' : 'observed',
        value: {
          schema: constraint.schema,
          table: constraint.table,
          kind: constraint.kind,
          name: constraint.name ?? null,
          definition: constraint.definition,
          definitionText: constraint.ddlText ?? constraint.definitionText ?? null,
          deferrable: constraint.deferrable ?? null,
          deferred: constraint.deferred ?? null,
          validated: constraint.validated ?? null,
          columns: constraint.columns ?? null,
        },
        evidence: evidence(`${constraint.schema}.${constraint.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('keys')) {
    for (const key of (snapshot.catalog.keys ?? []).filter(inScope)) {
      facts.push({
        id: `key:${key.schema}.${key.table}.${key.kind}.${key.columns.join('+')}`,
        kind: 'key',
        classification: 'observed',
        value: { schema: key.schema, table: key.table, kind: key.kind, columns: key.columns, index: key.index ?? null, origin: key.origin ?? null },
        evidence: evidence(`${key.schema}.${key.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('indexes')) {
    for (const index of snapshot.catalog.indexes.filter(inScope)) {
      facts.push({
        id: `index:${index.schema}.${index.name}`,
        kind: 'index',
        classification: 'observed',
        value: {
          schema: index.schema,
          table: index.table,
          name: index.name,
          unique: index.unique,
          primary: index.primary ?? null,
          origin: index.origin ?? null,
          partial: index.partial ?? null,
          columns: index.columns ?? null,
          definitionText: index.sql ?? index.definition ?? null,
          predicate: index.predicate ?? null,
        },
        evidence: evidence(`${index.schema}.${index.table}`),
        limits: [],
      });
    }
  }
  return facts;
}

function refsFromSnapshot({ provider, snapshot, subject, databaseSelector }) {
  const database = databaseSelector ?? (provider === 'sqlite-schema'
    ? { engine: 'sqlite-schema', path: snapshot.identity.realPath }
    : { engine: 'postgres-schema', connectionFile: null });
  return snapshot.catalog.entities
    .filter(entity => selectedEntity(entity, subject))
    .map(entity => ({
      id: JSON.stringify(['entity', snapshot.identity.snapshotId, entity.schema, entity.name]),
      engine: provider,
      subject: { kind: 'entity', database, schema: entity.schema, name: entity.name },
      snapshotId: snapshot.identity.snapshotId,
      projections: ['entities', 'columns', 'relationships', 'constraints'],
    }));
}

function projectionLimits(select, unsupported) {
  const limits = unsupported.map(projection => ({
    projection,
    code: 'unsupportedProjection',
    detail: `the ${projection} projection is outside the entity catalog profile this adapter serves`,
  }));
  if (select.includes('columnOrigins')) {
    limits.push({
      projection: 'columnOrigins',
      code: 'statementScoped',
      detail: 'result-name origins are reported per analyzed statement, not per catalog entity',
    });
  }
  return limits;
}

export async function catalogAdapterMain({ readStdin, writeStdout, writeStderr }) {
  const raw = await readStdin();
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    writeStdout(`${JSON.stringify(refusal(null, null, 'the input frame is not JSON'))}\n`);
    return 2;
  }
  const { provider, query } = frame;
  if (frame.version !== 1 || !PROVIDERS.has(provider) || typeof frame.request !== 'string' || frame.request.length === 0) {
    writeStdout(`${JSON.stringify(refusal(query ?? null, provider ?? null, 'the frame needs version 1, a known provider and the canonical request text'))}\n`);
    return 2;
  }
  let request;
  try {
    request = JSON.parse(frame.request);
  } catch {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the canonical request text is not JSON'))}\n`);
    return 2;
  }
  if (request.version !== 1 || request.engine !== provider) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the request engine does not match the selected provider'))}\n`);
    return 2;
  }
  const subject = request.subject ?? {};
  const database = subject.database ?? {};
  if (subject.kind !== 'entity' || typeof database !== 'object') {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'this adapter serves the entity subject'))}\n`);
    return 2;
  }
  if (provider === 'sqlite-schema' && (database.engine !== 'sqlite-schema' || typeof database.path !== 'string')) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the entity subject needs a sqlite-schema database path'))}\n`);
    return 2;
  }
  if (provider === 'postgres-schema' && (database.engine !== 'postgres-schema' || typeof database.connectionFile !== 'string')) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the entity subject needs a postgres-schema connection file'))}\n`);
    return 2;
  }
  const select = Array.isArray(request.select) ? request.select : [];
  if (select.length === 0) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the request selects no projection'))}\n`);
    return 2;
  }
  const unsupported = select.filter(projection => !SERVED_PROJECTIONS.has(projection) || projection === 'columnOrigins');
  const records = Array.isArray(frame.inputs?.records) ? frame.inputs.records : [];
  const operation = operationFor({ select, records });
  const requiredEffects = requiredEffectsFor(operation);
  const effects = Array.isArray(request.effects) ? request.effects : [];
  // Component defense for a directly invoked provider. Managed admission
  // remains with the native lifecycle and the core's effect construction.
  if (requiredEffects.some(effect => !effects.includes(effect))) {
    writeStdout(`${JSON.stringify(refusal(query, provider, `the ${operation} operation requires ${requiredEffects.join(', ')}`, 'operationRefused'))}\n`);
    return 2;
  }

  try {
    if (provider === 'sqlite-schema') {
      // One session serves both halves: the catalog facts, the engine plans and
      // the join all come from one connection and one read transaction.
      const session = createSqliteSession({ path: database.path, DatabaseSync });
      let joined = { relations: [], refs: [], limits: [] };
      let snapshot;
      try {
        if (operation === 'codeAccessJoin') joined = session.join({ records });
        snapshot = {
          identity: session.identity,
          catalog: session.catalog,
          limits: session.limits,
          stableWithinTransaction: session.stability().stableWithinTransaction,
          originCapability: session.originCapability,
        };
      } finally {
        session.close();
      }
      const databaseSelector = { engine: 'sqlite-schema', path: snapshot.identity.realPath };
      const facts = factsFromSnapshot({ provider, snapshot, select, subject });
      if (select.includes('columnOrigins')) {
        facts.push({
          id: 'columnOrigins:provider',
          kind: 'columnOrigins',
          classification: 'observed',
          value: { availability: snapshot.originCapability.available ? 'available' : 'unavailable', reason: snapshot.originCapability.reason, probe: snapshot.originCapability.probe },
          evidence: [{ kind: 'schema', databaseIdentity: snapshot.identity.snapshotId, schemaDigest: snapshot.identity.catalogDigest, object: null, column: null }],
          limits: [],
        });
      }
      writeStdout(`${JSON.stringify({
        version: 1,
        provider,
        query,
        operation,
        requiredEffects,
        subject: { kind: 'entity', database: databaseSelector, ...(typeof subject.schema === 'string' ? { schema: subject.schema } : {}), ...(typeof subject.name === 'string' ? { name: subject.name } : {}) },
        snapshot: {
          snapshotId: snapshot.identity.snapshotId,
          engine: snapshot.identity.engine,
          version: snapshot.identity.version,
          sourceId: snapshot.identity.sourceId,
          fileIdentity: snapshot.identity.fileIdentity,
          catalogDigest: snapshot.identity.catalogDigest,
          connection: snapshot.identity.connection,
          observations: snapshot.identity.observations,
        },
        facts,
        relations: joined.relations,
        refs: [...refsFromSnapshot({ provider, snapshot, subject, databaseSelector }), ...joined.refs],
        limits: [...snapshot.limits, ...joined.limits, ...projectionLimits(select, unsupported)],
        coverage: {
          examined: [snapshot.identity.realPath],
          excluded: [],
          providerCompletion: snapshot.stableWithinTransaction,
          unsupported,
          entity: typeof subject.name === 'string' ? `${subject.schema ?? 'main'}.${subject.name}` : null,
        },
        applicability: 'current',
        changedInputs: [],
      })}\n`);
      return 0;
    }

    const inputs = frame.inputs ?? {};
    if (typeof inputs.psql !== 'string' || typeof inputs.home !== 'string' || typeof inputs.tempDirectory !== 'string') {
      writeStdout(`${JSON.stringify(refusal(query, provider, 'the postgres-schema provider needs inputs.psql, inputs.home and inputs.tempDirectory from the admitted launch'))}\n`);
      return 2;
    }
    const databaseSelector = { engine: 'postgres-schema', connectionFile: database.connectionFile };
    const session = openPostgresSession({ psql: inputs.psql, serviceFile: database.connectionFile, home: inputs.home, tempDirectory: inputs.tempDirectory });
    if (session.status !== 'captured') {
      writeStdout(`${JSON.stringify(refusal(query, provider, `catalog capture failed: ${session.refusal?.reason ?? 'unknown'}`))}\n`);
      writeStderr(`${JSON.stringify(session.refusal ?? {})}\n`);
      return 2;
    }
    const snapshot = { identity: session.identity, catalog: session.catalog, limits: session.limits };
    const relations = [];
    const refs = [];
    let limits = [...session.limits];
    if (operation === 'codeAccessJoin') {
      for (const fact of records) {
        // The same provenance admission the SQLite join applies: a malformed or
        // unmatched record yields a limit, never a plan of its text.
        const admission = admitSqlCallRecord(fact);
        if (admission.status !== 'admitted') {
          limits.push({ projection: 'databaseAccesses', code: admission.code, detail: admission.detail, sourceBindingId: fact?.value?.sourceBinding ?? null });
          continue;
        }
        const plan = session.analyze({ sql: admission.sqlText, effects: ['planTargetSql'] });
        if (plan.status !== 'analyzed') {
          limits.push({ projection: 'databaseAccesses', code: plan.refusal?.reason ?? 'statementRefused', detail: plan.refusal?.detail ?? 'the engine refused the statement' });
          continue;
        }
        const joinedPlan = joinPostgresRelations({ plan, catalog: session.catalog, session });
        relations.push(...joinedPlan.relations.map(relation => ({ ...relation, value: { ...relation.value, sourceBindingId: admission.sourceBinding, resolverSnapshotId: admission.resolverSnapshotId } })));
        refs.push({
          id: JSON.stringify(['source', admission.callSite.path, admission.callSite.sha256, admission.callSite.range.start.line, admission.callSite.range.start.column, 'databaseAccesses']),
          engine: 'typescript',
          subject: { kind: 'position', path: admission.callSite.path, line: admission.callSite.range.start.line, column: admission.callSite.range.start.column },
          snapshotId: admission.resolverSnapshotId,
          projections: ['databaseAccesses'],
        });
        limits = limits.concat(joinedPlan.unknownAccess.map(access => ({
          projection: 'databaseAccesses',
          code: 'modeledAccessUnavailable',
          detail: `${access.schema ?? '?'}.${access.name ?? '?'}: ${access.reason}`,
        })));
      }
    }
    session.close();
    writeStdout(`${JSON.stringify({
      version: 1,
      provider,
      query,
      operation,
      requiredEffects,
      subject: { kind: 'entity', database: databaseSelector, ...(typeof subject.schema === 'string' ? { schema: subject.schema } : {}), ...(typeof subject.name === 'string' ? { name: subject.name } : {}) },
      snapshot: {
        snapshotId: snapshot.identity.snapshotId,
        engine: snapshot.identity.engine,
        version: snapshot.identity.version,
        database: snapshot.identity.database,
        role: snapshot.identity.role,
        searchPath: snapshot.identity.searchPath,
        connectionSearchPath: snapshot.identity.connectionSearchPath,
        catalogDigest: snapshot.identity.catalogDigest,
      },
      facts: factsFromSnapshot({ provider, snapshot, select, subject }),
      relations,
      refs: [...refsFromSnapshot({ provider, snapshot, subject, databaseSelector }), ...refs],
      limits: [...limits, ...projectionLimits(select, unsupported)],
      coverage: {
        examined: [snapshot.identity.database],
        excluded: [],
        providerCompletion: true,
        unsupported,
        entity: typeof subject.name === 'string' ? `${subject.schema ?? 'public'}.${subject.name}` : null,
      },
      applicability: 'current',
      changedInputs: [],
    })}\n`);
    return 0;
  } catch (error) {
    writeStderr(`${String(error?.stack ?? error)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const code = await catalogAdapterMain({
    readStdin: async () => Buffer.concat(chunks).toString('utf8'),
    writeStdout: text => process.stdout.write(text),
    writeStderr: text => process.stderr.write(text),
  });
  process.exitCode = code;
}
