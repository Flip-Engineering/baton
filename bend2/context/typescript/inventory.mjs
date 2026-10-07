// Package admission inventory builder for the TypeScript provider.
//
// Package admission supplies Inv{artifacts, schemas, digests} and this
// module authenticates nothing in it (engines-decl.bend: the inventory
// authenticates nothing; admission re-derives the digest it publishes).
// What this module does is derive inventory ROWS from actual presented
// bytes: every digest is computed over the bytes handed in, so no digest,
// path, role or schema identity is ever invented here.
//
// What stays outside this module, with its owner:
//   staged file list and installed paths ... the package owner (no provider
//     staging rule exists in the authoritative tree; the older 12-row list
//     assumed one, so rows are built here from presented input, never from
//     a hardcoded list)
//   admitted schema identities ............ package admission, into Inv.schemas
//   declaration digest .................... admission, re-derived at publish
//   launch argv ........................... the deployment (probe convention
//     <tsProvider> --engines; query launch <node> <provider.mjs> + stdin)

import { createHash } from 'node:crypto';

function refusal(reason, detail) {
  return Object.freeze({ status: 'refused', reason, detail: detail === undefined ? null : detail });
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isBytes(value) {
  return value instanceof Uint8Array;
}

// Build Decl.Art rows from presented staged files. Each entry names its
// installed path, carries its bytes, and states the role it plays in the
// entry or the dependency closure; the digest is computed, never authored.
export function buildArtifactRows(files) {
  if (!Array.isArray(files)) {
    return refusal('inventoryInputMalformed', 'staged files arrive as an array of {path, bytes, role}');
  }
  const seen = new Set();
  const rows = [];
  for (let index = 0; index < files.length; index += 1) {
    const entry = files[index];
    if (entry === null || typeof entry !== 'object') {
      return refusal('inventoryInputMalformed', `staged file ${index} is not an object`);
    }
    const { path, bytes, role } = entry;
    if (typeof path !== 'string' || path.length === 0) {
      return refusal('inventoryPathMissing', `staged file ${index} names no installed path`);
    }
    if (typeof role !== 'string' || role.length === 0) {
      return refusal('inventoryRoleMissing', `${path} states no entry or closure role`);
    }
    if (!isBytes(bytes)) {
      return refusal('inventoryBytesMissing', `${path} presents no bytes to digest`);
    }
    if (seen.has(path)) {
      return refusal('inventoryDuplicatePath', `${path} is staged twice`);
    }
    seen.add(path);
    rows.push(Object.freeze({ path, sha256: sha256Hex(bytes), role }));
  }
  return Object.freeze({ status: 'rows', rows: Object.freeze(rows) });
}

// Assemble the Inv-shaped record from rows the caller holds. Schema
// identities and declaration digests pass through untouched: this module
// checks their shape and refuses blanks, it never fills a hole with a
// fabricated string.
export function buildInventory({ artifacts, schemas, digests } = {}) {
  if (!Array.isArray(artifacts) || !Array.isArray(schemas) || !Array.isArray(digests)) {
    return refusal('inventoryInputMalformed', 'an inventory assembles arrays of artifacts, schemas and digests');
  }
  for (const row of artifacts) {
    if (row === null || typeof row !== 'object' || typeof row.path !== 'string' || row.path.length === 0) {
      return refusal('inventoryPathMissing', 'an artifact row names no installed path');
    }
    if (typeof row.sha256 !== 'string' || row.sha256.length === 0) {
      return refusal('inventoryDigestMissing', `${row.path} carries no digest; digests come from packaged bytes, never from blank strings`);
    }
  }
  for (const schema of schemas) {
    if (typeof schema !== 'string' || schema.length === 0) {
      return refusal('inventorySchemaMissing', 'a schema identity is an admitted non-empty string, never a filled hole');
    }
  }
  for (const entry of digests) {
    if (entry === null || typeof entry !== 'object' || typeof entry.digest_module !== 'string' || entry.digest_module.length === 0) {
      return refusal('inventoryDigestModuleMissing', 'a declaration digest names its module');
    }
    if (typeof entry.digest !== 'string' || entry.digest.length === 0) {
      return refusal('inventoryDigestMissing', `${entry.digest_module} carries no declaration digest`);
    }
  }
  return Object.freeze({
    artifacts: Object.freeze([...artifacts]),
    schemas: Object.freeze([...schemas]),
    digests: Object.freeze([...digests]),
  });
}
