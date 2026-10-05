# CLAIM: the operative laws of reference identity and expansion admission in
# bend2/src/context/refs.bend. Each law fixes the actual function's answer for
# one stored reference and one request, and the id laws pin the exact canonical
# array text, so a reference is compared as one string and never split on
# punctuation.

import Base
import ./engines.bend as Eng
import ./snapshot.bend as Snap
import ./refs.bend as Refs

# --- reference id text -------------------------------------------------------
law context_refs_a_source_id_is_a_canonical_array:
  {Refs.source_ref("/work/a.ts", "sha", 40, 17, "definition") == "[\"source\",\"/work/a.ts\",\"sha\",40,17,\"definition\"]" : String}

def context_refs_a_source_id_is_a_canonical_array():
  {==}

law context_refs_a_runtime_id_names_runtime_adapter_thread_epoch_generation_kind_handle:
  {Refs.runtime_ref("rt:q7", "ad:1", "worker:2", "3", "5", "object", "handle:9") == "[\"runtime\",\"rt:q7\",\"ad:1\",\"worker:2\",\"3\",\"5\",\"object\",\"handle:9\"]" : String}

def context_refs_a_runtime_id_names_runtime_adapter_thread_epoch_generation_kind_handle():
  {==}

# A monotone lifetime counter is carried as its exact decimal text, so a
# counter above the U32 range stays distinct and cannot wrap into an earlier
# lifetime and re-admit a stale reference.
law context_refs_a_runtime_id_keeps_an_unbounded_lifetime_counter:
  {Refs.runtime_ref("rt:q7", "ad:1", "worker:2", "9007199254740993", "18446744073709551617", "object", "handle:9") == "[\"runtime\",\"rt:q7\",\"ad:1\",\"worker:2\",\"9007199254740993\",\"18446744073709551617\",\"object\",\"handle:9\"]" : String}

def context_refs_a_runtime_id_keeps_an_unbounded_lifetime_counter():
  {==}

law context_refs_a_quoted_component_is_escaped:
  {Refs.encode([Refs.Rt{"a\"b"}, Refs.Rn{7}, Refs.Rz{}]) == "[\"a\\\"b\",7,null]" : String}

def context_refs_a_quoted_component_is_escaped():
  {==}

law context_refs_a_backslash_component_is_escaped:
  {Refs.encode([Refs.Rt{"a\\b"}]) == "[\"a\\\\b\"]" : String}

def context_refs_a_backslash_component_is_escaped():
  {==}

law context_refs_a_separator_is_not_a_split_point:
  {Refs.encode([Refs.Rt{"a,b"}, Refs.Rt{"c"}]) == "[\"a,b\",\"c\"]" : String}

def context_refs_a_separator_is_not_a_split_point():
  {==}

# --- expansion admission -----------------------------------------------------
law context_refs_an_unknown_id_refuses:
  {Refs.admit(Refs.RQ{False{}, "symbol", "pol-a", "pol-a", Eng.SSNil{}, Eng.SSNil{}, Snap.ACurrent{}, Eng.SSNil{}, Eng.SSNil{}, "[\"source\",\"/w/a.c\",\"sha\",3,1,\"type\"]"}) == Refs.RUnknownId{} : Refs.RefDecision}

def context_refs_an_unknown_id_refuses():
  {==}

law context_refs_an_unsupported_subject_refuses:
  {Refs.admit(Refs.RQ{True{}, "query-control", "pol-a", "pol-a", Eng.ss_one("state"), Eng.ss_one("state"), Snap.ACurrent{}, Eng.SSNil{}, Eng.SSNil{}, "[]"}) == Refs.RSubjectRefused{"query-control"} : Refs.RefDecision}

def context_refs_an_unsupported_subject_refuses():
  {==}

law context_refs_a_stale_snapshot_returns_the_fresh_selector:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_one("definition"), Eng.ss_one("definition"), Snap.AStale{Eng.ss_one("/work/a.c")}, Eng.SSNil{}, Eng.SSNil{}, "[\"source\",\"/w/a.c\",\"fresh\",3,1,\"definition\"]"}) == Refs.RStaleRef{"[\"source\",\"/w/a.c\",\"fresh\",3,1,\"definition\"]"} : Refs.RefDecision}

def context_refs_a_stale_snapshot_returns_the_fresh_selector():
  {==}

law context_refs_a_historical_snapshot_returns_the_fresh_selector:
  {Refs.admit(Refs.RQ{True{}, "runtime", "pol-a", "pol-a", Eng.ss_one("values"), Eng.ss_one("values"), Snap.AHistorical{"runtime epoch advanced"}, Eng.SSNil{}, Eng.SSNil{}, "[\"runtime\",\"rt:q7\",\"fresh\"]"}) == Refs.RStaleRef{"[\"runtime\",\"rt:q7\",\"fresh\"]"} : Refs.RefDecision}

def context_refs_a_historical_snapshot_returns_the_fresh_selector():
  {==}

law context_refs_a_failed_revalidation_does_not_expand:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_one("definition"), Eng.ss_one("definition"), Snap.AUnknown{"the read probe failed"}, Eng.SSNil{}, Eng.SSNil{}, "[]"}) == Refs.RUnverified{"the read probe failed"} : Refs.RefDecision}

def context_refs_a_failed_revalidation_does_not_expand():
  {==}

law context_refs_a_missing_grant_refuses_before_expansion:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_one("authorization"), Eng.ss_one("authorization"), Snap.ACurrent{}, Eng.ss_one("planTargetSql"), Eng.SSNil{}, "[]"}) == Refs.REffectMissing{"planTargetSql"} : Refs.RefDecision}

def context_refs_a_missing_grant_refuses_before_expansion():
  {==}

law context_refs_a_granted_effect_is_not_reported_missing:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_one("authorization"), Eng.ss_one("authorization"), Snap.ACurrent{}, Eng.ss_one("planTargetSql"), Eng.ss_one("planTargetSql"), "[]"}) == Refs.RAllow{Eng.ss_one("authorization")} : Refs.RefDecision}

def context_refs_a_granted_effect_is_not_reported_missing():
  {==}

law context_refs_a_projection_outside_the_stored_selector_refuses:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_one("definition"), Eng.ss_two("definition", "calls"), Snap.ACurrent{}, Eng.SSNil{}, Eng.SSNil{}, "[]"}) == Refs.RProjectionRefused{"calls"} : Refs.RefDecision}

def context_refs_a_projection_outside_the_stored_selector_refuses():
  {==}

law context_refs_an_admitted_projection_expands_the_stored_selector:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_two("definition", "calls"), Eng.ss_one("calls"), Snap.ACurrent{}, Eng.SSNil{}, Eng.SSNil{}, "[]"}) == Refs.RAllow{Eng.ss_one("calls")} : Refs.RefDecision}

def context_refs_an_admitted_projection_expands_the_stored_selector():
  {==}

law context_refs_a_c_ref_projection_needs_its_planning_grant:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-a", Eng.ss_two("authorization", "databaseAccesses"), Eng.ss_two("authorization", "databaseAccesses"), Snap.ACurrent{}, Eng.ss_one("planTargetSql"), Eng.SSNil{}, "[]"}) == Refs.REffectMissing{"planTargetSql"} : Refs.RefDecision}

def context_refs_a_c_ref_projection_needs_its_planning_grant():
  {==}

# --- the stored selector boundary --------------------------------------------
# The producer emits a full selector object; the record keeps its exact text and
# the derived kind beside it, so admission never matches selector text.
law context_refs_the_record_preserves_the_selector_text:
  {Refs.ref_selector(Refs.Ref{"[\"source\",\"/w/a.c\",\"sha\",3,1,\"definition\"]", "clangd", "symbol", "{\"kind\":\"symbol\",\"path\":\"/w/a.c\",\"name\":\"view_list\"}", "snap-a", "pol-a", Eng.ss_one("definition")}) == "{\"kind\":\"symbol\",\"path\":\"/w/a.c\",\"name\":\"view_list\"}" : String}

def context_refs_the_record_preserves_the_selector_text():
  {==}

law context_refs_the_record_carries_the_kind_the_owner_derived:
  {Refs.ref_subject_kind(Refs.Ref{"[\"source\",\"/w/a.c\",\"sha\",3,1,\"definition\"]", "clangd", "symbol", "{\"kind\":\"symbol\",\"path\":\"/w/a.c\",\"name\":\"view_list\"}", "snap-a", "pol-a", Eng.ss_one("definition")}) == "symbol" : String}

def context_refs_the_record_carries_the_kind_the_owner_derived():
  {==}

law context_refs_the_record_carries_the_original_policy:
  {Refs.ref_policy(Refs.Ref{"[\"source\",\"/w/a.c\",\"sha\",3,1,\"definition\"]", "clangd", "symbol", "{\"kind\":\"symbol\"}", "snap-a", "pol-a", Eng.ss_one("definition")}) == "pol-a" : String}

def context_refs_the_record_carries_the_original_policy():
  {==}

# --- original policy association ---------------------------------------------
# The current request cannot establish the policy a retained selector was
# created under, so a reference whose recorded policy differs from the presented
# one refuses before snapshot applicability, effects and projections.
law context_refs_a_reference_from_another_policy_refuses:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-b", Eng.ss_one("definition"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.SSNil{}, Eng.SSNil{}, "[]"}) == Refs.RPolicyRefused{"pol-a", "pol-b"} : Refs.RefDecision}

def context_refs_a_reference_from_another_policy_refuses():
  {==}

law context_refs_the_policy_is_decided_before_the_snapshot:
  {Refs.admit(Refs.RQ{True{}, "symbol", "pol-a", "pol-b", Eng.ss_one("definition"), Eng.ss_one("definition"), Snap.AStale{Eng.ss_one("/work/a.c")}, Eng.SSNil{}, Eng.SSNil{}, "[]"}) == Refs.RPolicyRefused{"pol-a", "pol-b"} : Refs.RefDecision}

def context_refs_the_policy_is_decided_before_the_snapshot():
  {==}

law context_refs_the_policy_refusal_is_named:
  {Refs.condition(Refs.RPolicyRefused{"pol-a", "pol-b"}) == "refPolicyMismatch" : String}

def context_refs_the_policy_refusal_is_named():
  {==}

# --- refusal condition vocabulary --------------------------------------------
law context_refs_the_stale_condition_is_named_stale_reference:
  {Refs.condition(Refs.RStaleRef{"[]"}) == "staleReference" : String}

def context_refs_the_stale_condition_is_named_stale_reference():
  {==}

law context_refs_the_admitting_condition_is_ok:
  {Refs.condition(Refs.RAllow{Eng.SSNil{}}) == "ok" : String}

def context_refs_the_admitting_condition_is_ok():
  {==}

law context_refs_the_unknown_condition_is_named:
  {Refs.condition(Refs.RUnknownId{}) == "unknownReference" : String}

def context_refs_the_unknown_condition_is_named():
  {==}

# --- classification preservation ---------------------------------------------
law context_refs_expansion_cannot_strengthen_an_observation:
  {Refs.weaker(Refs.CObserved{}, Refs.CDeclared{}) == Refs.CDeclared{} : Refs.Classification}

def context_refs_expansion_cannot_strengthen_an_observation():
  {==}

law context_refs_expansion_cannot_strengthen_a_declaration:
  {Refs.weaker(Refs.CDeclared{}, Refs.CObserved{}) == Refs.CDeclared{} : Refs.Classification}

def context_refs_expansion_cannot_strengthen_a_declaration():
  {==}

law context_refs_expansion_of_equal_classifications_keeps_that_classification:
  {Refs.weaker(Refs.CObserved{}, Refs.CObserved{}) == Refs.CObserved{} : Refs.Classification}

def context_refs_expansion_of_equal_classifications_keeps_that_classification():
  {==}

law context_refs_expansion_keeps_the_weaker_of_checked_and_static:
  {Refs.weaker(Refs.CChecked{}, Refs.CStaticPossible{}) == Refs.CStaticPossible{} : Refs.Classification}

def context_refs_expansion_keeps_the_weaker_of_checked_and_static():
  {==}

law context_refs_expansion_keeps_the_weaker_of_observed_and_checked:
  {Refs.weaker(Refs.CObserved{}, Refs.CChecked{}) == Refs.CChecked{} : Refs.Classification}

def context_refs_expansion_keeps_the_weaker_of_observed_and_checked():
  {==}
