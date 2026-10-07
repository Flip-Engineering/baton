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
  {Probes.no_metadata() == "json_object('models',NULL,'provenance',NULL,'absent',json('[]'))" : String}

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

# M-8 (finding F1): a model-scoped read lists only the identifier its own output
# echoed. The caller's string is recorded as the requested model, and an output
# with no echoed identifier states a caller-stated provenance with no listing, so a
# caller's name is never presented as provider output.
law m8_a_model_scoped_read_lists_only_the_echoed_identifier:
  for model: String
  for +reported: String
  {Probes.scoped_metadata(model, reported) == "json_object('models',CASE WHEN " ++ Probes.echoed_identifier(C.q(reported)) ++ " IS NULL THEN NULL ELSE json_array(" ++ Probes.echoed_identifier(C.q(reported)) ++ ") END,'requestedModel'," ++ C.q(model) ++ ",'provenance',CASE WHEN " ++ Probes.echoed_identifier(C.q(reported)) ++ " IS NULL THEN 'caller-stated' ELSE 'provider-echoed-request' END,'existenceProof','false','absent',json(CASE WHEN " ++ Probes.echoed_identifier(C.q(reported)) ++ " IS NULL THEN '[\"catalog\",\"model-identifier\"]' ELSE '[\"catalog\",\"model-existence\"]' END))" : String}

def m8_a_model_scoped_read_lists_only_the_echoed_identifier(model, reported):
  {==}

# M-12 (finding F2): the refusal guidance names a harness. With no recorded route
# it falls back to the seat's own recorded harness, so the entry is never null.
law m12_a_continuation_refusal_names_a_harness:
  {Continuation.first_harness() == "(SELECT coalesce((SELECT harness FROM candidates ORDER BY " ++ Continuation.order_expr() ++ " LIMIT 1),(SELECT harness FROM seat LIMIT 1)))" : String}

def m12_a_continuation_refusal_names_a_harness():
  {==}

# M-8 (#694): a catalog read groups its identifiers by the provider field the
# catalog itself states, so one provider's scope stays comparable with another's
# and two routes that share a model name remain distinguishable.
law m8_a_catalog_metadata_groups_the_provider_scopes:
  for +reported: String
  {Probes.catalog_providers(reported) == "(SELECT coalesce(json_group_array(json_object('provider',g.provider,'models',json(g.models))),json('[]')) FROM (SELECT coalesce(json_extract(v.value,'$.provider'),'') AS provider,json_group_array(coalesce(json_extract(v.value,'$.selector'),json_extract(v.value,'$.slug'),json_extract(v.value,'$.id'),json_quote(v.value))) AS models FROM json_each(json(" ++ C.q(reported) ++ "),'$.models') v GROUP BY coalesce(json_extract(v.value,'$.provider'),'') ORDER BY provider) g)" : String}

def m8_a_catalog_metadata_groups_the_provider_scopes(reported):
  {==}

# M-8 (#694): the usage document names each provider's limit windows from the
# provider's own report, and the components it withholds are named in absent.
law m8_a_usage_read_names_the_provider_windows:
  for +text: String
  {Probes.usage_providers(text) == "json(CASE WHEN json_valid(" ++ text ++ ") THEN (SELECT coalesce(json_group_array(json_object('provider',k.key,'windows',json(coalesce(k.value,'[]')))),json('[]')) FROM json_each(json(" ++ text ++ "),'$.capacity') k) ELSE '[]' END)" : String}

def m8_a_usage_read_names_the_provider_windows(text):
  {==}

# M-12 (#694): availability follows the provider's own window status. A limit the
# provider marks other than ok, or one whose used fraction reached one, is exhausted;
# stated limits with none of those are available; a provider that stated no limit is
# unknown, so an unqueried limit is never reported as an allowance.
law m12_a_usage_availability_follows_the_provider_window:
  for +text: String
  {Probes.usage_availability(text) == "json(CASE WHEN json_valid(" ++ text ++ ") THEN (SELECT coalesce(json_group_array(json_object('provider',json_extract(rp.value,'$.provider'),'state',CASE WHEN (SELECT count(*) FROM json_each(rp.value,'$.limits'))=0 THEN 'unknown' WHEN (SELECT count(*) FROM json_each(rp.value,'$.limits') l WHERE coalesce(json_extract(l.value,'$.status'),'ok')<>'ok' OR coalesce(json_extract(l.value,'$.amount.usedFraction'),0)>=1 OR (json_extract(l.value,'$.amount.remainingFraction') IS NOT NULL AND json_extract(l.value,'$.amount.remainingFraction')<=0))>0 THEN 'exhausted' ELSE 'available' END,'basis','provider-reported-window','windows',(SELECT json_group_array(json_object('window',json_extract(l.value,'$.windowId'),'status',json_extract(l.value,'$.status'),'remainingFraction',json_extract(l.value,'$.amount.remainingFraction'))) FROM json_each(rp.value,'$.limits') l))),json('[]')) FROM json_each(json(" ++ text ++ "),'$.reports') rp) ELSE '[]' END)" : String}

def m12_a_usage_availability_follows_the_provider_window(text):
  {==}
