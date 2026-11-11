#!/usr/bin/env python3
"""MOTION c1: the GPU run for archival motion capture, prepared for the homelab (NOT RUN YET: no GPU on this machine).

Reads gpu_manifest.jsonl (written by archival_mocap.py pick: film, in/out seconds, fps, the chosen person's box per frame,
source and licence), runs a single-image 3D body model on each frame's crop, and writes a pose file in the SAME format the
CPU step's MediaPipe bake produces (frames[i].world = 33 landmarks in MediaPipe order, metres, hips at the origin;
frames[i].image = 33 x [x, y, visibility] normalised to the crop), so everything downstream already works:
lib/fx/rig/retarget.js cleanTrack / jointsAt -> PeopleRig.poseFromJoints -> people.js, and labs/motion/lab_film.js shows it.

Model of record: SAM 3D Body (Meta, Nov 2025; SAM License, commercial use permitted) with the MHR body model (Apache-2.0).
Not SMPL (research-only licence), not GVHMR (non-commercial). The model is called through MODEL_CMD so the exact entry point
can be set on the first GPU night without editing this file:

    MODEL_CMD="python /opt/sam-3d-body/demo.py --image {img} --bbox {x1},{y1},{x2},{y2} --out {out}" \
      python3 gpu_run.py --manifest gpu_manifest.jsonl --films ../../sources/footage --out ./gpu_out

MODEL_CMD must write {out} as JSON with "keypoints_3d": [[x, y, z], ...] in camera space (metres) and "keypoint_names"
(MHR/SAM 3D Body joint names). NAME_MAP below maps those names onto the MediaPipe slots; check it against the model's
actual names on the first run (the one thing this file cannot verify offline). Temporal smoothing and contact cleanup are
done downstream (retarget.js One-Euro + swap repair; FootPlant), so this adapter stays per-frame and stateless.
"""
import argparse, json, os, subprocess, sys, tempfile
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
MP = ['nose', 'eyeInL', 'eyeL', 'eyeOutL', 'eyeInR', 'eyeR', 'eyeOutR', 'earL', 'earR', 'mouthL', 'mouthR', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR',
      'pinkyL', 'pinkyR', 'indexL', 'indexR', 'thumbL', 'thumbR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'heL', 'heR', 'toL', 'toR']
# model joint name -> MediaPipe slot (VERIFY against the model's keypoint_names on the first GPU run)
NAME_MAP = {'nose': 'nose', 'left_ear': 'earL', 'right_ear': 'earR', 'left_shoulder': 'shL', 'right_shoulder': 'shR', 'left_elbow': 'elL', 'right_elbow': 'elR',
            'left_wrist': 'wrL', 'right_wrist': 'wrR', 'left_hip': 'hipL', 'right_hip': 'hipR', 'left_knee': 'knL', 'right_knee': 'knR', 'left_ankle': 'anL',
            'right_ankle': 'anR', 'left_heel': 'heL', 'right_heel': 'heR', 'left_big_toe': 'toL', 'right_big_toe': 'toR', 'left_eye': 'eyeL', 'right_eye': 'eyeR'}

def frame_png(film, t, path):
    subprocess.run([FF, '-loglevel', 'error', '-y', '-ss', f'{t:.4f}', '-i', film, '-frames:v', '1', path], check=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--manifest', required=True); ap.add_argument('--films', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--dry', action='store_true', help='print what would run'); a = ap.parse_args()
    cmd = os.environ.get('MODEL_CMD')
    if not cmd and not a.dry: sys.exit('set MODEL_CMD (see the docstring)')
    os.makedirs(a.out, exist_ok=True)
    for line in open(a.manifest):
        job = json.loads(line); film = os.path.join(a.films, job['film']); frames = []
        W0 = job['size'][1]                      # boxes are in the CPU step's decoded width; the GPU reads the film at full size
        with tempfile.TemporaryDirectory() as td:
            for k, (fi, box) in enumerate(zip(job['frames'], job['boxes'])):
                t = job['in'] + (fi - job['frames'][0]) / job['fps']; img, out = os.path.join(td, f'{k}.png'), os.path.join(td, f'{k}.json')
                if a.dry: print('frame', f'{t:.3f}', 'box', box[:4]); continue
                frame_png(film, t, img)
                import cv2; full = cv2.imread(img).shape[1]; s = full / W0; b = [v * s for v in box[:4]]
                subprocess.run(cmd.format(img=img, out=out, x1=b[0], y1=b[1], x2=b[2], y2=b[3]), shell=True, check=True)
                r = json.load(open(out)); kp = dict(zip(r['keypoint_names'], r['keypoints_3d']))
                hips = [(a_ + b_) / 2 for a_, b_ in zip(kp['left_hip'], kp['right_hip'])]
                world = [[0, 0, 0] for _ in MP]; vis = [0] * len(MP)
                for n, slot in NAME_MAP.items():
                    if n in kp: world[MP.index(slot)] = [kp[n][0] - hips[0], kp[n][1] - hips[1], kp[n][2] - hips[2]]; vis[MP.index(slot)] = 1
                frames.append({'i': k + 1, 't': k / job['fps'], 'world': world, 'image': [[0, 0, v] for v in vis]})
        if not a.dry:
            p = os.path.join(a.out, job['name'] + '_gpu.json'); json.dump({'src': f"{job.get('source')} ({job.get('licence')})", 'model': job['model'], 'frames': frames}, open(p, 'w')); print(p)

if __name__ == '__main__':
    main()
