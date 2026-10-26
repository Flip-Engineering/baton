import Base
import ./compile-queue-state.bend as S
import ./compile-queue-files.bend as QF
import ./compile-queue-process.bend as Proc
import ./compile-queue-history.bend as H
import ../host/files.bend as F
import ../host/text.bend as T
import ./posix.bend as P
import ./wide.bend as W

type QueueView is Data:
  QueueView{facts: String, claims: List<&2,String>, tickets: List<&2,String>}

def facts( +view: QueueView) -> String:
  match view:
    case QueueView{facts,claims,tickets}: facts

def claims( +view: QueueView) -> List<&2,String>:
  match view:
    case QueueView{facts,claims,tickets}: claims

def tickets( +view: QueueView) -> List<&2,String>:
  match view:
    case QueueView{facts,claims,tickets}: tickets

def mkdir_waiting(result: Result<&1,&1,U32 & String,Unit>, +path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{unit}: QF.mkdir_p(path)
    case Fail{(+code,message)}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(code,17),QF.mkdir_p(path),IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,message)}))

def directories(+state: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    running : Unit <- IO.try(Unit,QF.mkdir_p(state ++ "/admission/running"))
    made : Result<&1,&1,U32 & String,Unit> <- F.Files.mkdir_mode(state ++ "/admission/waiting",1016)
    waiting : Unit <- IO.try(Unit,mkdir_waiting(made,state ++ "/admission/waiting"))
    usage : Unit <- IO.try(Unit,QF.mkdir_p(state ++ "/admission/usage"))
    peaks : Unit <- IO.try(Unit,QF.mkdir_p(state ++ "/peaks"))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def lock( +state: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.HostPosix.lock_acquire(state ++ "/admission/lock")

def valid_name(+name: String) -> Bool:
  Bool.and(Bool.not(String.starts_with(name,".")),Bool.not(String.contains(name,".tmp.")))

def admission_names(names: List<&2,String>) -> List<&2,String>:
  match names:
    case Nil{}: Nil{}
    case +name <> +rest: Bool.pick(List<&2,String>,valid_name(name),name <> admission_names(rest),admission_names(rest))

def load_claims_match_3(+rest: List<&2,String>, +name: String, +path: String, +state: String, +acc: List<&2,String>, held: Result<&1,&1,U32 & String,U32>) -> IO(List<&2,String>):
  match held:
    case Done{value}:
      Bool.pick(IO(List<&2,String>),U32.is_eq(value,0),
        do IO<List<&2,String>>:
          gone : Unit <- S.remove(path)
          usage : Unit <- S.remove(state ++ "/admission/usage/" ++ name)
          load_claims(rest,state,acc),
        do IO<List<&2,String>>:
          +text : String <- S.read(path)
          load_claims(rest,state,Bool.pick(List<&2,String>,Bool.and(valid_name(name),Bool.not(String.is_empty(text))),("id=" ++ name ++ "\n" ++ text) <> acc,acc)))
    case Fail{error}: load_claims(rest,state,acc)

def load_claims( +names: List<&2,String>, +state: String, +acc: List<&2,String>) -> IO(List<&2,String>):
  match names:
    case Nil{}: IO.pure(List<&2,String>,acc)
    case +name <> +rest:
      do IO<List<&2,String>>:
        +path : String <- IO.pure(String,state ++ "/admission/running/" ++ name)
        held : Result<&1,&1,U32 & String,U32> <- P.HostPosix.held(path)
        load_claims_match_3(rest, name, path, state, acc, held)

def priority(+name: String) -> U32:
  Bool.pick(U32,String.eq(name,"extreme"),2,Bool.pick(U32,String.eq(name,"high"),1,0))

def priority_name( +rank: U32) -> String:
  Bool.pick(String,U32.is_ge(rank,2),"extreme",Bool.pick(String,U32.is_eq(rank,1),"high","rest"))

def ticket_before(+a: String, +b: String) -> Bool:
  +ap = S.number(S.field(a,"priority"))
  +bp = S.number(S.field(b,"priority"))
  Bool.or(U32.is_gt(ap,bp),Bool.and(U32.is_eq(ap,bp),String.is_lt(S.field(a,"id"),S.field(b,"id"))))

def insert_ticket( +items: List<&2,String>, +ticket: String) -> List<&2,String>:
  match items:
    case Nil{}: ticket <> Nil{}
    case +head <> +rest: Bool.pick(List<&2,String>,ticket_before(ticket,head),ticket <> head <> rest,head <> insert_ticket(rest,ticket))

def expected_fields(value: Maybe<Nat>) -> String:
  match value:
    case None{}: "expected_kb=0\nhistory=0\n"
    case Some{peak}: "expected_kb=" ++ Nat.show(peak) ++ "\nhistory=1\n"

def fill_missing(+ticket: String, +name: String, +value: String) -> String:
  Bool.pick(String,String.is_empty(S.field(ticket,name)),name ++ "=" ++ value ++ "\n" ++ ticket,ticket)

def complete_ticket(+ticket: String) -> IO(String):
  Bool.pick(IO(String),Bool.and(Bool.not(String.is_empty(S.field(ticket,"shape"))),Bool.and(Bool.not(String.is_empty(S.field(ticket,"kind"))),Bool.not(String.is_empty(S.field(ticket,"mode"))))),IO.pure(String,ticket),
    do IO<String>:
      +attempt : String <- Proc.attempt(S.number(S.field(ticket,"pid")))
      +shape : String <- S.shape(attempt)
      +mode : String <- S.mode(attempt)
      +meta : String <- S.read(attempt ++ "/meta")
      +group : String <- S.read(attempt ++ "/group")
      IO.pure(String,fill_missing(fill_missing(fill_missing(fill_missing(ticket,"shape",shape),"mode",mode),"kind",S.field(meta,"kind")),"compiler",S.field(group,"compiler"))))

def load_tickets_match_2(+rest: List<&2,String>, +name: String, +path: String, +state: String, +acc: List<&2,String>, +text: String, live: Result<&1,&1,U32 & String,U32>) -> IO(List<&2,String>):
  match live:
    case Done{value}:
      Bool.pick(IO(List<&2,String>),Bool.and(U32.is_gt(value,0),valid_name(name)),
        do IO<List<&2,String>>:
          +completed : String <- complete_ticket(text)
          expected : Maybe<Nat> <- H.expected(state,completed)
          +pri : String <- S.read(state ++ "/keys/" ++ S.field(completed,"key") ++ "/priority")
          +row : String <- IO.pure(String,"id=" ++ name ++ "\npriority=" ++ U32.show(priority(S.field(pri,"priority"))) ++ "\n" ++ expected_fields(expected) ++ completed)
          load_tickets(rest,state,insert_ticket(acc,row)),
        do IO<List<&2,String>>:
          gone : Unit <- S.remove(path)
          load_tickets(rest,state,acc))
    case Fail{error}: load_tickets(rest,state,acc)

def load_tickets( +names: List<&2,String>, +state: String, +acc: List<&2,String>) -> IO(List<&2,String>):
  match names:
    case Nil{}: IO.pure(List<&2,String>,acc)
    case +name <> +rest:
      do IO<List<&2,String>>:
        +path : String <- IO.pure(String,state ++ "/admission/waiting/" ++ name)
        +text : String <- S.read(path)
        live : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(S.number(S.field(text,"pid")),S.field(text,"starttime"))
        load_tickets_match_2(rest, name, path, state, acc, text, live)

def cached_claims( +claims: List<&2,String>, +cache: String) -> Bool:
  match claims:
    case Nil{}: True{}
    case claim <> rest: Bool.and(Bool.not(String.is_empty(S.field(cache,"c." ++ S.field(claim,"id")))),cached_claims(rest,cache))

def measure_claims( +claims: List<&2,String>, +table: List<&2,String>) -> IO(String):
  match claims:
    case Nil{}: IO.pure(String,"")
    case +claim <> rest:
      do IO<String>:
        +root : String <- IO.pure(String,S.field(claim,"root"))
        +kb : Nat <- Proc.measure(table,S.number(Bool.pick(String,String.is_empty(root),S.field(claim,"pid"),root)),String.eq(S.field(claim,"measure"),"tree"))
        +tail : String <- measure_claims(rest,table)
        IO.pure(String,"c." ++ S.field(claim,"id") ++ "=" ++ Nat.show(kb) ++ "\n" ++ tail)

def observed(+state: String, +claims: List<&2,String>, +legacy: String, +now: String) -> IO(String):
  do IO<String>:
    +uid : U32 <- IO.try(U32,P.HostPosix.uid())
    +path : String <- IO.pure(String,state ++ "/admission/observed." ++ U32.show(uid))
    +old : String <- S.read(path)
    +fresh : Bool <- IO.pure(Bool,Bool.and(W.elapsed_lt(now,S.field(old,"ts_ns"),1000000000),Bool.and(String.eq(S.field(old,"legacy_pid"),S.field(legacy,"pid")),cached_claims(claims,old))))
    Bool.pick(IO(String),fresh,IO.pure(String,old),
      do IO<String>:
        +table : List<&2,String> <- Proc.table()
        +rows : String <- measure_claims(claims,table)
        +pid : U32 <- IO.pure(U32,S.number(S.field(legacy,"pid")))
        +kb : Nat <- Bool.pick(IO(Nat),U32.is_gt(pid,0),Proc.measure(table,pid,Bool.not(U32.is_eq(S.number(S.field(Proc.lookup(table,pid),"sid")),pid))),IO.pure(Nat,0n))
        +cache : String <- IO.pure(String,"ts_ns=" ++ now ++ "\nlegacy_pid=" ++ U32.show(pid) ++ "\n" ++ rows ++ "legacy_kb=" ++ Nat.show(kb) ++ "\n")
        saved : Unit <- S.write(path,cache)
        IO.pure(String,cache))

def usage_fresh(observed: Result<&1,&1,U32 & String,String>, +now: Nat) -> Bool:
  match observed:
    case Fail{error}: False{}
    case Done{record}: Nat.is_le(Nat.sub(now,S.nat(S.at(String.split(record,Char.from_u32(9)),5))),10n)

def published_claims( +claims: List<&2,String>, +state: String, +cache: String, +now: Nat) -> IO(List<&2,String>):
  match claims:
    case Nil{}: IO.pure(List<&2,String>,Nil{})
    case +claim <> rest:
      do IO<List<&2,String>>:
        +path : String <- IO.pure(String,state ++ "/admission/usage/" ++ S.field(claim,"id"))
        observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
        +usage : String <- S.read(path)
        +fresh : Bool <- IO.pure(Bool,Bool.and(usage_fresh(observed,now),Bool.not(String.is_empty(usage))))
        +kb : String <- IO.pure(String,Bool.pick(String,fresh,S.field(usage,"kb"),S.field(cache,"c." ++ S.field(claim,"id"))))
        +growth : String <- IO.pure(String,Bool.pick(String,fresh,S.field(usage,"growth_kb"),"0"))
        +hidden : Bool <- Bool.pick(IO(Bool),Bool.and(Bool.not(fresh),Nat.is_eq(S.nat(kb),0n)),Proc.hidden(S.number(S.field(claim,"root"))),IO.pure(Bool,False{}))
        +tail : List<&2,String> <- published_claims(rest,state,cache,now)
        IO.pure(List<&2,String>,("unreliable=" ++ Bool.pick(String,hidden,"1","0") ++ "\ncurrent_kb=" ++ kb ++ "\ngrowth_kb=" ++ growth ++ "\n" ++ claim) <> tail)

def max_growth( +claims: List<&2,String>) -> Nat:
  match claims:
    case Nil{}: 0n
    case claim <> rest: Nat.max(S.nat(S.field(claim,"growth_kb")),max_growth(rest))

def load(+state: String) -> IO(QueueView):
  do IO<QueueView>:
    +memory : String <- Proc.memory_info()
    +running : List<&2,String> <- S.names(state ++ "/admission/running")
    +claims : List<&2,String> <- load_claims(admission_names(running),state,Nil{})
    +waiting : List<&2,String> <- S.names(state ++ "/admission/waiting")
    +tickets : List<&2,String> <- load_tickets(admission_names(waiting),state,Nil{})
    +legacy : String <- Proc.legacy(state)
    +now : String <- IO.try(String,P.HostPosix.now_ns())
    +cache : String <- observed(state,claims,legacy,now)
    +measured : List<&2,String> <- published_claims(claims,state,cache,S.nat(String.take(now,Nat.sub(String.length(now),9n))))
    IO.pure(QueueView,QueueView{memory ++ "reserve=" ++ Nat.show(max_growth(measured)) ++ "\nlegacy_pid=" ++ S.field(legacy,"pid") ++ "\nlegacy_entry=" ++ S.field(legacy,"entry") ++ "\nlegacy_kb=" ++ S.field(cache,"legacy_kb") ++ "\n",measured,tickets})

def sum_field( +claims: List<&2,String>, +name: String) -> Nat:
  match claims:
    case Nil{}: 0n
    case claim <> rest: Nat.add(S.nat(S.field(claim,name)),sum_field(rest,name))

def used(+view: QueueView) -> Nat:
  Nat.add(sum_field(claims(view),"current_kb"),S.nat(S.field(facts(view),"legacy_kb")))

def outside(+view: QueueView) -> Nat:
  Nat.sub(S.nat(S.field(facts(view),"total")),Nat.add(S.nat(S.field(facts(view),"available")),used(view)))

def matching( +claims: List<&2,String>, +ticket: String) -> Nat:
  match claims:
    case Nil{}: 0n
    case +claim <> rest:
      +group = S.field(ticket,"group")
      +other = S.field(claim,"group")
      +same = Bool.pick(Bool,Bool.and(Bool.not(String.is_empty(group)),Bool.not(String.is_empty(other))),String.eq(group,other),String.eq(S.field(ticket,"entry"),S.field(claim,"entry")))
      Nat.max(Bool.pick(Nat,same,S.nat(S.field(claim,"current_kb")),0n),matching(rest,ticket))

def need(+view: QueueView, +ticket: String) -> Nat:
  Bool.pick(Nat,String.eq(S.field(ticket,"history"),"1"),S.nat(S.field(ticket,"expected_kb")),
    Bool.pick(Nat,String.is_empty(S.field(ticket,"entry")),0n,
      Nat.max(matching(claims(view),ticket),Bool.pick(Nat,String.eq(S.field(ticket,"entry"),S.field(facts(view),"legacy_entry")),S.nat(S.field(facts(view),"legacy_kb")),0n))))

def unspent( +claims: List<&2,String>) -> Nat:
  match claims:
    case Nil{}: 0n
    case +claim <> rest: Nat.add(Nat.sub(S.nat(S.field(claim,"expected_kb")),S.nat(S.field(claim,"current_kb"))),unspent(rest))

def backfilled( +claims: List<&2,String>) -> Nat:
  match claims:
    case Nil{}: 0n
    case +claim <> rest: Nat.add(Bool.pick(Nat,String.eq(S.field(claim,"backfill"),"1"),Nat.max(S.nat(S.field(claim,"expected_kb")),S.nat(S.field(claim,"current_kb"))),0n),backfilled(rest))

def all_history( +claims: List<&2,String>) -> Bool:
  match claims:
    case Nil{}: True{}
    case claim <> rest: Bool.and(String.eq(S.field(claim,"history"),"1"),all_history(rest))

def headroom(+view: QueueView) -> Nat:
  Nat.sub(S.nat(S.field(facts(view),"available")),Nat.add(unspent(claims(view)),S.nat(S.field(facts(view),"reserve"))))

def room_nonnegative(+view: QueueView) -> Bool:
  Nat.is_ge(S.nat(S.field(facts(view),"available")),Nat.add(unspent(claims(view)),S.nat(S.field(facts(view),"reserve"))))

def protect(+view: QueueView, +ticket: String, +ahead: String) -> Bool:
  +wanted = need(view,ticket)
  +prior = need(view,ahead)
  +free = headroom(view)
  +idle_total = Nat.add(S.nat(S.field(facts(view),"available")),used(view))
  +reserve = S.nat(S.field(facts(view),"reserve"))
  Bool.and(Bool.not(Bool.and(Nat.is_le(prior,free),Nat.is_gt(Nat.add(wanted,prior),free))),
    Nat.is_le(Nat.add(Nat.add(backfilled(claims(view)),Nat.add(wanted,prior)),reserve),idle_total))

def protect_ahead( +items: List<&2,String>, +view: QueueView, +ticket: String) -> Bool:
  match items:
    case Nil{}: True{}
    case +ahead <> rest:
      Bool.pick(Bool,String.eq(S.field(ahead,"id"),S.field(ticket,"id")),True{},
        Bool.and(Bool.or(U32.is_le(S.number(S.field(ahead,"priority")),S.number(S.field(ticket,"priority"))),protect(view,ticket,ahead)),protect_ahead(rest,view,ticket)))

def decision(+view: QueueView, +ticket: String) -> Bool:
  +head = S.first(tickets(view))
  +first = String.eq(S.field(head,"id"),S.field(ticket,"id"))
  +empty = Bool.and(String.is_empty(S.first(claims(view))),U32.is_eq(S.number(S.field(facts(view),"legacy_pid")),0))
  +wanted = need(view,ticket)
  +fit = Bool.and(room_nonnegative(view),Bool.pick(Bool,Nat.is_gt(wanted,0n),Nat.is_le(wanted,headroom(view)),Nat.is_gt(headroom(view),0n)))
  Bool.or(Bool.and(empty,first),Bool.and(String.eq(S.field(facts(view),"known"),"1"),
    Bool.and(Bool.or(String.eq(S.field(ticket,"history"),"1"),all_history(claims(view))),
      Bool.and(fit,Bool.or(first,Bool.and(protect(view,ticket,head),protect_ahead(tickets(view),view,ticket)))))))

def next_eligible( +items: List<&2,String>, +view: QueueView) -> String:
  match items:
    case Nil{}: ""
    case +ticket <> rest: Bool.pick(String,decision(view,ticket),ticket,next_eligible(rest,view))

def ticket_body(+attempt: String, +queued: String, +pid: U32, +start: String) -> IO(String):
  do IO<String>:
    +meta : String <- S.read(attempt ++ "/meta")
    +group : String <- S.read(attempt ++ "/group")
    +shape : String <- S.shape(attempt)
    +mode : String <- S.mode(attempt)
    IO.pure(String,"pid=" ++ U32.show(pid) ++ "\nstarttime=" ++ start ++ "\nkey=" ++ S.key(attempt) ++ "\ngroup=" ++ S.field(group,"group") ++ "\nentry=" ++ S.field(meta,"entry") ++ "\ncompiler=" ++ S.field(group,"compiler") ++ "\nkind=" ++ S.field(meta,"kind") ++ "\nshape=" ++ shape ++ "\nmode=" ++ mode ++ "\nqueued_ns=" ++ queued ++ "\n")

def claim_body(+ticket: String, +view: QueueView, +root: U32, +now: String) -> String:
  "pid=" ++ S.field(ticket,"pid") ++ "\nstarttime=" ++ S.field(ticket,"starttime") ++ "\nroot=" ++ U32.show(root) ++ "\nmeasure=session\nkey=" ++ S.field(ticket,"key") ++ "\ngroup=" ++ S.field(ticket,"group") ++ "\nentry=" ++ S.field(ticket,"entry") ++ "\nexpected_kb=" ++ Nat.show(need(view,ticket)) ++ "\nhistory=" ++ S.field(ticket,"history") ++ "\nbackfill=" ++ Bool.pick(String,String.eq(S.field(S.first(tickets(view)),"id"),S.field(ticket,"id")),"0","1") ++ "\nadmitted_ns=" ++ now ++ "\n"

def polled_claim(result: Result<&1,&1,U32 & String,U32>, +ticket_path: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Maybe<U32>>,Fail{error})
    case Done{fd}:
      do IO<Result<&1,&1,U32 & String,Maybe<U32>>>:
        removed : Unit <- S.remove(ticket_path)
        IO.pure(Result<&1,&1,U32 & String,Maybe<U32>>,Done{Some{fd}})

def has_id(items: List<&2,String>, +id: String) -> Bool:
  match items:
    case Nil{}: False{}
    case item <> rest: Bool.or(String.eq(S.field(item,"id"),id),has_id(rest,id))

def poll_locked(+state: String, +id: String, +body: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  do IO<Result<&1,&1,U32 & String,Maybe<U32>>>:
    +view : QueueView <- load(state)
    +next : String <- IO.pure(String,next_eligible(tickets(view),view))
    Bool.pick(IO(Result<&1,&1,U32 & String,Maybe<U32>>),String.eq(S.field(next,"id"),id),
      do IO<Result<&1,&1,U32 & String,Maybe<U32>>>:
        +root : U32 <- IO.try(U32,P.HostPosix.sid())
        +now : String <- IO.try(String,P.HostPosix.now_ns())
        created : Result<&1,&1,U32 & String,U32> <- P.HostPosix.create_locked(state ++ "/admission/running/" ++ id,claim_body(next,view,root,now))
        polled_claim(created,state ++ "/admission/waiting/" ++ id),
      do IO<Result<&1,&1,U32 & String,Maybe<U32>>>:
        written : Unit <- Bool.pick(IO(Unit),has_id(tickets(view),id),IO.pure(Unit,Unit{}),IO.try(Unit,F.Files.write_shared(state ++ "/admission/waiting/" ++ id,body)))
        IO.pure(Result<&1,&1,U32 & String,Maybe<U32>>,Done{None{}}))

def poll(+state: String, +id: String, +body: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  do IO<Result<&1,&1,U32 & String,Maybe<U32>>>:
    +fd : U32 <- IO.try(U32,lock(state))
    result : Result<&1,&1,U32 & String,Maybe<U32>> <- poll_locked(state,id,body)
    closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
    IO.pure(Result<&1,&1,U32 & String,Maybe<U32>>,result)

@unsafe

def wait_result(result: Result<&1,&1,U32 & String,Maybe<U32>>, +state: String, +id: String, +body: String) -> IO(Result<&1,&1,U32 & String,U32>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{Some{fd}}: IO.pure(Result<&1,&1,U32 & String,U32>,Done{fd})
    case Done{None{}}:
      do IO<Result<&1,&1,U32 & String,U32>>:
        slept : Unit <- IO.sleep(200)
        wait_loop(state,id,body)

@unsafe

def wait_loop(+state: String, +id: String, +body: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +signal : U32 <- IO.try(U32,P.HostPosix.pending_signal())
    Bool.pick(IO(Result<&1,&1,U32 & String,U32>),U32.is_gt(signal,0),
      IO.pure(Result<&1,&1,U32 & String,U32>,Fail{(125,"admission canceled")}),
      do IO<Result<&1,&1,U32 & String,U32>>:
        result : Result<&1,&1,U32 & String,Maybe<U32>> <- poll(state,id,body)
        wait_result(result,state,id,body))

def old_canceled_match_1(+old_pid: U32, +signal: U32, alive: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match alive:
    case Done{value}:
      Bool.pick(IO(Unit),Bool.and(U32.is_gt(signal,0),U32.is_gt(value,0)),
        do IO<Unit>:
          sent : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(old_pid,9)
          IO.pure(Unit,Unit{}),IO.pure(Unit,Unit{}))
    case Fail{error}: IO.pure(Unit,Unit{})

def old_canceled( +old_pid: U32, +old_start: String) -> IO(Unit):
  do IO<Unit>:
    +signal : U32 <- IO.try(U32,P.HostPosix.pending_signal())
    alive : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(old_pid,old_start)
    old_canceled_match_1(old_pid, signal, alive)

def install_claim(result: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{+fd}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        installed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.dup_to(fd,8)
        closed : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(fd,8),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),P.HostPosix.close_fd(fd))
        IO.pure(Result<&1,&1,U32 & String,Unit>,installed)

def admit(+attempt: String, +queued_override: String, +old_pid: U32, +old_start: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +state : String <- IO.pure(String,S.state(attempt))
    dirs : Unit <- IO.try(Unit,directories(state))
    +pid : U32 <- IO.try(U32,P.HostPosix.pid())
    +start : String <- IO.try(String,P.HostPosix.starttime(pid))
    +now : String <- IO.try(String,P.HostPosix.now_ns())
    +queued : String <- IO.pure(String,Bool.pick(String,Bool.not(W.equal(W.parse(queued_override),W.zero())),queued_override,now))
    +id : String <- IO.pure(String,S.id(queued,pid))
    +body : String <- ticket_body(attempt,queued,pid,start)
    +fd : U32 <- IO.try(U32,lock(state))
    written : Result<&1,&1,U32 & String,Unit> <- F.Files.write_shared(state ++ "/admission/waiting/" ++ id,body)
    closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
    valid : Unit <- IO.try(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,written))
    handled : Unit <- IO.try(Unit,Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_gt(old_pid,0),P.HostPosix.watch_signals(),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})))
    result : Result<&1,&1,U32 & String,U32> <- wait_loop(state,id,body)
    removed : Unit <- S.remove(state ++ "/admission/waiting/" ++ id)
    canceled : Unit <- Bool.pick(IO(Unit),U32.is_gt(old_pid,0),old_canceled(old_pid,old_start),IO.pure(Unit,Unit{}))
    restored : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_gt(old_pid,0),P.HostPosix.restore_signals(),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    install_claim(result)

def external(+keydir: String, +pid: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +state : String <- IO.pure(String,S.state(keydir ++ "/runs/x"))
    dirs : Unit <- IO.try(Unit,directories(state))
    +start : String <- IO.try(String,P.HostPosix.starttime(pid))
    +now : String <- IO.try(String,P.HostPosix.now_ns())
    +body : String <- IO.pure(String,"pid=" ++ U32.show(pid) ++ "\nstarttime=" ++ start ++ "\nroot=" ++ U32.show(pid) ++ "\nmeasure=tree\nkey=" ++ S.basename(keydir) ++ "\ngroup=\nexpected_kb=0\nhistory=1\nbackfill=0\nadmitted_ns=" ++ now ++ "\n")
    +fd : U32 <- IO.try(U32,lock(state))
    result : Result<&1,&1,U32 & String,U32> <- P.HostPosix.create_locked(state ++ "/admission/running/" ++ S.id(now,pid),body)
    closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
    IO.pure(Result<&1,&1,U32 & String,U32>,result)

def status_claims( +items: List<&2,String>) -> String:
  match items:
    case Nil{}: ""
    case +item <> rest:
      "running pid=" ++ S.field(item,"pid") ++ " key=" ++ S.field(item,"key") ++ " expected_kb=" ++ S.field(item,"expected_kb") ++ " current_kb=" ++ S.field(item,"current_kb") ++ " history=" ++ S.field(item,"history") ++ " backfill=" ++ S.field(item,"backfill") ++ "\n" ++ status_claims(rest)

def status_tickets( +items: List<&2,String>, +position: Nat) -> String:
  match items:
    case Nil{}: ""
    case +item <> rest:
      "waiting position=" ++ Nat.show(position) ++ " pid=" ++ S.field(item,"pid") ++ " key=" ++ S.field(item,"key") ++ " expected_kb=" ++ S.field(item,"expected_kb") ++ " history=" ++ S.field(item,"history") ++ " priority=" ++ priority_name(S.number(S.field(item,"priority"))) ++ "\n" ++ status_tickets(rest,Nat.add(position,1n))

def status(+state: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    dirs : Unit <- IO.try(Unit,directories(state))
    +fd : U32 <- IO.try(U32,lock(state))
    +view : QueueView <- load(state)
    released : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
    +facts : String <- IO.pure(String,facts(view))
    IO.pure(Result<&1,&1,U32 & String,String>,Done{"memory total_kb=" ++ S.field(facts,"total") ++ " available_kb=" ++ S.field(facts,"available") ++ " outside_use_kb=" ++ Nat.show(outside(view)) ++ " outside_growth_kb=" ++ S.field(facts,"reserve") ++ "\n"
      ++ Bool.pick(String,U32.is_gt(S.number(S.field(facts,"legacy_pid")),0),"legacy-holder pid=" ++ S.field(facts,"legacy_pid") ++ " current_kb=" ++ S.field(facts,"legacy_kb") ++ "\n","")
      ++ status_claims(claims(view)) ++ status_tickets(tickets(view),1n)})

def backfill(+state: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    dirs : Unit <- IO.try(Unit,directories(state))
    +fd : U32 <- IO.try(U32,lock(state))
    +report : String <- H.backfill_locked(state)
    released : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
    IO.pure(Result<&1,&1,U32 & String,String>,Done{report})
