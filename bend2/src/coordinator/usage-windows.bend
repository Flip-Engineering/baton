# Usage windows record provider-reported subscription quota windows and the
# reset times observed for them (#797). The Kimi Code 5-hour rolling window is
# the named failure: the provider's 403 message names no reset timestamp, the
# Kimi Console web UI shows one, and the client's usage report carries one when
# a live credential can fetch it. Each observation binds to the session's
# harness, the provider prefix of its recorded model, and the current
# subscription profile label (an empty label means account-wide for that
# harness and provider). A missing reset time is the upper bound of a named window
# (5-hour, 7-day) or NULL. The gate reads a NULL reset as the re-probe instant
# after the latest refusal. The wake gate refuses new turns for a held window
# and admits them again after the recorded reset or re-probe instant, and a
# successful attempt clears the exhausted windows of its account. These are
# subscription windows; Claude monthly promotional API credits (#793) are a
# separate funding source and are not tracked here.
import Base
import ../coordinator/commands.bend as C
import ./usage.bend as Usage
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ./store.bend as Store

type Gate is Data:
  GateNone{}
  GateHeld{window: String, resets_at: String, source: String, receipt: String}
  GateElapsed{window: String, resets_at: String, source: String, receipt: String}

# The provider qualifier of a recorded model: the text before the first '/'.
# A model without a provider prefix has no provider-bound window identity.
def provider_go(rest: String, +acc: String) -> String:
  match rest:
    case SNil{}: ""
    case SCon{+head,tail}: Bool.pick(String,Char.is_eq(head,Char.from_u32(47)),acc,provider_go(tail,acc ++ SCon{head,SNil{}}))

def provider_of(model: String) -> String:
  provider_go(model,"")

# --- window and reset extraction from provider text --------------------------
#
# The provider's own diagnostic text carries the window kind and sometimes the
# reset time. Kimi's 403 names the 5-hour window with no timestamp; ZAI reports
# "Usage limit reached for 5 hour" with a separate reset time; Claude names
# weekly and monthly windows. Extraction is literal and case-insensitive; no
# value is inferred beyond the text.

def lower_char(+c: Char) -> Char:
  Bool.pick(Char,Bool.and(U32.is_lt(Char.to_u32(Char.from_u32(64)),Char.to_u32(c)),U32.is_lt(Char.to_u32(c),Char.to_u32(Char.from_u32(91)))),Char.from_u32(U32.add(Char.to_u32(c),32)),c)

def lower_go(rest: String, +acc: String) -> String:
  match rest:
    case SNil{}: acc
    case SCon{+head,tail}: lower_go(tail,acc ++ SCon{lower_char(head),SNil{}})

def lower_ascii(s: String) -> String:
  lower_go(s,"")

def has_sub_at(+needle: String, +rest: String) -> Bool:
  match rest:
    case SNil{}: False{}
    case SCon{_,tail}: Bool.pick(Bool,Tx.starts_with(rest,needle),True{},has_sub_at(needle,tail))

def has_sub(+needle: String, +hay: String) -> Bool:
  has_sub_at(needle,hay)

# The canonical window kinds, most specific first. Unrecognized wording keeps
# an empty label; the receipt retains the provider's own text either way.
def window_label_of(+text: String) -> String:
  Bool.pick(String,Bool.or(has_sub("5-hour",text),has_sub("5 hour",text)),"5-hour",
  Bool.pick(String,Bool.or(has_sub("7-day",text),Bool.or(has_sub("7 day",text),has_sub("weekly",text))),"7-day",
  Bool.pick(String,Bool.or(has_sub("monthly",text),has_sub("billing cycle",text)),"monthly","")))

def digit(+c: Char) -> Bool:
  Bool.and(U32.is_lt(Char.to_u32(Char.from_u32(47)),Char.to_u32(c)),U32.is_lt(Char.to_u32(c),Char.to_u32(Char.from_u32(58))))

def ts_sep(+c: Char) -> Bool:
  Bool.or(digit(c),
  Bool.or(Char.is_eq(c,Char.from_u32(45)),
  Bool.or(Char.is_eq(c,Char.from_u32(58)),
  Bool.or(Char.is_eq(c,Char.from_u32(84)),
  Bool.or(Char.is_eq(c,Char.from_u32(32)),
  Bool.or(Char.is_eq(c,Char.from_u32(90)),
  Bool.or(Char.is_eq(c,Char.from_u32(122)),
  Bool.or(Char.is_eq(c,Char.from_u32(43)),
  Bool.or(Char.is_eq(c,Char.from_u32(46)),
  Char.is_eq(c,Char.from_u32(47)))))))))))

# A word-aligned ISO-8601 shape: the observed provider and Console wordings
# always separate the timestamp from surrounding words by spaces, so the scan
# checks each space-separated word rather than every character position.
def take_ts(rest: String) -> String:
  match rest:
    case SNil{}: ""
    case SCon{+head,tail}: Bool.pick(String,ts_sep(head),SCon{head,SNil{}} ++ take_ts(tail),"")

# Date part: four digits, '-', two digits, '-', two digits. The time part is
# optional; a date-only token is accepted and converts as UTC.
def iso_offset(rest: String) -> Bool:
  match rest:
    case SCon{+h1,SCon{+h2,SNil{}}}: Bool.and(digit(h1),digit(h2))
    case SCon{+h1,SCon{+h2,SCon{':',SCon{+m1,SCon{+m2,SNil{}}}}}}: Bool.and(digit(h1),Bool.and(digit(h2),Bool.and(digit(m1),digit(m2))))
    case other: False{}

def iso_digits_tail(rest: String) -> Bool:
  match rest:
    case SNil{}: True{}
    case SCon{+z,SNil{}}: Bool.or(Char.is_eq(z,Char.from_u32(90)),Char.is_eq(z,Char.from_u32(122)))
    case SCon{+s,+tail}: Bool.pick(Bool,Bool.or(Char.is_eq(s,Char.from_u32(43)),Char.is_eq(s,Char.from_u32(45))),iso_offset(tail),Bool.pick(Bool,digit(s),iso_digits_tail(tail),False{}))

def iso_digits(rest: String) -> Bool:
  match rest:
    case SNil{}: False{}
    case SCon{+head,tail}: Bool.pick(Bool,digit(head),iso_digits_tail(tail),False{})

def iso_frac(rest: String) -> Bool:
  match rest:
    case SNil{}: True{}
    case SCon{'.',tail}: iso_digits(tail)
    case SCon{+z,SNil{}}: Bool.or(Char.is_eq(z,Char.from_u32(90)),Char.is_eq(z,Char.from_u32(122)))
    case SCon{+s,tail}: Bool.pick(Bool,Bool.or(Char.is_eq(s,Char.from_u32(43)),Char.is_eq(s,Char.from_u32(45))),iso_offset(tail),False{})

def iso_seconds(rest: String) -> Bool:
  match rest:
    case SCon{+s1,SCon{+s2,tail}}: Bool.and(digit(s1),Bool.and(digit(s2),iso_frac(tail)))
    case other: False{}

def iso_ss(rest: String) -> Bool:
  match rest:
    case SNil{}: True{}
    case SCon{':',tail}: iso_seconds(tail)
    case SCon{+z,SNil{}}: Bool.or(Char.is_eq(z,Char.from_u32(90)),Char.is_eq(z,Char.from_u32(122)))
    case SCon{+s,tail}: Bool.pick(Bool,Bool.or(Char.is_eq(s,Char.from_u32(43)),Char.is_eq(s,Char.from_u32(45))),iso_offset(tail),False{})

def iso_mm(rest: String) -> Bool:
  match rest:
    case SCon{+m1,SCon{+m2,tail}}: Bool.and(digit(m1),Bool.and(digit(m2),iso_ss(tail)))
    case other: False{}

def iso_hh(rest: String) -> Bool:
  match rest:
    case SCon{+h1,SCon{+h2,SCon{':',tail}}}: Bool.and(digit(h1),Bool.and(digit(h2),iso_mm(tail)))
    case other: False{}

def iso_time(rest: String) -> Bool:
  match rest:
    case SNil{}: True{}
    case SCon{+sep,tail}: Bool.pick(Bool,Bool.or(Char.is_eq(sep,Char.from_u32(84)),Char.is_eq(sep,Char.from_u32(32))),iso_hh(tail),False{})

def iso_token(tok: String) -> Bool:
  match tok:
    case SCon{+a,SCon{+b,SCon{+c,SCon{+d,SCon{'-',SCon{+m1,SCon{+m2,SCon{'-',SCon{+d1,SCon{+d2,rest}}}}}}}}}}:
      Bool.and(digit(a),Bool.and(digit(b),Bool.and(digit(c),Bool.and(digit(d),Bool.and(digit(m1),Bool.and(digit(m2),Bool.and(digit(d1),Bool.and(digit(d2),iso_time(rest)))))))))
    case other: False{}

# Operator observations require a full date and clock with an explicit zone.
# Provider-message extraction above intentionally keeps its broader token
# rules so existing provider wording continues to be interpreted unchanged.
def explicit_zone(rest: String) -> Bool:
  match rest:
    case SCon{'Z',SNil{}}: True{}
    case SCon{'z',SNil{}}: True{}
    case SCon{'+',SCon{+h1,SCon{+h2,SCon{':',SCon{+m1,SCon{+m2,SNil{}}}}}}}:
      Bool.and(digit(h1),Bool.and(digit(h2),Bool.and(digit(m1),digit(m2))))
    case SCon{'-',SCon{+h1,SCon{+h2,SCon{':',SCon{+m1,SCon{+m2,SNil{}}}}}}}:
      Bool.and(digit(h1),Bool.and(digit(h2),Bool.and(digit(m1),digit(m2))))
    case other: False{}

def fractional_digits_zone(rest: String) -> Bool:
  match rest:
    case SCon{+head,+tail}:
      Bool.pick(Bool,digit(head),Bool.pick(Bool,String.is_empty(tail),False{},fractional_digits_zone(tail)),explicit_zone(rest))
    case other: False{}

def fractional_zone(rest: String) -> Bool:
  match rest:
    case SCon{'.',SCon{+head,tail}}: Bool.and(digit(head),fractional_digits_zone(tail))
    case other: explicit_zone(rest)

def seconds_zone(rest: String) -> Bool:
  match rest:
    case SCon{':',SCon{+s1,SCon{+s2,tail}}}:
      Bool.and(digit(s1),Bool.and(digit(s2),fractional_zone(tail)))
    case other: fractional_zone(rest)

def operator_time_zone(rest: String) -> Bool:
  match rest:
    case SCon{+h1,SCon{+h2,SCon{':',SCon{+m1,SCon{+m2,tail}}}}}:
      Bool.and(digit(h1),Bool.and(digit(h2),Bool.and(digit(m1),Bool.and(digit(m2),seconds_zone(tail)))))
    case other: False{}

def operator_reset_token(tok: String) -> Bool:
  match tok:
    case SCon{+y1,SCon{+y2,SCon{+y3,SCon{+y4,SCon{'-',SCon{+m1,SCon{+m2,SCon{'-',SCon{+d1,SCon{+d2,SCon{'T',tail}}}}}}}}}}}:
      Bool.and(digit(y1),Bool.and(digit(y2),Bool.and(digit(y3),Bool.and(digit(y4),Bool.and(digit(m1),Bool.and(digit(m2),Bool.and(digit(d1),Bool.and(digit(d2),operator_time_zone(tail)))))))))
    case other: False{}

# The first word whose timestamp-character run validates as an ISO-8601
# date-time, verbatim, or "" when the text names none. Providers separate the
# date and clock by a space ("reset at 2026-10-06 07:12:52"), so a date-only
# word followed by a clock-only word reads as one observation; the date alone
# is never used when a clock word stands beside it. A sentence-ending period
# follows the timestamp in the Muse wording ("resets at 2026-10-19T06:38:50Z."),
# so one final '.' is removed before the second validation.
def token_without_final_dot(tok: String) -> String:
  match tok:
    case SNil{}: ""
    case SCon{+head,SNil{}}: Bool.pick(String,Char.is_eq(head,Char.from_u32(46)),"",SCon{head,SNil{}})
    case SCon{+head,+tail}: SCon{head,token_without_final_dot(tail)}

def word_reset_stripped(+stripped: String) -> String:
  Bool.pick(String,iso_token(stripped),stripped,"")

def word_reset(+word: String) -> String:
  +tok = take_ts(word)
  Bool.pick(String,iso_token(tok),tok,word_reset_stripped(token_without_final_dot(tok)))

def iso_date_only(tok: String) -> Bool:
  match tok:
    case SCon{+a,SCon{+b,SCon{+c,SCon{+d,SCon{'-',SCon{+m1,SCon{+m2,SCon{'-',SCon{+d1,SCon{+d2,SNil{}}}}}}}}}}}:
      Bool.and(digit(a),Bool.and(digit(b),Bool.and(digit(c),Bool.and(digit(d),Bool.and(digit(m1),Bool.and(digit(m2),Bool.and(digit(d1),digit(d2))))))))
    case other: False{}

def joined_reset(word: String, +joined: String) -> String:
  Bool.pick(String,iso_token(joined),joined,word_reset(word))

# The scan carries a pending date-only word: when the next word is a clock,
# the two read as one observation ("reset at 2026-10-06 07:12:52"); a pending
# date with no clock beside it stands alone. Self-recursion only.
def date_only_of(+word: String) -> Bool:
  iso_date_only(take_ts(word))

def clock_of(+word: String) -> Bool:
  iso_hh(take_ts(word))

# A reset named by this word under the carried pending date, or "" to keep
# scanning. A date-only word with no clock beside it stands alone.
def direct_reset(+pending: String, +word: String) -> String:
  Bool.pick(String,String.is_empty(pending),
    Bool.pick(String,date_only_of(word),"",word_reset(word)),
    Bool.pick(String,clock_of(word),joined_reset(pending,take_ts(pending) ++ " " ++ take_ts(word)),word_reset(pending)))

def next_pending(+pending: String, +word: String) -> String:
  Bool.pick(String,date_only_of(word),take_ts(word),"")

# The scan carries a pending date-only word. A found reset ends the scan; the
# continuation makes one recursive call, so the work is linear in the words.
# The earlier nested pick evaluated two recursions per word and grew
# exponentially on long provider text.
def reset_scan(words: List<&2,String>, +pending: String) -> String:
  match words:
    case Nil{}: word_reset(pending)
    case +word <> +rest:
      +direct = direct_reset(pending,word)
      Bool.pick(String,String.is_empty(direct),reset_scan(rest,next_pending(pending,word)),direct)

def reset_of_words(words: List<&2,String>) -> String:
  reset_scan(words,"")

def reset_text_of(+text: String) -> String:
  reset_of_words(String.split(text,Char.from_u32(32)))

# --- the observation store ---------------------------------------------------
#
# The coordination database owns the observations; there is no sidecar file.
# resets_at NULL means no reset is recorded; the gate re-probes it. recorded_at is the observation time
# and the receipt names what was observed and where it came from.

def now_ms() -> String:
  "CAST(strftime('%s','now') AS INTEGER)*1000"

# The match binding for gate and query: same harness, same provider prefix,
# and either this account label or the account-wide (empty label) row.
def window_match_sql(+harness: String, +provider: String, +account: String) -> String:
  "harness=" ++ C.q(harness) ++ " AND provider=" ++ C.q(provider) ++ " AND (account=" ++ C.q(account) ++ " OR account='')"

# A provider time with a clock and no UTC designator is China Standard Time (UTC+8,
# no daylight saving). z.ai writes "Your limit will reset at 2026-10-23 06:54:13"
# without an offset, so the instant is that clock minus eight hours. A time with
# Z or an explicit offset is read as written, and a date-only text as UTC.
def parsed_reset_sql(+reset_text: String) -> String:
  Bool.pick(String,String.is_empty(reset_text),"NULL","(SELECT CAST(strftime('%s'," ++ C.q(reset_text) ++ "," ++ offsetless_clock_modifier_sql(reset_text) ++ ") AS INTEGER)*1000)")

def offsetless_clock_modifier_sql(+text: String) -> String:
  "CASE WHEN length(" ++ C.q(text) ++ ")>10 AND " ++ C.q(text) ++ " NOT GLOB '*[Zz+]*' AND substr(" ++ C.q(text) ++ ",11) NOT LIKE '%-%' THEN '-8 hours' ELSE '+0 seconds' END"

# The upper bound, in milliseconds, of a named subscription window. A rolling window
# that started at or before a refusal ends by the refusal time plus its length. A
# monthly window has no fixed length, so it has no bound.
def window_length_ms(+window: String) -> String:
  Bool.pick(String,String.eq(window,"5-hour"),"18000000",Bool.pick(String,String.eq(window,"7-day"),"604800000",""))

# The re-probe interval for an exhausted window whose only evidence carries no reset
# time. The gate holds until the latest refusal plus this interval; the owed input's
# next attempt after that instant is the probe.
def probe_interval_ms() -> String:
  "3600000"

# The reset recorded for a refusal: the provider's own time when the text names one,
# else the upper bound of a named window, else NULL.
# The window bound as an SQL instant, or NULL for a window with no fixed length.
def bound_sql(+window: String) -> String:
  Bool.pick(String,String.is_empty(window_length_ms(window)),"NULL","(" ++ now_ms() ++ "+" ++ window_length_ms(window) ++ ")")

# A parsed provider reset is rejected when it lies further after the refusal than the
# window's own length (a 5-hour window cannot reset more than 5 hours after a refusal),
# or when it does not parse. A rejected or missing time falls back to the window bound.
# A window with no fixed length keeps the parsed time.
def reset_or_bound_sql(+reset_text: String, +window: String) -> String:
  Bool.pick(String,String.is_empty(reset_text),
    bound_sql(window),
    Bool.pick(String,String.is_empty(window_length_ms(window)),parsed_reset_sql(reset_text),
      "(CASE WHEN " ++ parsed_reset_sql(reset_text) ++ " IS NULL OR " ++ parsed_reset_sql(reset_text) ++ " > " ++ now_ms() ++ "+" ++ window_length_ms(window) ++ " THEN " ++ bound_sql(window) ++ " ELSE " ++ parsed_reset_sql(reset_text) ++ " END)"))

# The instant the gate reads for an exhausted state row: the recorded reset, or the
# re-probe instant when none is recorded. The alias is "w." or "" for a bare row. The
# instant is derived in the query and never stored.
def reset_at_sql(+alias: String) -> String:
  "coalesce(" ++ alias ++ "resets_at," ++ alias ++ "recorded_at+" ++ probe_interval_ms() ++ ")"

# The provider prefix computed in SQL from the recorded model: the text before
# the first '/', or empty when the model is not provider-qualified.
def model_provider_sql(+model: String) -> String:
  "CASE WHEN instr(" ++ model ++ ",'/')>0 THEN substr(" ++ model ++ ",1,instr(" ++ model ++ ",'/')-1) ELSE '' END"

# One observation from a provider exhaustion cause, recorded before any account
# advance so the refusal fact survives even when the advance itself fails. The
# window kind is extracted from the cause; an embedded ISO reset time is
# converted to milliseconds. With no embedded time, a named window records its
# upper bound and an unnamed window stays NULL.
def record_cause_sql(+session: String, +account: String, +window: String, +reset_text: String, +cause: String, +message: String) -> String:
  "INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) SELECT " ++ now_ms() ++ ",harness,model," ++ model_provider_sql("model") ++ "," ++ C.q(account) ++ "," ++ C.q(window) ++ "," ++ reset_or_bound_sql(reset_text,window) ++ ",'provider-message',NULL," ++ C.q(cause) ++ "," ++ C.q(message) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ ";"

# The provider cause names the window for every exhaustion terminal this tree
# classifies (subscription-fallback's wording matcher). A failed observation
# insert reports its own cause and never blocks the account advance: the
# refusal fact is desirable evidence, not a gate on the handoff.
def window_report(db: String, session: String, id: String, kind: String, body: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":" ++ kind) ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(body) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Unit,Unit{})

def record_cause_result(+db: String, +session: String, +id: String, +cause: String, saved: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match saved:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(code,detail)}: window_report(db,session,id,"usage-window-record-failed","usage window observation insert failed: " ++ U32.show(code) ++ ": " ++ detail ++ "; the provider cause stands and the account advance proceeds.")

def record_cause(+db: String, +session: String, +id: String, account: String, +cause: String) -> IO(Unit):
  do IO<Unit>:
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,record_cause_sql(session,Tx.trim_nl(account),window_label_of(lower_ascii(cause)),reset_text_of(cause),Tx.trim_nl(cause),id))
    record_cause_result(db,session,id,cause,saved)

# --- the provider success -----------------------------------------------------
#
# A completed attempt that did not fail clears the exhausted windows of its account
# label and provider scope. Only refusals recorded before the attempt started clear:
# started is the attempt start in milliseconds, so a refusal recorded inside the
# attempt keeps its hold. The success row carries no reset and no used fraction, so
# the latest provider row of each cleared window stops being an exhaustion.

def success_windows_sql(+harness: String, +provider: String, +account: String, +started: String) -> String:
  "SELECT DISTINCT p.window FROM (" ++ latest_provider_rows_sql(harness,provider,account) ++ ") p WHERE " ++ exhausted_sql("p") ++ " AND p.recorded_at < " ++ started

def record_success_sql(+session: String, +harness: String, +provider: String, +account: String, +started: String, +attempt: String) -> String:
  "INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) SELECT " ++ now_ms() ++ ",harness,model," ++ C.q(provider) ++ "," ++ C.q(account) ++ ",e.window,NULL,'provider-success',NULL," ++ C.q("provider-success: attempt " ++ attempt) ++ ",'' FROM sessions,(" ++ success_windows_sql(harness,provider,account,started) ++ ") e WHERE sessions.id=" ++ C.q(session) ++ ";SELECT changes();"

def record_success(+db: String, +session: String, +account: String, +started: String, +attempt: String) -> IO(Unit):
  do IO<Unit>:
    +harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +model : String <- IO.try(String,DB.Sql.read(db,"SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    saved : String <- IO.try(String,DB.Sql.query(db,record_success_sql(session,Tx.trim_nl(harness),provider_of(Tx.trim_nl(model)),Tx.trim_nl(account),Tx.trim_nl(started),attempt)))
    IO.pure(Unit,Unit{})

# --- the operator observation command ----------------------------------------
#
# The operator reads a reset time from the provider's own console (for Kimi
# Code, the Console web UI) and records it against the session's account. The
# reset argument is ISO 8601 with an explicit offset or 'unknown'; anything
# unparseable refuses the command rather than recording a guess.
def observe_registered(saved: String) -> IO(Unit):
  match saved:
    case SNil{}: IO.die(Unit,2,"Session is not registered; inspect status and the requested ID.")
    case other: IO.pure(Unit,Unit{})

def observe_reset_unknown(+resets: String) -> Bool:
  String.eq(resets,"unknown")

def observe_reset_sql(+resets: String) -> String:
  "SELECT CAST(strftime('%s'," ++ C.q(resets) ++ ") AS INTEGER)*1000;"

def observe_reset_refused() -> IO(String):
  IO.die(String,22,"The reset time did not parse; give ISO 8601 with an explicit offset (for example 2026-10-17T03:41:00Z) or 'unknown'.")

def observe_reset_parsed(+resets: String, +parsed: String) -> IO(String):
  match parsed:
    case SNil{}: IO.die(String,22,"The reset time did not parse; give ISO 8601 with an explicit offset (for example 2026-10-17T03:41:00Z) or 'unknown'.")
    case other: Bool.pick(IO(String),String.eq(Tx.trim_nl(parsed),"null"),IO.die(String,22,"The reset time did not parse; give ISO 8601 with an explicit offset (for example 2026-10-17T03:41:00Z) or 'unknown'."),IO.pure(String,Tx.trim_nl(parsed)))

def observe_reset_value_known(+db: String, +resets: String, unknown: Bool) -> IO(String):
  match unknown:
    case True{}: IO.pure(String,"NULL")
    case False{}:
      Bool.pick(IO(String),operator_reset_token(resets),do IO<String>:
        parsed : String <- IO.try(String,DB.Sql.read(db,observe_reset_sql(resets)))
        value : String <- observe_reset_parsed(resets,parsed)
        IO.pure(String,value),observe_reset_refused())

def observe_reset_value(+db: String, +resets: String) -> IO(String):
  observe_reset_value_known(db,resets,observe_reset_unknown(resets))

def observe_resets_json(+resets: String) -> String:
  Bool.pick(String,String.eq(resets,"NULL"),"null",resets)

def observe_json(+session: String, +window: String, +resets: String) -> String:
  "{\"schema\":\"baton2-usage-window-observation-v1\",\"session\":" ++ J.string_literal(session) ++ ",\"window\":" ++ J.string_literal(window) ++ ",\"resetsAt\":" ++ observe_resets_json(resets) ++ "}"

def observe_print(+session: String, +window: String, +resets: String) -> IO(Unit):
  IO.print(observe_json(session,window,resets))

def observe(+db: String, +session: String, +window: String, +resets: String, +source: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.read(db,C.Session{session}))
    present : Unit <- observe_registered(found)
    valid : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.q(window) ++ "<>'' AND instr(" ++ C.q(window) ++ ",char(10))=0 AND instr(" ++ C.q(window) ++ ",char(13))=0 AND length(" ++ C.q(source) ++ ")>0 AND instr(" ++ C.q(source) ++ ",char(10))=0 AND instr(" ++ C.q(source) ++ ",char(13))=0;"))
    admitted : Unit <- Bool.pick(IO(Unit),String.eq(Tx.trim_nl(valid),"1"),IO.pure(Unit,Unit{}),IO.die(Unit,2,"A usage window observation requires a nonempty window label and source text without newlines."))
    +value : String <- observe_reset_value(db,resets)
    saved : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) SELECT " ++ now_ms() ++ ",harness,model," ++ model_provider_sql("model") ++ "," ++ C.q(Tx.trim_nl(account)) ++ "," ++ C.q(window) ++ "," ++ value ++ ",'operator-observation',NULL," ++ C.q("operator-observation: " ++ source) ++ ",'' FROM sessions WHERE id=" ++ C.q(session) ++ ";" ++ "SELECT changes();"))
    done : Unit <- Bool.pick(IO(Unit),String.eq(Tx.trim_nl(saved),"0"),IO.die(Unit,2,"The session has no recorded route; recruit or configure it before observing usage windows."),IO.pure(Unit,Unit{}))
    observed : Unit <- observe_print(session,window,value)
    IO.pure(Unit,Unit{})



# --- the provider report refresh ---------------------------------------------
#
# The session's recorded harness command answers 'usage --json'; for OMP the
# report lists per-provider limits with normalized windows (id '5h' or '7d'
# and an absolute resetsAt when the provider reports one). Each reported limit
# becomes one observation; a limit without resetsAt keeps the NULL unknown.
# A report the harness cannot produce stays an explicit unknown answer and
# records nothing.

def refresh_unsupported(+session: String, +harness: String) -> IO(Unit):
  IO.print("{\"schema\":\"baton2-usage-window-refresh-v1\",\"session\":" ++ J.string_literal(session) ++ ",\"harness\":" ++ J.string_literal(harness) ++ ",\"state\":\"unknown\",\"condition\":\"unsupportedHarness\"}")

def refresh_absent(+session: String, +harness: String) -> IO(Unit):
  IO.print("{\"schema\":\"baton2-usage-window-refresh-v1\",\"session\":" ++ J.string_literal(session) ++ ",\"harness\":" ++ J.string_literal(harness) ++ ",\"state\":\"unknown\",\"condition\":\"noRecordedHarnessCommand\"}")

def refresh_reported_sql(+session: String, +answer: String, +account: String, +receipt: String) -> String:
  "INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) SELECT " ++ now_ms() ++ ",harness,model,json_extract(report.value,'$.provider')," ++ C.q(account) ++ ",CASE WHEN json_extract(lim.value,'$.window.id')='5h' THEN '5-hour' WHEN json_extract(lim.value,'$.window.id')='7d' THEN '7-day' WHEN json_extract(lim.value,'$.window.id')='1w' THEN '7-day' WHEN json_extract(lim.value,'$.window.id')='1mo' THEN 'monthly' ELSE coalesce(json_extract(lim.value,'$.window.id'),'') END,json_extract(lim.value,'$.window.resetsAt'),'provider-report',json_extract(lim.value,'$.amount.usedFraction')," ++ C.q(receipt) ++ ",'' FROM sessions, json_each(json_extract(" ++ C.q(answer) ++ ",'$.answer.reports')) AS report, json_each(json_extract(report.value,'$.limits')) AS lim WHERE sessions.id=" ++ C.q(session) ++ ";"

def refresh_answer_sql(+session: String, +receipt: String) -> String:
  "SELECT json_object('schema','baton2-usage-window-refresh-v1','session'," ++ C.q(session) ++ ",'state','recorded','windows',(SELECT count(*) FROM usage_windows WHERE receipt=" ++ C.q(receipt) ++ "));"

# A failed report insert names its own cause; a successful insert answers the
# exact row count that the query reads back.
def refresh_counted(+db: String, +session: String, +receipt: String, saved: Result<&1,&1,U32 & String,String>) -> IO(String):
  match saved:
    case Fail{(code,detail)}: IO.die(String,2,"The usage window report insert failed: " ++ U32.show(code) ++ ": " ++ detail)
    case Done{ignored}: IO.try(String,DB.Sql.read(db,refresh_answer_sql(session,receipt)))

def refresh_reported(+db: String, +session: String, +account: String, +answer: String) -> IO(Unit):
  do IO<Unit>:
    observed : String <- IO.try(String,DB.Sql.read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000;"))
    +receipt : String <- IO.pure(String,"provider-report: usage --json @" ++ Tx.trim_nl(observed))
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,refresh_reported_sql(session,answer,Tx.trim_nl(account),receipt))
    counted : String <- refresh_counted(db,session,receipt,saved)
    printed : Unit <- IO.print(Tx.trim_nl(counted))
    IO.pure(Unit,Unit{})

def refresh_decoded(+db: String, +session: String, +account: String, +answer: String) -> IO(Unit):
  Bool.pick(IO(Unit),Tx.starts_with(answer,"{\"state\":\"reported\""),refresh_reported(db,session,account,answer),IO.print(answer))

def refresh_result(+db: String, +session: String, +account: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: IO.die(Unit,2,"The provider usage query failed: " ++ U32.show(code) ++ ": " ++ detail)
    case Done{+answer}: Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(answer)),IO.die(Unit,2,"The provider usage query answered nothing."),refresh_decoded(db,session,account,Tx.trim_nl(answer)))

def refresh_query(+db: String, +session: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Usage.provider_usage_for_session(db,session,"omp")
    refreshed : Unit <- refresh_result(db,session,account,result)
    IO.pure(Unit,Unit{})

def refresh_omp(+db: String, +session: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    +command : String <- IO.try(String,DB.Sql.read(db,Usage.harness_command_sql(session)))
    queried : Unit <- Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(command)),refresh_absent(session,"omp"),refresh_query(db,session,account))
    IO.pure(Unit,Unit{})

def refresh(+db: String, +session: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.read(db,C.Session{session}))
    present : Unit <- observe_registered(found)
    +harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    ran : Unit <- Bool.pick(IO(Unit),String.eq(Tx.trim_nl(harness),"omp"),refresh_omp(db,session,account),refresh_unsupported(session,Tx.trim_nl(harness)))
    IO.pure(Unit,Unit{})

def exhausted_sql(+alias: String) -> String:
  "((" ++ alias ++ ".used_fraction IS NOT NULL AND " ++ alias ++ ".used_fraction >= 1) OR " ++ alias ++ ".reset_source='provider-message')"

def latest_provider_rows_sql(+harness: String, +provider: String, +account: String) -> String:
  "SELECT p.* FROM usage_windows p WHERE " ++ window_match_sql(harness,provider,account) ++ " AND p.reset_source IN ('provider-message','provider-report','provider-success') AND p.id=(SELECT p2.id FROM usage_windows p2 WHERE " ++ window_match_sql(harness,provider,account) ++ " AND p2.reset_source IN ('provider-message','provider-report','provider-success') AND p2.window=p.window ORDER BY p2.recorded_at DESC, p2.id DESC LIMIT 1)"

def exhausted_windows_sql(+harness: String, +provider: String, +account: String) -> String:
  "SELECT p.window FROM (" ++ latest_provider_rows_sql(harness,provider,account) ++ ") p WHERE " ++ exhausted_sql("p")

# The state row prefers the latest observed reset for an exhausted window, so
# an unknown observation recorded after a future reset does not release the
# hold. A non-exhausted window keeps its newest observation.
def latest_rows_sql(+harness: String, +provider: String, +account: String) -> String:
  +exhausted = exhausted_windows_sql(harness,provider,account)
  "SELECT w.* FROM usage_windows w WHERE " ++ window_match_sql(harness,provider,account) ++ " AND w.id=(SELECT w2.id FROM usage_windows w2 WHERE " ++ window_match_sql(harness,provider,account) ++ " AND w2.window=w.window ORDER BY CASE WHEN w2.window IN (" ++ exhausted ++ ") AND w2.resets_at IS NULL THEN 1 ELSE 0 END,w2.recorded_at DESC,w2.id DESC LIMIT 1)"

# --- the query ---------------------------------------------------------------

# The latest observation per window for the session's binding, each with its
# current state. An unqualified model records and reads the empty provider
# scope, which is the harness/account-wide window for its route. No matching
# row reads back 'none recorded', never an empty claim.

def query_answer_sql(+session: String, +harness: String, +provider: String, +account: String) -> String:
  +exhausted = exhausted_windows_sql(harness,provider,account)
  +providers = latest_provider_rows_sql(harness,provider,account)
  "SELECT json_object('schema','baton2-usage-windows-v1','session'," ++ C.q(session) ++ ",'account'," ++ C.q(account) ++ ",'windows',coalesce(nullif((SELECT json_group_array(json(item)) FROM (SELECT json_object('window',w.window,'state',CASE WHEN w.window NOT IN (" ++ exhausted ++ ") THEN 'open' WHEN " ++ reset_at_sql("w.") ++ " > " ++ now_ms() ++ " THEN 'held' ELSE 'elapsed' END,'exhausted',json(CASE WHEN w.window IN (" ++ exhausted ++ ") THEN 'true' ELSE 'false' END),'exhaustionSource',(SELECT p.reset_source FROM (" ++ providers ++ ") p WHERE p.window=w.window),'resetsAt',w.resets_at,'reprobeAt',CASE WHEN w.resets_at IS NULL THEN w.recorded_at+" ++ probe_interval_ms() ++ " END,'resetsAtText',CASE WHEN w.resets_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%SZ',w.resets_at/1000,'unixepoch') END,'usedFraction',w.used_fraction,'source',w.reset_source,'receipt',w.receipt,'recordedAt',w.recorded_at,'message',nullif(w.message,'')) AS item FROM usage_windows w WHERE " ++ window_match_sql(harness,provider,account) ++ " AND w.id=(SELECT w2.id FROM usage_windows w2 WHERE " ++ window_match_sql(harness,provider,account) ++ " AND w2.window=w.window ORDER BY w2.recorded_at DESC, w2.id DESC LIMIT 1) ORDER BY w.window)),'[]'),'none recorded')) FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def query_bound(+db: String, +session: String, +harness: String, +provider: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    answer : String <- IO.try(String,DB.Sql.read(db,query_answer_sql(session,harness,provider,account)))
    printed : Unit <- IO.print(Tx.trim_nl(answer))
    IO.pure(Unit,Unit{})

def query(+db: String, +session: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.read(db,C.Session{session}))
    present : Unit <- observe_registered(found)
    +harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +model : String <- IO.try(String,DB.Sql.read(db,"SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    printed : Unit <- query_bound(db,session,Tx.trim_nl(harness),provider_of(Tx.trim_nl(model)),Tx.trim_nl(account))
    IO.pure(Unit,Unit{})

# --- the wake gate -----------------------------------------------------------
#
# Each window is represented by its state row and by its latest provider row
# for exhaustion evidence. A window is exhausted when the provider said so:
# the latest provider row is a limit message or reports a used fraction at or
# above 1. A partial provider report with a future reset is not exhaustion and
# does not hold. An observed reset supplies the reset time; once observed, an
# unknown observation does not replace it, so the hold lasts until an actual
# reset observation or the recorded reset instant passes. An exhausted window with
# no recorded reset reads its re-probe instant (the latest refusal plus
# probe_interval_ms), so the gate holds until that instant and then admits the owed
# input as the probe. The gate holds when any exhausted window's reset instant is
# still in the future, is elapsed when one has passed, and is none otherwise.

def window_state_rows_sql(+harness: String, +provider: String, +account: String) -> String:
  latest_rows_sql(harness,provider,account) ++ " AND w.window IN (" ++ exhausted_windows_sql(harness,provider,account) ++ ")"

def held_rows_sql(+harness: String, +provider: String, +account: String) -> String:
  window_state_rows_sql(harness,provider,account) ++ " AND " ++ reset_at_sql("w.") ++ " > " ++ now_ms()

def elapsed_rows_sql(+harness: String, +provider: String, +account: String) -> String:
  window_state_rows_sql(harness,provider,account) ++ " AND " ++ reset_at_sql("w.") ++ " <= " ++ now_ms()

def gate_verdict_sql(+session: String, +harness: String, +provider: String, +account: String) -> String:
  "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM (" ++ exhausted_windows_sql(harness,provider,account) ++ ")) THEN 'none' WHEN EXISTS(SELECT 1 FROM (" ++ held_rows_sql(harness,provider,account) ++ ")) THEN 'held' WHEN EXISTS(SELECT 1 FROM (" ++ elapsed_rows_sql(harness,provider,account) ++ ")) THEN 'elapsed' ELSE 'none' END FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def gate_detail_rows_sql(+harness: String, +provider: String, +account: String, +verdict: String) -> String:
  match verdict:
    case "held": "SELECT * FROM (" ++ held_rows_sql(harness,provider,account) ++ ") ORDER BY " ++ reset_at_sql("") ++ " ASC, recorded_at DESC, id DESC LIMIT 1"
    case _: "SELECT * FROM (" ++ elapsed_rows_sql(harness,provider,account) ++ ") ORDER BY recorded_at DESC, id DESC LIMIT 1"

def gate_detail_sql(+harness: String, +provider: String, +account: String, +verdict: String, +field: String) -> String:
  "SELECT " ++ field ++ " FROM (" ++ gate_detail_rows_sql(harness,provider,account,verdict) ++ ");"

def gate_details(+db: String, +harness: String, +provider: String, +account: String, +verdict: String) -> IO(Gate):
  do IO<Gate>:
    +window : String <- IO.try(String,DB.Sql.read(db,gate_detail_sql(harness,provider,account,verdict,"window")))
    +source : String <- IO.try(String,DB.Sql.read(db,gate_detail_sql(harness,provider,account,verdict,"reset_source")))
    +receipt : String <- IO.try(String,DB.Sql.read(db,gate_detail_sql(harness,provider,account,verdict,"receipt")))
    +resets : String <- IO.try(String,DB.Sql.read(db,gate_detail_sql(harness,provider,account,verdict,"CAST(" ++ reset_at_sql("") ++ " AS TEXT)")))
    IO.pure(Gate,Bool.pick(Gate,String.eq(verdict,"held"),GateHeld{Tx.trim_nl(window),Tx.trim_nl(resets),Tx.trim_nl(source),Tx.trim_nl(receipt)},GateElapsed{Tx.trim_nl(window),Tx.trim_nl(resets),Tx.trim_nl(source),Tx.trim_nl(receipt)}))

def gate_verdicted(+db: String, +session: String, +harness: String, +provider: String, +account: String) -> IO(Gate):
  do IO<Gate>:
    +verdict : String <- IO.try(String,DB.Sql.read(db,gate_verdict_sql(session,harness,provider,account)))
    gate : Gate <- Bool.pick(IO(Gate),Bool.or(String.eq(Tx.trim_nl(verdict),"none"),String.is_empty(Tx.trim_nl(verdict))),IO.pure(Gate,GateNone{}),gate_details(db,harness,provider,account,Tx.trim_nl(verdict)))
    IO.pure(Gate,gate)

def window_gate_model(+db: String, +session: String, harness: String, +model: String, +account: String) -> IO(Gate):
  gate_verdicted(db,session,harness,provider_of(model),account)

def window_gate(+db: String, +session: String, +account: String) -> IO(Gate):
  do IO<Gate>:
    +harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +model : String <- IO.try(String,DB.Sql.read(db,"SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    gate : Gate <- window_gate_model(db,session,Tx.trim_nl(harness),Tx.trim_nl(model),Tx.trim_nl(account))
    IO.pure(Gate,gate)

# A stable identity for the latest exhausted provider row of one route, across
# accounts. Reports for the same refusal share it so the first complete
# evidence is durable and later attempts add no duplicate report.
# The report identity is derived from the refusal observation recorded for this
# attempt. This keeps an intervening account or window observation from changing
# the report key while an exhaustion handoff is being recorded.
def refusal_identity_sql(+session: String, +harness: String, +provider: String, +attempt: String) -> String:
  "SELECT coalesce((SELECT " ++ C.q(session) ++ " || char(31) || p.harness || char(31) || p.provider || char(31) || p.account || char(31) || p.window || char(31) || coalesce(CAST(p.resets_at AS TEXT),'-') || char(31) || p.reset_source FROM usage_windows p WHERE p.harness=" ++ C.q(harness) ++ " AND p.provider=" ++ C.q(provider) ++ " AND p.message=" ++ C.q(attempt) ++ " AND p.reset_source IN ('provider-message','provider-report') AND " ++ exhausted_sql("p") ++ " ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1),'')"

# Account exhaustion uses the refusal observation for this attempt and confirms
# its account label before deriving the stable account-scoped report identity.
def refusal_account_identity_sql(+session: String, +harness: String, +provider: String, +account: String, +attempt: String) -> String:
  "SELECT coalesce((SELECT " ++ C.q(session) ++ " || char(31) || p.harness || char(31) || p.provider || char(31) || p.account || char(31) || p.window || char(31) || coalesce(CAST(p.resets_at AS TEXT),'-') || char(31) || p.reset_source FROM usage_windows p WHERE p.harness=" ++ C.q(harness) ++ " AND p.provider=" ++ C.q(provider) ++ " AND p.account=" ++ C.q(account) ++ " AND p.message=" ++ C.q(attempt) ++ " AND p.reset_source IN ('provider-message','provider-report') AND " ++ exhausted_sql("p") ++ " ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1),'')"

# An operator-observed reset covers every exhausted window in the session's
# route and account scope, including the empty label a Muse quota message
# records. It adds observation rows only; no session, execution or provider
# request follows.
def reset_exhausted_sql(+session: String, +harness: String, +provider: String, +account: String, +value: String, +source: String) -> String:
  +exhausted = "SELECT DISTINCT p.window FROM (" ++ latest_provider_rows_sql(harness,provider,account) ++ ") p WHERE p.window IN (" ++ exhausted_windows_sql(harness,provider,account) ++ ")"
  "INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) SELECT " ++ now_ms() ++ "," ++ C.q(harness) ++ ",model," ++ C.q(provider) ++ "," ++ C.q(account) ++ ",e.window," ++ value ++ ",'operator-observation',NULL," ++ C.q("operator-observation: " ++ source) ++ ",'' FROM sessions,(" ++ exhausted ++ ") e WHERE sessions.id=" ++ C.q(session) ++ ";SELECT changes();"

def reset_answer_sql(+session: String, +account: String, +count: String, +value: String, +source: String) -> String:
  "SELECT json_object('schema','baton2-usage-window-reset-v1','session'," ++ C.q(session) ++ ",'account'," ++ C.q(account) ++ ",'recorded',CAST(" ++ C.q(count) ++ " AS INTEGER),'resetsAt'," ++ value ++ ",'source'," ++ C.q(source) ++ ");"

def reset_exhausted_after_count(+db: String, +session: String, +account: String, +value: String, +source: String, count: String) -> IO(Unit):
  match count:
    case "0": IO.die(Unit,2,"No exhausted usage window is recorded for this session's route and account; read usage-windows before recording a reset.")
    case other: do IO<Unit>:
      +answer : String <- IO.try(String,DB.Sql.read(db,reset_answer_sql(session,account,other,value,source)))
      IO.print(Tx.trim_nl(answer))

def reset_exhausted(+db: String, +session: String, +resets: String, +source: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    +found : String <- IO.try(String,Store.read(db,C.Session{session}))
    present : Unit <- observe_registered(found)
    +valid : String <- IO.try(String,DB.Sql.query(db,"SELECT length(" ++ C.q(source) ++ ")>0 AND instr(" ++ C.q(source) ++ ",char(10))=0 AND instr(" ++ C.q(source) ++ ",char(13))=0;"))
    admitted : Unit <- Bool.pick(IO(Unit),String.eq(Tx.trim_nl(valid),"1"),IO.pure(Unit,Unit{}),IO.die(Unit,2,"A usage window reset requires nonempty source text without newlines."))
    +value : String <- observe_reset_value(db,resets)
    +harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +model : String <- IO.try(String,DB.Sql.read(db,"SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +saved : String <- IO.try(String,DB.Sql.query(db,reset_exhausted_sql(session,Tx.trim_nl(harness),provider_of(Tx.trim_nl(model)),account,value,source)))
    +count : String <- IO.pure(String,Tx.trim_nl(saved))
    reset_exhausted_after_count(db,session,account,value,source,count)

# --- the post-reset continuation ---------------------------------------------
#
# A held wake leaves the input owed and launches one detached single-shot
# continuation. It sleeps until the earliest held reset and re-runs the wake
# through the existing dispatch entry, which drives the retained input with no
# new message. The delay is capped at one day, so a far reset re-checks in
# bounded segments and the still-held gate schedules the next segment. The
# continuation is not a daemon and does not poll.

def schedule_argv(+self: String, +db: String, +message: String, +delay_s: String) -> List<String>:
  ["/bin/sh","-c","sleep \"$1\"; shift; exec \"$@\"","sh",delay_s,self,"--wake-message",db,message]

def schedule_delay_sql(+resets_at: String) -> String:
  "SELECT CAST(max(1,min(86400,(" ++ resets_at ++ "-" ++ now_ms() ++ "+999)/1000)) AS TEXT);"

def schedule_launch(+db: String, +message: String, +delay_s: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    launched : String <- IO.try(String,Host.Control.launch(Tx.enc_argv(schedule_argv(self,db,message,delay_s)),db,message ++ ":usage-window-wake"))
    IO.pure(Unit,Unit{})

def schedule_wake(+db: String, +message: String, +resets_at: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    delay : String <- IO.try(String,DB.Sql.read(db,schedule_delay_sql(resets_at)))
    launch : Unit <- schedule_launch(db,message,Tx.trim_nl(delay),self)
    IO.pure(Unit,Unit{})

def schedule_held(+db: String, +message: String, +resets_at: String) -> IO(Unit):
  do IO<Unit>:
    +self : String <- IO.try(String,Lock.SessionLock.executable())
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    scheduled : Unit <- schedule_wake(canonical,message,resets_at,self)
    IO.pure(Unit,Unit{})

# --- held and restored reports ------------------------------------------------
#
# A held wake reports to the session and its conductor with one deterministic
# id per message, so a retried wake neither duplicates the report nor loses
# it. A restored wake reports only when a held report for the same message is
# on record: the reset elapsed and the owed input runs on its retained
# assignment and account.

def gate_reset_text(+resets_at: String) -> String:
  Bool.pick(String,String.eq(resets_at,"-"),"unknown (reset time not observed)",resets_at ++ " ms epoch")

def held_guidance(window: String, resets_at: String, source: String) -> String:
  "The provider usage window " ++ window ++ " is held until " ++ gate_reset_text(resets_at) ++ " (source: " ++ source ++ "). This input stays owed and is admitted after the recorded reset; eligible work routes to an available configured account or model in the meantime."

def held_report(window: String, resets_at: String, source: String, receipt: String) -> String:
  "usage window held: window=" ++ window ++ "; resetsAt=" ++ gate_reset_text(resets_at) ++ "; source=" ++ source ++ "; receipt: " ++ receipt

def report_held(+db: String, +session: String, +message: String, gate: Gate) -> IO(Unit):
  match gate:
    case GateHeld{+window,+resets_at,+source,+receipt}: do IO<Unit>:
      noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(message ++ ":usage-window-held") ++ ",id,id,'guidance'," ++ C.q(held_guidance(window,resets_at,source)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ ";" ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(message ++ ":usage-window-held-report") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(held_report(window,resets_at,source,receipt)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
      IO.pure(Unit,Unit{})
    case other: IO.pure(Unit,Unit{})

def restored_guidance(window: String, resets_at: String, source: String) -> String:
  "The provider usage window " ++ window ++ " reset at " ++ gate_reset_text(resets_at) ++ " (source: " ++ source ++ "); this owed input is admitted now on the retained assignment and account."

def restored_report(window: String, resets_at: String, source: String, receipt: String) -> String:
  "usage window restored: window=" ++ window ++ "; resetsAt=" ++ gate_reset_text(resets_at) ++ "; source=" ++ source ++ "; receipt: " ++ receipt

def report_restored_rows(+db: String, +session: String, +message: String, +window: String, +resets_at: String, +source: String, +receipt: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(message ++ ":usage-window-restored") ++ ",id,id,'guidance'," ++ C.q(restored_guidance(window,resets_at,source)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ ";" ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(message ++ ":usage-window-restored-report") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(restored_report(window,resets_at,source,receipt)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Unit,Unit{})

def report_restored(+db: String, +session: String, +message: String, gate: Gate) -> IO(Unit):
  match gate:
    case GateElapsed{+window,+resets_at,+source,+receipt}: do IO<Unit>:
      held : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(message ++ ":usage-window-held") ++ ");"))
      noted : Unit <- Bool.pick(IO(Unit),String.eq(Tx.trim_nl(held),"1"),report_restored_rows(db,session,message,window,resets_at,source,receipt),IO.pure(Unit,Unit{}))
      IO.pure(Unit,Unit{})
    case other: IO.pure(Unit,Unit{})


# --- laws ---------------------------------------------------------------------
#
# The extraction literals the store depends on, as operative laws over the
# real functions: the observed provider wordings keep their window kinds, a
# reset time appears exactly where a provider states one, the Kimi 403 keeps
# its reset unknown, and an empty extraction never fabricates a reset value.

law kimi_message_names_the_5_hour_window:
  {window_label_of(lower_ascii("You've reached your 5-hour usage limit.")) == "5-hour" : String}

def kimi_message_names_the_5_hour_window():
  {==}

law kimi_message_carries_no_reset_time:
  {reset_text_of("You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.") == "" : String}

def kimi_message_carries_no_reset_time():
  {==}

law zai_reset_time_is_extracted_verbatim:
  {reset_text_of("Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52") == "2026-10-06 07:12:52" : String}

def zai_reset_time_is_extracted_verbatim():
  {==}

law provider_prefix_binds_provider_models:
  {provider_of("kimi-code/kimi-for-coding") == "kimi-code" : String}

def provider_prefix_binds_provider_models():
  {==}

law bare_model_carries_no_provider:
  {provider_of("gpt-6-astra") == "" : String}

def bare_model_carries_no_provider():
  {==}

law empty_reset_extraction_stays_unknown:
  {parsed_reset_sql("") == "NULL" : String}

def empty_reset_extraction_stays_unknown():
  {==}

law five_hour_window_bound_is_five_hours:
  {window_length_ms("5-hour") == "18000000" : String}

def five_hour_window_bound_is_five_hours():
  {==}

law monthly_window_has_no_bound:
  {reset_or_bound_sql("","monthly") == "NULL" : String}

def monthly_window_has_no_bound():
  {==}
