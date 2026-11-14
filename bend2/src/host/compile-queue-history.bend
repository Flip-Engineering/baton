import Base
import ../git/text.bend as Tx
import ./compile-queue-lifecycle.bend as L
import ./compile-queue-result.bend as Result

type Candidates is Data:
  Candidates{family: String, same: String, host: String}

def field(text: String, name: String) -> String:
  Result.CompileQueueResult.field(text,name)

def number(parsed: Maybe<&2,U32>) -> U32:
  match parsed:
    case None{}: 0
    case Some{value}: value

def peak(text: String) -> U32:
  number(U32.read(field(text,"peak_kb")))

def read_value(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: ""
    case Done{text}: text

def read(path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- L.CompileQueueLifecycle.read_text(path)
    IO.pure(String,read_value(result))

def names(path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- L.CompileQueueLifecycle.list_dir(path)
    IO.pure(String,read_value(result))

def record(kb: U32, source: String, key: String, attempt: String, kind: String) -> String:
  "peak_kb=" ++ U32.show(kb) ++ "\npeak_source=" ++ source
  ++ "\npeak_key=" ++ key ++ "\npeak_attempt=" ++ attempt ++ "\nkind=" ++ kind ++ "\n"

def larger(+candidate: String, +current: String) -> String:
  Bool.pick(String,U32.is_gt(peak(candidate),peak(current)),candidate,current)

# A cross-request measurement retains its successful result and original identity.
def observation(+text: String) -> IO(String):
  do IO<String>:
    +key : String <- IO.pure(String,field(text,"key"))
    +attempt : String <- IO.pure(String,field(text,"attempt"))
    result : String <- read(attempt ++ "/result")
    +eligible : Bool <- IO.pure(Bool,Bool.and(U32.is_gt(peak(text),0),
      Bool.and(Bool.not(String.is_empty(attempt)),
        Bool.and(Result.CompileQueueResult.recorded_completed(result,key),
          Bool.not(String.eq(field(result,"external"),"1"))))))
    IO.pure(String,Bool.pick(String,eligible,
      record(peak(text),"",key,attempt,field(result,"kind")),""))

def classify(+text: String, +kind: String, +family: String, toolchain: String,
             derive: (@+attempt: String -> @+toolchain: String -> IO(String))) -> IO(String):
  Bool.pick(IO(String),Bool.and(U32.is_gt(peak(text),0),
    Bool.and(String.eq(field(text,"kind"),kind),Bool.not(String.is_empty(family)))),
    do IO<String>:
      +attempt : String <- IO.pure(String,field(text,"peak_attempt"))
      profile : String <- read(attempt ++ "/history-group")
      +known : String <- IO.pure(String,field(profile,"family"))
      actual : String <- Bool.pick(IO(String),String.is_empty(known),derive(attempt,toolchain),IO.pure(String,known))
      IO.pure(String,"family=" ++ actual ++ "\n" ++ text),
    IO.pure(String,text))

def add(+text: String, +kind: String, +family: String, candidates: Candidates) -> Candidates:
  match candidates:
    case Candidates{compatible,same,host}:
      Candidates{Bool.pick(String,Bool.and(Bool.not(String.is_empty(family)),String.eq(field(text,"family"),family)),larger(text,compatible),compatible),
        Bool.pick(String,String.eq(field(text,"kind"),kind),larger(text,same),same),
        larger(text,host)}

def history_records(files: List<&1,String>, +state: String, +kind: String, +family: String, +toolchain: String,
                    +derive: (@+attempt: String -> @+toolchain: String -> IO(String)), candidates: Candidates) -> IO(Candidates):
  match files:
    case Nil{}: IO.pure(Candidates,candidates)
    case name <> rest: do IO<Candidates>:
      text : String <- read(state ++ "/history/" ++ name)
      measured : String <- observation(text)
      classified : String <- classify(measured,kind,family,toolchain,derive)
      history_records(rest,state,kind,family,toolchain,derive,add(classified,kind,family,candidates))

def sole(files: List<&2,String>) -> Bool:
  match files:
    case name <> Nil{}: True{}
    case other: False{}

def completed_peak(+state: String, +key: String) -> IO(String):
  do IO<String>:
    +result : String <- read(state ++ "/keys/" ++ key ++ "/completed/result")
    Bool.pick(IO(String),Result.CompileQueueResult.recorded_completed(result,key),
      do IO<String>:
        +attempt : String <- IO.pure(String,field(result,"attempt"))
        own : String <- read(attempt ++ "/peak")
        # A sole legacy run identifies the source of its key-level observation.
        raw : String <- Bool.pick(IO(String),U32.is_gt(peak(own),0),IO.pure(String,own),
          do IO<String>:
            runs : String <- names(state ++ "/keys/" ++ key ++ "/runs")
            Bool.pick(IO(String),sole(Tx.split_nul(runs)),
              read(state ++ "/keys/" ++ key ++ "/peak"),IO.pure(String,"")))
        observation("key=" ++ key ++ "\nattempt=" ++ attempt ++ "\n" ++ raw),
      IO.pure(String,""))

def key_records(keys: List<&1,String>, +state: String, +kind: String, +family: String, +toolchain: String,
                +derive: (@+attempt: String -> @+toolchain: String -> IO(String)), candidates: Candidates) -> IO(Candidates):
  match keys:
    case Nil{}: IO.pure(Candidates,candidates)
    case key <> rest: do IO<Candidates>:
      measured : String <- completed_peak(state,key)
      classified : String <- classify(measured,kind,family,toolchain,derive)
      key_records(rest,state,kind,family,toolchain,derive,add(classified,kind,family,candidates))

def fallback(+state: String, +kind: String, +profile: String,
             +derive: (@+attempt: String -> @+toolchain: String -> IO(String))) -> IO(String):
  do IO<String>:
    +family : String <- IO.pure(String,field(profile,"family"))
    +toolchain : String <- IO.pure(String,field(profile,"toolchain"))
    files : String <- names(state ++ "/history")
    grouped : Candidates <- history_records(Tx.split_nul(files),state,kind,family,toolchain,derive,Candidates{"","",""})
    keys : String <- names(state ++ "/keys")
    candidates : Candidates <- key_records(Tx.split_nul(keys),state,kind,family,toolchain,derive,grouped)
    match candidates:
      case Candidates{+compatible,+same,+host}:
        +selected = Bool.pick(String,U32.is_gt(peak(compatible),0),compatible,Bool.pick(String,U32.is_gt(peak(same),0),same,host))
        +source = Bool.pick(String,U32.is_gt(peak(compatible),0),"family",Bool.pick(String,U32.is_gt(peak(same),0),"kind","host"))
        IO.pure(String,record(peak(selected),Bool.pick(String,U32.is_gt(peak(selected),0),source,"bootstrap"),
          field(selected,"peak_key"),field(selected,"peak_attempt"),field(selected,"kind")))

def profile_from_attempts(files: List<&1,String>, +keydir: String, +group: String) -> IO(String):
  match files:
    case Nil{}: IO.pure(String,"")
    case name <> rest: do IO<String>:
      +profile : String <- read(keydir ++ "/runs/" ++ name ++ "/history-group")
      Bool.pick(IO(String),Bool.and(String.eq(field(profile,"group"),group),Bool.not(String.is_empty(field(profile,"family")))),
        IO.pure(String,profile),profile_from_attempts(rest,keydir,group))

def profile(+state: String, +key: String, +group: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(group),IO.pure(String,""),
    do IO<String>:
      +keydir : String <- IO.pure(String,state ++ "/keys/" ++ key)
      files : String <- names(keydir ++ "/runs")
      profile_from_attempts(Tx.split_nul(files),keydir,group))

def lookup(+state: String, +key: String, +group: String, +kind: String,
           derive: (@+attempt: String -> @+toolchain: String -> IO(String))) -> IO(String):
  do IO<String>:
    exact : String <- read(state ++ "/keys/" ++ key ++ "/peak")
    group_text : String <- Bool.pick(IO(String),String.is_empty(group),IO.pure(String,""),
      read(state ++ "/history/" ++ group))
    grouped : String <- observation(group_text)
    +own : String <- IO.pure(String,record(peak(exact),"exact",key,field(exact,"attempt"),kind))
    +workload : String <- IO.pure(String,record(peak(grouped),"workload",field(grouped,"peak_key"),
      field(grouped,"peak_attempt"),field(grouped,"kind")))
    +direct : String <- IO.pure(String,larger(workload,own))
    Bool.pick(IO(String),U32.is_gt(peak(direct),0),IO.pure(String,direct),
      do IO<String>:
        current : String <- profile(state,key,group)
        fallback(state,kind,current,derive))

def kind_from_attempts(files: List<&1,String>, +keydir: String) -> IO(String):
  match files:
    case Nil{}: IO.pure(String,"")
    case name <> rest: do IO<String>:
      meta : String <- read(keydir ++ "/runs/" ++ name ++ "/meta")
      +kind : String <- IO.pure(String,field(meta,"kind"))
      Bool.pick(IO(String),String.is_empty(kind),kind_from_attempts(rest,keydir),IO.pure(String,kind))

def request_kind(+state: String, +key: String, supplied: String) -> IO(String):
  Bool.pick(IO(String),Bool.not(String.is_empty(supplied)),IO.pure(String,supplied),
    do IO<String>:
      +keydir : String <- IO.pure(String,state ++ "/keys/" ++ key)
      files : String <- names(keydir ++ "/runs")
      kind_from_attempts(Tx.split_nul(files),keydir))

# Existing claims keep their recorded reservation. A claim written with no peak
# obtains its reservation from the retained measurement evidence on each scan.
def running_record(+state: String, +text: String,
                   derive: (@+attempt: String -> @+toolchain: String -> IO(String))) -> IO(String):
  Bool.pick(IO(String),U32.is_gt(number(U32.read(field(text,"expected_kb"))),0),IO.pure(String,text),
    do IO<String>:
      +key : String <- IO.pure(String,field(text,"key"))
      kind : String <- request_kind(state,key,field(text,"kind"))
      measurement : String <- lookup(state,key,field(text,"history_group"),kind,derive)
      IO.pure(String,"expected_kb=" ++ U32.show(peak(measurement)) ++ "\n" ++ text))

def own_history(text: String) -> U32:
  +source = field(text,"peak_source")
  Bool.pick(U32,Bool.or(String.eq(source,"exact"),Bool.or(String.eq(source,"workload"),String.eq(source,"family"))),1,0)

def describe(+text: String) -> String:
  "peak_source=" ++ field(text,"peak_source") ++ "\npeak_key=" ++ field(text,"peak_key")
  ++ "\npeak_attempt=" ++ field(text,"peak_attempt") ++ "\npeak_kind=" ++ field(text,"kind") ++ "\n"
