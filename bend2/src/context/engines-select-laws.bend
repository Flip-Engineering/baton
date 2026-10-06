# CLAIM: the operative laws of deterministic selection, the frozen selected
# binding and the dependency plan in bend2/src/context/engines-select.bend. Each
# law fixes the real answer of the real function for one catalog, one configured
# state and one request shape, and is proved beside its claim, so every compile
# of an entry importing this module verifies it.
#
# The fixtures differ by exactly the field each law is about, and the plan laws
# spell the whole frozen value out, so a law discriminates the decision it names
# rather than a supplied verdict. No law pins a candidate count or a line number.

import Base
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./engines-select.bend as Sel

# --- fixtures ----------------------------------------------------------------
def fx_schemas() -> SS:
  Eng.union_add(Eng.ss_three("sub", "opt", "res"),
                Eng.union_add(Eng.ss_two("ref", "evt"), Eng.ss_empty()))

def fx_arts() -> Decl.Arts:
  Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"},
  Decl.ArtsCons{Decl.Art{"/pkg/m2.bin", "bb", "entry"}, Decl.ArtsNil{}}}

def fx_digs() -> Decl.Digs:
  Decl.DigsCons{Decl.Dg{"m1", "d1"},
  Decl.DigsCons{Decl.Dg{"m2", "d2"}, Decl.DigsNil{}}}

def fx_inv() -> Decl.Inv:
  Decl.Inv{fx_arts(), fx_schemas(), fx_digs()}

def fx_inv_other_digest() -> Decl.Inv:
  Decl.Inv{fx_arts(), fx_schemas(),
           Decl.DigsCons{Decl.Dg{"m1", "changed"}, Decl.DigsNil{}}}

def fx_entry(+module_id: String) -> Decl.Entry:
  Decl.ENative{Decl.Art{"/pkg/" ++ module_id ++ ".bin",
                        Decl.decl_digest_sentinel(module_id), "entry"},
               module_id ++ ".export"}

def fx_op_common(+common: String) -> Decl.Op:
  Decl.Op{"definition", common, "sub", "opt", Eng.ss_one("definition"),
          Eng.ss_empty(), Decl.ExDirect{}, "res", "ref", "evt", "",
          Decl.ModRefsNil{}}

def fx_op_with_dep(+dependency: Decl.ModRef) -> Decl.Op:
  Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
          Eng.ss_one("definition"), Eng.ss_empty(), Decl.ExDirect{}, "res",
          "ref", "evt", "", Decl.ModRefsCons{dependency, Decl.ModRefsNil{}}}

def fx_decl(+module_id: String, +artifact_digest: String) -> Decl.Decl:
  Decl.Decl{"1", module_id, "rev1", "2", "pkg-" ++ module_id,
            Decl.ENative{Decl.Art{"/pkg/" ++ module_id ++ ".bin",
                                  artifact_digest, "entry"},
                         module_id ++ ".export"},
            Decl.ArtsNil{},
            Decl.OpsCons{Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
                                 Eng.ss_one("definition"), Eng.ss_empty(),
                                 Decl.ExDirect{}, "res", "ref", "evt", "",
                                 Decl.ModRefsNil{}},
                         Decl.OpsNil{}},
            Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}}

def fx_decl_common(+module_id: String, +artifact_digest: String,
                   +common: String) -> Decl.Decl:
  Decl.Decl{"1", module_id, "rev1", "2", "pkg-" ++ module_id,
            Decl.ENative{Decl.Art{"/pkg/" ++ module_id ++ ".bin",
                                  artifact_digest, "entry"},
                         module_id ++ ".export"},
            Decl.ArtsNil{},
            Decl.OpsCons{fx_op_common(common), Decl.OpsNil{}},
            Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}}

def fx_decl_dep(+module_id: String, +artifact_digest: String,
                +dependency: Decl.ModRef) -> Decl.Decl:
  Decl.Decl{"1", module_id, "rev1", "2", "pkg-" ++ module_id,
            Decl.ENative{Decl.Art{"/pkg/" ++ module_id ++ ".bin",
                                  artifact_digest, "entry"},
                         module_id ++ ".export"},
            Decl.ArtsNil{},
            Decl.OpsCons{fx_op_with_dep(dependency), Decl.OpsNil{}},
            Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}}

def fx_cat_one() -> Decl.Cat:
  Decl.CatCons{fx_decl("m1", "aa"), Decl.CatNil{}}

def fx_cat_two() -> Decl.Cat:
  Decl.CatCons{fx_decl("m1", "aa"),
  Decl.CatCons{fx_decl("m2", "bb"), Decl.CatNil{}}}

# The configured state: both modules installed, nothing disabled or preferred,
# and no explicit selector unless a law says otherwise.
def fx_inputs() -> Sel.SelInputs:
  Sel.SelInputs{Eng.ss_one("src/handler.ts"), Eng.ss_empty(), "handler",
                Eng.ss_one("definition"), Eng.ss_two("m1", "m2"), Eng.ss_empty(),
                Eng.ss_empty(), "", "sourceAnalysis"}

def inputs_at(+explicit: String, +common: String, +disabled: SS,
              +preferred: SS, +installed: SS, +subject: String) -> Sel.SelInputs:
  Sel.SelInputs{Eng.ss_one("src/handler.ts"), Eng.ss_empty(), subject,
                Eng.ss_one("definition"), installed, disabled, preferred,
                explicit, common}

# --- candidates --------------------------------------------------------------
def fx_cand(+module_id: String, +digest: String, +preferred: Bool,
            +available: Bool) -> Sel.Cand:
  Sel.Cand{module_id, digest, "definition", "sourceAnalysis", Eng.ss_empty(),
           Decl.ExDirect{}, available, preferred}

law selection_auto_chooses_the_only_candidate:
  {Sel.select(fx_cat_one(), fx_inputs(), fx_inv()) == Sel.SelChosen{Eng.ss_one("m1"), fx_cand("m1", "d1", False{}, True{})} : Sel.SelOutcome}

def selection_auto_chooses_the_only_candidate():
  {==}

law selection_auto_selects_from_differing_declaration_data:
  {Sel.select(fx_cat_two(), fx_inputs(), fx_inv()) == Sel.SelRefused{Sel.SelAmbiguous{Eng.ss_two("m1", "m2")}} : Sel.SelOutcome}

def selection_auto_selects_from_differing_declaration_data():
  {==}

law selection_auto_applies_the_configured_preference:
  {Sel.select(fx_cat_two(), inputs_at("", "sourceAnalysis", Eng.ss_empty(), Eng.ss_one("m1"), Eng.ss_two("m1", "m2"), "handler"), fx_inv()) == Sel.SelChosen{Eng.ss_one("m1"), fx_cand("m1", "d1", True{}, True{})} : Sel.SelOutcome}

def selection_auto_applies_the_configured_preference():
  {==}

law selection_auto_refuses_two_preferred_candidates:
  {Sel.select(fx_cat_two(), inputs_at("", "sourceAnalysis", Eng.ss_empty(), Eng.ss_two("m1", "m2"), Eng.ss_two("m1", "m2"), "handler"), fx_inv()) == Sel.SelRefused{Sel.SelAmbiguous{Eng.ss_two("m1", "m2")}} : Sel.SelOutcome}

def selection_auto_refuses_two_preferred_candidates():
  {==}

# A preferred module whose bytes are absent remains the chosen binding; the
# installed module beside it is not substituted for it.
law selection_auto_preserves_an_unavailable_chosen_binding:
  {Sel.select(fx_cat_two(), inputs_at("", "sourceAnalysis", Eng.ss_empty(), Eng.ss_one("m1"), Eng.ss_one("m2"), "handler"), fx_inv()) == Sel.SelChosen{Eng.ss_one("m1"), fx_cand("m1", "d1", True{}, False{})} : Sel.SelOutcome}

def selection_auto_preserves_an_unavailable_chosen_binding():
  {==}

law selection_auto_excludes_a_disabled_candidate:
  {Sel.select(fx_cat_one(), inputs_at("", "sourceAnalysis", Eng.ss_one("m1"), Eng.ss_empty(), Eng.ss_one("m1"), "handler"), fx_inv()) == Sel.SelRefused{Sel.SelNoCandidate{"handler"}} : Sel.SelOutcome}

def selection_auto_excludes_a_disabled_candidate():
  {==}

law selection_auto_refuses_an_inapplicable_candidate:
  {Sel.select(fx_cat_one(), inputs_at("", "sourceAnalysis", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_one("m1"), "symbol"), fx_inv()) == Sel.SelRefused{Sel.SelNoCandidate{"symbol"}} : Sel.SelOutcome}

def selection_auto_refuses_an_inapplicable_candidate():
  {==}

law selection_refuses_an_unknown_common_operation:
  {Sel.select(fx_cat_one(), inputs_at("", "notACommonOperation", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_one("m1"), "handler"), fx_inv()) == Sel.SelRefused{Sel.SelUnknownCommonOperation{"notACommonOperation"}} : Sel.SelOutcome}

def selection_refuses_an_unknown_common_operation():
  {==}

# --- explicit selection ------------------------------------------------------
law selection_explicit_chooses_the_named_module:
  {Sel.select(fx_cat_two(), inputs_at("m2", "sourceAnalysis", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_two("m1", "m2"), "handler"), fx_inv()) == Sel.SelChosen{Eng.ss_one("m2"), fx_cand("m2", "d2", False{}, True{})} : Sel.SelOutcome}

def selection_explicit_chooses_the_named_module():
  {==}

law selection_explicit_refuses_an_unknown_module:
  {Sel.select(fx_cat_one(), inputs_at("m9", "sourceAnalysis", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_one("m1"), "handler"), fx_inv()) == Sel.SelRefused{Sel.SelExplicitUnknown{"m9"}} : Sel.SelOutcome}

def selection_explicit_refuses_an_unknown_module():
  {==}

law selection_explicit_refuses_a_disabled_module:
  {Sel.select(fx_cat_one(), inputs_at("m1", "sourceAnalysis", Eng.ss_one("m1"), Eng.ss_empty(), Eng.ss_one("m1"), "handler"), fx_inv()) == Sel.SelRefused{Sel.SelExplicitDisabled{"m1"}} : Sel.SelOutcome}

def selection_explicit_refuses_a_disabled_module():
  {==}

law selection_explicit_refuses_an_incompatible_module:
  {Sel.select(fx_cat_one(), inputs_at("m1", "sourceAnalysis", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_one("m1"), "symbol"), fx_inv()) == Sel.SelRefused{Sel.SelExplicitIncompatible{"m1"}} : Sel.SelOutcome}

def selection_explicit_refuses_an_incompatible_module():
  {==}

law selection_explicit_refuses_a_module_without_the_operation:
  {Sel.select(fx_cat_one(), inputs_at("m1", "sqlPlan", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_one("m1"), "handler"), fx_inv()) == Sel.SelRefused{Sel.SelExplicitWrongOperation{"m1", "sqlPlan"}} : Sel.SelOutcome}

def selection_explicit_refuses_a_module_without_the_operation():
  {==}

# --- the frozen binding ------------------------------------------------------
def fx_bind() -> Sel.MBind:
  Sel.MBind{"m1", "rev1", "d1", "2", "definition",
            Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, Decl.ArtsNil{}},
            Decl.op_schema_set(fx_op_common("sourceAnalysis"))}

def fx_capture() -> Sel.Capture:
  Sel.Capture{"file", "source", "/work/a.ts", "aa", "capturedSourceText", "utf8",
              "m1", "d1", "definition"}

def fx_captures() -> Sel.Captures:
  Sel.CapCons{fx_capture(), Sel.CapNil{}}

def fx_step() -> Sel.Step:
  Sel.Step{fx_bind(), "sourceAnalysis", Eng.ss_empty(), Decl.ExDirect{},
           Sel.StepRefsNil{}, "res"}

def fx_plan() -> Sel.Plan:
  Sel.Plan{fx_bind(), "sourceAnalysis", Sel.StepsCons{fx_step(), Sel.StepsNil{}},
           Eng.ss_empty(), fx_captures(), True{}}

law selection_frozen_plan_names_the_binding_and_the_inputs:
  {Sel.freeze(fx_cat_one(), fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanFrozen{fx_plan()} : Sel.PlanOutcome}

def selection_frozen_plan_names_the_binding_and_the_inputs():
  {==}

# The plan is frozen even when the selected bytes are absent, and it records
# that fact instead of selecting another implementation.
law selection_frozen_plan_records_an_unavailable_binding:
  {Sel.freeze(fx_cat_one(), fx_cand("m1", "d1", False{}, False{}), fx_inv(), fx_captures()) == Sel.PlanFrozen{Sel.Plan{fx_bind(), "sourceAnalysis", Sel.StepsCons{fx_step(), Sel.StepsNil{}}, Eng.ss_empty(), fx_captures(), False{}}} : Sel.PlanOutcome}

def selection_frozen_plan_records_an_unavailable_binding():
  {==}

# The same module name at a different declaration digest is a changed module:
# the plan refuses rather than serving the new bytes under the old identity.
law selection_freeze_refuses_a_changed_declaration:
  {Sel.freeze(fx_cat_one(), fx_cand("m1", "d1", False{}, True{}), fx_inv_other_digest(), fx_captures()) == Sel.PlanRefused{Sel.PlanStaleSelection{"m1"}} : Sel.PlanOutcome}

def selection_freeze_refuses_a_changed_declaration():
  {==}

law selection_freeze_refuses_a_missing_operation:
  {Sel.freeze(fx_cat_one(), Sel.Cand{"m1", "d1", "absentOperation", "sourceAnalysis", Eng.ss_empty(), Decl.ExDirect{}, True{}, False{}}, fx_inv(), fx_captures()) == Sel.PlanRefused{Sel.PlanMissingOperation{"m1", "absentOperation"}} : Sel.PlanOutcome}

def selection_freeze_refuses_a_missing_operation():
  {==}

# --- the effect floor --------------------------------------------------------
# The declared addition is empty and the common operation's mandatory minimum is
# not, so the plan's effective requirement is the minimum: an operation cannot
# erase it by declaring an empty effect set.
def fx_cat_sql_plan() -> Decl.Cat:
  Decl.CatCons{fx_decl_common("m1", "aa", "sqlPlan"), Decl.CatNil{}}

def fx_bind_sql_plan() -> Sel.MBind:
  Sel.MBind{"m1", "rev1", "d1", "2", "definition",
            Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, Decl.ArtsNil{}},
            Decl.op_schema_set(fx_op_common("sqlPlan"))}

law selection_plan_carries_the_common_operation_minimum:
  {Sel.freeze(fx_cat_sql_plan(), fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanFrozen{Sel.Plan{fx_bind_sql_plan(), "sqlPlan", Sel.StepsCons{Sel.Step{fx_bind_sql_plan(), "sqlPlan", Eng.ss_empty(), Decl.ExDirect{}, Sel.StepRefsNil{}, "res"}, Sel.StepsNil{}}, Eng.ss_one("planTargetSql"), fx_captures(), True{}}} : Sel.PlanOutcome}

def selection_plan_carries_the_common_operation_minimum():
  {==}

def fx_decl_with_effects_op(+common: String, +effects: SS) -> Decl.Op:
  Decl.Op{"definition", common, "sub", "opt", Eng.ss_one("definition"),
          effects, Decl.ExDirect{}, "res", "ref", "evt", "",
          Decl.ModRefsNil{}}

def fx_decl_with_effects(+module_id: String, +artifact_digest: String,
                         +common: String, +effects: SS) -> Decl.Decl:
  Decl.Decl{"1", module_id, "rev1", "2", "pkg-" ++ module_id,
            Decl.ENative{Decl.Art{"/pkg/" ++ module_id ++ ".bin",
                                  artifact_digest, "entry"},
                         module_id ++ ".export"},
            Decl.ArtsNil{},
            Decl.OpsCons{fx_decl_with_effects_op(common, effects), Decl.OpsNil{}},
            Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}}

# A declared addition beyond the minimum is carried beside it.
law selection_plan_unions_a_declared_addition:
  {Sel.freeze(Decl.CatCons{fx_decl_with_effects("m1", "aa", "sqlPlan", Eng.ss_one("executeTarget")), Decl.CatNil{}}, fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanFrozen{Sel.Plan{Sel.MBind{"m1", "rev1", "d1", "2", "definition", Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, Decl.ArtsNil{}}, Decl.op_schema_set(fx_decl_with_effects_op("sqlPlan", Eng.ss_one("executeTarget")))}, "sqlPlan", Sel.StepsCons{Sel.Step{Sel.MBind{"m1", "rev1", "d1", "2", "definition", Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, Decl.ArtsNil{}}, Decl.op_schema_set(fx_decl_with_effects_op("sqlPlan", Eng.ss_one("executeTarget")))}, "sqlPlan", Eng.ss_one("executeTarget"), Decl.ExDirect{}, Sel.StepRefsNil{}, "res"}, Sel.StepsNil{}}, Eng.ss_two("planTargetSql", "executeTarget"), fx_captures(), True{}}} : Sel.PlanOutcome}

def selection_plan_unions_a_declared_addition():
  {==}

# --- dependency edges and cycles ---------------------------------------------
law selection_plan_refuses_an_unresolved_dependency:
  {Sel.freeze(Decl.CatCons{fx_decl_dep("m1", "aa", Decl.ModRef{"m3", "d3", "definition"}), Decl.CatNil{}}, fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanRefused{Sel.PlanDependencyUnresolved{"m3", "definition"}} : Sel.PlanOutcome}

def selection_plan_refuses_an_unresolved_dependency():
  {==}

law selection_plan_refuses_a_mismatched_dependency_digest:
  {Sel.freeze(Decl.CatCons{fx_decl_dep("m1", "aa", Decl.ModRef{"m2", "wrong", "definition"}), Decl.CatNil{}}, fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanRefused{Sel.PlanDependencyDigestMismatch{"m2", "wrong", "d2"}} : Sel.PlanOutcome}

def selection_plan_refuses_a_mismatched_dependency_digest():
  {==}

# A dependency edge to the step that reached it is a cycle.
law selection_plan_refuses_a_cycle:
  {Sel.freeze(Decl.CatCons{fx_decl_dep("m1", "aa", Decl.ModRef{"m1", "d1", "definition"}), Decl.CatNil{}}, fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanRefused{Sel.PlanCycle{"m1"}} : Sel.PlanOutcome}

def selection_plan_refuses_a_cycle():
  {==}

# An explicit selector resolves the one-query ambiguity that auto reports.
law selection_explicit_resolves_the_one_query_ambiguity:
  {Sel.select(fx_cat_two(), inputs_at("m1", "sourceAnalysis", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_two("m1", "m2"), "handler"), fx_inv()) == Sel.SelChosen{Eng.ss_one("m1"), fx_cand("m1", "d1", False{}, True{})} : Sel.SelOutcome}

def selection_explicit_resolves_the_one_query_ambiguity():
  {==}

# The invocation carries the frozen binding, the admitted input identities and
# the effective requirement, with both role and incarnation empty for a direct
# invocation.
law selection_invocation_carries_the_binding_and_inputs:
  {Sel.invocation_of(fx_plan(), "q7", "owner-1", "requestText", "", "") == Sel.Invocation{"2", "q7", "owner-1", fx_bind(), "requestText", Sel.StepsCons{fx_step(), Sel.StepsNil{}}, fx_captures(), "", ""} : Sel.Invocation}

def selection_invocation_carries_the_binding_and_inputs():
  {==}

# --- producing steps ---------------------------------------------------------
def fx_cat_chain() -> Decl.Cat:
  Decl.CatCons{fx_decl_dep("m1", "aa", Decl.ModRef{"m2", "d2", "definition"}),
  Decl.CatCons{fx_decl("m2", "bb"), Decl.CatNil{}}}

def fx_bind_m2() -> Sel.MBind:
  Sel.MBind{"m2", "rev1", "d2", "2", "definition",
            Decl.ArtsCons{Decl.Art{"/pkg/m2.bin", "bb", "entry"}, Decl.ArtsNil{}},
            Decl.op_schema_set(fx_op_common("sourceAnalysis"))}

def fx_step_m1() -> Sel.Step:
  Sel.Step{fx_bind(), "sourceAnalysis", Eng.ss_empty(), Decl.ExDirect{},
           Sel.StepRefsCons{Sel.StepRef{"m2", "d2", "definition"},
                            Sel.StepRefsNil{}}, "res"}

def fx_step_m2() -> Sel.Step:
  Sel.Step{fx_bind_m2(), "sourceAnalysis", Eng.ss_empty(), Decl.ExDirect{},
           Sel.StepRefsNil{}, "res"}

def fx_plan_chain() -> Sel.Plan:
  Sel.Plan{fx_bind(), "sourceAnalysis",
           Sel.StepsCons{fx_step_m1(),
                         Sel.StepsCons{fx_step_m2(), Sel.StepsNil{}}},
           Eng.ss_empty(), fx_captures(), True{}}

law selection_plan_holds_the_primary_and_the_dependency_step:
  {Sel.freeze(fx_cat_chain(), fx_cand("m1", "d1", False{}, True{}), fx_inv(), fx_captures()) == Sel.PlanFrozen{fx_plan_chain()} : Sel.PlanOutcome}

def selection_plan_holds_the_primary_and_the_dependency_step():
  {==}

# The dependency invocation carries the dependency step's own binding, so a
# callback into the catalog module cannot report the primary producer.
law selection_dependency_invocation_names_the_dependency_step:
  {Sel.invocation_for_step(fx_plan_chain(), "m2", "d2", "definition", "q7", "owner-1", "requestText", "", "") == Sel.InvocationBound{Sel.Invocation{"2", "q7", "owner-1", fx_bind_m2(), "requestText", Sel.StepsCons{fx_step_m1(), Sel.StepsCons{fx_step_m2(), Sel.StepsNil{}}}, fx_captures(), "", ""}} : Sel.InvocationOutcome}

def selection_dependency_invocation_names_the_dependency_step():
  {==}

law selection_primary_invocation_names_the_primary_step:
  {Sel.invocation_for_step(fx_plan_chain(), "m1", "d1", "definition", "q7", "owner-1", "requestText", "", "") == Sel.InvocationBound{Sel.Invocation{"2", "q7", "owner-1", fx_bind(), "requestText", Sel.StepsCons{fx_step_m1(), Sel.StepsCons{fx_step_m2(), Sel.StepsNil{}}}, fx_captures(), "", ""}} : Sel.InvocationOutcome}

def selection_primary_invocation_names_the_primary_step():
  {==}

law selection_invocation_for_an_absent_step_is_named:
  {Sel.invocation_for_step(fx_plan_chain(), "m3", "d3", "definition", "q7", "owner-1", "requestText", "", "") == Sel.InvocationMissing{"m3", "d3", "definition"} : Sel.InvocationOutcome}

def selection_invocation_for_an_absent_step_is_named():
  {==}

# A matching module name at another declaration digest is not that step.
law selection_invocation_for_a_foreign_digest_is_named:
  {Sel.invocation_for_step(fx_plan_chain(), "m2", "d9", "definition", "q7", "owner-1", "requestText", "", "") == Sel.InvocationMissing{"m2", "d9", "definition"} : Sel.InvocationOutcome}

def selection_invocation_for_a_foreign_digest_is_named():
  {==}

# --- passive discovery -------------------------------------------------------
law selection_discovery_reports_an_admitted_present_module:
  {Sel.discovery(fx_cat_one(), fx_inv(), Eng.ss_one("m1")) == Sel.DscCons{Sel.Discovery{"m1", Sel.DsAdmitted{"d1"}}, Sel.DscNil{}} : Sel.Discoveries}

def selection_discovery_reports_an_admitted_present_module():
  {==}

law selection_discovery_reports_an_absent_module_as_unavailable:
  {Sel.discovery(fx_cat_one(), fx_inv(), Eng.ss_empty()) == Sel.DscCons{Sel.Discovery{"m1", Sel.DsUnavailable{"d1"}}, Sel.DscNil{}} : Sel.Discoveries}

def selection_discovery_reports_an_absent_module_as_unavailable():
  {==}

def fx_decl_protocol(+v: String) -> Decl.Decl:
  Decl.Decl{"1", "m1", "rev1", v, "pkg-m1",
            Decl.ENative{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, "m1.export"},
            Decl.ArtsNil{},
            Decl.OpsCons{Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
                                 Eng.ss_one("definition"), Eng.ss_empty(),
                                 Decl.ExDirect{}, "res", "ref", "evt", "",
                                 Decl.ModRefsNil{}},
                         Decl.OpsNil{}},
            Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}}

law selection_discovery_reports_a_refused_declaration:
  {Sel.discovery(Decl.CatCons{fx_decl_protocol("1"), Decl.CatNil{}}, fx_inv(), Eng.ss_one("m1")) == Sel.DscCons{Sel.Discovery{"m1", Sel.DsRefused{Decl.DrUnsupportedProtocolVersion{"1"}}}, Sel.DscNil{}} : Sel.Discoveries}

def selection_discovery_reports_a_refused_declaration():
  {==}

# --- the admission and preparation consumer ----------------------------------
law selection_request_verdict_admits_a_valid_request:
  {Sel.request_verdict(fx_cat_one(), fx_inputs(), fx_inv(), fx_captures()) == Sel.VerdictAdmitted{fx_plan(), "res"} : Sel.Verdict}

def selection_request_verdict_admits_a_valid_request():
  {==}

law selection_request_verdict_names_the_catalog_stage:
  {Sel.request_verdict(Decl.CatCons{fx_decl_protocol("1"), Decl.CatNil{}}, fx_inputs(), fx_inv(), fx_captures()) == Sel.VerdictRefused{"catalog", Sel.RqCatalogRefused{"m1", Decl.DrUnsupportedProtocolVersion{"1"}}} : Sel.Verdict}

def selection_request_verdict_names_the_catalog_stage():
  {==}

law selection_request_verdict_names_the_selection_stage:
  {Sel.request_verdict(fx_cat_one(), inputs_at("", "sqlPlan", Eng.ss_empty(), Eng.ss_empty(), Eng.ss_one("m1"), "handler"), fx_inv(), fx_captures()) == Sel.VerdictRefused{"selection", Sel.RqSelectionRefused{Sel.SelNoCandidate{"handler"}}} : Sel.Verdict}

def selection_request_verdict_names_the_selection_stage():
  {==}

law selection_request_verdict_names_the_plan_stage:
  {Sel.request_verdict(Decl.CatCons{fx_decl_dep("m1", "aa", Decl.ModRef{"m1", "d1", "definition"}), Decl.CatNil{}}, fx_inputs(), fx_inv(), fx_captures()) == Sel.VerdictRefused{"plan", Sel.RqPlanRefused{Sel.PlanCycle{"m1"}}} : Sel.Verdict}

def selection_request_verdict_names_the_plan_stage():
  {==}

# --- capture attribution -----------------------------------------------------
law selection_captures_attribute_to_their_producing_step:
  {Sel.captures_of_step(fx_captures(), fx_step()) == fx_captures() : Sel.Captures}

def selection_captures_attribute_to_their_producing_step():
  {==}

law selection_captures_of_another_step_are_not_attributed:
  {Sel.captures_of_step(fx_captures(), fx_step_m2()) == Sel.CapNil{} : Sel.Captures}

def selection_captures_of_another_step_are_not_attributed():
  {==}

# --- discovery consumes the traversal -----------------------------------------
def fx_decl_package(+module_id: String, +artifact_digest: String,
                    +package_identity: String) -> Decl.Decl:
  Decl.Decl{"1", module_id, "rev1", "2", package_identity,
            Decl.ENative{Decl.Art{"/pkg/" ++ module_id ++ ".bin",
                                  artifact_digest, "entry"},
                         module_id ++ ".export"},
            Decl.ArtsNil{},
            Decl.OpsCons{Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
                                 Eng.ss_one("definition"), Eng.ss_empty(),
                                 Decl.ExDirect{}, "res", "ref", "evt", "",
                                 Decl.ModRefsNil{}},
                         Decl.OpsNil{}},
            Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}}

def fx_cat_pair() -> Decl.Cat:
  Decl.CatCons{fx_decl("m1", "aa"),
  Decl.CatCons{fx_decl_dep("m2", "bb", Decl.ModRef{"m1", "d1", "definition"}),
               Decl.CatNil{}}}

def fx_cat_conflicting() -> Decl.Cat:
  Decl.CatCons{fx_decl("m1", "aa"),
  Decl.CatCons{fx_decl_package("m1", "aa", "pkg-other"), Decl.CatNil{}}}

# The walk visits every declaration and admits the second one even though it
# depends on the first, which the walking list alone no longer holds.
law selection_discovery_walks_a_multi_entry_catalog:
  {Sel.discovery(fx_cat_pair(), fx_inv(), Eng.ss_two("m1", "m2")) == Sel.DscCons{Sel.Discovery{"m1", Sel.DsAdmitted{"d1"}}, Sel.DscCons{Sel.Discovery{"m2", Sel.DsAdmitted{"d2"}}, Sel.DscNil{}}} : Sel.Discoveries}

def selection_discovery_walks_a_multi_entry_catalog():
  {==}

# Every entry is admitted against the whole candidate set: with the context
# dropped, the second declaration would see only its own tail and admit, so this
# law fails if the walk stops carrying the full set.
law selection_discovery_admits_every_entry_against_the_whole_set:
  {Sel.discovery(fx_cat_conflicting(), fx_inv(), Eng.ss_one("m1")) == Sel.DscCons{Sel.Discovery{"m1", Sel.DsRefused{Decl.DrConflictingId{"m1", "pkg-m1"}}}, Sel.DscCons{Sel.Discovery{"m1", Sel.DsRefused{Decl.DrConflictingId{"m1", "pkg-other"}}}, Sel.DscNil{}}} : Sel.Discoveries}

def selection_discovery_admits_every_entry_against_the_whole_set():
  {==}

# --- capture identity in snapshot's vocabulary -------------------------------
law selection_capture_maps_to_a_file_identity:
  {Sel.capture_fp(fx_capture()) == Sel.FcMapped{Snap.FpFile{"source", "/work/a.ts", "aa"}} : Sel.FcState}

def selection_capture_maps_to_a_file_identity():
  {==}

law selection_capture_maps_to_an_absent_identity:
  {Sel.capture_fp(Sel.Capture{"absent", "source", "/work/missing.ts", "absent", "", "", "m1", "d1", "definition"}) == Sel.FcMapped{Snap.FpAbsent{"source", "/work/missing.ts"}} : Sel.FcState}

def selection_capture_maps_to_an_absent_identity():
  {==}

law selection_capture_of_an_unknown_kind_is_named:
  {Sel.capture_fp(Sel.Capture{"symlink", "source", "/work/a.ts", "aa", "", "", "m1", "d1", "definition"}) == Sel.FcUnknownKind{"symlink"} : Sel.FcState}

def selection_capture_of_an_unknown_kind_is_named():
  {==}

law selection_capture_records_its_payload_encoding:
  {Sel.cap_encoding(fx_capture()) == "utf8" : String}

def selection_capture_records_its_payload_encoding():
  {==}
