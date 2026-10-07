# CLAIM: the operative laws of the #683 provider-discovery and continuation surface, each
# stated over the function that implements it and proved beside its claim. The coordinator
# entry imports laws.bend, which imports this module, so every compile of the entry verifies
# every law here and an unproven or false law fails that compile.
#
# Approval: docs/bend2/laws-proposed.md carries the statements; the adopted 12b catalog
# statement is the source of the two m12b laws. This module names no model.
import Base
import ./commands.bend as C
import ./models.bend as Models
import ./probes.bend as Probes
import ./continuation.bend as Continuation

# M-12b: the served route set follows the observation. The registry's listed input
# cannot add, restrict or suppress a candidate; only the harness's own answer and the
# model's admission decide, and the registry's mapping is one of the two admissions.
law m12b_served_follows_observation:
  for registry: String
  for present: Bool
  {Continuation.usable_expr(registry, present) == "CASE WHEN " ++ Continuation.probed_expr() ++ " AND ((" ++ Continuation.configured_expr(registry, present) ++ ") OR (" ++ Continuation.listed_expr() ++ ")) THEN 1 ELSE 0 END" : String}

def m12b_served_follows_observation(registry, present):
  {==}

# M-12b: a failed or missing read is reported explicitly. Metadata that did not parse
# carries a null model list, never an empty array, so discovery failure cannot read as
# an empty catalog.
law m12b_failed_discovery_is_not_an_empty_catalog:
  {Probes.no_metadata() == "json_object('models',NULL,'absent',json('[]'))" : String}

def m12b_failed_discovery_is_not_an_empty_catalog():
  {==}

# M-14: provenance is per field. An observed row names the provider-derived model as
# observed and its harness and effort as declared at bind, so no reader mistakes a
# declared value for an observation.
law m14_a_models_answer_records_provenance_per_field:
  {Models.observed_item() == "json_object('harness',harness,'model',model,'effort',effort,'seats',json(seats),'modelProvenance','observed-provider','routeProvenance','recorded-configuration','declaredHarnessAtBind',json(declared_harness),'declaredEffortAtBind',json(declared_effort))" : String}

def m14_a_models_answer_records_provenance_per_field():
  {==}

# M-1: the continuation answer selects the stored seat row by this call's coordinate.
law m1_a_models_answer_reads_the_stored_rows:
  for session: String
  {Continuation.seat_cte(session) == "seat AS (SELECT harness,model,effort FROM sessions WHERE id=" ++ C.q(session) ++ ")" : String}

def m1_a_models_answer_reads_the_stored_rows(session):
  {==}

# M-8: the probe stores what the provider reported and decides the parse from the
# provider's own text, so a failed read stores an error row with that text rather than
# a fabricated answer.
law m8_a_probe_records_only_provider_reported_facts:
  for +reported: String
  {Probes.parse_check_sql(reported) == "SELECT CASE WHEN json_valid(" ++ C.q(reported) ++ ") AND json_type(json(" ++ C.q(reported) ++ "),'$.models')='array' AND json_array_length(json(" ++ C.q(reported) ++ "),'$.models')>0 THEN 1 ELSE 0 END;" : String}

def m8_a_probe_records_only_provider_reported_facts(reported):
  {==}

# M-8: every candidate is one of the four adapters and is either a recorded or an
# observed route. No other route can enter the candidate set.
law m8_a_continuation_proposes_only_admitted_routes:
  {Continuation.routes_cte() == "routes AS (SELECT DISTINCT harness,model,effort FROM sessions WHERE model<>'' AND " ++ Probes.adapter_set("harness") ++ " UNION SELECT DISTINCT harness,observed_model,observed_effort FROM sessions WHERE observed_model<>'' AND " ++ Probes.adapter_set("harness") ++ ")" : String}

def m8_a_continuation_proposes_only_admitted_routes():
  {==}

# M-12: no candidate asserts availability. The proposed flag is the usable decision and
# every candidate carries the fixed condition that explains it.
law m12_a_continuation_asserts_no_unobserved_capacity:
  {Continuation.candidate_item() == "json_object('harness',harness,'model',model,'effort',effort,'proposed',CASE WHEN usable=1 THEN json('true') ELSE json('false') END,'capacity',capacity,'why-not',why_not)" : String}

def m12_a_continuation_asserts_no_unobserved_capacity():
  {==}

# M-5: the probe's statement set is its own insert and the schema it needs. It reads,
# writes and reorders no message, so the inbox stays owed until receipt.
law m5_a_probe_leaves_the_inbox_in_sequence:
  for +harness: String
  for +executable: String
  for +outcome: String
  for +cause: String
  for +reported: String
  for +metadata: String
  for +capacity: String
  {Probes.record_sql(harness, executable, outcome, cause, reported, metadata, capacity) == "BEGIN IMMEDIATE;" ++ C.schema() ++ Probes.probe_insert(harness, executable, outcome, cause, reported, metadata, capacity) ++ "COMMIT;" : String}

def m5_a_probe_leaves_the_inbox_in_sequence(harness, executable, outcome, cause, reported, metadata, capacity):
  {==}
