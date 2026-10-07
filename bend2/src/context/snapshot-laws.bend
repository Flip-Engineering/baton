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
import ./runtime/cdp-runtime.bend as R

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

# --- runtime references ------------------------------------------------------
# The stop facts and predicates are the owned CDP model, so these laws exercise
# the owned types rather than a local restatement of them.
def rt_a() -> Snap.RuntimeIdentity:
  Snap.RId{"rt:q7", "ad:1", "worker:2", "3", "5"}

def rt_advanced() -> Snap.RuntimeIdentity:
  Snap.RId{"rt:q7", "ad:1", "worker:2", "4", "5"}

def rt_other_thread() -> Snap.RuntimeIdentity:
  Snap.RId{"rt:q7", "ad:1", "worker:3", "3", "5"}

def rt_big() -> Snap.RuntimeIdentity:
  Snap.RId{"rt:q7", "ad:1", "worker:2", "18446744073709551617", "5"}

def rnow(identity: Snap.RuntimeIdentity, target: R.Liveness, stop: R.StopLiveness, thread_live: Bool, record_stopped: Bool, pause_scoped: Bool) -> Snap.RuntimeNow:
  Snap.Now{identity, target, thread_live, stop, record_stopped, pause_scoped}

law context_snapshot_a_live_matching_runtime_reference_is_current:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopAbsent{}, True{}, False{}, False{})) == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_a_live_matching_runtime_reference_is_current():
  {==}

law context_snapshot_a_pause_scoped_reference_against_a_live_stop_is_current:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopLive{}, True{}, True{}, True{})) == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_a_pause_scoped_reference_against_a_live_stop_is_current():
  {==}

# The correction this composition was missing: a recorded stop that is not live
# refuses, whatever else matches.
law context_snapshot_a_pause_scoped_reference_refuses_an_unknown_stop:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopUnknown{}, True{}, True{}, True{})) == Snap.AUnknown{"a pause-scoped reference requires a live recorded stop in a stopped runtime"} : Snap.Applies}

def context_snapshot_a_pause_scoped_reference_refuses_an_unknown_stop():
  {==}

law context_snapshot_a_pause_scoped_reference_refuses_a_historical_stop:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopHistorical{}, True{}, True{}, True{})) == Snap.AUnknown{"a pause-scoped reference requires a live recorded stop in a stopped runtime"} : Snap.Applies}

def context_snapshot_a_pause_scoped_reference_refuses_a_historical_stop():
  {==}

law context_snapshot_a_pause_scoped_reference_refuses_an_absent_stop:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopAbsent{}, True{}, True{}, True{})) == Snap.AUnknown{"a pause-scoped reference requires a live recorded stop in a stopped runtime"} : Snap.Applies}

def context_snapshot_a_pause_scoped_reference_refuses_an_absent_stop():
  {==}

law context_snapshot_a_pause_scoped_reference_refuses_a_running_record:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopLive{}, True{}, False{}, True{})) == Snap.AUnknown{"a pause-scoped reference requires a live recorded stop in a stopped runtime"} : Snap.Applies}

def context_snapshot_a_pause_scoped_reference_refuses_a_running_record():
  {==}

# A kind that is not pause-scoped acquires no stop requirement at all.
law context_snapshot_an_ordinary_reference_gains_no_stop_requirement:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopHistorical{}, True{}, False{}, False{})) == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_an_ordinary_reference_gains_no_stop_requirement():
  {==}

law context_snapshot_a_stop_refusal_is_decided_before_the_identity:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_advanced(), R.LivenessLive{}, R.StopUnknown{}, True{}, True{}, True{})) == Snap.AUnknown{"a pause-scoped reference requires a live recorded stop in a stopped runtime"} : Snap.Applies}

def context_snapshot_a_stop_refusal_is_decided_before_the_identity():
  {==}

law context_snapshot_a_thread_that_is_not_live_is_unknown:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessLive{}, R.StopAbsent{}, False{}, False{}, False{})) == Snap.AUnknown{"runtime thread is not live"} : Snap.Applies}

def context_snapshot_a_thread_that_is_not_live_is_unknown():
  {==}

law context_snapshot_an_advanced_epoch_is_a_different_lifetime:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_advanced(), R.LivenessLive{}, R.StopAbsent{}, True{}, False{}, False{})) == Snap.AHistorical{"runtime identity changed"} : Snap.Applies}

def context_snapshot_an_advanced_epoch_is_a_different_lifetime():
  {==}

law context_snapshot_a_different_thread_is_a_different_lifetime:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_other_thread(), R.LivenessLive{}, R.StopAbsent{}, True{}, False{}, False{})) == Snap.AHistorical{"runtime identity changed"} : Snap.Applies}

def context_snapshot_a_different_thread_is_a_different_lifetime():
  {==}

law context_snapshot_an_exited_target_is_historical:
  {Snap.applies_runtime_ref(rt_a(), rnow(rt_a(), R.LivenessExited{}, R.StopHistorical{}, True{}, False{}, False{})) == Snap.AHistorical{"runtime target exited"} : Snap.Applies}

def context_snapshot_an_exited_target_is_historical():
  {==}

law context_snapshot_an_unbounded_epoch_is_compared_exactly:
  {Snap.applies_runtime_ref(rt_big(), rnow(rt_big(), R.LivenessLive{}, R.StopAbsent{}, True{}, False{}, False{})) == Snap.ACurrent{} : Snap.Applies}

def context_snapshot_an_unbounded_epoch_is_compared_exactly():
  {==}

law context_snapshot_an_unbounded_epoch_that_advanced_is_historical:
  {Snap.applies_runtime_ref(rt_big(), rnow(Snap.RId{"rt:q7", "ad:1", "worker:2", "18446744073709551618", "5"}, R.LivenessLive{}, R.StopAbsent{}, True{}, False{}, False{})) == Snap.AHistorical{"runtime identity changed"} : Snap.Applies}

def context_snapshot_an_unbounded_epoch_that_advanced_is_historical():
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

law context_snapshot_a_join_with_the_same_source_and_catalog_binding_holds:
  {Snap.join_binding("src-a", "src-a", "cat-a", "cat-a") == Snap.BShare{} : Snap.Binding}

def context_snapshot_a_join_with_the_same_source_and_catalog_binding_holds():
  {==}

law context_snapshot_a_join_across_source_snapshots_refuses:
  {Snap.join_binding("src-a", "src-b", "cat-a", "cat-a") == Snap.BRefused{"a multi-engine join requires identical shared source identities and the named database snapshot"} : Snap.Binding}

def context_snapshot_a_join_across_source_snapshots_refuses():
  {==}

law context_snapshot_a_join_across_catalog_snapshots_refuses:
  {Snap.join_binding("src-a", "src-a", "cat-a", "cat-b") == Snap.BRefused{"a multi-engine join requires identical shared source identities and the named database snapshot"} : Snap.Binding}

def context_snapshot_a_join_across_catalog_snapshots_refuses():
  {==}

# --- owner-bound project policy identity ------------------------------------
law context_snapshot_project_policy_identity_binds_present_bytes:
  {Bool.not(String.eq(Snap.identity_text("bend2", "1", [], Snap.fps_of_list([
    Snap.FpProjectPolicy{"q1", "/work", "/work/.baton/context.json", "aa"}])),
   Snap.identity_text("bend2", "1", [], Snap.fps_of_list([
    Snap.FpProjectPolicy{"q1", "/work", "/work/.baton/context.json", "bb"}])))) == True{} : Bool}

def context_snapshot_project_policy_identity_binds_present_bytes():
  {==}

law context_snapshot_project_policy_identity_binds_owner_and_worktree:
  {Bool.not(String.eq(Snap.identity_text("bend2", "1", [], Snap.fps_of_list([
    Snap.FpProjectPolicy{"q1", "/work", "/work/.baton/context.json", "aa"}])),
   Snap.identity_text("bend2", "1", [], Snap.fps_of_list([
    Snap.FpProjectPolicy{"q2", "/work", "/work/.baton/context.json", "aa"}])))) == True{} : Bool}

def context_snapshot_project_policy_identity_binds_owner_and_worktree():
  {==}

law context_snapshot_project_policy_absence_changes_when_created:
  {Snap.applies(Snap.fps_of_list([Snap.FpProjectPolicyAbsent{"q1", "/work", "/work/.baton/context.json"}]),
    Snap.RvOk{Snap.fps_of_list([Snap.FpProjectPolicy{"q1", "/work", "/work/.baton/context.json", "aa"}])}) ==
      Snap.AStale{Eng.ss_one("/work/.baton/context.json")} : Snap.Applies}

def context_snapshot_project_policy_absence_changes_when_created():
  {==}

law context_snapshot_project_policy_present_bytes_change_is_stale:
  {Snap.applies(Snap.fps_of_list([Snap.FpProjectPolicy{"q1", "/work", "/work/.baton/context.json", "aa"}]),
    Snap.RvOk{Snap.fps_of_list([Snap.FpProjectPolicy{"q1", "/work", "/work/.baton/context.json", "bb"}])}) ==
      Snap.AStale{Eng.ss_one("/work/.baton/context.json")} : Snap.Applies}

def context_snapshot_project_policy_present_bytes_change_is_stale():
  {==}

law context_snapshot_project_policy_identity_refuses_foreign_worktree:
  {Snap.applies(Snap.fps_of_list([Snap.FpProjectPolicyAbsent{"q1", "/work-a", "/work-a/.baton/context.json"}]),
    Snap.RvOk{Snap.fps_of_list([Snap.FpProjectPolicyAbsent{"q1", "/work-b", "/work-b/.baton/context.json"}])}) ==
      Snap.AStale{Eng.ss_one("/work-a/.baton/context.json")} : Snap.Applies}

def context_snapshot_project_policy_identity_refuses_foreign_worktree():
  {==}
