import Base
import ./commands.bend as C

# Proposed common binding for the original Receive owner. No caller uses this
# entry until the matching Receive admission and continuation exports compose.
type Binding is Data:
  Binding{configuration: String, harness: String, model: String, effort: String, command: String, log: String}

def entry_args(executable: String, database: String, session: String, binding: Binding) -> List<String>:
  match binding:
    case Binding{configuration,harness,model,effort,command,log}:
      [executable,database,"receive-configured",session,configuration,harness,model,effort,command,log]

# The configured identity wrapper has eight fields before the native argv.
# A configuration ID lives in the existing endpoint, which is the authoritative
# comparison value. The full tuple is compared as well as that ID.
def binding_predicate(database: String, executable: String, session: String, binding: Binding) -> String:
  match binding:
    case Binding{+configuration,+harness,+model,+effort,command,log}:
      "(id=" ++ C.q(session) ++ " AND harness=" ++ C.q(harness) ++ " AND model=" ++ C.q(model) ++ " AND effort=" ++ C.q(effort)
      ++ " AND CASE WHEN json_valid(endpoint) THEN json_type(endpoint)='array' AND json_array_length(endpoint)=18"
      ++ " AND NOT EXISTS(SELECT 1 FROM json_each(endpoint) WHERE type<>'text' OR instr(value,char(0))>0)"
      ++ " AND json_extract(endpoint,'$[0]')='node' AND json_extract(endpoint,'$[1]')<>''"
      ++ " AND json_extract(endpoint,'$[2]')='launch' AND json_extract(endpoint,'$[3]')='--registry' AND json_extract(endpoint,'$[4]')<>''"
      ++ " AND json_extract(endpoint,'$[5]')='--model-key' AND json_extract(endpoint,'$[6]')=" ++ C.q(model)
      ++ " AND json_extract(endpoint,'$[7]')='--' AND json_extract(endpoint,'$[8]')=" ++ C.q(executable)
      ++ " AND json_extract(endpoint,'$[9]')=" ++ C.q(database) ++ " AND json_extract(endpoint,'$[10]')='receive-configured'"
      ++ " AND json_extract(endpoint,'$[11]')=id AND json_extract(endpoint,'$[12]')=" ++ C.q(configuration)
      ++ " AND " ++ C.q(configuration) ++ "<>'' AND json_extract(endpoint,'$[13]')=" ++ C.q(harness)
      ++ " AND json_extract(endpoint,'$[14]')=" ++ C.q(model) ++ " AND json_extract(endpoint,'$[15]')=" ++ C.q(effort)
      ++ " AND json_extract(endpoint,'$[16]')=" ++ C.q(command) ++ " AND json_extract(endpoint,'$[17]')=" ++ C.q(log)
      ++ " ELSE 0 END)"

# The owner must evaluate this under the canonical session guard, before new
# attempt admission. A true value does not authorize bypassing stopped state,
# retained-attempt recovery, hierarchy checks or actual series selection.
def admission_sql(database: String, executable: String, session: String, binding: Binding) -> String:
  "SELECT EXISTS(SELECT 1 FROM sessions WHERE " ++ binding_predicate(database,executable,session,binding) ++ ");"

law configured_entry_preserves_the_complete_binding:
  {entry_args("/baton","/db","child",Binding{"revision","omp","deepseek/deepseek-flash","high","/omp","/log"}) == ["/baton","/db","receive-configured","child","revision","omp","deepseek/deepseek-flash","high","/omp","/log"] : List<String>}

def configured_entry_preserves_the_complete_binding():
  {==}
