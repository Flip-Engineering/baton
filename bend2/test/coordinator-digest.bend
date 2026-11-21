import Base
import ../src/coordinator/agent-guidance.bend as Guidance
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/turn.bend as Turn
import ../src/coordinator/store.bend as Store
import ../src/host/sqlite.bend as DB
import ../src/host/process.bend as P

# Doc 56: the pending notice a coordinator receives lists its open children from recorded rows,
# and the standing texts treat a shown result as settled. Seeds one coordinator ("lead") with
# children in every state the digest distinguishes, then checks the composed notice.
def check(+name: String, ok: Bool, +detail: String) -> IO(Unit):
  Bool.pick(IO(Unit),ok,
    IO.print(name ++ ":ok"),
    IO.die(Unit,1,name ++ ": " ++ detail))

def has(+text: String, +part: String) -> Bool:
  String.contains(text,part)

def sql(+db: String, +statement: String) -> IO(Unit):
  do IO<Unit>:
    done : String <- IO.try(String,DB.Sql.query(db,statement))
    IO.pure(Unit,Unit{})

def session(+db: String, +id: String, +parent: String, +model: String) -> IO(Unit):
  sql(db,"INSERT INTO sessions(id,parent,harness,model,effort) VALUES('" ++ id ++ "','" ++ parent ++ "','codex','" ++ model ++ "','high');")

def message(+db: String, +id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> IO(Unit):
  sql(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('" ++ id ++ "','" ++ sender ++ "','" ++ recipient ++ "','" ++ kind ++ "','" ++ body ++ "');")

def seed(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    a : Unit <- sql(db,"INSERT INTO sessions(id,parent,harness) VALUES('operator',NULL,'omp');")
    b : Unit <- session(db,"lead","operator","gpt-6.2-astra")
    c1 : Unit <- session(db,"c_open","lead","m-open")
    c2 : Unit <- session(db,"c_done","lead","m-done")
    c3 : Unit <- session(db,"c_stopped","lead","m-stopped")
    c4 : Unit <- session(db,"c_req","lead","m-req")
    c5 : Unit <- session(db,"c_ans","lead","m-ans")
    c6 : Unit <- session(db,"c_q","lead","m-q")
    c7 : Unit <- session(db,"c_hold","lead","m-hold")
    c8 : Unit <- session(db,"c_past","lead","m-past")
    c9 : Unit <- session(db,"c_cont","lead","m-cont")
    g1 : Unit <- session(db,"grandkid","c_open","m-grand")
    m1 : Unit <- message(db,"t_open","lead","c_open","task","Build entry 4\nmore detail on a second line")
    m2 : Unit <- message(db,"t_done","lead","c_done","task","Finished task")
    m3 : Unit <- message(db,"cc_done","lead","c_done","completion-confirmed","cr_x")
    m4 : Unit <- message(db,"t_stop","lead","c_stopped","task","Stopped work")
    m5 : Unit <- sql(db,"INSERT INTO session_stops(session,id,reason) VALUES('c_stopped','stop1','operator stop');")
    m6 : Unit <- message(db,"t_req","lead","c_req","task","Ship parser")
    m7 : Unit <- message(db,"cr_req","c_req","lead","completion-request","Parser shipped")
    m8 : Unit <- message(db,"t_ans","lead","c_ans","task","Answered work")
    m9 : Unit <- message(db,"cr_ans","c_ans","lead","completion-request","Done?")
    m10 : Unit <- message(db,"gd_ans","lead","c_ans","guide","Part two is unmet")
    m11 : Unit <- message(db,"t_q","lead","c_q","task","Investigate cause")
    m12 : Unit <- message(db,"q1","c_q","lead","question","Which host?")
    m13 : Unit <- message(db,"t_hold","lead","c_hold","task","Held task")
    m14 : Unit <- sql(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,used_fraction) VALUES(1,'codex','m-hold','openai','default','7-day',4102444800,1.0);")
    m15 : Unit <- message(db,"t_past","lead","c_past","task","Past hold task")
    m16 : Unit <- sql(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,used_fraction) VALUES(1,'codex','m-past','openai','default','7-day',946684800,1.0);")
    m17 : Unit <- message(db,"t_c1","lead","c_cont","task","First part")
    m18 : Unit <- message(db,"cc_c","lead","c_cont","completion-confirmed","cr_y")
    m19 : Unit <- message(db,"t_c2","lead","c_cont","task-continuation","Second part")
    m20 : Unit <- message(db,"r1","c_open","lead","report","one")
    m21 : Unit <- message(db,"r2","c_open","lead","report","two")
    m22 : Unit <- message(db,"r3","c_open","lead","report","three")
    m23 : Unit <- sql(db,"INSERT INTO message_reads(attempt,message,recipient) VALUES('a1','r1','lead');")
    m24 : Unit <- message(db,"t_grand","c_open","grandkid","task","Grandchild work")
    IO.pure(Unit,Unit{})

# The first child line ("- ...") of the digest.
def first_child(lines: List<String>) -> String:
  match lines:
    case line <> rest: Bool.pick(String,String.starts_with(line,"- "),line,first_child(rest))
    case Nil{}: ""

def run(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db)
    +plain : String <- IO.pure(String,Guidance.pending())
    +leaf : String <- Guidance.pending_for(db,"c_done")
    k1 : Unit <- check("leaf unchanged",String.eq(leaf,plain),"leaf notice differs from pending()")
    +d : String <- Guidance.pending_for(db,"lead")
    k2 : Unit <- check("open child listed",Bool.and(has(d,"- c_open (m-open): Build entry 4 [t_open]"),Bool.not(has(d,"second line"))),d)
    k3 : Unit <- check("confirmed child omitted",Bool.not(has(d,"c_done")),d)
    k4 : Unit <- check("continuation reopens",Bool.and(has(d,"- c_cont (m-cont): Second part [t_c2]"),Bool.not(has(d,"First part"))),d)
    k5 : Unit <- check("stopped child omitted",Bool.not(has(d,"c_stopped")),d)
    k6 : Unit <- check("grandchild omitted",Bool.not(has(d,"grandkid")),d)
    k7 : Unit <- check("waiting completion request",Bool.and(has(d,"; completion request cr_req waiting for you"),String.starts_with(first_child(String.lines(d)),"- c_req ")),d)
    k8 : Unit <- check("answered completion request",Bool.not(has(d,"cr_ans waiting")),d)
    k9 : Unit <- check("unanswered question",has(d,"- c_q (m-q): Investigate cause [t_q]; question q1 unanswered"),d)
    k10 : Unit <- check("new message count",has(d,"[t_open]; 2 new messages"),d)
    k11 : Unit <- check("usage hold shown",has(d,"[t_hold]; held by usage until 2100-01-01 00:00 UTC"),d)
    k12 : Unit <- check("usage hold elapsed",Bool.and(has(d,"[t_past]"),Bool.not(has(d,"[t_past]; held"))),d)
    k13 : Unit <- check("paragraph present",Bool.and(has(d,"Your children's open assignments:"),has(d,"These are your children's open assignments. Read each child's new messages against its assignment.")),d)
    +i : String <- IO.pure(String,Receive.instructions("baton","db","lead","{}"))
    +t : String <- IO.pure(String,Turn.task_instructions())
    +k : String <- IO.pure(String,Turn.knowledge_instructions())
    k14 : Unit <- check("standing text",
      Bool.and(Bool.and(Bool.not(has(i,"supplied evidence")),has(i,"A result the child has shown once stays settled")),
        Bool.and(Bool.and(Bool.not(has(t,"outstanding qualification")),has(t,"A result you have shown once stays settled")),
          Bool.and(Bool.not(has(k,"complete evidence")),has(k,"Record a finding once")))),
      "standing texts still carry the old wording")
    IO.pure(Unit,Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- P.args()
    match args:
      case db <> Nil{}: run(db)
      case other: IO.die(Unit,2,"usage: coordinator-digest DB")
