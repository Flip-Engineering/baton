# Public admission laws for values that combine nested schema forms.

import Base
import ./codec.bend as Codec
import ./codec-schema.bend as Schema

def integration_profile() -> Schema.SchemaForm:
  Schema.SfRecord{Schema.SfFieldsCons{
    Schema.SfRequired{"meta", Schema.SfJson{}},
    Schema.SfFieldsCons{
      Schema.SfRequired{"items", Schema.SfArray{Schema.SfDict{
        Schema.SkDeclared{Schema.NlCons{"entry", Schema.NlNil{}}},
        Schema.SfRecord{Schema.SfFieldsCons{
          Schema.SfRequired{"code", Schema.SfScalar{Schema.SsText{}}},
          Schema.SfFieldsCons{
            Schema.SfOptionalField{"note", Schema.SfOptional{Schema.SfScalar{Schema.SsText{}}}},
            Schema.SfFieldsNil{}
          }
        }}
      }}},
      Schema.SfFieldsCons{
        Schema.SfRequired{"name", Schema.SfScalar{Schema.SsText{}}},
        Schema.SfFieldsNil{}
      }
    }
  }}

def integration_entry(code: String) -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"entry",
    Codec.Robj{Codec.Rpair{"code", Codec.Rstr{code}, Codec.Rnil{}}},
    Codec.Rnil{}}}

def integration_value() -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"sample"},
    Codec.Rpair{"items",
      Codec.Rarr{integration_entry("one"),
        Codec.Rarr{integration_entry("two"), Codec.Rnil{}}},
      Codec.Rpair{"meta",
        Codec.Robj{Codec.Rpair{"context",
          Codec.Rarr{Codec.Robj{Codec.Rpair{"enabled", Codec.Rtrue{}, Codec.Rnil{}}}, Codec.Rnil{}},
          Codec.Rnil{}}},
        Codec.Rnil{}}}}}

def integration_value_with_bad_second_entry() -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"sample"},
    Codec.Rpair{"items",
      Codec.Rarr{integration_entry("one"),
        Codec.Rarr{Codec.Robj{Codec.Rpair{"entry",
          Codec.Robj{Codec.Rpair{"code", Codec.Rnum{"2"}, Codec.Rnil{}}},
          Codec.Rnil{}}}, Codec.Rnil{}}},
      Codec.Rpair{"meta",
        Codec.Robj{Codec.Rpair{"context",
          Codec.Rarr{Codec.Robj{Codec.Rpair{"enabled", Codec.Rtrue{}, Codec.Rnil{}}}, Codec.Rnil{}},
          Codec.Rnil{}}},
        Codec.Rnil{}}}}}

law codec_schema_integration_reordered_nested_value_admits:
  {Schema.schema_admit_value(Schema.DefsNil{}, integration_profile(), integration_value()) == Schema.SvOk{} : Schema.SchemaVerdict}

def codec_schema_integration_reordered_nested_value_admits():
  {==}

law codec_schema_integration_reordered_nested_value_checks_second_nested_leaf:
  {Schema.schema_admit_value(Schema.DefsNil{}, integration_profile(), integration_value_with_bad_second_entry()) == Schema.SvRefused{"wrongKind"} : Schema.SchemaVerdict}

def codec_schema_integration_reordered_nested_value_checks_second_nested_leaf():
  {==}

law codec_schema_integration_public_json_profile_refuses_nested_duplicate_keys:
  {Schema.schema_admit_value(Schema.DefsNil{}, Schema.SfJson{}, Codec.Robj{Codec.Rpair{"outer",
    Codec.Rarr{Codec.Robj{Codec.Rpair{"inner", Codec.Rstr{"a"}, Codec.Rpair{"inner", Codec.Rstr{"b"}, Codec.Rnil{}}}}, Codec.Rnil{}},
    Codec.Rnil{}}}) == Schema.SvRefused{"duplicateKey"} : Schema.SchemaVerdict}

def codec_schema_integration_public_json_profile_refuses_nested_duplicate_keys():
  {==}

def branching_node_defs() -> Schema.SchemaDefs:
  Schema.DefsCons{Schema.SchemaDef{"node", Schema.SfRecord{Schema.SfFieldsCons{
    Schema.SfRequired{"id", Schema.SfScalar{Schema.SsText{}}},
    Schema.SfFieldsCons{
      Schema.SfOptionalField{"left", Schema.SfRef{"node"}},
      Schema.SfFieldsCons{
        Schema.SfOptionalField{"right", Schema.SfRef{"node"}},
        Schema.SfFieldsNil{}
      }
    }
  }}}, Schema.DefsNil{}}

def branching_node_leaf(id: String) -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"id", Codec.Rstr{id}, Codec.Rnil{}}}

def branching_node_left(id: String, child: Codec.RawValue) -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"id", Codec.Rstr{id},
    Codec.Rpair{"left", child, Codec.Rnil{}}}}

def branching_node_value() -> Codec.RawValue:
  branching_node_left("root", branching_node_left("middle", branching_node_leaf("leaf")))

def branching_node_value_with_bad_leaf() -> Codec.RawValue:
  branching_node_left("root", branching_node_left("middle",
    Codec.Robj{Codec.Rpair{"id", Codec.Rnum{"3"}, Codec.Rnil{}}}))

# Each recursive record has two optional recursive fields. The value selects the
# left field at two levels and omits every right field.
law codec_schema_integration_guarded_branching_path_admits:
  {Schema.schema_admit_value(branching_node_defs(), Schema.SfRef{"node"}, branching_node_value()) == Schema.SvOk{} : Schema.SchemaVerdict}

def codec_schema_integration_guarded_branching_path_admits():
  {==}

law codec_schema_integration_guarded_branching_path_checks_selected_leaf:
  {Schema.schema_admit_value(branching_node_defs(), Schema.SfRef{"node"}, branching_node_value_with_bad_leaf()) == Schema.SvRefused{"wrongKind"} : Schema.SchemaVerdict}

def codec_schema_integration_guarded_branching_path_checks_selected_leaf():
  {==}
