# CLAIM: this pure refusal model carries two readers of one vocabulary — the table
# the validator judges by and the reader that composes the explanation — so the
# laws in ../laws.bend detect a drift between them, and the composed context
# carries no secret material.
# Scope: model only. The application's own refusal rows are not imported; the two
# readers stand for the validation table and the refusals composed from it.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base

type Check is Data:
  UnknownField{}
  ClosedSet{}
  RequiredField{}
  IdentityKeyed{}
  ShaUnresolved{}
  PublishUndeclared{}

type Field is Data:
  Args{}
  Payload{}
  BodyCommit{}
  Deployment{}

type Rule is Data:
  UnknownFieldRule{}
  ClosedSetRule{}
  RequiredRule{}
  IdentityKeyedRule{}
  ShaResolvesRule{}
  PublishDeclarationRule{}

type Remedy is Data:
  Admitted{n: Nat}
  Unknown{}

type Context is Data:
  Safe{v: Nat}
  WithSecret{s: Nat}

type Refusal is Data:
  Refusal{field: Field, rule: Rule, remedy: Remedy, context: Nat}

# ── the table the validator judges by ─────────────────────────────────────────
def table_field(k: Check) -> Field:
  match k:
    case UnknownField{}: Args{}
    case ClosedSet{}: Payload{}
    case RequiredField{}: Payload{}
    case IdentityKeyed{}: Args{}
    case ShaUnresolved{}: BodyCommit{}
    case PublishUndeclared{}: Deployment{}

def table_rule(k: Check) -> Rule:
  match k:
    case UnknownField{}: UnknownFieldRule{}
    case ClosedSet{}: ClosedSetRule{}
    case RequiredField{}: RequiredRule{}
    case IdentityKeyed{}: IdentityKeyedRule{}
    case ShaUnresolved{}: ShaResolvesRule{}
    case PublishUndeclared{}: PublishDeclarationRule{}

# The values the row admits. Zero where the row admits none.
def table_admitted(k: Check) -> Nat:
  match k:
    case UnknownField{}: 0n
    case ClosedSet{}: 2n
    case RequiredField{}: 0n
    case IdentityKeyed{}: 0n
    case ShaUnresolved{}: 0n
    case PublishUndeclared{}: 1n

# The remedy the row expects: grounded in the admitted values, or explicitly
# unknown where the row admits none.
def table_rem(k: Check) -> Remedy:
  match k:
    case UnknownField{}: Unknown{}
    case ClosedSet{}: Admitted{table_admitted(k)}
    case RequiredField{}: Unknown{}
    case IdentityKeyed{}: Unknown{}
    case ShaUnresolved{}: Unknown{}
    case PublishUndeclared{}: Admitted{table_admitted(k)}

# ── the reader that composes the explanation, written independently ───────────
def render_field(k: Check) -> Field:
  match k:
    case UnknownField{}: Args{}
    case ClosedSet{}: Payload{}
    case RequiredField{}: Payload{}
    case IdentityKeyed{}: Args{}
    case ShaUnresolved{}: BodyCommit{}
    case PublishUndeclared{}: Deployment{}

def render_rule(k: Check) -> Rule:
  match k:
    case UnknownField{}: UnknownFieldRule{}
    case ClosedSet{}: ClosedSetRule{}
    case RequiredField{}: RequiredRule{}
    case IdentityKeyed{}: IdentityKeyedRule{}
    case ShaUnresolved{}: ShaResolvesRule{}
    case PublishUndeclared{}: PublishDeclarationRule{}

def render_rem(k: Check) -> Remedy:
  match k:
    case UnknownField{}: Unknown{}
    case ClosedSet{}: Admitted{2n}
    case RequiredField{}: Unknown{}
    case IdentityKeyed{}: Unknown{}
    case ShaUnresolved{}: Unknown{}
    case PublishUndeclared{}: Admitted{1n}

# The rendered context carries no secret material: a secret input redacts.
def redact(c: Context) -> Nat:
  match c:
    case Safe{+v}: v
    case WithSecret{_}: 0n

def explain(+k: Check, c: Context) -> Refusal:
  Refusal{render_field(k), render_rule(k), render_rem(k), redact(c)}

# Readers over a composed refusal, so a law can state which entry governs it.
def field_of(r: Refusal) -> Field:
  match r:
    case Refusal{+field, _, _, _}: field

def rule_of(r: Refusal) -> Rule:
  match r:
    case Refusal{_, +rule, _, _}: rule

def remedy_of(r: Refusal) -> Remedy:
  match r:
    case Refusal{_, _, +remedy, _}: remedy

def context_of(r: Refusal) -> Nat:
  match r:
    case Refusal{_, _, _, +context}: context
