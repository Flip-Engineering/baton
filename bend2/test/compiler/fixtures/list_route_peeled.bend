import Base

type Route is Data:
  Settings{project: String}
  Contextual{session: String, action: List<String>}
  Legacy{rest: List<String>}

def join(xs: List<String>) -> String:
  match xs:
    case Nil{}: ""
    case +x <> +rest: x ++ "," ++ join(rest)

def shown(+index: U32, +verb: String, +path: String, +exe: String, +db: String, +kind: String, +tail: String) -> String:
  kind ++ "|" ++ U32.show(index) ++ "|" ++ verb ++ "|" ++ path ++ "|" ++ exe ++ "|" ++ db ++ "|" ++ tail

def whole(+index: U32, +verb: String, +args: List<String>, +path: String) -> String:
  match args:
    case exe <> db <> "--project-settings" <> project <> Nil{}: shown(index,verb,path,exe,"-","settings",project)
    case exe <> db <> "agent-contextual-input" <> session <> action: shown(index,verb,path,exe,db,"contextual",session ++ ";" ++ join(action))
    case exe <> db <> legacy: shown(index,verb,path,exe,db,"legacy",join(legacy))
    case other: "missing"

def classify(tail: List<String>) -> Route:
  match tail:
    case "--project-settings" <> project <> Nil{}: Settings{project}
    case "agent-contextual-input" <> session <> action: Contextual{session,action}
    case legacy: Legacy{legacy}

def peeled_tail(+index: U32, +verb: String, +path: String, +exe: String, +db: String, +tail: List<String>) -> String:
  match classify(tail):
    case Settings{project}: shown(index,verb,path,exe,"-","settings",project)
    case Contextual{session,action}: shown(index,verb,path,exe,db,"contextual",session ++ ";" ++ join(action))
    case Legacy{legacy}: shown(index,verb,path,exe,db,"legacy",join(legacy))

def peeled(+index: U32, +verb: String, +args: List<String>, +path: String) -> String:
  match args:
    case exe <> db <> tail: peeled_tail(index,verb,path,exe,db,tail)
    case other: "missing"

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(whole(7,"verb",args,"p"))
    IO.print(peeled(7,"verb",args,"p"))
