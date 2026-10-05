# The TypeScript configuration table of environment context.
#
# Each recognized compiler option names the value shape its field admits: an
# explicit value set for an enum option, a boolean, an unsigned decimal for a
# count, a path, or a list of one of those. An option the table does not
# recognize has no automatic value field.
#
# The extends chain is the sequence of configuration files an effective
# configuration reads. Every file in that sequence enters the result's
# dependency set, so an edit to a base file invalidates a result whose own
# configuration file did not change.
#
# Reference: docs/bend2/semantic-context-spec.md, Environment and general
# projections.

import Base
import ../../json/canonical.bend as J
import ./allowlist.bend as A

# The configuration files of one effective configuration, ordered from the
# most distant base to the selected file.
type Configs is Data:
  CfgNil{}
  CfgCons{config: J.Json, path: String, rest: Configs}

# Where an option's effective value was defined.
type Eff is Data:
  EffNotFound{}
  EffAt{index: U32}

def names_enum(names: A.Names) -> A.Spec:
  A.SpecEnum{names}

def names_list(names: A.Names) -> A.Spec:
  A.SpecEnumList{names}

# --- value sets --------------------------------------------------------------

def target_values() -> A.Names:
  A.NameCons{"es3", A.NameCons{"es5", A.NameCons{"es6", A.NameCons{"es2015", A.NameCons{"es2016",
  A.NameCons{"es2017", A.NameCons{"es2018", A.NameCons{"es2019", A.NameCons{"es2020", A.NameCons{"es2021",
  A.NameCons{"es2022", A.NameCons{"es2023", A.NameCons{"es2024", A.NameCons{"esnext", A.NameNil{}}}}}}}}}}}}}}}

def module_values() -> A.Names:
  A.NameCons{"none", A.NameCons{"commonjs", A.NameCons{"amd", A.NameCons{"umd", A.NameCons{"system",
  A.NameCons{"es6", A.NameCons{"es2015", A.NameCons{"es2020", A.NameCons{"es2022", A.NameCons{"esnext",
  A.NameCons{"node16", A.NameCons{"node18", A.NameCons{"nodenext", A.NameCons{"preserve", A.NameNil{}}}}}}}}}}}}}}}

def resolution_values() -> A.Names:
  A.NameCons{"classic", A.NameCons{"node10", A.NameCons{"node16", A.NameCons{"nodenext", A.NameCons{"bundler", A.NameNil{}}}}}

def jsx_values() -> A.Names:
  A.NameCons{"preserve", A.NameCons{"react", A.NameCons{"react-jsx", A.NameCons{"react-jsxdev", A.NameCons{"react-native", A.NameNil{}}}}}

def newline_values() -> A.Names:
  A.NameCons{"crlf", A.NameCons{"lf", A.NameNil{}}

def lib_values() -> A.Names:
  A.NameCons{"es5", A.NameCons{"es2015", A.NameCons{"es2016", A.NameCons{"es2017", A.NameCons{"es2018",
  A.NameCons{"es2019", A.NameCons{"es2020", A.NameCons{"es2021", A.NameCons{"es2022", A.NameCons{"es2023",
  A.NameCons{"es2024", A.NameCons{"esnext", A.NameCons{"dom", A.NameCons{"dom.iterable", A.NameCons{"webworker",
  A.NameCons{"scripthost", A.NameNil{}}}}}}}}}}}}}}}}}

# --- the option table --------------------------------------------------------

def bool_opt() -> A.Spec:
  A.SpecScalar{A.KBool{}}

def number_opt() -> A.Spec:
  A.SpecScalar{A.KNumber{}}

def path_opt() -> A.Spec:
  A.SpecScalar{A.KPath{}}

def path_list_opt() -> A.Spec:
  A.SpecList{A.KPath{}}

def name_list_opt() -> A.Spec:
  A.SpecList{A.KKey{}}

def not_recognized() -> A.Spec:
  A.SpecNone{"unrecognized-compiler-option"}

# One row per recognized option. The chain ends at NotRecognized, so every
# option outside this table carries no automatic value field.
type OptRow is Data:
  OptRowEnd{}
  OptRowCons{key: String, spec: A.Spec, rest: OptRow}

def opt_table() -> OptRow:
  OptRowCons{"strict", bool_opt(),
  OptRowCons{"noImplicitAny", bool_opt(),
  OptRowCons{"strictNullChecks", bool_opt(),
  OptRowCons{"strictFunctionTypes", bool_opt(),
  OptRowCons{"strictBindCallApply", bool_opt(),
  OptRowCons{"strictPropertyInitialization", bool_opt(),
  OptRowCons{"noImplicitThis", bool_opt(),
  OptRowCons{"alwaysStrict", bool_opt(),
  OptRowCons{"useUnknownInCatchVariables", bool_opt(),
  OptRowCons{"composite", bool_opt(),
  OptRowCons{"declaration", bool_opt(),
  OptRowCons{"declarationMap", bool_opt(),
  OptRowCons{"noEmit", bool_opt(),
  OptRowCons{"esModuleInterop", bool_opt(),
  OptRowCons{"allowJs", bool_opt(),
  OptRowCons{"checkJs", bool_opt(),
  OptRowCons{"skipLibCheck", bool_opt(),
  OptRowCons{"isolatedModules", bool_opt(),
  OptRowCons{"incremental", bool_opt(),
  OptRowCons{"resolveJsonModule", bool_opt(),
  OptRowCons{"forceConsistentCasingInFileNames", bool_opt(),
  OptRowCons{"noUncheckedIndexedAccess", bool_opt(),
  OptRowCons{"exactOptionalPropertyTypes", bool_opt(),
  OptRowCons{"removeComments", bool_opt(),
  OptRowCons{"sourceMap", bool_opt(),
  OptRowCons{"inlineSourceMap", bool_opt(),
  OptRowCons{"downlevelIteration", bool_opt(),
  OptRowCons{"useDefineForClassFields", bool_opt(),
  OptRowCons{"verbatimModuleSyntax", bool_opt(),
  OptRowCons{"allowSyntheticDefaultImports", bool_opt(),
  OptRowCons{"noEmitOnError", bool_opt(),
  OptRowCons{"preserveConstEnums", bool_opt(),
  OptRowCons{"noImplicitReturns", bool_opt(),
  OptRowCons{"noFallthroughCasesInSwitch", bool_opt(),
  OptRowCons{"maxNodeModuleJsDepth", number_opt(),
  OptRowCons{"target", names_enum(target_values()),
  OptRowCons{"module", names_enum(module_values()),
  OptRowCons{"moduleResolution", names_enum(resolution_values()),
  OptRowCons{"jsx", names_enum(jsx_values()),
  OptRowCons{"newLine", names_enum(newline_values()),
  OptRowCons{"lib", names_list(lib_values()),
  OptRowCons{"rootDir", path_opt(),
  OptRowCons{"outDir", path_opt(),
  OptRowCons{"baseUrl", path_opt(),
  OptRowCons{"declarationDir", path_opt(),
  OptRowCons{"tsBuildInfoFile", path_opt(),
  OptRowCons{"outFile", path_opt(),
  OptRowCons{"include", path_list_opt(),
  OptRowCons{"exclude", path_list_opt(),
  OptRowCons{"files", path_list_opt(),
  OptRowCons{"typeRoots", path_list_opt(),
  OptRowCons{"paths", path_list_opt(),
  OptRowCons{"types", name_list_opt(),
  OptRowEnd{}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}

def lookup_row(key: String, rows: OptRow) -> A.Spec:
  match rows:
    case OptRowEnd{}: not_recognized()
    case OptRowCons{+k, +spec, +rest}:
      Bool.pick(A.Spec, String.eq(k, key), spec, lookup_row(key, rest))

# The value shape of one compiler option.
def option_spec(key: String) -> A.Spec:
  lookup_row(key, opt_table())

# The decision for one compiler option value.
def option_admission(key: String, value: J.Json) -> A.Admission:
  A.admit_value(option_spec(key), value)

# --- the extends chain -------------------------------------------------------

def is_dot(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 46)

def is_slash(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 47)

# A relative or absolute path specifier. A bare package specifier resolves
# through the package resolver, which this table does not read.
def relative_specifier(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, +rest}:
      Bool.pick(Bool, is_slash(c), True{}, Bool.pick(Bool, is_dot(c), True{}, False{}))

def word_cons(name: String, rest: A.Words) -> A.Words:
  A.WordCons{name, rest}

def words_append(one: A.Words, rest: A.Words) -> A.Words:
  match one:
    case A.WordNil{}: rest
    case A.WordCons{head, tail}: A.WordCons{head, words_append(tail, rest)}

# The specifiers of one config's extends field, in the order written. The
# string and array forms both contribute; a package specifier contributes no
# entry here and is reported by the caller as unsupported.
def array_specifiers(items: J.Json) -> A.Words:
  match items:
    case J.Jarr{head, tail}: word_cons(specifier_of(head), array_specifiers(tail))
    case J.Jnil{}: A.WordNil{}
    case J.Jnull{}: A.WordNil{}
    case J.Jtrue{}: A.WordNil{}
    case J.Jfalse{}: A.WordNil{}
    case J.Jint{value}: A.WordNil{}
    case J.Jstr{value}: A.WordNil{}
    case J.Jobj{members}: A.WordNil{}
    case J.Jpair{key, value, rest}: A.WordNil{}

def specifier_of(j: J.Json) -> String:
  match j:
    case J.Jstr{value}: value
    case J.Jnull{}: SNil{}
    case J.Jtrue{}: SNil{}
    case J.Jfalse{}: SNil{}
    case J.Jint{value}: SNil{}
    case J.Jarr{head, tail}: SNil{}
    case J.Jobj{members}: SNil{}
    case J.Jpair{key, value, rest}: SNil{}
    case J.Jnil{}: SNil{}

def field_of(members: J.Json, key: String) -> J.Json:
  match members:
    case J.Jpair{+k, +value, +rest}:
      Bool.pick(J.Json, String.eq(k, key), value, field_of(rest, key))
    case J.Jnil{}: J.Jnil{}
    case J.Jnull{}: J.Jnil{}
    case J.Jtrue{}: J.Jnil{}
    case J.Jfalse{}: J.Jnil{}
    case J.Jint{value}: J.Jnil{}
    case J.Jstr{value}: J.Jnil{}
    case J.Jarr{head, tail}: J.Jnil{}
    case J.Jobj{members2}: J.Jnil{}

def extends_specifiers(config: J.Json) -> A.Words:
  +field = field_of(config, "extends")
  match field:
    case J.Jstr{value}: word_cons(value, A.WordNil{})
    case J.Jarr{head, tail}: array_specifiers(field)
    case J.Jnull{}: A.WordNil{}
    case J.Jtrue{}: A.WordNil{}
    case J.Jfalse{}: A.WordNil{}
    case J.Jint{value}: A.WordNil{}
    case J.Jobj{members}: A.WordNil{}
    case J.Jpair{key, value, rest}: A.WordNil{}
    case J.Jnil{}: A.WordNil{}

# Every file of the chain enters the dependency set. The selected file is the
# last entry, and each entry's own specifiers precede it in its base-first
# position.
def chain_paths(chain: Configs, acc: A.Words) -> A.Words:
  match chain:
    case CfgNil{}: acc
    case CfgCons{+config, +path, +rest}: chain_paths(rest, word_cons(path, acc))

# The index of the last configuration in the chain that defines the option.
def effective_at(chain: Configs, +key: String, index: U32, found: Eff) -> Eff:
  match chain:
    case CfgNil{}: found
    case CfgCons{+config, +path, +rest}:
      +members = field_of(config, "compilerOptions")
      +present = Bool.not(node_is_nil(field_of(members, key)))
      +next = Bool.pick(Eff, present, EffAt{index}, found)
      effective_at(rest, key, U32.inc(index), next)

def node_is_nil(j: J.Json) -> Bool:
  match j:
    case J.Jnil{}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{value}: False{}
    case J.Jstr{value}: False{}
    case J.Jarr{head, tail}: False{}
    case J.Jobj{members}: False{}
    case J.Jpair{key, value, rest}: False{}

def effective_index(chain: Configs, key: String) -> Eff:
  effective_at(chain, key, 0, EffNotFound{})

# The effective value of one option: the definition in the last chain entry
# that sets it.
def effective_value(chain: Configs, key: String) -> J.Json:
  match effective_index(chain, key):
    case EffNotFound{}: J.Jnil{}
    case EffAt{index}: value_at(chain, index, key)

def value_at(chain: Configs, index: U32, +key: String) -> J.Json:
  match chain:
    case CfgNil{}: J.Jnil{}
    case CfgCons{+config, +path, +rest}:
      Bool.pick(J.Json, U32.is_zero(index),
        field_of(field_of(config, "compilerOptions"), key),
        value_at(rest, U32.sub(index, 1), key))
