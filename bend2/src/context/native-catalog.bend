# Decode the installed provider inventory into the existing declaration catalog.
# The provider supplies package verification; this adapter preserves its declared
# identities and refuses malformed inventory rows before selection.
import Base
import ../json/canonical.bend as J
import ./request.bend as Req
import ./codec.bend as Codec
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./native-declaration.bend as NativeDecl

type CatalogDecode is Data:
  CatalogDecoded{catalog: Decl.Cat, inventory: Decl.Inv, installed: Eng.SS}
  CatalogRefused{condition: String}

def member_value(found: Maybe<&2, J.Json>) -> J.Json:
  match found:
    case None{}: J.Jnil{}
    case Some{+value}: value

def member(+object: J.Json, +key: String) -> J.Json:
  member_value(Req.member_lookup(key, object))

def field(+object: J.Json, +key: String) -> String:
  Req.text_of(member(object, key))

def is_array(+value: J.Json) -> Bool:
  match value:
    case J.Jarr{head, tail}: True{}
    case other: False{}

def artifact_items(+items: J.Json) -> Decl.Arts:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Decl.ArtsNil{}
    case J.Jarr{+head, +tail}:
      Decl.ArtsCons{Decl.Art{field(head, "packagePath"), field(head, "sha256"), field(head, "role")}, artifact_items(tail)}
    case other: Decl.ArtsNil{}

def merge_arts(+left: Decl.Arts, +right: Decl.Arts) -> Decl.Arts:
  match left:
    case Decl.ArtsNil{}: right
    case Decl.ArtsCons{+head, +rest}: Decl.ArtsCons{head, merge_arts(rest, right)}

def merge_digs(+left: Decl.Digs, +right: Decl.Digs) -> Decl.Digs:
  match left:
    case Decl.DigsNil{}: right
    case Decl.DigsCons{+head, +rest}: Decl.DigsCons{head, merge_digs(rest, right)}

def merge_ss(+left: Eng.SS, +right: Eng.SS) -> Eng.SS:
  match left:
    case Eng.SSNil{}: right
    case Eng.SSCons{+head, +rest}: Eng.SSCons{head, merge_ss(rest, right)}

def merge_inv(+left: Decl.Inv, +right: Decl.Inv) -> Decl.Inv:
  match left:
    case Decl.Inv{artifacts, schemas, digests}:
      match right:
        case Decl.Inv{r_artifacts, r_schemas, r_digests}:
          Decl.Inv{merge_arts(artifacts, r_artifacts), merge_ss(schemas, r_schemas), merge_digs(digests, r_digests)}

def append_catalog(+catalog: Decl.Cat, +declaration: Decl.Decl) -> Decl.Cat:
  match catalog:
    case Decl.CatNil{}: Decl.CatCons{declaration, Decl.CatNil{}}
    case Decl.CatCons{+head, +rest}: Decl.CatCons{head, append_catalog(rest, declaration)}

def decoded_declaration(+row: J.Json, decoded: NativeDecl.DeclarationDecode) -> CatalogDecode:
  match decoded:
    case NativeDecl.DeclarationRefused{field}: CatalogRefused{"moduleDeclaration:" ++ field}
    case NativeDecl.DeclarationDecoded{declaration, inventory}:
      Bool.pick(CatalogDecode,
        Bool.and(String.eq(Decl.decl_module_id(declaration), field(row, "moduleId")),
                 is_array(member(member(row, "declaration"), "schemaIdentities"))),
        CatalogDecoded{Decl.CatCons{declaration, Decl.CatNil{}}, inventory, Eng.ss_one(field(row, "moduleId"))},
        CatalogRefused{"inventoryModuleIdentity"})

def decoded_row(+row: J.Json) -> CatalogDecode:
  decoded_declaration(row, NativeDecl.decode(member(row, "declaration"), field(row, "declarationDigest")))

def catalog_tail_join(catalog: Decl.Cat, +inventory: Decl.Inv, +installed: Eng.SS,
                      tail: CatalogDecode) -> CatalogDecode:
  match tail:
    case CatalogRefused{condition}: CatalogRefused{condition}
    case CatalogDecoded{next_catalog, next_inventory, next_installed}:
      match catalog:
        case Decl.CatCons{declaration, ignored}:
          CatalogDecoded{append_catalog(next_catalog, declaration), merge_inv(inventory, next_inventory), merge_ss(installed, next_installed)}
        case Decl.CatNil{}: CatalogRefused{"inventoryDeclarationMissing"}

def catalog_tail_row(+tail: J.Json, row: CatalogDecode) -> CatalogDecode:
  match row:
    case CatalogRefused{condition}: CatalogRefused{condition}
    case CatalogDecoded{catalog, inventory, installed}:
      catalog_tail_join(catalog, inventory, installed, catalog_tail(tail))

def catalog_tail(+rows: J.Json) -> CatalogDecode:
  match rows:
    case J.Jarr{J.Jnil{}, J.Jnil{}}:
      CatalogDecoded{Decl.CatNil{}, Decl.Inv{Decl.ArtsNil{}, Eng.ss_empty(), Decl.DigsNil{}}, Eng.ss_empty()}
    case J.Jarr{+head, +tail}: catalog_tail_row(tail, decoded_row(head))
    case other: CatalogRefused{"inventoryModulesMalformed"}

def inventory_value(+value: J.Json) -> CatalogDecode:
  match value:
    case J.Jobj{members}:
      Bool.pick(CatalogDecode,
        Bool.and(String.eq(field(value, "status"), "available"), is_array(member(value, "modules"))),
        catalog_tail(member(value, "modules")), CatalogRefused{"providerInventoryUnavailable"})
    case other: CatalogRefused{"providerInventoryMalformed"}

def inventory_raw(+raw: Codec.RawValue) -> CatalogDecode:
  match Codec.raw_to_json(raw):
    case Codec.JcRefused{condition}: CatalogRefused{"providerInventoryJson:" ++ condition}
    case Codec.JcJson{+value}: inventory_value(value)
