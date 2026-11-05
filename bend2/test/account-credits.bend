# Fixture for the account and API-credit records. It drives the real funding
# vocabulary, the decimal and reference legality checks, the operation-to-fact
# mapping, the launch binding for both funding routes, the selection predicates
# and the authority rule. Account, organization and store names here are
# fixtures and prove no live account, balance or availability.
import Base
import ../src/coordinator/accounts.bend as A
import ../src/coordinator/turn.bend as Turn
import ../src/harness/codex-player.bend as Codex

def check(label: String, is_ok: Bool) -> IO(Unit):
  match is_ok:
    case True{}: IO.print("fixture-account " ++ label ++ ": ok")
    case False{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": refused")

def operation_is_fact(fact: Maybe<String>, +expected: String, +label: String) -> IO(Unit):
  match fact:
    case Some{+fact}: check(label,String.eq(fact,expected))
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": no fact")

def operation_is(operation: String, +expected: String, +label: String) -> IO(Unit):
  operation_is_fact(A.operation_fact(operation),expected,label)

def operation_none_fact(fact: Maybe<String>, +label: String) -> IO(Unit):
  match fact:
    case None{}: check(label,True{})
    case Some{+fact}: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected " ++ fact)

def operation_none(operation: String, +label: String) -> IO(Unit):
  operation_none_fact(A.operation_fact(operation),label)

def operation_checks() -> IO(Unit):
  do IO<Unit>:
    organization : Unit <- operation_is("organization","organization","operation-reads-the-organization")
    spend : Unit <- operation_is("cost","external_spend","operation-cost-is-observed-spend")
    usage : Unit <- operation_is("usage","subscription_usage","operation-usage-is-subscription-usage")
    absent : Unit <- operation_none("balance","operation-balance-yields-no-fact")
    IO.pure(Unit,Unit{})

def binding_value(head: Maybe<&1,String>, +label: String, +expected_head: String) -> IO(Unit):
  match head:
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": empty binding")
    case Some{+value}: check(label,String.eq(value,expected_head))

def binding_is(binding: Maybe<List<String>>, +label: String, +expected_head: String) -> IO(Unit):
  match binding:
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": no binding")
    case Some{values}: binding_value(List.head(&1,String,values),label,expected_head)

def binding_refuses(binding: Maybe<List<String>>, +label: String) -> IO(Unit):
  match binding:
    case None{}: check(label,True{})
    case Some{values}: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected binding")

def binding_three_values(values: List<String>, +label: String, +first: String, +second: String, +third: String) -> IO(Unit):
  match values:
    case a <> rest_a:
      match rest_a:
        case b <> rest_b:
          match rest_b:
            case c <> Nil{}: check(label,Bool.and(String.eq(a,first),Bool.and(String.eq(b,second),String.eq(c,third))))
            case other: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected binding tail")
        case other: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected binding tail")
    case other: IO.die(Unit,1,"fixture-account " ++ label ++ ": empty binding")

def binding_three(binding: Maybe<List<String>>, +label: String, +first: String, +second: String, +third: String) -> IO(Unit):
  match binding:
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": no binding")
    case Some{values}: binding_three_values(values,label,first,second,third)

def binding_checks() -> IO(Unit):
  do IO<Unit>:
    codex : Unit <- binding_is(A.launch_binding("codex","subscription","/fixture/stores/codex alt",None{}),"subscription-codex-store","CODEX_HOME=/fixture/stores/codex alt")
    claude : Unit <- binding_is(A.launch_binding("claude-code","subscription","/fixture/stores/claude",None{}),"subscription-claude-store","CLAUDE_CONFIG_DIR=/fixture/stores/claude")
    resolver : Unit <- binding_is(A.launch_binding("claude-code","api_key","file:/fixture/secrets/api",Some{"/fixture/libexec/api-key-exec"}),"api-key-helper-binding-for-admitted-route","/fixture/libexec/api-key-exec")
    profile : Unit <- binding_is(A.account_binding("codex",None{},None{},"/fixture/stores/codex"),"no-account-keeps-the-profile-store","CODEX_HOME=/fixture/stores/codex")
    anthropic_api : Unit <- binding_refuses(A.account_binding("claude-code",Some{A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"}},Some{"/fixture/libexec/api-key-exec"},""),"anthropic-api-key-is-held-without-request-admission")
    anthropic_subscription : Unit <- binding_is(A.account_binding("claude-code",Some{A.Ac{"claude-max","anthropic","claude-code","subscription","/fixture/stores/claude","org-fixture","2026-10-18"}},None{},""),"anthropic-subscription-binding-is-preserved","CLAUDE_CONFIG_DIR=/fixture/stores/claude")
    other_provider : Unit <- binding_is(A.account_binding("codex",Some{A.Ac{"openai-codex","openai","codex","subscription","/fixture/stores/codex","org-openai","2026-10-18"}},None{},""),"other-provider-subscription-binding-is-unchanged","CODEX_HOME=/fixture/stores/codex")
    codex_api_needs_attempt : Unit <- binding_refuses(A.account_binding("codex",Some{A.Ac{"openai-api","openai","codex","api_key","file:/fixture/secrets/openai","org-openai","2026-10-18"}},Some{"/fixture/libexec/api-key-exec"},""),"codex-api-key-binding-needs-an-attempt-directory")
    codex_launch_needs_attempt : Unit <- binding_refuses(A.launch_binding("codex","api_key","file:/fixture/secrets/openai",Some{"/fixture/libexec/api-key-exec"}),"codex-api-key-launch-binding-needs-an-attempt-directory")
    codex_api : Unit <- binding_three(A.codex_api_key_binding("file:/fixture/secrets/openai","/fixture/libexec/api-key-exec","attempt-9"),"codex-api-key-binding-carries-helper-secret-and-home","/fixture/libexec/api-key-exec","file:/fixture/secrets/openai","attempt-9/codex-home")
    codex_no_helper : Unit <- binding_refuses(A.codex_api_key_binding("file:/fixture/secrets/openai","","attempt-9"),"codex-api-key-binding-needs-a-helper")
    codex_no_attempt : Unit <- binding_refuses(A.codex_api_key_binding("file:/fixture/secrets/openai","/fixture/libexec/api-key-exec",""),"codex-api-key-binding-needs-an-attempt-directory")
    codex_resolved : Unit <- binding_three(A.codex_api_key_resolved("file:/fixture/secrets/openai",Some{"/fixture/libexec/api-key-exec"},"attempt-9"),"codex-api-key-resolved-binding-carries-helper-secret-and-home","/fixture/libexec/api-key-exec","file:/fixture/secrets/openai","attempt-9/codex-home")
    codex_unresolved : Unit <- binding_refuses(A.codex_api_key_resolved("file:/fixture/secrets/openai",None{},"attempt-9"),"codex-api-key-unresolved-binding-needs-a-helper")
    codex_home : Unit <- check("codex-api-key-home-sits-under-the-attempt",String.eq(A.codex_api_key_home("attempt-9"),"attempt-9/codex-home"))
    IO.pure(Unit,Unit{})

def route_checks() -> IO(Unit):
  do IO<Unit>:
    codex : Unit <- check("funding-api-key-codex",A.funding_route_ok("codex","api_key"))
    claude : Unit <- check("funding-api-key-claude-code",A.funding_route_ok("claude-code","api_key"))
    omp : Unit <- check("funding-api-key-omp-refused",Bool.not(A.funding_route_ok("omp","api_key")))
    muse : Unit <- check("funding-api-key-muse-refused",Bool.not(A.funding_route_ok("muse","api_key")))
    subscription : Unit <- check("funding-subscription-any-harness",A.funding_route_ok("omp","subscription"))
    IO.pure(Unit,Unit{})

def selected_label(selected: Maybe<&2,A.Selected>) -> String:
  match selected:
    case None{}: ""
    case Some{+chosen}: A.account_id(A.selected_account(chosen))

def selected_pref(selected: Maybe<&2,A.Selected>) -> Bool:
  match selected:
    case None{}: False{}
    case Some{+chosen}: A.selected_preferred(chosen)

def account_label(account: Maybe<&2,A.AccountRecord>) -> String:
  match account:
    case None{}: ""
    case Some{+chosen}: A.account_id(chosen)

def order_checks() -> IO(Unit):
  do IO<Unit>:
    +sub : A.AccountRecord = A.Ac{"codex-sub","openai","codex","subscription","/fixture/stores/codex","org-sub","2026-10-18"}
    +key : A.AccountRecord = A.Ac{"codex-key","openai","codex","api_key","file:/fixture/secrets/openai","org-key","2026-10-18"}
    +other : A.AccountRecord = A.Ac{"claude-max","anthropic","claude-code","subscription","/fixture/stores/claude","org-sub","2026-10-18"}
    head : Unit <- check("order-takes-the-head-of-operator-order",String.eq(selected_label(A.select_account([sub,key],"","codex","")),"codex-sub"))
    head_pref : Unit <- check("order-marks-the-head-preferred",selected_pref(A.select_account([sub,key],"","codex","")))
    key_funding : Unit <- check("order-funding-filter-selects-the-key",String.eq(selected_label(A.select_account([sub,key],"","codex","api_key")),"codex-key"))
    key_matches : Unit <- check("order-api-key-account-matches-codex",A.account_matches("codex","",key))
    blocked_head : Unit <- check("order-blocked-head-falls-to-the-key",String.eq(selected_label(A.select_account([sub,key],"org-sub","codex","")),"codex-key"))
    advance : Unit <- check("order-advance-reaches-the-key",String.eq(account_label(A.next_account_after([sub,key],"codex","codex-sub",False{})),"codex-key"))
    tail : Unit <- check("order-advance-ends-at-the-tail",String.eq(account_label(A.next_account_after([sub,key],"codex","codex-key",False{})),""))
    harness_kept : Unit <- check("order-harness-filter-keeps-codex",String.eq(account_label(List.head(&2,A.AccountRecord,A.harness_accounts([sub,other],"codex"))),"codex-sub"))
    IO.pure(Unit,Unit{})

def argv_checks() -> IO(Unit):
  do IO<Unit>:
    +argv : String = Codex.argv_api_key(["/fixture/libexec/api-key-exec","file:/fixture/secrets/openai","attempt-9/codex-home"],Nil{},"codex","gpt-5","xhigh","",True{})
    omits_chatgpt : Unit <- check("codex-api-key-argv-omits-chatgpt-login",Bool.not(String.contains(argv,"forced_login_method")))
    binds_home : Unit <- check("codex-api-key-argv-carries-the-home",String.contains(argv,"attempt-9/codex-home"))
    unbinds_keys : Unit <- check("codex-api-key-argv-unbinds-host-keys",Bool.and(String.contains(argv,"-u"),String.contains(argv,"OPENAI_API_KEY")))
    IO.pure(Unit,Unit{})

def launch_argv_decided(launched: Result<&1,&1,U32 & String,String>, +label: String, +expected: String, +absent: String) -> IO(Unit):
  match launched:
    case Done{+argv}: check(label,Bool.and(String.contains(argv,expected),Bool.not(String.contains(argv,absent))))
    case Fail{(code,detail)}: IO.die(Unit,1,"fixture-account " ++ label ++ ": launch refused")

def launch_argv_checks() -> IO(Unit):
  do IO<Unit>:
    +key : A.AccountRecord = A.Ac{"codex-key","openai","codex","api_key","file:/fixture/secrets/openai","org-key","2026-10-18"}
    key_launch : Result<&1,&1,U32 & String,String> = Turn.retained_launch_arguments(False{},False{},False{},"codex","gpt-5","xhigh","","","native-1","","","","codex",Some{key},(Some{["/fixture/libexec/api-key-exec","file:/fixture/secrets/openai","attempt-9/codex-home"]},""))
    keyed : Unit <- launch_argv_decided(key_launch,"codex-api-key-launch-omits-chatgpt-login","attempt-9/codex-home","forced_login_method")
    +sub : A.AccountRecord = A.Ac{"codex-sub","openai","codex","subscription","/fixture/stores/codex","org-sub","2026-10-18"}
    sub_launch : Result<&1,&1,U32 & String,String> = Turn.retained_launch_arguments(False{},False{},False{},"codex","gpt-5","xhigh","","","native-1","","","","codex",Some{sub},(Some{["CODEX_HOME=/fixture/stores/codex"]},""))
    kept : Unit <- launch_argv_decided(sub_launch,"codex-subscription-launch-keeps-chatgpt-login","forced_login_method","attempt-9/codex-home")
    IO.pure(Unit,Unit{})

def refusal_checks() -> IO(Unit):
  do IO<Unit>:
    anthropic : Unit <- check("api-key-credit-hold-refusal",String.eq(A.credit_api_key_refusal(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"}),"Anthropic API-key launches are held because request-level promotional-credit admission is unavailable; the attempt was not started and its input stays owed."))
    other : Unit <- check("other-provider-resolver-refusal",String.eq(A.credit_api_key_refusal(A.Ac{"openai-api","openai","codex","api_key","file:/fixture/secrets/openai","org-openai","2026-10-18"}),"This API-key launch has no installed resolver beside the resolved identity helper; the attempt was not started and its input stays owed."))
    IO.pure(Unit,Unit{})

def decimal_checks() -> IO(Unit):
  do IO<Unit>:
    whole : Unit <- check("balance-whole-decimal",A.decimal_text("200"))
    cents : Unit <- check("balance-trailing-zeros-kept",A.decimal_text("200.00"))
    long : Unit <- check("balance-long-decimal",A.decimal_text("0.123456789012345678901234567890"))
    empty : Unit <- check("balance-empty-refused",Bool.not(A.decimal_text("")))
    two_dots : Unit <- check("balance-two-dots-refused",Bool.not(A.decimal_text("1.2.3")))
    negative : Unit <- check("balance-sign-refused",Bool.not(A.decimal_text("-5")))
    exponent : Unit <- check("balance-exponent-refused",Bool.not(A.decimal_text("1e3")))
    words : Unit <- check("balance-prose-refused",Bool.not(A.decimal_text("about two hundred dollars")))
    IO.pure(Unit,Unit{})

def decimal_arith_checks() -> IO(Unit):
  do IO<Unit>:
    add_cents : Unit <- check("decimal-add-carries-cents",String.eq(A.decimal_add("200.00","0.50"),"200.5"))
    add_precise : Unit <- check("decimal-add-keeps-precision",String.eq(A.decimal_add("0.12345678901234567890","0.00000000000000000001"),"0.12345678901234567891"))
    add_carry : Unit <- check("decimal-add-carries-integer",String.eq(A.decimal_add("999.99","0.01"),"1000"))
    sub_cents : Unit <- check("decimal-sub-borrows-cents",String.eq(A.decimal_sub("200.00","199.99"),"0.01"))
    sub_whole : Unit <- check("decimal-sub-to-whole",String.eq(A.decimal_sub("200.50","0.50"),"200"))
    lte_int : Unit <- check("decimal-lte-by-length",A.decimal_lte("2","10"))
    lte_frac : Unit <- check("decimal-lte-trailing-zero",A.decimal_lte("0.50","0.5"))
    gt_frac : Unit <- check("decimal-gt-fraction",Bool.not(A.decimal_lte("10.01","10")))
    zero : Unit <- check("decimal-zero-recognized",A.decimal_is_zero("0.00"))
    nonzero : Unit <- check("decimal-nonzero-recognized",Bool.not(A.decimal_is_zero("0.01")))
    IO.pure(Unit,Unit{})

def admission_reason_is(admission: A.CreditAdmission, +expected: String, +label: String) -> IO(Unit):
  check(label,String.eq(A.credit_admission_reason(admission),expected))

def admission_checks() -> IO(Unit):
  do IO<Unit>:
    admitted : Unit <- check("admission-admits-bounded-request",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","450","40"},"2026-10-cycle","2026-10","10")))
    reserved : Unit <- check("admission-reserved-total",String.eq(A.credit_admission_reserved_total(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","450","40"},"2026-10-cycle","2026-10","10")),"50"))
    balance_after : Unit <- check("admission-balance-after-reserve",String.eq(A.credit_admission_balance_after(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","450","40"},"2026-10-cycle","2026-10","10")),"150"))
    cap_after : Unit <- check("admission-cap-after-reserve",String.eq(A.credit_admission_cap_after(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","450","40"},"2026-10-cycle","2026-10","10")),"0"))
    route : Unit <- admission_reason_is(A.credit_request_admission(A.Ac{"claude-max","anthropic","claude-code","subscription","/fixture/stores/claude","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","0","0"},"2026-10-cycle","2026-10","10"),"notPromotionalCreditRoute","admission-refuses-subscription-route")
    org : Unit <- admission_reason_is(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","0","0"},"2026-10-cycle","2026-10","10"),"organizationUnverified","admission-refuses-unverified-organization")
    unavailable : Unit <- admission_reason_is(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","unavailable","2026-10-cycle","","USD","500","2026-10","0","0"},"2026-10-cycle","2026-10","10"),"creditObservationUnavailable","admission-refuses-unavailable-observation")
    cycle : Unit <- admission_reason_is(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-09-cycle","200","USD","500","2026-10","0","0"},"2026-10-cycle","2026-10","10"),"creditCycleMismatch","admission-refuses-stale-cycle")
    cap_period : Unit <- admission_reason_is(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-09","0","0"},"2026-10-cycle","2026-10","10"),"monthlyCapPeriodMismatch","admission-refuses-stale-cap-period")
    malformed : Unit <- admission_reason_is(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","0","0"},"2026-10-cycle","2026-10","1e3"),"creditAmountMalformed","admission-refuses-malformed-charge")
    unbounded : Unit <- check("admission-refuses-zero-charge-bound",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","0","0"},"2026-10-cycle","2026-10","0")))
    balance : Unit <- check("admission-charge-over-estimate-admitted",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","0","195"},"2026-10-cycle","2026-10","10")))
    cap : Unit <- check("admission-charge-over-cap-estimate-admitted",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","200","USD","500","2026-10","495","0"},"2026-10-cycle","2026-10","10")))
    held : Unit <- binding_refuses(A.account_binding("claude-code",Some{A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"}},Some{"/fixture/libexec/api-key-exec"},""),"admission-does-not-lift-launch-hold")
    IO.pure(Unit,Unit{})

def eligibility_checks() -> IO(Unit):
  do IO<Unit>:
    eligible : Unit <- check("eligibility-reported-balance",String.eq(A.credit_route_eligibility(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10","200.00","USD","","","",""}),"eligible"))
    exhausted : Unit <- check("eligibility-reported-zero-is-exhausted",String.eq(A.credit_route_eligibility(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10","0.00","USD","","","",""}),"promotionalCreditExhausted"))
    unavailable : Unit <- check("eligibility-unavailable-observation",String.eq(A.credit_route_eligibility(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","unavailable","2026-10","","USD","","","",""}),"creditObservationUnavailable"))
    unverified : Unit <- check("eligibility-unverified-organization",String.eq(A.credit_route_eligibility(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10","200.00","USD","","","",""}),"organizationUnverified"))
    subscription : Unit <- check("eligibility-subscription-is-distinct",String.eq(A.credit_route_eligibility(A.Ac{"claude-max","anthropic","claude-code","subscription","/fixture/stores/claude","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10","200.00","USD","","","",""}),"notPromotionalCreditRoute"))
    IO.pure(Unit,Unit{})

def vocabulary_checks() -> IO(Unit):
  do IO<Unit>:
    subscription : Unit <- check("funding-subscription",A.funding_known("subscription"))
    api_key : Unit <- check("funding-api-key",A.funding_known("api_key"))
    other : Unit <- check("funding-other-refused",Bool.not(A.funding_known("trial")))
    claude : Unit <- check("harness-claude",A.harness_launchable("claude-code"))
    unknown : Unit <- check("harness-unknown-refused",Bool.not(A.harness_launchable("gemini")))
    label : Unit <- check("label-word",A.label_ok("claude-max"))
    spaced : Unit <- check("label-space-refused",Bool.not(A.label_ok("claude max")))
    blank : Unit <- check("label-empty-refused",Bool.not(A.label_ok("")))
    reference : Unit <- check("reference-with-space",A.ref_ok("file:/fixture/secrets/max key"))
    no_reference : Unit <- check("reference-empty-refused",Bool.not(A.ref_ok("")))
    newline : Unit <- check("reference-newline-refused",Bool.not(A.ref_ok("file:/secrets\n")))
    IO.pure(Unit,Unit{})
def state_checks() -> IO(Unit):
  do IO<Unit>:
    reported : Unit <- check("state-reported",A.state_known("reported"))
    unavailable : Unit <- check("state-unavailable",A.state_known("unavailable"))
    stale : Unit <- check("state-unknown-refused",Bool.not(A.state_known("stale")))
    promotional : Unit <- check("fact-promotional-credit",A.credit_fact_known("promotional_credit"))
    purchased : Unit <- check("fact-purchased-credit",A.credit_fact_known("purchased_credit"))
    spend : Unit <- check("fact-spend-is-not-a-credit-import",Bool.not(A.credit_fact_known("external_spend")))
    IO.pure(Unit,Unit{})

def selection_checks() -> IO(Unit):
  do IO<Unit>:
    blocked : Unit <- check("blocked-organization-matches",A.organization_blocked("org-a\norg-b","org-b"))
    unblocked : Unit <- check("unblocked-organization-passes",Bool.not(A.organization_blocked("org-a","org-b")))
    unknown : Unit <- check("unknown-organization-is-never-blocked",Bool.not(A.organization_blocked("org-a","")))
    matches : Unit <- check("harness-and-subscription-match",A.account_matches("claude-code","",A.Ac{"claude-max","anthropic","claude-code","subscription","file:/fixture/secrets/max","org-a",""}))
    funding : Unit <- check("funding-filter-selects-api-key",A.account_matches("claude-code","api_key",A.Ac{"claude-api","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-b",""}))
    wrong_funding : Unit <- check("funding-filter-excludes-subscription",Bool.not(A.account_matches("claude-code","api_key",A.Ac{"claude-max","anthropic","claude-code","subscription","file:/fixture/secrets/max","org-a",""})))
    wrong_harness : Unit <- check("harness-filter-excludes-other",Bool.not(A.account_matches("muse","",A.Ac{"claude-max","anthropic","claude-code","subscription","file:/fixture/secrets/max","org-a",""})))
    viable : Unit <- check("unblocked-account-is-viable",A.account_viable("org-b","claude-code","",A.Ac{"claude-max","anthropic","claude-code","subscription","file:/fixture/secrets/max","org-a",""}))
    blocked_viable : Unit <- check("blocked-account-is-not-preferred",Bool.not(A.account_viable("org-a","claude-code","",A.Ac{"claude-max","anthropic","claude-code","subscription","file:/fixture/secrets/max","org-a",""})))
    IO.pure(Unit,Unit{})

def authority_checks() -> IO(Unit):
  do IO<Unit>:
    selected : Unit <- check("authority-of-session",String.eq(A.authority_of("accounts-deepseek"),"accounts-deepseek"))
    operator : Unit <- check("authority-without-session",String.eq(A.authority_of(""),"operator"))
    IO.pure(Unit,Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    dec : Unit <- decimal_checks()
    arith : Unit <- decimal_arith_checks()
    admission : Unit <- admission_checks()
    eligibility : Unit <- eligibility_checks()
    vocab : Unit <- vocabulary_checks()
    operations : Unit <- operation_checks()
    binds : Unit <- binding_checks()
    refusals : Unit <- refusal_checks()
    states : Unit <- state_checks()
    selections : Unit <- selection_checks()
    routes : Unit <- route_checks()
    orders : Unit <- order_checks()
    argv : Unit <- argv_checks()
    launched : Unit <- launch_argv_checks()
    authority : Unit <- authority_checks()
    printed : Unit <- IO.print("fixture-accounts-ok")
    IO.pure(Unit,Unit{})
