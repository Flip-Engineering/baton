# Fixture for the #702 subscription-profile fallback. It drives the real operator list
# parse and order, the real credential-store binding, the real harness argv composition
# with its env option order, record serialization and optional-file read results.
# Native receive cases in receive.py exercise retained task and history continuation.
import Base
import ../src/coordinator/subscription-fallback.bend as Subs
import ../src/harness/codex-player.bend as Codex
import ../src/harness/claude-player.bend as Claude
import ../src/git/text.bend as Tx

def fixture_list() -> String:
  "codex codex-main /fixture/stores/codex-main\ncodex codex-alt /fixture/stores/codex alt\nclaude-code claude-main /fixture/stores/claude-main\n\n# comment line\n"

def check(label: String, is_ok: Bool) -> IO(Unit):
  match is_ok:
    case True{}: IO.print("fixture-profile " ++ label ++ ": ok")
    case False{}: IO.die(Unit,1,"fixture-profile " ++ label ++ ": refused")

def three(profiles: List<Subs.Profile>) -> Bool:
  match profiles:
    case first <> second <> third <> Nil{}: True{}
    case other: False{}

def head_is(profiles: List<Subs.Profile>, harness: String, expected: String) -> IO(Unit):
  match Subs.first_profile(profiles,harness):
    case Some{+profile}: check("head-" ++ harness,String.eq(profile.label,expected))
    case None{}: IO.die(Unit,1,"fixture-profile head-" ++ harness ++ ": no profile")

def next_is(profiles: List<Subs.Profile>, harness: String, current: String, expected: String) -> IO(Unit):
  match Subs.next_profile(profiles,harness,current):
    case Some{+profile}: check("next-" ++ current,String.eq(profile.label,expected))
    case None{}: IO.die(Unit,1,"fixture-profile next-" ++ current ++ ": no profile")

def next_none(profiles: List<Subs.Profile>, harness: String, current: String) -> IO<Unit>:
  match Subs.next_profile(profiles,harness,current):
    case Some{+profile}: IO.die(Unit,1,"fixture-profile next-" ++ current ++ ": unexpected " ++ profile.label)
    case None{}: check("none-after-" ++ current,True{})

def starts_at_head(profiles: List<Subs.Profile>) -> IO<Unit>:
  match Subs.started_or_next(profiles,"codex",""):
    case Some{+profile}: check("no-record-starts-at-the-head",String.eq(profile.label,"codex-main"))
    case None{}: IO.die(Unit,1,"fixture-profile start: no profile")

def advances(profiles: List<Subs.Profile>) -> IO<Unit>:
  match Subs.started_or_next(profiles,"codex","codex-main"):
    case Some{+profile}: check("record-advances-to-the-next",String.eq(profile.label,"codex-alt"))
    case None{}: IO.die(Unit,1,"fixture-profile advance: no profile")

def spaced_store(profiles: List<Subs.Profile>) -> IO<Unit>:
  match Subs.store_binding("codex","/fixture/stores/codex alt"):
    case single <> Nil{}: check("store-path-with-spaces-is-one-element",String.eq(single,"CODEX_HOME=/fixture/stores/codex alt"))
    case other: IO.die(Unit,1,"fixture-profile spaced-store: not one element")

# The corrected env order is proved on the real argv composition: env, both existing
# key unbinds, then the store assignment, then the command.
def codex_order(store: String) -> IO<Unit>:
  match Codex.bound_arguments(Subs.store_binding("codex",store),Nil{},"/fixture/bin/codex","gpt-6-luna","high","native-fixture",False{}):
    case env <> uns <> key <> uns2 <> key2 <> assigned <> command <> rest:
      check("codex-env-options-come-first",Bool.and(String.eq(env,"/usr/bin/env"),Bool.and(String.eq(uns,"-u"),Bool.and(String.eq(key,"OPENAI_API_KEY"),Bool.and(String.eq(uns2,"-u"),String.eq(key2,"CODEX_API_KEY"))))))
    case other: IO.die(Unit,1,"fixture-profile codex-order: too few arguments")

def codex_plain() -> IO<Unit>:
  match Codex.bound_arguments(Nil{},Nil{},"/fixture/bin/codex","gpt-6-luna","high","native-fixture",False{}):
    case env <> uns <> key <> rest: check("codex-empty-binding-is-plain",Bool.and(String.eq(env,"/usr/bin/env"),String.eq(uns,"-u")))
    case other: IO.die(Unit,1,"fixture-profile codex-plain: too few arguments")

def claude_order(store: String) -> IO<Unit>:
  match Claude.bound_arguments(Subs.store_binding("claude-code",store),"/fixture/bin/claude","opus-4-6","high","",True{}):
    case env <> uns <> key <> uns2 <> key2 <> uns3 <> key3 <> assigned <> command <> rest:
      do IO<Unit>:
        options : Unit <- check("claude-auth-options-come-first",Bool.and(String.eq(env,"/usr/bin/env"),Bool.and(String.eq(uns,"-u"),Bool.and(String.eq(uns2,"-u"),String.eq(uns3,"-u")))))
        keys : Unit <- check("claude-auth-overrides-removed",Bool.and(String.eq(key,"ANTHROPIC_API_KEY"),Bool.and(String.eq(key2,"ANTHROPIC_AUTH_TOKEN"),String.eq(key3,"CLAUDE_CODE_OAUTH_TOKEN"))))
        check("claude-store-before-command",Bool.and(String.eq(assigned,"CLAUDE_CONFIG_DIR=/fixture/stores/claude-main"),String.eq(command,"/fixture/bin/claude")))
    case other: IO.die(Unit,1,"fixture-profile claude-order: too few arguments")

def claude_plain() -> IO<Unit>:
  match Claude.bound_arguments(Nil{},"/fixture/bin/claude","opus-4-6","high","",True{}):
    case command <> rest: check("claude-empty-binding-is-plain",String.eq(command,"/fixture/bin/claude"))
    case other: IO.die(Unit,1,"fixture-profile claude-plain: no arguments")

def record_checks() -> IO<Unit>:
  do IO<Unit>:
    last : Unit <- check("record-last-line-is-current",String.eq(Subs.last_line(Tx.split_lines("codex-main /fixture/a\ncodex-alt /fixture/b c\n")),"codex-alt /fixture/b c"))
    label : Unit <- check("record-label-parses",String.eq(Subs.record_label("codex-alt /fixture/b c"),"codex-alt"))
    store : Unit <- check("record-store-keeps-spaces",String.eq(Subs.record_store("codex-alt /fixture/b c"),"/fixture/b c"))
    serialized : String <- IO.pure(String,Subs.record_line(Subs.Pr{"codex","codex-alt","/fixture/b c"}))
    line : Unit <- check("record-line-keeps-spaces",String.eq(serialized,"codex-alt /fixture/b c"))
    roundtrip : Unit <- check("record-line-roundtrip",Bool.and(String.eq(Subs.record_label(serialized),"codex-alt"),String.eq(Subs.record_store(serialized),"/fixture/b c")))
    empty : Unit <- check("empty-record-is-empty",String.eq(Subs.last_line(Nil{}),""))
    IO.pure(Unit,Unit{})

def missing_read() -> IO<Unit>:
  match Subs.optional_text(Fail{(2,"No such file or directory")}):
    case Done{text}: check("missing-optional-file-is-empty",String.is_empty(text))
    case Fail{error}: IO.die(Unit,1,"fixture-profile missing-optional-file: unexpected failure")

def failed_read(code: U32, detail: String) -> IO<Unit>:
  match Subs.optional_text(Fail{(code,detail)}):
    case Fail{(actual_code,actual_detail)}: check("read-cause-retained",Bool.and(U32.is_eq(actual_code,code),String.eq(actual_detail,detail)))
    case Done{text}: IO.die(Unit,1,"fixture-profile failed-read: failure discarded")

def read_checks() -> IO<Unit>:
  do IO<Unit>:
    missing : Unit <- missing_read()
    denied : Unit <- failed_read(13,"Permission denied")
    failed : Unit <- failed_read(5,"Input/output error")
    IO.pure(Unit,Unit{})

def main() -> IO<Unit>:
  do IO<Unit>:
    profiles : List<Subs.Profile> <- IO.pure(List<Subs.Profile>,Subs.profile_lines(Tx.split_lines(fixture_list())))
    counted : Unit <- check("list-parses-three-profiles",three(profiles))
    head : Unit <- head_is(profiles,"codex","codex-main")
    step : Unit <- next_is(profiles,"codex","codex-main","codex-alt")
    last : Unit <- next_none(profiles,"codex","codex-alt")
    unlisted : Unit <- next_none(profiles,"omp","codex-main")
    started : Unit <- starts_at_head(profiles)
    advanced : Unit <- advances(profiles)
    spaced : Unit <- spaced_store(profiles)
    codex : Unit <- codex_order("/fixture/stores/codex alt")
    plain : Unit <- codex_plain()
    claude : Unit <- claude_order("/fixture/stores/claude-main")
    claude_plain_ok : Unit <- claude_plain()
    records : Unit <- record_checks()
    reads : Unit <- read_checks()
    printed : Unit <- IO.print("fixture-profiles-ok")
    IO.pure(Unit,Unit{})
