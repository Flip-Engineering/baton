# CLAIM: the operative laws of the snapshot identity and applicability
# composition in bend2/src/context/snapshot.bend. Each law fixes the actual
# function's answer for one captured input set, and the identity laws pin the
# complete canonical text, so an added worktree or data-version field would
# break them.
#
# The digest itself is a host effect over the identity text; these laws prove
# the text and the comparison, and the provider/host digests remain named
# assumptions exercised by fixtures.

import Base
import ./engines.bend as Eng
import ./snapshot.bend as Snap

# --- identity text -----------------------------------------------------------
law context_snapshot_identity_text_is_canonical:
  {Snap.identity_text("typescript", "5.9.3", ["project/lib.json"], Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}])) == "[\"baton2.context.snapshot.v1\",\"typescript\",\"5.9.3\",[\"project/lib.json\"],[[\"source\",\"/work/a.ts\",\"aa\"]]]" : String}

def context_snapshot_identity_text_is_canonical():
  {==}

# The identity text carries no worktree branch, commit or dirty flag: the
# pinned text above is the whole identity.
law context_snapshot_identity_text_without_inputs_is_still_canonical:
  {Snap.identity_text("clangd", "20.1.8", [], Snap.fps_of_list([])) == "[\"baton2.context.snapshot.v1\",\"clangd\",\"20.1.8\",[],[]]" : String}

def context_snapshot_identity_text_without_inputs_is_still_canonical():
  {==}

# An absent lookup and a present file are different identities for the same
# path.
law context_snapshot_an_absent_lookup_is_a_distinct_identity:
  {Snap.identity_text("typescript", "5.9.3", [], Snap.fps_of_list([Snap.FpAbsent{"module", "/work/new.ts"}])) == "[\"baton2.context.snapshot.v1\",\"typescript\",\"5.9.3\",[],[[\"module\",\"/work/new.ts\",\"absent\"]]]" : String}

def context_snapshot_an_absent_lookup_is_a_distinct_identity():
  {==}

law context_snapshot_a_resolved_link_carries_its_target:
  {Snap.identity_text("clangd", "20.1.8", [], Snap.fps_of_list([Snap.FpLink{"root", "/sdk/current", "/sdk/20.1.8"}])) == "[\"baton2.context.snapshot.v1\",\"clangd\",\"20.1.8\",[],[[\"root\",\"/sdk/current\",\"/sdk/20.1.8\"]]]" : String}

def context_snapshot_a_resolved_link_carries_its_target():
  {==}

law context_snapshot_a_directory_membership_carries_its_digest:
  {Snap.identity_text("typescript", "5.9.3", [], Snap.fps_of_list([Snap.FpDir{"resolve", "/work/src", "dd"}])) == "[\"baton2.context.snapshot.v1\",\"typescript\",\"5.9.3\",[],[[\"resolve\",\"/work/src\",\"dd\"]]]" : String}

def context_snapshot_a_directory_membership_carries_its_digest():
  {==}

# --- catalog identity --------------------------------------------------------
law context_snapshot_catalog_identity_carries_schema_fields_only:
  {Snap.catalog_identity_text("sqlite-schema", "3.54.0", "/w/owned.fossil", "dev:1", "abc", "7", "wal", True{}, False{}) == "[\"baton2.context.catalog.v1\",\"sqlite-schema\",\"3.54.0\",\"/w/owned.fossil\",\"dev:1\",\"abc\",\"7\",\"wal\",\"true\",\"false\"]" : String}

def context_snapshot_catalog_identity_carries_schema_fields_only():
  {==}

law context_snapshot_catalog_identity_names_the_connection_flags:
  {Snap.catalog_identity_text("postgres-schema", "14.18", "service:bat0", "cluster:7", "def", "3", "n/a", True{}, True{}) == "[\"baton2.context.catalog.v1\",\"postgres-schema\",\"14.18\",\"service:bat0\",\"cluster:7\",\"def\",\"3\",\"n/a\",\"true\",\"true\"]" : String}

def context_snapshot_catalog_identity_names_the_connection_flags():
  {==}

# --- source applicability ----------------------------------------------------
law context_snapshot_unchanged_inputs_are_current:
  {Snap.applies(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.RvOk{Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}])}) == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_unchanged_inputs_are_current():
  {==}

law context_snapshot_a_changed_digest_is_stale_and_names_the_path:
  {Snap.applies(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.RvOk{Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "bb"}])}) == Snap.AStale{Eng.ss_one("/work/a.ts")} : Snap.Applies}

def context_snapshot_a_changed_digest_is_stale_and_names_the_path():
  {==}

law context_snapshot_a_missing_input_is_stale:
  {Snap.applies(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.RvOk{Snap.fps_of_list([])}) == Snap.AStale{Eng.ss_one("/work/a.ts")} : Snap.Applies}

def context_snapshot_a_missing_input_is_stale():
  {==}

law context_snapshot_an_added_module_changes_the_absent_lookup:
  {Snap.applies(Snap.fps_of_list([Snap.FpAbsent{"module", "/work/new.ts"}]), Snap.RvOk{Snap.fps_of_list([Snap.FpFile{"module", "/work/new.ts", "cc"}])}) == Snap.AStale{Eng.ss_one("/work/new.ts")} : Snap.Applies}

def context_snapshot_an_added_module_changes_the_absent_lookup():
  {==}

law context_snapshot_a_changed_link_target_is_stale:
  {Snap.applies(Snap.fps_of_list([Snap.FpLink{"root", "/sdk/current", "/sdk/20.1.8"}]), Snap.RvOk{Snap.fps_of_list([Snap.FpLink{"root", "/sdk/current", "/sdk/20.1.9"}])}) == Snap.AStale{Eng.ss_one("/sdk/current")} : Snap.Applies}

def context_snapshot_a_changed_link_target_is_stale():
  {==}

law context_snapshot_every_changed_input_is_named_in_recorded_order:
  {Snap.changed_inputs(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}, Snap.FpFile{"config", "/work/tsconfig.json", "e1"}]), Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "bb"}, Snap.FpFile{"config", "/work/tsconfig.json", "e2"}])) == Eng.SSCons{"/work/a.ts", Eng.ss_one("/work/tsconfig.json")} : Eng.SS}

def context_snapshot_every_changed_input_is_named_in_recorded_order():
  {==}

law context_snapshot_a_role_change_for_the_same_path_is_stale:
  {Snap.applies(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.RvOk{Snap.fps_of_list([Snap.FpConfig{"config", "/work/a.ts", "aa"}])}) == Snap.AStale{Eng.ss_one("/work/a.ts")} : Snap.Applies}

def context_snapshot_a_role_change_for_the_same_path_is_stale():
  {==}

law context_snapshot_a_failed_revalidation_is_unknown_with_its_cause:
  {Snap.applies(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.RvFailed{"the read probe failed"}) == Snap.AUnknown{"the read probe failed"} : Snap.Applies}

def context_snapshot_a_failed_revalidation_is_unknown_with_its_cause():
  {==}

# --- capture consistency -----------------------------------------------------
law context_snapshot_an_intact_manifest_is_intact:
  {Snap.capture_check(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}])) == Snap.CCIntact{} : Snap.CaptureCheck}

def context_snapshot_an_intact_manifest_is_intact():
  {==}

law context_snapshot_a_changed_manifest_names_the_changed_paths:
  {Snap.capture_check(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "bb"}])) == Snap.CCChanged{Eng.ss_one("/work/a.ts")} : Snap.CaptureCheck}

def context_snapshot_a_changed_manifest_names_the_changed_paths():
  {==}

# --- catalog applicability ---------------------------------------------------
law context_snapshot_an_equal_schema_digest_is_current:
  {Snap.applies_catalog("/w/owned.fossil", "abc", "abc") == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_an_equal_schema_digest_is_current():
  {==}

law context_snapshot_a_changed_schema_digest_is_stale_with_the_path:
  {Snap.applies_catalog("/w/owned.fossil", "abc", "def") == Snap.AStale{Eng.ss_one("/w/owned.fossil")} : Snap.Applies}

def context_snapshot_a_changed_schema_digest_is_stale_with_the_path():
  {==}

# --- runtime applicability ---------------------------------------------------
law context_snapshot_a_same_live_epoch_is_current:
  {Snap.applies_runtime(3, 3, True{}) == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_a_same_live_epoch_is_current():
  {==}

law context_snapshot_an_advanced_epoch_is_historical:
  {Snap.applies_runtime(3, 4, True{}) == Snap.AHistorical{"runtime epoch advanced"} : Snap.Applies}

def context_snapshot_an_advanced_epoch_is_historical():
  {==}

law context_snapshot_a_dead_runtime_is_historical:
  {Snap.applies_runtime(3, 3, False{}) == Snap.AHistorical{"runtime is not live"} : Snap.Applies}

def context_snapshot_a_dead_runtime_is_historical():
  {==}

# --- connection binding ------------------------------------------------------
law context_snapshot_a_detached_plan_binding_refuses:
  {Snap.plan_binding("sid-a", "sid-b") == Snap.BRefused{"the target plan must use the recorded catalog connection and read transaction"} : Snap.Binding}

def context_snapshot_a_detached_plan_binding_refuses():
  {==}

law context_snapshot_a_shared_plan_binding_holds:
  {Snap.plan_binding("sid-a", "sid-a") == Snap.BShare{} : Snap.Binding}

def context_snapshot_a_shared_plan_binding_holds():
  {==}
