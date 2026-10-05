// JSON Schema admission and instance validation through bundled Ajv 8.17.1.
//
// The provider uses the draft 2020-12 entry point and fixes strict mode,
// all-errors reporting and format validation. No custom format is registered,
// so the compiler refuses a schema that names a format it cannot assert.
// Reference resolution is closed over the caller's explicit local `resources`
// set: this provider supplies no loader, so a reference that would need a fetch
// cannot compile.
//
// The Ajv constructor arrives by injection, which keeps the bundled package
// import in the staged adapter and lets the domain tests exercise the real
// package from its resolved path.

export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

const FIXED_OPTIONS = Object.freeze({
  strict: true,
  allErrors: true,
  validateFormats: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateSchema: true,
  addUsedSchema: false,
});

function walkRefs(node, visit, pointer = '') {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walkRefs(entry, visit, `${pointer}/${index}`));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') visit(value, pointer);
    walkRefs(value, visit, `${pointer}/${key}`);
  }
}

export function createJsonSchemaProvider({ Ajv2020, version = null, path = null }) {
  if (typeof Ajv2020 !== 'function') throw new TypeError('createJsonSchemaProvider requires the Ajv draft 2020-12 constructor');
  const provider = { name: 'ajv', version, path, options: { ...FIXED_OPTIONS } };

  // Every reference must resolve inside this document or inside the explicit
  // resource set. A URL reference stays refused here, before any loader runs.
  function admitReferences({ schema, resources }) {
    const ids = new Set();
    for (const resource of resources) {
      const id = resource.$id;
      if (typeof id !== 'string' || id.length === 0) {
        return { status: 'refused', reason: 'resourceWithoutId', detail: 'every supplied resource declares a nonempty $id' };
      }
      if (ids.has(id)) return { status: 'refused', reason: 'duplicateResourceId', detail: `resource $id ${id} was supplied twice` };
      ids.add(id);
    }
    const admitted = new Set(['#', ...ids]);
    let refusal = null;
    const documents = [schema, ...resources];
    for (const document of documents) {
      walkRefs(document, (reference) => {
        if (refusal !== null) return;
        const target = reference.startsWith('#') ? '#' : reference.split('#')[0];
        if (target === '' || target === '#') return;
        if (!admitted.has(target)) {
          refusal = { status: 'refused', reason: 'referenceOutsideResources', detail: `reference ${reference} resolves to no supplied resource; remote loading is disabled` };
        }
      });
    }
    return refusal ?? { status: 'admitted' };
  }

  function compile({ schema, resources = [] }) {
    const referenceVerdict = admitReferences({ schema, resources });
    if (referenceVerdict.status !== 'admitted') return referenceVerdict;
    const ajv = new Ajv2020({ ...FIXED_OPTIONS });
    for (const resource of resources) {
      try {
        ajv.addSchema(resource);
      } catch (error) {
        return { status: 'refused', reason: 'resourceRejected', detail: error.message, resourceId: resource.$id ?? null };
      }
    }
    let validator;
    try {
      validator = ajv.compile(schema);
    } catch (error) {
      const schemaErrors = (error.errors ?? []).map(entry => ({
        instancePath: entry.instancePath ?? null,
        schemaPath: entry.schemaPath ?? null,
        keyword: entry.keyword ?? null,
        params: entry.params ?? null,
        message: entry.message ?? null,
      }));
      return {
        status: 'refused',
        reason: ajv.errors === null && /format/.test(error.message) ? 'unknownFormat' : 'schemaRefused',
        detail: error.message,
        schemaErrors,
      };
    }
    return { status: 'admitted', validator };
  }

  return {
    provider,
    // Admission alone: does this document compile under the fixed options?
    admit({ schema, resources = [] }) {
      const verdict = compile({ schema, resources });
      return verdict.status === 'admitted' ? { status: 'admitted', provider } : verdict;
    },
    // Admission plus one instance verdict. Errors keep the validator's own
    // instance pointer, schema pointer, keyword and rule parameters.
    validate({ schema, resources = [], instance }) {
      const verdict = compile({ schema, resources });
      if (verdict.status !== 'admitted') return verdict;
      const valid = verdict.validator(instance);
      return {
        status: 'validated',
        provider,
        verdict: valid === true,
        errors: valid === true ? [] : (verdict.validator.errors ?? []).map(entry => ({
          instancePath: entry.instancePath ?? null,
          schemaPath: entry.schemaPath ?? null,
          keyword: entry.keyword ?? null,
          params: entry.params ?? null,
          message: entry.message ?? null,
          propertyName: entry.propertyName ?? null,
        })),
      };
    },
    // Structural check of the document against the dialect metaschema.
    validateSchema({ schema }) {
      const ajv = new Ajv2020({ ...FIXED_OPTIONS });
      const valid = ajv.validateSchema(schema);
      return {
        status: 'checked',
        verdict: valid === true,
        errors: valid === true ? [] : (ajv.errors ?? []).map(entry => ({
          instancePath: entry.instancePath ?? null,
          schemaPath: entry.schemaPath ?? null,
          keyword: entry.keyword ?? null,
          params: entry.params ?? null,
          message: entry.message ?? null,
        })),
      };
    },
  };
}
