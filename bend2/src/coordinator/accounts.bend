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
import ./subscription-fallback.bend as Subs
import ./usage-windows.bend as UW
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

# --- exact decimal arithmetic ------------------------------------------------
# Amounts stay decimal text end to end. Comparison, addition and subtraction
# scale both operands to integer digit strings at the wider fractional width,
# so no amount passes through a float and authored precision is preserved.

def digits_clean_tail(+text: String) -> String:
  match text:
    case SNil{}: "0"
    case SCon{head,tail}: Bool.pick(String,Bool.and(U32.is_eq(Char.to_u32(head),48),Bool.not(String.is_empty(tail))),digits_clean_tail(tail),text)

def digits_clean(+text: String) -> String:
  Bool.pick(String,String.is_empty(text),"0",digits_clean_tail(text))

def decimal_int_of(parts: List<&2,String>) -> String:
  match parts:
    case head <> rest: head
    case Nil{}: ""

def decimal_int_part(+text: String) -> String:
  decimal_int_of(String.split(text,Char.from_u32(46)))

def decimal_frac_of(parts: List<&2,String>) -> String:
  match parts:
    case head <> frac <> rest: frac
    case other: ""

def decimal_frac_part(+text: String) -> String:
  decimal_frac_of(String.split(text,Char.from_u32(46)))

def frac_padded(+frac: String, +other: String) -> String:
  match frac other:
    case SNil{} SNil{}: ""
    case SNil{} SCon{ohead,otail}: SCon{Char.from_u32(48),frac_padded("",otail)}
    case SCon{head,tail} SNil{}: frac
    case SCon{head,tail} SCon{ohead,otail}: SCon{head,frac_padded(tail,otail)}

def decimal_scaled(+text: String, +other: String) -> String:
  digits_clean(digits_clean(decimal_int_part(text)) ++ frac_padded(decimal_frac_part(text),decimal_frac_part(other)))

def digits_is_gt(+a: String, +b: String) -> Bool:
  Bool.pick(Bool,Nat.is_eq(String.length(a),String.length(b)),String.is_gt(a,b),Nat.is_lt(String.length(b),String.length(a)))

def decimal_is_gt(+a: String, +b: String) -> Bool:
  digits_is_gt(decimal_scaled(a,b),decimal_scaled(b,a))

def decimal_lte(+a: String, +b: String) -> Bool:
  Bool.not(decimal_is_gt(a,b))

def decimal_is_zero_tail(+text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head,tail}: Bool.and(Bool.or(U32.is_eq(Char.to_u32(head),48),U32.is_eq(Char.to_u32(head),46)),decimal_is_zero_tail(tail))

def decimal_is_zero(+text: String) -> Bool:
  Bool.and(decimal_text(text),decimal_is_zero_tail(text))

def digit_value(+head: Char) -> U32:
  U32.sub(Char.to_u32(head),48)

def digits_add_rev(+a: String, +b: String, +carry: U32) -> String:
  match a b:
    case SNil{} SNil{}: Bool.pick(String,U32.is_eq(carry,1),"1","")
    case SNil{} SCon{bhead,btail}: SCon{Char.from_u32(U32.add(48,U32.mod(U32.add(digit_value(bhead),carry),10))),digits_add_rev("",btail,U32.div(U32.add(digit_value(bhead),carry),10))}
    case SCon{ahead,atail} SNil{}: SCon{Char.from_u32(U32.add(48,U32.mod(U32.add(digit_value(ahead),carry),10))),digits_add_rev(atail,"",U32.div(U32.add(digit_value(ahead),carry),10))}
    case SCon{ahead,atail} SCon{bhead,btail}: SCon{Char.from_u32(U32.add(48,U32.mod(U32.add(U32.add(digit_value(ahead),digit_value(bhead)),carry),10))),digits_add_rev(atail,btail,U32.div(U32.add(U32.add(digit_value(ahead),digit_value(bhead)),carry),10))}

def digits_add(+a: String, +b: String) -> String:
  digits_clean(String.reverse(digits_add_rev(String.reverse(digits_clean(a)),String.reverse(digits_clean(b)),0)))

def digits_sub_rev(+a: String, +b: String, +borrow: U32) -> String:
  match a b:
    case SNil{} SNil{}: ""
    case SNil{} SCon{bhead,btail}: ""
    case SCon{ahead,atail} SNil{}: Bool.pick(String,U32.is_lt(digit_value(ahead),borrow),SCon{Char.from_u32(U32.add(48,U32.sub(U32.add(digit_value(ahead),10),borrow))),digits_sub_rev(atail,"",1)},SCon{Char.from_u32(U32.add(48,U32.sub(digit_value(ahead),borrow))),digits_sub_rev(atail,"",0)})
    case SCon{ahead,atail} SCon{bhead,btail}: Bool.pick(String,U32.is_lt(digit_value(ahead),U32.add(digit_value(bhead),borrow)),SCon{Char.from_u32(U32.add(48,U32.sub(U32.add(digit_value(ahead),10),U32.add(digit_value(bhead),borrow)))),digits_sub_rev(atail,btail,1)},SCon{Char.from_u32(U32.add(48,U32.sub(digit_value(ahead),U32.add(digit_value(bhead),borrow)))),digits_sub_rev(atail,btail,0)})

def digits_sub(+a: String, +b: String) -> String:
  digits_clean(String.reverse(digits_sub_rev(String.reverse(digits_clean(a)),String.reverse(digits_clean(b)),0)))

def take_like(+text: String, +like: String) -> String:
  match text like:
    case SNil{} SNil{}: ""
    case SNil{} SCon{lhead,ltail}: ""
    case SCon{head,tail} SNil{}: ""
    case SCon{head,tail} SCon{lhead,ltail}: SCon{head,take_like(tail,ltail)}

def drop_like(+text: String, +like: String) -> String:
  match text like:
    case SNil{} SNil{}: ""
    case SNil{} SCon{lhead,ltail}: ""
    case SCon{head,tail} SNil{}: text
    case SCon{head,tail} SCon{lhead,ltail}: drop_like(tail,ltail)

def zeros_like(+like: String) -> String:
  match like:
    case SNil{}: ""
    case SCon{head,tail}: SCon{Char.from_u32(48),zeros_like(tail)}

def frac_trimmed_go(+reversed: String) -> String:
  match reversed:
    case SNil{}: ""
    case SCon{head,tail}: Bool.pick(String,U32.is_eq(Char.to_u32(head),48),frac_trimmed_go(tail),String.reverse(reversed))

def frac_trimmed(+frac: String) -> String:
  frac_trimmed_go(String.reverse(frac))

def decimal_join_parts(+rev_int: String, +frac: String) -> String:
  Bool.pick(String,String.is_empty(frac),digits_clean(String.reverse(rev_int)),digits_clean(String.reverse(rev_int)) ++ "." ++ frac)

def decimal_join_scaled(+scaled: String, +frac_like: String) -> String:
  decimal_join_parts(drop_like(String.reverse(scaled),frac_like),frac_trimmed(zeros_like(drop_like(frac_like,String.reverse(take_like(String.reverse(scaled),frac_like)))) ++ String.reverse(take_like(String.reverse(scaled),frac_like))))

def decimal_from_scaled(+scaled: String, +frac_like: String) -> String:
  Bool.pick(String,String.is_empty(frac_like),digits_clean(scaled),decimal_join_scaled(digits_clean(scaled),frac_like))

def decimal_add(+a: String, +b: String) -> String:
  decimal_from_scaled(digits_add(decimal_scaled(a,b),decimal_scaled(b,a)),frac_padded(decimal_frac_part(a),decimal_frac_part(b)))

def decimal_sub(+a: String, +b: String) -> String:
  decimal_from_scaled(digits_sub(decimal_scaled(a,b),decimal_scaled(b,a)),frac_padded(decimal_frac_part(a),decimal_frac_part(b)))

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

# A subscription account binds the credential directory the harness reads. The
# API-key helper binding carries only a resolver path and secret reference. The
# coordinator applies the credit-admission hold before returning that binding.
def api_key_binding(+secret_ref: String, helper: Maybe<String>) -> Maybe<List<String>>:
  match helper:
    case None{}: None{}
    case Some{+script}: Some{Con{script,Con{secret_ref,Nil{}}}}

# Anthropic Claude API-key funding is held until every request can reserve its
# maximum charge before it reaches the provider. A CLI spend threshold does not
# bound a request that is already in flight.
def credit_api_key_refusal(account: AccountRecord) -> String:
  match account:
    case Ac{id,provider,harness,funding,secret_ref,organization,verified_at}:
      match funding:
        case "api_key": Bool.pick(String,Bool.and(String.eq(provider,"anthropic"),String.eq(harness,"claude-code")),"Anthropic API-key launches are held because request-level promotional-credit admission is unavailable; the attempt was not started and its input stays owed.","This API-key launch has no installed resolver beside the resolved identity helper; the attempt was not started and its input stays owed.")
        case other: "The selected account has no available launch binding; the attempt was not started and its input stays owed."

# --- request-level credit metering and admission -----------------------------
# A meter reading is the newest reported promotional-credit observation for one
# verified organization, stated beside the two clocks that bound it: the plan
# billing cycle that refreshes the credit and the calendar-month period that
# resets the organization spend cap. Reserved is the sum of maximum charges
# already admitted and not yet settled for that organization and cycle.
type CreditMeter is Data:
  CMeter{organization: String, state: String, cycle: String, balance: String, unit: String, monthly_cap: String, cap_period: String, cycle_spent: String, reserved: String}

type CreditAdmission is Data:
  CAdmitted{organization: String, cycle: String, reserved_total: String, balance_after_reserve: String, cap_after_reserve: String}
  CRefused{reason: String}

def meter_organization(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: organization

def meter_state(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: state

def meter_cycle(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: cycle

def meter_balance(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: balance

def meter_unit(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: unit

def meter_monthly_cap(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: monthly_cap

def meter_cap_period(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: cap_period

def meter_cycle_spent(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: cycle_spent

def meter_reserved(meter: CreditMeter) -> String:
  match meter:
    case CMeter{organization,state,cycle,balance,unit,monthly_cap,cap_period,cycle_spent,reserved}: reserved

def credit_admission_admitted(admission: CreditAdmission) -> Bool:
  match admission:
    case CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}: True{}
    case CRefused{reason}: False{}

def credit_admission_reason(admission: CreditAdmission) -> String:
  match admission:
    case CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}: ""
    case CRefused{reason}: reason

def credit_admission_reserved_total(admission: CreditAdmission) -> String:
  match admission:
    case CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}: reserved_total
    case CRefused{reason}: ""

def credit_admission_balance_after(admission: CreditAdmission) -> String:
  match admission:
    case CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}: balance_after_reserve
    case CRefused{reason}: ""

def credit_admission_cap_after(admission: CreditAdmission) -> String:
  match admission:
    case CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}: cap_after_reserve
    case CRefused{reason}: ""

# Fail-closed admission for one provider request. Every fact must be present
# and current for its own clock before the bounded charge is reserved against
# both the promotional balance and the monthly cap. An admitted result carries
# the reservation totals the caller records; it does not start a request. The
# launch hold stays in account_binding until a caller wires this decision into
# the request path and that wiring is qualified.
def credit_request_admission(+account: AccountRecord, +meter: CreditMeter, +current_cycle: String, +current_cap_period: String, +max_charge: String) -> CreditAdmission:
  Bool.pick(CreditAdmission,Bool.not(Bool.and(String.eq(account_provider(account),"anthropic"),Bool.and(String.eq(account_harness(account),"claude-code"),String.eq(account_funding(account),"api_key")))),CRefused{"notPromotionalCreditRoute"},
  Bool.pick(CreditAdmission,Bool.or(String.is_empty(account_organization(account)),Bool.not(String.eq(account_organization(account),meter_organization(meter)))),CRefused{"organizationUnverified"},
  Bool.pick(CreditAdmission,Bool.not(String.eq(meter_state(meter),"reported")),CRefused{"creditObservationUnavailable"},
  Bool.pick(CreditAdmission,Bool.or(String.is_empty(meter_cycle(meter)),Bool.not(String.eq(meter_cycle(meter),current_cycle))),CRefused{"creditCycleMismatch"},
  Bool.pick(CreditAdmission,Bool.or(String.is_empty(meter_cap_period(meter)),Bool.not(String.eq(meter_cap_period(meter),current_cap_period))),CRefused{"monthlyCapPeriodMismatch"},
  Bool.pick(CreditAdmission,Bool.not(Bool.and(decimal_text(meter_balance(meter)),Bool.and(decimal_text(meter_monthly_cap(meter)),Bool.and(decimal_text(meter_cycle_spent(meter)),Bool.and(decimal_text(meter_reserved(meter)),Bool.and(decimal_text(max_charge),Bool.not(String.is_empty(meter_unit(meter))))))))),CRefused{"creditAmountMalformed"},
  Bool.pick(CreditAdmission,decimal_is_zero(max_charge),CRefused{"requestChargeUnbounded"},
  Bool.pick(CreditAdmission,decimal_is_gt(decimal_add(meter_reserved(meter),max_charge),meter_balance(meter)),CRefused{"promotionalCreditInsufficient"},
  Bool.pick(CreditAdmission,decimal_is_gt(decimal_add(decimal_add(meter_cycle_spent(meter),meter_reserved(meter)),max_charge),meter_monthly_cap(meter)),CRefused{"monthlyCapInsufficient"},
  CAdmitted{meter_organization(meter),meter_cycle(meter),decimal_add(meter_reserved(meter),max_charge),decimal_sub(meter_balance(meter),decimal_add(meter_reserved(meter),max_charge)),decimal_sub(meter_monthly_cap(meter),decimal_add(decimal_add(meter_cycle_spent(meter),meter_reserved(meter)),max_charge))})))))))))

def launch_binding(+harness: String, +funding: String, +secret_ref: String, helper: Maybe<String>) -> Maybe<List<String>>:
  Bool.pick(Maybe<List<String>>,Bool.and(String.eq(funding,"api_key"),Bool.not(String.eq(harness,"claude-code"))),None{},Bool.pick(Maybe<List<String>>,String.eq(funding,"api_key"),api_key_binding(secret_ref,helper),Some{Subs.store_binding(harness,secret_ref)}))

# The packaged resolver sits beside the resolved identity helper, so it is
# installed and versioned with the runtime this deployment resolves.
def api_key_helper(+helper: String) -> String:
  Bool.pick(String,String.is_empty(helper),"",Subs.directory_of(helper) ++ "/api-key-exec")

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
    case Some{+account}:
      match account:
        case Ac{id,provider,account_harness,funding,secret_ref,organization,verified_at}:
          match funding:
            case "api_key": Bool.pick(Maybe<List<String>>,Bool.and(String.eq(provider,"anthropic"),String.eq(account_harness,"claude-code")),None{},launch_binding(harness,"api_key",secret_ref,helper))
            case "subscription": Some{Subs.store_binding(harness,secret_ref)}
            case other: None{}

# --- the schema --------------------------------------------------------------

# account_attempts keys on the attempt directory the retained launch records, so
# an account row joins that attempt's own seed, execution and terminal rows.
def schema() -> String:
  "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL,provider TEXT NOT NULL,harness TEXT NOT NULL,funding TEXT NOT NULL CHECK(funding IN ('subscription','api_key')),secret_ref TEXT NOT NULL,organization TEXT NOT NULL DEFAULT '',verified_at TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS account_attempts (attempt TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL REFERENCES sessions(id),turn TEXT NOT NULL DEFAULT '',account TEXT NOT NULL REFERENCES accounts(id),organization TEXT NOT NULL DEFAULT '',funding TEXT NOT NULL,secret_ref TEXT NOT NULL,workload TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL DEFAULT '',error_text TEXT NOT NULL DEFAULT '',started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT NOT NULL DEFAULT '',predecessor TEXT NOT NULL DEFAULT '',recorded TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS credit_observations (id TEXT PRIMARY KEY NOT NULL,organization TEXT NOT NULL DEFAULT '',fact TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reported','unavailable')),balance TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',expires TEXT NOT NULL DEFAULT '',cycle TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',observed_at TEXT NOT NULL,authority TEXT NOT NULL);"
  ++ "CREATE INDEX IF NOT EXISTS credit_observations_pool ON credit_observations(organization,fact);"
  ++ "CREATE TABLE IF NOT EXISTS credit_authorizations (attempt TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL DEFAULT '',account TEXT NOT NULL DEFAULT '',organization TEXT NOT NULL DEFAULT '',cycle TEXT NOT NULL DEFAULT '',balance TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',secret_ref TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'authorized',consumed TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS credit_reservations (request TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL DEFAULT '',attempt TEXT NOT NULL DEFAULT '',account TEXT NOT NULL DEFAULT '',organization TEXT NOT NULL,cycle TEXT NOT NULL DEFAULT '',cap_period TEXT NOT NULL DEFAULT '',balance TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',max_charge TEXT NOT NULL DEFAULT '',balance_after TEXT NOT NULL DEFAULT '',cap_after TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled','failed')),actual_cost TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,settled_at TEXT NOT NULL DEFAULT '');"
  ++ "CREATE UNIQUE INDEX IF NOT EXISTS credit_reservations_active ON credit_reservations(organization,cycle,cap_period) WHERE state='reserved';"
  ++ "CREATE INDEX IF NOT EXISTS credit_reservations_org ON credit_reservations(organization,cap_period,state);"
  ++ "CREATE INDEX IF NOT EXISTS account_attempts_session ON account_attempts(session,recorded);"
  ++ "INSERT OR IGNORE INTO accounts(id,provider,harness,funding,secret_ref,organization,verified_at) SELECT 'claude-credit-primary',provider,harness,funding,secret_ref,organization,verified_at FROM accounts WHERE id='claude-credit-normal';"
  ++ "UPDATE account_attempts SET account='claude-credit-primary' WHERE account='claude-credit-normal';"
  ++ "UPDATE credit_reservations SET account='claude-credit-primary' WHERE account='claude-credit-normal';"
  ++ "UPDATE credit_authorizations SET account='claude-credit-primary' WHERE account='claude-credit-normal';"
  ++ "UPDATE OR IGNORE credit_observations SET id='claude-credit-primary:'||substr(id,length('claude-credit-normal:')+1) WHERE substr(id,1,length('claude-credit-normal:'))='claude-credit-normal:';"
  ++ "DELETE FROM accounts WHERE id='claude-credit-normal' AND NOT EXISTS(SELECT 1 FROM account_attempts WHERE account='claude-credit-normal');"

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

def auth_columns_missing(+db: String, columns: List<String>) -> IO(List<String>):
  match columns:
    case Nil{}: IO.pure(List<String>,Nil{})
    case +column <> rest: do IO<List<String>>:
      found : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM pragma_table_info('credit_authorizations') WHERE name=" ++ C.q(column) ++ ");"))
      missing : List<String> <- auth_columns_missing(db,rest)
      IO.pure(List<String>,attempt_columns_missing_kept(String.eq(Tx.trim_nl(found),"0"),column,missing))

def auth_columns_installed(+db: String, columns: List<String>) -> IO(Unit):
  match columns:
    case Nil{}: IO.pure(Unit,Unit{})
    case +column <> rest: do IO<Unit>:
      added : String <- IO.try(String,DB.Sql.query(db,"ALTER TABLE credit_authorizations ADD COLUMN " ++ column ++ " TEXT NOT NULL DEFAULT '';"))
      auth_columns_installed(db,rest)

def auth_columns_ensured(+db: String) -> IO(Unit):
  do IO<Unit>:
    missing : List<String> <- auth_columns_missing(db,["secret_ref","state","consumed"])
    auth_columns_installed(db,missing)

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

# --- the durable request reservation -----------------------------------------
# One retained launch is the request unit this runtime can observe. The guard
# reserves the whole lower bound that launch could consume: the smaller of the
# newest reported promotional balance and the unspent monthly ceiling after
# every recorded reservation for the organization. Settlement replaces the
# reserved bound with the actual cost when one is reported. A unique active
# reservation per organization, cycle and cap period serializes launches, and a
# repeated request returns its recorded decision without reserving again.
def credit_cycle_ceiling() -> String:
  "200"

type CreditObs is Data:
  CObs{state: String, balance: String, unit: String, cycle: String, expires: String}

type ReservationRow is Data:
  RRow{request: String, state: String, max_charge: String, actual_cost: String, cycle: String, cap_period: String}

type ReservationFull is Data:
  RFull{request: String, state: String, max_charge: String, actual_cost: String, organization: String, cycle: String, cap_period: String, balance: String, balance_after: String, cap_after: String}

def credit_observation_fields(fields: List<&2,String>) -> CreditObs:
  match fields:
    case state <> balance <> unit <> cycle <> expires <> rest:
      CObs{state,balance,unit,cycle,expires}
    case other: CObs{"unavailable","","","",""}

def credit_obs_cycle(observation: CreditObs) -> String:
  match observation:
    case CObs{state,balance,unit,cycle,expires}: cycle

def credit_obs_expires(observation: CreditObs) -> String:
  match observation:
    case CObs{state,balance,unit,cycle,expires}: expires

def credit_observation_sql(+organization: String) -> String:
  "SELECT state||char(31)||balance||char(31)||unit||char(31)||cycle||char(31)||expires FROM credit_observations WHERE organization=" ++ C.q(organization) ++ " AND fact='promotional_credit' ORDER BY observed_at DESC,rowid DESC LIMIT 1;"

def credit_conflict_sql(+organization: String, +cycle: String) -> String:
  "WITH latest AS (SELECT observed_at FROM credit_observations WHERE organization=" ++ C.q(organization) ++ " AND fact='promotional_credit' AND state='reported' ORDER BY observed_at DESC,rowid DESC LIMIT 1) SELECT count(DISTINCT balance) FROM credit_observations WHERE organization=" ++ C.q(organization) ++ " AND fact='promotional_credit' AND state='reported' AND balance<>'' AND cycle=" ++ C.q(cycle) ++ " AND observed_at=(SELECT observed_at FROM latest);"

def credit_conflict_ok(+text: String) -> Bool:
  Bool.or(String.eq(text,"0"),String.eq(text,"1"))

def credit_observed_spend_sql(+organization: String, +cap_period: String) -> String:
  "SELECT state||char(31)||balance||char(31)||unit FROM credit_observations WHERE organization=" ++ C.q(organization) ++ " AND fact='external_spend' AND cycle=" ++ C.q(cap_period) ++ " ORDER BY observed_at DESC,rowid DESC LIMIT 1;"

def expiry_digits(+text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head,tail}: Bool.and(digit_code(Char.to_u32(head)),expiry_digits(tail))

def expiry_valid(+text: String) -> Bool:
  Bool.and(Nat.is_eq(String.length(text),13n),expiry_digits(text))

# The observed expiry text is preserved exactly. Admission requires an exact
# 13-digit epoch millisecond boundary. A date-only or otherwise unverified
# expiry is retained but does not admit a request; no day is added.
def credit_expiry_deadline_sql(+expires: String) -> String:
  "SELECT CASE WHEN length(" ++ C.q(expires) ++ ")=13 AND " ++ C.q(expires) ++ " NOT GLOB '*[^0-9]*' THEN " ++ C.q(expires) ++ " ELSE '0' END;"

def expiry_deadline_reason(+deadline: String, +now_text: String) -> String:
  Bool.pick(String,Bool.or(String.is_empty(deadline),String.eq(deadline,"0")),"creditObservationExpiryUnverified",
    Bool.pick(String,expiry_valid(deadline),
      Bool.pick(String,String.is_gt(deadline,now_text),"","creditObservationExpired"),
      "creditObservationExpiryUnverified"))

def decimal_max(+a: String, +b: String) -> String:
  Bool.pick(String,decimal_is_gt(a,b),a,b)

def decimal_min(+a: String, +b: String) -> String:
  Bool.pick(String,decimal_is_gt(a,b),b,a)

def reservation_row_fields(fields: List<&2,String>) -> ReservationRow:
  match fields:
    case request <> state <> max_charge <> actual_cost <> cycle <> cap_period <> rest:
      RRow{request,state,max_charge,actual_cost,cycle,cap_period}
    case other: RRow{"","malformed","","","",""}

def reservation_rows_lines(lines: List<String>, acc: List<&2,ReservationRow>) -> List<&2,ReservationRow>:
  match lines:
    case Nil{}: acc
    case line <> rest:
      reservation_rows_lines(rest,Con{reservation_row_fields(String.split(Tx.trim_nl(line),Char.from_u32(31))),acc})

def reservation_rows(+text: String) -> List<&2,ReservationRow>:
  reservation_rows_lines(Tx.split_lines(text),Nil{})

def reservation_row_amount_valid(state: String, max_charge: String, +actual_cost: String) -> Bool:
  match state:
    case "reserved": decimal_text(max_charge)
    case "settled": decimal_text(actual_cost)
    case "failed": Bool.or(decimal_text(actual_cost),Bool.and(String.is_empty(actual_cost),decimal_text(max_charge)))
    case other: False{}

def reservation_row_valid(+row: ReservationRow) -> Bool:
  match row:
    case RRow{request,state,max_charge,actual_cost,cycle,cap_period}:
      Bool.and(Bool.not(String.is_empty(request)),Bool.and(Bool.not(String.is_empty(cycle)),Bool.and(Bool.not(String.is_empty(cap_period)),reservation_row_amount_valid(state,max_charge,actual_cost))))

def reservation_rows_valid(+rows: List<&2,ReservationRow>) -> Bool:
  match rows:
    case Nil{}: True{}
    case +row <> rest: Bool.and(reservation_row_valid(row),reservation_rows_valid(rest))

def reservation_row_spend(+row: ReservationRow) -> String:
  match row:
    case RRow{request,state,max_charge,+actual_cost,cycle,cap_period}:
      match state:
        case "reserved": max_charge
        case "settled": actual_cost
        case "failed": Bool.pick(String,String.is_empty(actual_cost),max_charge,actual_cost)
        case other: "malformed"

def reservation_spend_sum(+rows: List<&2,ReservationRow>, acc: String) -> String:
  match rows:
    case Nil{}: acc
    case +row <> rest: reservation_spend_sum(rest,decimal_add(acc,reservation_row_spend(row)))

def reservation_row_active(+row: ReservationRow) -> Bool:
  match row:
    case RRow{request,state,max_charge,actual_cost,cycle,cap_period}: String.eq(state,"reserved")

def reservation_rows_active(+rows: List<&2,ReservationRow>) -> Bool:
  match rows:
    case Nil{}: False{}
    case +row <> rest: Bool.or(reservation_row_active(row),reservation_rows_active(rest))

def reservation_row_in_cycle(+row: ReservationRow, +cycle: String) -> Bool:
  match row:
    case RRow{request,state,max_charge,actual_cost,row_cycle,cap_period}: String.eq(row_cycle,cycle)

def reservation_row_in_cap(+row: ReservationRow, +cap_period: String) -> Bool:
  match row:
    case RRow{request,state,max_charge,actual_cost,cycle,row_cap}: String.eq(row_cap,cap_period)

def reservation_spend_sum_cycle(+rows: List<&2,ReservationRow>, +cycle: String, +acc: String) -> String:
  match rows:
    case Nil{}: acc
    case +row <> rest:
      Bool.pick(String,reservation_row_in_cycle(row,cycle),
        reservation_spend_sum_cycle(rest,cycle,decimal_add(acc,reservation_row_spend(row))),
        reservation_spend_sum_cycle(rest,cycle,acc))

def reservation_spend_sum_cap(+rows: List<&2,ReservationRow>, +cap_period: String, +acc: String) -> String:
  match rows:
    case Nil{}: acc
    case +row <> rest:
      Bool.pick(String,reservation_row_in_cap(row,cap_period),
        reservation_spend_sum_cap(rest,cap_period,decimal_add(acc,reservation_row_spend(row))),
        reservation_spend_sum_cap(rest,cap_period,acc))

def spend_reason(+state: String, +balance: String, +unit: String) -> String:
  Bool.pick(String,Bool.or(String.is_empty(state),String.eq(state,"unavailable")),"",
    Bool.pick(String,String.eq(state,"reported"),
      Bool.pick(String,Bool.not(String.eq(unit,"USD")),"creditSpendUnitNotUSD",
        Bool.pick(String,Bool.not(decimal_text(balance)),"creditSpendMalformed","")),
      "creditSpendMalformed"))

def credit_cycle_spent(+ledger: String, +state: String, +balance: String) -> String:
  Bool.pick(String,String.eq(state,"reported"),decimal_max(ledger,balance),ledger)

def credit_reserve_arithmetic(+account: AccountRecord, +observation: CreditObs, +conflict: String, +grant_spend: String, +monthly_spend: String, +current_cap_period: String, +expiry_deadline: String, +now_text: String, +request_charge: String) -> CreditAdmission:
  match observation:
    case CObs{state,balance,unit,cycle,expires}:
      +available : String = Bool.pick(String,decimal_is_gt(grant_spend,balance),"0",decimal_sub(balance,grant_spend))
      +headroom : String = decimal_min(decimal_sub(credit_cycle_ceiling(),grant_spend),decimal_sub(credit_cycle_ceiling(),monthly_spend))
      +bound : String = Bool.pick(String,String.is_empty(request_charge),decimal_min(available,headroom),request_charge)
      Bool.pick(CreditAdmission,Bool.not(Bool.and(String.eq(account_provider(account),"anthropic"),Bool.and(String.eq(account_harness(account),"claude-code"),String.eq(account_funding(account),"api_key")))),CRefused{"notPromotionalCreditRoute"},
      Bool.pick(CreditAdmission,String.is_empty(account_organization(account)),CRefused{"organizationUnverified"},
      Bool.pick(CreditAdmission,Bool.not(String.eq(state,"reported")),CRefused{"creditObservationUnavailable"},
      Bool.pick(CreditAdmission,String.is_empty(cycle),CRefused{"creditCycleMissing"},
      Bool.pick(CreditAdmission,String.is_empty(current_cap_period),CRefused{"monthlyCapPeriodMismatch"},
      Bool.pick(CreditAdmission,Bool.not(String.is_empty(expiry_deadline_reason(expiry_deadline,now_text))),CRefused{expiry_deadline_reason(expiry_deadline,now_text)},
      Bool.pick(CreditAdmission,Bool.not(credit_conflict_ok(conflict)),CRefused{"creditReadingsConflict"},
      Bool.pick(CreditAdmission,Bool.not(String.eq(unit,"USD")),CRefused{"creditUnitNotUSD"},
      Bool.pick(CreditAdmission,Bool.not(decimal_text(balance)),CRefused{"creditAmountMalformed"},
      Bool.pick(CreditAdmission,decimal_is_gt(grant_spend,credit_cycle_ceiling()),CRefused{"creditGrantExhausted"},
      Bool.pick(CreditAdmission,decimal_is_gt(monthly_spend,credit_cycle_ceiling()),CRefused{"monthlyCapExhausted"},
      Bool.pick(CreditAdmission,decimal_is_zero(available),CRefused{"promotionalCreditExhausted"},
      Bool.pick(CreditAdmission,decimal_is_zero(decimal_sub(credit_cycle_ceiling(),monthly_spend)),CRefused{"monthlyCapExhausted"},
      Bool.pick(CreditAdmission,decimal_is_zero(decimal_sub(credit_cycle_ceiling(),grant_spend)),CRefused{"creditGrantExhausted"},
      Bool.pick(CreditAdmission,decimal_is_zero(bound),CRefused{"requestChargeUnbounded"},
      credit_request_admission(account,CMeter{account_organization(account),state,cycle,available,unit,credit_cycle_ceiling(),current_cap_period,decimal_max(grant_spend,monthly_spend),"0"},cycle,current_cap_period,bound))))))))))))))))

def credit_reserve_decided(+account: AccountRecord, +observation: CreditObs, +conflict: String, +rows: List<&2,ReservationRow>, +spend_state: String, +spend_balance: String, +spend_unit: String, +current_cap_period: String, +expiry_deadline: String, +now_text: String, +request_charge: String) -> CreditAdmission:
  Bool.pick(CreditAdmission,Bool.not(reservation_rows_valid(rows)),CRefused{"creditReservationLedgerMalformed"},
  Bool.pick(CreditAdmission,reservation_rows_active(rows),CRefused{"creditReservationInFlight"},
  Bool.pick(CreditAdmission,Bool.not(String.is_empty(spend_reason(spend_state,spend_balance,spend_unit))),CRefused{spend_reason(spend_state,spend_balance,spend_unit)},
  credit_reserve_arithmetic(account,observation,conflict,reservation_spend_sum_cycle(rows,credit_obs_cycle(observation),"0"),credit_cycle_spent(reservation_spend_sum_cap(rows,current_cap_period,"0"),spend_state,spend_balance),current_cap_period,expiry_deadline,now_text,request_charge))))

def credit_reserve_decision_fields(+account: AccountRecord, +observation: CreditObs, +conflict: String, +rows: List<&2,ReservationRow>, fields: List<&2,String>, +current_cap_period: String, +expiry_deadline: String, +now_text: String, +request_charge: String) -> CreditAdmission:
  match fields:
    case state <> balance <> unit <> rest:
      credit_reserve_decided(account,observation,conflict,rows,state,balance,unit,current_cap_period,expiry_deadline,now_text,request_charge)
    case other:
      credit_reserve_decided(account,observation,conflict,rows,"","","",current_cap_period,expiry_deadline,now_text,request_charge)

def reservation_request_sql(+request: String) -> String:
  "SELECT request||char(31)||state||char(31)||max_charge||char(31)||actual_cost||char(31)||organization||char(31)||cycle||char(31)||cap_period||char(31)||balance||char(31)||balance_after||char(31)||cap_after FROM credit_reservations WHERE request=" ++ C.q(request) ++ ";"

def active_reservation_sql(+organization: String, +cycle: String, +cap_period: String) -> String:
  "SELECT request FROM credit_reservations WHERE organization=" ++ C.q(organization) ++ " AND cycle=" ++ C.q(cycle) ++ " AND cap_period=" ++ C.q(cap_period) ++ " AND state='reserved' LIMIT 1;"

def reservation_full_fields(fields: List<&2,String>) -> ReservationFull:
  match fields:
    case request <> state <> max_charge <> actual_cost <> organization <> cycle <> cap_period <> balance <> balance_after <> cap_after <> rest:
      RFull{request,state,max_charge,actual_cost,organization,cycle,cap_period,balance,balance_after,cap_after}
    case other: RFull{"","absent","","","","","","","",""}

def credit_reservation_admission(row: ReservationFull) -> CreditAdmission:
  match row:
    case RFull{request,state,max_charge,actual_cost,organization,cycle,cap_period,balance,balance_after,cap_after}:
      match state:
        case "reserved": CAdmitted{organization,cycle,max_charge,balance_after,cap_after}
        case "settled": CRefused{"creditRequestSettled"}
        case "failed": CRefused{"creditRequestFailed"}
        case other: CRefused{"creditReservationLedgerMalformed"}

def credit_reservation_insert_sql(+session: String, +attempt: String, +account: AccountRecord, +current_cap_period: String, +balance: String, +unit: String, +decision: CreditAdmission) -> String:
  match decision:
    case CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}:
      "INSERT OR IGNORE INTO credit_reservations(request,session,attempt,account,organization,cycle,cap_period,balance,unit,max_charge,balance_after,cap_after,state) VALUES(" ++ C.q(attempt) ++ "," ++ C.q(session) ++ "," ++ C.q(attempt) ++ "," ++ C.q(account_id(account)) ++ "," ++ C.q(organization) ++ "," ++ C.q(cycle) ++ "," ++ C.q(current_cap_period) ++ "," ++ C.q(balance) ++ "," ++ C.q(unit) ++ "," ++ C.q(reserved_total) ++ "," ++ C.q(balance_after_reserve) ++ "," ++ C.q(cap_after_reserve) ++ ",'reserved');SELECT changes();"
    case CRefused{reason}: "SELECT 0;"

def credit_reserve_reread_fields(+db: String, +attempt: String, +organization: String, +cycle: String, +cap_period: String, fields: List<&2,String>) -> IO(CreditAdmission):
  match fields:
    case request <> state <> max_charge <> actual_cost <> row_organization <> row_cycle <> row_cap <> balance <> balance_after <> cap_after <> rest:
      IO.pure(CreditAdmission,credit_reservation_admission(RFull{request,state,max_charge,actual_cost,row_organization,row_cycle,row_cap,balance,balance_after,cap_after}))
    case other:
      do IO<CreditAdmission>:
        active : String <- IO.try(String,DB.Sql.read(db,active_reservation_sql(organization,cycle,cap_period)))
        IO.pure(CreditAdmission,Bool.pick(CreditAdmission,String.is_empty(Tx.trim_nl(active)),CRefused{"creditReservationConflict"},CRefused{"creditReservationInFlight"}))

def credit_reserve_reread(+db: String, +attempt: String, +organization: String, +cycle: String, +cap_period: String) -> IO(CreditAdmission):
  do IO<CreditAdmission>:
    existing : String <- IO.try(String,DB.Sql.read(db,reservation_request_sql(attempt)))
    +fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(existing),Char.from_u32(31)))
    credit_reserve_reread_fields(db,attempt,organization,cycle,cap_period,fields)

def credit_reserve_saved(+db: String, +attempt: String, +organization: String, +cycle: String, +cap_period: String, +decision: CreditAdmission, +changed: String) -> IO(CreditAdmission):
  match changed:
    case "1": IO.pure(CreditAdmission,decision)
    case other: credit_reserve_reread(db,attempt,organization,cycle,cap_period)

def credit_reserve_observed(+db: String, +session: String, +attempt: String, +account: AccountRecord, +current_cap_period: String, observed: CreditObs, +decision: CreditAdmission) -> IO(CreditAdmission):
  match observed:
    case CObs{state,balance,unit,cycle,expires}:
      do IO<CreditAdmission>:
        saved : String <- Bool.pick(IO(String),credit_admission_admitted(decision),IO.try(String,commit_read(db,credit_reservation_insert_sql(session,attempt,account,current_cap_period,balance,unit,decision))),IO.pure(String,"refused"))
        Bool.pick(IO(CreditAdmission),credit_admission_admitted(decision),credit_reserve_saved(db,attempt,account_organization(account),cycle,current_cap_period,decision,Tx.trim_nl(saved)),IO.pure(CreditAdmission,decision))

def credit_reserve_existing(+db: String, +session: String, +attempt: String, +account: AccountRecord, +current_cap_period: String, +request_charge: String, fields: List<&2,String>) -> IO(CreditAdmission):
  match fields:
    case request <> state <> max_charge <> actual_cost <> organization <> cycle <> cap_period <> balance <> balance_after <> cap_after <> rest:
      IO.pure(CreditAdmission,credit_reservation_admission(RFull{request,state,max_charge,actual_cost,organization,cycle,cap_period,balance,balance_after,cap_after}))
    case other:
      do IO<CreditAdmission>:
        observation : String <- IO.try(String,DB.Sql.read(db,credit_observation_sql(account_organization(account))))
        +observation_fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(observation),Char.from_u32(31)))
        +observed : CreditObs <- IO.pure(CreditObs,credit_observation_fields(observation_fields))
        conflict : String <- IO.try(String,DB.Sql.read(db,credit_conflict_sql(account_organization(account),credit_obs_cycle(observed))))
        rows : String <- IO.try(String,DB.Sql.read(db,"SELECT request||char(31)||state||char(31)||max_charge||char(31)||actual_cost||char(31)||cycle||char(31)||cap_period FROM credit_reservations WHERE organization=" ++ C.q(account_organization(account)) ++ " AND (cycle=" ++ C.q(credit_obs_cycle(observed)) ++ " OR cap_period=" ++ C.q(current_cap_period) ++ ") ORDER BY rowid;"))
        +reservations : List<&2,ReservationRow> <- IO.pure(List<&2,ReservationRow>,reservation_rows(rows))
        spend : String <- IO.try(String,DB.Sql.read(db,credit_observed_spend_sql(account_organization(account),current_cap_period)))
        +spend_fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(spend),Char.from_u32(31)))
        now_text : String <- IO.try(String,DB.Sql.read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000;"))
        deadline : String <- IO.try(String,DB.Sql.read(db,credit_expiry_deadline_sql(credit_obs_expires(observed))))
        +decision : CreditAdmission <- IO.pure(CreditAdmission,credit_reserve_decision_fields(account,observed,conflict,reservations,spend_fields,current_cap_period,Tx.trim_nl(deadline),Tx.trim_nl(now_text),request_charge))
        credit_reserve_observed(db,session,attempt,account,current_cap_period,observed,decision)

def credit_reserve_for(+db: String, +session: String, +attempt: String, +account: AccountRecord, +current_cap_period: String) -> IO(CreditAdmission):
  do IO<CreditAdmission>:
    ready : Unit <- ensure(db)
    existing : String <- IO.try(String,DB.Sql.read(db,reservation_request_sql(attempt)))
    +existing_fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(existing),Char.from_u32(31)))
    credit_reserve_existing(db,session,attempt,account,current_cap_period,"",existing_fields)

def credit_reserve_bounded_for(+db: String, +session: String, +attempt: String, +account: AccountRecord, +current_cap_period: String, +request_charge: String) -> IO(CreditAdmission):
  do IO<CreditAdmission>:
    ready : Unit <- ensure(db)
    existing : String <- IO.try(String,DB.Sql.read(db,reservation_request_sql(attempt)))
    +existing_fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(existing),Char.from_u32(31)))
    credit_reserve_existing(db,session,attempt,account,current_cap_period,request_charge,existing_fields)

def reserve_state_sql(+request: String) -> String:
  "SELECT state||char(31)||max_charge||char(31)||actual_cost FROM credit_reservations WHERE request=" ++ C.q(request) ++ ";"

def settle_state(+cost: String, +max_charge: String) -> String:
  Bool.pick(String,String.is_empty(cost),"failed",
    Bool.pick(String,decimal_text(cost),
      Bool.pick(String,decimal_is_gt(cost,max_charge),"failed","settled"),
      "failed"))

def settle_cost(+cost: String, +max_charge: String) -> String:
  Bool.pick(String,String.is_empty(cost),"",
    Bool.pick(String,decimal_text(cost),cost,""))

def credit_settle_sql(+request: String, +outcome: String, +state: String, +cost: String, allow_failed: Bool) -> String:
  "UPDATE credit_reservations SET state=" ++ C.q(state) ++ ",actual_cost=" ++ C.q(cost) ++ ",outcome=" ++ C.q(outcome) ++ ",settled_at=CURRENT_TIMESTAMP WHERE request=" ++ C.q(request) ++ " AND state IN ('reserved'" ++ Bool.pick(String,allow_failed,",'failed'","") ++ ");SELECT changes();"

def credit_settle_apply(+db: String, +request: String, +outcome: String, +cost: String, allow_failed: Bool, +max_charge: String) -> IO(String):
  do IO<String>:
    +state : String <- IO.pure(String,settle_state(cost,max_charge))
    +stored : String <- IO.pure(String,settle_cost(cost,max_charge))
    changed : String <- IO.try(String,commit_read(db,credit_settle_sql(request,outcome,state,stored,allow_failed)))
    IO.pure(String,Bool.pick(String,String.eq(Tx.trim_nl(changed),"1"),state,"unchanged"))

def credit_settle_decided(+db: String, +request: String, +outcome: String, +cost: String, +allow_failed: Bool, +current_state: String, +max_charge: String) -> IO(String):
  match current_state:
    case "reserved": credit_settle_apply(db,request,outcome,cost,allow_failed,max_charge)
    case "failed": Bool.pick(IO(String),allow_failed,credit_settle_apply(db,request,outcome,cost,allow_failed,max_charge),IO.pure(String,"already-failed"))
    case "settled": IO.pure(String,"already-settled")
    case other: IO.pure(String,"absent")

def credit_settle_fields(+db: String, +request: String, +outcome: String, +cost: String, allow_failed: Bool, fields: List<&2,String>) -> IO(String):
  match fields:
    case state <> max_charge <> actual_cost <> rest:
      credit_settle_decided(db,request,outcome,cost,allow_failed,state,max_charge)
    case other:
      IO.pure(String,"absent")

def credit_settle_for(+db: String, +request: String, +outcome: String, +cost: String, allow_failed: Bool) -> IO(String):
  do IO<String>:
    ready : Unit <- ensure(db)
    current : String <- IO.try(String,DB.Sql.read(db,reserve_state_sql(request)))
    +fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(current),Char.from_u32(31)))
    credit_settle_fields(db,request,outcome,cost,allow_failed,fields)

# --- request price -----------------------------------------------------------

# Prices are the Anthropic first-party USD list rates, held in nanos per token
# (one USD per million tokens is 1000 nanos per token). The host transport
# supplies upper bounds for the request tokens and the request flags; this
# function is the whole pricing policy.
type CreditRequestFacts is Data:
  CRF{model: String, input_tokens: String, output_tokens: String, cache_5m: String, cache_1h: String, cache_hit: String, geo: String, fast_mode: Bool, server_actions: String, tools: Bool}

type CreditRequestPrice is Data:
  Priced{max_charge: String}
  PriceRefused{reason: String}

type CreditRates is Data:
  Rates{base_in: Nat, base_out: Nat, cache_5m: Nat, cache_1h: Nat, cache_hit_rate: Nat, tool_tokens: Nat, fast_allowed: Bool, fast_in: Nat, fast_out: Nat}

def rates_opus() -> CreditRates:
  Rates{4000n,20000n,5000n,8000n,200n,406n,True{},8000n,40000n}

def rates_sonnet() -> CreditRates:
  Rates{2000n,10000n,2500n,4000n,100n,286n,False{},0n,0n}

def rates_haiku_low() -> CreditRates:
  Rates{100n,500n,125n,200n,10n,406n,False{},0n,0n}

def rates_haiku_high() -> CreditRates:
  Rates{500n,2500n,625n,1000n,50n,406n,False{},0n,0n}

def credit_rates_for(+model: String, +prompt: Nat) -> Maybe<&2,CreditRates>:
  Bool.pick(Maybe<&2,CreditRates>,String.eq(model,"claude-opus-5-5"),Some{rates_opus()},
    Bool.pick(Maybe<&2,CreditRates>,String.eq(model,"claude-sonnet-5-5"),Some{rates_sonnet()},
      Bool.pick(Maybe<&2,CreditRates>,String.eq(model,"claude-haiku-5-5"),
        Bool.pick(Maybe<&2,CreditRates>,Nat.is_lt(100000n,prompt),Some{rates_haiku_high()},Some{rates_haiku_low()}),
        None{})))

def credit_pad9(+text: String) -> String:
  String.repeat("0",Nat.sub(9n,String.length(text))) ++ text

def credit_nanos_usd(+nanos: Nat) -> String:
  Nat.show(Nat.div(nanos,1000000000n)) ++ "." ++ credit_pad9(Nat.show(Nat.mod(nanos,1000000000n)))

def credit_price_billed(+nanos: Nat, +premium: Bool) -> Nat:
  match premium:
    case True{}: Nat.div(Nat.add(Nat.mul(nanos,11n),9n),10n)
    case False{}: nanos

def credit_price_priced(+base_in: Nat, +base_out: Nat, +cache_5m: Nat, +cache_1h: Nat, +cache_hit_rate: Nat, +tool_tokens: Nat, +fast_in: Nat, +fast_out: Nat, +i: Nat, +o: Nat, +w5: Nat, +w1: Nat, +h: Nat, +fast: Bool, +premium: Bool, +tools: Bool) -> CreditRequestPrice:
  in_rate = Bool.pick(Nat,fast,fast_in,base_in)
  out_rate = Bool.pick(Nat,fast,fast_out,base_out)
  w5_rate = Bool.pick(Nat,fast,Nat.div(Nat.mul(fast_in,5n),4n),cache_5m)
  w1_rate = Bool.pick(Nat,fast,Nat.mul(fast_in,2n),cache_1h)
  hit_rate = Bool.pick(Nat,fast,Nat.div(Nat.mul(fast_in,5n),100n),cache_hit_rate)
  i2 = Bool.pick(Nat,tools,Nat.add(i,tool_tokens),i)
  nanos = Nat.add(Nat.mul(i2,in_rate),Nat.add(Nat.mul(o,out_rate),Nat.add(Nat.mul(w5,w5_rate),Nat.add(Nat.mul(w1,w1_rate),Nat.mul(h,hit_rate)))))
  billed = credit_price_billed(nanos,premium)
  Priced{credit_nanos_usd(billed)}

def credit_price_compute(+rates: CreditRates, +i: Nat, +o: Nat, +w5: Nat, +w1: Nat, +h: Nat, +fast: Bool, +premium: Bool, +tools: Bool) -> CreditRequestPrice:
  match rates:
    case Rates{base_in,base_out,cache_5m,cache_1h,cache_hit_rate,tool_tokens,fast_allowed,fast_in,fast_out}:
      Bool.pick(CreditRequestPrice,Bool.and(fast,Bool.not(fast_allowed)),PriceRefused{"creditFastModeUnpriced"},
        credit_price_priced(base_in,base_out,cache_5m,cache_1h,cache_hit_rate,tool_tokens,fast_in,fast_out,i,o,w5,w1,h,fast,premium,tools))

def credit_price_rates_decided(+known: Maybe<&2,CreditRates>, +i: Nat, +o: Nat, +w5: Nat, +w1: Nat, +h: Nat, +fast: Bool, +premium: Bool, +tools: Bool) -> CreditRequestPrice:
  match known:
    case Some{+rates}: credit_price_compute(rates,i,o,w5,w1,h,fast,premium,tools)
    case None{}: PriceRefused{"creditModelUnpriced"}

def credit_price_rates(+model: String, +i: Nat, +o: Nat, +w5: Nat, +w1: Nat, +h: Nat, +fast: Bool, +premium: Bool, +tools: Bool) -> CreditRequestPrice:
  prompt = Nat.add(i,Nat.add(w5,Nat.add(w1,h)))
  credit_price_rates_decided(credit_rates_for(model,prompt),i,o,w5,w1,h,fast,premium,tools)

def credit_price_tokens_decided(+input: Maybe<&2,Nat>, +output: Maybe<&2,Nat>, +cache_5m: Maybe<&2,Nat>, +cache_1h: Maybe<&2,Nat>, +cache_hit: Maybe<&2,Nat>, +model: String, +fast: Bool, +premium: Bool, +tools: Bool) -> CreditRequestPrice:
  match input:
    case Some{+i}:
      match output:
        case Some{+o}:
          match cache_5m:
            case Some{+w5}:
              match cache_1h:
                case Some{+w1}:
                  match cache_hit:
                    case Some{+h}: credit_price_rates(model,i,o,w5,w1,h,fast,premium,tools)
                    case None{}: PriceRefused{"creditRequestMalformed"}
                case None{}: PriceRefused{"creditRequestMalformed"}
            case None{}: PriceRefused{"creditRequestMalformed"}
        case None{}: PriceRefused{"creditRequestMalformed"}
    case None{}: PriceRefused{"creditRequestMalformed"}

def credit_price_tokens(+model: String, +input: String, +output: String, +cache_5m: String, +cache_1h: String, +cache_hit: String, +fast: Bool, +premium: Bool, +tools: Bool) -> CreditRequestPrice:
  credit_price_tokens_decided(Nat.read(input),Nat.read(output),Nat.read(cache_5m),Nat.read(cache_1h),Nat.read(cache_hit),model,fast,premium,tools)

def credit_price_geo(+model: String, +input: String, +output: String, +cache_5m: String, +cache_1h: String, +cache_hit: String, +geo: String, +fast: Bool, +tools: Bool) -> CreditRequestPrice:
  Bool.pick(CreditRequestPrice,Bool.or(String.is_empty(geo),String.eq(geo,"global")),
    credit_price_tokens(model,input,output,cache_5m,cache_1h,cache_hit,fast,False{},tools),
    Bool.pick(CreditRequestPrice,String.eq(geo,"us"),
      credit_price_tokens(model,input,output,cache_5m,cache_1h,cache_hit,fast,True{},tools),
      PriceRefused{"creditResidencyUnpriced"}))

def credit_request_price_server(+actions: Maybe<&2,Nat>, +model: String, +input: String, +output: String, +cache_5m: String, +cache_1h: String, +cache_hit: String, +geo: String, +fast: Bool, +tools: Bool) -> CreditRequestPrice:
  match actions:
    case Some{+count}:
      Bool.pick(CreditRequestPrice,Nat.is_eq(count,0n),
        credit_price_geo(model,input,output,cache_5m,cache_1h,cache_hit,geo,fast,tools),
        PriceRefused{"creditServerToolUnpriced"})
    case None{}: PriceRefused{"creditRequestMalformed"}

def credit_request_price(+facts: CreditRequestFacts) -> CreditRequestPrice:
  match facts:
    case CRF{model,input_tokens,output_tokens,cache_5m,cache_1h,cache_hit,geo,fast_mode,server_actions,tools}:
      credit_request_price_server(Nat.read(server_actions),model,input_tokens,output_tokens,cache_5m,cache_1h,cache_hit,geo,fast_mode,tools)

# The actual Anthropic Messages request body supplies the price facts. The host
# transport passes the body unchanged; this reader takes the model, the output
# bound, a byte upper bound for input, cache-control presence, geography, fast
# mode and tool flags. The byte length is an upper bound on the request's token
# count; the policy prices it conservatively.
def credit_request_facts_sql(+body: String) -> String:
  +b = C.q(body)
  "WITH frame(value) AS (VALUES(" ++ b ++ ")), facts(model,input,output,cache5,cache1,cachehit,geo,fast,server,tools) AS (SELECT coalesce(json_extract(value,'$.model'),''),coalesce(CAST(json_extract(value,'$.max_tokens') AS TEXT),''),CAST(length(CAST(value AS BLOB)) AS TEXT),CASE WHEN EXISTS(SELECT 1 FROM json_tree(frame.value) WHERE key='cache_control') THEN CAST(length(CAST(value AS BLOB)) AS TEXT) ELSE '0' END,CASE WHEN EXISTS(SELECT 1 FROM json_tree(frame.value) WHERE key='ttl' AND value='1h') THEN CAST(length(CAST(value AS BLOB)) AS TEXT) ELSE '0' END,'0',coalesce(json_extract(value,'$.inference_geo'),'global'),CASE WHEN json_extract(value,'$.speed')='fast' OR json_extract(value,'$.fast')=1 THEN '1' ELSE '0' END,CASE WHEN EXISTS(SELECT 1 FROM json_tree(frame.value) WHERE key='type' AND (value LIKE 'web_search%' OR value LIKE 'web_fetch%' OR value LIKE 'code_execution%' OR value LIKE 'computer%' OR value LIKE 'bash%')) THEN '1' ELSE '0' END,CASE WHEN json_type(value,'$.tools')='array' AND json_array_length(value,'$.tools')>0 THEN '1' ELSE '0' END FROM frame WHERE json_valid(value)) SELECT model||char(31)||input||char(31)||output||char(31)||cache5||char(31)||cache1||char(31)||cachehit||char(31)||geo||char(31)||fast||char(31)||server||char(31)||tools FROM facts;"

def credit_request_facts_fields(fields: List<&2,String>) -> CreditRequestFacts:
  match fields:
    case model <> input <> output <> cache5 <> cache1 <> cachehit <> geo <> fast <> server <> tools <> rest:
      CRF{model,input,output,cache5,cache1,cachehit,geo,String.eq(fast,"1"),server,String.eq(tools,"1")}
    case other:
      CRF{"","","","","","","global",False{},"0",False{}}

def credit_request_facts_for(+db: String, +body: String) -> IO(CreditRequestFacts):
  do IO<CreditRequestFacts>:
    ready : Unit <- ensure(db)
    text : String <- IO.try(String,DB.Sql.read(db,credit_request_facts_sql(body)))
    +fields : List<&2,String> <- IO.pure(List<&2,String>,String.split(Tx.trim_nl(text),Char.from_u32(31)))
    IO.pure(CreditRequestFacts,credit_request_facts_fields(fields))

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

# Continue past an account whose provider has already reported a current quota
# hold. Unknown and elapsed observations leave the configured account selectable.
def gate_held(gate: UW.Gate) -> Bool:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: True{}
    case other: False{}

def account_candidates_after(accounts: List<&2,AccountRecord>, +harness: String, +current: String, seen: Bool) -> List<&2,AccountRecord>:
  match accounts:
    case Nil{}: Nil{}
    case +account <> +rest:
      match seen:
        case True{}: Bool.pick(List<&2,AccountRecord>,account_matches(harness,"",account),Con{account,account_candidates_after(rest,harness,current,True{})},account_candidates_after(rest,harness,current,True{}))
        case False{}: account_candidates_after(rest,harness,current,String.eq(account_id(account),current))

def first_account_available(+db: String, +session: String, accounts: List<&2,AccountRecord>) -> IO(Maybe<&2,AccountRecord>):
  match accounts:
    case Nil{}: IO.pure(Maybe<&2,AccountRecord>,None{})
    case +account <> +rest: do IO<Maybe<&2,AccountRecord>>:
      gate : UW.Gate <- UW.window_gate(db,session,account_id(account))
      Bool.pick(IO(Maybe<&2,AccountRecord>),gate_held(gate),first_account_available(db,session,rest),IO.pure(Maybe<&2,AccountRecord>,Some{account}))

def next_account_available(db: String, session: String, accounts: List<&2,AccountRecord>, harness: String, current: String) -> IO(Maybe<&2,AccountRecord>):
  first_account_available(db,session,account_candidates_after(accounts,harness,current,False{}))

def account_handoff_body(+harness: String, +refused: String, +bound: String, +cause: String) -> String:
  "account handoff: harness=" ++ harness ++ "; refused account=" ++ refused ++ "; bound account=" ++ bound ++ "; original cause: " ++ cause

def account_exhausted_body(+harness: String, +refused: String, +cause: String) -> String:
  "accounts exhausted: harness=" ++ harness ++ "; account=" ++ refused ++ " reported usage exhaustion and no later selectable operator-recorded account remains for this harness; cause: " ++ cause

def account_history_needed(+refused: AccountRecord, +next: AccountRecord) -> Bool:
  Bool.and(String.eq(account_funding(refused),"subscription"),Bool.and(String.eq(account_funding(next),"subscription"),Bool.not(String.eq(account_secret_ref(refused),account_secret_ref(next)))))

def advance_append_observed(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +next: AccountRecord, +cause: String, appended: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match appended:
    case Done{unit}: do IO<Bool>:
      noted : Unit <- Subs.report_body(db,session,id,"account-handoff-" ++ account_id(next),account_handoff_body(harness,account_id(refused),account_id(next),cause))
      IO.pure(Bool,True{})
    case Fail{(code,detail)}: do IO<Bool>:
      noted : Unit <- Subs.report_body(db,session,id,"account-append-failed","account record append failed: " ++ U32.show(code) ++ ": " ++ detail ++ "; the provider cause stands and no account was advanced.")
      IO.pure(Bool,False{})

def advance_account_append(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +next: AccountRecord, +cause: String) -> IO(Bool):
  do IO<Bool>:
    path : String <- account_sidecar(db,session)
    appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(Tx.trim_nl(path),account_id(next) ++ "\n")
    advance_append_observed(db,session,id,harness,refused,next,cause,appended)

def advance_account_decided(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +cause: String, native: String, cmd: String, cwd: String, decided: Maybe<&2,AccountRecord>) -> IO(Bool):
  match decided:
    case None{}: do IO<Bool>:
      noted : Unit <- Subs.report_account_exhausted(db,session,id,account_id(refused),account_exhausted_body(harness,account_id(refused),cause))
      IO.pure(Bool,False{})
    case Some{+next}: do IO<Bool>:
      prepared : Bool <- Bool.pick(IO(Bool),account_history_needed(refused,next),Subs.prepare_account_history(db,session,id,harness,account_secret_ref(refused),account_secret_ref(next),cmd,cwd,native),IO.pure(Bool,True{}))
      Bool.pick(IO(Bool),prepared,advance_account_append(db,session,id,harness,refused,next,cause),IO.pure(Bool,False{}))

def advance_account(+db: String, +session: String, +id: String, +harness: String, +refused: AccountRecord, +cause: String, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    rows : String <- IO.try(String,DB.Sql.read(db,account_row_sql()))
    +accounts : List<&2,AccountRecord> <- IO.pure(List<&2,AccountRecord>,account_lines(Tx.split_lines(rows),Nil{}))
    +decided : Maybe<&2,AccountRecord> <- next_account_available(db,session,accounts,harness,account_id(refused))
    advanced : Bool <- advance_account_decided(db,session,id,harness,refused,cause,native,cmd,cwd,decided)
    IO.pure(Bool,advanced)

def handoff_decided(+db: String, +session: String, +id: String, +event: String, native: String, cmd: String, cwd: String, +cause: String, +harness: String, bound: Maybe<&2,AccountRecord>) -> IO(Bool):
  match bound:
    case None{}: Subs.profile_handoff(db,session,id,event,native,cmd,cwd)
    case Some{+refused}: Bool.pick(IO(Bool),String.is_empty(cause),IO.pure(Bool,False{}),advance_account(db,session,id,harness,refused,cause,native,cmd,cwd))

# The account label in force: the bound account's own label, or the operator's
# profile label when no account record exists. The handoff's usage-window record
# and the wake gate both read this one value, so the reported reset and the
# refusal to retry before it name the same account.
def label_for_bound(+db: String, +session: String, +bound: Maybe<&2,AccountRecord>) -> IO(String):
  match bound:
    case Some{+account}: IO.pure(String,account_id(account))
    case None{}: Subs.profile_label_io(db,session)

def handoff_label_io(+db: String, +session: String) -> IO(String):
  do IO<String>:
    +harness_text : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +harness : String <- IO.pure(String,Tx.trim_nl(harness_text))
    bound : Maybe<&2,AccountRecord> <- bound_account(db,session,harness)
    label : String <- label_for_bound(db,session,bound)
    IO.pure(String,label)

# Provider-reported exhaustion advances the account in force when a binding
# put one in force, and the operator's profile list otherwise. The usage-window
# observation is recorded before any advance, under the refused account label,
# so the provider reset survives even when the advance fails. For two
# subscription accounts with distinct credential stores, the native-history
# helper materializes the next store before the sidecar records the advance.
# The advance is recorded before the caller relaunches, so the next attempt
# records the next account beside its own attempt identity. An empty cause
# records nothing.
def handoff(+db: String, +session: String, +id: String, +event: String, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    +cause : String <- Subs.exhaustion_cause(db,event)
    +harness_text : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +harness : String <- IO.pure(String,Tx.trim_nl(harness_text))
    +bound : Maybe<&2,AccountRecord> <- bound_account(db,session,harness)
    +label : String <- label_for_bound(db,session,bound)
    recorded : Unit <- Bool.pick(IO(Unit),String.is_empty(cause),IO.pure(Unit,Unit{}),UW.record_cause(db,session,id,label,cause))
    advanced : Bool <- handoff_decided(db,session,id,event,native,cmd,cwd,cause,harness,bound)
    +next_label : String <- handoff_label_io(db,session)
    gate : UW.Gate <- UW.window_gate(db,session,next_label)
    held : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(cause)),gate_held(gate)))
    IO.pure(Bool,Bool.and(advanced,Bool.not(held)))

# --- the account selected for each attempt -----------------------------------

def attempt_insert_sql(+session: String, +attempt: String, +predecessor: String, +account: AccountRecord) -> String:
  "INSERT OR REPLACE INTO account_attempts(attempt,session,turn,account,organization,funding,secret_ref,workload,started_at,recorded,predecessor) SELECT " ++ C.q(attempt) ++ "," ++ C.q(session) ++ ",coalesce((SELECT id FROM executions WHERE session=" ++ C.q(session) ++ " AND directory=" ++ C.q(attempt) ++ "),'')," ++ C.q(account_id(account)) ++ "," ++ C.q(account_organization(account)) ++ "," ++ C.q(account_funding(account)) ++ "," ++ C.q(account_secret_ref(account)) ++ ",CASE WHEN " ++ C.q(account_funding(account)) ++ "='api_key' THEN 'agent-sdk' WHEN " ++ C.q(account_harness(account)) ++ "='claude-code' THEN 'subscription' ELSE " ++ C.q(account_harness(account)) ++ " END,CAST(strftime('%s','now') AS INTEGER),CURRENT_TIMESTAMP," ++ C.q(predecessor) ++ ";"
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
    settled : String <- credit_settle_for(db,attempt,outcome,"",False{})
    IO.print(Tx.trim_nl(saved))

# The cumulative total_cost_usd is read from a valid Claude result frame at the
# root object. The raw text is scanned at object depth to find the one root
# total_cost_usd key; a nested same-named key is ignored and a duplicate root
# key is refused as ambiguous. The exact decimal token is taken whole, so 1e2,
# malformed, non-result and non-number values yield unknown cost; the
# observation text is unchanged and a missing token keeps the bound counted.
def credit_result_cost_sql(+event: String) -> String:
  +e : String = C.q(event)
  +k : String = "'\"total_cost_usd\"'"
  +ws : String = "' '||char(9)||char(10)||char(13)"
  "WITH RECURSIVE v0(e) AS (SELECT " ++ e ++ "), v(e,ok) AS (SELECT e,CASE WHEN json_valid(e) THEN CASE WHEN json_type(e)='object' AND (SELECT count(*) FROM json_tree(e) WHERE path='$' AND key='type')=1 AND (SELECT value FROM json_tree(e) WHERE path='$' AND key='type')='result' AND (SELECT count(*) FROM json_tree(e) WHERE path='$' AND key='total_cost_usd')=1 AND (SELECT type FROM json_tree(e) WHERE path='$' AND key='total_cost_usd') IN ('integer','real') THEN 1 ELSE 0 END ELSE 0 END FROM v0), "
  ++ "pos(i,ch,in_str,esc,depth) AS (SELECT 1,substr(e,1,1),0,0,0 FROM v UNION ALL SELECT i+1,substr(e,i+1,1),CASE WHEN in_str=1 AND esc=1 THEN 1 WHEN in_str=1 AND ch='\"' THEN 0 WHEN in_str=0 AND ch='\"' THEN 1 ELSE in_str END,CASE WHEN in_str=1 AND esc=1 THEN 0 WHEN in_str=1 AND ch='\\' THEN 1 ELSE 0 END,depth + CASE WHEN in_str=0 AND ch='{' THEN 1 WHEN in_str=0 AND ch='[' THEN 1 WHEN in_str=0 AND ch='}' THEN -1 WHEN in_str=0 AND ch=']' THEN -1 ELSE 0 END FROM pos,v WHERE i<length(e)), "
  ++ "keys(i) AS (SELECT i FROM pos,v WHERE ok=1 AND in_str=0 AND depth=1 AND substr(v.e,i,length(" ++ k ++ "))=" ++ k ++ " AND substr(ltrim(substr(v.e,i+length(" ++ k ++ "))," ++ ws ++ "),1,1)=':'), "
  ++ "t(s) AS (SELECT CASE WHEN (SELECT count(*) FROM keys)=1 AND substr(ltrim(substr(v.e,(SELECT i FROM keys)+length(" ++ k ++ "))," ++ ws ++ "),1,1)=':' THEN ltrim(substr(ltrim(substr(v.e,(SELECT i FROM keys)+length(" ++ k ++ "))," ++ ws ++ "),2)," ++ ws ++ ") ELSE '' END FROM v), "
  ++ "scan(s,n) AS (SELECT s,0 FROM t UNION ALL SELECT s,n+1 FROM scan WHERE n<length(s) AND substr(s,n+1,1) GLOB '[0-9.]') "
  ++ "SELECT CASE WHEN s='' OR n=0 THEN '' WHEN n=length(s) OR instr(','||'}'||char(9)||char(10)||char(13)||' ',substr(s,n+1,1))>0 THEN substr(s,1,n) ELSE '' END FROM scan ORDER BY n DESC LIMIT 1;"

def credit_result_cost_io(+db: String, +event: String) -> IO(String):
  do IO<String>:
    cost : String <- IO.try(String,DB.Sql.read(db,credit_result_cost_sql(event)))
    +text : String <- IO.pure(String,Tx.trim_nl(cost))
    IO.pure(String,Bool.pick(String,decimal_text(text),text,""))


def attempt_completed_event(+db: String, +attempt: String, +outcome: String, +error_text: String, +event: String) -> IO(Unit):
  do IO<Unit>:
    cost : String <- credit_result_cost_io(db,event)
    saved : String <- IO.try(String,commit_read(db,attempt_completed_sql(attempt,outcome,error_text)))
    settled : String <- credit_settle_for(db,attempt,outcome,cost,False{})
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

# An external spend reading is the provider's Admin cost report for one
# organization and cap period. It is recorded as a numeric observation so the
# reservation guard can reconcile its own ledger against the provider's report.
def import_spend_insert_sql(+authority: String, +account: String, +organization: String, +detail: String) -> String:
  "INSERT OR IGNORE INTO credit_observations(id,organization,fact,state,balance,unit,expires,cycle,source,detail,observed_at,authority) SELECT " ++ import_id_sql(account,detail) ++ "," ++ C.q(organization) ++ ",'external_spend',coalesce(json_extract(" ++ C.q(detail) ++ ",'$.state'),'reported'),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.balance'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.unit'),'USD'),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.expires'),''),coalesce(json_extract(" ++ C.q(detail) ++ ",'$.cycle'),''),coalesce(nullif(json_extract(" ++ C.q(detail) ++ ",'$.source'),''),'unsourcedObservation')," ++ C.q(detail) ++ "," ++ observe_observed_at(detail) ++ "," ++ C.q(authority) ++ ";"
  ++ "SELECT json_object('observation',(SELECT " ++ observation_object_sql() ++ " FROM credit_observations WHERE id=" ++ import_id_sql(account,detail) ++ "));"

def import_spend_admitted(+db: String, +authority: String, +account: String, +organization: String, +detail: String, present: Bool) -> IO(Unit):
  match present:
    case False{}: IO.die(Unit,2,"A spend import requires a JSON document, a recorded account whose verified organization is the imported organization, a fact of external_spend, a state of reported, a canonical USD balance, a named source and a cycle. No reading was recorded.")
    case True{}: do IO<Unit>:
      +saved : String <- IO.try(String,commit_read(db,import_spend_insert_sql(authority,account,organization,detail)))
      IO.print(Tx.trim_nl(saved))

def import_spend_selected(+db: String, +authority: String, +account: String, +organization: String, +detail: String, fact: String, +state: String, balance: String, unit: String, source: String, valid_json: Bool) -> IO(Unit):
  do IO<Unit>:
    verified : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM accounts WHERE id=" ++ C.q(account) ++ " AND organization=" ++ C.q(organization) ++ " AND organization<>'');"))
    reported : Bool <- IO.pure(Bool,Bool.and(decimal_text(balance),Bool.and(String.eq(unit,"USD"),Bool.not(String.is_empty(source)))))
    admitted : Bool <- IO.pure(Bool,Bool.and(valid_json,Bool.and(String.eq(fact,"external_spend"),Bool.and(String.eq(state,"reported"),Bool.and(String.eq(Tx.trim_nl(verified),"1"),reported)))))
    import_spend_admitted(db,authority,account,organization,detail,admitted)

def import_spend_fields(+db: String, +authority: String, +account: String, +organization: String, +detail: String, fields: List<&2,String>) -> IO(Unit):
  match fields:
    case valid <> fact <> state <> balance <> unit <> source <> rest: import_spend_selected(db,authority,account,organization,detail,fact,state,balance,unit,source,String.eq(valid,"1"))
    case other: import_spend_admitted(db,authority,account,organization,detail,False{})

def import_spend(+db: String, +authority: String, +account: String, +organization: String, +detail: String) -> IO(Unit):
  do IO<Unit>:
    +fields : String <- IO.try(String,DB.Sql.read(db,import_fields_sql(detail)))
    returned : Unit <- import_spend_fields(db,authority,account,organization,detail,String.split(Tx.trim_nl(fields),Char.from_u32(31)))
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
  ++ " (SELECT coalesce(json_group_array(json_object('fact',r.fact,'state',r.state,'balance',r.balance,'unit',r.unit,'expires',r.expires,'cycle',r.cycle,'source',r.source,'observedAt',r.observed_at,'previous',CASE WHEN r.state='unavailable' THEN (SELECT json_object('balance',p.balance,'unit',p.unit,'cycle',p.cycle,'observedAt',p.observed_at,'source',p.source) FROM credit_observations p WHERE p.organization=r.organization AND p.fact=r.fact AND p.state='reported' ORDER BY p.observed_at DESC,p.rowid DESC LIMIT 1) END,'conflict',json(CASE WHEN (SELECT count(DISTINCT balance) FROM credit_observations WHERE organization=r.organization AND fact=r.fact AND state='reported' AND balance<>'' AND cycle=r.cycle AND observed_at=r.observed_at)>1 THEN 'true' ELSE 'false' END),'readings',(SELECT coalesce(json_group_array(json_object('balance',balance,'unit',unit,'source',source,'observedAt',observed_at,'authority',authority)),json('[]')) FROM (SELECT DISTINCT balance,unit,source,observed_at,authority FROM credit_observations WHERE organization=r.organization AND fact=r.fact AND state='reported' AND balance<>'' AND cycle=r.cycle)))),json('[]')) FROM ranked r WHERE r.rank=1 AND r.organization=o.organization) AS facts,"
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
  IO.die(Unit,2,"Unknown account action " ++ action ++ ". Use record, read, bind, attempts, select, pool, observe, import-credit, import-spend or reconcile.")

# The verb's argv carries one action and the eight named options in a fixed
# order: action, id, provider, harness, funding, secret-ref, organization,
# detail, session. Each action reads the options it names.
def reconcile_cost_sql(+detail: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(detail) ++ ") THEN coalesce(json_extract(" ++ C.q(detail) ++ ",'$.cost'),'') ELSE '' END;"

def reconcile_action(+db: String, +request: String, +detail: String) -> IO(Unit):
  do IO<Unit>:
    +cost : String <- IO.try(String,DB.Sql.read(db,reconcile_cost_sql(detail)))
    state : String <- credit_settle_for(db,request,"reconciled",Tx.trim_nl(cost),True{})
    IO.print(state)

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
      Bool.pick(IO(Unit),String.eq(action,"import-spend"),import_spend(db,authority_of(session),id,organization,detail),
      Bool.pick(IO(Unit),String.eq(action,"reconcile"),reconcile_action(db,id,detail),
      unknown_action(action)))))))))))
    IO.pure(Unit,Unit{})

# The launch path records the account and funding route for the attempt it is
# about to start. A session with no account in force records nothing and keeps
# its existing profile binding.
def record_current_attempt(+db: String, +session: String, +attempt: String, +predecessor: String, chosen: Maybe<&2,AccountRecord>) -> IO(Unit):
  match chosen:
    case None{}: IO.pure(Unit,Unit{})
    case Some{+account}: record_attempt(db,session,attempt,predecessor,account)

# --- the credit-only route status recorded in the database -------------------
# Eligibility reads actual recorded facts: the Anthropic claude-code api_key
# route, a verified organization, and the newest promotional_credit
# observation for that organization with its reported balance and unit. A
# reported zero balance is the provider-reported exhausted state. A retained
# launch contains an unbounded number of provider requests. A reported balance
# does not prove that the provider will refuse billed usage. No charge bound is
# derived and no reservation or settled amount is recorded from a launch.
# Actual provider cost enters through external_spend observations from the
# Admin cost report. Credit-only routing stays held until a per-request
# accounting route is proven; the status names the actual reason.
def credit_meter_sql(+organization: String) -> String:
  "SELECT state||char(31)||balance||char(31)||unit||char(31)||cycle FROM credit_observations WHERE organization=" ++ C.q(organization) ++ " AND fact='promotional_credit' ORDER BY observed_at DESC,rowid DESC LIMIT 1;"

def credit_meter_fields(+organization: String, fields: List<&2,String>) -> CreditMeter:
  match fields:
    case state <> balance <> unit <> cycle <> rest: CMeter{organization,state,cycle,balance,unit,"","","",""}
    case other: CMeter{organization,"unavailable","","","","","","",""}

def credit_route_eligibility(+account: AccountRecord, +meter: CreditMeter) -> String:
  Bool.pick(String,Bool.not(Bool.and(String.eq(account_provider(account),"anthropic"),Bool.and(String.eq(account_harness(account),"claude-code"),String.eq(account_funding(account),"api_key")))),"notPromotionalCreditRoute",
  Bool.pick(String,Bool.or(String.is_empty(account_organization(account)),Bool.not(String.eq(account_organization(account),meter_organization(meter)))),"organizationUnverified",
  Bool.pick(String,Bool.not(String.eq(meter_state(meter),"reported")),"creditObservationUnavailable",
  Bool.pick(String,Bool.or(Bool.not(decimal_text(meter_balance(meter))),String.is_empty(meter_unit(meter))),"creditAmountMalformed",
  Bool.pick(String,decimal_is_zero(meter_balance(meter)),"promotionalCreditExhausted","eligible")))))

def credit_status_fields(+db: String, +account: AccountRecord, meter_rows: String) -> IO(String):
  IO.pure(String,credit_route_eligibility(account,credit_meter_fields(account_organization(account),String.split(Tx.trim_nl(meter_rows),Char.from_u32(31)))))

def credit_status_for(+db: String, +account: AccountRecord) -> IO(String):
  do IO<String>:
    meter_rows : String <- IO.try(String,DB.Sql.read(db,credit_meter_sql(account_organization(account))))
    credit_status_fields(db,account,meter_rows)

def credit_launch_refusal_status(+status: String) -> String:
  Bool.pick(String,String.eq(status,"eligible"),"Anthropic API-key launches are held because credit-only routing is not proven for this deployment; the attempt was not started and its input stays owed.","Anthropic API-key launch refused by promotional-credit eligibility (" ++ status ++ "); the attempt was not started and its input stays owed.")

def credit_launch_refusal_decided(+account: AccountRecord, +status: String) -> String:
  Bool.pick(String,Bool.and(String.eq(account_provider(account),"anthropic"),Bool.and(String.eq(account_harness(account),"claude-code"),String.eq(account_funding(account),"api_key"))),credit_launch_refusal_status(status),"")

def credit_launch_refusal_for(+db: String, chosen: Maybe<&2,AccountRecord>) -> IO(String):
  match chosen:
    case None{}: IO.pure(String,"")
    case Some{+account}: do IO<String>:
      status : String <- credit_status_for(db,account)
      IO.pure(String,credit_launch_refusal_decided(account,status))

def credit_authorization_sql(+session: String, +attempt: String, +account: AccountRecord) -> String:
  "INSERT OR IGNORE INTO credit_authorizations(attempt,session,account,organization,cycle,balance,unit,secret_ref,state) SELECT " ++ C.q(attempt) ++ "," ++ C.q(session) ++ "," ++ C.q(account_id(account)) ++ "," ++ C.q(account_organization(account)) ++ ",cycle,balance,unit," ++ C.q(account_secret_ref(account)) ++ ",'authorized' FROM credit_observations WHERE organization=" ++ C.q(account_organization(account)) ++ " AND fact='promotional_credit' AND state='reported' ORDER BY observed_at DESC,rowid DESC LIMIT 1;"
  ++ "SELECT count(*) FROM credit_authorizations WHERE attempt=" ++ C.q(attempt) ++ " AND account=" ++ C.q(account_id(account)) ++ " AND organization=" ++ C.q(account_organization(account)) ++ " AND secret_ref=" ++ C.q(account_secret_ref(account)) ++ " AND state='authorized';"

def credit_record_authorization_decided(+db: String, +session: String, +attempt: String, +account: AccountRecord, +status: String) -> IO(Bool):
  match status:
    case "eligible": do IO<Bool>:
      migrated : Unit <- auth_columns_ensured(db)
      saved : String <- IO.try(String,commit_read(db,credit_authorization_sql(session,attempt,account)))
      IO.pure(Bool,String.eq(Tx.trim_nl(saved),"1"))
    case other: IO.pure(Bool,False{})

def credit_record_authorization(+db: String, +session: String, +attempt: String, +account: AccountRecord) -> IO(Bool):
  do IO<Bool>:
    status : String <- credit_status_for(db,account)
    credit_record_authorization_decided(db,session,attempt,account,status)

def credit_launch_binding_account(+db: String, +session: String, +attempt: String, +harness: String, +account: AccountRecord, helper: Maybe<String>, +profile_store: String) -> IO(Maybe<List<String>>):
  Bool.pick(IO(Maybe<List<String>>),Bool.and(String.eq(account_provider(account),"anthropic"),Bool.and(String.eq(account_harness(account),"claude-code"),String.eq(account_funding(account),"api_key"))),IO.pure(Maybe<List<String>>,None{}),IO.pure(Maybe<List<String>>,account_binding(harness,Some{account},helper,profile_store)))

def credit_launch_binding(+db: String, +session: String, +attempt: String, +harness: String, chosen: Maybe<&2,AccountRecord>, helper: Maybe<String>, +profile_store: String) -> IO(Maybe<List<String>>):
  match chosen:
    case None{}: IO.pure(Maybe<List<String>>,account_binding(harness,None{},helper,profile_store))
    case Some{+account}: credit_launch_binding_account(db,session,attempt,harness,account,helper,profile_store)

# --- the qualified launch gate ------------------------------------------------
# The launch gate is the production caller before send. It records the durable
# reservation first, then the one-use authorization, and returns the packaged
# resolver binding. The source keeps the gate held until the release
# qualification records the request-level guard as proven; a held gate creates
# no reservation, writes no authorization and starts no launch.
def credit_guard_qualified() -> Bool:
  False{}

def credit_guard_route_account(+account: AccountRecord) -> Bool:
  Bool.and(String.eq(account_provider(account),"anthropic"),Bool.and(String.eq(account_harness(account),"claude-code"),String.eq(account_funding(account),"api_key")))

def credit_current_period_io(db: String) -> IO(String):
  do IO<String>:
    text : String <- IO.try(String,DB.Sql.read(db,"SELECT strftime('%Y-%m','now');"))
    IO.pure(String,Tx.trim_nl(text))

def credit_reserved_sql(+attempt: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM credit_reservations WHERE request=" ++ C.q(attempt) ++ " AND state='reserved');"

def credit_reserved_for(+db: String, +attempt: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- IO.try(String,DB.Sql.read(db,credit_reserved_sql(attempt)))
    IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))

# The launch gate returns (binding, refusal). A binding that is Some with an
# empty refusal is usable; a nonempty refusal is the full sentence the caller
# reports and no launch starts.
def credit_guard_refusal_status(+reason: String) -> String:
  "Anthropic API-key launch refused by the request-level promotional-credit guard (" ++ reason ++ "); the attempt was not started and its input stays owed."

def credit_launch_helper_text(helper: Maybe<String>) -> String:
  match helper:
    case None{}: ""
    case Some{path}: path

def credit_launch_authorized(+db: String, +session: String, +attempt: String, +account: AccountRecord, +helper: String) -> IO(Maybe<List<String>> & String):
  do IO<Maybe<List<String>> & String>:
    authorized : Bool <- credit_record_authorization(db,session,attempt,account)
    Bool.pick(IO(Maybe<List<String>> & String),authorized,
      IO.pure(Maybe<List<String>> & String,(api_key_binding(account_secret_ref(account),api_key_resolver_value(helper)),"")),
      IO.pure(Maybe<List<String>> & String,(None{},"The promotional-credit authorization for this attempt could not be recorded; the attempt was not started and its input stays owed.")))

def credit_launch_reserved(+db: String, +session: String, +attempt: String, +account: AccountRecord, +helper: String) -> IO(Maybe<List<String>> & String):
  do IO<Maybe<List<String>> & String>:
    +period : String <- credit_current_period_io(db)
    +decision : CreditAdmission <- credit_reserve_for(db,session,attempt,account,period)
    Bool.pick(IO(Maybe<List<String>> & String),credit_admission_admitted(decision),
      credit_launch_authorized(db,session,attempt,account,helper),
      IO.pure(Maybe<List<String>> & String,(None{},credit_guard_refusal_status(credit_admission_reason(decision)))))

def credit_launch_price_reserved(+db: String, +session: String, +attempt: String, +account: AccountRecord, +helper: String, +max_charge: String) -> IO(Maybe<List<String>> & String):
  do IO<Maybe<List<String>> & String>:
    +period : String <- credit_current_period_io(db)
    +decision : CreditAdmission <- credit_reserve_bounded_for(db,session,attempt,account,period,max_charge)
    Bool.pick(IO(Maybe<List<String>> & String),credit_admission_admitted(decision),
      credit_launch_authorized(db,session,attempt,account,helper),
      IO.pure(Maybe<List<String>> & String,(None{},credit_guard_refusal_status(credit_admission_reason(decision)))))

def credit_launch_price_decided(+db: String, +session: String, +attempt: String, +account: AccountRecord, +helper: String, +decision: CreditRequestPrice) -> IO(Maybe<List<String>> & String):
  match decision:
    case Priced{max_charge}: credit_launch_price_reserved(db,session,attempt,account,helper,max_charge)
    case PriceRefused{reason}: IO.pure(Maybe<List<String>> & String,(None{},credit_guard_refusal_status(reason)))

def credit_launch_gate_priced_account(+db: String, +session: String, +attempt: String, +harness: String, +account: AccountRecord, +helper: String, +profile_store: String, +facts: CreditRequestFacts, qualified: Bool) -> IO(Maybe<List<String>> & String):
  Bool.pick(IO(Maybe<List<String>> & String),credit_guard_route_account(account),
    Bool.pick(IO(Maybe<List<String>> & String),qualified,
      credit_launch_price_decided(db,session,attempt,account,helper,credit_request_price(facts)),
      IO.pure(Maybe<List<String>> & String,(None{},credit_api_key_refusal(account)))),
    IO.pure(Maybe<List<String>> & String,(account_binding(harness,Some{account},api_key_resolver_value(helper),profile_store),"")))

def credit_launch_gate_priced(+db: String, +session: String, +attempt: String, +harness: String, +chosen: Maybe<&2,AccountRecord>, helper: Maybe<String>, +profile_store: String, +facts: CreditRequestFacts, qualified: Bool) -> IO(Maybe<List<String>> & String):
  match chosen:
    case None{}: IO.pure(Maybe<List<String>> & String,(account_binding(harness,None{},helper,profile_store),""))
    case Some{+account}: do IO<Maybe<List<String>> & String>:
      +helper_path : String = credit_launch_helper_text(helper)
      credit_launch_gate_priced_account(db,session,attempt,harness,account,helper_path,profile_store,facts,qualified)

def credit_launch_gate_account(+db: String, +session: String, +attempt: String, +harness: String, +account: AccountRecord, +helper: String, +profile_store: String, qualified: Bool) -> IO(Maybe<List<String>> & String):
  Bool.pick(IO(Maybe<List<String>> & String),credit_guard_route_account(account),
    Bool.pick(IO(Maybe<List<String>> & String),qualified,
      credit_launch_reserved(db,session,attempt,account,helper),
      IO.pure(Maybe<List<String>> & String,(None{},credit_api_key_refusal(account)))),
    IO.pure(Maybe<List<String>> & String,(account_binding(harness,Some{account},api_key_resolver_value(helper),profile_store),"")))

def credit_launch_gate(+db: String, +session: String, +attempt: String, +harness: String, +chosen: Maybe<&2,AccountRecord>, helper: Maybe<String>, +profile_store: String, qualified: Bool) -> IO(Maybe<List<String>> & String):
  match chosen:
    case None{}: IO.pure(Maybe<List<String>> & String,(account_binding(harness,None{},helper,profile_store),""))
    case Some{+account}: do IO<Maybe<List<String>> & String>:
      +helper_path : String = credit_launch_helper_text(helper)
      credit_launch_gate_account(db,session,attempt,harness,account,helper_path,profile_store,qualified)
