import Base
import ./agent-actions.bend as A
import ./agent-domain.bend as Domain

type Context is Type:
  Explicit{db: String, session: String, args: List<String>}
  Project{path: String, session: String, args: List<String>}
  Current{session: String, args: List<String>}
  Implicit{path: String, registered: Bool, action: A.Action}
  InDatabase{db: String, action: A.Action}

type Route is Type:
  Action{context: Context}
  Legacy{args: List<String>}

type Head is Data:
  CurrentHead{}
  ImplicitHead{}
  ProjectHead{}
  DatabaseHead{}

type TailVerb is Data:
  AsVerb{}
  InboxVerb{}
  ActionVerb{}
  OtherVerb{}

def contextual_verb(+verb: String) -> Bool:
  Bool.or(String.eq(verb,"session"),
    Bool.or(String.eq(verb,"player"),
      Bool.or(String.eq(verb,"players"),
        Bool.or(String.eq(verb,"assignment"),
          Bool.or(String.eq(verb,"completion-request"),
            Bool.or(String.eq(verb,"completion-confirmed"),
              Bool.or(String.eq(verb,"repl"),Bool.or(String.eq(verb,"guide"),Domain.known(verb)))))))))

def action_verb(+verb: String, project: Bool) -> Bool:
  Bool.or(String.eq(verb,"read"),
    Bool.or(String.eq(verb,"send"),
      Bool.or(String.eq(verb,"acknowledge"),
        Bool.or(String.eq(verb,"completion-request"),
          Bool.or(String.eq(verb,"completion-confirmed"),
            Bool.or(String.eq(verb,"guide"),Bool.and(project,String.eq(verb,"help"))))))))

def classify_head(+verb: String) -> Head:
  Bool.pick(Head,String.eq(verb,"as"),CurrentHead{},
    Bool.pick(Head,Bool.or(String.eq(verb,"inbox"),action_verb(verb,True{})),ImplicitHead{},
      Bool.pick(Head,String.eq(verb,"--project"),ProjectHead{},DatabaseHead{})))

def classify_tail(+verb: String, project: Bool) -> TailVerb:
  Bool.pick(TailVerb,String.eq(verb,"as"),AsVerb{},
    Bool.pick(TailVerb,String.eq(verb,"inbox"),InboxVerb{},
      Bool.pick(TailVerb,action_verb(verb,project),ActionVerb{},OtherVerb{})))

def database_as(db: String, args: List<String>) -> Route:
  match args:
    case session <> rest: Action{Explicit{db,session,rest}}
    case Nil{}: Legacy{Con{db,Con{"as",Nil{}}}}

def database_inbox(db: String, args: List<String>) -> Route:
  match args:
    case Nil{}: Action{InDatabase{db,A.Inbox{}}}
    case other: Legacy{Con{db,Con{"inbox",other}}}

def help_flag(+value: String) -> Bool:
  Bool.or(String.eq(value,"--help"),String.eq(value,"-h"))

def named_start(+verb: String, args: List<&2,String>) -> Bool:
  match args:
    case Nil{}: False{}
    case +head <> rest:
      Bool.or(help_flag(head),
        Bool.or(Domain.member(head,Domain.names(Bool.pick(String,String.eq(verb,"knowledge"),"knowledge-read",verb))),
          Bool.and(String.eq(verb,"knowledge"),Domain.member(head,["and","--and"]))))

def database_named(+verb: String, +args: List<&2,String>) -> Bool:
  match args:
    case Nil{}: String.eq(verb,"knowledge")
    case +head <> rest:
      +compound = Domain.subverb(verb,head)
      Bool.and(Domain.known(verb),
        Bool.pick(Bool,String.is_empty(compound),
          Bool.pick(Bool,Domain.member(verb,["status","players","orchestra","pending"]),
            Bool.or(help_flag(head),A.batch_tokens(args,False{})),named_start(verb,args)),
          True{}))

def database_other(+db: String, +verb: String, +args: List<&2,String>) -> Route:
  Bool.pick(Route,Bool.or(Domain.member(verb,["repl","help","--help","-h"]),database_named(verb,args)),
    Action{InDatabase{db,A.parse(Con{verb,Domain.affine_strings(args)})}},
    Legacy{Con{db,Con{verb,Domain.affine_strings(args)}}})

def database_verb(kind: TailVerb, db: String, verb: String, args: List<String>) -> Route:
  match kind:
    case AsVerb{}: database_as(db,args)
    case InboxVerb{}: database_inbox(db,args)
    case ActionVerb{}: Action{InDatabase{db,A.parse(Con{verb,args})}}
    case OtherVerb{}: database_other(db,verb,Domain.shared_strings(args))

def database_args(db: String, args: List<String>) -> Route:
  match args:
    case Nil{}: Legacy{Con{db,Nil{}}}
    case +verb <> rest: database_verb(classify_tail(verb,False{}),db,verb,rest)

def project_as(path: String, args: List<String>) -> Route:
  match args:
    case session <> rest: Action{Project{path,session,rest}}
    case Nil{}: database_args("--project",Con{path,Con{"as",Nil{}}})

def project_inbox(path: String, args: List<String>) -> Route:
  match args:
    case Nil{}: Action{Implicit{path,True{},A.Inbox{}}}
    case other: database_args("--project",Con{path,Con{"inbox",other}})

def project_verb(kind: TailVerb, path: String, verb: String, args: List<String>) -> Route:
  match kind:
    case AsVerb{}: project_as(path,args)
    case InboxVerb{}: project_inbox(path,args)
    case ActionVerb{}: Action{Implicit{path,True{},A.parse(Con{verb,args})}}
    case OtherVerb{}: database_args("--project",Con{path,Con{verb,args}})

def project_contextual(known: Bool, path: String, +verb: String, args: List<String>) -> Route:
  match known:
    case True{}: Action{Implicit{path,True{},A.parse(Con{verb,args})}}
    case False{}: project_verb(classify_tail(verb,True{}),path,verb,args)

def project_args(args: List<String>) -> Route:
  match args:
    case path <> +verb <> rest: project_contextual(contextual_verb(verb),path,verb,rest)
    case other: database_args("--project",other)

def current_args(args: List<String>) -> Route:
  match args:
    case session <> rest: Action{Current{session,rest}}
    case Nil{}: Legacy{Con{"as",Nil{}}}

def head_route(kind: Head, verb: String, args: List<String>) -> Route:
  match kind:
    case CurrentHead{}: current_args(args)
    case ImplicitHead{}: Action{Implicit{".",False{},A.parse(Con{verb,args})}}
    case ProjectHead{}: project_args(args)
    case DatabaseHead{}: database_args(verb,args)

def leading_contextual(known: Bool, +verb: String, args: List<String>) -> Route:
  match known:
    case True{}: Action{Implicit{".",False{},A.parse(Con{verb,args})}}
    case False{}: head_route(classify_head(verb),verb,args)

def parse(args: List<String>) -> Route:
  match args:
    case Nil{}: Legacy{Nil{}}
    case +verb <> rest: leading_contextual(contextual_verb(verb),verb,rest)
