import Base

# Values describe a route. Admission compares them with canonical host resolution
# and recorded state under custody; construction grants no authority.
type Binding is Data:
  Binding{configuration: String, harness: String, model: String, effort: String, command: String, log: String}

type Origin is Data:
  Origin{executable: String, database: String, session: String, registry: String, helper: String}

def entry_args(executable: String, database: String, session: String, binding: Binding) -> List<String>:
  match binding:
    case Binding{configuration,harness,model,effort,command,log}:
      [executable,database,"receive-configured",session,configuration,harness,model,effort,command,log]

# model is both the declared receive model and the canonical helper selection key.
# The effect owner resolves/checks helper and registry through Host.Control.
def route_args(origin: Origin, binding: Binding) -> List<String>:
  match origin:
    case Origin{executable,database,session,registry,helper}:
      match binding:
        case Binding{configuration,harness,+model,effort,command,log}:
          List.append(&1,String,["node",helper,"launch","--registry",registry,"--model-key",model,"--"],entry_args(executable,database,session,Binding{configuration,harness,model,effort,command,log}))

law configured_entry_preserves_the_complete_binding:
  {entry_args("/baton","/db","child",Binding{"1","omp","deepseek/deepseek-flash","high","/omp","/log"}) == ["/baton","/db","receive-configured","child","1","omp","deepseek/deepseek-flash","high","/omp","/log"] : List<String>}

def configured_entry_preserves_the_complete_binding():
  {==}

law configured_route_preserves_canonical_origin_and_effective_command:
  {route_args(Origin{"/baton","/db","child","/registry","/helper"},Binding{"1","omp","new","high","/omp","/log"}) == ["node","/helper","launch","--registry","/registry","--model-key","new","--","/baton","/db","receive-configured","child","1","omp","new","high","/omp","/log"] : List<String>}

def configured_route_preserves_canonical_origin_and_effective_command():
  {==}
