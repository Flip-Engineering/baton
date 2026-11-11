#!/bin/sh
# GPU JOB: the one command form the homelab farm runs for Blender and Python GPU work (FARMGPU, 3 Oct).
#   sh videos/scripts/gpu_job.sh blender videos/blender/SCRIPT.py [--gpus N] [--time MIN] [--mem GB] [--device cuda|optix] [--blend FILE] [--per-gpu] [-- ARGS]
#   sh videos/scripts/gpu_job.sh python  videos/gpu/SCRIPT.py     [--gpus N] [--time MIN] [--mem GB] [--per-gpu] [-- ARGS]
#   sh videos/scripts/gpu_job.sh check | setup-venv
# Outputs: videos/out/gpu/$GPU_JOB_ID/deliver/ (every file in it is the delivery, with receipt.json and log.txt).
# Everything is done by gpu_job.py (stdlib Python 3.8+): checks, limits, the receipt. Docs: research/capabilities/farm_gpu.md.
cd "$(dirname "$0")/../.." || exit 2
exec python3 videos/scripts/gpu_job.py "$@"
