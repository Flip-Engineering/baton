# Fixture for the account and API-credit records. It drives the real funding
# vocabulary, the decimal and reference legality checks, the operation-to-fact
# mapping, the launch binding for both funding routes, the selection predicates
# and the authority rule. Account, organization and store names here are
# fixtures and prove no live account, balance or availability.
import Base
import ../src/coordinator/accounts.bend as A

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

def binding_checks() -> IO(Unit):
  do IO<Unit>:
    codex : Unit <- binding_is(A.launch_binding("codex","subscription","/fixture/stores/codex alt",None{}),"subscription-codex-store","CODEX_HOME=/fixture/stores/codex alt")
    claude : Unit <- binding_is(A.launch_binding("claude-code","subscription","/fixture/stores/claude",None{}),"subscription-claude-store","CLAUDE_CONFIG_DIR=/fixture/stores/claude")
    resolver : Unit <- binding_is(A.launch_binding("claude-code","api_key","file:/fixture/secrets/api",Some{"/fixture/libexec/api-key-exec"}),"api-key-runs-the-resolver","/fixture/libexec/api-key-exec")
    profile : Unit <- binding_is(A.account_binding("codex",None{},None{},"/fixture/stores/codex"),"no-account-keeps-the-profile-store","CODEX_HOME=/fixture/stores/codex")
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
    vocab : Unit <- vocabulary_checks()
    operations : Unit <- operation_checks()
    binds : Unit <- binding_checks()
    states : Unit <- state_checks()
    selections : Unit <- selection_checks()
    authority : Unit <- authority_checks()
    printed : Unit <- IO.print("fixture-accounts-ok")
    IO.pure(Unit,Unit{})
