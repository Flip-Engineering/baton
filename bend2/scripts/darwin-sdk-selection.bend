import Base
import ../src/host/choice.bend as Choice
import ../src/git/process.bend as Process
import ../src/git/types.bend as Git

def command_result(+name: String, result: Git.RunRes) -> IO(String):
  match result:
    case Git.RRun{Git.SExit{+code}, +out}:
      Choice.choose(IO(String), U32.is_eq(code, 0), _ => IO.pure(String, out),
        _ => IO.die(String, code, name ++ ": " ++ out))
    case Git.RRun{Git.SSignal{signal}, out}:
      IO.die(String, 1, name ++ " received signal " ++ U32.show(signal) ++ ": " ++ out)
    case Git.RSpawn{detail}: IO.die(String, 1, name ++ ": " ++ detail)

def command(cwd: String, +name: String, args: List<String>) -> IO(String):
  do IO<String>:
    result : Git.RunRes <- Process.runFull(name <> args, cwd)
    command_result(name, result)

def require(ok: Bool, message: String) -> IO(Unit):
  Bool.pick(IO(Unit), ok, IO.pure(Unit, Unit{}), IO.die(Unit, 1, message))

def number_result(value: Maybe<&2,U32>, message: String) -> IO(U32):
  match value:
    case None{}: IO.die(U32, 1, message)
    case Some{n}: IO.pure(U32, n)

def number(text: String, message: String) -> IO(U32):
  number_result(U32.read(String.trim(text)), message)

def take_until(+text: String, +marker: String, +acc: String) -> String & String:
  match text:
    case SNil{}: (String.reverse(acc), "")
    case SCon{+head, +tail}:
      Choice.choose(String & String, String.starts_with(text, marker),
        _ => (String.reverse(acc), String.drop(text, String.length(marker))),
        _ => take_until(tail, marker, SCon{head, acc}))

def after(text: String, marker: String) -> String:
  Pair.snd(String, String, take_until(text, marker, ""))

def before(text: String, marker: String) -> String:
  Pair.fst(String, String, take_until(text, marker, ""))

def between(text: String, begin: String, end: String) -> String:
  before(after(text, begin), end)

def normalize_spaces(s: String, +space: Bool, +acc: String) -> String:
  match s:
    case SNil{}: String.trim(String.reverse(acc))
    case SCon{+head, tail}:
      +gap = Bool.or(Char.is_space(head), Char.is_eq(head, Char.from_u32(160)))
      +next = Bool.pick(String, gap,
        Bool.pick(String, space, acc, SCon{Char.from_u32(32), acc}),
        SCon{head, acc})
      normalize_spaces(tail, gap, next)

def html_text(s: String, +tag: Bool, +acc: String) -> String:
  match s:
    case SNil{}: normalize_spaces(String.reverse(acc), True{}, "")
    case SCon{+head, +tail}:
      +opening = Bool.and(Bool.not(tag), Char.is_eq(head, '<'))
      +closing = Bool.and(tag, Char.is_eq(head, '>'))
      +next_tag = Bool.or(opening, Bool.and(tag, Bool.not(closing)))
      +break = Bool.and(opening, String.starts_with(tail, "br"))
      +next = Bool.pick(String, break, SCon{' ', acc},
        Bool.pick(String, Bool.or(tag, opening), acc, SCon{head, acc}))
      html_text(tail, next_tag, next)

def digits(+part: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(part)), List.all(~&2, ~Char, ~Char.is_digit, String.to_list(part)))

def valid_version(+version: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(version)),
    List.all(~&2, ~String, ~(part => digits(part)), String.split(version, Char.from_u32(46))))

def trim_zeroes(parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case "0" <> rest: trim_zeroes(rest)
    case other: other

def trim_digit_zeroes(part: String) -> String:
  match part:
    case SNil{}: ""
    case SCon{+head,+rest}:
      Choice.choose(String, Char.is_eq(head, Char.from_u32(48)), _ => trim_digit_zeroes(rest), _ => part)

def normalize_parts(parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case Nil{}: []
    case part <> rest:
      +normalized = trim_digit_zeroes(part)
      Bool.pick(String, String.is_empty(normalized), "0", normalized) <> normalize_parts(rest)

def version_parts(version: String) -> List<&2,String>:
  +parts = String.split(version, Char.from_u32(46))
  +normalized = normalize_parts(parts)
  List.reverse(&2, String, trim_zeroes(List.reverse(&2, String, normalized)))

def compare_component(+left: String, +right: String, order: Cmp) -> Cmp:
  match order:
    case EQ{}: String.order(left, right)
    case other: other

def compare_parts(a: List<&2,String>, b: List<&2,String>) -> Cmp:
  match a b:
    case Nil{} Nil{}: EQ{}
    case Nil{} _ <> _: LT{}
    case _ <> _ Nil{}: GT{}
    case +x <> xs +y <> ys:
      +order = compare_component(x, y, Nat.cmp(String.length(x), String.length(y)))
      Choice.choose(Cmp, Cmp.is_eq(order), _ => compare_parts(xs, ys), _ => order)

def compare_versions(a: String, b: String) -> Cmp:
  compare_parts(version_parts(a), version_parts(b))

def version_prefix(text: String, +acc: String) -> String:
  match text:
    case SNil{}: String.reverse(acc)
    case SCon{+head, tail}:
      Choice.choose(String, Bool.or(Char.is_digit(head), Char.is_eq(head, Char.from_u32(46))),
        _ => version_prefix(tail, SCon{head, acc}), _ => String.reverse(acc))

type Stable is Data:
  stable{sdk: String, releases: List<&2,String>}

def release_order(order: Cmp, +sdk: String, +xcode: String, +current: String, +versions: List<&2,String>) -> Stable:
  match order:
    case LT{}: stable{current, versions}
    case EQ{}: stable{current, xcode <> versions}
    case GT{}: stable{sdk, [xcode]}

def add_valid_release(best: Stable, +sdk: String, +xcode: String) -> Stable:
  match best:
    case stable{_, Nil{}}: stable{sdk, [xcode]}
    case stable{+current, versions}:
      release_order(compare_versions(sdk, current), sdk, xcode, current, versions)

def add_release(+title: String, sdks: String, +best: Stable) -> Stable:
  +xcode = after(title, "Xcode ")
  +sdk = version_prefix(after(sdks, " macOS "), "")
  Choice.choose(Stable, Bool.and(String.starts_with(title, "Xcode "),
    Bool.and(valid_version(xcode), valid_version(sdk))),
    _ => add_valid_release(best, sdk, xcode),
    _ => best)

@unsafe
def stable_cells(+cells: String, +best: Stable) -> Stable:
  +start = after(cells, "<td")
  Choice.choose(Stable, String.is_empty(start), _ => best, _ =>
    +cell1 = take_until(after(start, ">"), "</td>", "")
    +rest = Pair.snd(String, String, cell1)
    +cell2 = take_until(after(after(rest, "<td"), ">"), "</td>", "")
    +title = Pair.fst(String, String, cell1)
    +sdks = Pair.fst(String, String, cell2)
    stable_cells(Pair.snd(String, String, cell2), add_release(html_text(title, False{}, ""), " " ++ html_text(sdks, False{}, ""), best)))

def stable_releases(path: String) -> IO(Stable):
  do IO<Stable>:
    cells : String <- command(".", "sh", ["-c", "exec xmllint --html --xpath '//tr[td[3]]/td[position()=1 or position()=3]' \"$1\" 2>/dev/null", "xmllint", path])
    IO.pure(Stable, stable_cells(cells, stable{"", []}))

@unsafe
def catalog_majors(+major: U32) -> String:
  Choice.choose(String, U32.is_le(major, 25), _ => "",
    _ => U32.show(major) ++ "-" ++ catalog_majors(U32.sub(major, 1)))

def catalog_url(sdk: String) -> IO(String):
  do IO<String>:
    major : U32 <- number(before(sdk, "."), "Invalid macOS SDK major version")
    IO.pure(String, "https://swscan.apple.com/content/catalogs/others/index-" ++ catalog_majors(major)
      ++ "15-14-13-12-10.16-10.15-10.14-10.13-10.12-10.11-10.10-10.9-"
      ++ "mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz")

def apple_url(url: String, host: String) -> Bool:
  String.starts_with(url, "https://" ++ host ++ "/")

def fetch(+url: String, +host: String, path: String) -> IO(Unit):
  do IO<Unit>:
    require(apple_url(url, host), "Expected HTTPS from " ++ host ++ " at " ++ url)
    +location : String <- command(".", "curl", ["--disable", "--fail", "--silent", "--show-error",
      "--location", "--proto", "=https", "--proto-redir", "=https", "--write-out", "%{url_effective}",
      "--output", path, "--", url])
    require(apple_url(location, host), "Expected HTTPS from " ++ host ++ " at " ++ location)

type Product is Data:
  product{id: String, date: String, distribution: String, packages: String}

@unsafe
def product_fields(+text: String, +id: String, +date: String, +dist: String, +packages: String) -> Product & String:
  +rest = String.trim_start(text)
  Choice.choose(Product & String, String.starts_with(rest, "<date>"),
    _ => +part = take_until(String.drop(rest, 6n), "</date>", "")
         +value = Pair.fst(String, String, part)
         +next = Pair.snd(String, String, part)
         product_fields(next, id, value, dist, packages),
    _ => Choice.choose(Product & String, String.starts_with(rest, "<string>"),
      _ => +part = take_until(String.drop(rest, 8n), "</string>", "")
           +value = Pair.fst(String, String, part)
           +next = Pair.snd(String, String, part)
           product_fields(next, id, date, value, packages),
      _ => Choice.choose(Product & String, String.starts_with(rest, "<dict>"),
        _ => +part = take_until(String.drop(rest, 6n), "</dict>", "")
             +value = Pair.fst(String, String, part)
             +next = Pair.snd(String, String, part)
             product_fields(next, id, date, dist, packages ++ "<dict>" ++ value ++ "</dict>"),
        _ => (product{id, date, dist, packages}, rest))))

@unsafe
def product_rows(text: String) -> List<&2,Product>:
  +start = after(text, "<key>")
  Choice.choose(List<&2,Product>, String.is_empty(start), _ => [], _ =>
    +key = take_until(start, "</key>", "")
    +id = Pair.fst(String, String, key)
    +fields = Pair.snd(String, String, key)
    +parsed = product_fields(fields, id, "", "", "")
    Pair.fst(Product, String, parsed) <> product_rows(Pair.snd(Product, String, parsed)))

def newest_first(a: Product, b: Product) -> Bool:
  match a b:
    case product{_, date, _, _} product{_, other, _, _}: String.is_ge(date, other)

def catalog_products(path: String) -> IO(List<&2,Product>):
  # Select the key, date, English distribution and SDK pkg dictionaries for each product.
  +sdk : String = "/CLTools_macOSNMOS_SDK.pkg"
  +url : String = "key[.='URL']/following-sibling::*[1][self::string]"
  +pkg : String = "key[.='Packages']/following-sibling::*[1][self::array]/dict["
    ++ url ++ "[substring(., string-length(.) - " ++ Nat.show(Nat.sub(String.length(sdk), 1n))
    ++ ")='" ++ sdk ++ "']]"
  +dist : String = "key[.='Distributions']/following-sibling::*[1][self::dict]/key[.='English']/following-sibling::*[1][self::string]"
  +products : String = "/plist/dict/key[.='Products']/following-sibling::*[1][self::dict]/dict[" ++ pkg ++ "][" ++ dist ++ "]"
  +xpath = products ++ "/preceding-sibling::*[1][self::key] | "
    ++ products ++ "/key[.='PostDate']/following-sibling::*[1][self::date] | "
    ++ products ++ "/" ++ dist ++ " | " ++ products ++ "/" ++ pkg
  do IO<List<&2,Product>>:
    rows : String <- command(".", "xmllint", ["--nonet", "--xpath", xpath, path])
    IO.pure(List<&2,Product>, List.sort(~Product, ~newest_first, product_rows(rows)))

@unsafe
def installer_version(text: String) -> String:
  +assignment = String.trim_start(after(text, "\"SU_TITLE\""))
  +title = String.trim_start(after(assignment, "="))
  +prefix : String = "\"Command Line Tools for Xcode "
  +version = before(String.drop(title, String.length(prefix)), "\";")
  Choice.choose(String, String.is_empty(assignment), _ => "", _ =>
    Choice.choose(String, Bool.and(String.starts_with(assignment, "="), Bool.and(String.starts_with(title, prefix),
      Bool.and(String.contains(title, "\";"), valid_version(version)))),
      _ => version, _ => installer_version(assignment)))

type Selected is Data:
  selected{id: String, version: String, url: String, size: String, digest: String}

def property(+pkg: String, name: String, +tag: String) -> String:
  between(after(pkg, "<key>" ++ name ++ "</key>"), "<" ++ tag ++ ">", "</" ++ tag ++ ">")

def offered_version(releases: List<&2,String>, +version: String) -> Bool:
  match releases:
    case Nil{}: False{}
    case head <> tail: Bool.or(String.eq(version, head), offered_version(tail, version))

def choose_product(~fetch_text: String -> String -> IO(String), +work: String, +products: List<&2,Product>, +releases: List<&2,String>) -> IO(Selected):
  match products:
    case Nil{}: IO.die(Selected, 1, "Apple Software Update has no SDK package for stable Xcode " ++ String.join(releases, ", "))
    case product{+id, _, dist, +pkg} <> rest:
      do IO<Selected>:
        installer : String <- fetch_text(work, dist)
        +version : String <- IO.pure(String, installer_version(installer))
        Choice.choose(IO(Selected), Bool.and(valid_version(version),
          offered_version(releases, version)),
          _ => do IO<Selected>:
            require(String.is_empty(after(pkg, "</dict>")), "Apple product " ++ id ++ " has multiple current SDK packages.")
            IO.pure(Selected, selected{id, version, property(pkg, "URL", "string"),
              property(pkg, "Size", "integer"), property(pkg, "Digest", "string")}),
          _ => choose_product(fetch_text, work, rest, releases))
