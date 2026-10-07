# #683 continuation selection: which recorded routes a failed seat can continue on.
#
# The candidate set is the union of the routes recorded in sessions and the routes
# observed from provider events, restricted to the four turn adapters. A candidate is
# usable when the latest probe of its harness succeeded and its model is either a
# configured registry alias or one the probe listed. Ordering is deterministic and
# every candidate carries its basis, so a route is never proposed on the strength of
# a registry key, a past use, or a capacity the provider did not state.
import Base
import ./commands.bend as C
import ./probes.bend as Probes

def seat_cte(session: String) -> String:
  "seat AS (SELECT harness,model,effort FROM sessions WHERE id=" ++ C.q(session) ++ ")"

def routes_cte() -> String:
  "routes AS (SELECT DISTINCT harness,model,effort FROM sessions WHERE model<>'' AND " ++ Probes.adapter_set("harness")
  ++ " UNION SELECT DISTINCT harness,observed_model,observed_effort FROM sessions WHERE observed_model<>'' AND " ++ Probes.adapter_set("harness") ++ ")"

# A candidate is proposed only when the harness answered a metadata read and the
# model is admitted by the registry or by that read.
def configured_expr(registry: String, present: Bool) -> String:
  Bool.pick(String,present,"EXISTS(SELECT 1 FROM json_each(json(" ++ C.q(registry) ++ "),'$.models') m WHERE m.key=c.model)","0")

def listed_expr() -> String:
  "EXISTS(SELECT 1 FROM json_each(json(coalesce(json_extract(p.metadata,'$.models'),'[]'))) e WHERE e.value=c.model)"

def probed_expr() -> String:
  "(p.harness IS NOT NULL AND p.outcome='ok')"

def usable_expr(registry: String, present: Bool) -> String:
  "CASE WHEN " ++ probed_expr() ++ " AND ((" ++ configured_expr(registry,present) ++ ") OR (" ++ listed_expr() ++ ")) THEN 1 ELSE 0 END"

# The same-harness tiers take precedence, ties break by harness, model and effort.
def tier_expr() -> String:
  "CASE WHEN c.harness=s.harness AND c.model<>s.model THEN 0 WHEN c.harness=s.harness AND c.model=s.model AND c.effort=s.effort THEN 1 WHEN c.harness<>s.harness THEN 2 ELSE 3 END"

def why_not(registry: String, present: Bool) -> String:
  "CASE WHEN " ++ usable_expr(registry,present) ++ "=1 THEN NULL WHEN NOT " ++ probed_expr() ++ " THEN 'no successful probe of this harness; probe it to establish the route' ELSE 'the model is neither a configured alias nor listed by this harness read' END"

def candidates_sql(+registry: String, +present: Bool) -> String:
  "candidates AS (SELECT c.harness AS harness,c.model AS model,c.effort AS effort,"
  ++ usable_expr(registry,present) ++ " AS usable,"
  ++ tier_expr() ++ " AS tier,"
  ++ Probes.capacity_state("p") ++ " AS capacity,"
  ++ why_not(registry,present) ++ " AS why_not"
  ++ " FROM routes c CROSS JOIN seat s LEFT JOIN latest p ON p.harness=c.harness)"

def order_expr() -> String:
  "usable DESC,tier,harness,model,effort"

def order_qualified() -> String:
  "candidates.usable DESC,candidates.tier,candidates.harness,candidates.model,candidates.effort"

def candidate_item() -> String:
  "json_object('harness',harness,'model',model,'effort',effort,'proposed',CASE WHEN usable=1 THEN json('true') ELSE json('false') END,'capacity',capacity,'why-not',why_not)"

def usable_total() -> String:
  "(SELECT count(*) FROM candidates WHERE usable=1)"

def candidates_array() -> String:
  "json((SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ candidate_item() ++ " AS item FROM candidates ORDER BY " ++ order_expr() ++ ")))"

# The basis names which of the two admissions established a proposed candidate. A
# listed candidate matched the identifier its own harness reported, exactly; a bare
# id is not matched against another provider's selector.
def basis_expr() -> String:
  "CASE WHEN EXISTS(SELECT 1 FROM json_each(json(coalesce(json_extract(p2.metadata,'$.models'),'[]'))) e WHERE e.value=candidates.model) THEN 'listed-exact-selector' ELSE 'configured-registry-alias' END"

def proposal_expr() -> String:
  "CASE WHEN " ++ usable_total() ++ "=0 THEN NULL ELSE json((SELECT json_object('harness',candidates.harness,'model',candidates.model,'effort',candidates.effort,'capacity',candidates.capacity,'basis'," ++ basis_expr() ++ ") FROM candidates LEFT JOIN latest p2 ON p2.harness=candidates.harness WHERE candidates.usable=1 ORDER BY " ++ order_qualified() ++ " LIMIT 1)) END"

def unknown_array() -> String:
  "json((SELECT coalesce(json_group_array(json_object('harness',harness,'model',model,'effort',effort)),json('[]')) FROM candidates ORDER BY harness,model,effort))"

def first_harness() -> String:
  "(SELECT harness FROM candidates ORDER BY " ++ order_expr() ++ " LIMIT 1)"

def first_executable() -> String:
  "(SELECT json_extract(s.endpoint,'$[0]') FROM sessions s WHERE s.harness=" ++ first_harness() ++ " AND s.endpoint<>'' AND json_valid(s.endpoint) AND json_type(s.endpoint)='array' ORDER BY s.rowid DESC LIMIT 1)"

# No usable candidate answers with the would-be candidates still visible, which is
# the 12b rule that failed discovery is reported and not asserted away.
def refusal_expr(session: String) -> String:
  "CASE WHEN " ++ usable_total() ++ ">0 THEN NULL ELSE json((SELECT json_object('error','continuation-capacity-unknown','session'," ++ C.q(session)
  ++ ",'condition','No candidate route is established as usable for this seat. A successful metadata read of one of the listed harnesses establishes the first; a provider that states no quota leaves its capacity unknown.',"
  ++ "'unknown'," ++ unknown_array() ++ ",'next',json_array('provider-probe'," ++ first_harness() ++ ",coalesce(" ++ first_executable() ++ ",''))) FROM (SELECT 1))) END"

def seat_object(session: String) -> String:
  "(SELECT json_object('harness',s.harness,'model',s.model,'effort',s.effort,'stopped',EXISTS(SELECT 1 FROM session_stops WHERE session=s.id),'pendingInputs',(SELECT count(*) FROM messages m WHERE m.recipient=s.id AND m.receipt IS NULL)) FROM sessions s WHERE s.id=" ++ C.q(session) ++ ")"

def continuation_object(+session: String, +registry: String, +present: Bool) -> String:
  "(SELECT json_object('session'," ++ C.q(session) ++ ",'seat'," ++ seat_object(session) ++ ",'candidates'," ++ candidates_array() ++ ",'proposal'," ++ proposal_expr() ++ ",'refusal'," ++ refusal_expr(session) ++ "))"

def continuation_cte(session: String, registry: String, present: Bool) -> String:
  Probes.latest_cte() ++ "," ++ seat_cte(session) ++ "," ++ routes_cte() ++ "," ++ candidates_sql(registry,present)
