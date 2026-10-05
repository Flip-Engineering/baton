# The field table of the environment result document.
#
# Each field path names the value shape that field admits. A field that carries
# free-form project content has no automatic value field, so a reader of the
# result sees the same enumeration the producer applies.
#
# The value-carrying kinds are: a validated version token, a declared
# dependency range, a key name, an explicit path, a name from an option's value
# set, a boolean, an unsigned decimal and a file-presence boolean. A whole file's
# contents are not a field of this document.
#
# Reference: docs/bend2/semantic-context-spec.md, Environment and general
# projections; allowlist.bend states the grammars.

import Base
import ./allowlist.bend as A
import ./tsconfig.bend as TS

def enum_of(names: A.Names) -> A.Spec:
  A.SpecEnum{names}

def enum_list_of(names: A.Names) -> A.Spec:
  A.SpecEnumList{names}

def bool_field() -> A.Spec:
  A.SpecScalar{A.KBool{}}

def number_field() -> A.Spec:
  A.SpecScalar{A.KNumber{}}

def key_field() -> A.Spec:
  A.SpecScalar{A.KKey{}}

def version_field() -> A.Spec:
  A.SpecScalar{A.KVersion{}}

def range_field() -> A.Spec:
  A.SpecScalar{A.KRange{}}

def path_field() -> A.Spec:
  A.SpecScalar{A.KPath{}}

def path_list_field() -> A.Spec:
  A.SpecList{A.KPath{}}

def no_value_field() -> A.Spec:
  A.SpecNone{"no-automatic-value-field"}

# How a manifest, a lockfile and a resolved tree disagree.
def disagreement_values() -> A.Names:
  A.NameCons{"range-not-satisfied", A.NameCons{"declared-not-installed", A.NameCons{"installed-not-declared",
  A.NameCons{"lock-differs-from-manifest", A.NameNil{}}}}

# Why a tool probe produced no version.
def unavailable_values() -> A.Names:
  A.NameCons{"executable-absent", A.NameCons{"probe-failed", A.NameCons{"no-version-token-in-probe-output",
  A.NameCons{"not-admitted", A.NameNil{}}}}

# The dependency conditions a Compose document declares.
def condition_values() -> A.Names:
  A.NameCons{"service_started", A.NameCons{"service_healthy", A.NameCons{"service_completed_successfully", A.NameNil{}}}}

# The frontend option names this profile admits without their arguments.
def frontend_values() -> A.Names:
  A.NameCons{"-I", A.NameCons{"-isystem", A.NameCons{"-iquote", A.NameCons{"-idirafter", A.NameCons{"-include",
  A.NameCons{"-isysroot", A.NameCons{"-std", A.NameCons{"-nostdinc", A.NameNil{}}}}}}}}}

type FieldRow is Data:
  FieldRowEnd{}
  FieldRowCons{field: String, spec: A.Spec, rest: FieldRow}

def field_table() -> FieldRow:
  FieldRowCons{"dependency.declared.name", key_field(),
  FieldRowCons{"dependency.declared.range", range_field(),
  FieldRowCons{"dependency.locked.name", key_field(),
  FieldRowCons{"dependency.locked.version", version_field(),
  FieldRowCons{"dependency.locked.dev", bool_field(),
  FieldRowCons{"dependency.locked.optional", bool_field(),
  FieldRowCons{"dependency.installed.name", key_field(),
  FieldRowCons{"dependency.installed.version", version_field(),
  FieldRowCons{"dependency.installed.origin.path", path_field(),
  FieldRowCons{"dependency.disagreement.name", key_field(),
  FieldRowCons{"dependency.disagreement.declared", range_field(),
  FieldRowCons{"dependency.disagreement.installed", version_field(),
  FieldRowCons{"dependency.disagreement.detail", enum_of(disagreement_values()),
  FieldRowCons{"tool.name", key_field(),
  FieldRowCons{"tool.executable", path_field(),
  FieldRowCons{"tool.version", version_field(),
  FieldRowCons{"tool.probes", path_list_field(),
  FieldRowCons{"tool.reason", enum_of(unavailable_values()),
  FieldRowCons{"config.file", path_field(),
  FieldRowCons{"config.present", bool_field(),
  FieldRowCons{"config.chain.path", path_field(),
  FieldRowCons{"readRoot.path", path_field(),
  FieldRowCons{"service.name", key_field(),
  FieldRowCons{"service.dependency.from", key_field(),
  FieldRowCons{"service.dependency.to", key_field(),
  FieldRowCons{"service.dependency.condition", enum_of(condition_values()),
  FieldRowCons{"service.port.service", key_field(),
  FieldRowCons{"service.port.published", number_field(),
  FieldRowCons{"service.port.target", number_field(),
  FieldRowCons{"service.network.service", key_field(),
  FieldRowCons{"service.network.network", key_field(),
  FieldRowCons{"service.volume.service", key_field(),
  FieldRowCons{"service.volume.target", path_field(),
  FieldRowCons{"service.secret.service", key_field(),
  FieldRowCons{"service.secret.name", key_field(),
  FieldRowCons{"dotenv.path", path_field(),
  FieldRowCons{"dotenv.key", key_field(),
  FieldRowCons{"dotenv.present", bool_field(),
  FieldRowCons{"build.command.file", path_field(),
  FieldRowCons{"build.command.directory", path_field(),
  FieldRowCons{"build.command.options", enum_list_of(frontend_values()),
  FieldRowCons{"build.command.optionPaths", path_list_field(),
  FieldRowCons{"command", no_value_field(),
  FieldRowCons{"definition", no_value_field(),
  FieldRowCons{"optionValue", no_value_field(),
  FieldRowCons{"image", no_value_field(),
  FieldRowCons{"endpoint", no_value_field(),
  FieldRowCons{"url", no_value_field(),
  FieldRowCons{"scriptBody", no_value_field(),
  FieldRowCons{"envValue", no_value_field(),
  FieldRowCons{"credential", no_value_field(),
  FieldRowEnd{}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}

def field_lookup(field: String, rows: FieldRow) -> A.Spec:
  match rows:
    case FieldRowEnd{}: no_value_field()
    case FieldRowCons{+f, +spec, +rest}:
      Bool.pick(A.Spec, String.eq(f, field), spec, field_lookup(field, rest))

# The value shape of one field of the result document. A free-form field and an
# unknown field both admit no value.
def field_spec(field: String) -> A.Spec:
  field_lookup(field, field_table())

# The decision for one field and one candidate value.
def field_admission(field: String, value: J.Json) -> A.Admission:
  A.admit_value(field_spec(field), value)
