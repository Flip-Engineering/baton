import Base
import ./commands.bend as C
import ./store.bend as Store
import ./recruit.bend as Recruit
import ./structural-options.bend as O
import ./structural-workspace.bend as W
import ../git/create-worktree.bend as CW
import ../git/process.bend as Git
import ../host/sqlite.bend as DB
import ../json/canonical.bend as J
import ../git/text.bend as Tx

# A Plan contains SQL expressions and the normalized request. Each connection
# materializes its decision before the guarded mutation statements run.
type Plan is Data:
  Plan{subject: String, requested: String, setup: String, condition: String, next: String, mutations: String, structure: String}

def shared_args(args: List<String>) -> List<&2,String>:
  match args:
    case Nil{}: Nil{}
    case arg <> rest: arg <> shared_args(rest)

def linear_args(args: List<&2,String>) -> List<String>:
  match args:
    case Nil{}: Nil{}
    case arg <> rest: arg <> linear_args(rest)

def arg_items(args: List<&2,String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> Nil{}: J.string_literal(arg)
    case arg <> rest: J.string_literal(arg) ++ "," ++ arg_items(rest)

def no_workspace() -> String:
  "{\"disposition\":\"notRequested\",\"path\":null,\"branch\":null,\"base\":null,\"observed\":null,\"creationError\":null,\"inspectionError\":null}"

def envelope(+status: String, +phase: String, +subject: String, +requested: String, +structure: String, +workspace: String, +condition: String, +next: String) -> String:
  "\"type\":\"structural-result\",\"status\":" ++ J.string_literal(status) ++ ",\"phase\":" ++ J.string_literal(phase) ++ ",\"subject\":" ++ J.string_literal(subject) ++ ",\"requested\":" ++ requested ++ ",\"structure\":" ++ structure ++ ",\"workspace\":" ++ workspace ++ ",\"condition\":" ++ condition ++ ",\"next\":" ++ next

def refusal(+status: String, +phase: String, +subject: String, +requested: String, +workspace: String, +condition: String, +next: String) -> String:
  "{\"error\":\"structural-refused\"," ++ envelope(status,phase,subject,requested,"null",workspace,J.string_literal(condition),next) ++ "}\n"

def host_failure(+status: String, +phase: String, +subject: String, +requested: String, +workspace: String, +stage: String, code: U32, +detail: String) -> String:
  "{\"error\":\"structural-host-failure\"," ++ envelope(status,phase,subject,requested,"null",workspace,J.string_literal(stage),"[]") ++ ",\"hostError\":{\"stage\":" ++ J.string_literal(stage) ++ ",\"code\":" ++ U32.show(code) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}}"

def emit_saved(+saved: String, denied: Bool) -> IO(Unit):
  match denied:
    case True{}: IO.die(Unit,2,Tx.trim_nl(saved))
    case False{}: IO.write(saved)

def emit(+saved: String) -> IO(Unit):
  emit_saved(saved,Store.refused(saved))

def frozen_decision(+condition: String, +next: String) -> String:
  "CREATE TEMP TABLE structural_decision AS SELECT " ++ condition ++ " AS condition," ++ next ++ " AS next;"

def admitted() -> String:
  "(SELECT condition='' FROM structural_decision)"

def result_fields(+status: String, +phase: String, +subject: String, +requested: String, +structure: String, +workspace: String, +condition: String, +next: String) -> String:
  "'type','structural-result','startupRequested',json('false'),'status'," ++ status ++ ",'phase'," ++ C.q(phase) ++ ",'subject'," ++ C.q(subject) ++ ",'requested',json(" ++ C.q(requested) ++ "),'structure'," ++ structure ++ ",'workspace',json(" ++ C.q(workspace) ++ "),'condition'," ++ condition ++ ",'next',json(" ++ next ++ ")"

def result_sql(+subject: String, +requested: String, +structure: String, +workspace: String, +phase: String, +refusal_status: String) -> String:
  "SELECT CASE WHEN " ++ admitted() ++ " THEN json_object(" ++ result_fields("'configured'","registration",subject,requested,structure,workspace,"NULL","'[]'") ++ ") ELSE json_object('error','structural-refused'," ++ result_fields(C.q(refusal_status),phase,subject,requested,"NULL",workspace,"condition","next") ++ ") END FROM structural_decision;"

def transaction(plan: Plan, +workspace: String, +phase: String, +refusal_status: String) -> String:
  match plan:
    case Plan{subject,requested,setup,condition,next,mutations,structure}:
      "BEGIN IMMEDIATE;" ++ C.schema() ++ setup ++ frozen_decision(condition,next) ++ mutations ++ result_sql(subject,requested,structure,workspace,phase,refusal_status) ++ "COMMIT;"

def committed(+subject: String, +requested: String, +workspace: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{saved}: emit(saved)
    case Fail{(+code,detail)}: IO.die(Unit,code,host_failure("registrationFailed","registration",subject,requested,workspace,"sqlite",code,detail))

def execute(+db: String, plan: Plan, +workspace: String, +phase: String, +refusal_status: String) -> IO(Unit):
  match plan:
    case Plan{+subject,+requested,setup,condition,next,mutations,structure}:
      do IO<Unit>:
        result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,transaction(Plan{subject,requested,setup,condition,next,mutations,structure},workspace,phase,refusal_status))
        committed(subject,requested,workspace,result)

def declaration_items(declarations: List<O.Declaration>) -> String:
  match declarations:
    case Nil{}: ""
    case O.Decl{id,capability} <> rest:
      ",json_object('id'," ++ C.q(id) ++ ",'capability'," ++ C.q(capability) ++ ")" ++ declaration_items(rest)

def declaration_table(declarations: List<O.Declaration>) -> String:
  "CREATE TEMP TABLE structural_sections AS SELECT DISTINCT json_extract(value,'$.id') AS id,json_extract(value,'$.capability') AS capability FROM json_each(json_array(NULL" ++ declaration_items(declarations) ++ ")) WHERE type<>'null';"

def ensemble_condition(+id: String, +owner: String, +coupling: String) -> String:
  "CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(owner) ++ ") OR " ++ C.assigned_role(C.q(owner)) ++ "<>'conductor' THEN 'owner: requires a registered Conductor' WHEN EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner<>" ++ C.q(owner) ++ ") THEN 'owner: existing Ensemble belongs to another owner' WHEN " ++ C.q(coupling) ++ " NOT IN ('loose','tight') THEN 'coupling: requires loose or tight' WHEN EXISTS(SELECT 1 FROM structural_sections WHERE capability='') THEN 'capability: requires a nonempty value' WHEN EXISTS(SELECT 1 FROM structural_sections GROUP BY id HAVING count(*)>1) THEN 'capability: conflicting declarations for one Section' ELSE '' END"

def ensemble_mutations(+id: String, +owner: String, +coupling: String) -> String:
  "INSERT INTO ensembles(id,owner,coupling) SELECT " ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(coupling) ++ " WHERE " ++ admitted() ++ " ON CONFLICT(id) DO UPDATE SET coupling=excluded.coupling;"
  ++ "INSERT INTO sections(ensemble,id,capability) SELECT " ++ C.q(id) ++ ",id,capability FROM structural_sections WHERE " ++ admitted() ++ " ON CONFLICT(ensemble,id) DO UPDATE SET capability=excluded.capability;"

def ensemble_plan(+id: String, +owner: String, +coupling: String, +requested: String, declarations: List<O.Declaration>) -> Plan:
  Plan{id,requested,declaration_table(declarations),ensemble_condition(id,owner,coupling),"json_array(json_array('ensemble'," ++ C.q(id) ++ "),json_array('role'," ++ C.q(owner) ++ "))",ensemble_mutations(id,owner,coupling),"(SELECT " ++ C.ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ C.q(id) ++ ")"}

def ensemble_parsed(+db: String, +id: String, +owner: String, +coupling: String, +requested: String, parsed: Result<&1,&1,String,O.EnsembleOptions>) -> IO(Unit):
  match parsed:
    case Fail{condition}: emit(refusal("preflightRefused","preflight",id,requested,no_workspace(),condition,"[[\"help\"]]"))
    case Done{O.Sections{declarations}}: execute(db,ensemble_plan(id,owner,coupling,requested,declarations),no_workspace(),"preflight","preflightRefused")

def ensemble_shared(+db: String, +id: String, +owner: String, +coupling: String, +options: List<&2,String>) -> IO(Unit):
  ensemble_parsed(db,id,owner,coupling,"{\"ensemble\":" ++ J.string_literal(id) ++ ",\"owner\":" ++ J.string_literal(owner) ++ ",\"coupling\":" ++ J.string_literal(coupling) ++ ",\"options\":[" ++ arg_items(options) ++ "]}",O.ensemble(coupling,linear_args(options)))

def ensemble(+db: String, +id: String, +owner: String, +coupling: String, options: List<String>) -> IO(Unit):
  ensemble_shared(db,id,owner,coupling,shared_args(options))

type Assignment is Data:
  Assignment{id: String, parent: String, harness: String, model: String, effort: String, path: String, branch: String, base: String, role: String, memberships: String}

def assignment_id(assignment: Assignment) -> String:
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}: id

def assignment_path(assignment: Assignment) -> String:
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}: path

def assignment_branch(assignment: Assignment) -> String:
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}: branch

def assignment_base(assignment: Assignment) -> String:
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}: base

def membership_items(memberships: List<O.Membership>) -> String:
  match memberships:
    case Nil{}: ""
    case O.Ensemble{ensemble,owner} <> rest:
      ",json_object('ensemble'," ++ C.q(ensemble) ++ ",'owner'," ++ C.q(owner) ++ ",'section',NULL)" ++ membership_items(rest)
    case O.Section{ensemble,owner,section} <> rest:
      ",json_object('ensemble'," ++ C.q(ensemble) ++ ",'owner'," ++ C.q(owner) ++ ",'section'," ++ C.q(section) ++ ")" ++ membership_items(rest)

def membership_table(+memberships: String) -> String:
  "CREATE TEMP TABLE structural_memberships AS SELECT DISTINCT json_extract(value,'$.ensemble') AS ensemble,json_extract(value,'$.owner') AS owner,json_extract(value,'$.section') AS section FROM json_each(json_array(NULL" ++ memberships ++ ")) WHERE type<>'null';"

def recruit_condition(assignment: Assignment) -> String:
  match assignment:
    case Assignment{+id,+parent,harness,model,effort,path,branch,base,+role,memberships}:
      "CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(parent) ++ ") THEN 'parent: session must already be registered' WHEN EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(id) ++ " AND NOT " ++ C.player_matches(parent,harness,model,effort,path,branch,base) ++ ") THEN 'assignment: existing fields differ from the normalized request' WHEN EXISTS(SELECT 1 FROM session_roles WHERE session=" ++ C.q(id) ++ " AND role<>" ++ C.q(C.role_family(role)) ++ ") THEN 'role: use the ordinary role operation for an intentional change' WHEN EXISTS(SELECT 1 FROM structural_memberships m WHERE NOT EXISTS(SELECT 1 FROM ensembles e JOIN sessions o ON o.id=e.owner WHERE e.id=m.ensemble AND e.owner=m.owner AND " ++ C.assigned_role("o.id") ++ "='conductor')) THEN 'membership: named Ensemble and Conductor owner must agree' WHEN EXISTS(SELECT 1 FROM structural_memberships m WHERE m.section IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sections s WHERE s.ensemble=m.ensemble AND s.id=m.section)) THEN 'section: named compound Section must exist' ELSE '' END"

def recruit_mutations(assignment: Assignment) -> String:
  match assignment:
    case Assignment{+id,parent,harness,model,effort,path,branch,base,role,memberships}:
      "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) SELECT " ++ C.q(id) ++ "," ++ C.q(parent) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(path) ++ "," ++ C.q(branch) ++ "," ++ C.q(base) ++ " WHERE " ++ admitted() ++ " ON CONFLICT(id) DO NOTHING;"
      ++ "INSERT INTO session_roles(session,role) SELECT " ++ C.q(id) ++ "," ++ C.q(C.role_family(role)) ++ " WHERE " ++ admitted() ++ " ON CONFLICT(session) DO NOTHING;"
      ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT DISTINCT ensemble," ++ C.q(id) ++ " FROM structural_memberships WHERE " ++ admitted() ++ ";"
      ++ "INSERT OR IGNORE INTO section_members(ensemble,section,session) SELECT ensemble,section," ++ C.q(id) ++ " FROM structural_memberships WHERE section IS NOT NULL AND " ++ admitted() ++ ";"

def recruit_structure(+id: String) -> String:
  "(SELECT json_object('id',s.id,'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'role'," ++ C.public_role("s.id") ++ ",'ensembles',(SELECT json_group_array(ensemble) FROM (SELECT ensemble FROM ensemble_members WHERE session=s.id ORDER BY ensemble)),'sections',(SELECT json_group_array(json_object('ensemble',ensemble,'section',section)) FROM (SELECT ensemble,section FROM section_members WHERE session=s.id ORDER BY ensemble,section))) FROM sessions s WHERE s.id=" ++ C.q(id) ++ ")"

def recruit_plan(+assignment: Assignment, +requested: String) -> Plan:
  match assignment:
    case Assignment{+id,parent,harness,model,effort,path,branch,base,role,memberships}:
      Plan{id,requested,membership_table(memberships),recruit_condition(assignment),"json_array(json_array('session'," ++ C.q(id) ++ "),json_array('role'," ++ C.q(id) ++ "),json_array('orchestra','--index','--for'," ++ C.q(id) ++ "))",recruit_mutations(assignment),recruit_structure(id)}

def preflight_sql(plan: Plan, +workspace: String) -> String:
  match plan:
    case Plan{subject,requested,setup,condition,next,mutations,structure}:
      "BEGIN;" ++ C.schema() ++ setup ++ frozen_decision(condition,next) ++ "SELECT CASE WHEN " ++ admitted() ++ " THEN '' ELSE json_object('error','structural-refused'," ++ result_fields("'preflightRefused'","preflight",subject,requested,"NULL",workspace,"condition","next") ++ ") END FROM structural_decision;COMMIT;"

def workspace(+disposition: String, +path: String, +branch: String, +base: String, +observed: String, +creation_error: String, +inspection_error: String) -> String:
  "{\"disposition\":" ++ J.string_literal(disposition) ++ ",\"path\":" ++ J.string_literal(path) ++ ",\"branch\":" ++ J.string_literal(branch) ++ ",\"base\":" ++ J.string_literal(base) ++ ",\"observed\":" ++ observed ++ ",\"creationError\":" ++ creation_error ++ ",\"inspectionError\":" ++ inspection_error ++ "}"

def workspace_error(+subject: String, +requested: String, +workspace: String, error: W.Failure) -> IO(Unit):
  match error:
    case W.HostFailure{stage,+code,detail}: IO.die(Unit,code,host_failure("workspaceFailed","workspace",subject,requested,workspace,stage,code,detail))

def git_result(+subject: String, +requested: String, +workspace: String, next: String -> IO(Unit), result: Result<&1,&1,W.Failure,String>) -> IO(Unit):
  match result:
    case Fail{error}: workspace_error(subject,requested,workspace,error)
    case Done{value}: next(Tx.trim_nl(value))

def with_git(+subject: String, +requested: String, +workspace: String, operation: IO(Result<&1,&1,W.Failure,String>), next: String -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,W.Failure,String> <- operation
    git_result(subject,requested,workspace,next,result)

def inspection_match(db: String, +assignment: Assignment, requested: String, workspace: String, matched: Bool) -> IO(Unit):
  match matched:
    case True{}: execute(db,recruit_plan(assignment,requested),workspace,"registration","registrationRefused")
    case False{}: emit(refusal("registrationRefused","registration",assignment_id(assignment),requested,workspace,"workspace: actual worktree root, repository or branch differs from the assignment","[[\"worktree\"," ++ J.string_literal(assignment_id(assignment)) ++ "]]"))

def inspected(db: String, +assignment: Assignment, requested: String, expected_repo: String, disposition: String, result: Result<&1,&1,W.Failure,W.Observation>) -> IO(Unit):
  match result:
    case Fail{+error}: workspace_error(assignment_id(assignment),requested,workspace("unknown",assignment_path(assignment),assignment_branch(assignment),assignment_base(assignment),"null","null",W.failure_json(error)),error)
    case Done{W.Observed{+repo,+root,+path,+actual_branch,head,dirty}}:
      inspection_match(db,assignment,requested,workspace(disposition,assignment_path(assignment),assignment_branch(assignment),assignment_base(assignment),W.observation_json(W.Observed{repo,root,path,actual_branch,head,dirty}),"null","null"),Bool.and(String.eq(root,path),Bool.and(String.eq(expected_repo,repo),String.eq(assignment_branch(assignment),actual_branch))))

def inspect_assignment(+db: String, +assignment: Assignment, +requested: String, +expected_repo: String, +disposition: String) -> IO(Unit):
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}:
      do IO<Unit>:
        result : Result<&1,&1,W.Failure,W.Observation> <- W.inspect(path)
        inspected(db,assignment,requested,expected_repo,disposition,result)

def creation_failed(+id: String, +requested: String, +path: String, +branch: String, +base: String, +error: W.Failure, inspected: Result<&1,&1,W.Failure,W.Observation>) -> IO(Unit):
  match inspected:
    case Done{observed}: workspace_error(id,requested,workspace("failed",path,branch,base,W.observation_json(observed),W.failure_json(error),"null"),error)
    case Fail{inspection}: workspace_error(id,requested,workspace("unknown",path,branch,base,"null",W.failure_json(error),W.failure_json(inspection)),error)

def created(db: String, +assignment: Assignment, requested: String, expected_repo: String, result: Result<&1,&1,W.Failure,String>) -> IO(Unit):
  match result:
    case Done{out}: inspect_assignment(db,assignment,requested,expected_repo,"created")
    case Fail{error}:
      do IO<Unit>:
        inspection : Result<&1,&1,W.Failure,W.Observation> <- W.inspect(assignment_path(assignment))
        creation_failed(assignment_id(assignment),requested,assignment_path(assignment),assignment_branch(assignment),assignment_base(assignment),error,inspection)

def create_assignment(+db: String, +assignment: Assignment, +requested: String, +repo: String, +expected_repo: String) -> IO(Unit):
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}:
      do IO<Unit>:
        result : Result<&1,&1,W.Failure,String> <- W.run("git.worktree.add",repo,CW.worktree_args(branch,path,base))
        created(db,assignment,requested,expected_repo,result)

def occupied(assignment: Assignment, requested: String, +stage: String, +detail: String) -> IO(Unit):
  match assignment:
    case Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}:
      workspace_error(id,requested,workspace("failed",path,branch,base,"null",W.failure_json(W.HostFailure{stage,1,detail}),"null"),W.HostFailure{stage,1,detail})

def path_available(db: String, assignment: Assignment, requested: String, repo: String, expected_repo: String, result: Result<&1,&1,U32 & String,Bool>) -> IO(Unit):
  match result:
    case Done{True{}}: occupied(assignment,requested,"workspace.path","The requested path already exists; retain it and choose an unused path.")
    case Done{False{}}: create_assignment(db,assignment,requested,repo,expected_repo)
    case Fail{(code,detail)}: workspace_error(assignment_id(assignment),requested,no_workspace(),W.HostFailure{"workspace.path.inspect",code,detail})

def check_path(+db: String, +assignment: Assignment, requested: String, repo: String, expected_repo: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Bool> <- Git.Process.path_exists(assignment_path(assignment))
    path_available(db,assignment,requested,repo,expected_repo,result)

def branch_available(db: String, assignment: Assignment, requested: String, repo: String, expected_repo: String, result: Result<&1,&1,W.Failure,String>) -> IO(Unit):
  match result:
    case Done{out}: occupied(assignment,requested,"workspace.branch","The requested branch already exists; retain it and choose an unused branch.")
    case Fail{W.HostFailure{stage,1,detail}}: check_path(db,assignment,requested,repo,expected_repo)
    case Fail{error}: workspace_error(assignment_id(assignment),requested,no_workspace(),error)

def check_branch(+db: String, +assignment: Assignment, requested: String, +repo: String, expected_repo: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,W.Failure,String> <- W.run("workspace.branch.inspect",repo,["show-ref","--verify","--quiet","refs/heads/" ++ assignment_branch(assignment)])
    branch_available(db,assignment,requested,repo,expected_repo,result)

def workspace_choice(+db: String, assignment: Assignment, +requested: String, +repo: String, +expected_repo: String, existing: Bool) -> IO(Unit):
  match existing:
    case True{}: inspect_assignment(db,assignment,requested,expected_repo,"unchanged")
    case False{}: check_branch(db,assignment,requested,repo,expected_repo)

def existing_assignment(db: String, +assignment: Assignment, requested: String, repo: String, expected_repo: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{saved}: workspace_choice(db,assignment,requested,repo,expected_repo,Bool.not(String.is_empty(saved)))
    case Fail{(+code,detail)}: IO.die(Unit,code,host_failure("registrationFailed","registration",assignment_id(assignment),requested,no_workspace(),"sqlite.assignment",code,detail))

def preflight_saved(+db: String, +assignment: Assignment, requested: String, repo: String, expected_repo: String, saved: String, denied: Bool) -> IO(Unit):
  match denied:
    case True{}: emit(saved)
    case False{}:
      do IO<Unit>:
        existing : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"SELECT id FROM sessions WHERE id=" ++ C.q(assignment_id(assignment)) ++ ";")
        existing_assignment(db,assignment,requested,repo,expected_repo,existing)

def checked_preflight(db: String, assignment: Assignment, requested: String, repo: String, expected_repo: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(+code,detail)}: IO.die(Unit,code,host_failure("registrationFailed","registration",assignment_id(assignment),requested,no_workspace(),"sqlite.preflight",code,detail))
    case Done{+saved}: preflight_saved(db,assignment,requested,repo,expected_repo,saved,Tx.starts_with(saved,"{\"error\":"))

def recruit_normalized(+db: String, +assignment: Assignment, +requested: String, +repo: String, +expected_repo: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,preflight_sql(recruit_plan(assignment,requested),no_workspace()))
    checked_preflight(db,assignment,requested,repo,expected_repo,result)

def normalize(+db: String, assignment: Assignment, +repo: String, +requested: String) -> IO(Unit):
  match assignment:
    case Assignment{+id,parent,harness,model,effort,+path,branch,base,role,memberships}:
      with_git(id,requested,no_workspace(),W.run("repository.root",repo,["rev-parse","--show-toplevel"]),root =>
        with_git(id,requested,no_workspace(),W.run("repository.base",repo,["rev-parse","--verify","--end-of-options",base ++ "^{commit}"]),commit =>
          with_git(id,requested,no_workspace(),W.run("repository.identity",repo,["rev-parse","--path-format=absolute","--git-common-dir"]),common =>
            recruit_normalized(db,Assignment{id,parent,harness,model,effort,Recruit.absolute(root,path,Tx.starts_with(path,"/")),branch,commit,role,memberships},requested,repo,common))))

def recruit_parsed(+db: String, +id: String, +parent: String, +harness: String, +model: String, +effort: String, +repo: String, +branch: String, +path: String, +base: String, +requested: String, parsed: Result<&1,&1,String,O.RecruitOptions>) -> IO(Unit):
  match parsed:
    case Fail{condition}: emit(refusal("preflightRefused","preflight",id,requested,no_workspace(),condition,"[[\"help\"]]"))
    case Done{O.Options{role,memberships}}: normalize(db,Assignment{id,parent,harness,model,effort,path,branch,base,role,membership_items(memberships)},repo,requested)

def recruit_shared(+db: String, +id: String, +parent: String, +harness: String, +model: String, +effort: String, +repo: String, +branch: String, +path: String, +base: String, +options: List<&2,String>) -> IO(Unit):
  recruit_parsed(db,id,parent,harness,model,effort,repo,branch,path,base,"{\"player\":" ++ J.string_literal(id) ++ ",\"parent\":" ++ J.string_literal(parent) ++ ",\"harness\":" ++ J.string_literal(harness) ++ ",\"model\":" ++ J.string_literal(model) ++ ",\"effort\":" ++ J.string_literal(effort) ++ ",\"repo\":" ++ J.string_literal(repo) ++ ",\"branch\":" ++ J.string_literal(branch) ++ ",\"path\":" ++ J.string_literal(path) ++ ",\"base\":" ++ J.string_literal(base) ++ ",\"options\":[" ++ arg_items(options) ++ "]}",O.recruit(linear_args(options)))

def recruit(+db: String, +id: String, +parent: String, +harness: String, +model: String, +effort: String, +repo: String, +branch: String, +path: String, +base: String, options: List<String>) -> IO(Unit):
  recruit_shared(db,id,parent,harness,model,effort,repo,branch,path,base,shared_args(options))

law every_ensemble_write_uses_the_frozen_decision:
  for id: String
  for owner: String
  for coupling: String
  {ensemble_mutations(id,owner,coupling) == "INSERT INTO ensembles(id,owner,coupling) SELECT " ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(coupling) ++ " WHERE " ++ admitted() ++ " ON CONFLICT(id) DO UPDATE SET coupling=excluded.coupling;" ++ "INSERT INTO sections(ensemble,id,capability) SELECT " ++ C.q(id) ++ ",id,capability FROM structural_sections WHERE " ++ admitted() ++ " ON CONFLICT(ensemble,id) DO UPDATE SET capability=excluded.capability;" : String}

def every_ensemble_write_uses_the_frozen_decision(id,owner,coupling):
  {==}

law frozen_admission_precedes_every_mutation:
  for subject: String
  for requested: String
  for setup: String
  for condition: String
  for next: String
  for mutations: String
  for structure: String
  for workspace: String
  {transaction(Plan{subject,requested,setup,condition,next,mutations,structure},workspace,"registration","registrationRefused") == "BEGIN IMMEDIATE;" ++ C.schema() ++ setup ++ frozen_decision(condition,next) ++ mutations ++ result_sql(subject,requested,structure,workspace,"registration","registrationRefused") ++ "COMMIT;" : String}

def frozen_admission_precedes_every_mutation(subject,requested,setup,condition,next,mutations,structure,workspace):
  {==}

law refused_saved_result_has_one_stderr_newline:
  for saved: String
  {emit_saved(saved,True{}) == IO.die(Unit,2,Tx.trim_nl(saved)) : IO(Unit)}

def refused_saved_result_has_one_stderr_newline(saved):
  {==}

law successful_saved_result_preserves_the_single_query_answer:
  for saved: String
  {emit_saved(saved,False{}) == IO.write(saved) : IO(Unit)}

def successful_saved_result_preserves_the_single_query_answer(saved):
  {==}

law sqlite_failure_preserves_its_host_code:
  for subject: String
  for requested: String
  for workspace: String
  for +code: U32
  for detail: String
  {committed(subject,requested,workspace,Fail{(code,detail)}) == IO.die(Unit,code,host_failure("registrationFailed","registration",subject,requested,workspace,"sqlite",code,detail)) : IO(Unit)}

def sqlite_failure_preserves_its_host_code(subject,requested,workspace,code,detail):
  {==}

law workspace_mismatch_refuses_before_registration:
  for db: String
  for +assignment: Assignment
  for requested: String
  for workspace: String
  {inspection_match(db,assignment,requested,workspace,False{}) == emit(refusal("registrationRefused","registration",assignment_id(assignment),requested,workspace,"workspace: actual worktree root, repository or branch differs from the assignment","[[\"worktree\"," ++ J.string_literal(assignment_id(assignment)) ++ "]]")) : IO(Unit)}

def workspace_mismatch_refuses_before_registration(db,assignment,requested,workspace):
  {==}

law matching_workspace_revalidates_the_whole_request:
  for db: String
  for assignment: Assignment
  for requested: String
  for workspace: String
  {inspection_match(db,assignment,requested,workspace,True{}) == execute(db,recruit_plan(assignment,requested),workspace,"registration","registrationRefused") : IO(Unit)}

def matching_workspace_revalidates_the_whole_request(db,assignment,requested,workspace):
  {==}

law recruit_registers_only_under_the_frozen_decision:
  for +id: String
  for parent: String
  for harness: String
  for model: String
  for effort: String
  for path: String
  for branch: String
  for base: String
  for role: String
  for memberships: String
  {recruit_mutations(Assignment{id,parent,harness,model,effort,path,branch,base,role,memberships}) == "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) SELECT " ++ C.q(id) ++ "," ++ C.q(parent) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(path) ++ "," ++ C.q(branch) ++ "," ++ C.q(base) ++ " WHERE " ++ admitted() ++ " ON CONFLICT(id) DO NOTHING;" ++ "INSERT INTO session_roles(session,role) SELECT " ++ C.q(id) ++ "," ++ C.q(C.role_family(role)) ++ " WHERE " ++ admitted() ++ " ON CONFLICT(session) DO NOTHING;" ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT DISTINCT ensemble," ++ C.q(id) ++ " FROM structural_memberships WHERE " ++ admitted() ++ ";" ++ "INSERT OR IGNORE INTO section_members(ensemble,section,session) SELECT ensemble,section," ++ C.q(id) ++ " FROM structural_memberships WHERE section IS NOT NULL AND " ++ admitted() ++ ";" : String}

def recruit_registers_only_under_the_frozen_decision(id,parent,harness,model,effort,path,branch,base,role,memberships):
  {==}

law inspected_requires_the_actual_worktree_root:
  for db: String
  for +assignment: Assignment
  for requested: String
  for expected_repo: String
  for disposition: String
  for +repo: String
  for +root: String
  for +path: String
  for +branch: String
  for head: String
  for dirty: Bool
  {inspected(db,assignment,requested,expected_repo,disposition,Done{W.Observed{repo,root,path,branch,head,dirty}}) == inspection_match(db,assignment,requested,workspace(disposition,assignment_path(assignment),assignment_branch(assignment),assignment_base(assignment),W.observation_json(W.Observed{repo,root,path,branch,head,dirty}),"null","null"),Bool.and(String.eq(root,path),Bool.and(String.eq(expected_repo,repo),String.eq(assignment_branch(assignment),branch)))) : IO(Unit)}

def inspected_requires_the_actual_worktree_root(db,assignment,requested,expected_repo,disposition,repo,root,path,branch,head,dirty):
  {==}
