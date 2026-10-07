# CLAIM: the operative laws of the declaration and catalog admission in
# bend2/src/context/engines-decl.bend. Each law fixes the actual answer of the
# real function for one supplied declaration and inventory, and is proved beside
# its claim, so every compile of an entry importing this module verifies it.
#
# The fixtures are deliberately small: one module, one operation, one artifact
# and one schema set, changed by exactly the field each law is about. A law
# therefore discriminates the admission decision it names rather than a supplied
# verdict, and no law pins an inventory count or a line number.

import Base
import ./engines.bend as Eng
import ./engines-decl.bend as Decl

# --- fixtures ----------------------------------------------------------------
def fx_schemas() -> Eng.SS:
  Eng.union_add(Eng.ss_three("sub", "opt", "res"),
                Eng.union_add(Eng.ss_two("ref", "evt"), Eng.ss_empty()))

def fx_arts() -> Decl.Arts:
  Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "aa", "entry"},
  Decl.ArtsCons{Decl.Art{"/pkg/dep.bin", "bb", "dependency"}, Decl.ArtsNil{}}}

def fx_digs() -> Decl.Digs:
  Decl.DigsCons{Decl.Dg{"m1", "d1"},
  Decl.DigsCons{Decl.Dg{"m2", "d2"}, Decl.DigsNil{}}}

def fx_inv() -> Decl.Inv:
  Decl.Inv{fx_arts(), fx_schemas(), fx_digs()}

def fx_inv_no_m1_digest() -> Decl.Inv:
  Decl.Inv{fx_arts(), fx_schemas(),
           Decl.DigsCons{Decl.Dg{"m2", "d2"}, Decl.DigsNil{}}}

def fx_inv_no_artifact() -> Decl.Inv:
  Decl.Inv{Decl.ArtsNil{}, fx_schemas(), fx_digs()}

def fx_inv_other_digest() -> Decl.Inv:
  Decl.Inv{Decl.ArtsCons{Decl.Art{"/pkg/m1.bin", "zz", "entry"}, Decl.ArtsNil{}},
           fx_schemas(), fx_digs()}

def fx_inv_no_result_schema() -> Decl.Inv:
  Decl.Inv{fx_arts(),
           Eng.union_add(Eng.ss_two("sub", "opt"),
                         Eng.union_add(Eng.ss_two("ref", "evt"), Eng.ss_empty())),
           fx_digs()}

def fx_entry() -> Decl.Entry:
  Decl.ENative{Decl.Art{"/pkg/m1.bin", "aa", "entry"}, "m1.export"}

def fx_op() -> Decl.Op:
  Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
          Eng.ss_one("definition"), Eng.ss_empty(), Decl.ExDirect{}, "res",
          "ref", "evt", "", Decl.ModRefsNil{}}

def fx_ops() -> Decl.Ops:
  Decl.OpsCons{fx_op(), Decl.OpsNil{}}

def fx_rules() -> Decl.Rules:
  Decl.RulesCons{Decl.RSubject{"handler"}, Decl.RulesNil{}}

def fx_decl() -> Decl.Decl:
  Decl.Decl{"1", "m1", "rev1", "2", "pkg-m1", fx_entry(), Decl.ArtsNil{},
            fx_ops(), fx_rules()}

def fx_cat() -> Decl.Cat:
  Decl.CatCons{fx_decl(), Decl.CatNil{}}

# --- the admitted declaration ------------------------------------------------
law decl_admits_the_reference_declaration:
  {Decl.admit_declaration(fx_decl(), fx_cat(), fx_inv()) == Decl.DeclAdmitted{fx_decl(), "d1"} : Decl.DeclOutcome}

def decl_admits_the_reference_declaration():
  {==}

law decl_admits_the_reference_catalog:
  {Decl.admit_catalog(fx_cat(), fx_inv()) == Decl.CatAdmitted{fx_cat()} : Decl.CatOutcome}

def decl_admits_the_reference_catalog():
  {==}

law decl_module_id_reads_the_declaration:
  {Decl.decl_module_id(fx_decl()) == "m1" : String}

def decl_module_id_reads_the_declaration():
  {==}

# --- unsupported versions ----------------------------------------------------
def fx_decl_at_version(+v: String) -> Decl.Decl:
  Decl.Decl{v, "m1", "rev1", "2", "pkg-m1", fx_entry(), Decl.ArtsNil{}, fx_ops(),
            fx_rules()}

def fx_decl_at_protocol(+v: String) -> Decl.Decl:
  Decl.Decl{"1", "m1", "rev1", v, "pkg-m1", fx_entry(), Decl.ArtsNil{}, fx_ops(),
            fx_rules()}

law decl_refuses_an_unsupported_declaration_version:
  {Decl.admit_declaration(fx_decl_at_version("9"), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrUnsupportedDeclarationVersion{"9"}} : Decl.DeclOutcome}

def decl_refuses_an_unsupported_declaration_version():
  {==}

law decl_refuses_the_historical_protocol_version:
  {Decl.admit_declaration(fx_decl_at_protocol("1"), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrUnsupportedProtocolVersion{"1"}} : Decl.DeclOutcome}

def decl_refuses_the_historical_protocol_version():
  {==}

# --- identifiers -------------------------------------------------------------
def fx_decl_at_module(+m: String) -> Decl.Decl:
  Decl.Decl{"1", m, "rev1", "2", "pkg-" ++ m, fx_entry(), Decl.ArtsNil{},
            fx_ops(), fx_rules()}

def fx_decl_at_package(+p: String) -> Decl.Decl:
  Decl.Decl{"1", "m1", "rev1", "2", p, fx_entry(), Decl.ArtsNil{}, fx_ops(),
            fx_rules()}

law decl_refuses_an_empty_module_id:
  {Decl.admit_declaration(fx_decl_at_module(""), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrEmptyId{"module"}} : Decl.DeclOutcome}

def decl_refuses_an_empty_module_id():
  {==}

# The candidate set holds the same id under a different package identity, so the
# declaration is refused before its artifacts or schemas are read.
law decl_refuses_a_conflicting_id:
  {Decl.admit_declaration(fx_decl(), Decl.CatCons{fx_decl_at_package("other"), Decl.CatNil{}}, fx_inv()) == Decl.DeclRefused{Decl.DrConflictingId{"m1", "pkg-m1"}} : Decl.DeclOutcome}

def decl_refuses_a_conflicting_id():
  {==}

# The same id under the same package identity and revision is the declaration
# itself, which is not a conflict.
law decl_admits_a_repeated_identical_id:
  {Decl.admit_declaration(fx_decl(), Decl.CatCons{fx_decl(), Decl.CatNil{}}, fx_inv()) == Decl.DeclAdmitted{fx_decl(), "d1"} : Decl.DeclOutcome}

def decl_admits_a_repeated_identical_id():
  {==}

# --- inventory identities ----------------------------------------------------
law decl_refuses_a_missing_declaration_digest:
  {Decl.admit_declaration(fx_decl(), fx_cat(), fx_inv_no_m1_digest()) == Decl.DeclRefused{Decl.DrMissingDeclarationDigest{"m1"}} : Decl.DeclOutcome}

def decl_refuses_a_missing_declaration_digest():
  {==}

law decl_refuses_a_missing_entry_artifact:
  {Decl.admit_declaration(fx_decl(), fx_cat(), fx_inv_no_artifact()) == Decl.DeclRefused{Decl.DrMissingArtifact{"m1", "/pkg/m1.bin"}} : Decl.DeclOutcome}

def decl_refuses_a_missing_entry_artifact():
  {==}

law decl_refuses_a_mismatched_entry_artifact:
  {Decl.admit_declaration(fx_decl(), fx_cat(), fx_inv_other_digest()) == Decl.DeclRefused{Decl.DrArtifactMismatch{"m1", "/pkg/m1.bin", "aa", "zz"}} : Decl.DeclOutcome}

def decl_refuses_a_mismatched_entry_artifact():
  {==}

law decl_refuses_a_schema_the_inventory_does_not_admit:
  {Decl.admit_declaration(fx_decl(), fx_cat(), fx_inv_no_result_schema()) == Decl.DeclRefused{Decl.DrMissingSchema{"m1", "definition", "res"}} : Decl.DeclOutcome}

def decl_refuses_a_schema_the_inventory_does_not_admit():
  {==}

# --- declared operations -----------------------------------------------------
def fx_op_common(+common: String) -> Decl.Op:
  Decl.Op{"definition", common, "sub", "opt", Eng.ss_one("definition"),
          Eng.ss_empty(), Decl.ExDirect{}, "res", "ref", "evt", "",
          Decl.ModRefsNil{}}

def fx_op_effects(+effects: Eng.SS) -> Decl.Op:
  Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
          Eng.ss_one("definition"), effects, Decl.ExDirect{}, "res", "ref",
          "evt", "", Decl.ModRefsNil{}}

def fx_op_execution(+execution: Decl.Exec, +profile: String) -> Decl.Op:
  Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
          Eng.ss_one("definition"), Eng.ss_empty(), execution, "res", "ref",
          "evt", profile, Decl.ModRefsNil{}}

def fx_op_dep(+dependency: Decl.ModRef) -> Decl.Op:
  Decl.Op{"definition", "sourceAnalysis", "sub", "opt",
          Eng.ss_one("definition"), Eng.ss_empty(), Decl.ExDirect{}, "res",
          "ref", "evt", "", Decl.ModRefsCons{dependency, Decl.ModRefsNil{}}}

def fx_decl_with_ops(+ops: Decl.Ops) -> Decl.Decl:
  Decl.Decl{"1", "m1", "rev1", "2", "pkg-m1", fx_entry(), Decl.ArtsNil{}, ops,
            fx_rules()}

law decl_refuses_a_duplicate_operation:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op(), Decl.OpsCons{fx_op(), Decl.OpsNil{}}}), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrDuplicateOperation{"m1", "definition"}} : Decl.DeclOutcome}

def decl_refuses_a_duplicate_operation():
  {==}

law decl_refuses_an_unknown_common_operation:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_common("notACommonOperation"), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrUnknownCommonOperation{"m1", "definition", "notACommonOperation"}} : Decl.DeclOutcome}

def decl_refuses_an_unknown_common_operation():
  {==}

# An effect name no admitted operation requires has no admitted meaning, so it
# goes to common-contract review rather than to a silent admission.
law decl_refuses_an_effect_with_no_admitted_meaning:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_effects(Eng.ss_one("installProvider")), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrEffectRequiresReview{"m1", "definition", "installProvider"}} : Decl.DeclOutcome}

def decl_refuses_an_effect_with_no_admitted_meaning():
  {==}

law decl_admits_an_effect_the_closed_operation_set_requires:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_effects(Eng.ss_one("executeTarget")), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclAdmitted{fx_decl_with_ops(Decl.OpsCons{fx_op_effects(Eng.ss_one("executeTarget")), Decl.OpsNil{}}), "d1"} : Decl.DeclOutcome}

def decl_admits_an_effect_the_closed_operation_set_requires():
  {==}

law decl_refuses_a_runtime_operation_without_a_lifetime_profile:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_execution(Decl.ExRuntime{}, ""), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrMissingLifetimeProfile{"m1", "definition"}} : Decl.DeclOutcome}

def decl_refuses_a_runtime_operation_without_a_lifetime_profile():
  {==}

law decl_admits_a_runtime_operation_with_a_lifetime_profile:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_execution(Decl.ExRuntime{}, "cdp-stop-v1"), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclAdmitted{fx_decl_with_ops(Decl.OpsCons{fx_op_execution(Decl.ExRuntime{}, "cdp-stop-v1"), Decl.OpsNil{}}), "d1"} : Decl.DeclOutcome}

def decl_admits_a_runtime_operation_with_a_lifetime_profile():
  {==}

# --- dependency edges --------------------------------------------------------
law decl_refuses_an_unresolved_dependency:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_dep(Decl.ModRef{"m3", "d3", "definition"}), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrDependencyUnresolved{"m1", "definition", "m3"}} : Decl.DeclOutcome}

def decl_refuses_an_unresolved_dependency():
  {==}

law decl_refuses_a_mismatched_dependency_digest:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_dep(Decl.ModRef{"m2", "wrong", "definition"}), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclRefused{Decl.DrDependencyDigestMismatch{"m1", "m2", "wrong", "d2"}} : Decl.DeclOutcome}

def decl_refuses_a_mismatched_dependency_digest():
  {==}

law decl_admits_a_resolved_dependency_digest:
  {Decl.admit_declaration(fx_decl_with_ops(Decl.OpsCons{fx_op_dep(Decl.ModRef{"m2", "d2", "definition"}), Decl.OpsNil{}}), fx_cat(), fx_inv()) == Decl.DeclAdmitted{fx_decl_with_ops(Decl.OpsCons{fx_op_dep(Decl.ModRef{"m2", "d2", "definition"}), Decl.OpsNil{}}), "d1"} : Decl.DeclOutcome}

def decl_admits_a_resolved_dependency_digest():
  {==}

# --- catalog admission -------------------------------------------------------
# The first refusal in declaration order refuses the set, and the refused
# module is named.
law decl_catalog_refuses_the_refused_declaration:
  {Decl.admit_catalog(Decl.CatCons{fx_decl(), Decl.CatCons{fx_decl_at_protocol("1"), Decl.CatNil{}}}, fx_inv()) == Decl.CatRefused{"m1", Decl.DrUnsupportedProtocolVersion{"1"}} : Decl.CatOutcome}

def decl_catalog_refuses_the_refused_declaration():
  {==}

# --- the derived vocabularies ------------------------------------------------
# The vocabulary is the union of the closed operation set's requirements, so an
# effect an admitted operation requires is known and a proposed one is not.
law decl_vocabulary_admits_an_operation_requirement:
  {Decl.known_effect("planTargetSql") == True{} : Bool}

def decl_vocabulary_admits_an_operation_requirement():
  {==}

law decl_vocabulary_admits_the_runtime_requirements:
  {Decl.known_effect("controlRuntime") == True{} : Bool}

def decl_vocabulary_admits_the_runtime_requirements():
  {==}

law decl_vocabulary_refuses_the_proposed_configuration_effect:
  {Decl.known_effect("configureModules") == False{} : Bool}

def decl_vocabulary_refuses_the_proposed_configuration_effect():
  {==}

law decl_vocabulary_refuses_an_unknown_effect:
  {Decl.known_effect("nothingRequiresThis") == False{} : Bool}

def decl_vocabulary_refuses_an_unknown_effect():
  {==}

# --- declarative applicability -----------------------------------------------
law decl_rule_matches_an_admitted_subject:
  {Decl.rules_hold(fx_rules(), Eng.ss_one("src/handler.ts"), Eng.ss_empty(), "handler", Eng.ss_one("definition")) == True{} : Bool}

def decl_rule_matches_an_admitted_subject():
  {==}

law decl_rule_refuses_a_different_subject:
  {Decl.rules_hold(fx_rules(), Eng.ss_one("src/handler.ts"), Eng.ss_empty(), "symbol", Eng.ss_one("definition")) == False{} : Bool}

def decl_rule_refuses_a_different_subject():
  {==}

law decl_path_rule_reads_the_admitted_paths:
  {Decl.rules_hold(Decl.RulesCons{Decl.RPath{"src/handler.ts"}, Decl.RulesNil{}}, Eng.ss_one("src/handler.ts"), Eng.ss_empty(), "handler", Eng.ss_empty()) == True{} : Bool}

def decl_path_rule_reads_the_admitted_paths():
  {==}

law decl_projection_rule_reads_the_requested_projections:
  {Decl.rules_hold(Decl.RulesCons{Decl.RProjection{"authorization"}, Decl.RulesNil{}}, Eng.ss_empty(), Eng.ss_empty(), "handler", Eng.ss_one("definition")) == False{} : Bool}

def decl_projection_rule_reads_the_requested_projections():
  {==}
