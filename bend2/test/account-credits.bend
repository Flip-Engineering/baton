# Fixture for the account and API-credit records. It drives the real funding
# vocabulary, the real secret-reference and balance legality checks, the real
# launch binding for both funding routes, the real selection over parsed fixture
# accounts and blocked organizations, and the real authority rule. Account,
# organization and store names here are fixtures and prove no live account,
# balance or availability.
import Base
import ../src/coordinator/accounts.bend as A

def check(label: String, is_ok: Bool) -> IO(Unit):
  match is_ok:
    case True{}: IO.print("fixture-account " ++ label ++ ": ok")
    case False{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": refused")

def same_bool(first: Bool, second: Bool) -> Bool:
  Bool.pick(Bool,first,second,Bool.not(second))

def account(label: String, harness: String, funding: String, secret_ref: String, organization: String) -> A.AccountRecord:
  A.Ac{label,"anthropic",harness,funding,secret_ref,organization,""}

def fixture_accounts() -> List<A.AccountRecord>:
  [account("claude-max","claude-code","subscription","file:/fixture/secrets/max","org-a"),
   account("claude-api","claude-code","api_key","file:/fixture/secrets/api","org-b"),
   account("codex-main","codex","subscription","/fixture/stores/codex","org-c")]

def decimal_checks() -> IO(Unit):
  do IO(Unit):
    whole : Unit <- check("balance-whole-decimal",A.decimal_text("200"))
    cents : Unit <- check("balance-trailing-zeros-kept",A.decimal_text("200.00"))
    long : Unit <- check("balance-long-decimal",A.decimal_text("0.123456789012345678901234567890"))
    empty : Unit <- check("balance-empty-refused",Bool.not(A.decimal_text("")))
    two_dots : Unit <- check("balance-two-dots-refused",Bool.not(A.decimal_text("1.2.3")))
    negative : Unit <- check("balance-sign-refused",Bool.not(A.decimal_text("-5")))
    exponent : Unit <- check("balance-exponent-refused",Bool.not(A.decimal_text("1e3")))
    words : Unit <- check("balance-prose-refused",Bool.not(A.decimal_text("about two hundred dollars")))
    IO.pure(Unit,Unit{})

def vocabulary_checks() -> IO(Unit):
  do IO(Unit):
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

def operation_is(operation: String, +expected: String, +label: String) -> IO(Unit):
  operation_is_fact(A.operation_fact(operation),expected,label)

def operation_is_fact(fact: Maybe<String>, +expected: String, +label: String) -> IO(Unit):
  match fact:
    case Some{+fact}: check(label,String.eq(fact,expected))
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": no fact")

def operation_none(operation: String, +label: String) -> IO(Unit):
  operation_none_fact(A.operation_fact(operation),label)

def operation_none_fact(fact: Maybe<String>, +label: String) -> IO(Unit):
  match fact:
    case None{}: check(label,True{})
    case Some{+fact}: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected " ++ fact)

def operation_checks() -> IO(Unit):
  do IO(Unit):
    organization : Unit <- operation_is("organization","organization","operation-reads-the-organization")
    spend : Unit <- operation_is("cost","external_spend","operation-cost-is-observed-spend")
    usage : Unit <- operation_is("usage","subscription_usage","operation-usage-is-subscription-usage")
    absent : Unit <- operation_none("balance","operation-balance-yields-no-fact")
    IO.pure(Unit,Unit{})

def state_checks() -> IO(Unit):
  do IO(Unit):
    reported : Unit <- check("state-reported",A.state_known("reported"))
    unavailable : Unit <- check("state-unavailable",A.state_known("unavailable"))
    stale : Unit <- check("state-unknown-refused",Bool.not(A.state_known("stale")))
    promotional : Unit <- check("fact-promotional-credit",A.credit_fact_known("promotional_credit"))
    purchased : Unit <- check("fact-purchased-credit",A.credit_fact_known("purchased_credit"))
    spend : Unit <- check("fact-spend-is-not-a-credit-import",Bool.not(A.credit_fact_known("external_spend")))
    IO.pure(Unit,Unit{})

def head_is(values: List<String>, +label: String, +expected_head: String) -> IO(Unit):
  match values:
    case head <> rest: check(label,String.eq(head,expected_head))
    case Nil{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": empty binding")

def binding_is(binding: Maybe<List<String>>, +label: String, +expected_head: String) -> IO(Unit):
  match binding:
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": no binding")
    case Some{+values}: head_is(values,label,expected_head)

def binding_absent(binding: Maybe<List<String>>, +label: String) -> IO(Unit):
  match binding:
    case None{}: check(label,True{})
    case Some{+values}: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected binding")

def binding_checks() -> IO(Unit):
  do IO(Unit):
    codex : Unit <- binding_is(A.launch_binding("codex","subscription","/fixture/stores/codex alt",None{}),"subscription-codex-store","CODEX_HOME=/fixture/stores/codex alt")
    claude : Unit <- binding_is(A.launch_binding("claude-code","subscription","/fixture/stores/claude",None{}),"subscription-claude-store","CLAUDE_CONFIG_DIR=/fixture/stores/claude")
    resolver : Unit <- binding_is(A.launch_binding("claude-code","api_key","file:/fixture/secrets/api",Some{"/fixture/libexec/api-key-exec.mjs"}),"api-key-runs-the-resolver","node")
    missing : Unit <- binding_absent(A.launch_binding("claude-code","api_key","file:/fixture/secrets/api",None{}),"api-key-without-resolver-binds-nothing")
    account_key : Unit <- binding_is(A.account_binding("claude-code",Some{account("claude-api","claude-code","api_key","file:/fixture/secrets/api","org-b")},Some{"/fixture/libexec/api-key-exec.mjs"},"/fixture/stores/claude"),"account-funding-decides-the-binding","node")
    profile : Unit <- binding_is(A.account_binding("codex",None{},None{},"/fixture/stores/codex"),"no-account-keeps-the-profile-store","CODEX_HOME=/fixture/stores/codex")
    ordinary : Unit <- binding_absent(A.account_binding("codex",None{},None{},""),"no-account-and-no-store-keeps-ordinary-arguments")
    unresolvable : Unit <- binding_absent(A.account_binding("claude-code",Some{account("claude-api","claude-code","api_key","file:/fixture/secrets/api","org-b")},None{},"/fixture/stores/claude"),"api-key-account-never-takes-another-store")
    IO.pure(Unit,Unit{})

def preferred_is(selected: Maybe<&2,A.Selected>, +label: String, +expected: String, preferred: Bool) -> IO(Unit):
  match selected:
    case None{}: IO.die(Unit,1,"fixture-account " ++ label ++ ": no selection")
    case Some{+chosen}:
      check(label,Bool.and(String.eq(A.account_id(A.selected_account(chosen)),expected),same_bool(A.selected_preferred(chosen),preferred)))

def no_selection(selected: Maybe<&2,A.Selected>, +label: String) -> IO(Unit):
  match selected:
    case None{}: check(label,True{})
    case Some{+chosen}: IO.die(Unit,1,"fixture-account " ++ label ++ ": unexpected " ++ A.account_id(A.selected_account(chosen)))

def selection_checks(accounts: List<&2,A.AccountRecord>) -> IO(Unit):
  do IO(Unit):
    one_blocked : List<String> <- IO.pure(List<String>,Con{"org-b",Nil{}})
    first : Unit <- preferred_is(A.select_account(accounts,one_blocked,"claude-code",""),"observed-availability-decides","claude-max",True{})
    all_blocked : List<String> <- IO.pure(List<String>,Con{"org-a",Con{"org-b",Nil{}}})
    fallback : Unit <- preferred_is(A.select_account(accounts,all_blocked,"claude-code",""),"operator-order-when-availability-decides-nothing","claude-max",False{})
    none_blocked : List<String> <- IO.pure(List<String>,Nil{})
    api_key : Unit <- preferred_is(A.select_account(accounts,none_blocked,"claude-code","api_key"),"funding-route-selects","claude-api",True{})
    absent : Unit <- no_selection(A.select_account(accounts,none_blocked,"muse",""),"unmatched-harness-selects-nothing")
    IO.pure(Unit,Unit{})

def unknown_organization_checks() -> IO(Unit):
  do IO(Unit):
    +unverified : A.AccountRecord <- IO.pure(A.AccountRecord,account("claude-unverified","claude-code","subscription","file:/fixture/secrets/max",""))
    +accounts : List<&2,A.AccountRecord> <- IO.pure(List<&2,A.AccountRecord>,Con{unverified,Nil{}})
    +blocked : List<String> <- IO.pure(List<String>,Con{"org-a",Nil{}})
    chosen : Unit <- preferred_is(A.select_account(accounts,blocked,"claude-code",""),"unknown-organization-is-never-preferred-against","claude-unverified",True{})
    IO.pure(Unit,Unit{})

def authority_checks() -> IO(Unit):
  do IO(Unit):
    selected : Unit <- check("authority-of-session",String.eq(A.authority_of("accounts-deepseek"),"accounts-deepseek"))
    operator : Unit <- check("authority-without-session",String.eq(A.authority_of(""),"operator"))
    IO.pure(Unit,Unit{})

def main() -> IO(Unit):
  do IO(Unit):
    dec : Unit <- decimal_checks()
    vocab : Unit <- vocabulary_checks()
    operations : Unit <- operation_checks()
    states : Unit <- state_checks()
    binds : Unit <- binding_checks()
    +accounts : List<&2,A.AccountRecord> <- IO.pure(List<&2,A.AccountRecord>,fixture_accounts())
    selections : Unit <- selection_checks(accounts)
    unknown : Unit <- unknown_organization_checks()
    authority : Unit <- authority_checks()
    printed : Unit <- IO.print("fixture-accounts-ok")
    IO.pure(Unit,Unit{})
