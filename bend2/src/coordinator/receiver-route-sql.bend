import Base
import ./commands.bend as C
import ./control.bend as Control
import ./receiver-route-protocol.bend as Protocol

# The caller supplies canonical, checked origin values. Compare every literal
# endpoint field, including helper/registry, executable, command and output path.
def binding_predicate(origin: Protocol.Origin, +binding: Protocol.Binding) -> String:
  match origin:
    case Protocol.Origin{+executable,+database,+session,+registry,+helper}:
      match binding:
        case Protocol.Binding{+configuration,+harness,+model,+effort,+command,+log}:
          "(id=" ++ C.q(session) ++ " AND harness=" ++ C.q(harness) ++ " AND model=" ++ C.q(model) ++ " AND effort=" ++ C.q(effort)
          ++ " AND " ++ C.q(configuration) ++ "<>'' AND " ++ C.q(registry) ++ "<>'' AND " ++ C.q(helper) ++ "<>''"
          ++ " AND CASE WHEN json_valid(endpoint) THEN json(endpoint)=json("
          ++ C.q("[" ++ Control.strings(Protocol.route_args(Protocol.Origin{executable,database,session,registry,helper},Protocol.Binding{configuration,harness,model,effort,command,log})) ++ "]")
          ++ ") ELSE 0 END)"

# Original-attempt recovery precedes this next-admission check. This query does
# not check stops, native custody, provider success or actual spawn environment.
def admission_sql(origin: Protocol.Origin, binding: Protocol.Binding) -> String:
  "SELECT EXISTS(SELECT 1 FROM sessions WHERE " ++ binding_predicate(origin,binding) ++ ");"
