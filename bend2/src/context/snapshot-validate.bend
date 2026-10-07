# CLAIM: the pure validation of a returned common event/result frame and of the
# reference claims beside a result (docs/bend2/semantic-context-spec.md, the
# version-2 transport paragraph of "Installed module contract" and the ref
# paragraph of "Results, classifications and references").
#
# The observer holds the complete selected producing binding it admitted. This
# module compares the echoed frame against that retained binding member by
# member — module, revision, declaration digest, protocol version, operation,
# artifact identities and schema identities — and then the query, owner, role,
# incarnation, runtime, canonical sequence and closed event type, refusing on the
# first disagreement with the field named. A declaration digest alone is not the
# binding comparison: every member is compared, so a same-name module at the same
# digest but different artifacts, schemas, revision or protocol version refuses.
#
# A reference claim is compared the same way against the expectation derived from
# the step that produced it. A five-member historical record stays readable as an
# unestablished legacy association; an unknown format, a claim that declares no
# producer, a missing connection and a foreign binding are unreadable or foreign,
# and none of them is a qualified absence.
#
# The answer is about those common comparisons only. It names the selected schema
# the payload must still satisfy; it does not read the payload, which travels as
# Codec's opaque encoded value, and it never reports a schema acceptance. A
# schema identity the retained binding does not hold refuses, and a caller with no
# schema identity for the operation is told that operand is missing.
#
# The named schema requirement composes with Codec's checked entry:
# Schema.schema_admit_value(defs: List<SchemaDef>, form: SchemaForm, input:
# Codec.RawValue) -> SchemaVerdict runs the declaration preflight over the
# definitions and the root form and then walks the value, and that value is
# Codec's raw model rather than encoded text, so an exact number token never
# passes through a host number. Schema.schema_walk is Codec-internal and only the
# checked entry reaches it, and Schema.schema_preflight, schema_declaration_ok and
# json_admit are also exported. The verdict is SvOk or SvRefused{condition} with
# the conditions ambiguousDeclaration, declarationRefused, undeclaredField,
# missingField, duplicateKey, wrongKind, enumLiteral, unknownTag, dictKeyRefused
# and unknownReference (bend2/src/context/codec-schema.bend, Codec commit
# 84daf82ec1e92242eb6740fbe3ddf7711ae9ea43, blob
# 1f319fa8a224a04799a90ff652bd548180310973). `payload` here is the encoded payload
# text the caller decodes before that call; this module reads neither and imports
# no Codec module, so the wiring owner adds the import in its own closure.
#
# Wire mapping, agreed with Codec and owned by them on the encoding side: the
# version member here is the text "2" while the closed wire shape carries the
# numeric 2; role and incarnation here are empty strings for a direct invocation
# while that shape carries null; and the request member is the canonical request
# value, which travels as that value rather than as a quoted string. These are
# mappings, not identities this module asserts.
#
# The expectation constructors below are derived from the frozen step, so a
# caller cannot build an expectation from a module name or a digest it chose, and
# a dependency result is compared against its own step's binding.

import Base
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./engines-select.bend as Sel

# --- identity equality over binding members ----------------------------------
def ss_nil(+xs: Eng.SS) -> Bool:
  match xs:
    case Eng.SSNil{}: True{}
    case Eng.SSCons{head, rest}: False{}

# The comma-joined members of an identity set, for a mismatch report.
def ss_text(+xs: Eng.SS) -> String:
  match xs:
    case Eng.SSNil{}: ""
    case Eng.SSCons{head, Eng.SSNil{}}: head
    case Eng.SSCons{head, rest}: String.append(head, String.append(",", ss_text(rest)))

def art_text(+a: Decl.Art) -> String:
  match a:
    case Decl.Art{path, sha256, role}:
      String.append(path, String.append("#", String.append(sha256, String.append(":", role))))

def arts_text(+a: Decl.Arts) -> String:
  match a:
    case Decl.ArtsNil{}: ""
    case Decl.ArtsCons{head, Decl.ArtsNil{}}: art_text(head)
    case Decl.ArtsCons{head, rest}:
      String.append(art_text(head), String.append(";", arts_text(rest)))

def art_equal(+a: Decl.Art, +b: Decl.Art) -> Bool:
  match a:
    case Decl.Art{path, sha256, role}:
      match b:
        case Decl.Art{other_path, other_sha256, other_role}:
          Bool.and(String.eq(path, other_path),
          Bool.and(String.eq(sha256, other_sha256), String.eq(role, other_role)))

def arts_nil(+a: Decl.Arts) -> Bool:
  match a:
    case Decl.ArtsNil{}: True{}
    case Decl.ArtsCons{head, rest}: False{}

# Artifact identities compare in declared order: the entry artifact first, then
# the dependency closure as the declaration lists it.
def arts_equal(+a: Decl.Arts, +b: Decl.Arts) -> Bool:
  match a:
    case Decl.ArtsNil{}: arts_nil(b)
    case Decl.ArtsCons{head, rest}:
      match b:
        case Decl.ArtsNil{}: False{}
        case Decl.ArtsCons{other_head, other_rest}:
          Bool.and(art_equal(head, other_head), arts_equal(rest, other_rest))

def subset(+want: Eng.SS, +limit: Eng.SS) -> Bool:
  match want:
    case Eng.SSNil{}: True{}
    case Eng.SSCons{head, rest}:
      Bool.pick(Bool, Eng.ss_member(limit, head), subset(rest, limit), False{})

# Schema identities are a set: the same members in any order.
def ss_same_members(+a: Eng.SS, +b: Eng.SS) -> Bool:
  Bool.and(subset(a, b), subset(b, a))

# --- the operative binding comparison ----------------------------------------
# The first member of the echoed binding that differs from the retained one, in
# the order the format fixes. Every member is compared, so this answer is not a
# declaration-digest comparison under another name.
type FieldState is Data:
  FsSame{}
  FsDiffers{field: String, want: String, saw: String}
  FsArtifacts{want: String, saw: String}
  FsSchemas{want: String, saw: String}

def field_schemas(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    ss_same_members(Sel.bind_schemas(want), Sel.bind_schemas(saw)), FsSame{},
    FsSchemas{ss_text(Sel.bind_schemas(want)), ss_text(Sel.bind_schemas(saw))})

def field_artifacts(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    arts_equal(Sel.bind_artifacts(want), Sel.bind_artifacts(saw)),
    field_schemas(want, saw),
    FsArtifacts{arts_text(Sel.bind_artifacts(want)),
                arts_text(Sel.bind_artifacts(saw))})

def field_operation(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    String.eq(Sel.bind_operation(want), Sel.bind_operation(saw)),
    field_artifacts(want, saw),
    FsDiffers{"operation", Sel.bind_operation(want), Sel.bind_operation(saw)})

def field_protocol(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    String.eq(Sel.bind_protocol(want), Sel.bind_protocol(saw)),
    field_operation(want, saw),
    FsDiffers{"protocolVersion", Sel.bind_protocol(want), Sel.bind_protocol(saw)})

def field_digest(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    String.eq(Sel.bind_digest(want), Sel.bind_digest(saw)),
    field_protocol(want, saw),
    FsDiffers{"declarationDigest", Sel.bind_digest(want), Sel.bind_digest(saw)})

def field_revision(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    String.eq(Sel.bind_revision(want), Sel.bind_revision(saw)),
    field_digest(want, saw),
    FsDiffers{"revision", Sel.bind_revision(want), Sel.bind_revision(saw)})

def binding_fields(+want: Sel.MBind, +saw: Sel.MBind) -> FieldState:
  Bool.pick(FieldState,
    String.eq(Sel.bind_module(want), Sel.bind_module(saw)),
    field_revision(want, saw),
    FsDiffers{"moduleId", Sel.bind_module(want), Sel.bind_module(saw)})

# --- retained expectation ----------------------------------------------------
# The association the observer retains: the query and owner it answers, the
# complete frozen binding of the selected producing step, the selected schema
# identity, the runtime of its own when it has one, the role and incarnation of a
# managed invocation (both empty for a direct one) and the last sequence it
# committed.
type Expect is Data:
  Expect{query: String, owner: String, producer: Sel.MBind,
         result_schema: String, runtime: String, direct: Bool, role: String,
         incarnation: String, last_sequence: String}

# --- returned frame ----------------------------------------------------------
# One common version-2 event or result frame. `producer` is the complete echoed
# binding, `payload` is Codec's opaque encoded payload and is not read here, and
# `runtime`, `role` and `incarnation` are empty strings in the null cases. This
# record is the single type Codec encodes and decodes for the common frame.
type Frame is Data:
  Frame{version: String, query: String, owner: String, producer: Sel.MBind,
        runtime: String, role: String, incarnation: String, sequence: String,
        frame_type: String, payload: String}

def frame_version(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      version

def frame_query(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      query

def frame_owner(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      owner

def frame_producer(+f: Frame) -> Sel.MBind:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      producer

def frame_runtime(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      runtime

def frame_role(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      role

def frame_incarnation(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      incarnation

def frame_sequence(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      sequence

def frame_type_of(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      frame_type

def frame_payload(+f: Frame) -> String:
  match f:
    case Frame{version, query, owner, producer, runtime, role, incarnation,
               sequence, frame_type, payload}:
      payload

def expect_query(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      query

def expect_owner(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      owner

def expect_producer(+e: Expect) -> Sel.MBind:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      producer

def expect_module(+e: Expect) -> String:
  Sel.bind_module(expect_producer(e))

def expect_operation(+e: Expect) -> String:
  Sel.bind_operation(expect_producer(e))

def expect_schema(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      result_schema

def expect_runtime(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      runtime

def expect_direct(+e: Expect) -> Bool:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      direct

def expect_role(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      role

def expect_incarnation(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      incarnation

def expect_last_sequence(+e: Expect) -> String:
  match e:
    case Expect{query, owner, producer, result_schema, runtime, direct, role,
                incarnation, last_sequence}:
      last_sequence

# The expectation of one frozen step. The binding and the result schema both come
# from that step, so a caller cannot build an expectation from a module name, a
# digest or a schema identity it chose. The direct and managed forms fix the role
# and runtime cases.
def expect_of_step(+step: Sel.Step, +query: String, +owner: String,
                   +runtime: String, +direct: Bool, +role: String,
                   +incarnation: String, +last_sequence: String) -> Expect:
  Expect{query, owner, Sel.step_binding(step), Sel.step_result_schema(step),
         runtime, direct, role, incarnation, last_sequence}

def expect_direct_of_step(+step: Sel.Step, +query: String, +owner: String,
                          +last_sequence: String) -> Expect:
  expect_of_step(step, query, owner, "", True{}, "", "", last_sequence)

def expect_managed_of_step(+step: Sel.Step, +query: String, +owner: String,
                           +runtime: String, +role: String,
                           +incarnation: String, +last_sequence: String) -> Expect:
  expect_of_step(step, query, owner, runtime, False{}, role, incarnation,
                 last_sequence)

# --- refusals and the sequential comparison ----------------------------------
type VReject is Data:
  VrVersion{saw: String}
  VrField{field: String, want: String, saw: String}
  VrBinding{field: String, want: String, saw: String}
  VrBindingArtifacts{want: String, saw: String}
  VrBindingSchemas{want: String, saw: String}
  VrRole{kind: String}
  VrIncarnation{want: String, saw: String}
  VrRuntime{kind: String}
  VrSequence{saw: String, last: String}
  VrType{saw: String}
  VrSchemaMissing{module_id: String, operation: String, schema: String}
  VrSchemaInputMissing{module_id: String, operation: String}

type VOutcome is Data:
  VOk{query: String, sequence: String, schema_validation_required: String}
  VRefused{reason: VReject}

type VChk is Data:
  VcOk{}
  VcFail{reason: VReject}

def v_chk(+cond: Bool, +reason: VReject) -> VChk:
  Bool.pick(VChk, cond, VcOk{}, VcFail{reason})

def then_v(+a: VChk, +b: VChk) -> VChk:
  match a:
    case VcFail{reason}: VcFail{reason}
    case VcOk{}: b

def v_binding_state(+fs: FieldState) -> VChk:
  match fs:
    case FsSame{}: VcOk{}
    case FsDiffers{field, want, saw}: VcFail{VrBinding{field, want, saw}}
    case FsArtifacts{want, saw}: VcFail{VrBindingArtifacts{want, saw}}
    case FsSchemas{want, saw}: VcFail{VrBindingSchemas{want, saw}}

# --- canonical sequence text -------------------------------------------------
# A sequence is canonical unsigned decimal text and carries no numeric domain
# bound: the digits are checked as text, so a value above the U32 range is
# canonical and still orders correctly. Canonical means nonempty, every character a
# decimal digit, and no leading zero, so "007" refuses while "4294967296" is
# admitted.
def digits_only(+xs: List<&2, Char>) -> Bool:
  match xs:
    case Nil{}: True{}
    case h <> t: Bool.and(Char.is_digit(h), digits_only(t))

def canonical_unsigned_decimal(+s: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(s)),
  Bool.and(digits_only(String.to_list(s)),
           Bool.not(Bool.and(String.starts_with(s, "0"),
                             Bool.not(String.eq(s, "0"))))))

# Strictly greater than the last committed sequence. Canonical text without a
# leading zero orders by length first and lexically within one length, for any
# digit count, so this needs no arithmetic and no numeric bound.
def sequence_greater(+longer: Bool, +same_length: Bool, +last: String,
                     +saw: String) -> Bool:
  Bool.pick(Bool, longer, True{},
    Bool.pick(Bool, same_length, String.is_lt(last, saw), False{}))

def sequence_after(+last: String, +saw: String) -> Bool:
  sequence_greater(Nat.is_lt(String.length(last), String.length(saw)),
                   Nat.is_eq(String.length(last), String.length(saw)), last,
                   saw)

def frame_version_ok(+v: String) -> Bool:
  String.eq(v, "2")

def frame_type_ok(+t: String) -> Bool:
  Bool.or(String.eq(t, "accepted"),
  Bool.or(String.eq(t, "complete"),
  Bool.or(String.eq(t, "failed"), String.eq(t, "state"))))

# --- the frame comparison ----------------------------------------------------
def check_query(+f: Frame, +e: Expect) -> VChk:
  Bool.pick(VChk, String.is_empty(frame_query(f)),
    v_chk(Bool.not(String.is_empty(expect_runtime(e))),
          VrRuntime{"a query-null event requires a retained runtime"}),
    v_chk(String.eq(frame_query(f), expect_query(e)),
          VrField{"query", expect_query(e), frame_query(f)}))

def check_owner(+f: Frame, +e: Expect) -> VChk:
  v_chk(String.eq(frame_owner(f), expect_owner(e)),
       VrField{"owner", expect_owner(e), frame_owner(f)})

def check_binding(+f: Frame, +e: Expect) -> VChk:
  v_binding_state(binding_fields(expect_producer(e), frame_producer(f)))

def check_role(+f: Frame, +e: Expect) -> VChk:
  Bool.pick(VChk, expect_direct(e),
    v_chk(String.is_empty(frame_role(f)),
          VrRole{"a direct invocation carries a null role"}),
    v_chk(String.eq(frame_role(f), expect_role(e)),
          VrField{"role", expect_role(e), frame_role(f)}))

def check_incarnation(+f: Frame, +e: Expect) -> VChk:
  Bool.pick(VChk, expect_direct(e),
    v_chk(String.is_empty(frame_incarnation(f)),
          VrRole{"a direct invocation carries a null incarnation"}),
    v_chk(String.eq(frame_incarnation(f), expect_incarnation(e)),
          VrIncarnation{expect_incarnation(e), frame_incarnation(f)}))

def check_runtime(+f: Frame, +e: Expect) -> VChk:
  v_chk(String.eq(frame_runtime(f), expect_runtime(e)),
       VrField{"runtime", expect_runtime(e), frame_runtime(f)})

def check_sequence(+f: Frame, +e: Expect) -> VChk:
  then_v(v_chk(canonical_unsigned_decimal(frame_sequence(f)),
               VrSequence{frame_sequence(f), expect_last_sequence(e)}),
         v_chk(sequence_after(expect_last_sequence(e), frame_sequence(f)),
               VrSequence{frame_sequence(f), expect_last_sequence(e)}))

def check_type(+f: Frame, +e: Expect) -> VChk:
  v_chk(frame_type_ok(frame_type_of(f)), VrType{frame_type_of(f)})

# The selected schema must be one the retained binding holds. The payload is not
# read: Codec interprets it against that schema, and no comparison here reports a
# schema acceptance.
def check_schema(+f: Frame, +e: Expect) -> VChk:
  Bool.pick(VChk, String.is_empty(expect_schema(e)),
    VcFail{VrSchemaInputMissing{expect_module(e), expect_operation(e)}},
    then_v(v_chk(Eng.ss_member(Sel.bind_schemas(expect_producer(e)),
                               expect_schema(e)),
                 VrSchemaMissing{expect_module(e), expect_operation(e),
                                 expect_schema(e)}),
           VcOk{}))

def frame_checks(+f: Frame, +e: Expect) -> VChk:
  then_v(v_chk(frame_version_ok(frame_version(f)), VrVersion{frame_version(f)}),
  then_v(check_query(f, e),
  then_v(check_owner(f, e),
  then_v(check_binding(f, e),
  then_v(check_role(f, e),
  then_v(check_incarnation(f, e),
  then_v(check_runtime(f, e),
  then_v(check_sequence(f, e),
  then_v(check_type(f, e),
  then_v(check_schema(f, e),
         VcOk{}))))))))))

# VOk names the schema identity the payload must still satisfy under the composed
# Codec call above; it is not a schema verdict and authorizes no publication.
def validate_finish(+c: VChk, +f: Frame, +e: Expect) -> VOutcome:
  match c:
    case VcFail{reason}: VRefused{reason}
    case VcOk{}: VOk{frame_query(f), frame_sequence(f), expect_schema(e)}

# Compare one returned frame against the retained expectation of the step that
# produced it. The payload member is carried through and not read.
def validate_frame(+f: Frame, +e: Expect) -> VOutcome:
  validate_finish(frame_checks(f, e), f, e)

# --- reference claims --------------------------------------------------------
# One reference as a result echo carries it: the format name, its own id, and the
# complete producer binding. `declares_producer` records whether the record
# carried a producer binding at all, which separates the historical five-member
# shape from a modern claim that names nothing.
type RefClaim is Data:
  RefClaim{ref_format: String, ref_id: String, declares_producer: Bool,
           producer: Sel.MBind}

# The authenticated original step a reference must agree with.
type RefExpect is Data:
  RefExpect{ref_format: String, association_present: Bool,
            producer: Sel.MBind}

type RefOutcome is Data:
  RefVerified{ref_id: String, module_id: String, operation: String}
  RefUnknownFormat{saw: String}
  RefForeign{field: String, want: String, saw: String}
  RefForeignArtifacts{want: String, saw: String}
  RefForeignSchemas{want: String, saw: String}
  RefLegacyUnestablished{ref_id: String}
  RefUnreadable{reason: String}

def ref_expect_of_step(+step: Sel.Step, +ref_format: String,
                       +association_present: Bool) -> RefExpect:
  RefExpect{ref_format, association_present, Sel.step_binding(step)}

def ref_claim_format(+c: RefClaim) -> String:
  match c:
    case RefClaim{ref_format, ref_id, declares_producer, producer}:
      ref_format

def ref_claim_id(+c: RefClaim) -> String:
  match c:
    case RefClaim{ref_format, ref_id, declares_producer, producer}:
      ref_id

def ref_claim_declares_producer(+c: RefClaim) -> Bool:
  match c:
    case RefClaim{ref_format, ref_id, declares_producer, producer}:
      declares_producer

def ref_claim_producer(+c: RefClaim) -> Sel.MBind:
  match c:
    case RefClaim{ref_format, ref_id, declares_producer, producer}:
      producer

def ref_expect_format(+e: RefExpect) -> String:
  match e:
    case RefExpect{ref_format, association_present, producer}:
      ref_format

def ref_expect_association(+e: RefExpect) -> Bool:
  match e:
    case RefExpect{ref_format, association_present, producer}:
      association_present

def ref_expect_producer(+e: RefExpect) -> Sel.MBind:
  match e:
    case RefExpect{ref_format, association_present, producer}:
      producer

def ref_expect_module(+e: RefExpect) -> String:
  Sel.bind_module(ref_expect_producer(e))

def ref_expect_operation(+e: RefExpect) -> String:
  Sel.bind_operation(ref_expect_producer(e))

def ref_format_ok(+c: RefClaim, +e: RefExpect) -> Bool:
  Bool.and(String.eq(ref_claim_format(c), ref_expect_format(e)),
           Bool.not(String.is_empty(ref_claim_format(c))))

def ref_legacy(+c: RefClaim) -> Bool:
  Bool.and(String.is_empty(ref_claim_format(c)),
           Bool.not(ref_claim_declares_producer(c)))

def ref_fields(+fs: FieldState, +c: RefClaim, +e: RefExpect) -> RefOutcome:
  match fs:
    case FsSame{}:
      RefVerified{ref_claim_id(c), ref_expect_module(e),
                  ref_expect_operation(e)}
    case FsDiffers{field, want, saw}: RefForeign{field, want, saw}
    case FsArtifacts{want, saw}: RefForeignArtifacts{want, saw}
    case FsSchemas{want, saw}: RefForeignSchemas{want, saw}

def ref_declared(+declared: Bool, +c: RefClaim, +e: RefExpect) -> RefOutcome:
  Bool.pick(RefOutcome, declared,
    ref_fields(binding_fields(ref_expect_producer(e), ref_claim_producer(c)), c,
               e),
    RefUnreadable{"the ref claim declares no producer binding"})

def ref_verify(+present: Bool, +c: RefClaim, +e: RefExpect) -> RefOutcome:
  Bool.pick(RefOutcome, present,
            ref_declared(ref_claim_declares_producer(c), c, e),
            RefUnreadable{"missing historical association"})

def ref_decide(+format_ok: Bool, +legacy: Bool, +c: RefClaim,
               +e: RefExpect) -> RefOutcome:
  Bool.pick(RefOutcome, format_ok, ref_verify(ref_expect_association(e), c, e),
    Bool.pick(RefOutcome, legacy, RefLegacyUnestablished{ref_claim_id(c)},
              RefUnknownFormat{ref_claim_format(c)}))

# Compare one reference claim with the step expectation of its producing step.
def ref_admit(+c: RefClaim, +e: RefExpect) -> RefOutcome:
  ref_decide(ref_format_ok(c, e), ref_legacy(c), c, e)

# --- projection limits and effective requirements ---------------------------
def projections_admissible(+requested: Eng.SS, +stored: Eng.SS, +current: Eng.SS) -> Bool:
  Bool.and(subset(requested, stored), subset(requested, current))

def effective_requirements(+historical: Eng.SS, +common_minimum: Eng.SS,
                           +declared: Eng.SS) -> Eng.SS:
  Eng.union_add(historical,
                Eng.union_add(common_minimum,
                              Eng.union_add(declared, Eng.ss_empty())))

# --- compatibility is evidence, never an effect-set comparison ---------------
type CompatEvidence is Data:
  CompatEvidence{original_digest: String, current_digest: String,
                 evidence_bindings: Eng.SS, basis: Eng.SS}

type CompatOutcome is Data:
  CompatAdmitted{basis: Eng.SS}
  CompatRefused{reason: String}

def compat_evidence_original(+e: CompatEvidence) -> String:
  match e:
    case CompatEvidence{original_digest, current_digest, evidence_bindings,
                        basis}:
      original_digest

def compat_evidence_current(+e: CompatEvidence) -> String:
  match e:
    case CompatEvidence{original_digest, current_digest, evidence_bindings,
                        basis}:
      current_digest

def compat_evidence_bindings(+e: CompatEvidence) -> Eng.SS:
  match e:
    case CompatEvidence{original_digest, current_digest, evidence_bindings,
                        basis}:
      evidence_bindings

def compat_evidence_basis(+e: CompatEvidence) -> Eng.SS:
  match e:
    case CompatEvidence{original_digest, current_digest, evidence_bindings,
                        basis}:
      basis

def evidence_ties(+e: CompatEvidence) -> Bool:
  Bool.and(Eng.ss_member(compat_evidence_bindings(e),
                         compat_evidence_original(e)),
           Eng.ss_member(compat_evidence_bindings(e),
                         compat_evidence_current(e)))

def compat_finish(+ties: Bool, +e: CompatEvidence) -> CompatOutcome:
  Bool.pick(CompatOutcome, ties, CompatAdmitted{compat_evidence_basis(e)},
            CompatRefused{"no admitted evidence is tied to both complete bindings"})

# Two bindings are compatible only when admitted evidence names both of them.
# Equal effect sets are not consulted here, because equal effect sets alone
# establish no semantic compatibility.
def compatibility(+original_digest: String, +current_digest: String,
                  +evidence: CompatEvidence) -> CompatOutcome:
  compat_finish(
    Bool.and(String.eq(compat_evidence_original(evidence), original_digest),
             Bool.and(String.eq(compat_evidence_current(evidence),
                                current_digest),
                      evidence_ties(evidence))),
    evidence)
