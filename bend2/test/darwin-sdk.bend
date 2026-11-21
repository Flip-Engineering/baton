import Base
import ../scripts/darwin-sdk.bend as SDK
import ../scripts/darwin-sdk-archive.bend as Archive
import ../scripts/darwin-sdk-selection.bend as S
import ../src/git/process.bend as Process
import ../src/git/types.bend as Git
import ../src/host/files.bend as Files
import ../src/json/canonical.bend as Json

def release_row(xcode: String, sdk: String) -> String:
  "<tr><td>" ++ xcode ++ "</td><td>host</td><td>iOS 99<br>macOS&nbsp;" ++ sdk ++ "</td></tr>"

def assert_releases(parsed: S.Stable) -> IO(Unit):
  match parsed:
    case S.stable{"30.9", "30.9" <> "30.9.1" <> Nil{}}: IO.pure(Unit, Unit{})
    case other: IO.die(Unit, 1, "The resolver must select SDK 30.9 and both stable Xcode releases.")

def stable_test(work: String) -> IO(Unit):
  +page = work ++ "/releases.html"
  do IO<Unit>:
    IO.try(Unit, Files.Files.write_private(page,
      "<table>" ++ release_row("Xcode 31 beta 2", "31") ++ release_row("Xcode 30.10 RC", "30.10")
        ++ release_row("Xcode 30.2", "30.2") ++ release_row("Xcode 30.9.1", "30.9")
        ++ release_row("Xcode 30.9", "30.9") ++ "</table>"))
    releases : S.Stable <- S.stable_releases(page)
    assert_releases(releases)

def package_url() -> String:
  "https://swcdn.apple.com/CLTools_macOSNMOS_SDK.pkg"

def product_row(+id: String, date: String) -> String:
  "<key>" ++ id ++ "</key><dict><key>Packages</key><array><dict>"
    ++ "<key>URL</key><string>" ++ package_url() ++ "</string>"
    ++ "<key>Size</key><integer>185</integer><key>Digest</key><string>catalog-sha1</string>"
    ++ "</dict></array><key>Distributions</key><dict><key>English</key>"
    ++ "<string>https://swdist.apple.com/" ++ id ++ "</string></dict>"
    ++ "<key>PostDate</key><date>" ++ date ++ "</date></dict>"

def distribution_version(url: String) -> String:
  match url:
    case "https://swdist.apple.com/older": "30.9"
    case "https://swdist.apple.com/stable-patch": "30.9.1"
    case "https://swdist.apple.com/beta": "31 beta 2"
    case other: ""

def distribution(url: String) -> IO(String):
  IO.pure(String, "<choice title=\"SU_TITLE\"/>\"SU_TITLE\" = \"Command Line Tools for Xcode " ++ distribution_version(url) ++ "\";")

def assert_product(choice: S.Selected) -> IO(Unit):
  match choice:
    case S.selected{"stable-patch", "30.9.1", url, "185", "catalog-sha1"}:
      S.require(String.eq(url, package_url()), "The resolver selected the wrong package URL.")
    case other: IO.die(Unit, 1, "The resolver must select the latest matching stable product.")

def product_test(work: String) -> IO(Unit):
  +catalog = work ++ "/catalog.xml"
  do IO<Unit>:
    IO.try(Unit, Files.Files.write_private(catalog, "<plist><dict><key>Products</key><dict>"
      ++ product_row("older", "2030-01-01T00:00:00Z") ++ product_row("beta", "2030-01-03T00:00:00Z")
      ++ product_row("stable-patch", "2030-01-02T00:00:00Z") ++ "</dict></dict></plist>"))
    products : List<&2,S.Product> <- S.catalog_products(catalog)
    choice : S.Selected <- S.choose_product(~distribution, products, ["30.9", "30.9.1"])
    assert_product(choice)

def assert_failure(+expected: String, result: Git.RunRes) -> IO(Unit):
  match result:
    case Git.RRun{Git.SExit{code}, +output}:
      S.require(Bool.and(U32.is_gt(code, 0), String.contains(output, expected)), "Expected " ++ expected ++ ". Received " ++ output)
    case other: IO.die(Unit, 1, "The fixture did not return an exit status.")

def expect_failure(args: List<String>, message: String) -> IO(Unit):
  do IO<Unit>:
    result : Git.RunRes <- Process.runFull("sh" <> "-c" <> "exec \"$@\" 2>&1" <> "fixture" <> args, ".")
    assert_failure(message, result)

def catalog_digest() -> String:
  "0ee5358a7d9876c1335e4bcde9163398279f708e"

def payload_test(+work: String, +fixture: String) -> IO(Unit):
  +package = work ++ "/sdk.pkg"
  +corrupted = work ++ "/corrupted.pkg"
  do IO<Unit>:
    # A 185-byte XAR with a zlib-compressed TOC and a single 11-byte Payload.
    unused : String <- S.command(work, "sh", ["-c", "printf %s \"$1\" | base64 --decode > sdk.pkg", "base64",
      "eGFyIQAcAAEAAAAAAAAAkgAAAAAAAADFAAAAAXicZc5BDsIgEIXhq5juDcUChWScM3iFKQzSSG1S0NjbG9vu3P1v8/LBhxaEOnuEOGZGeNLEeKM1zxRAbAsCVUKYYyxcsQVxFGR+3mtCKUEcCbT4NL45nH1i/yiv6VTqmvnalESywa5z2g7OkLGmV5pZKVKtJmUtazdcjJNdiNSD+DtCELtD7FCxocXP/wX3d0F5c2RrLXBheWxvYWQ="])
    payload : String <- Archive.payload(package, "185", catalog_digest(), work)
    body : String <- S.command(".", "cat", ["--", payload])
    S.require(String.eq(body, "sdk-payload"), "The resolver returned the wrong XAR payload.")
    unused : String <- S.command(work, "sh", ["-c", "head -c 184 sdk.pkg > corrupted.pkg && printf '!' >> corrupted.pkg"])
    expect_failure([fixture, "payload", corrupted, catalog_digest(), work], "payload differs")
    expect_failure([fixture, "payload", package, "0000000000000000000000000000000000000000", work], "differs from its catalog digest")

def tree_test(+work: String, fixture: String) -> IO(Unit):
  +sdk = work ++ "/MacOSX30.9.sdk"
  +header = sdk ++ "/usr/include/fixture.h"
  do IO<Unit>:
    unused : String <- S.command(".", "mkdir", ["-p", "--", sdk ++ "/usr/include"])
    IO.try(Unit, Files.Files.write_private(header, "original"))
    IO.try(Unit, Files.Files.write_private(sdk ++ "/SDKSettings.json", "{\"CanonicalName\":\"macosx30.9\",\"Version\":\"30.9\"}"))
    IO.try(Unit, Files.Files.symlink("fixture.h", sdk ++ "/usr/include/link.h"))
    +hash : String <- SDK.tree_sha256(sdk)
    S.require(String.eq(hash, "2c59346d3b08d9c6011d0c107907b614f0747bd142621ed2666cc0f21f44432e"), "The SDK tree digest differs from the expected file and symlink digest.")
    IO.try(Unit, Files.Files.write_private(SDK.receipt_path(sdk), "{\"schema\":" ++ Json.string_literal(SDK.schema())
      ++ ",\"sdkroot\":" ++ Json.string_literal(sdk) ++ ",\"version\":\"30.9\",\"tree_sha256\":" ++ Json.string_literal(hash) ++ "}"))
    unused : String <- SDK.verify(sdk)
    IO.try(Unit, Files.Files.write_group_read(header, "changed"))
    expect_failure([fixture, "verify", sdk], "does not match the selected SDK tree")

def run(args: List<String>) -> IO(Unit):
  match args:
    case "payload" <> package <> digest <> work <> Nil{}:
      do IO<Unit>:
        unused : String <- Archive.payload(package, "185", digest, work)
        IO.pure(Unit, Unit{})
    case "verify" <> sdk <> Nil{}:
      do IO<Unit>:
        unused : String <- SDK.verify(sdk)
        IO.pure(Unit, Unit{})
    case +work <> +fixture <> Nil{}:
      do IO<Unit>:
        stable_test(work)
        product_test(work)
        payload_test(work, fixture)
        tree_test(work, fixture)
        IO.print("Darwin SDK release, product, payload and receipt tests passed.")
    case other: IO.die(Unit, 2, "Usage: darwin-sdk-test WORK FIXTURE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
