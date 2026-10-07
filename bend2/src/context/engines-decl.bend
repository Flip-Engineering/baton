# CLAIM: the declaration and catalog admission of the native semantic context
# installed-module contract (docs/bend2/semantic-context-spec.md, "Installed
# module contract" and "Detection, acquisition and resource ownership").
#
# Admission is a total pure function over supplied declaration data, a supplied
# candidate catalog and a supplied inventory. It reads no file, imports no
# entry, invokes no discovery command, probes no tool and starts no debuggee:
# the inventory records what package admission already established. A digest
# supplied by a request or carried by a description installs and authenticates
# nothing here, and an admitted declaration is a decision with evidence, not a
# publication or a custody claim.
#
# Every refusal is separate because every one is a different fact: an
# unsupported declaration or protocol version, an empty id, an id conflicting
# with the candidate set, a missing declaration digest, a missing or mismatched
# artifact, schema or dependency identity, an operation naming a common
# operation with no admitted meaning, and an effect name no admitted operation
# requires. The last is the specification's unknown effect meaning, which goes
# to common-contract review rather than to a second effect registry.
#
# The common vocabularies are derived, never restated: the admitted effect
# vocabulary is the union of Eng.required_effects over the closed operation set,
# and the admitted common operations are Eng.operation_known.

import Base
import ./engines.bend as Eng

# --- declared artifacts ------------------------------------------------------
# One artifact a description names: the admitted package path, its canonical
# digest and the role it plays in the entry or in the dependency closure.
type Art is Data:
  Art{path: String, sha256: String, role: String}

type Arts is Data:
  ArtsNil{}
  ArtsCons{head: Art, rest: Arts}

def arts_of_list(xs: List<Art>) -> Arts:
  match xs:
    case Nil{}: ArtsNil{}
    case h <> t: ArtsCons{h, arts_of_list(t)}

def arts_to_list(xs: Arts) -> List<Art>:
  match xs:
    case ArtsNil{}: Nil{}
    case ArtsCons{h, r}: h <> arts_to_list(r)

# The digest the inventory records at one path, or the empty string when the
# inventory holds no artifact there. Absence and a different digest are
# separate refusals, so only absence answers the empty string.
def artifact_digest(+arts: Arts, +want_path: String) -> String:
  match arts:
    case ArtsNil{}: ""
    case ArtsCons{h, r}:
      match h:
        case Art{path, sha256, role}:
          Bool.pick(String, String.eq(path, want_path), sha256,
                    artifact_digest(r, want_path))

# --- module references and declared operations -------------------------------
# A dependency edge names the producing module, the declaration digest it was
# admitted at and the operation. The digest travels with the edge, so replay and
# expansion compare the recorded producer instead of resolving a current module
# by name.
type ModRef is Data:
  ModRef{dependency_module: String, declaration_digest: String,
         dependency_operation: String}

type ModRefs is Data:
  ModRefsNil{}
  ModRefsCons{head: ModRef, rest: ModRefs}

# The execution kind a declared operation runs under. The type is closed, so an
# unsupported kind cannot reach admission as a value.
type Exec is Data:
  ExPure{}
  ExDirect{}
  ExManaged{}
  ExRuntime{}

# One declared operation. `implements_operation` names the common operation
# whose admitted meaning and mandatory effect minimum apply to this declaration;
# `operation` is the module-local identifier the provider's own frames use.
# `lifetime_profile` is the empty string when the declaration carries none.
type Op is Data:
  Op{operation: String, implements_operation: String,
     subject_schema: String, options_schema: String, projections: SS,
     effects: SS, execution: Exec, result_schema: String,
     reference_schema: String, event_schema: String,
     lifetime_profile: String, dependencies: ModRefs}

type Ops is Data:
  OpsNil{}
  OpsCons{head: Op, rest: Ops}

# --- entries, applicability and the declaration ------------------------------
# A native entry names a compiled artifact and its export identity; a process
# entry names an artifact and a package-authored argv vector. Neither case
# carries an interpreter, schema or effect that a request could replace.
type Entry is Data:
  ENative{artifact: Art, export_identity: String}
  EProcess{artifact: Art, argv: SS}

# A declarative applicability check over admitted project facts. Evaluating one
# reads admitted manifests, configuration and examined source; it loads no
# project code.
type Rule is Data:
  RPath{value: String}
  RManifest{value: String}
  RSubject{value: String}
  RProjection{value: String}

type Rules is Data:
  RulesNil{}
  RulesCons{head: Rule, rest: Rules}

type Decl is Data:
  Decl{decl_version: String, module_id: String, revision: String,
       protocol_version: String, package_identity: String, entry: Entry,
       dependencies: Arts, operations: Ops, applicability: Rules}

type Cat is Data:
  CatNil{}
  CatCons{head: Decl, rest: Cat}

# The admitted inventory: artifact digests by path, admitted schema identities
# and the declaration digest of each admitted module. Package admission supplies
# it, and this module authenticates nothing in it.
type Dig is Data:
  Dg{digest_module: String, digest: String}

type Digs is Data:
  DigsNil{}
  DigsCons{head: Dig, rest: Digs}

type Inv is Data:
  Inv{artifacts: Arts, schemas: SS, digests: Digs}

def digest_of(+digs: Digs, +want_module: String) -> String:
  match digs:
    case DigsNil{}: ""
    case DigsCons{h, r}:
      match h:
        case Dg{digest_module, digest}:
          Bool.pick(String, String.eq(digest_module, want_module), digest,
                    digest_of(r, want_module))

# --- refusals and outcomes ---------------------------------------------------
type DeclReject is Data:
  DrUnsupportedDeclarationVersion{saw: String}
  DrUnsupportedProtocolVersion{saw: String}
  DrEmptyId{what: String}
  DrConflictingId{module_id: String, other: String}
  DrMissingDeclarationDigest{module_id: String}
  DrMissingArtifact{module_id: String, path: String}
  DrArtifactMismatch{module_id: String, path: String, want: String, saw: String}
  DrEmptyEntryVector{}
  DrMissingSchema{module_id: String, operation: String, schema: String}
  DrDuplicateOperation{module_id: String, operation: String}
  DrUnknownCommonOperation{module_id: String, operation: String, common: String}
  DrEffectRequiresReview{module_id: String, operation: String, effect: String}
  DrMissingLifetimeProfile{module_id: String, operation: String}
  DrDependencyUnresolved{module_id: String, operation: String,
                         dependency: String}
  DrDependencyDigestMismatch{module_id: String, dependency: String,
                             want: String, saw: String}

type DeclOutcome is Data:
  DeclAdmitted{decl: Decl, digest: String}
  DeclRefused{reason: DeclReject}

type CatOutcome is Data:
  CatAdmitted{admitted: Cat}
  CatRefused{module_id: String, reason: DeclReject}

# The internal sequential check. The first refusal wins; a completed check
# carries no evidence, because admission re-derives the digest it publishes.
type Chk is Data:
  ChkOk{}
  ChkFail{reason: DeclReject}

def chk_fail(reason: DeclReject) -> Chk:
  ChkFail{reason}

def bool_chk(+cond: Bool, +reason: DeclReject) -> Chk:
  Bool.pick(Chk, cond, ChkOk{}, ChkFail{reason})

def then_chk(+a: Chk, +b: Chk) -> Chk:
  match a:
    case ChkFail{reason}: ChkFail{reason}
    case ChkOk{}: b

# --- the admitted common vocabularies ----------------------------------------
# The declaration schema version this module admits.
def decl_version_supported(+v: String) -> Bool:
  String.eq(v, "1")

# The one common transport protocol this module admits. A version-1 adapter
# literal is historical: it requires an explicit bridge and version migration
# before new-module admission, so it refuses here.
def protocol_version_supported(+v: String) -> Bool:
  String.eq(v, "2")

# The union of every admitted operation's mandatory requirement. Operations
# whose requirement is empty contribute nothing and are named here rather than
# repeated as arguments: sourceAnalysis, catalogCapture, schemaValidation,
# deploymentToolProbe, environmentRead, datasetRead, runtimeObserve,
# queryControlRecover.
def admitted_effect_vocabulary() -> SS:
  Eng.union_add(Eng.required_effects(Eng.op_code_access_join()),
  Eng.union_add(Eng.required_effects(Eng.op_sql_plan()),
  Eng.union_add(Eng.required_effects(Eng.op_migration_replay()),
  Eng.union_add(Eng.required_effects(Eng.op_model_load()),
  Eng.union_add(Eng.required_effects(Eng.op_tools_probe()),
  Eng.union_add(Eng.required_effects(Eng.op_runtime_evaluate()),
  Eng.union_add(Eng.required_effects(Eng.op_runtime_launch()),
  Eng.union_add(Eng.required_effects(Eng.op_runtime_pause()),
  Eng.union_add(Eng.required_effects(Eng.op_runtime_resume()),
  Eng.union_add(Eng.required_effects(Eng.op_runtime_release()),
  Eng.union_add(Eng.required_effects(Eng.op_query_control_release()),
  Eng.ss_empty())))))))))))

# An effect name no admitted operation requires has no admitted meaning.
def known_effect(+effect: String) -> Bool:
  Eng.ss_member(admitted_effect_vocabulary(), effect)

# --- declaration admission ---------------------------------------------------
# Stage one: the declaration schema version and the protocol version.
def check_version(+decl_version: String, +protocol_version: String) -> Chk:
  then_chk(bool_chk(decl_version_supported(decl_version),
                    DrUnsupportedDeclarationVersion{decl_version}),
           bool_chk(protocol_version_supported(protocol_version),
                    DrUnsupportedProtocolVersion{protocol_version}))

# Whether the candidate set already holds this module id under a different
# declared identity. A declaration matching itself is not a conflict.
def cat_conflict(+cat: Cat, +want_module: String, +want_package: String,
                 +want_revision: String) -> Bool:
  match cat:
    case CatNil{}: False{}
    case CatCons{h, r}:
      match h:
        case Decl{decl_version, module_id, revision, protocol_version,
                  package_identity, entry, dependencies, operations,
                  applicability}:
          Bool.pick(Bool, String.eq(module_id, want_module),
            Bool.not(Bool.and(String.eq(package_identity, want_package),
                              String.eq(revision, want_revision))),
            cat_conflict(r, want_module, want_package, want_revision))

# Stage two: the module id is nonempty and names one identity.
def check_identifiers(+module_id: String, +package_identity: String,
                      +revision: String, +cat: Cat) -> Chk:
  then_chk(bool_chk(Bool.not(String.is_empty(module_id)),
                    DrEmptyId{"module"}),
           bool_chk(Bool.not(cat_conflict(cat, module_id, package_identity,
                                          revision)),
                    DrConflictingId{module_id, package_identity}))

# Stage three: the inventory records this module's admitted declaration digest.
def check_declaration_digest(+module_id: String, +inv: Inv) -> Chk:
  match inv:
    case Inv{artifacts, schemas, digests}:
      bool_chk(Bool.not(String.is_empty(digest_of(digests, module_id))),
               DrMissingDeclarationDigest{module_id})

# One artifact: absent from the inventory, or present at a different digest.
def check_artifact_digest(+module_id: String, +path: String, +want: String,
                          +saw: String) -> Chk:
  Bool.pick(Chk, String.is_empty(saw),
    ChkFail{DrMissingArtifact{module_id, path}},
    Bool.pick(Chk, String.eq(want, saw), ChkOk{},
              ChkFail{DrArtifactMismatch{module_id, path, want, saw}}))

def check_artifact(+module_id: String, +art: Art, +inv: Inv) -> Chk:
  match art:
    case Art{+path, sha256, role}:
      match inv:
        case Inv{artifacts, schemas, digests}:
          check_artifact_digest(module_id, path, sha256,
                                artifact_digest(artifacts, path))

def check_artifacts(+module_id: String, +arts: Arts, +inv: Inv) -> Chk:
  match arts:
    case ArtsNil{}: ChkOk{}
    case ArtsCons{h, r}:
      then_chk(check_artifact(module_id, h, inv),
               check_artifacts(module_id, r, inv))

# Stage four: the entry artifact and its export identity or argv vector.
def check_entry(+module_id: String, +entry: Entry, +inv: Inv) -> Chk:
  match entry:
    case ENative{artifact, export_identity}:
      then_chk(check_artifact(module_id, artifact, inv),
               bool_chk(Bool.not(String.is_empty(export_identity)),
                        DrEmptyId{"entry export identity"}))
    case EProcess{artifact, argv}:
      then_chk(check_artifact(module_id, artifact, inv),
               bool_chk(Eng.ss_nonempty(argv), DrEmptyEntryVector{}))

# One declared schema identity must be admitted by the inventory.
def check_schema(+module_id: String, +operation: String, +schema: String,
                 +schemas: SS) -> Chk:
  Bool.pick(Chk, Eng.ss_member(schemas, schema), ChkOk{},
            ChkFail{DrMissingSchema{module_id, operation, schema}})

def check_schemas(+module_id: String, +operation: String, +subject: String,
                  +options: String, +result: String, +reference: String,
                  +event: String, +inv: Inv) -> Chk:
  match inv:
    case Inv{artifacts, +schemas, digests}:
      then_chk(check_schema(module_id, operation, subject, schemas),
      then_chk(check_schema(module_id, operation, options, schemas),
      then_chk(check_schema(module_id, operation, result, schemas),
      then_chk(check_schema(module_id, operation, reference, schemas),
               check_schema(module_id, operation, event, schemas)))))

# Every declared effect must have an admitted meaning.
def check_effects(+module_id: String, +operation: String, +effects: SS) -> Chk:
  match effects:
    case Eng.SSNil{}: ChkOk{}
    case Eng.SSCons{+head, rest}:
      then_chk(bool_chk(known_effect(head),
                        DrEffectRequiresReview{module_id, operation, head}),
               check_effects(module_id, operation, rest))

# A runtime operation carries a lifetime profile; the other kinds carry none.
def check_lifetime(+module_id: String, +operation: String, +execution: Exec,
                   +profile: String) -> Chk:
  match execution:
    case ExRuntime{}:
      bool_chk(Bool.not(String.is_empty(profile)),
               DrMissingLifetimeProfile{module_id, operation})
    case ExPure{}: ChkOk{}
    case ExDirect{}: ChkOk{}
    case ExManaged{}: ChkOk{}

def operations_have(+ops: Ops, +want: String) -> Bool:
  match ops:
    case OpsNil{}: False{}
    case OpsCons{h, r}:
      match h:
        case Op{operation, implements_operation, subject_schema,
                options_schema, projections, effects, execution, result_schema,
                reference_schema, event_schema, lifetime_profile, dependencies}:
          Bool.pick(Bool, String.eq(operation, want), True{},
                    operations_have(r, want))

def check_one_operation(+module_id: String, +op: Op, +remaining: Ops,
                        +inv: Inv) -> Chk:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      then_chk(bool_chk(Bool.not(String.is_empty(operation)),
                        DrEmptyId{"operation"}),
      then_chk(bool_chk(Bool.not(operations_have(remaining, operation)),
                        DrDuplicateOperation{module_id, operation}),
      then_chk(bool_chk(Eng.operation_known(implements_operation),
                        DrUnknownCommonOperation{module_id, operation, implements_operation}),
      then_chk(check_schemas(module_id, operation, subject_schema,
                             options_schema, result_schema, reference_schema,
                             event_schema, inv),
      then_chk(check_effects(module_id, operation, effects),
               check_lifetime(module_id, operation, execution,
                              lifetime_profile))))))

# Stage five: every declared operation, in declaration order.
def check_operations(+module_id: String, +ops: Ops, +inv: Inv) -> Chk:
  match ops:
    case OpsNil{}: ChkOk{}
    case OpsCons{head, +rest}:
      then_chk(check_one_operation(module_id, head, rest, inv),
               check_operations(module_id, rest, inv))

def check_edge_compare(+module_id: String, +operation: String,
                       +dependency: String, +want: String, +saw: String) -> Chk:
  Bool.pick(Chk, String.is_empty(saw),
    ChkFail{DrDependencyUnresolved{module_id, operation, dependency}},
    Bool.pick(Chk, String.eq(want, saw), ChkOk{},
      ChkFail{DrDependencyDigestMismatch{module_id, dependency, want,
                                                 saw}}))

def check_edge_digest(+module_id: String, +operation: String,
                      +dependency: String, +want: String, +inv: Inv) -> Chk:
  match inv:
    case Inv{artifacts, schemas, digests}:
      check_edge_compare(module_id, operation, dependency, want,
                         digest_of(digests, dependency))

def check_edge(+module_id: String, +operation: String, +edge: ModRef,
               +inv: Inv) -> Chk:
  match edge:
    case ModRef{+dependency_module, declaration_digest, dependency_operation}:
      then_chk(bool_chk(Bool.and(Bool.not(String.is_empty(dependency_module)),
                                 Bool.not(String.is_empty(dependency_operation))),
                        DrEmptyId{"dependency"}),
               check_edge_digest(module_id, operation, dependency_module,
                                 declaration_digest, inv))

def check_edges(+module_id: String, +operation: String, +edges: ModRefs,
                +inv: Inv) -> Chk:
  match edges:
    case ModRefsNil{}: ChkOk{}
    case ModRefsCons{h, r}:
      then_chk(check_edge(module_id, operation, h, inv),
               check_edges(module_id, operation, r, inv))

def operation_edges(+module_id: String, +op: Op, +inv: Inv) -> Chk:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      check_edges(module_id, operation, dependencies, inv)

# Stage six: every dependency edge resolves to the digest it names.
def check_dependency_edges(+module_id: String, +ops: Ops, +inv: Inv) -> Chk:
  match ops:
    case OpsNil{}: ChkOk{}
    case OpsCons{head, rest}:
      then_chk(operation_edges(module_id, head, inv),
               check_dependency_edges(module_id, rest, inv))

def check_declaration(+decl: Decl, +cat: Cat, +inv: Inv) -> Chk:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      then_chk(check_version(decl_version, protocol_version),
      then_chk(check_identifiers(module_id, package_identity, revision, cat),
      then_chk(check_declaration_digest(module_id, inv),
      then_chk(check_entry(module_id, entry, inv),
      then_chk(check_artifacts(module_id, dependencies, inv),
      then_chk(check_operations(module_id, operations, inv),
               check_dependency_edges(module_id, operations, inv)))))))

def admitted_digest(+decl: Decl, +inv: Inv) -> String:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      match inv:
        case Inv{artifacts, schemas, digests}:
          digest_of(digests, module_id)

def decl_outcome(+c: Chk, +decl: Decl, +inv: Inv) -> DeclOutcome:
  match c:
    case ChkFail{reason}: DeclRefused{reason}
    case ChkOk{}: DeclAdmitted{decl, admitted_digest(decl, inv)}

# Admission of one declaration. The catalog supplied here is the candidate set
# that supplies the conflicting-id comparison, so a caller admits a declaration
# against the set it is joining rather than against itself alone.
def admit_declaration(+decl: Decl, +cat: Cat, +inv: Inv) -> DeclOutcome:
  decl_outcome(check_declaration(decl, cat, inv), decl, inv)

# --- declaration, entry and operation accessors ------------------------------
# A Data value has no field access, so each reader destructures the record and
# returns one member. These are the readers the selection, plan and validation
# compositions consume.
def decl_revision(+decl: Decl) -> String:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      revision

def decl_protocol_version(+decl: Decl) -> String:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      protocol_version

def decl_operations(+decl: Decl) -> Ops:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      operations

def decl_applicability(+decl: Decl) -> Rules:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      applicability

def entry_artifact(+entry: Entry) -> Art:
  match entry:
    case ENative{artifact, export_identity}: artifact
    case EProcess{artifact, argv}: artifact

# The artifacts one binding names: the entry artifact and every dependency
# artifact, in declaration order.
def decl_binding_artifacts(+decl: Decl) -> Arts:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      ArtsCons{entry_artifact(entry), dependencies}

def op_operation(+op: Op) -> String:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      operation

def op_common(+op: Op) -> String:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      implements_operation

def op_effects(+op: Op) -> SS:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      effects

def op_execution(+op: Op) -> Exec:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      execution

def op_dependencies(+op: Op) -> ModRefs:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      dependencies

# The result schema identity of one operation, which the selected step freezes
# and the observer then requires the payload to satisfy.
def op_result_schema(+op: Op) -> String:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      result_schema

# The five schema identities one binding freezes, as a set.
def op_schema_set(+op: Op) -> SS:
  match op:
    case Op{operation, implements_operation, subject_schema, options_schema,
            projections, effects, execution, result_schema, reference_schema,
            event_schema, lifetime_profile, dependencies}:
      Eng.union_add(Eng.ss_three(subject_schema, options_schema, result_schema),
      Eng.union_add(Eng.ss_two(reference_schema, event_schema),
                    Eng.ss_empty()))

# --- declarative applicability -----------------------------------------------
# One rule against the admitted facts it names. A rule reads a recorded fact and
# compares it; it loads no project code and starts no process.
def rule_holds(+rule: Rule, +paths: SS, +manifests: SS, +subject: String,
               +projections: SS) -> Bool:
  match rule:
    case RPath{value}: Eng.ss_member(paths, value)
    case RManifest{value}: Eng.ss_member(manifests, value)
    case RSubject{value}: String.eq(subject, value)
    case RProjection{value}: Eng.ss_member(projections, value)

def rules_hold(+rules: Rules, +paths: SS, +manifests: SS, +subject: String,
               +projections: SS) -> Bool:
  match rules:
    case RulesNil{}: True{}
    case RulesCons{head, rest}:
      Bool.pick(Bool, rule_holds(head, paths, manifests, subject, projections),
                rules_hold(rest, paths, manifests, subject, projections),
                False{})

# The module id of one declaration. This reader is the one the catalog admission
# and the selection composition consume, so it is defined here rather than left to
# each caller's own pattern match.
def decl_module_id(+decl: Decl) -> String:
  match decl:
    case Decl{decl_version, module_id, revision, protocol_version,
              package_identity, entry, dependencies, operations,
              applicability}:
      module_id

def cat_rev_go(+xs: Cat, +acc: Cat) -> Cat:
  match xs:
    case CatNil{}: acc
    case CatCons{h, r}: cat_rev_go(r, CatCons{h, acc})

def cat_rev(xs: Cat) -> Cat:
  cat_rev_go(xs, CatNil{})

# The first refusal in declaration order refuses the set, so the walk records
# that refusal and keeps the remaining decisions only as evidence it discarded.
# Retaining the first failure keeps the reported refusal stable under any later
# declaration's condition.
type CatFail is Data:
  CfNone{}
  CfAt{module_id: String, reason: DeclReject}

def cat_record_new(+o: DeclOutcome, +head: Decl) -> CatFail:
  match o:
    case DeclRefused{reason}: CfAt{decl_module_id(head), reason}
    case DeclAdmitted{decl, digest}: CfNone{}

def cat_record(+fail: CatFail, +o: DeclOutcome, +head: Decl) -> CatFail:
  match fail:
    case CfAt{module_id, reason}: fail
    case CfNone{}: cat_record_new(o, head)

def cat_finish(+fail: CatFail, +acc: Cat) -> CatOutcome:
  match fail:
    case CfAt{module_id, reason}: CatRefused{module_id, reason}
    case CfNone{}: CatAdmitted{cat_rev(acc)}

def admit_catalog_walk(+remaining: Cat, +context: Cat, +inv: Inv, +acc: Cat,
                       +fail: CatFail) -> CatOutcome:
  match remaining:
    case CatNil{}: cat_finish(fail, acc)
    case CatCons{+head, rest}:
      admit_catalog_walk(rest, context, inv, CatCons{head, acc},
                         cat_record(fail, admit_declaration(head, context, inv),
                                    head))

def admit_catalog(+cat: Cat, +inv: Inv) -> CatOutcome:
  admit_catalog_walk(cat, cat, inv, CatNil{}, CfNone{})
