// Model-use join: code that imports or calls a resolved model export.
//
// Input: `moduleUse` facts whose `value.record` is the ResolverUseRecord the
// TypeScript resolver owns, plus the model identity this provider observed when
// it loaded the export. Output: relations bound to the resolver snapshot and
// the model snapshot.
//
// The join never parses TypeScript and never decides identity from a file name
// or a bare export spelling. It compares the record's own captured module bytes
// and the checker-resolved declaration bytes with the observed model, and it
// refuses with a named limit when a required member is absent or disagrees. A
// missing snapshot, a changed module digest, a declaration outside the module
// and a different export name each produce a limit instead of a relation.

import { digestJson } from '../catalogs/canonical.mjs';

function refId(parts) {
  return JSON.stringify(parts);
}

function siteIdentity(site) {
  if (site === null || typeof site !== 'object') return null;
  if (typeof site.path !== 'string' || site.path.length === 0) return null;
  if (typeof site.sha256 !== 'string' || site.sha256.length === 0) return null;
  if (typeof site.range?.start?.line !== 'number' || typeof site.range?.start?.column !== 'number') return null;
  if (typeof site.range?.end?.line !== 'number' || typeof site.range?.end?.column !== 'number') return null;
  return { path: site.path, sha256: site.sha256, range: site.range, role: site.role ?? null };
}

function limit(value, code, detail) {
  return { projection: 'codeAccesses', code, detail, useSiteRef: value?.useSiteRef ?? null };
}

// The projection a use-site ref carries is the admitted source projection for
// that use: a call site is a caller of the export, any other reference is a
// reference. `codeAccesses` belongs to the entity and model projections.
function useProjection(role) {
  return role === 'call' || role === 'new' ? 'callers' : 'references';
}

export function joinModelUses({ model, uses }) {
  const relations = [];
  const refs = [];
  const limits = [];
  const modelPath = model?.module?.realPath ?? model?.module?.path ?? null;
  const modelSha = model?.module?.sha256 ?? null;
  const modelExport = model?.export?.name ?? null;
  const modelSnapshot = model?.snapshotId ?? null;

  if (modelPath === null || modelSha === null) {
    return { relations, refs, limits: [limit(null, 'modelIdentityAbsent', 'the observed model carries no module path and digest, so no use edge can be bound')] };
  }
  if (modelSnapshot === null) {
    return { relations, refs, limits: [limit(null, 'modelSnapshotAbsent', 'the observed model carries no snapshot identity')] };
  }

  for (const fact of uses) {
    if (fact.kind !== 'moduleUse') {
      limits.push(limit(fact.value, 'unsupportedRecordKind', `fact kind ${JSON.stringify(fact.kind)} is outside the model-use join`));
      continue;
    }
    const value = fact.value ?? {};
    const record = value.record;
    if (record === null || typeof record !== 'object') {
      limits.push(limit(value, 'recordAbsent', 'the fact carries no project record; the flat proposal shape is not consumed'));
      continue;
    }
    if (record.kind !== 'modelUse') {
      limits.push(limit(value, 'recordKindMismatch', `the record kind is ${JSON.stringify(record.kind)}`));
      continue;
    }
    if (typeof record.snapshotId !== 'string' || record.snapshotId.length === 0) {
      limits.push(limit(value, 'resolverSnapshotAbsent', 'the record carries no resolver snapshot identity'));
      continue;
    }
    const useSite = siteIdentity(record.useSite);
    if (useSite === null) {
      limits.push(limit(value, 'useSiteAbsent', 'the record carries no captured use-site bytes and range'));
      continue;
    }
    if (typeof record.module?.path !== 'string' || record.module.path.length === 0 || typeof record.module.sha256 !== 'string' || record.module.sha256.length === 0) {
      limits.push(limit(value, 'resolvedModuleIncomplete', 'the record carries no complete resolved module path and digest'));
      continue;
    }
    if (record.resolution?.status !== 'resolved') {
      limits.push(limit(value, 'exportUnresolved', `the export resolution is ${JSON.stringify(record.resolution?.status ?? 'absent')}${record.resolution?.reason ? `: ${record.resolution.reason}` : ''}`));
      continue;
    }
    const declaration = record.resolution.declaration;
    if (typeof declaration?.path !== 'string' || declaration.path.length === 0 || typeof declaration.sha256 !== 'string' || declaration.sha256.length === 0
      || typeof declaration.range?.start?.line !== 'number' || typeof declaration.range?.start?.column !== 'number') {
      limits.push(limit(value, 'exportDeclarationIncomplete', 'the resolved export carries no complete declaration path, digest and range'));
      continue;
    }
    if (record.module.path !== modelPath) {
      limits.push(limit(value, 'modelModuleMismatch', `the record resolves ${record.module.path} and the observed model is ${modelPath}`));
      continue;
    }
    if (record.module.sha256 !== modelSha) {
      limits.push(limit(value, 'modelModuleHashMismatch', `the record carries module digest ${record.module.sha256} and the observed module digest is ${modelSha}`));
      continue;
    }
    if (declaration.path !== modelPath) {
      limits.push(limit(value, 'exportDeclarationOutsideModule', `the resolved export declares ${declaration.path}, outside the observed module`));
      continue;
    }
    if (declaration.sha256 !== modelSha) {
      limits.push(limit(value, 'exportDeclarationHashMismatch', `the resolved export carries digest ${declaration.sha256} and the observed module digest is ${modelSha}`));
      continue;
    }
    if (record.export !== modelExport) {
      limits.push(limit(value, 'modelExportMismatch', `the record names export ${JSON.stringify(record.export)} and the observed model export is ${JSON.stringify(modelExport)}`));
      continue;
    }

    const projection = useProjection(useSite.role);
    const useRef = {
      id: refId(['source', useSite.path, useSite.sha256, useSite.range.start.line, useSite.range.start.column, projection]),
      engine: record.provider?.engine ?? 'typescript',
      subject: { kind: 'position', path: useSite.path, line: useSite.range.start.line, column: useSite.range.start.column },
      snapshotId: record.snapshotId,
      projections: [projection],
    };
    const exportRef = {
      id: refId(['source', declaration.path, declaration.sha256, declaration.range.start.line, declaration.range.start.column, 'definition']),
      engine: record.provider?.engine ?? 'typescript',
      subject: { kind: 'position', path: declaration.path, line: declaration.range.start.line, column: declaration.range.start.column },
      snapshotId: record.snapshotId,
      projections: ['definition'],
    };
    refs.push(useRef, exportRef);
    relations.push({
      id: refId(['relation', 'modelUse', record.snapshotId, useRef.id]),
      kind: 'modelUse',
      classification: 'static-possible',
      value: {
        form: useSite.role ?? 'reference',
        exportName: modelExport,
        modulePath: modelPath,
        identityBasis: 'declaration-path-and-digest',
        resolverSnapshotId: record.snapshotId,
        modelSnapshotId: modelSnapshot,
        modelProvider: model?.provider ?? null,
      },
      from: useRef.id,
      to: exportRef.id,
      evidence: [
        { kind: 'source', path: useSite.path, sha256: useSite.sha256, range: useSite.range, role: 'modelUse' },
        { kind: 'source', path: declaration.path, sha256: declaration.sha256, range: declaration.range, role: 'modelExportDeclaration' },
      ],
      limits: [],
    });
    for (const entry of record.limits ?? []) {
      limits.push({ projection: 'codeAccesses', code: 'recordLimit', detail: String(entry), useSiteRef: value.useSiteRef ?? null });
    }
  }
  const joinDigest = digestJson({
    modelModulePath: modelPath,
    modelModuleSha256: modelSha,
    modelExport,
    modelSnapshotId: modelSnapshot,
    relations: relations.map(relation => relation.id),
  });
  return { relations, refs, limits, joinDigest };
}
