#!/usr/bin/env node
// Record-builder contract checks, run through Node so the real ESM builders execute.
//
// Each case asserts what the builder must refuse or accept, and the parent test keeps this
// process's complete argv, stdout, stderr and exit status as evidence. The builder owns identity
// validation: an empty or missing identity field is a refusal, not a value that later compares
// equal to another empty value.

import {
  constantSqlRecord,
  modelUseRecord,
  declaration,
  resolvedResolution,
  unresolvedResolution,
} from '../../lib/records.mjs';

const cases = [];

function attempt(name, fn) {
  try {
    const value = fn();
    cases.push({ name, threw: false, value });
  } catch (error) {
    cases.push({ name, threw: true, error: error.name, message: String(error.message) });
  }
}

const provider = { version: '5.9.3', libraryPath: '/p/typescript/lib/typescript.js', librarySha: 'aa' };
const range = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };
const useSite = { path: '/m.ts', sha256: 'aa', range, role: 'importSpecifier' };

attempt('modelUse_missing_module_digest', () =>
  modelUseRecord({
    resolved: provider,
    snapshotId: 'snap',
    useSite,
    module: { path: '/m.ts', sha256: '' },
    exportName: 'create',
    resolution: unresolvedResolution('moduleUnresolved'),
    limits: [],
  }),
);

attempt('modelUse_missing_snapshot', () =>
  modelUseRecord({
    resolved: provider,
    snapshotId: '',
    useSite,
    module: { path: '/m.ts', sha256: 'aa' },
    exportName: 'create',
    resolution: unresolvedResolution('moduleUnresolved'),
    limits: [],
  }),
);

attempt('modelUse_missing_use_site_range', () =>
  modelUseRecord({
    resolved: provider,
    snapshotId: 'snap',
    useSite: { path: '/m.ts', sha256: 'aa', range: { start: { line: -1, column: 0 }, end: { line: 0, column: 1 } }, role: 'importSpecifier' },
    module: { path: '/m.ts', sha256: 'aa' },
    exportName: 'create',
    resolution: unresolvedResolution('moduleUnresolved'),
    limits: [],
  }),
);

attempt('modelUse_complete_record', () =>
  modelUseRecord({
    resolved: provider,
    snapshotId: 'snap',
    useSite,
    module: { path: '/m.ts', sha256: 'aa' },
    exportName: 'create',
    resolution: resolvedResolution(declaration('/m.ts', 'aa', range)),
    limits: [],
  }),
);

attempt('constantSql_empty_declaration_digest', () =>
  constantSqlRecord({
    resolved: provider,
    snapshotId: 'snap',
    callSite: { path: '/db.ts', sha256: 'aa', range },
    callee: resolvedResolution(declaration('/client.d.ts', '', range)),
    receiver: resolvedResolution(declaration('/db.ts', 'aa', range)),
    sql: { status: 'constant', text: 'SELECT 1', literalKind: 'stringLiteral' },
    statementKind: 'unknown',
    limits: [],
  }),
);

attempt('constantSql_dynamic_sql_keeps_its_reason', () =>
  constantSqlRecord({
    resolved: provider,
    snapshotId: 'snap',
    callSite: { path: '/db.ts', sha256: 'aa', range },
    callee: resolvedResolution(declaration('/client.d.ts', 'aa', range)),
    receiver: resolvedResolution(declaration('/db.ts', 'aa', range)),
    sql: { status: 'dynamic', reason: 'templateSubstitution' },
    statementKind: 'unknown',
    limits: ['dynamicSql'],
  }),
);

process.stdout.write(`${JSON.stringify({ schema: 'baton2.context.resolver-record.v1', cases })}\n`);
