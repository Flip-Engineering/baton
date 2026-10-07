// Typed loader: lane serialization (declaration JSON, SchemaDef assets,
// schema fixtures) to Bend typed literals for the actual boundary gate.
//
// The emitted probe module places every value in the exact constructors the
// corrected schema pin checks: SchemaDef/SchemaForm spines, Codec.RawValue
// cells, and J.Json cells. Arrays become Rarr/Jarr chains with the canonical
// empty sentinels (Rarr{Rnil,Rnil} / Jarr{Jnil,Jnil}); records are closed;
// branch records are SfDiscriminated{tag, SchemaCase spine} selecting the
// case by the flat tag member value; strings are escaped. Numbers appear
// only as RawValue tokens: the declaration carries none, so a number on the
// declaration path is an explicit loader error, not a silent Jint. One
// duplicate-key fixture is hand-built as Rpair literals because JSON cannot
// carry a duplicate key. The probe also projects the
// single declared operation out of the real decoded Decl value and checks
// its effects spine is empty and its execution is managed (two laws).
//
// Usage: node native-schema-loader.mjs > native-schema-probe.bend
// The probe sits in bend2/src/context/ of the gate assembly, beside the
// corrected codec-schema.bend, native-declaration.bend and their imports.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const readLane = (relative) => readFileSync(join(HERE, relative), 'utf8');
const readLaneJson = (relative) => JSON.parse(readLane(relative));

const ASSETS = [
  ['subject', 'native-schemas/subject.request.json'],
  ['options', 'native-schemas/options.request.json'],
  ['result', 'native-schemas/result.frame.json'],
  ['reference', 'native-schemas/reference.record.json'],
  ['event', 'native-schemas/event.envelope.json'],
];
const FIXTURES = ['result.valid', 'result.unavailable', 'result.missing-status',
  'result.unknown-member', 'result.bad-scalar', 'result.unavailable.missing-reason',
  'result.unavailable.extra-member', 'result.completed.bad-phase',
  'subject.valid', 'subject.unknown-kind', 'subject.position.valid',
  'subject.position.missing-line', 'subject.position.bad-line',
  'subject.position.unknown-member', 'subject.symbol.wrong-branch',
  'subject.symbol.missing-name',
  'reference.file.valid', 'reference.absent.with-sha', 'event.valid'];
const FIXTURE_FORMS = { 'result.valid': 'result', 'result.unavailable': 'result',
  'result.missing-status': 'result', 'result.unknown-member': 'result',
  'result.bad-scalar': 'result', 'result.unavailable.missing-reason': 'result',
  'result.unavailable.extra-member': 'result', 'result.completed.bad-phase': 'result',
  'subject.valid': 'subject', 'subject.unknown-kind': 'subject',
  'subject.position.valid': 'subject', 'subject.position.missing-line': 'subject',
  'subject.position.bad-line': 'subject', 'subject.position.unknown-member': 'subject',
  'subject.symbol.wrong-branch': 'subject', 'subject.symbol.missing-name': 'subject',
  'reference.file.valid': 'reference',
  'reference.absent.with-sha': 'reference', 'event.valid': 'event' };
const FIXTURE_EXPECT = { 'result.valid': '"ok"', 'result.unavailable': '"ok"',
  'result.missing-status': '"missingField"', 'result.unknown-member': '"undeclaredField"',
  'result.bad-scalar': '"wrongKind"', 'result.unavailable.missing-reason': '"missingField"',
  'result.unavailable.extra-member': '"undeclaredField"', 'result.completed.bad-phase': '"enumLiteral"',
  'subject.valid': '"ok"', 'subject.unknown-kind': '"unknownTag"',
  'subject.position.valid': '"ok"', 'subject.position.missing-line': '"missingField"',
  'subject.position.bad-line': '"wrongKind"', 'subject.position.unknown-member': '"undeclaredField"',
  'subject.symbol.wrong-branch': '"undeclaredField"', 'subject.symbol.missing-name': '"missingField"',
  'reference.file.valid': '"ok"', 'reference.absent.with-sha': '"undeclaredField"',
  'event.valid': '"ok"' };

function bendString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function schemaForm(node) {
  const [tag] = Object.keys(node);
  const body = node[tag];
  switch (tag) {
    case 'SfRecord':
      return `Schema.SfRecord{${fieldsSpine(body.fields)}}`;
    case 'SfUnion':
      return `Schema.SfUnion{${casesSpine(body.cases)}}`;
    case 'SfDiscriminated':
      return `Schema.SfDiscriminated{${bendString(body.tag)}, ${casesSpine(body.cases)}}`;
    case 'SfArray':
      return `Schema.SfArray{${schemaForm(body.item)}}`;
    case 'SfEnum':
      return `Schema.SfEnum{${nameList(body.literals)}}`;
    case 'SfOptional':
      return `Schema.SfOptional{${schemaForm(body.inner)}}`;
    case 'SfDict':
      return `Schema.SfDict{${schemaKeys(body.keys)}, ${schemaForm(body.value)}}`;
    case 'SfRef':
      return `Schema.SfRef{${bendString(body.name)}}`;
    case 'SfScalar':
      return `Schema.SfScalar{Schema.${body.kind}{}}`;
    case 'SfJson':
      return 'Schema.SfJson{}';
    case 'SfRequired':
    case 'SfOptionalField':
      return `Schema.${tag}{${bendString(body.name)}, ${schemaForm(body.form)}}`;
    default:
      throw new Error(`unknown form constructor ${tag}`);
  }
}

function fieldsSpine(fields) {
  let out = 'Schema.SfFieldsNil{}';
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    out = `Schema.SfFieldsCons{${schemaForm(fields[index])}, ${out}}`;
  }
  return out;
}

function casesSpine(cases) {
  let out = 'Schema.SfCasesNil{}';
  for (let index = cases.length - 1; index >= 0; index -= 1) {
    out = `Schema.SfCasesCons{Schema.SchemaCase{${bendString(cases[index].tag)}, ${schemaForm(cases[index].form)}}, ${out}}`;
  }
  return out;
}

function nameList(names) {
  let out = 'Schema.NlNil{}';
  for (let index = names.length - 1; index >= 0; index -= 1) {
    out = `Schema.NlCons{${bendString(names[index])}, ${out}}`;
  }
  return out;
}

function schemaKeys(keys) {
  const [tag] = Object.keys(keys);
  if (tag === 'SkDeclared') return `Schema.SkDeclared{${nameList(keys.SkDeclared.names)}}`;
  if (tag === 'SkAnyScalarText') return 'Schema.SkAnyScalarText{}';
  throw new Error(`unknown keys constructor ${tag}`);
}

function rawValue(value) {
  if (value === null) return 'Codec.Rnull{}';
  if (value === true) return 'Codec.Rtrue{}';
  if (value === false) return 'Codec.Rfalse{}';
  if (typeof value === 'string') return `Codec.Rstr{${bendString(value)}}`;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`non-integer fixture number ${value}`);
    return `Codec.Rnum{${bendString(String(value))}}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}';
    let out = 'Codec.Rnil{}';
    for (let index = value.length - 1; index >= 0; index -= 1) {
      out = `Codec.Rarr{${rawValue(value[index])}, ${out}}`;
    }
    return out;
  }
  const entries = Object.entries(value);
  let out = 'Codec.Rnil{}';
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    out = `Codec.Rpair{${bendString(entries[index][0])}, ${rawValue(entries[index][1])}, ${out}}`;
  }
  return `Codec.Robj{${out}}`;
}

function jsonValue(value, where) {
  if (value === null) return 'J.Jnull{}';
  if (value === true) return 'J.Jtrue{}';
  if (value === false) return 'J.Jfalse{}';
  if (typeof value === 'string') return `J.Jstr{${bendString(value)}}`;
  if (typeof value === 'number') throw new Error(`number on declaration path at ${where}`);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'J.Jarr{J.Jnil{}, J.Jnil{}}';
    let out = 'J.Jnil{}';
    for (let index = value.length - 1; index >= 0; index -= 1) {
      out = `J.Jarr{${jsonValue(value[index], where)}, ${out}}`;
    }
    return out;
  }
  const entries = Object.entries(value);
  let out = 'J.Jnil{}';
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    out = `J.Jpair{${bendString(entries[index][0])}, ${jsonValue(entries[index][1], where)}, ${out}}`;
  }
  return `J.Jobj{${out}}`;
}

const declaration = readLaneJson('native-provider.declaration.json');
const packageHex = declaration.packageIdentity.replace(/^sha256:/, '');
const defs = ASSETS.map(([name, relative]) => {
  const asset = readLaneJson(relative);
  return { name, identity: asset.SchemaDef.name, form: asset.SchemaDef.form };
});

const lines = [];
lines.push('# Generated probe inputs: emit with `node native-schema-loader.mjs`.');
lines.push('# Lane serialization rendered as the exact typed constructors the');
lines.push('# corrected schema pin checks. Do not hand-edit: fix the lane JSON.');
lines.push('import Base');
lines.push('import ./codec.bend as Codec');
lines.push('import ./codec-schema.bend as Schema');
lines.push('import ./native-declaration.bend as ND');
lines.push('import ./engines-decl.bend as Decl');
lines.push('import ./engines.bend as Eng');
lines.push('import ../json/canonical.bend as J');
lines.push('');
for (const def of defs) {
  lines.push(`def form_${def.name}() -> Schema.SchemaForm:`);
  lines.push(`  ${schemaForm(def.form)}`);
  lines.push('');
}
lines.push('def asset_defs() -> Schema.SchemaDefs:');
let spine = 'Schema.DefsNil{}';
for (let index = defs.length - 1; index >= 0; index -= 1) {
  spine = `Schema.DefsCons{Schema.SchemaDef{${bendString(defs[index].identity)}, form_${defs[index].name}()}, ${spine}}`;
}
lines.push(`  ${spine}`);
lines.push('');
lines.push('def declaration_json() -> J.Json:');
lines.push(`  ${jsonValue(declaration, 'declaration')}`);
lines.push('');
const mutated = structuredClone(declaration);
delete mutated.operations[0].schema;
lines.push('def declaration_json_missing_op_schema() -> J.Json:');
lines.push(`  ${jsonValue(mutated, 'declaration-negative')}`);
lines.push('');
for (const name of FIXTURES) {
  const fixture = readLaneJson(`native-fixtures/schema/${name}.json`);
  lines.push(`def fixture_${name.replaceAll('-', '_').replaceAll('.', '_')}() -> Codec.RawValue:`);
  lines.push(`  ${rawValue(fixture)}`);
  lines.push('');
}
// JSON cannot carry a duplicate key, so the duplicate-member refusal is a
// hand-built Rpair chain: the unavailable branch with reason twice.
lines.push('def fixture_result_unavailable_duplicate_reason() -> Codec.RawValue:');
lines.push('  Codec.Robj{Codec.Rpair{"schema", Codec.Rstr{"baton2.context.bend2.source-analysis.result.v1"}, Codec.Rpair{"status", Codec.Rstr{"unavailable"}, Codec.Rpair{"reason", Codec.Rstr{"r"}, Codec.Rpair{"reason", Codec.Rstr{"r2"}, Codec.Rpair{"detail", Codec.Rstr{"d"}, Codec.Rnil{}}}}}}}');
lines.push('');
lines.push(`def verified_digest() -> String:`);
lines.push(`  ${bendString(packageHex)}`);
lines.push('');
lines.push('def verdict_code(+verdict: Schema.SchemaVerdict) -> String:');
lines.push('  match verdict:');
lines.push('    case Schema.SvOk{}: "ok"');
lines.push('    case Schema.SvRefused{+condition}: condition');
lines.push('');
lines.push('def decode_ok(+decoded: ND.DeclarationDecode) -> Bool:');
lines.push('  match decoded:');
lines.push('    case ND.DeclarationDecoded{+declaration, +inventory}: True{}');
lines.push('    case ND.DeclarationRefused{+field}: False{}');
lines.push('');
lines.push('def op_effects_empty(+op: Decl.Op) -> Bool:');
lines.push('  match op:');
lines.push('    case Decl.Op{operation, implements_operation, subject_schema, options_schema, projections, effects, execution, result_schema, reference_schema, event_schema, lifetime_profile, dependencies}:');
lines.push('      match effects:');
lines.push('        case Eng.SSNil{}: True{}');
lines.push('        case Eng.SSCons{ss_head, ss_rest}: False{}');
lines.push('');
lines.push('def op_execution_managed(+op: Decl.Op) -> Bool:');
lines.push('  match op:');
lines.push('    case Decl.Op{operation, implements_operation, subject_schema, options_schema, projections, effects, execution, result_schema, reference_schema, event_schema, lifetime_profile, dependencies}:');
lines.push('      match execution:');
lines.push('        case Decl.ExManaged{}: True{}');
lines.push('        case Decl.ExPure{}: False{}');
lines.push('        case Decl.ExDirect{}: False{}');
lines.push('        case Decl.ExRuntime{}: False{}');
lines.push('');
lines.push('# The lane declaration carries exactly one operation; more than one');
lines.push('# fails the projection so a widened declaration cannot slip through.');
lines.push('def decl_single_op_effects_empty(+decoded: ND.DeclarationDecode) -> Bool:');
lines.push('  match decoded:');
lines.push('    case ND.DeclarationDecoded{+declaration, +inventory}:');
lines.push('      match declaration:');
lines.push('        case Decl.Decl{decl_version, module_id, revision, protocol_version, package_identity, entry, dependencies, operations, applicability}:');
lines.push('          match operations:');
lines.push('            case Decl.OpsCons{op_head, op_rest}:');
lines.push('              match op_rest:');
lines.push('                case Decl.OpsNil{}: op_effects_empty(op_head)');
lines.push('                case Decl.OpsCons{more_head, more_rest}: False{}');
lines.push('            case Decl.OpsNil{}: False{}');
lines.push('    case ND.DeclarationRefused{+field}: False{}');
lines.push('');
lines.push('def decl_single_op_execution_managed(+decoded: ND.DeclarationDecode) -> Bool:');
lines.push('  match decoded:');
lines.push('    case ND.DeclarationDecoded{+declaration, +inventory}:');
lines.push('      match declaration:');
lines.push('        case Decl.Decl{decl_version, module_id, revision, protocol_version, package_identity, entry, dependencies, operations, applicability}:');
lines.push('          match operations:');
lines.push('            case Decl.OpsCons{op_head, op_rest}:');
lines.push('              match op_rest:');
lines.push('                case Decl.OpsNil{}: op_execution_managed(op_head)');
lines.push('                case Decl.OpsCons{more_head, more_rest}: False{}');
lines.push('            case Decl.OpsNil{}: False{}');
lines.push('    case ND.DeclarationRefused{+field}: False{}');
lines.push('');
lines.push('law probe_declaration_decodes:');
lines.push('  {decode_ok(ND.decode(declaration_json(), verified_digest())) == True{} : Bool}');
lines.push('');
lines.push('def probe_declaration_decodes():');
lines.push('  {==}');
lines.push('');
lines.push('law probe_declaration_missing_op_schema_refuses:');
lines.push('  {decode_ok(ND.decode(declaration_json_missing_op_schema(), verified_digest())) == False{} : Bool}');
lines.push('');
lines.push('def probe_declaration_missing_op_schema_refuses():');
lines.push('  {==}');
lines.push('');
lines.push('law probe_op_effects_empty:');
lines.push('  {decl_single_op_effects_empty(ND.decode(declaration_json(), verified_digest())) == True{} : Bool}');
lines.push('');
lines.push('def probe_op_effects_empty():');
lines.push('  {==}');
lines.push('');
lines.push('law probe_op_execution_managed:');
lines.push('  {decl_single_op_execution_managed(ND.decode(declaration_json(), verified_digest())) == True{} : Bool}');
lines.push('');
lines.push('def probe_op_execution_managed():');
lines.push('  {==}');
lines.push('');
for (const name of FIXTURES) {
  const flat = name.replaceAll('-', '_').replaceAll('.', '_');
  lines.push(`law probe_admit_${flat}:`);
  lines.push(`  {verdict_code(Schema.schema_admit_value(asset_defs(), form_${FIXTURE_FORMS[name]}(), fixture_${flat}())) == ${FIXTURE_EXPECT[name]} : String}`);
  lines.push('');
  lines.push(`def probe_admit_${flat}():`);
  lines.push('  {==}');
  lines.push('');
}
lines.push('law probe_admit_result_unavailable_duplicate_reason:');
lines.push('  {verdict_code(Schema.schema_admit_value(asset_defs(), form_result(), fixture_result_unavailable_duplicate_reason())) == "duplicateKey" : String}');
lines.push('');
lines.push('def probe_admit_result_unavailable_duplicate_reason():');
lines.push('  {==}');
lines.push('');
process.stdout.write(lines.join('\n'));
