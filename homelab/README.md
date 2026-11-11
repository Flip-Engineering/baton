# Homelab render runtime

The runtime directory contains the Python launcher and its local import dependencies copied from the active homelab deployment. SOURCE_PROVENANCE.json records each source path and SHA-256 before changes. The source pipeline checkout did not track this scheduler package.

The GPU launcher reads the durable request.json, validates its protocol ID and full source commit, and mounts that file read-only at /run/acp-job-request.json inside each container. It sets Docker CPU, memory, and memory-plus-swap limits from the queued job and records the manifest hash and limits in the prepared and delivery receipts.

Run focused tests from runtime:

    python3 -m unittest discover -s tests -p 'test_gpu_jobs.py'
    python3 -m unittest discover -s tests -p 'test_gpu_lane.py'
    python3 -m unittest discover -s tests -p 'test_admission_policy.py'
    python3 -m unittest discover -s tests -p 'test_gpu_allocation.py'


Runtime selection is a tracked, versioned document (`runtime-selection.json`). A selected release is validated against its `RELEASE.json` seal, provenance manifest, source commit, and every recorded file SHA-256. Activation increments the generation, refuses to overwrite a release, preserves earlier pins, and writes an activation receipt. The lane launcher acquires the lane continuation gate, then asks `runtime_launch.py` to execute `selected_lane_launch.py` from the selected release. `selected_lane_launch.py` records a launch receipt and executes that release's `gpu_lane.py` for the requested lane.

    python3 deploy_runtime.py --source runtime --releases /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-releases --revision <full-sha> --provenance SOURCE_PROVENANCE.json
    python3 runtime/runtime_selection.py activate --revision <full-sha> --releases /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-releases --selection /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-selection.json --receipts /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-activation-receipts

Install the selected release's `runtime_launch.py` and `runtime_selection.py` beside the production `runtime-selection.json`. Configure the lane unit to call `runtime_launch.py --selection <selection> --releases <releases> -- selected_lane_launch.py <farm-root> <lane>`. This starts the selected release through the lane continuation gate and preserves the selected lane scheduler.

The earlier staged `2637fcc3663e9f1468a140a56da37ae965313cfd` release is retained as a separate pin. It is not re-labelled and no activation writes into its directory.

Host-memory admission compares MemAvailable with the unspent part of each running reservation: declared budget minus `memory.current` from the job container's cgroup, clamped at zero. MemAvailable already excludes resident usage, so adding the resident part again would double count it. Prepared/unstarted reservations remain at their full recorded amount. If the container/cgroup cannot be read or no longer matches the running job, the full declared budget is reserved (fail closed).

    python3 -m unittest discover -s tests -p 'test_memory_admission.py'
    python3 -m unittest discover -s tests -p 'test_runtime_selection.py'

The S1 anatomy/body-deformation preflight and its measured comparison against
the committed human assets are documented in `ANATOMY_DEFORMATION.md`:

    python3 -m unittest discover -s tests -p 'test_human_anatomy_sim.py'
    python3 -m unittest discover -s tests -p 'test_person_anatomy_interface.py'

FFrames canary jobs use the ordinary `kind=gpu` prepared path with the repository-pinned `videos/gpu/fframes_canary.py` wrapper. `fframes_recipe.build()` emits the typed queue/request pair, pins the source commit, the absolute binary path and its SHA-256, one GPU slot, the cgroup memory request and the optional UUID expectation. The wrapper verifies those pins, the visible UUID, the actual cgroup limits and the admission receipt before writing the result receipt consumed by `gpu_jobs`. No parser special case or production-scene change is required.

    python3 -m unittest discover -s tests -p 'test_fframes_recipe.py'

`claim_reconciliation.py` reconciles duplicate local copies of one queue protocol id across lanes using the production `request.json`, `status.json`, `prepared.json` and `allocation.json` fields. Normal scheduler startup holds the shared admission lock and calls `retire_prepared_duplicates()`: when exactly one allocated active copy exists, stale prepared copies older than `duplicate_prepared_min_age_seconds` (default 300) with no allocation or admission marker are marked `superseded`/`retired` with a `retirement.json` receipt. The allocated active copy, its reservation and its files are never changed. Retirement is idempotent and refuses ambiguous prepared-only or multiple-active states. Set `retire_duplicate_prepared` to false to disable it.

    python3 -m unittest discover -s tests -p 'test_claim_reconciliation.py'

deploy_runtime.py stages the verified runtime under an immutable revision directory. A lane uses a staged release after the scheduler reserves its GPU and verifies that the worker can start without overlapping an active service.
