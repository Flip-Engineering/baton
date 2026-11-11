"""Typed, source-and-binary-pinned FFrames canary recipe.

This module uses the repository-pinned ``videos/gpu/fframes_canary.py`` wrapper
through the ordinary ``gpu_job.sh`` recipe parser and pins the
binary by absolute path and SHA-256 inside the normal ``gpu_argv``. The wrapper
checks the source commit, binary hash, allocated UUID, cgroup limits and
admission receipt, then emits the delivery receipt checked by ``gpu_jobs``.
"""
import hashlib
import json
import math
import os
import stat
from pathlib import Path, PurePosixPath
import re
import shlex

SCHEMA = "acp.fframes-canary-recipe/v1"
RECIPE_PATH = "videos/gpu/fframes_canary.py"
BINARY_PREFIX = "/nvme/acp-gpu/"
DEFAULT_SOURCE_MANIFEST = "/run/acp-job-request.json"
SHA40 = re.compile(r"[0-9a-f]{40}")
SHA64 = re.compile(r"[0-9a-f]{64}")
PROTOCOL = re.compile(r"[A-Za-z0-9_-]+")
UUID = re.compile(r"^(?:GPU-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def sha256_file(path):
    digest = hashlib.sha256()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("SHA-256 input must be a regular file: " + str(path))
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _positive(value, label):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)) or float(value) <= 0:
        raise ValueError(label + " must be positive and finite")
    return float(value)


def _plain(value, label):
    if not isinstance(value, str) or not value or any(char in value for char in "\0\r\n"):
        raise ValueError(label + " must be a non-empty plain string")
    return value


def _absolute(value, label):
    text = _plain(value, label)
    path = PurePosixPath(text)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError(label + " must be an absolute path without traversal")
    return text


def build(protocol_id, source_commit, binary_path, binary_sha256, *,
          pipeline_commit, memory_gib=8, time_seconds=5, expect_uuid=None,
          source_manifest=DEFAULT_SOURCE_MANIFEST):
    """Build a recipe with separate ACP checkout and FFrames renderer pins."""
    if not isinstance(protocol_id, str) or not PROTOCOL.fullmatch(protocol_id):
        raise ValueError("protocol_id must be a plain queue identifier")
    if not isinstance(source_commit, str) or not SHA40.fullmatch(source_commit):
        raise ValueError("source_commit must be a full lowercase Git commit SHA")
    if not isinstance(pipeline_commit, str) or not SHA40.fullmatch(pipeline_commit):
        raise ValueError("pipeline_commit must be a full lowercase Git commit SHA")
    if not isinstance(binary_sha256, str) or not SHA64.fullmatch(binary_sha256):
        raise ValueError("binary_sha256 must be a full lowercase SHA-256")
    binary_path = _absolute(binary_path, "binary_path")
    if not binary_path.startswith(BINARY_PREFIX):
        raise ValueError("binary_path must live under the shared GPU cache " + BINARY_PREFIX)
    source_manifest = _absolute(source_manifest, "source_manifest")
    memory_gib = _positive(memory_gib, "memory_gib")
    time_seconds = _positive(time_seconds, "time_seconds")
    if expect_uuid is not None and (not isinstance(expect_uuid, str) or not UUID.fullmatch(expect_uuid)):
        raise ValueError("expect_uuid must be a canonical GPU UUID")

    argv = [
        "sh", "videos/scripts/gpu_job.sh", "python", RECIPE_PATH,
        "--id", protocol_id,
        "--gpus", "1",
        "--time", str(time_seconds),
        "--mem", str(memory_gib),
        "--",
        "--source-commit", source_commit,
        "--source-manifest", source_manifest,
        "--binary", binary_path,
        "--binary-sha256", binary_sha256,
    ]
    if expect_uuid is not None:
        argv.extend(["--expect-uuid", expect_uuid])
    request = {"kind": "gpu", "gpu_kind": "python", "gpu_count": 1,
               "protocol_id": protocol_id, "commit": pipeline_commit, "gpu_argv": argv}
    queue = {
        "id": protocol_id,
        "pipeline_commit": pipeline_commit,
        "run": [shlex.join(argv)],
        "outputs": ["videos/out/gpu/" + protocol_id + "/deliver/"],
        "dependencies": {"python": [], "system": [], "npm": []},
    }
    pins = {
        "source_commit": source_commit,
        "pipeline_commit": pipeline_commit,
        "recipe_path": RECIPE_PATH,
        "binary": {"path": binary_path, "sha256": binary_sha256},
        "uuid": {"expect_uuid": expect_uuid, "reservation": "one GPU slot; receipt UUID must match allocation"},
        "source_manifest": source_manifest,
        "memory_gib": memory_gib,
        "time_seconds": time_seconds,
    }
    recipe = {"schema": SCHEMA, "protocol_id": protocol_id, "request": request, "queue": queue, "pins": pins}
    return recipe


def validate(recipe):
    """Reject a recipe whose typed pins and request/queue argv disagree."""
    if not isinstance(recipe, dict) or recipe.get("schema") != SCHEMA:
        raise ValueError("Unexpected FFrames recipe schema")
    protocol_id = recipe.get("protocol_id")
    request = recipe.get("request")
    queue = recipe.get("queue")
    pins = recipe.get("pins")
    if not isinstance(request, dict) or not isinstance(queue, dict) or not isinstance(pins, dict):
        raise ValueError("FFrames recipe requires request, queue and pins objects")
    expected = build(
        protocol_id,
        pins.get("source_commit"),
        (pins.get("binary") or {}).get("path"),
        (pins.get("binary") or {}).get("sha256"),
        pipeline_commit=pins.get("pipeline_commit"),
        memory_gib=pins.get("memory_gib"),
        time_seconds=pins.get("time_seconds"),
        expect_uuid=(pins.get("uuid") or {}).get("expect_uuid"),
        source_manifest=pins.get("source_manifest"),
    )
    if request != expected["request"] or queue != expected["queue"]:
        raise ValueError("FFrames recipe request/queue does not match its pins")
    return recipe


def verify_binary(recipe):
    """Verify an available binary against the recipe's absolute path and hash."""
    pins = validate(recipe)["pins"]["binary"]
    path = Path(pins["path"])
    if not path.is_file():
        raise ValueError("Canary binary not found: " + str(path))
    actual = sha256_file(str(path))
    if actual != pins["sha256"]:
        raise ValueError("Canary binary sha256 does not match the recipe pin")
    return actual



def request_copy(recipe):
    """Return a detached request object suitable for gpu_jobs.read_request."""
    validated = validate(recipe)["request"]
    return {"kind": "gpu", "gpu_kind": "python", "gpu_count": 1,
            "protocol_id": validated["protocol_id"], "commit": validated["commit"],
            "gpu_argv": list(validated["gpu_argv"])}


# The complete THE CHASM study uses the same ordinary GPU request and delivery path
# as the small canary. The capture and soundtrack roots are fixed to this study.
FULL_SCENE_SCHEMA = "acp.fframes-full-scene-recipe/v1"
FULL_SCENE_PATH = "videos/gpu/fframes_full_scene.py"
FULL_SCENE_CAPTURE_ROOT = "/mnt/nvme4tb/fframes-scene-comparison-20261017/capture"
FULL_SCENE_AUDIO = "/mnt/nvme4tb/fframes-scene-comparison-20261017/work/audio.m4a"
FULL_SCENE_SOURCE_MANIFEST = "/home/atari2036/render-fframes-port-20261016/evidence/fframes-queue-20261018/chasm-capture-source-manifest.json"
FULL_SCENE_SOURCE_COMMIT = "e67fd169c16f6c6e499d4b3f2c58d63c9e42844e"
FULL_SCENE_CAPTURE_COMMIT = "863c289a7c330448bf74d9e685dce82a023ec04f"
FULL_SCENE_RENDERER_COMMIT = "6e0785127dc60ad72ab59da5fef27bd1384bd90f"
FULL_SCENE_RENDERER_SOURCE = "b6e93716c852c522f087f40732b13b441f63bdc2"
FULL_SCENE_RENDERER_TREE = "e9abc5269a4ac6657a8a34431248ff6b8803b733"
FULL_SCENE_BINARY = "/nvme/acp-gpu/environments/base/fframes/" + FULL_SCENE_RENDERER_SOURCE + "/chasm_render"
FULL_SCENE_BINARY_SHA256 = "c7fa3faa9550bed79d28cfb527f55f94a64eac6e98338bb2484a0a3c4b3f0d47"
FULL_SCENE_BASELINE_JOB = "1016-112454-the_chasm_v1_take_b_full_render"
FULL_SCENE_BASELINE_COMMIT = "be390b84776b83c4309630c586e18f1c53445931"
FULL_SCENE_SOURCE_FILE_HASHES = {
    "page_js": "d20d144e94aa0e8f5d6ec980605a898bb74dd850992358daf695ab71ec20fa85",
    "world": "663e064d57c250cb38f53cf575238a0157bc0c46efe92b2877eed2f229da2375",
    "plan": "fd0912e892664ab31007264fa5e9f514ad585594a085f861de5733be657537fc",
    "cast": "106924d18cc03a281ed595bc5383a27d19e9153eb0d9bc45a76f994b7d5cdb38",
}
FULL_SCENE_SEGMENT_FRAMES = 289
FULL_SCENE_SEGMENTS = 6
FULL_SCENE_MANIFEST_STORE = "/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/gpu-work/fframes-manifests"
FULL_SCENE_MANIFEST_MAX_BYTES = 16 * 1024 * 1024
FULL_SCENE_MANIFEST_MAX_FILES = 100000
FULL_SCENE_CONTAINER_MANIFEST = "/run/acp-fframes-full-scene-manifest.json"
FULL_SCENE_CONTAINER_CAPTURE = "/run/acp-chasm-capture"
FULL_SCENE_CONTAINER_AUDIO = "/run/acp-chasm-audio.m4a"
FULL_SCENE_CONTAINER_SOURCE_MANIFEST = "/run/acp-chasm-source-manifest.json"
FULL_SCENE_CONTAINER_BINARY = "/run/acp-chasm-render"
FULL_SCENE_CONTAINER_ARTIFACT_MANIFEST = "/run/acp-chasm-render-manifest.json"


def full_scene_manifest():
    """Hash the approved capture, audio and capture provenance for the full-scene request."""
    capture = Path(FULL_SCENE_CAPTURE_ROOT)
    audio = Path(FULL_SCENE_AUDIO)
    source = Path(FULL_SCENE_SOURCE_MANIFEST)
    if capture.is_symlink() or not capture.is_dir():
        raise ValueError("THE CHASM capture root is unavailable or unsafe")
    capture_root = capture.resolve(strict=True)
    if capture_root != capture.absolute():
        raise ValueError("THE CHASM capture root resolves outside its approved path")
    if (audio.is_symlink() or not audio.is_file()
            or audio.parent.resolve(strict=True) != audio.parent.absolute()
            or audio.resolve(strict=True).parent != audio.parent.resolve(strict=True)):
        raise ValueError("THE CHASM audio is unavailable or unsafe")
    if (source.is_symlink() or not source.is_file()
            or source.parent.resolve(strict=True) != source.parent.absolute()
            or source.resolve(strict=True).parent != source.parent.resolve(strict=True)):
        raise ValueError("THE CHASM source manifest is unavailable or unsafe")
    segments = []
    for index in range(FULL_SCENE_SEGMENTS):
        name = "seg" + str(index)
        directory = capture / name
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("Missing regular THE CHASM segment " + name)
        segment_root = directory.resolve(strict=True)
        if not segment_root.is_relative_to(capture_root):
            raise ValueError("THE CHASM segment resolves outside the approved capture root")
        files = []
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise ValueError("THE CHASM capture contains a symlink")
            if path.is_file():
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(segment_root):
                    raise ValueError("THE CHASM capture file escapes its segment root")
                relative = path.relative_to(capture).as_posix()
                files.append({"path": relative, "sha256": sha256_file(path)})
                if len(files) > FULL_SCENE_MANIFEST_MAX_FILES:
                    raise ValueError("THE CHASM segment exceeds the bounded file count")
        if not files:
            raise ValueError("THE CHASM segment has no capture files: " + name)
        segments.append({
            "name": name,
            "start": index * FULL_SCENE_SEGMENT_FRAMES,
            "end": (index + 1) * FULL_SCENE_SEGMENT_FRAMES,
            "frames": FULL_SCENE_SEGMENT_FRAMES,
            "files": files,
        })
    return {
        "schema": "acp.fframes-chasm-capture/v1",
        "capture_root": FULL_SCENE_CAPTURE_ROOT,
        "audio_path": FULL_SCENE_AUDIO,
        "source_manifest_sha256": sha256_file(source),
        "capture_pipeline_commit": FULL_SCENE_CAPTURE_COMMIT,
        "scene_source_commit": FULL_SCENE_SOURCE_COMMIT,
        "renderer_source_commit": FULL_SCENE_RENDERER_COMMIT,
        "renderer_artifact_commit": FULL_SCENE_RENDERER_SOURCE,
        "renderer_artifact_tree": FULL_SCENE_RENDERER_TREE,
        "renderer_binary_sha256": FULL_SCENE_BINARY_SHA256,
        "baseline_job": FULL_SCENE_BASELINE_JOB,
        "baseline_pipeline_commit": FULL_SCENE_BASELINE_COMMIT,
        "scene_source_file_hashes": dict(FULL_SCENE_SOURCE_FILE_HASHES),
        "audio_sha256": sha256_file(audio),
        "segments": segments,
    }


def validate_full_scene_manifest(manifest):
    """Validate the fixed study pins and six ordered, nonempty capture manifests."""
    if not isinstance(manifest, dict) or manifest.get("schema") != "acp.fframes-chasm-capture/v1":
        raise ValueError("Unexpected THE CHASM capture manifest schema")
    expected = {
        "capture_root": FULL_SCENE_CAPTURE_ROOT,
        "audio_path": FULL_SCENE_AUDIO,
        "capture_pipeline_commit": FULL_SCENE_CAPTURE_COMMIT,
        "scene_source_commit": FULL_SCENE_SOURCE_COMMIT,
        "renderer_source_commit": FULL_SCENE_RENDERER_COMMIT,
        "renderer_artifact_commit": FULL_SCENE_RENDERER_SOURCE,
        "renderer_artifact_tree": FULL_SCENE_RENDERER_TREE,
        "renderer_binary_sha256": FULL_SCENE_BINARY_SHA256,
        "baseline_job": FULL_SCENE_BASELINE_JOB,
        "baseline_pipeline_commit": FULL_SCENE_BASELINE_COMMIT,
        "scene_source_file_hashes": FULL_SCENE_SOURCE_FILE_HASHES,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValueError("THE CHASM manifest pin mismatch: " + key)
    for key in ("source_manifest_sha256", "audio_sha256"):
        if not isinstance(manifest.get(key), str) or not SHA64.fullmatch(manifest[key]):
            raise ValueError("THE CHASM manifest requires " + key)
    segments = manifest.get("segments")
    if not isinstance(segments, list) or len(segments) != FULL_SCENE_SEGMENTS:
        raise ValueError("THE CHASM manifest requires exactly six segments")
    seen = set()
    file_count = 0
    for index, segment in enumerate(segments):
        name = "seg" + str(index)
        if not isinstance(segment, dict) or segment.get("name") != name:
            raise ValueError("THE CHASM segments must be ordered seg0 through seg5")
        if (segment.get("start"), segment.get("end"), segment.get("frames")) != (
                index * FULL_SCENE_SEGMENT_FRAMES,
                (index + 1) * FULL_SCENE_SEGMENT_FRAMES,
                FULL_SCENE_SEGMENT_FRAMES):
            raise ValueError("THE CHASM segment range or frame count changed")
        files = segment.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError("THE CHASM segment file list is empty")
        for item in files:
            path = item.get("path") if isinstance(item, dict) else None
            if not isinstance(path, str) or "\\" in path or path.startswith("/"):
                raise ValueError("THE CHASM capture path must be relative")
            parts = PurePosixPath(path).parts
            if path.split("/") != list(parts) or len(parts) < 2 or parts[0] != name or any(part in ("", ".", "..") for part in parts):
                raise ValueError("THE CHASM capture path escapes its segment")
            if path in seen:
                raise ValueError("Duplicate THE CHASM capture path")
            if not isinstance(item.get("sha256"), str) or not SHA64.fullmatch(item["sha256"]):
                raise ValueError("THE CHASM capture file requires a SHA-256")
            file_count += 1
            if file_count > FULL_SCENE_MANIFEST_MAX_FILES:
                raise ValueError("THE CHASM manifest exceeds the bounded file count")
            seen.add(path)
    return manifest


def verify_full_scene_files(manifest, *, capture_root=None, audio_path=None, source_manifest_path=None):
    """Recheck the approved capture, audio and provenance files against manifest hashes."""
    manifest = validate_full_scene_manifest(manifest)
    capture = Path(capture_root or FULL_SCENE_CAPTURE_ROOT)
    capture_root = capture.resolve(strict=True)
    if capture.is_symlink() or not capture.is_dir():
        raise ValueError("THE CHASM capture root became unsafe")
    expected_paths = {item["path"] for segment in manifest["segments"] for item in segment["files"]}
    actual_paths = set()
    for index in range(FULL_SCENE_SEGMENTS):
        directory = capture / ("seg" + str(index))
        if directory.is_symlink() or not directory.is_dir() or not directory.resolve(strict=True).is_relative_to(capture_root):
            raise ValueError("THE CHASM segment directory is missing or unsafe")
        for path in directory.rglob("*"):
            if path.is_symlink():
                raise ValueError("THE CHASM capture contains a symlink")
            if path.is_file():
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(capture_root):
                    raise ValueError("THE CHASM capture file escapes the approved root")
                actual_paths.add(path.relative_to(capture).as_posix())
    if actual_paths != expected_paths:
        raise ValueError("THE CHASM capture file set changed")
    for segment in manifest["segments"]:
        for item in segment["files"]:
            path = capture / item["path"]
            if path.is_symlink() or not path.is_file() or not path.resolve(strict=True).is_relative_to(capture_root):
                raise ValueError("THE CHASM capture file is missing or unsafe: " + item["path"])
            if sha256_file(path) != item["sha256"]:
                raise ValueError("THE CHASM capture file hash changed: " + item["path"])
    audio = Path(audio_path or FULL_SCENE_AUDIO)
    if (audio.is_symlink() or not audio.is_file()
            or audio.parent.resolve(strict=True) != audio.parent.absolute()
            or audio.resolve(strict=True).parent != audio.parent.resolve(strict=True)
            or sha256_file(audio) != manifest["audio_sha256"]):
        raise ValueError("THE CHASM audio input hash changed or its path became unsafe")
    source = Path(source_manifest_path or FULL_SCENE_SOURCE_MANIFEST)
    if (source.is_symlink() or not source.is_file()
            or source.parent.resolve(strict=True) != source.parent.absolute()
            or source.resolve(strict=True).parent != source.parent.resolve(strict=True)
            or sha256_file(source) != manifest["source_manifest_sha256"]):
        raise ValueError("THE CHASM source manifest hash changed or its path became unsafe")
    return manifest


def store_full_scene_manifest(manifest):
    """Store a validated manifest at its content-addressed path under the fixed farm store."""
    validate_full_scene_manifest(manifest)
    content = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if not content or len(content) > FULL_SCENE_MANIFEST_MAX_BYTES:
        raise ValueError("THE CHASM capture manifest exceeds the bounded sidecar size")
    digest = hashlib.sha256(content).hexdigest()
    store = Path(FULL_SCENE_MANIFEST_STORE)
    if store.is_symlink() or not store.parent.is_dir() or store.parent.is_symlink():
        raise ValueError("THE CHASM manifest store parent must be an approved regular directory")
    if store.parent.resolve(strict=True) != store.parent.absolute():
        raise ValueError("THE CHASM manifest store parent resolves outside its approved path")
    store.mkdir(mode=0o750, exist_ok=True)
    if store.resolve(strict=True) != store.absolute():
        raise ValueError("THE CHASM manifest store resolves outside its approved path")
    path = store / (digest + ".json")
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != content:
            raise ValueError("Content-addressed THE CHASM manifest path has conflicting content")
    else:
        temporary = store / ("." + digest + "." + str(os.getpid()) + ".tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o444)
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.replace(temporary, path)
        finally:
            if temporary.exists():
                temporary.unlink()
    return digest


def read_full_scene_manifest(digest, *, path=None):
    """Read one bounded content-addressed manifest and verify its digest.

    The worker reads the read-only manifest bind inside its container. The
    scheduler uses the host content-addressed store while preparing the job.
    """
    if not isinstance(digest, str) or not SHA64.fullmatch(digest):
        raise ValueError("THE CHASM manifest digest must be a lowercase SHA-256")
    if path is None:
        store = Path(FULL_SCENE_MANIFEST_STORE)
        if (store.is_symlink() or not store.is_dir()
                or store.resolve(strict=True) != store.absolute()):
            raise ValueError("THE CHASM manifest store is unavailable or unsafe")
        path = store / (digest + ".json")
    else:
        path = Path(path)
        if (not path.is_absolute() or ".." in path.parts
                or path.parent.is_symlink() or not path.parent.is_dir()
                or path.parent.resolve(strict=True) != path.parent.absolute()):
            raise ValueError("THE CHASM manifest path is unavailable or unsafe")
    if path.is_symlink():
        raise ValueError("THE CHASM manifest path is unavailable or unsafe")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError("THE CHASM content-addressed manifest is missing or unsafe") from error
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > FULL_SCENE_MANIFEST_MAX_BYTES:
            raise ValueError("THE CHASM content-addressed manifest is oversized or not regular")
        content = source.read(FULL_SCENE_MANIFEST_MAX_BYTES + 1)
    if len(content) > FULL_SCENE_MANIFEST_MAX_BYTES:
        raise ValueError("THE CHASM content-addressed manifest exceeds its read bound")
    if hashlib.sha256(content).hexdigest() != digest:
        raise ValueError("THE CHASM content-addressed manifest hash mismatch")
    try:
        decoded = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("THE CHASM content-addressed manifest is invalid JSON") from error
    return validate_full_scene_manifest(decoded)


def build_full_scene(protocol_id, pipeline_commit, manifest_sha256, memory_gib, time_minutes):
    """Build a one-GPU request template for the six-segment THE CHASM study."""
    if protocol_id != "{id}" and (not isinstance(protocol_id, str) or not PROTOCOL.fullmatch(protocol_id)):
        raise ValueError("protocol_id must be a queue identifier or {id} template")
    if not isinstance(pipeline_commit, str) or not SHA40.fullmatch(pipeline_commit):
        raise ValueError("pipeline_commit must be a full lowercase Git commit SHA")
    if not isinstance(manifest_sha256, str) or not SHA64.fullmatch(manifest_sha256):
        raise ValueError("manifest_sha256 must be a full lowercase SHA-256")
    memory_gib = _positive(memory_gib, "memory_gib")
    time_minutes = _positive(time_minutes, "time_minutes")
    argv = [
        "sh", "videos/scripts/gpu_job.sh", "python", FULL_SCENE_PATH,
        "--id", protocol_id, "--gpus", "1", "--time", str(time_minutes),
        "--mem", str(memory_gib), "--",
        "--pipeline-commit", pipeline_commit,
        "--manifest-sha256", manifest_sha256,
    ]
    outputs = [
        "videos/out/gpu/{id}/deliver/the-chasm-fframes-full.mp4",
        "videos/out/gpu/{id}/deliver/fframes-full-scene-receipt.json",
        "videos/out/gpu/{id}/deliver/fframes-angle-comparison.json",
    ]
    queue = {
        "id": protocol_id,
        "pipeline_commit": pipeline_commit,
        "run": [shlex.join(argv)],
        "outputs": outputs,
        "dependencies": {"python": [], "system": [], "npm": []},
    }
    return {
        "schema": FULL_SCENE_SCHEMA,
        "protocol_id": protocol_id,
        "pipeline_commit": pipeline_commit,
        "manifest_sha256": manifest_sha256,
        "memory_gib": memory_gib,
        "time_minutes": time_minutes,
        "queue": queue,
    }


def post_full_scene(pipeline_commit, memory_gib, time_minutes):
    """Post the validated full-scene recipe to the ordinary protocol queue."""
    from protocol_bridge import command
    import farm
    manifest = full_scene_manifest()
    manifest_sha256 = store_full_scene_manifest(manifest)
    recipe = build_full_scene("{id}", pipeline_commit, manifest_sha256, memory_gib, time_minutes)
    command_args = [
        "post", "--title", "THE CHASM unchanged-source FFrames full-scene comparison",
        "--piece", "the_chasm", "--by", farm.CONFIG["protocol_worker"],
        "--commit", pipeline_commit, "--run", recipe["queue"]["run"][0],
        "--notes",
        "Render the unchanged THE CHASM capture as six sequential 289-frame segments "
        "on one normally admitted GPU UUID. FFrames Vulkan output is compared with the "
        "pinned Three.js/ANGLE master. No Blender scene is available.",
        "--dependencies", json.dumps(recipe["queue"]["dependencies"], sort_keys=True),
    ]
    for output in recipe["queue"]["outputs"]:
        command_args.extend(["--out", output])
    result = command(*command_args)
    lines = result.splitlines()
    if not lines or not PROTOCOL.fullmatch(lines[-1]):
        raise RuntimeError("Pipeline queue did not return a valid protocol identifier")
    return {"protocol_id": lines[-1], **{k: recipe[k] for k in
            ("pipeline_commit", "manifest_sha256", "memory_gib", "time_minutes")}}


GLASS_DIAGNOSTIC_SCHEMA = "acp.fframes-chasm-glass-diagnostic-recipe/v1"
GLASS_DIAGNOSTIC_PATH = "videos/gpu/fframes_chasm_glass_diagnostic.py"
GLASS_DIAGNOSTIC_FRAME = 1512


def build_glass_diagnostic(protocol_id, pipeline_commit, manifest_sha256, memory_gib, time_minutes):
    """Build a bounded, one-GPU request for the pinned CHASM glass frame."""
    if protocol_id != "{id}" and (not isinstance(protocol_id, str) or not PROTOCOL.fullmatch(protocol_id)):
        raise ValueError("protocol_id must be a queue identifier or {id} template")
    if not isinstance(pipeline_commit, str) or not SHA40.fullmatch(pipeline_commit):
        raise ValueError("pipeline_commit must be a full lowercase Git commit SHA")
    if not isinstance(manifest_sha256, str) or not SHA64.fullmatch(manifest_sha256):
        raise ValueError("manifest_sha256 must be a full lowercase SHA-256")
    memory_gib = _positive(memory_gib, "memory_gib")
    time_minutes = _positive(time_minutes, "time_minutes")
    argv = [
        "sh", "videos/scripts/gpu_job.sh", "python", GLASS_DIAGNOSTIC_PATH,
        "--id", protocol_id, "--gpus", "1", "--time", str(time_minutes),
        "--mem", str(memory_gib), "--",
        "--pipeline-commit", pipeline_commit,
        "--manifest-sha256", manifest_sha256,
        "--frame", str(GLASS_DIAGNOSTIC_FRAME),
    ]
    outputs = [
        "videos/out/gpu/{id}/deliver/glass-baseline-frame-1512.png",
        "videos/out/gpu/{id}/deliver/glass-pane_hidden-frame-1512.png",
        "videos/out/gpu/{id}/deliver/glass-pane_alpha-frame-1512.png",
        "videos/out/gpu/{id}/deliver/glass-baseline-renderer.log",
        "videos/out/gpu/{id}/deliver/glass-pane_hidden-renderer.log",
        "videos/out/gpu/{id}/deliver/glass-pane_alpha-renderer.log",
        "videos/out/gpu/{id}/deliver/chasm-glass-diagnostic-frame-1512-receipt.json",
    ]
    queue = {
        "id": protocol_id, "pipeline_commit": pipeline_commit,
        "run": [shlex.join(argv)], "outputs": outputs,
        "dependencies": {"python": [], "system": [], "npm": []},
    }
    return {
        "schema": GLASS_DIAGNOSTIC_SCHEMA, "protocol_id": protocol_id,
        "pipeline_commit": pipeline_commit, "manifest_sha256": manifest_sha256,
        "memory_gib": memory_gib, "time_minutes": time_minutes, "frame": GLASS_DIAGNOSTIC_FRAME,
        "queue": queue,
    }


def post_glass_diagnostic(pipeline_commit, manifest_sha256, memory_gib=8, time_minutes=12):
    """Post a three-variant, one-frame glass probe through the normal GPU queue."""
    from protocol_bridge import command
    import farm
    read_full_scene_manifest(manifest_sha256)
    recipe = build_glass_diagnostic("{id}", pipeline_commit, manifest_sha256, memory_gib, time_minutes)
    args = [
        "post", "--title", "THE CHASM frame 1512 glass diagnostic",
        "--piece", "the_chasm", "--by", farm.CONFIG["protocol_worker"],
        "--commit", pipeline_commit, "--run", recipe["queue"]["run"][0],
        "--notes",
        "Render baseline, pane-hidden, and pane-alpha variants of unchanged THE CHASM capture "
        "segment 5 local frame 67. This diagnostic compares the same camera frame and uses one "
        "normally admitted GPU UUID. It does not replace the full-scene request.",
        "--dependencies", json.dumps(recipe["queue"]["dependencies"], sort_keys=True),
    ]
    for output in recipe["queue"]["outputs"]:
        args.extend(["--out", output])
    result = command(*args)
    lines = result.splitlines()
    if not lines or not PROTOCOL.fullmatch(lines[-1]):
        raise RuntimeError("Pipeline queue did not return a valid diagnostic identifier")
    return {"protocol_id": lines[-1], **{k: recipe[k] for k in
            ("pipeline_commit", "manifest_sha256", "memory_gib", "time_minutes", "frame")}}
