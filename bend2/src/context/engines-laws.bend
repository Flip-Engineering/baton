# CLAIM: the operative laws of the engine table, automatic selection and
# discovery plan in bend2/src/context/engines.bend. Each law is stated over the
# real function production calls and proved beside its claim; every compile of
# an entry that imports this module verifies every law.
#
# The laws fix the selection decision for one request shape each, the exact
# required effect set of an operation, the refusal that names a missing grant,
# the resolution of a selected engine against the observed catalog, and the
# fixed discovery plan of a deployment. Provider truth remains a named
# assumption exercised by host fixtures: these laws prove how an observed probe
# outcome is composed, not what a probe observes.

import Base
import ./engines.bend as Eng

# --- automatic selection -----------------------------------------------------
law engine_auto_typescript_position_selects_typescript:
  {Eng.auto("position", "src/handler.ts", "", Eng.ss_two("definition", "type")) == Eng.EOne{"typescript"} : Eng.EngineChoice}

def engine_auto_typescript_position_selects_typescript():
  {==}

law engine_auto_typescript_symbol_selects_typescript:
  {Eng.auto("symbol", "src/handler.mts", "", Eng.ss_one("calls")) == Eng.EOne{"typescript"} : Eng.EngineChoice}

def engine_auto_typescript_symbol_selects_typescript():
  {==}

law engine_auto_c_language_service_selects_clangd:
  {Eng.auto("position", "src/report.c", "", Eng.ss_one("diagnostics")) == Eng.EOne{"clangd"} : Eng.EngineChoice}

def engine_auto_c_language_service_selects_clangd():
  {==}

law engine_auto_c_authorization_selects_the_analyzer:
  {Eng.auto("symbol", "src/report.c", "", Eng.ss_two("authorization", "databaseAccesses")) == Eng.EOne{"clang-analyzer"} : Eng.EngineChoice}

def engine_auto_c_authorization_selects_the_analyzer():
  {==}

law engine_auto_c_flow_selects_the_analyzer:
  {Eng.auto("position", "src/report.h", "", Eng.ss_one("flow")) == Eng.EOne{"clang-analyzer"} : Eng.EngineChoice}

def engine_auto_c_flow_selects_the_analyzer():
  {==}

law engine_auto_mixed_c_request_selects_the_analyzer:
  {Eng.auto("symbol", "src/report.c", "", Eng.ss_two("type", "authorization")) == Eng.EOne{"clang-analyzer"} : Eng.EngineChoice}

def engine_auto_mixed_c_request_selects_the_analyzer():
  {==}

law engine_auto_cpp_analysis_names_its_scope:
  {Eng.auto("position", "src/handler.cpp", "", Eng.ss_one("authorization")) == Eng.ENone{"C++ analysis projections are outside the initial supported set"} : Eng.EngineChoice}

def engine_auto_cpp_analysis_names_its_scope():
  {==}

law engine_auto_cpp_language_service_selects_clangd:
  {Eng.auto("position", "src/handler.cpp", "", Eng.ss_one("definition")) == Eng.EOne{"clangd"} : Eng.EngineChoice}

def engine_auto_cpp_language_service_selects_clangd():
  {==}

law engine_auto_unknown_suffix_returns_candidates:
  {Eng.auto("position", "src/handler", "", Eng.ss_one("definition")) == Eng.EMany{Eng.ss_two("typescript", "clangd")} : Eng.EngineChoice}

def engine_auto_unknown_suffix_returns_candidates():
  {==}

law engine_auto_entity_uses_the_declared_database_engine:
  {Eng.auto("entity", "", "sqlite-schema", Eng.ss_one("entities")) == Eng.EOne{"sqlite-schema"} : Eng.EngineChoice}

def engine_auto_entity_uses_the_declared_database_engine():
  {==}

law engine_auto_entity_uses_the_declared_postgres_engine:
  {Eng.auto("entity", "", "postgres-schema", Eng.ss_one("constraints")) == Eng.EOne{"postgres-schema"} : Eng.EngineChoice}

def engine_auto_entity_uses_the_declared_postgres_engine():
  {==}

law engine_auto_entity_without_a_database_engine_refuses:
  {Eng.auto("entity", "", "", Eng.ss_one("entities")) == Eng.ENone{"entity subject requires a database engine"} : Eng.EngineChoice}

def engine_auto_entity_without_a_database_engine_refuses():
  {==}

law engine_auto_model_selects_the_model_engine:
  {Eng.auto("model", "", "", Eng.ss_one("validation")) == Eng.EOne{"data-model"} : Eng.EngineChoice}

def engine_auto_model_selects_the_model_engine():
  {==}

law engine_auto_schema_selects_the_model_engine:
  {Eng.auto("schema", "", "", Eng.ss_one("structure")) == Eng.EOne{"data-model"} : Eng.EngineChoice}

def engine_auto_schema_selects_the_model_engine():
  {==}

law engine_auto_security_selects_the_analyzer:
  {Eng.auto("security", "", "", Eng.ss_one("guardPaths")) == Eng.EOne{"clang-analyzer"} : Eng.EngineChoice}

def engine_auto_security_selects_the_analyzer():
  {==}

law engine_auto_migration_selects_the_model_engine:
  {Eng.auto("migration", "", "", Eng.ss_one("migrations")) == Eng.EOne{"data-model"} : Eng.EngineChoice}

def engine_auto_migration_selects_the_model_engine():
  {==}

law engine_auto_program_selects_the_environment_engine:
  {Eng.auto("program", "", "", Eng.ss_one("dependencies")) == Eng.EOne{"environment"} : Eng.EngineChoice}

def engine_auto_program_selects_the_environment_engine():
  {==}

law engine_auto_dataset_selects_the_dataset_engine:
  {Eng.auto("dataset", "", "", Eng.ss_one("structure")) == Eng.EOne{"json-dataset"} : Eng.EngineChoice}

def engine_auto_dataset_selects_the_dataset_engine():
  {==}

law engine_auto_runtime_selects_the_runtime_engine:
  {Eng.auto("runtime", "", "", Eng.ss_one("state")) == Eng.EOne{"cdp"} : Eng.EngineChoice}

def engine_auto_runtime_selects_the_runtime_engine():
  {==}

law engine_auto_query_control_selects_the_control_engine:
  {Eng.auto("query-control", "", "", Eng.ss_one("state")) == Eng.EOne{"query-control"} : Eng.EngineChoice}

def engine_auto_query_control_selects_the_control_engine():
  {==}

law engine_auto_unknown_subject_kind_refuses:
  {Eng.auto("nonsense", "", "", Eng.ss_one("definition")) == Eng.ENone{"unsupported subject kind"} : Eng.EngineChoice}

def engine_auto_unknown_subject_kind_refuses():
  {==}

law engine_auto_unsupported_projection_refuses_and_names_it:
  {Eng.auto("position", "src/handler.ts", "", Eng.ss_one("entities")) == Eng.ENone{"projection is not served by typescript: entities"} : Eng.EngineChoice}

def engine_auto_unsupported_projection_refuses_and_names_it():
  {==}

law engine_auto_unsupported_cpp_projection_refuses_and_names_it:
  {Eng.auto("position", "src/handler.cpp", "", Eng.ss_one("entities")) == Eng.ENone{"projection is not served by clangd: entities"} : Eng.EngineChoice}

def engine_auto_unsupported_cpp_projection_refuses_and_names_it():
  {==}

# --- required effects --------------------------------------------------------
law engine_required_effects_of_a_read_only_source_query_are_empty:
  {Eng.required_effects("typescript", "", Eng.ss_one("definition")) == Eng.SSNil{} : Eng.SS}

def engine_required_effects_of_a_read_only_source_query_are_empty():
  {==}

law engine_required_effects_of_the_c_sql_join_require_planning:
  {Eng.required_effects("clang-analyzer", "", Eng.ss_two("authorization", "databaseAccesses")) == Eng.ss_one("planTargetSql") : Eng.SS}

def engine_required_effects_of_the_c_sql_join_require_planning():
  {==}

law engine_required_effects_of_a_c_predicate_query_require_planning:
  {Eng.required_effects("clang-analyzer", "", Eng.ss_two("type", "predicateQueries")) == Eng.ss_one("planTargetSql") : Eng.SS}

def engine_required_effects_of_a_c_predicate_query_require_planning():
  {==}

law engine_required_effects_of_model_validation_require_execution:
  {Eng.required_effects("data-model", "", Eng.ss_one("validation")) == Eng.ss_one("executeTarget") : Eng.SS}

def engine_required_effects_of_model_validation_require_execution():
  {==}

law engine_required_effects_of_migration_replay:
  {Eng.required_effects("data-model", "", Eng.ss_one("migrations")) == Eng.ss_one("replayMigrations") : Eng.SS}

def engine_required_effects_of_migration_replay():
  {==}

law engine_required_effects_of_runtime_evaluation_require_both_grants:
  {Eng.required_effects("cdp", "evaluate", Eng.ss_one("values")) == Eng.ss_two("controlRuntime", "evaluateRuntime") : Eng.SS}

def engine_required_effects_of_runtime_evaluation_require_both_grants():
  {==}

law engine_required_effects_of_observing_an_owned_runtime_are_empty:
  {Eng.required_effects("cdp", "observe", Eng.ss_one("frames")) == Eng.SSNil{} : Eng.SS}

def engine_required_effects_of_observing_an_owned_runtime_are_empty():
  {==}

law engine_required_effects_of_launching_an_owned_runtime_control_it:
  {Eng.required_effects("cdp", "launch", Eng.ss_one("state")) == Eng.ss_one("controlRuntime") : Eng.SS}

def engine_required_effects_of_launching_an_owned_runtime_control_it():
  {==}

law engine_required_effects_of_releasing_an_owned_runtime_control_it:
  {Eng.required_effects("cdp", "release", Eng.ss_one("state")) == Eng.ss_one("controlRuntime") : Eng.SS}

def engine_required_effects_of_releasing_an_owned_runtime_control_it():
  {==}

law engine_required_effects_of_query_control_recovery_are_empty:
  {Eng.required_effects("query-control", "recover", Eng.ss_one("state")) == Eng.SSNil{} : Eng.SS}

def engine_required_effects_of_query_control_recovery_are_empty():
  {==}

law engine_required_effects_of_query_control_release_control_the_owned_process:
  {Eng.required_effects("query-control", "release", Eng.ss_one("state")) == Eng.ss_one("controlRuntime") : Eng.SS}

def engine_required_effects_of_query_control_release_control_the_owned_process():
  {==}

law engine_required_effects_of_a_catalog_access_require_planning:
  {Eng.required_effects("sqlite-schema", "", Eng.ss_one("codeAccesses")) == Eng.ss_one("planTargetSql") : Eng.SS}

def engine_required_effects_of_a_catalog_access_require_planning():
  {==}

law engine_missing_grant_is_named_before_the_effect:
  {Eng.missing_effects(Eng.ss_two("controlRuntime", "evaluateRuntime"), Eng.ss_one("controlRuntime")) == Eng.FxMissing{"evaluateRuntime"} : Eng.Effects}

def engine_missing_grant_is_named_before_the_effect():
  {==}

law engine_granted_effects_leave_nothing_missing:
  {Eng.missing_effects(Eng.ss_one("planTargetSql"), Eng.ss_one("planTargetSql")) == Eng.FxGranted{} : Eng.Effects}

def engine_granted_effects_leave_nothing_missing():
  {==}

law engine_a_missing_first_grant_is_the_one_named:
  {Eng.missing_effects(Eng.ss_two("replayMigrations", "executeTarget"), Eng.ss_one("executeTarget")) == Eng.FxMissing{"replayMigrations"} : Eng.Effects}

def engine_a_missing_first_grant_is_the_one_named():
  {==}

# --- resolution against the observed catalog ---------------------------------
law engine_unavailable_engine_is_reported_with_its_cause:
  {Eng.resolve(Eng.EOne{"clangd"}, [Eng.Engine{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd", Eng.SSNil{}, Eng.SSNil{}, Eng.AvUnavailable{"probe failed"}, Eng.SSNil{}}]) == Eng.RUnavailable{"clangd", "probe failed"} : Eng.EngineResolved}

def engine_unavailable_engine_is_reported_with_its_cause():
  {==}

law engine_available_engine_resolves_to_its_identity:
  {Eng.resolve(Eng.EOne{"clangd"}, [Eng.Engine{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd", Eng.SSNil{}, Eng.SSNil{}, Eng.AvAvailable{}, Eng.SSNil{}}]) == Eng.RSelected{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd"} : Eng.EngineResolved}

def engine_available_engine_resolves_to_its_identity():
  {==}

law engine_excluded_engine_is_reported_as_excluded:
  {Eng.resolve(Eng.EOne{"clangd"}, [Eng.Engine{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd", Eng.SSNil{}, Eng.SSNil{}, Eng.AvExcluded{"operator policy"}, Eng.SSNil{}}]) == Eng.RExcluded{"clangd", "operator policy"} : Eng.EngineResolved}

def engine_excluded_engine_is_reported_as_excluded():
  {==}

law engine_engine_outside_the_deployment_selection_refuses:
  {Eng.resolve(Eng.EOne{"clangd"}, []) == Eng.RNone{"engine is outside the deployment provider selection: clangd"} : Eng.EngineResolved}

def engine_engine_outside_the_deployment_selection_refuses():
  {==}

law engine_an_ambiguous_choice_returns_candidates_without_selecting:
  {Eng.resolve(Eng.EMany{Eng.ss_two("typescript", "clangd")}, [Eng.Engine{"typescript", "ts", "5.9.3", "/usr/bin/node", Eng.SSNil{}, Eng.SSNil{}, Eng.AvAvailable{}, Eng.SSNil{}}]) == Eng.RCandidates{Eng.ss_two("typescript", "clangd")} : Eng.EngineResolved}

def engine_an_ambiguous_choice_returns_candidates_without_selecting():
  {==}

# The resolution reads the catalog entry's declared identity, not a second
# source of provider identity.
law engine_the_entry_identity_is_the_observed_one:
  {Eng.resolve(Eng.EOne{"clangd"}, [Eng.Engine{"clang-analyzer", "other", "1.0.0", "/other", Eng.SSNil{}, Eng.SSNil{}, Eng.AvAvailable{}, Eng.SSNil{}}, Eng.Engine{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd", Eng.SSNil{}, Eng.SSNil{}, Eng.AvAvailable{}, Eng.SSNil{}}]) == Eng.RSelected{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd"} : Eng.EngineResolved}

def engine_the_entry_identity_is_the_observed_one():
  {==}

# --- discovery plan and probe composition ------------------------------------
law engine_the_probe_plan_is_fixed_and_names_no_target_path:
  {Eng.probe_plan(Eng.Dep{"node", "ts.mjs", "clangd", "extractor", "psql", "catalogs.mjs", "models.mjs", "env.mjs", "dataset.mjs"}) == [Eng.Probe{"typescript", "providerEngines", "node", Eng.ss_two("ts.mjs", "-")}, Eng.Probe{"clangd", "version", "clangd", Eng.ss_one("--version")}, Eng.Probe{"clang-analyzer", "version", "extractor", Eng.ss_one("--version")}, Eng.Probe{"cdp", "version", "node", Eng.ss_one("--version")}, Eng.Probe{"sqlite-schema", "providerEngines", "node", Eng.ss_two("catalogs.mjs", "-")}, Eng.Probe{"postgres-schema", "version", "psql", Eng.ss_one("--version")}, Eng.Probe{"data-model", "providerEngines", "node", Eng.ss_two("models.mjs", "-")}, Eng.Probe{"environment", "providerEngines", "node", Eng.ss_two("env.mjs", "-")}, Eng.Probe{"json-dataset", "providerEngines", "node", Eng.ss_two("dataset.mjs", "-")}] : List<Eng.ProbeSpec>}

def engine_the_probe_plan_is_fixed_and_names_no_target_path():
  {==}

law engine_a_matching_probe_version_is_available:
  {Eng.availability_observed(Eng.POk{"20.1.8", "/usr/local/bin/clangd", "sha"}, "20.1.8") == Eng.AvAvailable{} : Eng.Availability}

def engine_a_matching_probe_version_is_available():
  {==}

law engine_a_mismatched_probe_version_is_unavailable_and_names_both:
  {Eng.availability_observed(Eng.POk{"20.0.0", "/usr/local/bin/clangd", "sha"}, "20.1.8") == Eng.AvUnavailable{"observed provider version 20.0.0 differs from the declared version 20.1.8"} : Eng.Availability}

def engine_a_mismatched_probe_version_is_unavailable_and_names_both():
  {==}

law engine_a_failed_probe_is_unavailable_with_its_observed_cause:
  {Eng.availability_observed(Eng.PFailed{"the executable is absent"}, "20.1.8") == Eng.AvUnavailable{"the executable is absent"} : Eng.Availability}

def engine_a_failed_probe_is_unavailable_with_its_observed_cause():
  {==}

law engine_an_excluded_probe_is_excluded_with_its_reason:
  {Eng.availability_observed(Eng.PExcluded{"operator policy"}, "20.1.8") == Eng.AvExcluded{"operator policy"} : Eng.Availability}

def engine_an_excluded_probe_is_excluded_with_its_reason():
  {==}

# The entry carries the deployment's expected version and the engine's declared
# projection and effect sets, not a caller-supplied identity.
law engine_an_entry_carries_the_declared_identity_and_capability:
  {Eng.entry_of(Eng.Probe{"clangd", "version", "/usr/local/bin/clangd", Eng.ss_one("--version")}, Eng.POk{"20.1.8", "/usr/local/bin/clangd", "sha"}, "llvm-clangd", "20.1.8", Eng.ss_one("definition"), Eng.SSNil{}) == Eng.Engine{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd", Eng.ss_one("definition"), Eng.SSNil{}, Eng.AvAvailable{}, Eng.SSNil{}} : Eng.EngineEntry}

def engine_an_entry_carries_the_declared_identity_and_capability():
  {==}
