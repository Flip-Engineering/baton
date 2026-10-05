# Runtime fixtures of the environment structural allowlist and the tool-probe
# plan. Each case returns an empty string when it passes and a failure line
# otherwise; the program exits 1 when any case fails.
#
# Remote run:
#
#   BEND_NO_TELEMETRY=1 "$BEND" bend2/tests/context-environment/environment-fixtures.bend -o .scratch/bend2/environment-fixtures.c
#   clang -O1 .scratch/bend2/environment-fixtures.c -lm -o .scratch/bend2/environment-fixtures
#   .scratch/bend2/environment-fixtures
#
# Expected: "environment fixtures: all green", exit 0.

import Base
import ../../git/text.bend as Tx
import ../../src/context/environment/allowlist.bend as A
import ../../src/context/environment/facts.bend as F
import ../../src/context/environment/tools.bend as T

type Fails is Data:
  FailsNil{}
  FailsCons{text: String, rest: Fails}

def case_text(name: String, ok: Bool, got: String, want: String) -> String:
  Bool.pick(String, ok, SNil{},
    name ++ ": got [" ++ got ++ "] want [" ++ want ++ "]")

def text_is(name: String, got: String, want: String) -> String:
  case_text(name, String.eq(got, want), got, want)

def bool_eq(a: Bool, b2: Bool) -> Bool:
  Cmp.is_eq(Bool.cmp(a, b2))

def bool_is(name: String, got: Bool, want: Bool) -> String:
  case_text(name, bool_eq(got, want), Bool.show(got), Bool.show(want))

# --- version reduction -------------------------------------------------------

def case_v_prefix() -> String:
  text_is("v prefix", T.version_text("node v25.8.0\n"), "v25.8.0")

def case_named_version() -> String:
  text_is("named version", T.version_text("  bend 2.0.25  \n"), "2.0.25")

def case_word_before_version() -> String:
  text_is("word before version", T.version_text("Homebrew clang version 20.1.8"), "20.1.8")

def case_python_version() -> String:
  text_is("python version", T.version_text("Python 3.14.3"), "3.14.3")

def case_prerelease_version() -> String:
  text_is("prerelease version", T.version_text("20.1.8-beta.1+build.5 (LLVM)"), "20.1.8-beta.1+build.5")

def case_no_version() -> String:
  text_is("no version", T.version_text("no version here"), SNil{})

def case_empty_output() -> String:
  text_is("empty output", T.version_text(SNil{}), SNil{})

def case_lone_v() -> String:
  text_is("lone v", T.version_text("v\n"), SNil{})

def case_tabs_and_carriage_returns() -> String:
  text_is("tabs and carriage returns", T.version_text("\t1.2.3\r\n"), "1.2.3")

# --- the probe plan ----------------------------------------------------------

def case_refused_override_has_no_argv() -> String:
  text_is("refused override", T.plan_condition(T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", False{}})),
    "request-local-tool-override-requires-executeTarget")

def case_refused_override_prints_nothing() -> String:
  text_is("refused override argv", T.plan_argv(T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", False{}})), SNil{})

def case_request_override_names_tools_probe() -> String:
  text_is("request override operation", T.plan_operation(T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", True{}})), "toolsProbe")

def case_request_override_is_request_local() -> String:
  bool_is("request override request local", T.plan_request_local(T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", True{}})), True{})

def case_request_override_argv() -> String:
  text_is("request override argv", T.plan_argv(T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", True{}})),
    T.probe_argv("/opt/providers/node"))

def case_deployment_probe_names_deployment_operation() -> String:
  text_is("deployment operation", T.plan_operation(T.plan_probe(T.DeploymentTool{"node", "/opt/providers/node"})), "deploymentToolProbe")

def case_deployment_probe_is_not_request_local() -> String:
  bool_is("deployment request local", T.plan_request_local(T.plan_probe(T.DeploymentTool{"node", "/opt/providers/node"})), False{})

def case_same_path_override_without_grant_refuses() -> String:
  text_is("same path override", T.plan_condition(T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", False{}})),
    "request-local-tool-override-requires-executeTarget")

# --- the probe environment and the marker path -------------------------------

def case_env_names_are_the_four() -> String:
  bool_is("PATH", A.names_has(T.probe_env_names(), "PATH"), True{})

def case_env_names_exclude_an_unlisted_name() -> String:
  bool_is("OLDPWD", A.names_has(T.probe_env_names(), "OLDPWD"), False{})

def case_env_names_exclude_a_credential_name() -> String:
  bool_is("API_KEY", A.names_has(T.probe_env_names(), "API_KEY"), False{})

def case_marker_path() -> String:
  text_is("marker path", T.marker_path("/tmp/ctx", "node"), "/tmp/ctx/node.marker")

# --- the field table ---------------------------------------------------------

def case_command_field_has_no_value() -> String:
  bool_is("command field", A.is_admit(F.field_text_admission("command", "curl http://example.invalid")), False{})

def case_version_field_admits_a_version() -> String:
  bool_is("version field", A.is_admit(F.field_text_admission("tool.version", "v25.8.0")), True{})

def fails() -> Fails:
  FailsCons{case_v_prefix(),
  FailsCons{case_named_version(),
  FailsCons{case_word_before_version(),
  FailsCons{case_python_version(),
  FailsCons{case_prerelease_version(),
  FailsCons{case_no_version(),
  FailsCons{case_empty_output(),
  FailsCons{case_lone_v(),
  FailsCons{case_tabs_and_carriage_returns(),
  FailsCons{case_refused_override_has_no_argv(),
  FailsCons{case_refused_override_prints_nothing(),
  FailsCons{case_request_override_names_tools_probe(),
  FailsCons{case_request_override_is_request_local(),
  FailsCons{case_request_override_argv(),
  FailsCons{case_deployment_probe_names_deployment_operation(),
  FailsCons{case_deployment_probe_is_not_request_local(),
  FailsCons{case_same_path_override_without_grant_refuses(),
  FailsCons{case_env_names_are_the_four(),
  FailsCons{case_env_names_exclude_an_unlisted_name(),
  FailsCons{case_env_names_exclude_a_credential_name(),
  FailsCons{case_marker_path(),
  FailsCons{case_command_field_has_no_value(),
  FailsCons{case_version_field_admits_a_version(),
  FailsNil{}}}}}}}}}}}}}}}}}}}}}}}

def report(rest: Fails, taken: Fails) -> Fails:
  match rest:
    case FailsNil{}: taken
    case FailsCons{+text, +tail}:
      Bool.pick(Fails, String.is_empty(text), report(tail, taken), report(tail, FailsCons{text, taken}))

def count(fs: Fails, n: U32) -> U32:
  match fs:
    case FailsNil{}: n
    case FailsCons{+text, +rest}: count(rest, U32.inc(n))

def join(fs: Fails) -> String:
  match fs:
    case FailsNil{}: SNil{}
    case FailsCons{+text, +rest}: text ++ SCon{Char.from_u32(10), SNil{}} ++ join(rest)

def main() -> IO(Unit):
  do IO<Unit>:
    +bad = report(fails(), FailsNil{})
    +n = count(bad, 0)
    Bool.pick(IO(Unit), U32.is_zero(n),
      IO.print("environment fixtures: all green"),
      IO.die(Unit, 1, "environment fixtures: " ++ U32.show(n) ++ " failures\n" ++ join(bad)))
