#!/usr/bin/env node
// The cross-module producer/consumer fixture for the constant-SQL record.
//
// This stands in for the catalogs/models consumer: it reads a JSON document on stdin
// {snapshotId, records} where records are the producer's ConstantSqlRecord v1 values, and decides
// which records may join to a catalog plan. It must reproduce the consumer negatives that were
// observed against the first record draft:
//
//   - a record whose identity fields are missing or empty cannot join;
//   - a record without a resolved receiver cannot join;
//   - a record whose snapshot does not match the enclosing document cannot join;
//   - a record whose SQL is dynamic cannot join.
//
// The consumer never treats a ref id string as an object: source evidence comes only from the
// record's own structured callSite.
//
// Output: one JSON line {accepted, rejected, keys}. Exit 0 on completion; the verdict is the
// content, not the exit status.

import { createHash } from 'node:crypto';

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function keyOf(snapshotId, record) {
  const binding = [
    record.callSite.path,
    record.callSite.sha256,
    record.callSite.range.start.line,
    record.callSite.range.start.column,
    record.sql.text,
  ].join('@');
  return createHash('sha256').update([snapshotId, binding].join('|')).digest('hex');
}

function refusal(record, document) {
  if (record === null || typeof record !== 'object') return 'recordMissing';
  if (record.schema !== 'baton2.context.resolver-record.v1') return 'schemaUnsupported';
  if (record.kind !== 'constantSql') return 'kindUnsupported';
  if (typeof record.snapshotId !== 'string' || record.snapshotId.length === 0) return 'snapshotMissing';
  if (record.snapshotId !== document.snapshotId) return 'snapshotMismatch';
  if (typeof record.callSite?.path !== 'string' || record.callSite.path.length === 0) return 'callSiteMissing';
  if (typeof record.callSite?.sha256 !== 'string' || record.callSite.sha256.length === 0) return 'callSiteDigestMissing';
  if (record.callee?.status !== 'resolved') return 'calleeUnresolved';
  const declaration = record.callee.declaration;
  if (typeof declaration?.path !== 'string' || declaration.path.length === 0) return 'calleeDeclarationMissing';
  if (typeof declaration?.sha256 !== 'string' || declaration.sha256.length === 0) return 'calleeDigestMissing';
  if (record.receiver?.status !== 'resolved') return 'receiverUnresolved';
  if (record.sql?.status !== 'constant') return 'sqlDynamic';
  if (typeof record.sql.text !== 'string' || record.sql.text.length === 0) return 'sqlTextMissing';
  return null;
}

const document = JSON.parse(await readStdin());
const accepted = [];
const rejected = [];
for (const record of document.records ?? []) {
  const reason = refusal(record, document);
  if (reason === null) {
    accepted.push({ key: keyOf(document.snapshotId, record), statement: record.sql.text });
  } else {
    rejected.push({ reason });
  }
}
process.stdout.write(`${JSON.stringify({
  accepted: accepted.length > 0,
  rejected: rejected.length > 0,
  keys: accepted,
  refusals: rejected,
  snapshotId: document.snapshotId,
})}\n`);
