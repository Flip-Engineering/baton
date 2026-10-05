// Selected operation and required target-effect set for each exported callable.
//
// The native core and codec own the operation discriminator, the canonical
// required-effect construction and managed admission. This table reports what
// each domain callable actually does; in particular the schema-validation
// operation imports no target module and needs no target-effect grant, while
// explicit model loading needs `executeTarget` before any child starts.

export const MODEL_OPERATIONS = Object.freeze([
  {
    callable: 'createJsonSchemaProvider',
    operation: 'schemaValidation',
    requiredEffects: [],
    targetInputs: ['schema', 'resources', 'sample'],
    detail: 'bundled Ajv computation over the admitted documents; no target module is imported and no target statement runs',
  },
  {
    callable: 'readJsonSample',
    operation: 'localRead',
    requiredEffects: [],
    targetInputs: ['samplePath'],
    detail: 'reads and parses the sample bytes',
  },
  {
    callable: 'runZodModelChild',
    operation: 'modelLoad',
    requiredEffects: ['executeTarget'],
    targetInputs: ['module', 'export', 'sample', 'outputDirectory'],
    detail: 'starts the controlled child that imports the selected module export, evaluates it against the sample and converts its schemas',
  },
  {
    callable: 'zodChildMain',
    operation: 'targetExecution',
    requiredEffects: ['executeTarget'],
    targetInputs: ['module', 'export', 'sample'],
    detail: 'the child side of the same operation; the grant is checked before the parent starts it',
  },
  {
    callable: 'joinModelUses',
    operation: 'modelUseJoin',
    requiredEffects: [],
    targetInputs: ['resolverRecords', 'observedModelIdentity'],
    detail: 'compares resolver records with an already observed model identity; it imports no target module, and expanding codeAccesses alone must not load one',
  },
]);
