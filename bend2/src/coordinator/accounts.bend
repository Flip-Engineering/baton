# Accounts name a provider identity, its funding route and a reference into the
# provider's credential store or the local secret store. Credit observations are
# pooled by organization, so several accounts and keys of one organization share
# one balance. The account and funding route selected for an attempt is recorded
# beside the attempt's own identity, which the retained launch already records.
# No credential value enters this state: the launch resolves the reference.
#
# No remaining promotional-credit balance endpoint is documented. The supported
# observations are the operator's reading of the Console Billing display, which
# `import-credit` records, and the provider's Admin organization, usage and cost
# reads, which the observation helper reports and `observe` records whole with
# their source, observed time and actual failure condition. A value the source
# did not report stays empty and its state stays unavailable.
import Base
import ../coordinator/commands.bend as C
import ../coordinator/subscription-fallback.bend as Subs
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ../host/text.bend as Text

# --- the recorded shape ------------------------------------------------------

type AccountRecord is Data:
  Ac{id: String, provider: String, harness: String, funding: String, secret_ref: String, organization: String, verified_at: String}

def account_id(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: id

def account_provider(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: provider

def account_harness(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: harness

def account_funding(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: funding

def account_secret_ref(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: secret_ref

def account_organization(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: organization

def account_verified_at(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}: verified_at

# A selection carries the chosen account and whether observed availability
# decided it. A selection made by the operator's own order is reported as such.
type Selected is Data:
  Sel{account: AccountRecord, preferred: Bool}

def selected_account(selected: Selected) -> AccountRecord:
  match selected:
    case Sel{account,preferred}: account

def selected_preferred(selected: Selected) -> Bool:
  match selected:
    case Sel{account,preferred}: preferred

# --- vocabulary --------------------------------------------------------------

def digit_code(+code: U32) -> Bool:
  Bool.and(Bool.not(U32.is_lt(code,48)),Bool.not(U32.is_lt(57,code)))

# A canonical unsigned decimal: at least one digit, at most one '.', nothing else.
# The text is preserved exactly, so a balance keeps the digits the source
# reported and no value passes through a float.
def decimal_tail(+text: String, +seen_dot: Bool, +seen_digit: Bool) -> Bool:
  match text:
    case SNil{}: seen_digit
    case SCon{head, tail}:
      Bool.pick(Bool,U32.is_eq(Char.to_u32(head),46),
        Bool.pick(Bool,seen_dot,False{},decimal_tail(tail,True{},seen_digit)),
        Bool.pick(Bool,digit_code(Char.to_u32(head)),decimal_tail(tail,seen_dot,True{}),False{}))

def decimal_text(+text: String) -> Bool:
  decimal_tail(text,False{},False{})

def funding_known(+funding: String) -> Bool:
  Bool.or(String.eq(funding,"subscription"),String.eq(funding,"api_key"))

# An API-key funding route launches only on the claude-code harness, whose
# retained launch resolves the secret reference into the child's environment.
# Other harnesses authenticate through their own stores, so recording an
# API-key route for them would record a funding route the launch never uses.
def funding_route_ok(+harness: String, +funding: String) -> Bool:
  Bool.or(String.eq(funding,"subscription"),Bool.and(String.eq(funding,"api_key"),String.eq(harness,"claude-code")))

def harness_launchable(+harness: String) -> Bool:
  Bool.or(String.eq(harness,"codex"),Bool.or(String.eq(harness,"omp"),Bool.or(String.eq(harness,"muse"),String.eq(harness,"claude-code"))))

# A label is one printable ASCII word, so it stays a single recorded field and a
# single report word.
def label_char_ok(+code: U32) -> Bool:
  Bool.and(Bool.not(U32.is_lt(code,33)),Bool.not(U32.is_lt(126,code)))

def label_tail(+text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head, tail}: Bool.and(label_char_ok(Char.to_u32(head)),label_tail(tail))

def label_ok(+text: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(text)),label_tail(text))

# A reference is a store path or store key: nonempty and free of control
# characters, so it stays one recorded field.
def ref_char_ok(+code: U32) -> Bool:
  Bool.and(Bool.not(U32.is_lt(code,32)),Bool.not(U32.is_eq(code,127)))

def ref_tail(+text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head, tail}: Bool.and(ref_char_ok(Char.to_u32(head)),ref_tail(tail))

def ref_ok(+text: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(text)),ref_tail(text))

# The supported observation operations and the fact each one records. A fact the
# provider did not report is never recorded, so no operation yields a balance.
def operation_fact(+operation: String) -> Maybe<String>:
  Bool.pick(Maybe<String>,String.eq(operation,"organization"),Some{"organization"},
    Bool.pick(Maybe<String>,String.eq(operation,"cost"),Some{"external_spend"},
      Bool.pick(Maybe<String>,String.eq(operation,"usage"),Some{"subscription_usage"},None{})))

def credit_fact_known(+fact: String) -> Bool:
  Bool.or(String.eq(fact,"promotional_credit"),String.eq(fact,"purchased_credit"))

def state_known(+state: String) -> Bool:
  Bool.or(String.eq(state,"reported"),String.eq(state,"unavailable"))

# The recording actor: the selected session, or the operator when none is
# selected.
def authority_of(+session: String) -> String:
  Bool.pick(String,String.is_empty(session),"operator",session)

# --- selection ---------------------------------------------------------------

# A verified organization whose newest promotional-credit observation is
# unavailable is a preference key, never a gate: no request is refused from an
# observation, and an unknown organization is never preferred against.
def organization_blocked(+blocked: String, +organization: String) -> Bool:
  Bool.pick(Bool,String.is_empty(organization),False{},
    String.contains("\n" ++ blocked ++ "\n","\n" ++ organization ++ "\n"))

def funding_matches(+required: String, +funding: String) -> Bool:
  Bool.or(String.is_empty(required),String.eq(required,funding))

def account_matches(+harness: String, +required_funding: String, +account: AccountRecord) -> Bool:
  Bool.and(String.eq(account_harness(account),harness),Bool.and(funding_matches(required_funding,account_funding(account)),funding_route_ok(account_harness(account),account_funding(account))))

def account_viable(+blocked: String, +harness: String, +required_funding: String, +account: AccountRecord) -> Bool:
  Bool.and(account_matches(harness,required_funding,account),Bool.not(organization_blocked(blocked,account_organization(account))))

def preferred_after(current: Maybe<&2,AccountRecord>, +viable: Bool, +account: AccountRecord) -> Maybe<&2,AccountRecord>:
  match current:
    case Some{+chosen}: Some{chosen}
    case None{}: Bool.pick(Maybe<&2,AccountRecord>,viable,Some{account},None{})

def matching_after(current: Maybe<&2,AccountRecord>, +matches: Bool, +account: AccountRecord) -> Maybe<&2,AccountRecord>:
  match current:
    case Some{+chosen}: Some{chosen}
    case None{}: Bool.pick(Maybe<&2,AccountRecord>,matches,Some{account},None{})

def wrap_selected(account: Maybe<&2,AccountRecord>, preferred: Bool) -> Maybe<&2,Selected>:
  match account:
    case None{}: None{}
    case Some{+chosen}: Some{Sel{chosen,preferred}}

def select_scan(accounts: List<&2,AccountRecord>, +blocked: String, +harness: String, +required_funding: String, preferred: Maybe<&2,AccountRecord>, matching: Maybe<&2,AccountRecord>) -> Maybe<&2,Selected>:
  match accounts:
    case Nil{}:
      match preferred:
        case Some{+account}: Some{Sel{account,True{}}}
        case None{}: wrap_selected(matching,False{})
    case +account <> +rest:
      select_scan(rest,blocked,harness,required_funding,preferred_after(preferred,account_viable(blocked,harness,required_funding,account),account),matching_after(matching,account_matches(harness,required_funding,account),account))

# Observed availability first; the operator's own order when it decides nothing.
def select_account(accounts: List<&2,AccountRecord>, +blocked: String, +harness: String, +required_funding: String) -> Maybe<&2,Selected>:
  select_scan(accounts,blocked,harness,required_funding,None{},None{})

# --- the launch binding ------------------------------------------------------

# The funding route decides the launch binding. A subscription account binds the
# credential directory the harness reads. An API-key account runs the packaged
# resolver, which reads the reference and passes the credential to the harness in
# its own environment, so the stored argv carries the reference and never a
# value. A missing resolver leaves an API-key account unlaunchable, which the
# caller reports as the actual cause.
def api_key_binding(+secret_ref: String, helper: Maybe<String>) -> Maybe<List<String>>:
  match helper:
    case None{}: None{}
    case Some{+script}: Some{Con{"node",Con{script,Con{secret_ref,Nil{}}}}}

def launch_binding(+harness: String, +funding: String, +secret_ref: String, helper: Maybe<String>) -> Maybe<List<String>>:
  Bool.pick(Maybe<List<String>>,Bool.and(String.eq(funding,"api_key"),Bool.not(String.eq(harness,"claude-code"))),None{},Bool.pick(Maybe<List<String>>,String.eq(funding,"api_key"),api_key_binding(secret_ref,helper),Some{Subs.store_binding(harness,secret_ref)}))

# The packaged resolver sits beside the resolved identity helper, so it is
# installed and versioned with the runtime this deployment resolves.
def api_key_helper(+helper: String) -> String:
  Bool.pick(String,String.is_empty(helper),"",Subs.directory_of(helper) ++ "/api-key-exec.mjs")

def api_key_resolver_value(+helper: String) -> Maybe<String>:
  Bool.pick(Maybe<String>,String.is_empty(helper),None{},Some{helper})

def api_key_resolver(identity: String & String) -> Maybe<String>:
  (registry,helper)=identity
  api_key_resolver_value(api_key_helper(helper))

# The binding the retained launch uses: the account's own funding route when an
# account is in force, otherwise today's profile store binding, so a session
# configured before accounts existed spawns exactly as it did. An account whose
# funding route cannot be resolved yields no binding, which the caller reports as
# the actual cause rather than launching on another account's credential.
def account_binding(+harness: String, chosen: Maybe<&2,AccountRecord>, helper: Maybe<String>, +profile_store: String) -> Maybe<List<String>>:
  match chosen:
    case None{}: Bool.pick(Maybe<List<String>>,String.is_empty(profile_store),None{},Some{Subs.store_binding(harness,profile_store)})
    case Some{+account}: launch_binding(harness,account_funding(account),account_secret_ref(account),helper)

# --- the schema --------------------------------------------------------------

# account_attempts keys on the attempt directory the retained launch records, so
# an account row joins that attempt's own seed, execution and terminal rows.
def schema() -> String:
  "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL,provider TEXT NOT NULL,harness TEXT NOT NULL,funding TEXT NOT NULL CHECK(funding IN ('subscription','api_key')),secret_ref TEXT NOT NULL,organization TEXT NOT NULL DEFAULT '',verified_at TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS account_attempts (attempt TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL REFERENCES sessions(id),turn TEXT NOT NULL DEFAULT '',account TEXT NOT NULL REFERENCES accounts(id),organization TEXT NOT NULL DEFAULT '',funding TEXT NOT NULL,secret_ref TEXT NOT NULL,workload TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL DEFAULT '',error_text TEXT NOT NULL DEFAULT '',started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT NOT NULL DEFAULT '',predecessor TEXT NOT NULL DEFAULT '',recorded TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS credit_observations (id TEXT PRIMARY KEY NOT NULL,organization TEXT NOT NULL DEFAULT '',fact TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reported','unavailable')),balance TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',expires TEXT NOT NULL DEFAULT '',cycle TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',observed_at TEXT NOT NULL,authority TEXT NOT NULL);"
  ++ "CREATE INDEX IF NOT EXISTS credit_observations_pool ON credit_observations(organization,fact);"
  ++ "CREATE INDEX IF NOT EXISTS account_attempts_session ON account_attempts(session,recorded);"

# One transaction that installs the collaboration schema and this module's tables
# before its own statements run. Writes use it; reads use the ordinary read-only
# connection and tolerate a database that has never recorded an account.
def commit_read(db: String, statements: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ schema() ++ statements ++ "COMMIT;")

# --- recorded rows -----------------------------------------------------------

# A database written before this module existed has none of its tables. Every
# entry installs them once, so a read never runs against a missing relation and
# a launch on an older database behaves as it did.
def accounts_present(db: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts');"))
    IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))

# Attempt fact columns added after the first landing: a database whose
# account_attempts table predates them gains the columns here, once per
# process, driven by the table's own column list.
def attempt_columns() -> List<String>:
  ["workload","outcome","error_text","started_at","ended_at"]

def attempt_columns_missing_kept(is_missing: Bool, column: String, missing: List<String>) -> List<String>:
  match is_missing:
    case True{}: Con{column,missing}
    case False{}: missing

def attempt_columns_missing(+db: String, columns: List<String>) -> IO(List<String>):
  match columns:
    case Nil{}: IO.pure(List<String>,Nil{})
    case +column <> rest: do IO<List<String>>:
      found : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM pragma_table_info('account_attempts') WHERE name=" ++ C.q(column) ++ ");"))
      missing : List<String> <- attempt_columns_missing(db,rest)
      IO.pure(List<String>,attempt_columns_missing_kept(String.eq(Tx.trim_nl(found),"0"),column,missing))

def attempt_columns_installed(+db: String, columns: List<String>) -> IO(Unit):
  match columns:
    case Nil{}: IO.pure(Unit,Unit{})
    case +column <> rest: do IO<Unit>:
      added : String <- IO.try(String,DB.Sql.query(db,"ALTER TABLE account_attempts ADD COLUMN " ++ column ++ " TEXT NOT NULL DEFAULT '';"))
      attempt_columns_installed(db,rest)

def attempt_columns_ensured_present(+db: String) -> IO(Unit):
  do IO<Unit>:
    missing : List<String> <- attempt_columns_missing(db,attempt_columns())
    attempt_columns_installed(db,missing)

def attempt_columns_ensured(+db: String) -> IO(Unit):
  do IO<Unit>:
    present : Bool <- accounts_present(db)
    columns : Unit <- Bool.pick(IO(Unit),present,attempt_columns_ensured_present(db),IO.pure(Unit,Unit{}))
    IO.pure(Unit,Unit{})

def ensure_schema(+db: String, present: Bool) -> IO(Unit):
  match present:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      made : String <- IO.try(String,commit_read(db,""))
      IO.pure(Unit,Unit{})

def ensure(+db: String) -> IO(Unit):
  do IO<Unit>:
    present : Bool <- accounts_present(db)
    made : Unit <- ensure_schema(db,present)
    columns : Unit <- attempt_columns_ensured(db)
    IO.pure(Unit,Unit{})

# One row per account, fields separated by the ASCII unit separator, in operator
# recording order.
def account_row_sql() -> String:
  "SELECT id||char(31)||provider||char(31)||harness||char(31)||funding||char(31)||secret_ref||char(31)||organization||char(31)||verified_at FROM accounts ORDER BY rowid;"

def account_rows_flat(fields: List<&2,String>, tail: List<&2,AccountRecord>) -> List<&2,AccountRecord>:
  match fields:
    case id <> provider <> harness <> funding <> secret_ref <> organization <> verified <> rest:
      Con{Ac{id,provider,harness,funding,secret_ref,organization,verified},tail}
    case other: tail

def account_lines(lines: List<String>, tail: List<&2,AccountRecord>) -> List<&2,AccountRecord>:
  match lines:
    case Nil{}: tail
    case line <> rest: account_rows_flat(String.split(Tx.trim_nl(line),Char.from_u32(31)),account_lines(rest,tail))

def account_object_sql() -> String:
  "json_object('id',id,'provider',provider,'harness',harness,'funding',funding,'secretRef',secret_ref,'organization',organization,'verifiedAt',verified_at,'organizationKnown',CASE WHEN organization='' THEN 0 ELSE 1 END)"

def accounts_answer_sql(clause: String) -> String:
  "SELECT json_object('accounts',coalesce(json_group_array(" ++ account_object_sql() ++ "),json('[]'))) FROM accounts WHERE " ++ clause ++ ";"

def observation_object_sql() -> String:
  "json_object('id',id,'organization',organization,'fact',fact,'state',state,'balance',balance,'unit',unit,'expires',expires,'cycle',cycle,'source',source,'observedAt',observed_at,'authority',authority)"

# --- recording an account ----------------------------------------------------

def account_insert_sql(+id: String, +provider: String, +harness: String, +funding: String, +secret_ref: String) -> String:
  "INSERT INTO accounts(id,provider,harness,funding,secret_ref,organization,verified_at) VALUES(" ++ C.q(id) ++ "," ++ C.q(provider) ++ "," ++ C.q(harness) ++ "," ++ C.q(funding) ++ "," ++ C.q(secret_ref) ++ ",'','') ON CONFLICT(id) DO NOTHING;"
  ++ accounts_answer_sql("id=" ++ C.q(id))

# No supplied organization is recorded: the mapping is written only by an
# observation that verified it.
def record_admitted(+db: String, id: String, provider: String, harness: String, funding: String, secret_ref: String, present: Bool) -> IO(Unit):
  match present:
    case False{}: IO.die(Unit,2,"Account recording requires a label without whitespace or control characters, a provider name, a launchable harness (codex, omp, muse or claude-code), a funding route of subscription or api_key (api_key launches only on claude-code), and a nonempty secret-store reference without control characters. No account was recorded.")
    case True{}: do IO<Unit>:
      saved : String <- IO.try(String,commit_read(db,account_insert_sql(id,provider,harness,funding,secret_ref)))
      IO.print(Tx.trim_nl(saved))

# Whether the label is free, already holds this exact record, or holds a
# different one. A different record under the same label is refused, so a
# rotated credential cannot silently leave the old reference in force.
def record_state_sql(+id: String, +provider: String, +harness: String, +funding: String, +secret_ref: String) -> String:
  "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=" ++ C.q(id) ++ ") THEN 'new' WHEN EXISTS(SELECT 1 FROM accounts WHERE id=" ++ C.q(id) ++ " AND provider=" ++ C.q(provider) ++ " AND harness=" ++ C.q(harness) ++ " AND funding=" ++ C.q(funding) ++ " AND secret_ref=" ++ C.q(secret_ref) ++ ") THEN 'same' ELSE 'different' END;"

def record_decided(+db: String, +id: String, provider: String, harness: String, funding: String, secret_ref: String, present: Bool, state: String) -> IO(Unit):
  match present:
    case False{}: record_admitted(db,id,provider,harness,funding,secret_ref,False{})
    case True{}: Bool.pick(IO(Unit),String.eq(state,"different"),IO.die(Unit,2,"Account " ++ id ++ " is already recorded with a different provider, harness, funding route or secret-store reference; nothing was changed. Record the rotated credential under a new label."),record_admitted(db,id,provider,harness,funding,secret_ref,True{}))

def record(+db: String, +id: String, +provider: String, +harness: String, +funding: String, +secret_ref: String) -> IO(Unit):
  do IO<Unit>:
    state : String <- IO.try(String,DB.Sql.read(db,record_state_sql(id,provider,harness,funding,secret_ref)))
    record_decided(db,id,provider,harness,funding,secret_ref,Bool.and(label_ok(id),Bool.and(Bool.not(String.is_empty(provider)),Bool.and(harness_launchable(harness),Bool.and(funding_known(funding),Bool.and(funding_route_ok(harness,funding),ref_ok(secret_ref)))))),Tx.trim_nl(state))

# --- reading accounts --------------------------------------------------------

def read_all(+db: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- IO.try(String,DB.Sql.read(db,accounts_answer_sql("1")))
    IO.print(Tx.trim_nl(text))

def account_absent(id: String) -> IO(Unit):
  IO.die(Unit,2,"No recorded account matches " ++ id ++ "; record the account and retry.")

def read_one(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    +found : String <- IO.try(String,DB.Sql.read(db,"SELECT id FROM accounts WHERE id=" ++ C.q(id) ++ ";"))
    present : Unit <- Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(found)),account_absent(id),IO.pure(Unit,Unit{}))
    saved : String <- IO.try(String,DB.Sql.read(db,accounts_answer_sql("id=" ++ C.q(id))))
    IO.print(Tx.trim_nl(saved))

def read(+db: String, +id: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(id),read_all(db),read_one(db,id))

# --- binding the account in force for a session ------------------------------

def account_record_sql(+db: String, +session: String) -> String:
  "SELECT " ++ C.q(db ++ ".account-") ++ " || lower(hex(id)) FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def account_sidecar(+db: String, +session: String) -> IO(String):
  IO.try(String,DB.Sql.query(db,account_record_sql(db,session)))

def file_text(path: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    IO.pass(String,Subs.optional_text(read))

def bind_admitted(+db: String, +id: String, +session: String, present: Bool) -> IO(Unit):
  match present:
    case False{}: IO.die(Unit,2,"Account binding requires a registered session and a recorded account with that session's harness. No binding was recorded.")
    case True{}: do IO<Unit>:
      path : String <- account_sidecar(db,session)
      appended : Unit <- IO.try(Unit,Text.Text.append(Tx.trim_nl(path),id ++ "\n"))
      IO.print("{\"account\":\"bound\",\"session\":" ++ J.string_literal(session) ++ ",\"accountId\":" ++ J.string_literal(id) ++ "}")

def bind(+db: String, +id: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    admitted : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM sessions s JOIN accounts a ON a.id=" ++ C.q(id) ++ " AND a.harness=s.harness WHERE s.id=" ++ C.q(session) ++ ");"))
    bind_admitted(db,id,session,String.eq(Tx.trim_nl(admitted),"1"))

# The account in force: the last line of the session's append-only account
# record, or the label of its profile record when no account record exists, so a
# session configured before accounts existed keeps its profile and gains the
# attempt record. A record naming another harness selects nothing.
def named_account(accounts: List<&2,AccountRecord>, +label: String, +harness: String) -> Maybe<&2,AccountRecord>:
  match accounts:
    case Nil{}: None{}
    case +account <> +rest:
      Bool.pick(Maybe<&2,AccountRecord>,Bool.and(String.eq(account_id(account),label),String.eq(account_harness(account),harness)),Some{account},named_account(rest,label,harness))

def account_by_label(+db: String, +label: String, +harness: String) -> IO(Maybe<&2,AccountRecord>):
  do IO<Maybe<&2,AccountRecord>>:
    ready : Unit <- ensure(db)
    rows : String <- IO.try(String,DB.Sql.read(db,account_row_sql()))
    +accounts : List<&2,AccountRecord> <- IO.pure(List<&2,AccountRecord>,account_lines(Tx.split_lines(rows),Nil{}))
    IO.pure(Maybe<&2,AccountRecord>,named_account(accounts,label,harness))

def current_account(+db: String, +session: String, +harness: String) -> IO(Maybe<&2,AccountRecord>):
  do IO<Maybe<&2,AccountRecord>>:
    +sidecar : String <- account_sidecar(db,session)
    +labelled : String <- file_text(Tx.trim_nl(sidecar))
    +label : String <- IO.pure(String,Tx.trim_nl(Subs.last_line(Tx.split_lines(labelled))))
    +profile_path : String <- IO.try(String,DB.Sql.query(db,Subs.profile_record_sql(db,session)))
    profiles : String <- file_text(Tx.trim_nl(profile_path))
    +fallback : String <- IO.pure(String,Subs.record_current(Tx.trim_nl(harness),Subs.last_line(Tx.split_lines(profiles))))
    +chosen : String <- IO.pure(String,Bool.pick(String,String.is_empty(label),fallback,label))
    found : Maybe<&2,AccountRecord> <- account_by_label(db,Tx.trim_nl(chosen),Tx.trim_nl(harness))
    IO.pure(Maybe<&2,AccountRecord>,found)

# The account a binding put in force: the account record's own last label, with
# no profile fallback, so a session that predates accounts keeps the profile
# handoff it already had.
def bound_account(+db: String, +session: String, +harness: String) -> IO(Maybe<&2,AccountRecord>):
  do IO<Maybe<&2,AccountRecord>>:
    +sidecar : String <- account_sidecar(db,session)
    +labelled : String <- file_text(Tx.trim_nl(sidecar))
    +label : String <- IO.pure(String,Tx.trim_nl(Subs.last_line(Tx.split_lines(labelled))))
    found : Maybe<&2,AccountRecord> <- Bool.pick(IO(Maybe<&2,AccountRecord>),String.is_empty(label),IO.pure(Maybe<&2,AccountRecord>,None{}),account_by_label(db,label,harness))
    IO.pure(Maybe<&2,AccountRecord>,found)

# The account after the one that refused, in operator recording order, or none
# when no further recorded account matches the harness. The refused account
# itself never matches again in this advance.
def next_account_after(accounts: List<&2,AccountRecord>, +harness: String, +current: String, seen: Bool) -> Maybe<&2,AccountRecord>:
  match accounts:
    case Nil{}: None{}
    case +account <> +rest:
      match seen:
        case True{}: Bool.pick(Maybe<&2,AccountRecord>,account_matches(harness,"",account),Some{account},next_account_after(rest,harness,current,True{}))
        case False{}: Bool.pick(Maybe<&2,AccountRecord>,String.eq(account_id(account),current),next_account_after(rest,harness,current,True{}),next_account_after(rest,harness,current,False{}))

def account_handoff_body(+harness: String, +refused: String, +bound: String, +cause: String) -> String:
  "account handoff: harness=" ++ harness ++ "; refused account=" ++ refused ++ "; bound account=" ++ bound ++ "; original cause: " ++ cause

def account_exhausted_body(+harness: String, +refused: String, +cause: String) -> String:
  "accounts exhausted: harness=" ++ harness ++ "; account=" ++ refused ++ " was the last operator-recorded account for this harness and the provider reported usage exhaustion; cause: " ++ cause

def advance_append_observed(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +next: AccountRecord, +cause: String, appended: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match appended:
    case Done{unit}: do IO<Bool>:
      noted : Unit <- Subs.report_body(db,session,id,"account-handoff-" ++ account_id(next),account_handoff_body(harness,account_id(refused),account_id(next),cause))
      IO.pure(Bool,True{})
    case Fail{(code,detail)}: do IO<Bool>:
      noted : Unit <- Subs.report_body(db,session,id,"account-append-failed","account record append failed: " ++ U32.show(code) ++ ": " ++ detail ++ "; the provider cause stands and no account was advanced.")
      IO.pure(Bool,False{})

def advance_account_decided(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +cause: String, decided: Maybe<&2,AccountRecord>) -> IO(Bool):
  match decided:
    case None{}: do IO<Bool>:
      noted : Unit <- Subs.report_body(db,session,id,"account-exhausted",account_exhausted_body(harness,account_id(refused),cause))
      IO.pure(Bool,False{})
    case Some{+next}: do IO<Bool>:
      path : String <- account_sidecar(db,session)
      appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(Tx.trim_nl(path),account_id(next) ++ "\n")
      advance_append_observed(db,session,id,harness,refused,next,cause,appended)

def advance_account(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +cause: String) -> IO(Bool):
  do IO<Bool>:
    rows : String <- IO.try(String,DB.Sql.read(db,account_row_sql()))
    +accounts : List<&2,AccountRecord> <- IO.pure(List<&2,AccountRecord>,account_lines(Tx.split_lines(rows),Nil{}))
    +decided : Maybe<&2,AccountRecord> <- IO.pure(Maybe<&2,AccountRecord>,next_account_after(accounts,harness,account_id(refused),False{}))
    advanced : Bool <- advance_account_decided(db,session,id,harness,refused,cause,decided)
    IO.pure(Bool,advanced)

def handoff_decided(+db: String, +session: String, +id: String, +event: String, native: String, cmd: String, cwd: String, +cause: String, +harness: String, bound: Maybe<&2,AccountRecord>) -> IO(Bool):
  match bound:
    case None{}: Subs.profile_handoff(db,session,id,event,native,cmd,cwd)
    case Some{+refused}: Bool.pick(IO(Bool),String.is_empty(cause),IO.pure(Bool,False{}),advance_account(db,session,id,harness,refused,cause))

# Provider-reported exhaustion advances the account in force when a binding
# put one in force, and the operator's profile list otherwise. The advance is
# recorded before the caller relaunches, so the next attempt records the next
# account beside its own attempt identity.
def handoff(+db: String, +session: String, +id: String, +event: String, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    +cause : String <- Subs.exhaustion_cause(db,event)
    +harness_text : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +harness : String <- IO.pure(String,Tx.trim_nl(harness_text))
    bound : Maybe<&2,AccountRecord> <- bound_account(db,session,harness)
    advanced : Bool <- handoff_decided(db,session,id,event,native,cmd,cwd,cause,harness,bound)
    IO.pure(Bool,advanced)

# --- the account selected for each attempt -----------------------------------

def attempt_insert_sql(+session: String, +attempt: String, +predecessor: String, +account: AccountRecord) -> String:
  "INSERT OR REPLACE INTO account_attempts(attempt,session,turn,account,organization,funding,secret_ref,workload,started_at,predecessor) SELECT " ++ C.q(attempt) ++ "," ++ C.q(session) ++ ",coalesce((SELECT id FROM executions WHERE session=" ++ C.q(session) ++ " AND directory=" ++ C.q(attempt) ++ "),'')," ++ C.q(account_id(account)) ++ "," ++ C.q(account_organization(account)) ++ "," ++ C.q(account_funding(account)) ++ "," ++ C.q(account_secret_ref(account)) ++ ",CASE WHEN " ++ C.q(account_funding(account)) ++ "='api_key' THEN 'agent-sdk' WHEN " ++ C.q(account_harness(account)) ++ "='claude-code' THEN 'subscription' ELSE " ++ C.q(account_harness(account)) ++ " END,CAST(strftime('%s','now') AS INTEGER),CURRENT_TIMESTAMP," ++ C.q(predecessor) ++ ";"
  ++ "SELECT json_object('attempt',attempt,'session',session,'turn',turn,'account',account,'organization',organization,'funding',funding,'secretRef',secret_ref,'workload',workload,'outcome',outcome,'errorText',error_text,'startedAt',started_at,'endedAt',ended_at,'predecessor',predecessor,'recorded',recorded) FROM account_attempts WHERE attempt=" ++ C.q(attempt) ++ ";"

# The completion facts of one attempt: the provider outcome, the provider's
# original error text and the end time. The receive and turn completion paths
# call this once per finished attempt - the single coordinated hook, owned by
# the runtime seat, so no completion fact is assembled anywhere else.
def attempt_completed_sql(+attempt: String, +outcome: String, +error_text: String) -> String:
  "UPDATE account_attempts SET outcome=" ++ C.q(outcome) ++ ",error_text=" ++ C.q(error_text) ++ ",ended_at=CURRENT_TIMESTAMP WHERE attempt=" ++ C.q(attempt) ++ ";"
  ++ "SELECT json_object('attempt',attempt,'account',account,'funding',funding,'workload',workload,'outcome',outcome,'errorText',error_text,'startedAt',started_at,'endedAt',ended_at) FROM account_attempts WHERE attempt=" ++ C.q(attempt) ++ ";"

def attempt_completed(+db: String, +attempt: String, +outcome: String, +error_text: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,commit_read(db,attempt_completed_sql(attempt,outcome,error_text)))
    IO.print(Tx.trim_nl(saved))

# The launch records the selected account beside the attempt. A failed record
# reports its own cause to the session's coordinator and leaves the launch to
# run, so an unfinished bookkeeping row never stops the work it describes.
def attempt_recorded(+db: String, +session: String, +attempt: String, recorded: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match recorded:
    case Done{saved}: IO.pure(Unit,Unit{})
    case Fail{(code,detail)}: do IO<Unit>:
      noted : Unit <- Subs.report_body(db,session,attempt ++ ":account-record","account-attempt-record-failed","The selected account record for this attempt failed at the database: " ++ U32.show(code) ++ ": " ++ detail ++ "; the attempt continues and its recorded account is missing.")
      IO.pure(Unit,Unit{})

def record_attempt(+db: String, +session: String, +attempt: String, +predecessor: String, +account: AccountRecord) -> IO(Unit):
  do IO<Unit>:
    recorded : Result<&1,&1,U32 & String,String> <- commit_read(db,attempt_insert_sql(session,attempt,predecessor,account))
    noted : Unit <- attempt_recorded(db,session,attempt,recorded)
    IO.pure(Unit,Unit{})

def attempts_answer_sql(session: String) -> String:
  "SELECT json_object('attempts',coalesce(json_group_array(json_object('attempt',attempt,'session',session,'turn',turn,'account',account,'organization',organization,'funding',funding,'secretRef',secret_ref,'workload',workload,'outcome',outcome,'errorText',error_text,'startedAt',started_at,'endedAt',ended_at,'predecessor',predecessor,'recorded',recorded)),json('[]'))) FROM (SELECT * FROM account_attempts WHERE session=" ++ C.q(session) ++ " ORDER BY recorded,rowid);"

def attempts(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- IO.try(String,DB.Sql.read(db,attempts_answer_sql(session)))
    IO.print(Tx.trim_nl(text))

# --- organization credit observations ----------------------------------------

def observe_fields_sql(+detail: String) -> String:
  "SELECT (CASE WHEN json_valid(" ++ C.q(detail) ++ ") THEN 1 ELSE 0 END)||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.operation'),'')||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.state'),'')||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.document.id'),'');"

def observe_observed_at(+detail: String) -> String:
  "CASE WHEN json_type(" ++ C.q(detail) ++ ",'$.observedAt')='integer' THEN CAST(json_extract(" ++ C.q(detail) ++ ",'$.observedAt') AS TEXT) ELSE CAST(strftime('%s','now') AS INTEGER)*1000 END"

# The account's verified organization is the pool key for every fact other than
# the organization read itself, so an unverified account pools nothing.
def observe_organization(+detail: String, +fact: String) -> String:
  Bool.pick(String,String.eq(fact,"organization"),"coalesce(nullif(json_extract(" ++ C.q(detail) ++ ",'$.document.id'),''),'')","organization")

def observe_id_sql(+account: String, +fact: String, +detail: String) -> String:
  C.q(account) ++ "||':observe:'||" ++ C.q(fact) ++ "||':'||" ++ observe_observed_at(detail)

def observe_insert_sql(+account: String, +authority: String, +fact: String, +state: String, +detail: String) -> String:
  "UPDATE accounts SET organization=CASE WHEN " ++ C.q(fact) ++ "='organization' AND " ++ C.q(state) ++ "='reported' AND length(coalesce(json_extract(" ++ C.q(detail) ++ ",'$.document.id'),''))>0 THEN coalesce(json_extract(" ++ C.q(detail) ++ ",'$.document.id'),'') ELSE organization END,verified_at=CASE WHEN " ++ C.q(fact) ++ "='organization' AND " ++ C.q(state) ++ "='reported' AND length(coalesce(json_extract(" ++ C.q(detail) ++ ",'$.document.id'),''))>0 THEN " ++ observe_observed_at(detail) ++ " ELSE verified_at END WHERE id=" ++ C.q(account) ++ ";"
  ++ "INSERT OR IGNORE INTO credit_observations(id,organization,fact,state,balance,unit,expires,cycle,source,detail,observed_at,authority) SELECT " ++ observe_id_sql(account,fact,detail) ++ "," ++ observe_organization(detail,fact) ++ "," ++ C.q(fact) ++ "," ++ C.q(state) ++ ",'','',coalesce(json_extract(" ++ C.q(detail) ++ ",'$.expires'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.cycle'),''),coalesce(nullif(json_extract(" ++ C.q(detail) ++ ",'$.source'),''),'unsourcedObservation')," ++ C.q(detail) ++ "," ++ observe_observed_at(detail) ++ "," ++ C.q(authority) ++ " FROM accounts WHERE id=" ++ C.q(account) ++ ";"
  ++ "SELECT json_object('observation',(SELECT " ++ observation_object_sql() ++ " FROM credit_observations WHERE id=" ++ observe_id_sql(account,fact,detail) ++ "),'accounts',(SELECT coalesce(json_group_array(" ++ account_object_sql() ++ "),json('[]')) FROM accounts WHERE id=" ++ C.q(account) ++ "));"

def observe_admitted(+db: String, +authority: String, account: String, detail: String, fact: String, state: String, present: Bool) -> IO(Unit):
  match present:
    case False{}: IO.die(Unit,2,"Account observation requires a recorded account, a JSON document, an operation of organization, cost or usage, a state of reported or unavailable, and for a reported organization observation a document id. No observation was recorded.")
    case True{}: do IO<Unit>:
      saved : String <- IO.try(String,commit_read(db,observe_insert_sql(account,authority,fact,state,detail)))
      IO.print(Tx.trim_nl(saved))

def observe_selected(+db: String, +authority: String, +account: String, +detail: String, +state: String, fact: Maybe<String>, +document_id: String, valid_json: Bool) -> IO(Unit):
  match fact:
    case None{}: observe_admitted(db,authority,account,detail,"","",False{})
    case Some{+known}: do IO<Unit>:
      registered : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM accounts WHERE id=" ++ C.q(account) ++ ");"))
      verified_id : Bool = Bool.pick(Bool,Bool.and(String.eq(known,"organization"),String.eq(state,"reported")),Bool.not(String.is_empty(document_id)),True{})
      observe_admitted(db,authority,account,detail,known,state,Bool.and(valid_json,Bool.and(String.eq(Tx.trim_nl(registered),"1"),Bool.and(state_known(state),verified_id))))

def observe_fields(+db: String, +authority: String, +account: String, +detail: String, fields: List<&2,String>) -> IO(Unit):
  match fields:
    case valid <> operation <> state <> document_id <> rest: observe_selected(db,authority,account,detail,state,operation_fact(operation),document_id,String.eq(valid,"1"))
    case other: observe_admitted(db,authority,account,detail,"","",False{})

def observe(+db: String, +authority: String, +account: String, +detail: String) -> IO(Unit):
  do IO<Unit>:
    +fields : String <- IO.try(String,DB.Sql.read(db,observe_fields_sql(detail)))
    returned : Unit <- observe_fields(db,authority,account,detail,String.split(Tx.trim_nl(fields),Char.from_u32(31)))
    IO.pure(Unit,Unit{})

# --- an imported credit balance ----------------------------------------------

# A promotional or purchased credit balance is only visible in the Console
# Billing display, so it is imported with the reading operator's own declaration
# of source, amount, unit and expiry. A reported amount must be a canonical
# decimal with a named unit, and every import must name its source, so a model's
# prose can never become a balance. An import may instead record that the reading
# for this cycle found no value: the fact's state is then unavailable, its amount
# stays empty, and the document's own condition keeps the actual cause.
def import_fields_sql(+detail: String) -> String:
  "SELECT (CASE WHEN json_valid(" ++ C.q(detail) ++ ") THEN 1 ELSE 0 END)||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.fact'),'')||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.state'),'reported')||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.balance'),'')||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.unit'),'')||char(31)||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.source'),'');"

def import_id_sql(+account: String, +detail: String) -> String:
  C.q(account) ++ "||':import:'||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.fact'),'')||':'||coalesce(json_extract(" ++ C.q(detail) ++ ",'$.state'),'reported')||':'||" ++ observe_observed_at(detail)

def import_insert_sql(+authority: String, +account: String, +organization: String, +detail: String) -> String:
  "INSERT OR IGNORE INTO credit_observations(id,organization,fact,state,balance,unit,expires,cycle,source,detail,observed_at,authority) SELECT " ++ import_id_sql(account,detail) ++ "," ++ C.q(organization) ++ ",coalesce(json_extract(" ++ C.q(detail) ++ ",'$.fact'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.state'),'reported'),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.balance'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.unit'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.expires'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.cycle'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.source'),'')," ++ C.q(detail) ++ "," ++ observe_observed_at(detail) ++ "," ++ C.q(authority) ++ " FROM accounts WHERE id=" ++ C.q(account) ++ " AND organization=" ++ C.q(organization) ++ ";"
  ++ "SELECT json_object('observation',(SELECT " ++ observation_object_sql() ++ " FROM credit_observations WHERE id=" ++ import_id_sql(account,detail) ++ "),'accounts',(SELECT coalesce(json_group_array(" ++ account_object_sql() ++ "),json('[]')) FROM accounts WHERE id=" ++ C.q(account) ++ "));"

def import_admitted(+db: String, +authority: String, +account: String, +organization: String, +detail: String, present: Bool) -> IO(Unit):
  match present:
    case False{}: IO.die(Unit,2,"A credit import requires a JSON document, a recorded account whose verified organization is the imported organization, a fact of promotional_credit or purchased_credit, a state of reported or unavailable, a named source, and for a reported amount a canonical decimal balance with a named unit. No reading was recorded.")
    case True{}: do IO<Unit>:
      saved : String <- IO.try(String,commit_read(db,import_insert_sql(authority,account,organization,detail)))
      IO.print(Tx.trim_nl(saved))

def import_selected(+db: String, +authority: String, +account: String, +organization: String, +detail: String, fact: String, +state: String, balance: String, unit: String, source: String, valid_json: Bool) -> IO(Unit):
  do IO<Unit>:
    verified : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM accounts WHERE id=" ++ C.q(account) ++ " AND organization=" ++ C.q(organization) ++ " AND organization<>'');"))
    reported : Bool <- IO.pure(Bool,Bool.and(decimal_text(balance),Bool.not(String.is_empty(unit))))
    import_admitted(db,authority,account,organization,detail,Bool.and(valid_json,Bool.and(String.eq(Tx.trim_nl(verified),"1"),Bool.and(credit_fact_known(fact),Bool.and(state_known(state),Bool.and(Bool.not(String.is_empty(source)),Bool.or(String.eq(state,"unavailable"),reported)))))))

def import_fields(+db: String, +authority: String, +account: String, +organization: String, +detail: String, fields: List<&2,String>) -> IO(Unit):
  match fields:
    case valid <> fact <> state <> balance <> unit <> source <> rest: import_selected(db,authority,account,organization,detail,fact,state,balance,unit,source,String.eq(valid,"1"))
    case other: import_admitted(db,authority,account,organization,detail,False{})

def import_credit(+db: String, +authority: String, +account: String, +organization: String, +detail: String) -> IO(Unit):
  do IO<Unit>:
    +fields : String <- IO.try(String,DB.Sql.read(db,import_fields_sql(detail)))
    returned : Unit <- import_fields(db,authority,account,organization,detail,String.split(Tx.trim_nl(fields),Char.from_u32(31)))
    IO.pure(Unit,Unit{})

# --- the pooled read ---------------------------------------------------------

# The newest observation of each fact for each organization, the accounts that
# view that organization, and, for a fact whose newest observation is
# unavailable, the last reported value with the cycle it was observed in. An
# older cycle is reported as the previous reading; no wall-clock deadline decides
# anything.
def pool_answer_sql(+clause: String) -> String:
  "WITH ranked AS (SELECT organization,fact,state,balance,unit,expires,cycle,source,observed_at,row_number() OVER (PARTITION BY organization,fact ORDER BY observed_at DESC,rowid DESC) AS rank FROM credit_observations),"
  ++ " organizations AS (SELECT organization FROM credit_observations WHERE " ++ clause ++ " UNION SELECT organization FROM accounts WHERE organization<>'' AND " ++ clause ++ ")"
  ++ " SELECT json_object('organizations',coalesce(json_group_array(json_object('organization',o.organization,'observationState',CASE WHEN EXISTS(SELECT 1 FROM ranked r2 WHERE r2.organization=o.organization AND r2.fact='promotional_credit' AND r2.rank=1 AND r2.state='reported') THEN 'reported' WHEN EXISTS(SELECT 1 FROM ranked r3 WHERE r3.organization=o.organization AND r3.fact='promotional_credit' AND r3.rank=1) THEN 'unavailable' ELSE 'unknown' END,'facts',json(o.facts),'accounts',json(o.accounts))),json('[]'))) FROM ("
  ++ " SELECT organization AS organization,"
  ++ " (SELECT coalesce(json_group_array(json_object('fact',r.fact,'state',r.state,'balance',r.balance,'unit',r.unit,'expires',r.expires,'cycle',r.cycle,'source',r.source,'observedAt',r.observed_at,'previous',CASE WHEN r.state='unavailable' THEN (SELECT json_object('balance',p.balance,'unit',p.unit,'cycle',p.cycle,'observedAt',p.observed_at,'source',p.source) FROM credit_observations p WHERE p.organization=r.organization AND p.fact=r.fact AND p.state='reported' ORDER BY p.observed_at DESC,p.rowid DESC LIMIT 1) END,'conflict',json(CASE WHEN (SELECT count(DISTINCT balance) FROM credit_observations WHERE organization=r.organization AND fact=r.fact AND state='reported' AND balance<>'' AND cycle=r.cycle)>1 THEN 'true' ELSE 'false' END),'readings',(SELECT coalesce(json_group_array(json_object('balance',balance,'unit',unit,'source',source,'observedAt',observed_at,'authority',authority)),json('[]')) FROM (SELECT DISTINCT balance,unit,source,observed_at,authority FROM credit_observations WHERE organization=r.organization AND fact=r.fact AND state='reported' AND balance<>'' AND cycle=r.cycle)))),json('[]')) FROM ranked r WHERE r.rank=1 AND r.organization=o.organization) AS facts,"
  ++ " (SELECT coalesce(json_group_array(id),json('[]')) FROM accounts a WHERE a.organization=o.organization) AS accounts"
  ++ " FROM organizations o) o;"

def pool_where(+organization: String) -> String:
  Bool.pick(String,String.is_empty(organization),"1","organization=" ++ C.q(organization))

def pool(+db: String, +organization: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- IO.try(String,DB.Sql.read(db,pool_answer_sql(pool_where(organization))))
    IO.print(Tx.trim_nl(text))

# --- the selection read ------------------------------------------------------

def blocked_organizations_sql() -> String:
  "WITH ranked AS (SELECT organization,state,row_number() OVER (PARTITION BY organization ORDER BY observed_at DESC,rowid DESC) AS rank FROM credit_observations WHERE fact='promotional_credit' AND organization<>'') SELECT coalesce(group_concat(organization,char(10)),'') FROM ranked WHERE rank=1 AND state='unavailable';"

# The newest promotional-credit reading of one organization as
# state<US>cycle, or unknown when the organization has no such reading.
def org_observation_sql(+organization: String) -> String:
  "WITH ranked AS (SELECT state,cycle,row_number() OVER (PARTITION BY organization ORDER BY observed_at DESC,rowid DESC) AS rank FROM credit_observations WHERE fact='promotional_credit' AND organization=" ++ C.q(organization) ++ ") SELECT coalesce((SELECT state||char(31)||cycle FROM ranked WHERE rank=1),'unknown'||char(31));"

def selection_json(+selected: Selected, +state: String, +cycle: String) -> String:
  "{\"selected\":" ++ J.string_literal(account_id(selected_account(selected))) ++ ",\"preferredByObservation\":" ++ Bool.pick(String,selected_preferred(selected),"true","false") ++ ",\"harness\":" ++ J.string_literal(account_harness(selected_account(selected))) ++ ",\"funding\":" ++ J.string_literal(account_funding(selected_account(selected))) ++ ",\"organization\":" ++ J.string_literal(account_organization(selected_account(selected))) ++ ",\"creditEligible\":" ++ Bool.pick(String,Bool.and(String.eq(account_funding(selected_account(selected)),"api_key"),Bool.not(String.is_empty(account_organization(selected_account(selected))))),"true","false") ++ ",\"observationState\":" ++ J.string_literal(state) ++ ",\"creditCycle\":" ++ J.string_literal(cycle) ++ "}"

def selection_fields_json(+selected: Selected, fields: List<&2,String>) -> String:
  match fields:
    case state <> cycle <> rest: selection_json(selected,state,cycle)
    case other: selection_json(selected,"unknown","")

def select_answer(+db: String, +harness: String, +funding: String, chosen: Maybe<&2,Selected>) -> IO(Unit):
  match chosen:
    case None{}: IO.die(Unit,2,"No recorded account matches harness " ++ harness ++ " and funding " ++ funding ++ "; record an account and retry.")
    case Some{+selected}: do IO<Unit>:
      fields : String <- IO.try(String,DB.Sql.read(db,org_observation_sql(account_organization(selected_account(selected)))))
      IO.print(selection_fields_json(selected,String.split(Tx.trim_nl(fields),Char.from_u32(31))))

def select(+db: String, +harness: String, +funding: String) -> IO(Unit):
  do IO<Unit>:
    rows : String <- IO.try(String,DB.Sql.read(db,account_row_sql()))
    +accounts : List<&2,AccountRecord> <- IO.pure(List<&2,AccountRecord>,account_lines(Tx.split_lines(rows),Nil{}))
    +blocked_text : String <- IO.try(String,DB.Sql.read(db,blocked_organizations_sql()))
    chosen : Maybe<&2,Selected> <- IO.pure(Maybe<&2,Selected>,select_account(accounts,Tx.trim_nl(blocked_text),harness,funding))
    select_answer(db,harness,funding,chosen)

# --- the command -------------------------------------------------------------

def unknown_action(action: String) -> IO(Unit):
  IO.die(Unit,2,"Unknown account action " ++ action ++ ". Use record, read, bind, attempts, select, pool, observe or import-credit.")

# The verb's argv carries one action and the eight named options in a fixed
# order: action, id, provider, harness, funding, secret-ref, organization,
# detail, session. Each action reads the options it names.
def run(+db: String, +action: String, +id: String, +provider: String, +harness: String, +funding: String, +secret_ref: String, +organization: String, +detail: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- ensure(db)
    taken : Unit <- Bool.pick(IO(Unit),String.eq(action,"record"),record(db,id,provider,harness,funding,secret_ref),
      Bool.pick(IO(Unit),String.eq(action,"read"),read(db,id),
      Bool.pick(IO(Unit),String.eq(action,"bind"),bind(db,id,session),
      Bool.pick(IO(Unit),String.eq(action,"attempts"),attempts(db,session),
      Bool.pick(IO(Unit),String.eq(action,"select"),select(db,harness,funding),
      Bool.pick(IO(Unit),String.eq(action,"pool"),pool(db,organization),
      Bool.pick(IO(Unit),String.eq(action,"observe"),observe(db,authority_of(session),id,detail),
      Bool.pick(IO(Unit),String.eq(action,"import-credit"),import_credit(db,authority_of(session),id,organization,detail),
      unknown_action(action)))))))))
    IO.pure(Unit,Unit{})

# The launch path records the account and funding route for the attempt it is
# about to start. A session with no account in force records nothing and keeps
# its existing profile binding.
def record_current_attempt(+db: String, +session: String, +attempt: String, +predecessor: String, chosen: Maybe<&2,AccountRecord>) -> IO(Unit):
  match chosen:
    case None{}: IO.pure(Unit,Unit{})
    case Some{+account}: record_attempt(db,session,attempt,predecessor,account)
