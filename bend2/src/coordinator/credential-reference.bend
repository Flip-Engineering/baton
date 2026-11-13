import Base

# Credential reference forms used by account writes and provider usage reads.
type Form is Data:
  ReferenceForm{kind: String, prefix: String, label: String, empty: Bool}

def forms() -> List<Form>:
  [ReferenceForm{"store","/","absolute store directory",True{}},
   ReferenceForm{"omp-models","omp-models:","omp-models:BLOCK",False{}},
   ReferenceForm{"omp-auth","omp-auth:","omp-auth:PROVIDER",False{}},
   ReferenceForm{"claude-oauth","claude-oauth:","claude-oauth:PATH",True{}},
   ReferenceForm{"file","file:","file:PATH",False{}},
   ReferenceForm{"keychain","keychain:","keychain:SERVICE/ACCOUNT",False{}},
   ReferenceForm{"codex-home","codex-home:","codex-home:PATH",True{}}]

def safe_text(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head,tail}: Bool.and(Bool.and(Bool.not(U32.is_lt(Char.to_u32(head),32)),Bool.not(U32.is_eq(Char.to_u32(head),127))),safe_text(tail))

def keychain_parts(text: String, service: Bool) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{head,tail}: Bool.pick(Bool,Char.is_eq(head,Char.from_u32(47)),Bool.and(service,Bool.not(String.is_empty(tail))),keychain_parts(tail,True{}))

def form_matches(form: Form, +reference: String) -> Bool:
  match form:
    case ReferenceForm{+kind,+prefix,label,+empty}:
      +payload = String.drop(reference,String.length(prefix))
      Bool.and(String.starts_with(reference,prefix),Bool.and(Bool.or(empty,Bool.not(String.is_empty(payload))),Bool.or(Bool.not(String.eq(kind,"keychain")),keychain_parts(payload,False{}))))

def form_kind(form: Form) -> String:
  match form:
    case ReferenceForm{kind,prefix,label,empty}: kind

def kind_from(remaining: List<Form>, +reference: String) -> String:
  match remaining:
    case Nil{}: ""
    case +form <> rest: Bool.pick(String,form_matches(form,reference),form_kind(form),kind_from(rest,reference))

def kind(+reference: String) -> String:
  Bool.pick(String,safe_text(reference),kind_from(forms(),reference),"")

def member(+needle: String, values: List<String>) -> Bool:
  match values:
    case Nil{}: False{}
    case value <> rest: Bool.or(String.eq(needle,value),member(needle,rest))

def account_kinds(harness: String, funding: String) -> List<String>:
  Bool.pick(List<String>,Bool.and(String.eq(harness,"claude-code"),String.eq(funding,"api_key")),["file","keychain"],["store"])

def http_kinds() -> List<String>:
  ["store","omp-models","omp-auth","claude-oauth","file"]

def accepted_account(harness: String, funding: String, reference: String) -> Bool:
  member(kind(reference),account_kinds(harness,funding))

def labels_from(remaining: List<Form>, +kinds: List<String>, +separator: String) -> String:
  match remaining:
    case Nil{}: ""
    case ReferenceForm{kind,prefix,+label,empty} <> rest:
      Bool.pick(String,member(kind,kinds),separator ++ label ++ labels_from(rest,kinds,", "),labels_from(rest,kinds,separator))

def describe(kinds: List<String>) -> String:
  labels_from(forms(),kinds,"")

def account_forms(harness: String, funding: String) -> String:
  describe(account_kinds(harness,funding))

def http_forms() -> String:
  describe(http_kinds())
