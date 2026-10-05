# The tool-probe plan of environment context.
#
# A deployment provider executable is fixed by the deployment selection. A
# request-local `tools` override names its own executable, and the grant
# `executeTarget` is required before any probe of that override runs, including
# an override whose path is the deployment provider's path. `plan_probe`
# produces a plan only after that check: a refused plan carries no argv, so no
# caller can reach a spawn through it.
#
# A probe runs the executable with the single argument `--version`. The
# executable is target-controlled code and may act before it prints anything,
# so the refusal is the whole protection for that case; a returned version and
# a post-execution digest establish nothing about consent.
#
# The probe child runs with the constructed assignment set, not the coordinator
# environment. `probe_env_names` names the assignments the launcher supplies;
# their values belong to the launch boundary.
#
# The fixture executable writes one line to `<markerRoot>/<name>.marker` before
# it prints its version, so a test observes whether the child ran at all.

import Base
import ../../git/text.bend as Tx
import ../../host/process.bend as P
import ./allowlist.bend as A

# What the deployment fixed, or what the request supplied.
type ToolRequest is Data:
  DeploymentTool{name: String, executable: String}
  RequestOverride{name: String, executable: String, executeTarget: Bool}

# A probe plan: the argv to run, or the condition that refused the probe.
type ProbePlan is Data:
  PReady{argv: String, executable: String, operation: String, requestLocal: Bool}
  PRefused{condition: String}

# A tool fact: the resolved executable and version token, or the reason the
# probe produced no version.
type ToolFact is Data:
  ToolResolved{name: String, executable: String, version: String}
  ToolUnavailable{name: String, probes: String, reason: String}

def slash_text() -> String:
  SCon{Char.from_u32(47), SNil{}}

# The fixture marker path: one line per child run of one probe fixture.
def marker_path(root: String, name: String) -> String:
  root ++ slash_text() ++ name ++ ".marker"

# The argv of one version probe: the absolute executable and `--version`.
def probe_argv(executable: String) -> String:
  P.argv([executable, "--version"])

# The assignment names the probe launcher constructs. Values are launch inputs
# and are not part of this module.
def probe_env_names() -> A.Names:
  A.NameCons{"PATH", A.NameCons{"HOME", A.NameCons{"TMPDIR", A.NameCons{"LC_ALL", A.NameNil{}}}}}

# The plan for one probe. The request-local override branch passes through the
# grant check before it can name an executable, so an override without
# `executeTarget` never yields argv.
def plan_probe(request: ToolRequest) -> ProbePlan:
  match request:
    case DeploymentTool{name, executable}:
      PReady{probe_argv(executable), executable, "toolsProbe", False{}}
    case RequestOverride{name, executable, executeTarget}:
      Bool.pick(ProbePlan, executeTarget,
        PReady{probe_argv(executable), executable, "toolsProbe", True{}},
        PRefused{"request-local-tool-override-requires-executeTarget"})

def is_sep(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.pick(Bool, U32.is_eq(code, 32), True{},
  Bool.pick(Bool, U32.is_eq(code, 9), True{},
  Bool.pick(Bool, U32.is_eq(code, 10), True{}, U32.is_eq(code, 13))))

# The first whitespace-separated word that is a version token. Probe output
# spells its version as `v25.8.0`, `bend 2.0.25`, `clang version 20.1.8` and
# `Python 3.14.3`, so the walk reads words in order and keeps the token as
# printed.
def first_version(s: String, +acc: String) -> String:
  match s:
    case SNil{}: Bool.pick(String, A.version_token(acc), acc, SNil{})
    case SCon{+c, +rest}:
      Bool.pick(Bool, is_sep(c),
        on_sep(acc, rest),
        first_version(rest, acc ++ SCon{c, SNil{}}))

def on_sep(+acc: String, rest: String) -> String:
  Bool.pick(String, A.version_token(acc), acc, first_version(rest, SNil{}))

def version_text(s: String) -> String:
  first_version(s, SNil{})

# The fact for one completed probe. Output with no version token leaves the
# version unavailable instead of inventing one.
def tool_fact(name: String, executable: String, stdout: String) -> ToolFact:
  +version = version_text(stdout)
  Bool.pick(ToolFact, Tx.non_empty(version),
    ToolResolved{name, executable, version},
    ToolUnavailable{name, executable, "no-version-token-in-probe-output"})
