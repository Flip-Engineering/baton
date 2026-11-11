import hashlib
import importlib.util
import io
import os
import subprocess
import time
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import farm
import fframes_recipe as recipe
import gpu_allocation
import gpu_jobs

SOURCE = "a" * 40
PIPELINE = "c" * 40
BINARY_SHA = "b" * 64
UUID = "GPU-1a60290b-b538-1ac7-9a81-3978d3b12c60"


class FFramesRecipe(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.job = Path(self.temp.name) / "protocol-fframes-canary"
        self.job.mkdir()
        self.cards = [{"label": "gpu0", "uuid": UUID}]
        self.config = patch.dict(farm.CONFIG, gpus=self.cards, gpu_job_gpus=self.cards,
                                 gpu_job_cpu_limit=14, workers_per_gpu=1)
        self.config.start()
        self.addCleanup(self.config.stop)

    def build(self, **overrides):
        values = dict(protocol_id="fframes-canary", source_commit=SOURCE, pipeline_commit=PIPELINE,
                      binary_path="/nvme/acp-gpu/fframes/gpu_canary",
                      binary_sha256=BINARY_SHA, memory_gib=8, time_seconds=5,
                      expect_uuid=UUID)
        values.update(overrides)
        return recipe.build(**values)

    def test_recipe_is_accepted_by_the_deployed_parser(self):
        built = self.build()
        parsed = gpu_jobs.parse(dict(built["queue"], id=built["protocol_id"]))
        self.assertEqual(parsed["kind"], "gpu")
        self.assertEqual(parsed["gpu_kind"], "python")
        self.assertEqual(parsed["gpu_count"], 1)
        self.assertEqual(parsed["gpu_argv"], built["request"]["gpu_argv"])
        self.assertIn("videos/gpu/fframes_canary.py", parsed["gpu_argv"])
        self.assertEqual(built["queue"]["outputs"], ["videos/out/gpu/fframes-canary/deliver/"])

    def test_request_uses_pipeline_checkout_commit_separate_from_renderer_pin(self):
        built = self.build()
        farm.write(self.job / "request.json", built["request"])
        _, request = gpu_jobs.read_request(self.job)
        self.assertEqual(request["protocol_id"], built["protocol_id"])
        self.assertEqual(request["commit"], PIPELINE)
        argv = request["gpu_argv"]
        self.assertEqual(argv[argv.index("--source-commit") + 1], SOURCE)
        self.assertEqual(gpu_jobs.parse(built["queue"])["gpu_argv"], argv)
        self.assertEqual(gpu_jobs.launch_limits(self.job, request),
                         dict(memory_gib=8.0, cpu_cores=14.0))
        self.assertEqual(gpu_allocation.memory_required(self.job), 8 * 2**30)
        self.assertEqual(gpu_allocation.select(self.job, {}, {}), self.cards)
        self.assertIsNone(gpu_allocation.select(self.job, {UUID: 1}, {}))

    def test_source_binary_and_uuid_pins_are_explicit(self):
        built = self.build()
        pins = built["pins"]
        self.assertEqual(pins["source_commit"], SOURCE)
        self.assertEqual(pins["pipeline_commit"], PIPELINE)
        self.assertEqual(pins["recipe_path"], "videos/gpu/fframes_canary.py")
        self.assertEqual(pins["binary"], {"path": "/nvme/acp-gpu/fframes/gpu_canary", "sha256": BINARY_SHA})
        self.assertEqual(pins["uuid"]["expect_uuid"], UUID)
        self.assertEqual(pins["source_manifest"], "/run/acp-job-request.json")
        self.assertEqual(built["request"]["commit"], PIPELINE)
        self.assertEqual(built["queue"]["pipeline_commit"], PIPELINE)
        argv = built["request"]["gpu_argv"]
        self.assertEqual(argv[argv.index("--source-commit") + 1], SOURCE)
        self.assertEqual(argv[argv.index("--binary-sha256") + 1], BINARY_SHA)
        self.assertEqual(argv[argv.index("--expect-uuid") + 1], UUID)
        self.assertEqual(argv[argv.index("--gpus") + 1], "1")

    def test_invalid_pins_and_paths_are_rejected(self):
        bad = [
            dict(source_commit="a" * 39),
            dict(pipeline_commit="x" * 40),
            dict(source_commit="A" * 40),
            dict(binary_sha256="b" * 63),
            dict(binary_path="/tmp/gpu_canary"),
            dict(binary_path="/nvme/acp-gpu/../gpu_canary"),
            dict(expect_uuid="not-a-uuid"),
            dict(memory_gib=0),
            dict(time_seconds=-1),
            dict(protocol_id="bad id"),
            dict(source_manifest="relative/manifest.json"),
        ]
        for overrides in bad:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.build(**overrides)

    def test_tampered_recipe_is_rejected(self):
        built = self.build()
        built["request"]["gpu_argv"][-1] = "GPU-b7aaa373-d194-a71f-539d-e0a10dbfc4ce"
        with self.assertRaisesRegex(ValueError, "does not match its pins"):
            recipe.validate(built)

    def test_binary_pin_verifies_existing_file(self):
        directory = Path(self.temp.name) / "nvme/acp-gpu"
        directory.mkdir(parents=True)
        binary = directory / "gpu_canary"
        binary.write_bytes(b"canary")
        digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        with patch.object(recipe, "BINARY_PREFIX", str(directory) + "/"):
            built = self.build(binary_path=str(binary), binary_sha256=digest)
            self.assertEqual(recipe.verify_binary(built), digest)
            binary.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "does not match"):
                recipe.verify_binary(built)


class FullSceneRecipe(unittest.TestCase):
    def manifest(self):
        return {
            "schema": "acp.fframes-chasm-capture/v1",
            "capture_root": recipe.FULL_SCENE_CAPTURE_ROOT,
            "audio_path": recipe.FULL_SCENE_AUDIO,
            "source_manifest_sha256": "1" * 64,
            "capture_pipeline_commit": recipe.FULL_SCENE_CAPTURE_COMMIT,
            "scene_source_commit": recipe.FULL_SCENE_SOURCE_COMMIT,
            "renderer_source_commit": recipe.FULL_SCENE_RENDERER_COMMIT,
            "renderer_artifact_commit": recipe.FULL_SCENE_RENDERER_SOURCE,
            "renderer_artifact_tree": recipe.FULL_SCENE_RENDERER_TREE,
            "renderer_binary_sha256": recipe.FULL_SCENE_BINARY_SHA256,
            "baseline_job": recipe.FULL_SCENE_BASELINE_JOB,
            "baseline_pipeline_commit": recipe.FULL_SCENE_BASELINE_COMMIT,
            "scene_source_file_hashes": dict(recipe.FULL_SCENE_SOURCE_FILE_HASHES),
            "audio_sha256": "2" * 64,
            "segments": [
                {"name": "seg" + str(i), "start": i * 289, "end": (i + 1) * 289,
                 "frames": 289, "files": [{"path": "seg" + str(i) + "/scene.glb", "sha256": "3" * 64}]}
                for i in range(6)
            ],
        }

    def test_full_scene_recipe_is_a_normal_single_gpu_queue_request(self):
        digest = "4" * 64
        built = recipe.build_full_scene("{id}", PIPELINE, digest, 16, 240)
        command = built["queue"]["run"][0].replace("{id}", "fframes-chasm-test")
        parsed = gpu_jobs.parse({"id": "fframes-chasm-test", "pipeline_commit": PIPELINE, "run": [command]})
        self.assertEqual(parsed["gpu_count"], 1)
        self.assertEqual(parsed["gpu_kind"], "python")
        self.assertIn("videos/gpu/fframes_full_scene.py", parsed["gpu_argv"])
        self.assertEqual(parsed["gpu_argv"][parsed["gpu_argv"].index("--pipeline-commit") + 1], PIPELINE)
        self.assertEqual(parsed["gpu_argv"][parsed["gpu_argv"].index("--mem") + 1], "16.0")
        self.assertEqual(parsed["gpu_argv"][parsed["gpu_argv"].index("--manifest-sha256") + 1], digest)
        self.assertNotIn(json.dumps(self.manifest()), command)
        self.assertEqual(built["queue"]["pipeline_commit"], PIPELINE)
        self.assertEqual(len(built["queue"]["outputs"]), 3)

    def test_full_scene_manifest_rejects_ranges_segments_paths_and_source_pins(self):
        manifest = self.manifest()
        cases = []
        fewer = json.loads(json.dumps(manifest)); fewer["segments"].pop(); cases.append(fewer)
        bad_range = json.loads(json.dumps(manifest)); bad_range["segments"][2]["end"] += 1; cases.append(bad_range)
        bad_path = json.loads(json.dumps(manifest)); bad_path["segments"][0]["files"][0]["path"] = "seg0/../escape"; cases.append(bad_path)
        bad_source = json.loads(json.dumps(manifest)); bad_source["scene_source_commit"] = "a" * 40; cases.append(bad_source)
        for invalid in cases:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                recipe.validate_full_scene_manifest(invalid)

    def test_full_scene_files_are_rehashed_before_queue_use(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td); capture = base / "capture"
            for i in range(6):
                folder = capture / ("seg" + str(i)); folder.mkdir(parents=True)
                (folder / "scene.glb").write_bytes(("seg" + str(i)).encode())
            audio = base / "audio.m4a"; audio.write_bytes(b"audio")
            source = base / "source.json"; source.write_text("{}")
            with patch.object(recipe, "FULL_SCENE_CAPTURE_ROOT", str(capture)), \
                 patch.object(recipe, "FULL_SCENE_AUDIO", str(audio)), \
                 patch.object(recipe, "FULL_SCENE_SOURCE_MANIFEST", str(source)):
                manifest = recipe.full_scene_manifest()
                recipe.verify_full_scene_files(manifest, audio_path=audio, source_manifest_path=source)
                (capture / "seg5" / "scene.glb").write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "hash changed"):
                    recipe.verify_full_scene_files(manifest)
                (capture / "seg5" / "scene.glb").write_bytes(b"seg5")
                (capture / "seg0").rename(capture / "seg0-real")
                outside = base / "outside"; outside.mkdir()
                (outside / "scene.glb").write_bytes(b"seg0")
                (capture / "seg0").symlink_to(outside, target_is_directory=True)
                with self.assertRaisesRegex(ValueError, "segment directory"):
                    recipe.verify_full_scene_files(manifest)

    def test_content_addressed_manifest_is_read_bounded_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as td:
            with patch.object(recipe, "FULL_SCENE_MANIFEST_STORE", td):
                manifest = self.manifest()
                digest = recipe.store_full_scene_manifest(manifest)
                self.assertEqual(recipe.read_full_scene_manifest(digest), manifest)
                path = Path(td) / (digest + ".json")
                self.assertEqual(path.stat().st_mode & 0o222, 0)
                path.chmod(0o600)  # store_full_scene_manifest() deliberately leaves the file read-only
                path.write_text("{}")
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    recipe.read_full_scene_manifest(digest)
                oversized_digest = "5" * 64
                (Path(td) / (oversized_digest + ".json")).write_bytes(b"x" * 9)
                with patch.object(recipe, "FULL_SCENE_MANIFEST_MAX_BYTES", 8):
                    with self.assertRaisesRegex(ValueError, "oversized"):
                        recipe.read_full_scene_manifest(oversized_digest)

    def test_container_manifest_reader_validates_bound_file(self):
        with tempfile.TemporaryDirectory() as store, tempfile.TemporaryDirectory() as mounted:
            with patch.object(recipe, "FULL_SCENE_MANIFEST_STORE", store):
                manifest = self.manifest()
                digest = recipe.store_full_scene_manifest(manifest)
                source = Path(store) / (digest + ".json")
                path = Path(mounted) / "acp-fframes-full-scene-manifest.json"
                path.write_bytes(source.read_bytes())
                self.assertEqual(
                    recipe.read_full_scene_manifest(digest, path=path), manifest)
                path.write_text("{}")
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    recipe.read_full_scene_manifest(digest, path=path)
                path.unlink()
                path.symlink_to(source)
                with self.assertRaisesRegex(ValueError, "unavailable or unsafe"):
                    recipe.read_full_scene_manifest(digest, path=path)

    def test_full_scene_manifest_sidecar_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as other:
            target = Path(other) / "capture"
            target.mkdir()
            link = Path(td) / "capture"
            link.symlink_to(target, target_is_directory=True)
            with patch.object(recipe, "FULL_SCENE_CAPTURE_ROOT", str(link)):
                with self.assertRaisesRegex(ValueError, "capture root"):
                    recipe.verify_full_scene_files(self.manifest())

    def test_full_scene_mounts_use_digest_bound_read_only_inputs(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            capture = base / "capture"
            capture.mkdir()
            audio = base / "audio.m4a"; audio.write_bytes(b"audio")
            source = base / "source.json"; source.write_text("{}")
            gpu_work = base / "gpu-work"
            binary = gpu_work / Path(recipe.FULL_SCENE_BINARY).relative_to("/nvme/acp-gpu")
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"renderer")
            artifact = binary.parent / "manifest.json"; artifact.write_text("{}")
            binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
            store = base / "manifest-store"; store.mkdir()
            with patch.object(farm, "BASE", base), \
                 patch.object(recipe, "FULL_SCENE_CAPTURE_ROOT", str(capture)), \
                 patch.object(recipe, "FULL_SCENE_AUDIO", str(audio)), \
                 patch.object(recipe, "FULL_SCENE_SOURCE_MANIFEST", str(source)), \
                 patch.object(recipe, "FULL_SCENE_BINARY_SHA256", binary_hash), \
                 patch.object(recipe, "FULL_SCENE_MANIFEST_STORE", str(store)):
                manifest = self.manifest()
                digest = recipe.store_full_scene_manifest(manifest)
                requests = [
                    recipe.build_full_scene("fframes-chasm-test", PIPELINE, digest, 16, 240)["queue"],
                    recipe.build_glass_diagnostic("fframes-glass-test", PIPELINE, digest, 8, 2)["queue"],
                ]
                for queue in requests:
                    request = gpu_jobs.parse(dict(queue, id=queue["id"]))
                    mounts = gpu_jobs.full_scene_mounts({"gpu_argv": request["gpu_argv"]})
                    self.assertIn((binary.resolve(), recipe.FULL_SCENE_CONTAINER_BINARY), mounts)
                    self.assertIn((artifact.resolve(), recipe.FULL_SCENE_CONTAINER_ARTIFACT_MANIFEST), mounts)
                    destinations = {destination for _, destination in mounts}
                    self.assertEqual(destinations, {
                        recipe.FULL_SCENE_CONTAINER_CAPTURE,
                        recipe.FULL_SCENE_CONTAINER_AUDIO,
                        recipe.FULL_SCENE_CONTAINER_SOURCE_MANIFEST,
                        recipe.FULL_SCENE_CONTAINER_MANIFEST,
                        recipe.FULL_SCENE_CONTAINER_BINARY,
                        recipe.FULL_SCENE_CONTAINER_ARTIFACT_MANIFEST,
                    })

    def test_full_scene_container_artifact_path_rejects_escape(self):
        with self.assertRaisesRegex(ValueError, "escapes /nvme/acp-gpu"):
            gpu_jobs.lane_gpu_cache_source("/nvme/acp-gpu/../etc/passwd")

    def test_full_scene_submission_uses_protocol_post_and_normal_id_substitution(self):
        with patch.object(recipe, "full_scene_manifest", return_value=self.manifest()), \
             patch.object(recipe, "store_full_scene_manifest", return_value="4" * 64), \
             patch("protocol_bridge.command", return_value="1018-120000-the_chasm_full_scene") as command:
            result = recipe.post_full_scene(PIPELINE, 16, 240)
        self.assertEqual(result["protocol_id"], "1018-120000-the_chasm_full_scene")
        args = command.call_args.args
        self.assertEqual(args[0], "post")
        self.assertEqual(args[args.index("--commit") + 1], PIPELINE)
        self.assertIn("{id}", args[args.index("--run") + 1])
        self.assertIn("4" * 64, args[args.index("--run") + 1])
        self.assertEqual(args.count("--out"), 3)


RUNNER_PATH = Path(__file__).resolve().parents[3] / "videos" / "gpu" / "fframes_full_scene.py"
RUNNER_SPEC = importlib.util.spec_from_file_location("fframes_full_scene", RUNNER_PATH)
RUNNER = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(RUNNER)


class FullSceneRunner(unittest.TestCase):
    def test_segment_uses_exact_uuid_frame_range_and_checks_encoded_media(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); binary=root/"renderer"; binary.write_bytes(b"renderer")
            segment=root/"seg0"; segment.mkdir(); work=root/"work"; work.mkdir()
            receipt={"schema":"acp.chasm-render/v1","status":"ok","uuid":UUID,"frames":289,
                     "width":1080,"height":1920,"first_frame":0,"last_frame":288}
            class Child:
                def __init__(self, stdout=None, status=0): self.stdout=stdout; self.returncode=status
                def wait(self, timeout=None): return self.returncode
                def poll(self): return self.returncode
                def terminate(self): pass
                def kill(self): pass
            calls=[]
            def popen(argv, **kwargs):
                calls.append(argv)
                if argv[0]==str(binary):
                    kwargs["stderr"].write(("CHASM_RENDER_RECEIPT "+json.dumps(receipt)+"\n").encode())
                    return Child(io.BytesIO())
                Path(argv[-1]).write_bytes(b"encoded")
                return Child()
            probe={"streams":[{"width":1080,"height":1920,"r_frame_rate":"30/1","nb_read_frames":"289"}]}
            with patch.object(RUNNER.subprocess,"Popen",side_effect=popen), patch.object(
                RUNNER.subprocess,"run",return_value=type("Result",(),{"stdout":json.dumps(probe)})()):
                path, actual, stream=RUNNER.encode_segment(binary,UUID,segment,"seg0",work,time.monotonic()+30)
            self.assertEqual(actual,receipt)
            self.assertEqual(stream["nb_read_frames"],"289")
            self.assertEqual(calls[0][calls[0].index("--require-uuid")+1],UUID)
            self.assertEqual(calls[0][calls[0].index("--start")+1],"0")
            self.assertEqual(calls[0][calls[0].index("--end")+1],"289")
            self.assertEqual(calls[1][calls[1].index("-frames:v")+1],"289")
            self.assertEqual(path.read_bytes(),b"encoded")

    def test_encoder_start_failure_reaps_already_started_renderer(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); binary=root/"renderer"; binary.write_bytes(b"renderer")
            segment=root/"seg0"; segment.mkdir(); work=root/"work"; work.mkdir()
            class Child:
                def __init__(self): self.stdout=io.BytesIO(); self.returncode=None; self.stopped=False
                def poll(self): return self.returncode
                def wait(self,timeout=None): return self.returncode
                def terminate(self): self.stopped=True; self.returncode=-15
                def kill(self): self.stopped=True; self.returncode=-9
            renderer=Child()
            def popen(argv,**kwargs):
                if argv[0]==str(binary): return renderer
                raise OSError("ffmpeg unavailable")
            with patch.object(RUNNER.subprocess,"Popen",side_effect=popen):
                with self.assertRaisesRegex(OSError,"ffmpeg unavailable"):
                    RUNNER.encode_segment(binary,UUID,segment,"seg0",work,time.monotonic()+30)
            self.assertTrue(renderer.stopped)
            self.assertIsNotNone(renderer.returncode)

    def test_main_runs_all_six_segments_and_propagates_mux_and_decode_failures(self):
        for failure in ("mux", "decode"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as td:
                root=Path(td); output=root/"out"; output.mkdir()
                binary=root/"renderer"; binary.write_bytes(b"renderer")
                artifact=root/"manifest.json"
                artifact.write_text(json.dumps({"source_commit":RUNNER.FULL_SCENE_RENDERER_SOURCE,
                    "source_tree":RUNNER.FULL_SCENE_RENDERER_TREE,
                    "chasm_render_sha256":hashlib.sha256(binary.read_bytes()).hexdigest()}))
                manifest={"scene_source_commit":RUNNER.FULL_SCENE_SOURCE_COMMIT,
                    "renderer_source_commit":RUNNER.FULL_SCENE_RENDERER_COMMIT,
                    "renderer_artifact_commit":RUNNER.FULL_SCENE_RENDERER_SOURCE,
                    "renderer_artifact_tree":RUNNER.FULL_SCENE_RENDERER_TREE,
                    "segments":[{"name":"seg"+str(i)} for i in range(6)],
                    "baseline_job":"baseline","baseline_pipeline_commit":"d"*40,"audio_sha256":"e"*64}
                order=[]
                def encode_segment(binary_arg,uuid,segment_dir,name,work_dir,deadline):
                    order.append(name)
                    path=work_dir/(name+".mp4"); path.write_bytes(b"segment")
                    return path,{"status":"ok","frames":289},{"nb_read_frames":"289"}
                def run(argv,**kwargs):
                    if argv[0]=="nvidia-smi":
                        return type("Result",(),{"stdout":UUID+"\n","stderr":"","returncode":0})()
                    if argv[0]=="ffmpeg" and "concat" in argv:
                        if failure=="mux": return type("Result",(),{"stdout":"","stderr":"mux failed","returncode":1})()
                        Path(argv[-1]).write_bytes(b"master")
                        return type("Result",(),{"stdout":"","stderr":"","returncode":0})()
                    if argv[0]=="ffprobe":
                        result={"streams":[{"codec_type":"video","width":1080,"height":1920,
                            "r_frame_rate":"30/1","nb_read_frames":"1734"},
                            {"codec_type":"audio"}]}
                        return type("Result",(),{"stdout":json.dumps(result),"stderr":"","returncode":0})()
                    if argv[0]=="ffmpeg" and argv[-2:]==["null","-"]:
                        return type("Result",(),{"stdout":"","stderr":"decode failed","returncode":1 if failure=="decode" else 0})()
                    raise AssertionError(argv)
                orig_temp=RUNNER.tempfile.TemporaryDirectory
                def temp_factory(*args,**kwargs): return orig_temp(dir=root)
                admission={"schema":RUNNER.RECEIPT_SCHEMA,"gpu_uuids":[UUID],"job":"job",
                    "pipeline_commit":"c"*40,"request_sha256":"1"*64,"prepared_sha256":"2"*64,
                    "admission_sha256":"3"*64,"allocation_sha256":"4"*64,"boot_id":"boot",
                    "owner_start":"1","memory_bytes":1,"container_memory_gib":8,"container_cpu_cores":2}
                env={"GPU_OUT":str(output),"GPU_JOB_ID":"job","GPU_JOB_MAX_TIME":"5"}
                with patch.dict(os.environ,env,clear=False), \
                     patch.object(RUNNER,"admitted_context",return_value=(UUID,admission,5.0)), \
                     patch.object(RUNNER,"read_manifest",return_value=manifest), \
                     patch.object(RUNNER,"encode_segment",side_effect=encode_segment), \
                     patch.object(RUNNER,"FULL_SCENE_BINARY",str(binary)), \
                     patch.object(RUNNER,"FULL_SCENE_CONTAINER_BINARY",str(binary)), \
                     patch.object(RUNNER,"FULL_SCENE_CONTAINER_ARTIFACT_MANIFEST",str(artifact)), \
                     patch.object(RUNNER,"FULL_SCENE_BINARY_SHA256",hashlib.sha256(binary.read_bytes()).hexdigest()), \
                     patch.object(RUNNER.subprocess,"run",side_effect=run), \
                     patch.object(RUNNER.tempfile,"TemporaryDirectory",side_effect=temp_factory), \
                     patch("sys.argv",["fframes_full_scene.py","--pipeline-commit","c"*40,"--manifest-sha256","f"*64]):
                    expected_error = ("final THE CHASM mux failed" if failure=="mux"
                                      else "final THE CHASM full decode failed")
                    with self.assertRaisesRegex(RuntimeError,expected_error):
                        RUNNER.main()
                self.assertEqual(order,["seg0","seg1","seg2","seg3","seg4","seg5"])
                self.assertEqual((output/"the-chasm-fframes-full.mp4").exists(), failure == "decode")
                self.assertFalse((output/"fframes-full-scene-receipt.json").exists())

GLASS_RUNNER_PATH = Path(__file__).resolve().parents[3] / "videos" / "gpu" / "fframes_chasm_glass_diagnostic.py"
GLASS_RUNNER_SPEC = importlib.util.spec_from_file_location("fframes_chasm_glass_diagnostic", GLASS_RUNNER_PATH)
GLASS_RUNNER = importlib.util.module_from_spec(GLASS_RUNNER_SPEC)
GLASS_RUNNER_SPEC.loader.exec_module(GLASS_RUNNER)


class GlassDiagnosticRecipe(unittest.TestCase):
    def test_glass_diagnostic_uses_one_normal_gpu_request_and_fixed_frame(self):
        built = recipe.build_glass_diagnostic("glass-test", PIPELINE, "4" * 64, 8, 2)
        parsed = gpu_jobs.parse(dict(built["queue"], id="glass-test"))
        self.assertEqual(parsed["gpu_count"], 1)
        self.assertEqual(parsed["gpu_kind"], "python")
        self.assertIn("videos/gpu/fframes_chasm_glass_diagnostic.py", parsed["gpu_argv"])
        argv = parsed["gpu_argv"]
        self.assertEqual(argv[argv.index("--frame") + 1], "1512")
        self.assertEqual(argv[argv.index("--manifest-sha256") + 1], "4" * 64)
        self.assertEqual(argv[argv.index("--mem") + 1], "8.0")
        self.assertEqual(argv[argv.index("--time") + 1], "2.0")
        self.assertEqual(len(built["queue"]["outputs"]), 7)
        self.assertIn("glass-baseline-renderer.log", built["queue"]["outputs"][3])

    def test_glass_diagnostic_rejects_bad_source_pins_and_budget(self):
        for args in [
            ("bad id", PIPELINE, "4" * 64, 8, 2),
            ("glass-test", "x" * 40, "4" * 64, 8, 2),
            ("glass-test", PIPELINE, "x" * 64, 8, 2),
            ("glass-test", PIPELINE, "4" * 64, 0, 2),
            ("glass-test", PIPELINE, "4" * 64, 8, 0),
        ]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                recipe.build_glass_diagnostic(*args)

    def test_glass_diagnostic_post_uses_existing_manifest_and_protocol_queue(self):
        manifest = FullSceneRecipe().manifest()
        with patch.object(recipe, "read_full_scene_manifest", return_value=manifest), \
             patch("protocol_bridge.command", return_value="1018-120000-chasm_glass_diagnostic") as command:
            result = recipe.post_glass_diagnostic(PIPELINE, "4" * 64, 8)
        self.assertEqual(result["protocol_id"], "1018-120000-chasm_glass_diagnostic")
        args = command.call_args.args
        self.assertEqual(args[0], "post")
        self.assertIn("fframes_chasm_glass_diagnostic.py", args[args.index("--run") + 1])
        self.assertEqual(args.count("--out"), 7)
        self.assertEqual(result["frame"], 1512)
        self.assertEqual(result["time_minutes"], 12.0)
        self.assertIn("--time 12.0", args[args.index("--run") + 1])

    def test_renderer_timeout_preserves_bounded_stderr_in_delivery(self):
        with tempfile.TemporaryDirectory() as td:
            log = Path(td) / "renderer.log"
            timeout = subprocess.TimeoutExpired(["renderer"], 1, stderr=b"renderer diagnostic")
            with patch.object(GLASS_RUNNER.subprocess, "run", side_effect=timeout):
                with self.assertRaisesRegex(TimeoutError, "admitted diagnostic job limit"):
                    GLASS_RUNNER.render_frame(
                        Path("/renderer"), Path("/assets"), UUID, 67, time.monotonic() + 10, log)
            self.assertEqual(log.read_bytes(), b"renderer diagnostic")

    def test_renderer_receipt_matches_the_existing_marked_protocol(self):
        receipt = {
            "schema": "acp.chasm-render/v1", "status": "ok", "uuid": UUID,
            "frames": 1, "first_frame": 67, "last_frame": 67,
            "width": 1080, "height": 1920,
        }
        stderr = b"renderer info\nCHASM_RENDER_RECEIPT " + json.dumps(receipt).encode() + b"\n"
        self.assertEqual(GLASS_RUNNER.renderer_receipt(stderr, UUID, 67), receipt)
        with self.assertRaisesRegex(ValueError, "does not match"):
            GLASS_RUNNER.renderer_receipt(stderr, UUID, 68)

    def test_glb_variants_change_only_the_pinned_panes(self):
        import copy
        import json as jsonlib
        import struct
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            document = {
                "asset": {"version": "2.0"},
                "nodes": [{} for _ in range(555)],
                "materials": [{} for _ in range(44)],
            }
            for index, mesh in zip(GLASS_RUNNER.PANE_NODES, GLASS_RUNNER.PANE_MESHES):
                document["nodes"][index]["mesh"] = mesh
            document["materials"][GLASS_RUNNER.PANE_MATERIAL] = {
                "alphaMode": "BLEND", "pbrMetallicRoughness": {"baseColorFactor": [0.1, 0.2, 0.3, 0.5]}
            }
            encoded = jsonlib.dumps(document, separators=(",", ":")).encode()
            encoded += b" " * ((-len(encoded)) % 4)
            binary = b"DATA"
            source = base / "scene.glb"
            source.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + 8 + len(binary))
                               + struct.pack("<I4s", len(encoded), b"JSON") + encoded
                               + struct.pack("<I4s", len(binary), b"BIN\\x00") + binary)
            hidden = base / "hidden.glb"
            alpha = base / "alpha.glb"
            GLASS_RUNNER.write_glb_variant(source, hidden, "pane_hidden")
            GLASS_RUNNER.write_glb_variant(source, alpha, "pane_alpha")
            hidden_doc = GLASS_RUNNER.read_glb_json(hidden)
            alpha_doc = GLASS_RUNNER.read_glb_json(alpha)
            original_doc = GLASS_RUNNER.read_glb_json(source)
            self.assertTrue(all("mesh" not in hidden_doc["nodes"][i] for i in GLASS_RUNNER.PANE_NODES))
            self.assertTrue(all(original_doc["nodes"][i]["mesh"] == mesh
                                for i, mesh in zip(GLASS_RUNNER.PANE_NODES, GLASS_RUNNER.PANE_MESHES)))
            self.assertEqual(alpha_doc["materials"][GLASS_RUNNER.PANE_MATERIAL]
                             ["pbrMetallicRoughness"]["baseColorFactor"][3], 0.1)
            self.assertEqual(original_doc["materials"][GLASS_RUNNER.PANE_MATERIAL]
                             ["pbrMetallicRoughness"]["baseColorFactor"][3], 0.5)
            self.assertEqual(hidden.read_bytes()[-4:], b"DATA")
            self.assertEqual(alpha.read_bytes()[-4:], b"DATA")

if __name__ == "__main__":
    unittest.main()
