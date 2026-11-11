"""Verify and activate immutable homelab runtime releases.

The selection document is tracked and versioned. Activation only rewrites that
document and appends an auditable receipt; it never writes inside a release
directory and never touches the active farm process or a service.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

SELECTION_SCHEMA = "acp.homelab-runtime-selection/v1"
RELEASE_SCHEMA = "acp.homelab-runtime-release/v1"
PROVENANCE_SCHEMA = "acp.homelab-runtime-provenance/v1"
RECEIPT_SCHEMA = "acp.homelab-runtime-activation/v1"
SEAL_NAME = "RELEASE.json"
PROVENANCE_NAME = "SOURCE_PROVENANCE.json"
REVISION = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"[0-9a-f]{64}")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write(path, payload, overwrite=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        if not overwrite and path.exists():
            raise FileExistsError("Refusing to overwrite " + str(path))
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


atomic_write = _atomic_write


def default_selection_path():
    configured = os.environ.get("ACP_RUNTIME_SELECTION")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent.parent / "runtime-selection.json"


def default_releases_root():
    configured = os.environ.get("ACP_RUNTIME_RELEASES")
    if configured:
        return Path(configured)
    try:
        import farm
        return Path(farm.CONFIG["storage"]) / "runtime-releases"
    except Exception:
        return Path(__file__).resolve().parent.parent / "runtime-releases"


def manifest_records(manifest):
    if manifest.get("schema") != PROVENANCE_SCHEMA:
        raise ValueError("Unexpected runtime provenance schema")
    records = []
    for record in manifest.get("records", []):
        rel = record.get("path")
        digest = record.get("tracked_sha256")
        if not isinstance(rel, str) or not rel or not isinstance(digest, str) or not DIGEST.fullmatch(digest):
            raise ValueError("Invalid runtime provenance record")
        relative = Path(rel)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Runtime provenance path escapes the release: " + rel)
        records.append({"path": rel, "tracked_sha256": digest})
    if not records:
        raise ValueError("Runtime provenance has no file records")
    return sorted(records, key=lambda item: item["path"])


def manifest_digest(manifest):
    encoded = json.dumps(manifest_records(manifest), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def release_digest(release):
    """Hash the immutable file set recorded in the release seal."""
    seal = json.loads((Path(release) / SEAL_NAME).read_text())
    files = seal.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Release seal has no file hashes")
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def verify_release(revision, releases=None, release=None):
    """Validate a staged release's commit, provenance, seal and file hashes."""
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise ValueError("Runtime revision must be a full lowercase Git commit SHA")
    if release is None:
        release = Path(releases or default_releases_root()) / revision
    release = Path(release)
    if release.is_symlink() or not release.is_dir():
        raise ValueError("Runtime release is not a regular directory: " + str(release))
    if release.name != revision:
        raise ValueError("Runtime release directory does not match the selected revision")
    seal_path = release / SEAL_NAME
    if seal_path.is_symlink() or not seal_path.is_file():
        raise ValueError("Runtime release is missing its immutable seal")
    seal = json.loads(seal_path.read_text())
    if seal.get("schema") != RELEASE_SCHEMA or seal.get("revision") != revision:
        raise ValueError("Runtime release seal does not describe this revision")
    if seal.get("source_commit") != revision:
        raise ValueError("Runtime release source commit differs from the release revision")
    provenance_path = release / PROVENANCE_NAME
    if provenance_path.is_symlink() or not provenance_path.is_file():
        raise ValueError("Runtime release is missing its provenance manifest")
    provenance_sha256 = sha256_file(provenance_path)
    if seal.get("provenance_sha256") != provenance_sha256:
        raise ValueError("Runtime release provenance hash differs from the seal")
    manifest = json.loads(provenance_path.read_text())
    records = manifest_records(manifest)
    if seal.get("manifest_sha256") != manifest_digest(manifest):
        raise ValueError("Runtime release provenance digest differs from the seal")
    files = {}
    for record in records:
        target = release / "runtime" / record["path"]
        if target.is_symlink() or not target.is_file():
            raise ValueError("Runtime release is missing " + record["path"])
        actual = sha256_file(target)
        if actual != record["tracked_sha256"]:
            raise ValueError("Runtime release hash mismatch: " + record["path"])
        files[record["path"]] = actual
    if seal.get("files") != files:
        raise ValueError("Runtime release seal file set differs from provenance")
    return {
        "revision": revision,
        "release": release,
        "provenance_sha256": provenance_sha256,
        "seal_sha256": sha256_file(seal_path),
        "manifest_sha256": seal["manifest_sha256"],
        "files": files,
        "source_commit": seal["source_commit"],
    }


def read_selection(selection=None):
    path = Path(selection or default_selection_path())
    if path.is_symlink() or not path.is_file():
        raise ValueError("Runtime selection is not a regular file: " + str(path))
    document = json.loads(path.read_text())
    if not isinstance(document, dict) or document.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Unexpected runtime selection schema")
    generation = document.get("generation")
    if not isinstance(generation, int) or generation < 1:
        raise ValueError("Runtime selection generation must be a positive integer")
    revision = document.get("selected_revision")
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise ValueError("Runtime selection revision must be a full lowercase Git commit SHA")
    pins = document.get("previous_pins", [])
    if not isinstance(pins, list):
        raise ValueError("Runtime selection previous_pins must be a list")
    for pin in pins:
        if not isinstance(pin, dict) or not isinstance(pin.get("revision"), str):
            raise ValueError("Runtime selection contains an invalid previous pin")
        if REVISION.fullmatch(pin["revision"]) and pin["revision"] == revision:
            raise ValueError("Runtime selection treats the selected revision as a previous pin")
    return path, document


def load_selected(selection=None, releases=None):
    """Resolve the selected revision after re-validating the immutable release."""
    path, document = read_selection(selection)
    verified = verify_release(document["selected_revision"], releases)
    if document.get("provenance_sha256") != verified["provenance_sha256"]:
        raise ValueError("Runtime selection provenance does not match the release")
    if document.get("release_seal_sha256") not in (None, verified["seal_sha256"]):
        raise ValueError("Runtime selection release seal does not match the release")
    if document.get("source_commit") not in (None, verified["source_commit"]):
        raise ValueError("Runtime selection source commit does not match the release")
    return {"selection": document, "selection_path": path, "release": verified}


def activate(revision, selection=None, releases=None, receipts=None, reason=None, prior_pins=()):
    """Select a verified release, incrementing the generation and writing a receipt."""
    release = verify_release(revision, releases)
    selection_path = Path(selection or default_selection_path())
    release_before = release_digest(release["release"])
    if selection_path.exists():
        _, previous = read_selection(selection_path)
        if previous["selected_revision"] == revision:
            raise ValueError("Runtime revision is already selected: " + revision)
        if any(pin.get("revision") == revision for pin in previous.get("previous_pins", [])):
            raise ValueError("A recorded earlier pin cannot be re-activated in place")
        generation = previous["generation"] + 1
        history = list(previous.get("history", []))
        pins = list(previous.get("previous_pins", []))
        previous_revision = previous["selected_revision"]
    else:
        generation = 1
        history = []
        pins = []
        previous_revision = None
    known = {pin.get("revision") for pin in pins}
    for pin in prior_pins:
        if not isinstance(pin, dict) or not REVISION.fullmatch(pin.get("revision", "")):
            raise ValueError("Earlier pins require a full lowercase Git commit SHA")
        if pin["revision"] == revision:
            raise ValueError("The activated revision cannot also be an earlier pin")
        if pin["revision"] not in known:
            pins.append({
                "revision": pin["revision"],
                "status": pin.get("status", "staged_prior_pin"),
                "activated": False,
                "provenance_sha256": None,
                "note": pin.get("note", "Preserved earlier staged release; not relabelled or activated"),
            })
            known.add(pin["revision"])
    history.append({
        "generation": generation,
        "revision": revision,
        "selected_at": now(),
        "provenance_sha256": release["provenance_sha256"],
        "seal_sha256": release["seal_sha256"],
    })
    document = {
        "schema": SELECTION_SCHEMA,
        "generation": generation,
        "selected_revision": revision,
        "source_commit": release["source_commit"],
        "provenance_sha256": release["provenance_sha256"],
        "release_seal_sha256": release["seal_sha256"],
        "previous_pins": pins,
        "history": history,
    }
    _atomic_write(selection_path, json.dumps(document, indent=2, sort_keys=True) + "\n")
    if release_digest(release["release"]) != release_before:
        raise RuntimeError("Runtime release changed during activation")
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "generation": generation,
        "revision": revision,
        "release": str(release["release"]),
        "release_seal_sha256": release["seal_sha256"],
        "provenance_sha256": release["provenance_sha256"],
        "manifest_sha256": release["manifest_sha256"],
        "selection": str(selection_path),
        "selection_sha256": sha256_file(selection_path),
        "previous_revision": previous_revision,
        "activated_at": now(),
        "activated_by": {"uid": os.getuid(), "user": os.environ.get("USER") or os.environ.get("LOGNAME")},
        "host_boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip() if Path("/proc/sys/kernel/random/boot_id").exists() else None,
        "service_restarted": False,
        "active_processes_modified": False,
        "release_unchanged": True,
        "reason": reason,
    }
    receipt_path = Path(receipts or selection_path.parent / "runtime-activation-receipts") / f"{generation:04d}-{revision}.json"
    _atomic_write(receipt_path, json.dumps(receipt, indent=2, sort_keys=True) + "\n", overwrite=False)
    return {"selection": str(selection_path), "receipt": str(receipt_path), "document": document, "release": release}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--revision", required=True)
    verify.add_argument("--releases")
    verify.add_argument("--release")
    show = sub.add_parser("show")
    show.add_argument("--selection")
    show.add_argument("--releases")
    select = sub.add_parser("activate")
    select.add_argument("--revision", required=True)
    select.add_argument("--selection")
    select.add_argument("--releases")
    select.add_argument("--receipts")
    select.add_argument("--reason")
    select.add_argument("--prior-pin", action="append", default=[], metavar="SHA",
                        help="record an earlier staged pin without activating or re-labelling it")
    args = parser.parse_args()
    if args.command == "verify":
        result = verify_release(args.revision, args.releases, args.release)
        print(json.dumps({k: (str(v) if isinstance(v, Path) else v) for k, v in result.items()}, indent=2, sort_keys=True))
    elif args.command == "show":
        result = load_selected(args.selection, args.releases)
        result["selection_path"] = str(result["selection_path"])
        result["release"]["release"] = str(result["release"]["release"])
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        pins = [{"revision": value} for value in args.prior_pin]
        result = activate(args.revision, args.selection, args.releases, args.receipts, args.reason, pins)


if __name__ == "__main__":
    main()
