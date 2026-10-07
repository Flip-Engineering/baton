# CLAIM: the operative laws of the returned-frame and reference-claim validation
# in bend2/src/context/snapshot-validate.bend. Each law fixes the real answer of
# the real function for one frame or claim against one retained expectation, and
# is proved beside its claim, so every compile of an entry importing this module
# verifies it.
#
# The laws fix that every member of the echoed binding is compared — revision and
# protocol version and operation and artifact identities and schema identities,
# not the declaration digest alone — that an expectation is derived from the
# frozen step rather than from a name, that a common envelope agreement names the
# schema still to be interpreted instead of reporting a schema acceptance, and
# that a foreign, unknown-format or unestablished reference is never a qualified
# absence.

import Base
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./engines-select.bend as Sel
import ./snapshot-validate.bend as SV

# --- fixtures ----------------------------------------------------------------
def fx_schemas() -> Eng.SS:
  Eng.union_add(Eng.ss_three("sub", "opt", "res"),
                Eng.union_add(Eng.ss_two("ref", "evt"), Eng.ss_empty()))

def fx_arts() -> Decl.Arts:
  Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, Decl.ArtsNil{}}

def fx_bind() -> Sel.MBind:
  Sel.MBind{"m1", "rev1", "d1", "2", "definition", fx_arts(), fx_schemas()}

def fx_bind_other() -> Sel.MBind:
  Sel.MBind{"m2", "rev1", "d1", "2", "definition", fx_arts(), fx_schemas()}

def fx_bind_empty() -> Sel.MBind:
  Sel.MBind{"", "", "", "", "", Decl.ArtsNil{}, Eng.ss_empty()}

def fx_step() -> Sel.Step:
  Sel.Step{fx_bind(), "sourceAnalysis", Eng.ss_empty(), Decl.ExDirect{},
           Sel.StepRefsNil{}, "res"}

# A direct invocation of module m1: no runtime, no role, no incarnation, one
# committed sequence, and the result schema `res` the binding holds.
def fx_expect() -> SV.Expect:
  SV.Expect{"q7", "owner-1", fx_bind(), "res", "", True{}, "", "", "10"}

def fx_expect_managed() -> SV.Expect:
  SV.Expect{"q7", "owner-1", fx_bind(), "res", "runtime-1", False{}, "role-1",
            "inc-1", "10"}

def fx_frame() -> SV.Frame:
  SV.Frame{"2", "q7", "owner-1", fx_bind(), "", "", "", "11", "complete",
           "payloadText"}

def frame_at(+version: String, +query: String, +owner: String,
             +producer: Sel.MBind, +runtime: String, +role: String,
             +incarnation: String, +sequence: String,
             +frame_type: String) -> SV.Frame:
  SV.Frame{version, query, owner, producer, runtime, role, incarnation, sequence,
           frame_type, "payloadText"}

def frame_with(+producer: Sel.MBind) -> SV.Frame:
  SV.Frame{"2", "q7", "owner-1", producer, "", "", "", "11", "complete",
           "payloadText"}

def frame_at_sequence(+sequence: String) -> SV.Frame:
  SV.Frame{"2", "q7", "owner-1", fx_bind(), "", "", "", sequence, "complete",
           "payloadText"}

# --- the accepted common comparison -----------------------------------------
law frame_validation_names_the_schema_still_to_be_interpreted:
  {SV.validate_frame(fx_frame(), fx_expect()) == SV.VOk{"q7", "11", "res"} : SV.VOutcome}

def frame_validation_names_the_schema_still_to_be_interpreted():
  {==}

law frame_validation_admits_a_later_sequence:
  {SV.validate_frame(frame_at_sequence("12"), fx_expect()) == SV.VOk{"q7", "12", "res"} : SV.VOutcome}

def frame_validation_admits_a_later_sequence():
  {==}

# The expectation is derived from the frozen step, so its binding is the step's
# own binding and not a name the caller chose.
law frame_expectation_is_derived_from_the_step:
  {SV.expect_direct_of_step(fx_step(), "q7", "owner-1", "10") == fx_expect() : SV.Expect}

def frame_expectation_is_derived_from_the_step():
  {==}

law frame_managed_expectation_is_derived_from_the_step:
  {SV.expect_managed_of_step(fx_step(), "q7", "owner-1", "runtime-1", "role-1", "inc-1", "10") == fx_expect_managed() : SV.Expect}

def frame_managed_expectation_is_derived_from_the_step():
  {==}

# --- protocol and envelope fields --------------------------------------------
law frame_validation_refuses_a_different_protocol_version:
  {SV.validate_frame(frame_at("1", "q7", "owner-1", fx_bind(), "", "", "", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrVersion{"1"}} : SV.VOutcome}

def frame_validation_refuses_a_different_protocol_version():
  {==}

law frame_validation_refuses_a_foreign_query:
  {SV.validate_frame(frame_at("2", "q9", "owner-1", fx_bind(), "", "", "", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrField{"query", "q7", "q9"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_query():
  {==}

law frame_validation_refuses_a_foreign_owner:
  {SV.validate_frame(frame_at("2", "q7", "owner-2", fx_bind(), "", "", "", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrField{"owner", "owner-1", "owner-2"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_owner():
  {==}

# --- the operative binding comparison ----------------------------------------
# Every member of the echoed binding is compared, so a same-digest module at a
# different module name, revision, protocol version or operation refuses.
law frame_validation_refuses_a_foreign_binding_module:
  {SV.validate_frame(frame_with(fx_bind_other()), fx_expect()) == SV.VRefused{SV.VrBinding{"moduleId", "m1", "m2"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_binding_module():
  {==}

law frame_validation_refuses_a_foreign_binding_revision:
  {SV.validate_frame(frame_with(Sel.MBind{"m1", "rev9", "d1", "2", "definition", fx_arts(), fx_schemas()}), fx_expect()) == SV.VRefused{SV.VrBinding{"revision", "rev1", "rev9"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_binding_revision():
  {==}

law frame_validation_refuses_a_foreign_binding_protocol:
  {SV.validate_frame(frame_with(Sel.MBind{"m1", "rev1", "d1", "3", "definition", fx_arts(), fx_schemas()}), fx_expect()) == SV.VRefused{SV.VrBinding{"protocolVersion", "2", "3"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_binding_protocol():
  {==}

law frame_validation_refuses_a_foreign_binding_digest:
  {SV.validate_frame(frame_with(Sel.MBind{"m1", "rev1", "d9", "2", "definition", fx_arts(), fx_schemas()}), fx_expect()) == SV.VRefused{SV.VrBinding{"declarationDigest", "d1", "d9"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_binding_digest():
  {==}

law frame_validation_refuses_a_foreign_binding_operation:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "", "", "", "11", "complete"), SV.Expect{"q7", "owner-1", Sel.MBind{"m1", "rev1", "d1", "2", "other", fx_arts(), fx_schemas()}, "res", "", True{}, "", "", "10"}) == SV.VRefused{SV.VrBinding{"operation", "other", "definition"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_binding_operation():
  {==}

# The artifact identities differ although module, revision, digest, protocol and
# operation agree: a digest comparison alone would have accepted this frame.
law frame_validation_refuses_foreign_artifact_identities:
  {SV.validate_frame(frame_with(Sel.MBind{"m1", "rev1", "d1", "2", "definition", Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "zz", "entry"}, Decl.ArtsNil{}}, fx_schemas()}), fx_expect()) == SV.VRefused{SV.VrBindingArtifacts{"/pkg/m1.bin#aa:entry", "/pkg/m1.bin#zz:entry"}} : SV.VOutcome}

def frame_validation_refuses_foreign_artifact_identities():
  {==}

# The schema identities differ although every other member agrees.
law frame_validation_refuses_foreign_schema_identities:
  {SV.validate_frame(frame_with(Sel.MBind{"m1", "rev1", "d1", "2", "definition", fx_arts(), Eng.ss_two("ref", "evt")}), fx_expect()) == SV.VRefused{SV.VrBindingSchemas{"ref,evt,sub,opt,res", "ref,evt"}} : SV.VOutcome}

def frame_validation_refuses_foreign_schema_identities():
  {==}

law frame_validation_admits_identities_in_another_order:
  {SV.validate_frame(frame_with(Sel.MBind{"m1", "rev1", "d1", "2", "definition", fx_arts(), Eng.union_add(Eng.ss_three("res", "opt", "sub"), Eng.ss_two("evt", "ref"))}), fx_expect()) == SV.VOk{"q7", "11", "res"} : SV.VOutcome}

def frame_validation_admits_identities_in_another_order():
  {==}

# --- role, incarnation and runtime -------------------------------------------
law frame_validation_refuses_a_role_on_a_direct_invocation:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "", "role-1", "", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrRole{"a direct invocation carries a null role"}} : SV.VOutcome}

def frame_validation_refuses_a_role_on_a_direct_invocation():
  {==}

law frame_validation_refuses_an_incarnation_on_a_direct_invocation:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "", "", "inc-1", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrRole{"a direct invocation carries a null incarnation"}} : SV.VOutcome}

def frame_validation_refuses_an_incarnation_on_a_direct_invocation():
  {==}

law frame_validation_refuses_a_foreign_role:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "runtime-1", "role-2", "inc-1", "11", "complete"), fx_expect_managed()) == SV.VRefused{SV.VrField{"role", "role-1", "role-2"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_role():
  {==}

law frame_validation_refuses_a_foreign_incarnation:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "runtime-1", "role-1", "inc-2", "11", "complete"), fx_expect_managed()) == SV.VRefused{SV.VrIncarnation{"inc-1", "inc-2"}} : SV.VOutcome}

def frame_validation_refuses_a_foreign_incarnation():
  {==}

law frame_validation_refuses_a_runtime_the_invocation_does_not_hold:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "runtime-9", "", "", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrField{"runtime", "", "runtime-9"}} : SV.VOutcome}

def frame_validation_refuses_a_runtime_the_invocation_does_not_hold():
  {==}

law frame_validation_refuses_a_query_null_frame_without_a_retained_runtime:
  {SV.validate_frame(frame_at("2", "", "owner-1", fx_bind(), "", "", "", "11", "complete"), fx_expect()) == SV.VRefused{SV.VrRuntime{"a query-null event requires a retained runtime"}} : SV.VOutcome}

def frame_validation_refuses_a_query_null_frame_without_a_retained_runtime():
  {==}

law frame_validation_admits_a_query_null_frame_for_a_retained_runtime:
  {SV.validate_frame(frame_at("2", "", "owner-1", fx_bind(), "runtime-1", "role-1", "inc-1", "11", "state"), fx_expect_managed()) == SV.VOk{"", "11", "res"} : SV.VOutcome}

def frame_validation_admits_a_query_null_frame_for_a_retained_runtime():
  {==}

# --- sequence ------------------------------------------------------------------
law frame_validation_refuses_a_repeated_sequence:
  {SV.validate_frame(frame_at_sequence("10"), fx_expect()) == SV.VRefused{SV.VrSequence{"10", "10"}} : SV.VOutcome}

def frame_validation_refuses_a_repeated_sequence():
  {==}

law frame_validation_refuses_a_regressed_sequence:
  {SV.validate_frame(frame_at_sequence("9"), fx_expect()) == SV.VRefused{SV.VrSequence{"9", "10"}} : SV.VOutcome}

def frame_validation_refuses_a_regressed_sequence():
  {==}

law frame_validation_refuses_a_non_canonical_sequence:
  {SV.validate_frame(frame_at_sequence("011"), fx_expect()) == SV.VRefused{SV.VrSequence{"011", "10"}} : SV.VOutcome}

def frame_validation_refuses_a_non_canonical_sequence():
  {==}

law frame_validation_refuses_a_non_decimal_sequence:
  {SV.validate_frame(frame_at_sequence("eleven"), fx_expect()) == SV.VRefused{SV.VrSequence{"eleven", "10"}} : SV.VOutcome}

def frame_validation_refuses_a_non_decimal_sequence():
  {==}

law frame_sequence_text_is_canonical_only_in_its_own_form:
  {SV.canonical_unsigned_decimal("10") == True{} : Bool}

def frame_sequence_text_is_canonical_only_in_its_own_form():
  {==}

law frame_sequence_text_rejects_a_leading_zero:
  {SV.canonical_unsigned_decimal("07") == False{} : Bool}

def frame_sequence_text_rejects_a_leading_zero():
  {==}

law frame_sequence_text_orders_by_length_then_lexically:
  {SV.sequence_after("9", "10") == True{} : Bool}

def frame_sequence_text_orders_by_length_then_lexically():
  {==}

# --- the closed event type and the selected schema ---------------------------
law frame_validation_refuses_an_unknown_event_type:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "", "", "", "11", "streaming"), fx_expect()) == SV.VRefused{SV.VrType{"streaming"}} : SV.VOutcome}

def frame_validation_refuses_an_unknown_event_type():
  {==}

law frame_validation_admits_the_accepted_event_type:
  {SV.validate_frame(frame_at("2", "q7", "owner-1", fx_bind(), "", "", "", "11", "accepted"), fx_expect()) == SV.VOk{"q7", "11", "res"} : SV.VOutcome}

def frame_validation_admits_the_accepted_event_type():
  {==}

law frame_validation_refuses_a_schema_the_binding_does_not_hold:
  {SV.validate_frame(fx_frame(), SV.Expect{"q7", "owner-1", fx_bind(), "otherSchema", "", True{}, "", "", "10"}) == SV.VRefused{SV.VrSchemaMissing{"m1", "definition", "otherSchema"}} : SV.VOutcome}

def frame_validation_refuses_a_schema_the_binding_does_not_hold():
  {==}

law frame_validation_names_a_missing_schema_operand:
  {SV.validate_frame(fx_frame(), SV.Expect{"q7", "owner-1", fx_bind(), "", "", True{}, "", "", "10"}) == SV.VRefused{SV.VrSchemaInputMissing{"m1", "definition"}} : SV.VOutcome}

def frame_validation_names_a_missing_schema_operand():
  {==}

# --- reference claims ---------------------------------------------------------
def fx_ref_claim() -> SV.RefClaim:
  SV.RefClaim{"context-refs-v2", "r9", True{}, fx_bind()}

def fx_ref_expect() -> SV.RefExpect:
  SV.RefExpect{"context-refs-v2", True{}, fx_bind()}

law ref_claim_expectation_is_derived_from_the_step:
  {SV.ref_expect_of_step(fx_step(), "context-refs-v2", True{}) == fx_ref_expect() : SV.RefExpect}

def ref_claim_expectation_is_derived_from_the_step():
  {==}

law ref_claim_verifies_the_authenticated_step:
  {SV.ref_admit(fx_ref_claim(), fx_ref_expect()) == SV.RefVerified{"r9", "m1", "definition"} : SV.RefOutcome}

def ref_claim_verifies_the_authenticated_step():
  {==}

law ref_claim_refuses_a_foreign_engine:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", True{}, fx_bind_other()}, fx_ref_expect()) == SV.RefForeign{"moduleId", "m1", "m2"} : SV.RefOutcome}

def ref_claim_refuses_a_foreign_engine():
  {==}

law ref_claim_refuses_a_foreign_operation:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", True{}, Sel.MBind{"m1", "rev1", "d1", "2", "other", fx_arts(), fx_schemas()}}, fx_ref_expect()) == SV.RefForeign{"operation", "definition", "other"} : SV.RefOutcome}

def ref_claim_refuses_a_foreign_operation():
  {==}

law ref_claim_refuses_a_foreign_revision:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", True{}, Sel.MBind{"m1", "rev9", "d1", "2", "definition", fx_arts(), fx_schemas()}}, fx_ref_expect()) == SV.RefForeign{"revision", "rev1", "rev9"} : SV.RefOutcome}

def ref_claim_refuses_a_foreign_revision():
  {==}

law ref_claim_refuses_a_foreign_declaration_digest:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", True{}, Sel.MBind{"m1", "rev1", "d9", "2", "definition", fx_arts(), fx_schemas()}}, fx_ref_expect()) == SV.RefForeign{"declarationDigest", "d1", "d9"} : SV.RefOutcome}

def ref_claim_refuses_a_foreign_declaration_digest():
  {==}

law ref_claim_refuses_foreign_artifact_identities:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", True{}, Sel.MBind{"m1", "rev1", "d1", "2", "definition", Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "zz", "entry"}, Decl.ArtsNil{}}, fx_schemas()}}, fx_ref_expect()) == SV.RefForeignArtifacts{"/pkg/m1.bin#aa:entry", "/pkg/m1.bin#zz:entry"} : SV.RefOutcome}

def ref_claim_refuses_foreign_artifact_identities():
  {==}

law ref_claim_refuses_foreign_schema_identities:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", True{}, Sel.MBind{"m1", "rev1", "d1", "2", "definition", fx_arts(), Eng.ss_two("ref", "evt")}}, fx_ref_expect()) == SV.RefForeignSchemas{"ref,evt,sub,opt,res", "ref,evt"} : SV.RefOutcome}

def ref_claim_refuses_foreign_schema_identities():
  {==}

law ref_claim_refuses_a_missing_association:
  {SV.ref_admit(fx_ref_claim(), SV.RefExpect{"context-refs-v2", False{}, fx_bind()}) == SV.RefUnreadable{"missing historical association"} : SV.RefOutcome}

def ref_claim_refuses_a_missing_association():
  {==}

law ref_claim_refuses_a_claim_without_a_producer:
  {SV.ref_admit(SV.RefClaim{"context-refs-v2", "r9", False{}, fx_bind_empty()}, fx_ref_expect()) == SV.RefUnreadable{"the ref claim declares no producer binding"} : SV.RefOutcome}

def ref_claim_refuses_a_claim_without_a_producer():
  {==}

# A five-member historical record is readable as an unestablished association,
# not as a qualified absence.
law ref_claim_keeps_a_legacy_record_unestablished:
  {SV.ref_admit(SV.RefClaim{"", "r9", False{}, fx_bind_empty()}, fx_ref_expect()) == SV.RefLegacyUnestablished{"r9"} : SV.RefOutcome}

def ref_claim_keeps_a_legacy_record_unestablished():
  {==}

law ref_claim_refuses_an_unknown_format:
  {SV.ref_admit(SV.RefClaim{"context-refs-v3", "r9", True{}, fx_bind()}, fx_ref_expect()) == SV.RefUnknownFormat{"context-refs-v3"} : SV.RefOutcome}

def ref_claim_refuses_an_unknown_format():
  {==}

# --- projection limits and replay requirements -------------------------------
law frame_projection_subset_is_inclusive:
  {SV.subset(Eng.ss_two("definition", "type"), Eng.ss_three("definition", "type", "calls")) == True{} : Bool}

def frame_projection_subset_is_inclusive():
  {==}

law frame_projection_subset_refuses_an_unstored_projection:
  {SV.subset(Eng.ss_two("definition", "authorization"), Eng.ss_one("definition")) == False{} : Bool}

def frame_projection_subset_refuses_an_unstored_projection():
  {==}

law frame_projection_admits_a_supported_request:
  {SV.projections_admissible(Eng.ss_one("definition"), Eng.ss_two("definition", "unused"), Eng.ss_one("definition")) == True{} : Bool}

def frame_projection_admits_a_supported_request():
  {==}

law frame_projection_refuses_a_withdrawn_current_support:
  {SV.projections_admissible(Eng.ss_two("definition", "calls"), Eng.ss_two("definition", "calls"), Eng.ss_one("definition")) == False{} : Bool}

def frame_projection_refuses_a_withdrawn_current_support():
  {==}

law frame_replay_requirement_unions_the_historical_and_current_floor:
  {SV.effective_requirements(Eng.ss_one("executeTarget"), Eng.ss_one("planTargetSql"), Eng.ss_one("replayMigrations")) == Eng.ss_three("executeTarget", "planTargetSql", "replayMigrations") : Eng.SS}

def frame_replay_requirement_unions_the_historical_and_current_floor():
  {==}

# --- compatibility is evidence, not effect-set equality ----------------------
law frame_equal_effect_sets_alone_establish_no_compatibility:
  {SV.compatibility("d1", "d2", SV.CompatEvidence{"d1", "d2", Eng.ss_empty(), Eng.ss_one("equalEffectSets")}) == SV.CompatRefused{"no admitted evidence is tied to both complete bindings"} : SV.CompatOutcome}

def frame_equal_effect_sets_alone_establish_no_compatibility():
  {==}

law frame_compatibility_admits_evidence_tied_to_both_bindings:
  {SV.compatibility("d1", "d2", SV.CompatEvidence{"d1", "d2", Eng.ss_two("d1", "d2"), Eng.ss_one("declaredSchemaIdentity")}) == SV.CompatAdmitted{Eng.ss_one("declaredSchemaIdentity")} : SV.CompatOutcome}

def frame_compatibility_admits_evidence_tied_to_both_bindings():
  {==}

law frame_compatibility_refuses_evidence_for_other_bindings:
  {SV.compatibility("d1", "d2", SV.CompatEvidence{"d1", "d2", Eng.ss_two("d3", "d4"), Eng.ss_one("declaredSchemaIdentity")}) == SV.CompatRefused{"no admitted evidence is tied to both complete bindings"} : SV.CompatOutcome}

def frame_compatibility_refuses_evidence_for_other_bindings():
  {==}

# --- canonical sequence text has no numeric bound ----------------------------
law frame_sequence_text_is_canonical_above_the_u32_domain:
  {SV.canonical_unsigned_decimal("4294967296") == True{} : Bool}

def frame_sequence_text_is_canonical_above_the_u32_domain():
  {==}

law frame_sequence_text_orders_above_the_u32_domain:
  {SV.sequence_after("4294967295", "4294967296") == True{} : Bool}

def frame_sequence_text_orders_above_the_u32_domain():
  {==}

law frame_sequence_text_rejects_a_non_digit_above_the_u32_domain:
  {SV.canonical_unsigned_decimal("4294967296x") == False{} : Bool}

def frame_sequence_text_rejects_a_non_digit_above_the_u32_domain():
  {==}
