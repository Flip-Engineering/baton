# Fixture for the #702 subscription-profile fallback. It drives the real operator list
# parse and order, the real credential-store binding, the real harness argv composition
# with its env option order, record serialization and optional-file read results.
# Route selection drives the real two-field parse, the Opus pairing rule, incident
# refusal skips and operator-order choice over parsed fixture entries only: entry
# names are fixtures and prove no live availability.
# Native receive cases in receive.py exercise retained task and history continuation.
import Base
import ../src/coordinator/subscription-fallback.bend as Subs
import ../src/harness/codex-player.bend as Codex
import ../src/harness/claude-player.bend as Claude
import ../src/git/text.bend as Tx

def fixture_list() -> String:
  "codex codex-main /fixture/stores/codex-main\ncodex codex-alt /fixture/stores/codex alt\nclaude-code claude-main /fixture/stores/claude-main\n\n"

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
    +serialized : String <- IO.pure(String,Subs.record_line(Subs.Pr{"codex","codex-alt","/fixture/b c"}))
    line : Unit <- check("record-line-names-harness",String.eq(serialized,"codex codex-alt /fixture/b c"))
    roundtrip : Unit <- check("record-line-roundtrip",Bool.and(String.eq(Subs.record_label(serialized),"codex-alt"),Bool.and(String.eq(Subs.record_store(serialized),"/fixture/b c"),String.eq(Subs.record_harness(serialized),"codex"))))
    legacy : Unit <- check("legacy-record-carries-no-harness",Bool.and(String.eq(Subs.record_label("codex-alt /fixture/b c"),"codex-alt"),Bool.and(String.eq(Subs.record_store("codex-alt /fixture/b c"),"/fixture/b c"),String.eq(Subs.record_harness("codex-alt /fixture/b c"),""))))
    current : Unit <- check("record-current-stays-on-harness",String.eq(Subs.record_current("codex","codex codex-alt /fixture/b c"),"codex-alt"))
    switched : Unit <- check("record-current-restarts-off-harness",String.eq(Subs.record_current("claude-code","codex codex-alt /fixture/b c"),""))
    legacy_current : Unit <- check("legacy-record-keeps-label",String.eq(Subs.record_current("codex","codex-alt /fixture/b c"),"codex-alt"))
    source : Unit <- check("record-source-stays-on-harness",String.eq(Subs.record_source("codex","codex codex-alt /fixture/b c"),"/fixture/b c"))
    source_reset : Unit <- check("record-source-resets-off-harness",String.eq(Subs.record_source("claude-code","codex codex-alt /fixture/b c"),""))
    legacy_source : Unit <- check("legacy-record-keeps-store",String.eq(Subs.record_source("codex","codex-alt /fixture/b c"),"/fixture/b c"))
    chosen : Unit <- check("route-chosen-body",String.eq(Subs.route_chosen_body("omp","sol-main","/fixture/bin/omp path","provider-reported usage exhaustion: hit your limit"),"cross-harness route selected: harness=omp; model=sol-main; command=/fixture/bin/omp path; original cause: provider-reported usage exhaustion: hit your limit"))
    unavailable : Unit <- check("route-unavailable-body",String.eq(Subs.route_unavailable_body("codex","provider-reported usage exhaustion: hit your limit"),"cross-harness routes unavailable: harness=codex refused every operator-listed route after all its accounts reported usage exhaustion; original cause: provider-reported usage exhaustion: hit your limit; the task stays retained with its owed input; resume the session or configure a route to continue."))
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

# route_fixture_list is operator preference order: one command-less entry selection
# skips, one Opus-off-harness entry, usable entries (one with a spaced command path),
# one empty line, one fieldless line, and one empty-model line. Refused lists are
# per-session lineage pairs, which carry no command by construction.
def route_fixture_list() -> String:
  "aaa nopick\nomp opus-side /fixture/bin/omp\nomp sol-main /fixture/bin/omp path\nmuse muse-main /fixture/bin/muse\nclaude-code opus-main /fixture/bin/claude\ncodex codex-main /fixture/bin/codex\n\nlonely\nmuse \n"

def route_six(routes: List<Subs.Route>) -> IO(Unit):
  match routes:
    case first <> second <> third <> fourth <> fifth <> sixth <> Nil{}: check("route-list-parses-six",True{})
    case other: IO.die(Unit,1,"fixture-profile route-list: unexpected shape")

def route_pick(decided: Maybe<&2,Subs.Route>, +harness: String, +model: String, +expected_harness: String, +expected_model: String, +expected_cmd: String) -> IO(Unit):
  match decided:
    case Some{+route}: check("route-pick-" ++ harness ++ "-" ++ model,Bool.and(String.eq(Subs.route_harness(route),expected_harness),Bool.and(String.eq(Subs.route_model(route),expected_model),String.eq(Subs.route_cmd(route),expected_cmd))))
    case None{}: IO.die(Unit,1,"fixture-profile route-pick-" ++ harness ++ "-" ++ model ++ ": no route")

def route_chosen(routes: List<Subs.Route>, refused: List<Subs.Route>, +harness: String, +model: String, +expected_harness: String, +expected_model: String, +expected_cmd: String) -> IO(Unit):
  route_pick(Subs.choose_route(routes,refused,harness,model),harness,model,expected_harness,expected_model,expected_cmd)

# A two-field lineage pair parses with an empty command: membership compares the
# harness/model pair only, and selection never picks a command-less entry.
def route_head_cmd(routes: List<Subs.Route>) -> IO(Unit):
  match routes:
    case head <> tail: check("route-lineage-pair-carries-no-command",String.eq(Subs.route_cmd(head),""))
    case Nil{}: IO.die(Unit,1,"fixture-profile route-lineage-pair: unexpected shape")

def route_cmd_default() -> IO(Unit):
  route_head_cmd(Subs.route_lines(Tx.split_lines("codex codex-main\n")))

def refusal_epoch_shown(refused: Maybe<&2,Subs.Refusal>, +name: String, +expected: String) -> IO(Unit):
  match refused:
    case Some{+refusal}: check(name,String.eq(Subs.refusal_epoch(refusal),expected))
    case None{}: IO.die(Unit,1,"fixture-profile refusal: no refusal")

def refusal_assignment_shown(refused: Maybe<&2,Subs.Refusal>, +name: String, +expected: String) -> IO(Unit):
  match refused:
    case Some{+refusal}: check(name,String.eq(Subs.refusal_assignment(refusal),expected))
    case None{}: IO.die(Unit,1,"fixture-profile refusal: no refusal")

def refusal_harness_shown(refused: Maybe<&2,Subs.Refusal>, +name: String, +expected: String) -> IO(Unit):
  match refused:
    case Some{+refusal}: check(name,String.eq(Subs.route_harness(Subs.refusal_route(refusal)),expected))
    case None{}: IO.die(Unit,1,"fixture-profile refusal: no refusal")

def refusal_checks() -> IO(Unit):
  do IO<Unit>:
    digits : Unit <- check("epoch-digits",Bool.and(Subs.epoch_digits("12"),Bool.and(Bool.not(Subs.epoch_digits("1a")),Bool.not(Subs.epoch_digits("")))))
    marked : Unit <- refusal_epoch_shown(Subs.refusal_of("7 42 omp sol-main"),"refusal-marked-epoch","7")
    marked_task : Unit <- refusal_assignment_shown(Subs.refusal_of("7 42 omp sol-main"),"refusal-marked-assignment","42")
    marked_pair : Unit <- refusal_harness_shown(Subs.refusal_of("7 42 omp sol-main"),"refusal-marked-pair","omp")
    legacy : Unit <- refusal_epoch_shown(Subs.refusal_of("codex codex-main"),"refusal-legacy-epoch","0")
    legacy_task : Unit <- refusal_assignment_shown(Subs.refusal_of("codex codex-main"),"refusal-legacy-assignment","0")
    legacy_pair : Unit <- refusal_harness_shown(Subs.refusal_of("codex codex-main"),"refusal-legacy-pair","codex")
    IO.pure(Unit,Unit{})

def route_absent(decided: Maybe<&2,Subs.Route>, +harness: String) -> IO(Unit):
  match decided:
    case Some{+route}: IO.die(Unit,1,"fixture-profile route-none: unexpected " ++ Subs.route_line(route))
    case None{}: check("route-none-" ++ harness,True{})

def route_none(routes: List<Subs.Route>, refused: List<Subs.Route>, +harness: String, model: String) -> IO(Unit):
  route_absent(Subs.choose_route(routes,refused,harness,model),harness)

def route_names() -> IO(Unit):
  do IO<Unit>:
    lower : Unit <- check("opus-lower",Subs.names_opus("opus"))
    upper : Unit <- check("opus-upper",Subs.names_opus("Opus"))
    prefixed : Unit <- check("opus-prefixed",Subs.names_opus("anthropic/opus-4"))
    other : Unit <- check("opus-sonnet",Bool.not(Subs.names_opus("sonnet")))
    empty : Unit <- check("opus-empty",Bool.not(Subs.names_opus("")))
    short : Unit <- check("opus-short",Bool.not(Subs.names_opus("op")))
    IO.pure(Unit,Unit{})

def main() -> IO<Unit>:
  do IO<Unit>:
    +profiles : List<Subs.Profile> <- IO.pure(List<Subs.Profile>,Subs.profile_lines(Tx.split_lines(fixture_list())))
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
    +routes : List<Subs.Route> <- IO.pure(List<Subs.Route>,Subs.route_lines(Tx.split_lines(route_fixture_list())))
    route_count : Unit <- route_six(routes)
    refused_codex : List<Subs.Route> <- IO.pure(List<Subs.Route>,Subs.route_lines(Tx.split_lines("codex codex-main\n")))
    route_first : Unit <- route_chosen(routes,refused_codex,"codex","codex-main","omp","sol-main","/fixture/bin/omp path")
    refused_two : List<Subs.Route> <- IO.pure(List<Subs.Route>,Subs.route_lines(Tx.split_lines("omp sol-main\ncodex codex-main\n")))
    route_opus : Unit <- route_chosen(routes,refused_two,"muse","muse-main","claude-code","opus-main","/fixture/bin/claude")
    refused_four : List<Subs.Route> <- IO.pure(List<Subs.Route>,Subs.route_lines(Tx.split_lines("omp sol-main\nmuse muse-main\ncodex codex-main\nomp opus-side\n")))
    route_last : Unit <- route_none(routes,refused_four,"claude-code","opus-main")
    route_unrunnable : Unit <- route_cmd_default()
    refusals : Unit <- refusal_checks()
    route_words : Unit <- route_names()
    printed : Unit <- IO.print("fixture-profiles-ok")
    IO.pure(Unit,Unit{})
