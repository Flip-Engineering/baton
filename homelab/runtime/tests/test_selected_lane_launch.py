import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import selected_lane_launch


class SelectedLaneLaunchTests(unittest.TestCase):
    def test_gate_descriptor_is_inheritable_for_exec_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            descriptor = selected_lane_launch.acquire_shared(directory, "gpu0")
            try:
                self.assertTrue(os.get_inheritable(descriptor))
                self.assertTrue((Path(directory) / "continuation-gates/gpu0.lock").is_file())
            finally:
                os.close(descriptor)

    def test_launch_execs_selected_lane_through_receipting_launcher(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "runtime-releases" / ("a" * 40)
            runtime = release / "runtime"
            runtime.mkdir(parents=True)
            (runtime / "gpu_lane.py").write_text("# lane\n")
            selection = root / "runtime-selection.json"
            releases = root / "runtime-releases"
            loaded = {"release": {"release": release}}
            with patch.object(selected_lane_launch.runtime_selection, "load_selected", return_value=loaded) as load:
                with patch.object(selected_lane_launch.os, "execv") as execv:
                    selected_lane_launch.launch(root, "gpu0", selection, releases)
            load.assert_called_once_with(selection.resolve(), releases.resolve())
            executable, argv = execv.call_args.args
            self.assertEqual(executable, selected_lane_launch.sys.executable)
            self.assertEqual(argv[1], str(runtime / "runtime_launch.py"))
            self.assertEqual(argv[argv.index("--") + 1 :], ["gpu_lane.py", "gpu0", "work"])
            self.assertTrue((root / "continuation-gates/gpu0.lock").is_file())


if __name__ == "__main__":
    unittest.main()
