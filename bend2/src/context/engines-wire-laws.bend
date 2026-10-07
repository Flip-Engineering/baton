# CLAIM: the operative laws of the canonical wire rendering in
# bend2/src/context/engines-wire.bend. Each law fixes the real rendered value of
# one composite, and is proved beside its claim, so every compile of an entry
# importing this module verifies it.
#
# The laws pin the member set and the member order the renderer produces, so a
# changed spelling, a dropped member or a reordered pair fails here rather than
# reaching a reader.

import Base
import ../json/canonical.bend as J
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./engines-select.bend as Sel
import ./engines-wire.bend as Wire

# --- fixtures ----------------------------------------------------------------
def fx_arts() -> Decl.Arts:
  Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, Decl.ArtsNil{}}

def fx_bind() -> Sel.MBind:
  Sel.MBind{"m1", "rev1", "d1", "2", "definition", fx_arts(),
            Eng.ss_two("res", "evt")}

def fx_step() -> Sel.Step:
  Sel.Step{fx_bind(), "sourceAnalysis", Eng.ss_one("executeTarget"),
           Decl.ExDirect{},
           Sel.StepRefsCons{Sel.StepRef{"m2", "d2", "definition"},
                            Sel.StepRefsNil{}},
           "res"}

def fx_capture() -> Sel.Capture:
  Sel.Capture{"file", "source", "/work/a.ts", "aa", "capturedSourceText", "utf8",
              "m1", "d1", "definition"}

# --- the closed vocabularies -------------------------------------------------
law wire_execution_token_for_a_runtime_operation:
  {Wire.exec_token(Decl.ExRuntime{}) == "runtime" : String}

def wire_execution_token_for_a_runtime_operation():
  {==}

law wire_execution_token_for_a_direct_operation:
  {Wire.exec_token(Decl.ExDirect{}) == "direct" : String}

def wire_execution_token_for_a_direct_operation():
  {==}

# --- identity sets and artifact identities -----------------------------------
law wire_identity_set_renders_as_an_array_of_strings:
  {Wire.ss_json(Eng.ss_two("res", "evt")) == J.Jarr{J.Jstr{"res"}, J.Jarr{J.Jstr{"evt"}, J.Jnil{}}} : J.Json}

def wire_identity_set_renders_as_an_array_of_strings():
  {==}

law wire_empty_identity_set_renders_as_an_empty_array:
  {Wire.ss_json(Eng.ss_empty()) == J.Jarr{J.Jnil{}, J.Jnil{}} : J.Json}

def wire_empty_identity_set_renders_as_an_empty_array():
  {==}

law wire_artifact_identity_renders_its_three_members:
  {Wire.art_json(Decl.Art{"/pkg/m1.bin", "aa", "entry"}) == J.Jobj{Wire.wire_obj("packagePath", J.Jstr{"/pkg/m1.bin"}, Wire.wire_obj("sha256", J.Jstr{"aa"}, Wire.wire_obj("role", J.Jstr{"entry"}, J.Jnil{})))} : J.Json}

def wire_artifact_identity_renders_its_three_members():
  {==}

# --- the frozen selected binding ---------------------------------------------
law wire_binding_renders_the_specification_members:
  {Wire.bind_json(fx_bind()) == J.Jobj{Wire.wire_obj("id", J.Jstr{"m1"}, Wire.wire_obj("revision", J.Jstr{"rev1"}, Wire.wire_obj("declarationDigest", J.Jstr{"d1"}, Wire.wire_obj("protocolVersion", J.Jstr{"2"}, Wire.wire_obj("operation", J.Jstr{"definition"}, Wire.wire_obj("artifactIdentities", Wire.arts_json(fx_arts()), Wire.wire_obj("schemaIdentities", Wire.ss_json(Eng.ss_two("res", "evt")), J.Jnil{})))))))} : J.Json}

def wire_binding_renders_the_specification_members():
  {==}

# --- the plan's steps --------------------------------------------------------
law wire_step_renders_its_binding_and_its_own_members:
  {Wire.step_json(fx_step()) == J.Jobj{Wire.wire_obj("binding", Wire.bind_json(fx_bind()), Wire.wire_obj("common", J.Jstr{"sourceAnalysis"}, Wire.wire_obj("declaredEffects", Wire.ss_json(Eng.ss_one("executeTarget")), Wire.wire_obj("execution", J.Jstr{"direct"}, Wire.wire_obj("dependencies", Wire.step_refs_json(Sel.StepRefsCons{Sel.StepRef{"m2", "d2", "definition"}, Sel.StepRefsNil{}}), Wire.wire_obj("resultSchema", J.Jstr{"res"}, J.Jnil{}))))))} : J.Json}

def wire_step_renders_its_binding_and_its_own_members():
  {==}

law wire_plan_of_one_step_renders_as_a_one_element_array:
  {Wire.steps_json(Sel.StepsCons{fx_step(), Sel.StepsNil{}}) == J.Jarr{Wire.step_json(fx_step()), J.Jnil{}} : J.Json}

def wire_plan_of_one_step_renders_as_a_one_element_array():
  {==}

# --- admitted captured records -----------------------------------------------
law wire_capture_renders_all_nine_members:
  {Wire.capture_json(fx_capture()) == J.Jobj{Wire.wire_obj("captureKind", J.Jstr{"file"}, Wire.wire_obj("role", J.Jstr{"source"}, Wire.wire_obj("path", J.Jstr{"/work/a.ts"}, Wire.wire_obj("marker", J.Jstr{"aa"}, Wire.wire_obj("payload", J.Jstr{"capturedSourceText"}, Wire.wire_obj("payloadEncoding", J.Jstr{"utf8"}, Wire.wire_obj("producerModule", J.Jstr{"m1"}, Wire.wire_obj("producerDigest", J.Jstr{"d1"}, Wire.wire_obj("producerOperation", J.Jstr{"definition"}, J.Jnil{})))))))))} : J.Json}

def wire_capture_renders_all_nine_members():
  {==}

# --- the plan identity --------------------------------------------------------
def fx_plan() -> Sel.Plan:
  Sel.Plan{fx_bind(), "sourceAnalysis",
           Sel.StepsCons{fx_step(), Sel.StepsNil{}},
           Eng.ss_one("executeTarget"), Sel.CapNil{}, True{}}

law wire_plan_identity_renders_the_frozen_members:
  {Wire.plan_identity_json(fx_plan()) == J.Jobj{Wire.wire_obj("primary", Wire.bind_json(fx_bind()), Wire.wire_obj("common", J.Jstr{"sourceAnalysis"}, Wire.wire_obj("steps", Wire.steps_json(Sel.StepsCons{fx_step(), Sel.StepsNil{}}), Wire.wire_obj("effectiveEffects", Wire.ss_json(Eng.ss_one("executeTarget")), J.Jnil{}))))} : J.Json}

def wire_plan_identity_renders_the_frozen_members():
  {==}

# The identity does not consult availability or the captured records, so two
# plans differing only in those still share one identity.
law wire_plan_identity_ignores_availability_and_captures:
  {Wire.plan_identity_json(fx_plan()) == Wire.plan_identity_json(Sel.Plan{fx_bind(), "sourceAnalysis", Sel.StepsCons{fx_step(), Sel.StepsNil{}}, Eng.ss_one("executeTarget"), Sel.CapCons{Sel.Capture{"file", "source", "/work/a.ts", "aa", "text", "utf8", "m1", "d1", "definition"}, Sel.CapNil{}}, False{}}) : J.Json}

def wire_plan_identity_ignores_availability_and_captures():
  {==}

# --- the complete value rendering --------------------------------------------
# The complete rendering carries the captured records and the observed
# availability, which the identity over the deciding members deliberately omits.
law wire_plan_value_renders_the_captures_and_availability:
  {Wire.plan_value_json(fx_plan()) == J.Jobj{Wire.wire_obj("primary", Wire.bind_json(fx_bind()), Wire.wire_obj("common", J.Jstr{"sourceAnalysis"}, Wire.wire_obj("steps", Wire.steps_json(Sel.StepsCons{fx_step(), Sel.StepsNil{}}), Wire.wire_obj("effectiveEffects", Wire.ss_json(Eng.ss_one("executeTarget")), Wire.wire_obj("inputs", Wire.captures_json(Sel.CapNil{}), Wire.wire_obj("available", J.Jtrue{}, J.Jnil{}))))))} : J.Json}

def wire_plan_value_renders_the_captures_and_availability():
  {==}

law wire_boolean_renders_as_a_json_boolean:
  {Wire.bool_json(False{}) == J.Jfalse{} : J.Json}

def wire_boolean_renders_as_a_json_boolean():
  {==}

# --- the decision conversion --------------------------------------------------
law wire_catalog_refusal_keeps_its_artifact_operand:
  {Wire.decision_outcome(Sel.AdmissionRefuses{"catalog", "missingArtifact", "declaration m1", Sel.RqCatalogRefused{"m1", Decl.DrMissingArtifact{"m1", "/pkg/m1.bin"}}}) == J.json_text(J.Jobj{Wire.wire_obj("kind", J.Jstr{"refuse"}, Wire.wire_obj("stage", J.Jstr{"catalog"}, Wire.wire_obj("code", J.Jstr{"missingArtifact"}, Wire.wire_obj("detail", J.Jstr{"declaration m1"}, Wire.wire_obj("reason", Wire.rq_reason_json(Sel.RqCatalogRefused{"m1", Decl.DrMissingArtifact{"m1", "/pkg/m1.bin"}}), J.Jnil{})))))}) : String}

def wire_catalog_refusal_keeps_its_artifact_operand():
  {==}

law wire_reason_renders_the_missing_artifact_path:
  {Wire.rq_reason_json(Sel.RqCatalogRefused{"m1", Decl.DrMissingArtifact{"m1", "/pkg/m1.bin"}}) == J.Jobj{Wire.wire_obj("family", J.Jstr{"catalog"}, Wire.wire_obj("reason", J.Jobj{Wire.wire_obj("kind", J.Jstr{"missingArtifact"}, Wire.wire_obj("moduleId", J.Jstr{"m1"}, Wire.wire_obj("path", J.Jstr{"/pkg/m1.bin"}, J.Jnil{}))}, J.Jnil{})))} : J.Json}

def wire_reason_renders_the_missing_artifact_path():
  {==}

law wire_ambiguous_selection_reason_keeps_its_candidates:
  {Wire.sel_reason_json(Sel.SelAmbiguous{Eng.ss_two("m1", "m2")}) == J.Jobj{Wire.wire_obj("kind", J.Jstr{"ambiguousSelection"}, Wire.wire_obj("candidates", Wire.ss_json(Eng.ss_two("m1", "m2")), J.Jnil{}))} : J.Json}

def wire_ambiguous_selection_reason_keeps_its_candidates():
  {==}
