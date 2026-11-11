"""subject_deliver.py: master + share + contact sheet for THE SUBJECT (lead build, 29 Sep).

    python3 tools/subject_deliver.py VIDEO.mp4 AUDIO.m4a OUTSTEM [--budget-mib 27]
      -> OUTSTEM.mp4        master: the rendered picture (stream copy) + the codec-true AAC (stream copy)
         OUTSTEM_share.mp4  x264 two-pass, bitrate-capped to the budget, + the same AAC (copy); must be under 30 MiB
         OUTSTEM_sheet.jpg  a 4x4 contact sheet of the master (frame numbers and times burned in)
Run from videos/. ffmpeg: imageio-ffmpeg's static binary.
"""
import argparse, os, subprocess, sys, json, re
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
if not os.path.exists(FF):          # 16 Oct: on the farm (a GPU job's venv) the static binary lives elsewhere
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()


def dur(p):
    e = subprocess.run([FF, '-hide_banner', '-i', p], capture_output=True, text=True).stderr
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', e)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('audio'); ap.add_argument('stem')
    ap.add_argument('--budget-mib', type=float, default=27.0)
    a = ap.parse_args()
    master, share, sheet = a.stem + '.mp4', a.stem + '_share.mp4', a.stem + '_sheet.jpg'
    T = dur(a.video)
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', a.video, '-i', a.audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
                    '-t', '%.3f' % T, '-movflags', '+faststart', master], check=True)
    abr = 192
    vbr = int(a.budget_mib * 8 * 1024 * 1024 / T / 1000 - abr - 60)
    log = a.stem + '.x264pass'
    # v3: the judges measured the share at 26-34 dB PSNR against the master on the mosaic: tune film + aq-mode 3 spend the bits on texture
    enc = ['-c:v', 'libx264', '-preset', 'slower', '-tune', 'film', '-x264-params', 'aq-mode=3:aq-strength=0.9', '-b:v', '%dk' % vbr, '-maxrate', '%dk' % int(vbr * 1.5), '-bufsize', '%dk' % int(vbr * 2),
           '-pix_fmt', 'yuv420p', '-passlogfile', log]
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', master, '-map', '0:v:0'] + enc + ['-pass', '1', '-an', '-f', 'mp4', '/dev/null'], check=True)
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', master, '-i', a.audio, '-map', '0:v:0', '-map', '1:a:0'] + enc +
                   ['-pass', '2', '-c:a', 'copy', '-t', '%.3f' % T, '-movflags', '+faststart', share], check=True)
    for f in os.listdir(os.path.dirname(os.path.abspath(log))):
        if f.startswith(os.path.basename(log)):
            os.remove(os.path.join(os.path.dirname(os.path.abspath(log)), f))
    n = 16
    fps = 16.0 / T
    if True:
        subprocess.run([FF, '-y', '-loglevel', 'error', '-i', master, '-vf', 'fps=%f,scale=270:480,tile=8x2' % fps, '-frames:v', '1', sheet], check=True)
    out = dict(master=master, master_mib=round(os.path.getsize(master) / 2 ** 20, 2), share=share, share_mib=round(os.path.getsize(share) / 2 ** 20, 2),
               video_kbps=vbr, seconds=round(T, 3), sheet=sheet)
    # the delivered seam, measured on the decoded deliverable (the audio must be exactly the loop: see tools/subject_loop_audio.py)
    import numpy as np
    for k in ('master', 'share'):
        y = subprocess.run([FF, '-v', 'error', '-i', out[k], '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-'], capture_output=True).stdout
        y = np.frombuffer(y, np.float32).reshape(-1, 2)
        out[k + '_audio_samples'] = len(y)
        out[k + '_seam_step_dbfs'] = round(float(20 * np.log10(np.abs(y[-1] - y[0]).max() + 1e-12)), 1)
    print(json.dumps(out))
    if out['share_mib'] >= 30:
        sys.exit('share copy is not under 30 MiB')


if __name__ == '__main__':
    main()
