// Phase 93a.3a Program-level `collect` result-schema derivation (§93.9). This module is pure — no
// I/O, no Date, no randomness — and performs one closed normalization operation, never runtime
// inference:
//
//   deriveCollectSchemaDefinition — author-aid (rule 6). The call registers (via
//     createValueSchemaDefinition) every definition the walk needs and returns the complete
//     frozen definition an author must add to Program `schemas` before building a `collect` node.
//   resolveCollectResultSchema — normalizer-facing (lookup mode). The same derived shape, but
//     every definition it needs MUST already be registered under its pinned name; nothing is
//     auto-registered here.
//
// Rule 7 back-port from §93.10A: a derived definition's name is pinned to the digest of its own
// canonical bytes, so author labels never reach Program identity for `collect` either.

import { createHash } from 'node:crypto';

import { canonicalValueBytes, canonicalValueText, compareProgramIdentityKeys } from './canonical-value.mjs';
import { createValueSchemaDefinition, valueSchemaRef } from './schema-values.mjs';
import { fail } from './control-nodes.mjs';

function pinnedName(definitionBody, authority) {
  const bytes = canonicalValueBytes(definitionBody, authority);
  return `baton.derived.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
}

function sortedProperties(properties) {
  return [...properties].sort((left, right) => compareProgramIdentityKeys(left.name, right.name));
}

function createResolver(mode) {
  const cache = new Map();
  const created = [];
  const { authority } = mode;
  function resolve(form, definitionBody) {
    const name = pinnedName(definitionBody, authority);
    const cached = cache.get(name);
    if (cached) return cached;
    let result;
    if (mode.kind === 'create') {
      const definition = createValueSchemaDefinition({
        schemaVersion: 1, kind: 'baton.value_schema', name, version: 1, form,
        definition: definitionBody,
      }, authority);
      result = { schema: valueSchemaRef(definition), definition };
      created.push(definition);
    } else {
      const match = mode.registry.schemas.find((entry) => entry.name === name && entry.version === 1);
      if (!match) {
        fail(`result-schema derivation requires a schema registered as ${name} `
          + '(bottom-up pinned-name resolution; author labels never reach Program identity)');
      }
      if (match.form !== form || canonicalValueText(match.definition, authority)
        !== canonicalValueText(definitionBody, authority)) {
        fail(`result-schema derivation found ${name} registered with non-matching structural bytes`);
      }
      result = { schema: valueSchemaRef(match), definition: match };
    }
    cache.set(name, result);
    return result;
  }
  return { resolve, created };
}

function objectOf(ctx, properties) {
  return ctx.resolver.resolve('object', {
    type: 'object', properties: sortedProperties(properties), additionalProperties: false,
  });
}

// §93.9 Program-level `collect` control node. `items` = [{name, schema: SchemaRef}], already
// resolved by the caller; `collect` requires every property present (no `project`-style optional
// exception).
export function deriveCollectSchemaDefinition(items, { authority }) {
  const resolver = createResolver({ kind: 'create', authority });
  const definition = objectOf({ resolver }, items.map(({ name, schema }) => (
    { name, schema, required: true })));
  return definition.definition;
}

export function resolveCollectResultSchema(items, { authority, registry }) {
  const resolver = createResolver({ kind: 'lookup', authority, registry });
  return objectOf({ resolver }, items.map(({ name, schema }) => ({ name, schema, required: true })));
}
