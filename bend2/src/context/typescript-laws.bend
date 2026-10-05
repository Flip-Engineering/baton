# CLAIM: the operative laws of the TypeScript semantic provider, each stated over a real function
# of ./typescript.bend and proved beside its claim. This module is its own law entrypoint: a
# compile of it verifies every law here, and its import into coordinator/laws.bend makes those
# same laws part of the coordinator entry's gate.
#
# Every law is closed: it applies the implementation function to fixed arguments and compares the
# result with a literal, so a mutation of the implementation changes the computed value and the
# proof stops checking. None of them pins a count, a line number or a source spelling of other
# code.
#
# Reference: docs/bend2/semantic-context-spec.md; bend 2.0.25.

import Base
import ../git/text.bend as Tx
import ./typescript.bend as TN

# --- Subjects -------------------------------------------------------------------------------

law ts_position_kind:
  {TN.subject_kind(TN.SPosition{"/a.ts", 3, 7}) == "position" : String}

def ts_position_kind():
  {==}

law ts_symbol_kind:
  {TN.subject_kind(TN.SSymbol{"/a.ts", "run", ""}) == "symbol" : String}

def ts_symbol_kind():
  {==}

law ts_diagnostic_kind:
  {TN.subject_kind(TN.SDiagnostic{"/a.ts", 3, 7, "7027"}) == "diagnostic" : String}

def ts_diagnostic_kind():
  {==}

law ts_subject_path_is_the_requested_spelling:
  {TN.subject_path(TN.SSymbol{"/work/a.ts", "run", ""}) == "/work/a.ts" : String}

def ts_subject_path_is_the_requested_spelling():
  {==}

law ts_incomplete_position_is_refused:
  {TN.subject_complete(TN.SPosition{"", 0, 0}) == False{} : Bool}

def ts_incomplete_position_is_refused():
  {==}

law ts_complete_symbol_needs_a_name:
  {TN.subject_complete(TN.SSymbol{"/a.ts", "", ""}) == False{} : Bool}

def ts_complete_symbol_needs_a_name():
  {==}

law ts_complete_diagnostic_needs_a_code:
  {TN.subject_complete(TN.SDiagnostic{"/a.ts", 0, 0, ""}) == False{} : Bool}

def ts_complete_diagnostic_needs_a_code():
  {==}

law ts_complete_source_subject_is_admitted:
  {TN.subject_complete(TN.SPosition{"/a.ts", 0, 0}) == True{} : Bool}

def ts_complete_source_subject_is_admitted():
  {==}

# --- Suffix selection -----------------------------------------------------------------------

law ts_projection_bits_are_distinct:
  {TN.projection_bitval("definition") == 1 : U32}

def ts_projection_bits_are_distinct():
  {==}

law ts_projection_bit_for_references:
  {TN.projection_bitval("references") == 4 : U32}

def ts_projection_bit_for_references():
  {==}

law ts_projection_bit_for_database_accesses:
  {TN.projection_bitval("databaseAccesses") == 512 : U32}

def ts_projection_bit_for_database_accesses():
  {==}

law ts_unknown_projection_has_no_bit:
  {TN.projection_bitval("authorization") == 0 : U32}

def ts_unknown_projection_has_no_bit():
  {==}

law ts_known_projection_is_known:
  {TN.projection_known("flow") == True{} : Bool}

def ts_known_projection_is_known():
  {==}

law ts_unknown_projection_is_not_known:
  {TN.projection_known("guardPaths") == False{} : Bool}

def ts_unknown_projection_is_not_known():
  {==}

law ts_projection_name_round_trips_diagnostics:
  {TN.projection_name(64) == "diagnostics" : String}

def ts_projection_name_round_trips_diagnostics():
  {==}

law ts_source_mask_admits_a_source_projection:
  {TN.select_mask_condition(TN.SPosition{"/a.ts", 0, 0}, 1, TN.Options{"", "", "", "", 0, 0}) == "" : String}

def ts_source_mask_admits_a_source_projection():
  {==}

law ts_diagnostic_subject_refuses_calls:
  {TN.select_condition(TN.SDiagnostic{"/a.ts", 0, 0, "7027"}, TN.SelectOk{8}, TN.Options{"", "", "", "", 0, 0}) == "context-projection-unsupported-for-subject" : String}

def ts_diagnostic_subject_refuses_calls():
  {==}

law ts_diagnostic_subject_admits_flow:
  {TN.select_condition(TN.SDiagnostic{"/a.ts", 0, 0, "7027"}, TN.SelectOk{128}, TN.Options{"", "", "", "", 0, 0}) == "" : String}

def ts_diagnostic_subject_admits_flow():
  {==}

# --- Select validation ----------------------------------------------------------------------

law ts_empty_select_is_refused:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectEmpty{}, TN.Options{"", "", "", "", 0, 0}) == "context-select-empty" : String}

def ts_empty_select_is_refused():
  {==}

law ts_unknown_select_name_is_refused:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectUnknown{}, TN.Options{"", "", "", "", 0, 0}) == "context-projection-unknown" : String}

def ts_unknown_select_name_is_refused():
  {==}

law ts_duplicate_select_name_is_refused:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectDuplicate{}, TN.Options{"", "", "", "", 0, 0}) == "context-projection-duplicate" : String}

def ts_duplicate_select_name_is_refused():
  {==}

law ts_select_check_accumulates_bits:
  {TN.select_check_text(TN.select_check(["definition", "type"])) == "ok:3" : String}

def ts_select_check_accumulates_bits():
  {==}

law ts_select_check_detects_a_duplicate:
  {TN.select_check_text(TN.select_check(["type", "type"])) == "duplicate" : String}

def ts_select_check_detects_a_duplicate():
  {==}

law ts_select_check_detects_an_unknown_name:
  {TN.select_check_text(TN.select_check(["definition", "authorization"])) == "unknown" : String}

def ts_select_check_detects_an_unknown_name():
  {==}

law ts_select_check_refuses_an_empty_set:
  {TN.select_check_text(TN.select_check(Nil{})) == "empty" : String}

def ts_select_check_refuses_an_empty_set():
  {==}

law ts_single_projection_select_is_admitted:
  {TN.select_admitted(TN.SPosition{"/a.ts", 0, 0}, TN.select_check(["definition"]), TN.Options{"", "", "", "", 0, 0}) == True{} : Bool}

def ts_single_projection_select_is_admitted():
  {==}

law ts_unknown_projection_in_a_set_is_refused:
  {TN.select_admitted(TN.SPosition{"/a.ts", 0, 0}, TN.select_check(["definition", "authorization"]), TN.Options{"", "", "", "", 0, 0}) == False{} : Bool}

def ts_unknown_projection_in_a_set_is_refused():
  {==}

# --- Options --------------------------------------------------------------------------------

law ts_database_accesses_requires_a_database_path:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectOk{512}, TN.Options{"", "sqlite-schema", "", "/a.ts", 0, 0}) == "context-database-path-missing" : String}

def ts_database_accesses_requires_a_database_path():
  {==}

law ts_database_accesses_requires_a_client_position:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectOk{512}, TN.Options{"", "sqlite-schema", "/db.sqlite", "", 0, 0}) == "context-typescript-client-missing" : String}

def ts_database_accesses_requires_a_client_position():
  {==}

law ts_unknown_database_engine_is_refused:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectOk{512}, TN.Options{"", "sqlite", "/db.sqlite", "/a.ts", 0, 0}) == "context-database-engine-unsupported" : String}

def ts_unknown_database_engine_is_refused():
  {==}

law ts_database_accesses_with_database_and_client_is_admitted:
  {TN.select_condition(TN.SPosition{"/a.ts", 0, 0}, TN.SelectOk{512}, TN.Options{"", "sqlite-schema", "/db.sqlite", "/a.ts", 4, 11}) == "" : String}

def ts_database_accesses_with_database_and_client_is_admitted():
  {==}

# --- Captured inputs ------------------------------------------------------------------------

law ts_matched_client_and_literal_admits_the_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "ready:SELECT 1@call-1" : String}

def ts_matched_client_and_literal_admits_the_join():
  {==}

law ts_shadowed_client_cannot_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CShadowed{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "unavailable:shadowedClient" : String}

def ts_shadowed_client_cannot_join():
  {==}

law ts_indirect_client_cannot_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CIndirect{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "unavailable:indirectClient" : String}

def ts_indirect_client_cannot_join():
  {==}

law ts_dynamic_receiver_cannot_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CDynamic{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "unavailable:dynamicReceiver" : String}

def ts_dynamic_receiver_cannot_join():
  {==}

law ts_dynamic_sql_cannot_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CMatched{}, TN.SDynamic{2}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "unavailable:dynamicSql" : String}

def ts_dynamic_sql_cannot_join():
  {==}

law ts_join_requires_a_source_binding:
  {TN.sql_ask_text(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "", "snap-1")) == "unavailable:sourceBindingMissing" : String}

def ts_join_requires_a_source_binding():
  {==}

law ts_join_requires_a_snapshot_identity:
  {TN.sql_ask_text(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "")) == "unavailable:snapshotIdMissing" : String}

def ts_join_requires_a_snapshot_identity():
  {==}

law ts_join_requires_a_named_database:
  {TN.sql_ask_text(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{""}, "call-1", "snap-1")) == "unavailable:databaseIdentityMissing" : String}

def ts_join_requires_a_named_database():
  {==}

law ts_missing_literal_cannot_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CMatched{}, TN.SNone{}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "unavailable:noSqlLiteral" : String}

def ts_missing_literal_cannot_join():
  {==}

law ts_unrequested_client_cannot_join:
  {TN.sql_ask_text(TN.sql_ask(TN.CNotRequested{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "unavailable:clientNotRequested" : String}

def ts_unrequested_client_cannot_join():
  {==}

law ts_join_key_binds_the_snapshot_and_the_call_site:
  {TN.join_key(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "[[\"snapshot\",\"snap-1\"],[\"binding\",\"call-1\"]]" : String}

def ts_join_key_binds_the_snapshot_and_the_call_site():
  {==}

law ts_join_keys_of_distinct_snapshots_differ:
  {Tx.str_eq(TN.join_key(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")), TN.join_key(TN.sql_ask(TN.CMatched{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-2"))) == False{} : Bool}

def ts_join_keys_of_distinct_snapshots_differ():
  {==}

law ts_unavailable_ask_has_no_join_key:
  {TN.join_key(TN.sql_ask(TN.CShadowed{}, TN.SLiteral{"SELECT 1"}, TN.DSqlite{"/db.sqlite"}, "call-1", "snap-1")) == "" : String}

def ts_unavailable_ask_has_no_join_key():
  {==}

# --- Model use joins ------------------------------------------------------------------------

law ts_module_use_key_pins_the_snapshot_and_the_resolved_declaration:
  {TN.module_use_key(TN.ModuleUse{"snap-1", "/m.ts", "aa", "create", "/m.ts", "aa", 4, 2}) == "[\"moduleUse\",\"snap-1\",\"/m.ts\",\"aa\",\"create\",\"/m.ts\",\"aa\",\"4\",\"2\"]" : String}

def ts_module_use_key_pins_the_snapshot_and_the_resolved_declaration():
  {==}

law ts_module_use_of_another_snapshot_is_a_different_identity:
  {TN.module_use_same(TN.ModuleUse{"snap-1", "/m.ts", "aa", "create", "/m.ts", "aa", 4, 2}, TN.ModuleUse{"snap-2", "/m.ts", "aa", "create", "/m.ts", "aa", 4, 2}) == False{} : Bool}

def ts_module_use_of_another_snapshot_is_a_different_identity():
  {==}

law ts_module_use_of_a_same_name_export_in_another_file_is_a_different_identity:
  {TN.module_use_same(TN.ModuleUse{"snap-1", "/m.ts", "aa", "create", "/m.ts", "aa", 4, 2}, TN.ModuleUse{"snap-1", "/m.ts", "aa", "create", "/n.ts", "bb", 4, 2}) == False{} : Bool}

def ts_module_use_of_a_same_name_export_in_another_file_is_a_different_identity():
  {==}

law ts_identical_module_use_is_the_same_identity:
  {TN.module_use_same(TN.ModuleUse{"snap-1", "/m.ts", "aa", "create", "/m.ts", "aa", 4, 2}, TN.ModuleUse{"snap-1", "/m.ts", "aa", "create", "/m.ts", "aa", 4, 2}) == True{} : Bool}

def ts_identical_module_use_is_the_same_identity():
  {==}

# --- Provider identity and launch -----------------------------------------------------------

law ts_provider_identity_names_the_executable_and_the_library:
  {TN.provider_text(TN.Provider{"/usr/bin/node", "22.15.0", "/p/typescript/lib/typescript.js", "ff", "5.9.3"}) == "{\"libraryPath\":\"/p/typescript/lib/typescript.js\",\"librarySha\":\"ff\",\"node\":\"/usr/bin/node\",\"runtime\":\"22.15.0\",\"version\":\"5.9.3\"}" : String}

def ts_provider_identity_names_the_executable_and_the_library():
  {==}

# --- Selected operation ---------------------------------------------------------------------

law ts_pure_extraction_selects_source_analysis:
  {TN.operation_of(TN.SPosition{"/a.ts", 0, 0}, 1) == "sourceAnalysis" : String}

def ts_pure_extraction_selects_source_analysis():
  {==}

law ts_model_use_resolution_is_pure_extraction:
  {TN.operation_of(TN.SPosition{"/a.ts", 0, 0}, 32) == "sourceAnalysis" : String}

def ts_model_use_resolution_is_pure_extraction():
  {==}

law ts_database_accesses_selects_the_sql_plan_operation:
  {TN.operation_of(TN.SPosition{"/a.ts", 0, 0}, 512) == "sqlPlan" : String}

def ts_database_accesses_selects_the_sql_plan_operation():
  {==}
