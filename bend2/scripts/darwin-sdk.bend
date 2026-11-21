import Base
import ./darwin-sdk-selection.bend as S
import ./darwin-sdk-archive.bend as Archive
import ../src/host/choice.bend as Choice
import ../src/host/digest.bend as Digest
import ../src/host/files.bend as Files
import ../src/git/text.bend as Text
import ../src/json/canonical.bend as Json

def schema() -> String:
  "baton2-darwin-sdk-selection-v1"

def requirements_url() -> String:
  "https://developer.apple.com/xcode/system-requirements/"

def receipt_path(sdk: String) -> String:
  sdk ++ ".selection.json"

def json_member(path: String, key: String) -> IO(String):
  do IO<String>:
    line : String <- S.command(".", "jq", ["-erj", "." ++ key ++ " | strings", "--", path])
    IO.pure(String, line)

def settings(+sdk: String) -> IO(String):
  +path = sdk ++ "/SDKSettings.json"
  do IO<String>:
    +version : String <- json_member(path, "Version")
    name : String <- json_member(path, "CanonicalName")
    S.require(Bool.and(S.valid_version(version), String.starts_with(name, "macosx")),
      "The extracted SDK settings must identify a macOS version.")
    IO.pure(String, version)

def hex4(+value: U32) -> String:
  "\\u" ++ Json.one(Json.hex_digit(U32.and(U32.shrn(value, 12n), 15)))
    ++ Json.one(Json.hex_digit(U32.and(U32.shrn(value, 8n), 15)))
    ++ Json.one(Json.hex_digit(U32.and(U32.shrn(value, 4n), 15)))
    ++ Json.one(Json.hex_digit(U32.and(value, 15)))

def ascii_char(+c: Char) -> String:
  +value = Char.to_u32(c)
  Choice.choose(String, U32.is_lt(value, 127), _ => Json.escape_char(c), _ =>
    Choice.choose(String, U32.is_le(value, 65535), _ => hex4(value),
      _ => +scalar = U32.sub(value, 65536)
           hex4(U32.add(55296, U32.shrn(scalar, 10n))) ++ hex4(U32.add(56320, U32.and(scalar, 1023)))))

def ascii_escape(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{head, tail}: ascii_char(head) ++ ascii_escape(tail)

def ascii_literal(text: String) -> String:
  "\"" ++ ascii_escape(text) ++ "\""

type TreeEntry is Data:
  entry{path: String, kind: String, value: String}

def regular_files(rows: List<String>) -> List<&2,TreeEntry>:
  match rows:
    case Nil{}: []
    case SNil{} <> rest: regular_files(rest)
    case +row <> rest: entry{String.drop(row, 68n), "file", String.take(row, 64n)} <> regular_files(rest)

def links(rows: List<String>) -> List<&2,TreeEntry>:
  match rows:
    case path <> target <> tail: entry{path, "symlink", target} <> links(tail)
    case other: []

def compare_paths(a: List<&2,String>, b: List<&2,String>) -> Cmp:
  match a b:
    case Nil{} Nil{}: EQ{}
    case Nil{} _ <> _: LT{}
    case _ <> _ Nil{}: GT{}
    case x <> xs y <> ys:
      +order = String.order(x, y)
      Choice.choose(Cmp, Cmp.is_eq(order), _ => compare_paths(xs, ys), _ => order)

def path_order(a: TreeEntry, b: TreeEntry) -> Bool:
  match a b:
    case entry{left, _, _} entry{right, _, _}:
      Cmp.is_le(compare_paths(String.split(left, '/'), String.split(right, '/')))

# Keep the v1 receipt digest encoding, including JSON ASCII escapes and path order.
def tree_rows(rows: List<&2,TreeEntry>) -> String:
  match rows:
    case Nil{}: ""
    case entry{path, kind, value} <> rest:
      "[" ++ ascii_literal(path) ++ ", " ++ Json.string_literal(kind) ++ ", " ++ ascii_literal(value)
        ++ "]\n" ++ tree_rows(rest)

def tree_sha256(+sdk: String) -> IO(String):
  do IO<String>:
    files : String <- S.command(sdk, "find", [".", "-type", "f", "-exec", "sha256sum", "--zero", "--", "{}", "+"])
    symlinks : String <- S.command(sdk, "find", [".", "-type", "l", "-printf", "%P\\0%l\\0"])
    rows : List<&2,TreeEntry> <- IO.pure(List<&2,TreeEntry>, List.append(&2, TreeEntry,
      regular_files(Text.split_nul(files)), links(Text.split_nul(symlinks))))
    IO.try(String, Digest.HostDigest.text(tree_rows(List.sort(~TreeEntry, ~path_order, rows))))

def verify(+sdk: String) -> IO(String):
  +receipt = receipt_path(sdk)
  +error = "The macOS SDK resolution receipt does not match the selected SDK tree."
  do IO<String>:
    format : String <- json_member(receipt, "schema")
    root : String <- json_member(receipt, "sdkroot")
    +version : String <- json_member(receipt, "version")
    +hash : String <- json_member(receipt, "tree_sha256")
    installed : String <- settings(sdk)
    S.require(Bool.and(String.eq(format, schema()), Bool.and(String.eq(root, sdk), String.eq(version, installed))), error)
    observed : String <- tree_sha256(sdk)
    S.require(String.eq(hash, observed), error)
    S.command(".", "cat", ["--", receipt])

def gzip(source: String, output: String) -> IO(Unit):
  do IO<Unit>:
    unused : String <- S.command(".", "sh", ["-c", "exec gzip -dc -- \"$1\" > \"$2\"", "gzip", source, output])
    IO.pure(Unit, Unit{})

def fetch_installer(+work: String, url: String) -> IO(String):
  +file = work ++ "/installer.dist"
  do IO<String>:
    S.fetch(url, "swdist.apple.com", file)
    S.command(".", "cat", ["--", file])

def one_sdk(dirs: List<String>) -> IO(String):
  match dirs:
    case dir <> Nil{}: IO.pure(String, dir)
    case other: IO.die(String, 1, "The Apple SDK payload must contain one macOS SDK directory.")

def expect_release(stable: S.Stable) -> IO(S.Stable):
  match stable:
    case S.stable{_, Nil{}}: IO.die(S.Stable, 1, "Apple did not list a stable Xcode release with a macOS SDK.")
    case selected: IO.pure(S.Stable, selected)

def field(name: String, value: String) -> String:
  "  " ++ Json.string_literal(name) ++ ": " ++ Json.string_literal(value)

def make_receipt(+sdk: String, version: String, +choice: S.Selected, requirements_sha: String,
                 catalog: String, catalog_sha: String, package_sha: String, tree_sha: String) -> String:
  match choice:
    case S.selected{id, xcode, url, _, toc_sha}:
      "{\n" ++ String.join([field("schema", schema()), field("sdkroot", sdk), field("version", version),
        field("xcode_version", xcode), field("requirements_url", requirements_url()), field("requirements_sha256", requirements_sha),
        field("catalog_url", catalog), field("catalog_sha256", catalog_sha), field("product_id", id),
        field("package_url", url), field("package_toc_sha1", toc_sha), field("package_sha256", package_sha),
        field("tree_sha256", tree_sha)], ",\n") ++ "\n}"

def finish(+sdk: String, +expected: String, +choice: S.Selected, +work: String, +catalog: String) -> IO(Unit):
  do IO<Unit>:
    +version : String <- settings(sdk)
    S.require(Cmp.is_eq(S.compare_versions(version, expected)),
      "Apple Software Update supplied SDK " ++ version ++ ". Stable Xcode lists SDK " ++ expected ++ ".")
    unused : String <- S.command(sdk, "test", ["-d", "usr/include"])
    requirements_sha : String <- IO.try(String, Digest.HostDigest.file(work ++ "/requirements.html"))
    catalog_sha : String <- IO.try(String, Digest.HostDigest.file(work ++ "/catalog.gz"))
    package_sha : String <- IO.try(String, Digest.HostDigest.file(work ++ "/sdk.pkg"))
    tree_sha : String <- tree_sha256(sdk)
    +receipt : String <- IO.pure(String, make_receipt(sdk, version, choice, requirements_sha, catalog,
      catalog_sha, package_sha, tree_sha))
    IO.try(Unit, Files.Files.write_private(receipt_path(sdk), receipt ++ "\n"))
    unused : String <- S.command(".", "rm", ["-r", "--", work])
    IO.print(receipt)

def install(+output: String, +work: String, +catalog: String, +expected: String, +choice: S.Selected) -> IO(Unit):
  match choice:
    case S.selected{_, _, url, size, digest}:
      +package = work ++ "/sdk.pkg"
      do IO<Unit>:
        S.fetch(url, "swcdn.apple.com", package)
        data : String <- Archive.payload(package, size, digest, work)
        Archive.unpack(data, work, output)
        sdks : String <- S.command(".", "find", [output ++ "/Library/Developer/CommandLineTools/SDKs",
          "-mindepth", "1", "-maxdepth", "1", "-type", "d", "-name", "MacOSX*.sdk", "-print0"])
        sdk : String <- one_sdk(Text.split_nul(sdks))
        finish(sdk, expected, choice, work, catalog)

def resolve_stable(+output: String, +work: String, stable: S.Stable) -> IO(Unit):
  match stable:
    case S.stable{+expected, releases}:
      do IO<Unit>:
        +catalog : String <- S.catalog_url(expected)
        S.fetch(catalog, "swscan.apple.com", work ++ "/catalog.gz")
        gzip(work ++ "/catalog.gz", work ++ "/catalog.xml")
        rows : List<&2,S.Product> <- S.catalog_products(work ++ "/catalog.xml")
        choice : S.Selected <- S.choose_product(~(url => fetch_installer(work, url)), rows, releases)
        install(output, work, catalog, expected, choice)

def resolve(+path: String) -> IO(Unit):
  do IO<Unit>:
    unused : String <- S.command(".", "sh", ["-c",
      "mkdir -p -- \"$(dirname -- \"$1\")\" && exec mkdir -m 0700 -- \"$1\"", "mkdir", path])
    +output : String <- IO.try(String, Files.Files.realpath(path))
    +work : String <- IO.pure(String, output ++ "/.download")
    IO.try(Unit, Files.Files.mkdir_mode(work, 448))
    +requirements : String <- IO.pure(String, work ++ "/requirements.html")
    S.fetch(requirements_url(), "developer.apple.com", requirements)
    parsed : S.Stable <- S.stable_releases(requirements)
    stable : S.Stable <- expect_release(parsed)
    resolve_stable(output, work, stable)

def run(args: List<String>) -> IO(Unit):
  match args:
    case "resolve" <> output <> Nil{}: resolve(output)
    case "verify" <> sdk <> Nil{}:
      do IO<Unit>:
        receipt : String <- verify(sdk)
        IO.write(receipt)
    case other: IO.die(Unit, 2, "Usage: darwin-sdk resolve OUTPUT | verify SDKROOT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
