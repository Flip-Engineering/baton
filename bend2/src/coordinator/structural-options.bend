import Base

type Membership is Data:
  Ensemble{ensemble: String, owner: String}
  Section{ensemble: String, owner: String, section: String}

type RecruitOptions is Type:
  Options{role: String, memberships: List<Membership>}

type Pending is Data:
  Flag{}
  RoleValue{}
  EnsembleName{}
  EnsembleOwner{ensemble: String}
  SectionEnsemble{}
  SectionOwner{ensemble: String}
  SectionName{ensemble: String, owner: String}

type RecruitState is Type:
  Acc{role: String, memberships: List<Membership>, pending: Pending}
  Bad{reason: String}

def valid_role(+role: String) -> Bool:
  Bool.or(String.eq(role,"player"),String.eq(role,"associate-conductor"))

def role_value(value: String, memberships: List<Membership>, allowed: Bool) -> RecruitState:
  match allowed:
    case True{}: Acc{value,memberships,Flag{}}
    case False{}: Bad{"Use one --role player|associate-conductor."}

def section_selected(role: String, memberships: List<Membership>, matched: Bool) -> RecruitState:
  match matched:
    case True{}: Acc{role,memberships,SectionEnsemble{}}
    case False{}: Bad{"Unknown recruit option; read help for the extended grammar."}

def ensemble_selected(flag: String, role: String, memberships: List<Membership>, matched: Bool) -> RecruitState:
  match matched:
    case True{}: Acc{role,memberships,EnsembleName{}}
    case False{}: section_selected(role,memberships,String.eq(flag,"--section"))

def role_selected(+flag: String, role: String, memberships: List<Membership>, matched: Bool) -> RecruitState:
  match matched:
    case True{}: Acc{role,memberships,RoleValue{}}
    case False{}: ensemble_selected(flag,role,memberships,String.eq(flag,"--ensemble"))

def recruit_token(+token: String, +role: String, memberships: List<Membership>, pending: Pending) -> RecruitState:
  match pending:
    case Flag{}: role_selected(token,role,memberships,String.eq(token,"--role"))
    case RoleValue{}: role_value(token,memberships,Bool.and(String.is_empty(role),valid_role(token)))
    case EnsembleName{}: Acc{role,memberships,EnsembleOwner{token}}
    case EnsembleOwner{ensemble}: Acc{role,Ensemble{ensemble,token} <> memberships,Flag{}}
    case SectionEnsemble{}: Acc{role,memberships,SectionOwner{token}}
    case SectionOwner{ensemble}: Acc{role,memberships,SectionName{ensemble,token}}
    case SectionName{ensemble,owner}: Acc{role,Section{ensemble,owner,token} <> memberships,Flag{}}

def recruit_step(token: String, state: RecruitState) -> RecruitState:
  match state:
    case Acc{role,memberships,pending}: recruit_token(token,role,memberships,pending)
    case Bad{reason}: Bad{reason}

def role_required(role: String, memberships: List<Membership>, present: Bool) -> Result<&1,&1,String,RecruitOptions>:
  match present:
    case True{}: Done{Options{role,memberships}}
    case False{}: Fail{"Extended recruit requires --role player|associate-conductor."}

def recruit_complete(+role: String, memberships: List<Membership>, pending: Pending) -> Result<&1,&1,String,RecruitOptions>:
  match pending:
    case Flag{}: role_required(role,memberships,Bool.not(String.is_empty(role)))
    case _: Fail{"Incomplete recruit option; read help for its fixed arguments."}

def recruit_finish(state: RecruitState) -> Result<&1,&1,String,RecruitOptions>:
  match state:
    case Acc{role,memberships,pending}: recruit_complete(role,memberships,pending)
    case Bad{reason}: Fail{reason}

def recruit_loop(args: List<String>, state: RecruitState) -> Result<&1,&1,String,RecruitOptions>:
  match args:
    case Nil{}: recruit_finish(state)
    case token <> rest: recruit_loop(rest,recruit_step(token,state))

def recruit(args: List<String>) -> Result<&1,&1,String,RecruitOptions>:
  recruit_loop(args,Acc{"",Nil{},Flag{}})

type Declaration is Data:
  Decl{section: String, capability: String}

type EnsembleOptions is Type:
  Sections{values: List<Declaration>}

type DeclarationPending is Data:
  DeclarationFlag{}
  DeclarationName{}
  Capability{section: String}

type EnsembleState is Type:
  Declarations{sections: List<Declaration>, pending: DeclarationPending}
  Invalid{reason: String}

def declaration_flag(sections: List<Declaration>, matched: Bool) -> EnsembleState:
  match matched:
    case True{}: Declarations{sections,DeclarationName{}}
    case False{}: Invalid{"Use --section SECTION CAPABILITY for each Ensemble Section."}

def declaration_token(token: String, sections: List<Declaration>, pending: DeclarationPending) -> EnsembleState:
  match pending:
    case DeclarationFlag{}: declaration_flag(sections,String.eq(token,"--section"))
    case DeclarationName{}: Declarations{sections,Capability{token}}
    case Capability{section}: Declarations{Decl{section,token} <> sections,DeclarationFlag{}}

def declaration_step(token: String, state: EnsembleState) -> EnsembleState:
  match state:
    case Declarations{sections,pending}: declaration_token(token,sections,pending)
    case Invalid{reason}: Invalid{reason}

def declaration_complete(sections: List<Declaration>, pending: DeclarationPending) -> Result<&1,&1,String,EnsembleOptions>:
  match pending:
    case DeclarationFlag{}: Done{Sections{sections}}
    case _: Fail{"Incomplete Ensemble Section; use --section SECTION CAPABILITY."}

def declaration_finish(state: EnsembleState) -> Result<&1,&1,String,EnsembleOptions>:
  match state:
    case Declarations{sections,pending}: declaration_complete(sections,pending)
    case Invalid{reason}: Fail{reason}

def ensemble_loop(args: List<String>, state: EnsembleState) -> Result<&1,&1,String,EnsembleOptions>:
  match args:
    case Nil{}: declaration_finish(state)
    case token <> rest: ensemble_loop(rest,declaration_step(token,state))

def ensemble_coupling(args: List<String>, valid: Bool) -> Result<&1,&1,String,EnsembleOptions>:
  match valid:
    case True{}: ensemble_loop(args,Declarations{Nil{},DeclarationFlag{}})
    case False{}: Fail{"Ensemble coupling must be loose or tight."}

def ensemble(+coupling: String, args: List<String>) -> Result<&1,&1,String,EnsembleOptions>:
  ensemble_coupling(args,Bool.or(String.eq(coupling,"loose"),String.eq(coupling,"tight")))

law explicit_player_role_is_parsed:
  {recruit(["--role","player"]) == Done{Options{"player",Nil{}}} : Result<&1,&1,String,RecruitOptions>}

def explicit_player_role_is_parsed():
  {==}

law recruit_group_values_are_literal:
  for ensemble: String
  for owner: String
  for section: String
  {recruit(["--role","associate-conductor","--section",ensemble,owner,section]) == Done{Options{"associate-conductor",[Section{ensemble,owner,section}]}} : Result<&1,&1,String,RecruitOptions>}

def recruit_group_values_are_literal(ensemble,owner,section):
  {==}

law a_repeated_role_refuses:
  {recruit(["--role","player","--role","player"]) == Fail{"Use one --role player|associate-conductor."} : Result<&1,&1,String,RecruitOptions>}

def a_repeated_role_refuses():
  {==}

law a_missing_explicit_role_refuses:
  {recruit(["--ensemble","e","owner"]) == Fail{"Extended recruit requires --role player|associate-conductor."} : Result<&1,&1,String,RecruitOptions>}

def a_missing_explicit_role_refuses():
  {==}

law ensemble_declarations_preserve_literal_values:
  for section: String
  for capability: String
  {ensemble("tight",["--section",section,capability]) == Done{Sections{[Decl{section,capability}]}} : Result<&1,&1,String,EnsembleOptions>}

def ensemble_declarations_preserve_literal_values(section,capability):
  {==}

law an_incomplete_section_refuses:
  {ensemble("loose",["--section","s"]) == Fail{"Incomplete Ensemble Section; use --section SECTION CAPABILITY."} : Result<&1,&1,String,EnsembleOptions>}

def an_incomplete_section_refuses():
  {==}
