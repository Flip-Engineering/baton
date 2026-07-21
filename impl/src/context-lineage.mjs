import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/u;
const COORDINATE_FIELDS = Object.freeze([
  'branch', 'itemDigest', 'itemIndex', 'sourceDigest', 'sourceRef',
]);
const OUTPUT_LINEAGE_FIELDS = Object.freeze([
  'coordinateDigest', 'derivationDigest', 'derivations', 'index', 'itemDigest',
  'lineageDigest', 'parentDigest', 'parents', 'sourceCoordinates',
]);

function lineageError(message, code = 'context_output_lineage_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function normalizeJson(value, active = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw lineageError('Context lineage contains a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') {
    throw lineageError('Context lineage must contain only JSON values');
  }
  if (active.has(value)) throw lineageError('Context lineage contains a cycle');
  active.add(value);
  let normalized;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/u.test(key)
      || Number(key) >= value.length)
      || Array.from({ length: value.length }, (_, index) => index)
        .some((index) => !Object.hasOwn(value, index))) {
      throw lineageError('Context lineage contains a sparse or decorated array');
    }
    normalized = value.map((entry) => normalizeJson(entry, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw lineageError('Context lineage contains a non-JSON object');
    }
    normalized = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, normalizeJson(value[key], active),
    ]));
  }
  active.delete(value);
  return normalized;
}

function canonical(value) { return normalizeJson(value); }

function stable(value) { return JSON.stringify(canonical(value)); }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compare(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw lineageError(`${label} is malformed`);
  }
}

function normalizeCoordinate(value) {
  exact(value, COORDINATE_FIELDS, 'Context source coordinate');
  if (typeof value.branch !== 'string' || value.branch.length === 0
    || typeof value.sourceRef !== 'string' || value.sourceRef.length === 0
    || !DIGEST.test(value.sourceDigest ?? '')
    || !Number.isSafeInteger(value.itemIndex) || value.itemIndex < 0
    || !DIGEST.test(value.itemDigest ?? '')) {
    throw lineageError('Context source coordinate is invalid');
  }
  return canonical(value);
}

export function contextLineageDigest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

export function canonicalContextCoordinates(value) {
  if (!Array.isArray(value)) throw lineageError('Context source coordinates are invalid');
  const unique = new Map();
  for (const raw of value) {
    const coordinate = normalizeCoordinate(raw);
    const identity = stable(coordinate);
    if (!unique.has(identity)) unique.set(identity, coordinate);
  }
  return deepFreeze([...unique.values()].sort((left, right) => {
    for (const field of ['branch', 'sourceRef', 'sourceDigest']) {
      const order = compare(left[field], right[field]);
      if (order !== 0) return order;
    }
    if (left.itemIndex !== right.itemIndex) return left.itemIndex - right.itemIndex;
    return compare(left.itemDigest, right.itemDigest);
  }));
}

function pureOutputLineage(item, sourceCoordinates, index) {
  const coordinates = canonicalContextCoordinates(sourceCoordinates);
  const itemDigest = contextLineageDigest(item);
  const coordinateDigest = contextLineageDigest(coordinates);
  const parents = deepFreeze([]);
  const parentDigest = contextLineageDigest(parents);
  const derivations = deepFreeze([]);
  const derivationDigest = contextLineageDigest(derivations);
  const lineageDigest = contextLineageDigest({
    schemaVersion: 1, itemDigest, coordinateDigest, parentDigest, derivationDigest,
  });
  return deepFreeze({
    index, itemDigest, sourceCoordinates: coordinates, coordinateDigest,
    parents, parentDigest, derivations, derivationDigest, lineageDigest,
  });
}

export function buildPureContextOutputLineage(items, coordinatesByItem) {
  if (!Array.isArray(items) || !Array.isArray(coordinatesByItem)
    || items.length !== coordinatesByItem.length) {
    throw lineageError('Context output lineage does not match its output items');
  }
  const outputLineages = deepFreeze(items.map((item, index) => (
    pureOutputLineage(item, coordinatesByItem[index], index)
  )));
  const outputLineageDigest = contextLineageDigest(outputLineages.map((lineage) => ({
    index: lineage.index, itemDigest: lineage.itemDigest, lineageDigest: lineage.lineageDigest,
  })));
  const sourceCoordinates = canonicalContextCoordinates(
    outputLineages.flatMap((lineage) => lineage.sourceCoordinates),
  );
  return deepFreeze({
    outputLineages,
    outputLineageDigest,
    sourceCoordinates,
    coordinateDigest: contextLineageDigest(sourceCoordinates),
  });
}

export function validatePureContextOutputLineage({
  items, outputLineages, outputLineageDigest, sourceCoordinates, coordinateDigest,
}) {
  if (!Array.isArray(items) || !Array.isArray(outputLineages)
    || items.length !== outputLineages.length) {
    throw lineageError('Context output lineage count is invalid');
  }
  for (const [index, lineage] of outputLineages.entries()) {
    exact(lineage, OUTPUT_LINEAGE_FIELDS, 'Context output lineage');
    if (lineage.index !== index || lineage.itemDigest !== contextLineageDigest(items[index])
      || !Array.isArray(lineage.parents) || lineage.parents.length !== 0
      || !Array.isArray(lineage.derivations) || lineage.derivations.length !== 0) {
      throw lineageError('Context output lineage item binding is invalid');
    }
    const coordinates = canonicalContextCoordinates(lineage.sourceCoordinates);
    if (stable(coordinates) !== stable(lineage.sourceCoordinates)
      || lineage.coordinateDigest !== contextLineageDigest(coordinates)
      || lineage.parentDigest !== contextLineageDigest(lineage.parents)
      || lineage.derivationDigest !== contextLineageDigest(lineage.derivations)
      || lineage.lineageDigest !== contextLineageDigest({
        schemaVersion: 1,
        itemDigest: lineage.itemDigest,
        coordinateDigest: lineage.coordinateDigest,
        parentDigest: lineage.parentDigest,
        derivationDigest: lineage.derivationDigest,
      })) {
      throw lineageError('Context output lineage digest is invalid');
    }
  }
  const expectedOutputDigest = contextLineageDigest(outputLineages.map((lineage) => ({
    index: lineage.index, itemDigest: lineage.itemDigest, lineageDigest: lineage.lineageDigest,
  })));
  const expectedCoordinates = canonicalContextCoordinates(
    outputLineages.flatMap((lineage) => lineage.sourceCoordinates),
  );
  if (outputLineageDigest !== expectedOutputDigest
    || stable(sourceCoordinates) !== stable(expectedCoordinates)
    || coordinateDigest !== contextLineageDigest(expectedCoordinates)) {
    throw lineageError('Context aggregate output lineage is invalid');
  }
  return deepFreeze({
    outputLineages: canonical(outputLineages), outputLineageDigest,
    sourceCoordinates: canonical(sourceCoordinates), coordinateDigest,
  });
}

