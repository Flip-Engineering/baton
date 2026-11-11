# THE PERSON'S CYCLES GUARD (integration). render_person.py calls install(parts) right after person_scene.build(), and arm_vanish() /
# verify_render() around every render (8 Oct 21:30, the round-7 integrator's iteration 1 of the continuation).
#
# THE DEFECT: the WHOLE skin object (head, neck, hands; hair, eyes, lashes and clothes drawn) drops out of some full-size Cycles renders of the
# person for identical inputs: L12 face + full, L22 face, L03 bust (1008-1426xx), HAIRMAT's L08 control (1008-172339: the same person, shot
# and job as two renders that kept it), SKIN OPTICS A's L08 face window (1008-172053). Every loss had DETAIL7's fine displacement through
# Cycles' adaptive subdivision (5 of 38 such renders by 20:30; 0 of 132 without it); the quarter-size meter render in the same process
# always had the skin. The backdrop shows through the head: the object is not traced at all.
# WHAT THE CYCLES SOURCE SAYS (v5.2.2, read 8 Oct 21:20: scene/object.cpp, scene/mesh.cpp, scene/mesh_displace.cpp, bvh/build.cpp): an
# object is left out of the BVH only when Object::is_traceable() is false, i.e. its bounds are invalid or of zero size, which
# Mesh::compute_bounds() gives only for a mesh with NO finite vertex (it skips NaN / Inf vertices and keeps the rest), and the
# displacement offsets are already made finite by Cycles (read_shader_output: ensure_finite). So iteration 2's hypothesis (a NaN texel)
# is REFUTED by the source: a loss means the adaptive tessellation of the skin came out EMPTY (or wholly non-finite) in that render
# session, which only a subdivision mesh can do (its vertices exist only after Cycles dices it at render time). Why the dicing comes out
# empty for the same inputs in one session in four is not in our code (no per-process randomness reaches the skin) and is not settled:
# the logs this module writes (the GPU's memory and its other processes at each attempt) are the test of the remaining suspect (two or
# three heavy Cycles jobs sharing one V100).
# THE FIX (it cannot recur, whatever the cause): EVERY render of the person is VERIFIED from its own object-index pass (the skin object
# carries pass index 7; the render result is saved once as a multilayer EXR beside the still, its IndexOB read, the file deleted). A render
# in which the skin is in view but not traced is RENDERED AGAIN (a fresh Cycles session: 'same', up to twice), then, if it is still lost,
# with the skin PRE-DICED by Blender (the fine tier's Catmull-Clark at its render level 2, the relief displaced on those vertices: no
# adaptive dicing), which never lost the skin. 'In view' is the meter's finding (the skin seen in the face box with hair and clothes
# hidden), or, without a meter (a crop, --no-meter, --exposure-from), quick probe renders of the same camera. Logged per render
# ('person_guard vanish: {...}') and in the still's json ('vanish'). render_person.py --vanish record verifies and logs without
# re-rendering (the diagnostic); --vanish off skips it.
# (22:20, c2 iteration 2) THE MECHANISM REMOVED: the fine tier's skin is now PRE-DICED BY DEFAULT (person_scene's fine7 block: no adaptive
# dicing unless FINE7_CYC {"adaptive": 1}); dice_for_camera() below sets the Catmull-Clark render level for the shot's camera (the head's
# 2.5 mm base edge in pixels: level ceil(log2(px / dicing)) clamped 2..3: the face and bust shots 3, the full 2), so the relief keeps about the
# 1 px micropolygon of the adaptive path where it is seen up close. Every loss on record came from the adaptive path (0 of 132 renders
# without it); the verify ladder stays as the check that a still has the skin, whatever else might drop it.
# install() (iteration 2) is kept as a measurement only: it counts non-finite texels in the images feeding a Displacement and non-finite
# vertex positions per mesh (its socket sanitizer is gone: Cycles makes the offsets finite itself).
import json
import numpy as np
import bpy



def _upstream_images(sock, seen=None):
    seen = set() if seen is None else seen
    out = []
    for lk in sock.links:
        n = lk.from_node
        if n.name in seen:
            continue
        seen.add(n.name)
        if n.type == 'TEX_IMAGE' and n.image is not None:
            out.append(n.image)
        for s in n.inputs:
            if s.is_linked:
                out += _upstream_images(s, seen)
    return out


def _clean_image(im):
    try:
        w, h = im.size
        ch = im.channels
        if not (w and h and ch):
            return None
        px = np.empty(w * h * ch, dtype=np.float32)
        im.pixels.foreach_get(px)
        bad = ~np.isfinite(px)
        nb = int(bad.sum())
        rec = {'size': [w, h], 'float': bool(im.is_float), 'nonfinite': nb}
        if nb:
            a = px.reshape(-1, ch); badc = bad.reshape(-1, ch)
            rec['byChannel'] = [int(x) for x in badc.sum(0)]
            for c in range(ch):
                if badc[:, c].any():
                    good = a[~badc[:, c], c]
                    a[badc[:, c], c] = float(np.median(good)) if good.size else 0.0
            im.pixels.foreach_set(a.ravel()); im.update()
            if im.packed_file is not None:
                try:
                    im.pack(); rec['repacked'] = True
                except Exception as e:
                    rec['repacked'] = repr(e)[:120]
        return rec
    except Exception as e:
        return {'error': repr(e)[:200]}


def install(parts=None):
    rec = {'materials': [], 'images': {}, 'meshes': {}}
    done_img = set()
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.node_tree is None:
            continue
        nt = mat.node_tree
        for out in [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL']:
            ds = out.inputs.get('Displacement')
            if ds is None or not ds.is_linked:
                continue
            for im in _upstream_images(ds):
                if im.name not in done_img:
                    done_img.add(im.name); rec['images'][im.name] = _clean_image(im)
            rec['materials'].append(mat.name)
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.data is None:
            continue
        me = ob.data; n = len(me.vertices)
        if not n:
            continue
        co = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co)
        nb = int((~np.isfinite(co)).sum())
        if nb:
            rec['meshes'][ob.name] = nb
    print('person_guard:', json.dumps(rec), flush=True)
    return rec


# ---------------------------------------------------------------- the vanishing skin: verify every render, render again, pre-dice
import os, struct, subprocess, time, zlib

SKIN_PASS_INDEX = 7   # the skin object's pass index (nothing else in the person's scene sets one: every other object is 0)


def read_exr(path, want=None):
    """the channels of a scanline OpenEXR file as {name: float32 (h, w)}: Blender's bundled OpenImageIO when it imports, else a numpy
    reader of single-part scanline files with NONE / ZIPS / ZIP compression (what verify_render writes: NONE). want: a predicate on the
    channel name (None = all)."""
    try:
        import OpenImageIO as oiio
        buf = oiio.ImageBuf(path); spec = buf.spec(); px = np.asarray(buf.get_pixels(oiio.FLOAT), dtype=np.float32)
        px = px.reshape(spec.height, spec.width, spec.nchannels)
        out = {n: px[..., i] for i, n in enumerate(spec.channelnames) if want is None or want(n)}
        if out:   # (a multi-part file's other parts are not in subimage 0: then the numpy reader says why)
            return out, 'oiio'
    except Exception:
        pass
    return _read_exr_np(path, want), 'numpy'


def _read_exr_np(path, want=None):
    d = open(path, 'rb').read()
    if struct.unpack_from('<i', d, 0)[0] != 20000630:
        raise ValueError('not an OpenEXR file')
    ver = struct.unpack_from('<i', d, 4)[0]
    if ver & 0x200 or ver & 0x800 or ver & 0x1000:
        raise ValueError('tiled / deep / multipart EXR (version flags %#x)' % ver)
    p = 8; hdr = {}
    while d[p] != 0:
        e = d.index(b'\0', p); name = d[p:e].decode(); p = e + 1
        e = d.index(b'\0', p); typ = d[p:e].decode(); p = e + 1
        n = struct.unpack_from('<i', d, p)[0]; p += 4
        hdr[name] = (typ, d[p:p + n]); p += n
    p += 1
    ch = []; v = hdr['channels'][1]; q = 0
    while v[q] != 0:
        e = v.index(b'\0', q); nm = v[q:e].decode(); q = e + 1
        pt, _lin, xs, ys = struct.unpack_from('<iB3xii', v, q); q += 16
        if xs != 1 or ys != 1:
            raise ValueError('subsampled channel ' + nm)
        ch.append((nm, pt))
    comp = hdr['compression'][1][0]
    x0, y0, x1, y1 = struct.unpack('<iiii', hdr['dataWindow'][1]); W, H = x1 - x0 + 1, y1 - y0 + 1
    lpb = {0: 1, 2: 1, 3: 16}.get(comp)
    if lpb is None:
        raise ValueError('EXR compression %d not read here' % comp)
    nblk = (H + lpb - 1) // lpb
    offs = struct.unpack_from('<%dQ' % nblk, d, p)
    size = {0: 4, 1: 2, 2: 4}; dt = {0: np.uint32, 1: np.float16, 2: np.float32}
    out = {nm: np.zeros((H, W), np.float32) for nm, _ in ch if want is None or want(nm)}
    for o in offs:
        y, n = struct.unpack_from('<ii', d, o); raw = d[o + 8:o + 8 + n]
        nl = min(lpb, y1 - y + 1)
        exp = nl * W * sum(size[pt] for _, pt in ch)
        if comp and n < exp:
            t = np.frombuffer(zlib.decompress(raw), dtype=np.uint8)
            # OpenEXR's ZIP: undo the predictor (t[i] = t[i-1] + t[i] - 128, mod 256, running), then the two-halves interleave
            t2 = np.empty_like(t); t2[0] = t[0]; t2[1:] = ((int(t[0]) + np.cumsum(t[1:].astype(np.int64) - 128)) % 256).astype(np.uint8)
            h = (len(t2) + 1) // 2
            raw = np.empty(len(t2), np.uint8); raw[0::2] = t2[:h]; raw[1::2] = t2[h:]
            raw = raw.tobytes()
        b = 0
        for li in range(nl):
            for nm, pt in ch:
                k = W * size[pt]
                if nm in out:
                    out[nm][y - y0 + li] = np.frombuffer(raw, dtype=dt[pt], count=W, offset=b).astype(np.float32)
                b += k
    return out


def host_state():
    """the host's CPUs (the scene sync, the subdivision and the BVH build run there): load, other Blender / node processes, this
    process's peak RSS (22:20: the critic's ask: the receipt has the cards, not the jobs sharing the host's CPUs)"""
    try:
        la = os.getloadavg()
        ps = subprocess.run(['ps', '-eo', 'comm='], capture_output=True, text=True, timeout=10).stdout.split()
        import resource
        return {'load1': round(la[0], 1), 'load5': round(la[1], 1), 'cpus': os.cpu_count(), 'blender': sum(1 for x in ps if x.startswith('blender')),
                'node': sum(1 for x in ps if x == 'node'), 'rssPeakGB': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2 ** 20, 2)}
    except Exception as e:
        return {'error': repr(e)[:120]}


def gpu_state():
    """the cards' memory and the processes on them (nvidia-smi), for the log: None where there is no nvidia-smi"""
    try:
        g = subprocess.run(['nvidia-smi', '--query-gpu=index,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        a = subprocess.run(['nvidia-smi', '--query-compute-apps=gpu_uuid,pid,used_memory', '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        return {'gpus': [x.replace(' ', '') for x in g], 'apps': len(a), 'appsMiB': [x.split(',')[-1].strip() for x in a][:12],
                'cvd': os.environ.get('CUDA_VISIBLE_DEVICES'), 'host': host_state()}
    except Exception as e:
        return {'error': repr(e)[:120]}


def arm_vanish(sc, body):
    """the object-index pass on, the skin marked (pass index 7). Nothing in the picture changes (a data pass; no material reads it)."""
    st = {'on': False}
    try:
        for vl in sc.view_layers:
            vl.use_pass_object_index = True
        body.pass_index = SKIN_PASS_INDEX
        st['on'] = True
    except Exception as e:
        st['error'] = repr(e)[:200]
    return st


def skin_pixels(sc, path):
    """how many pixels of the LAST render show the skin as their first hit (its IndexOB == 7): the render result saved once as a
    multilayer EXR (uncompressed) at path, read, deleted. (None, why) when it cannot be read."""
    rr = bpy.data.images.get('Render Result')
    if rr is None:
        return None, 'no render result'
    s = sc.render.image_settings
    old = {k: getattr(s, k, None) for k in ('media_type', 'file_format', 'color_depth', 'exr_codec')}
    try:
        if hasattr(s, 'media_type'):
            s.media_type = 'MULTI_LAYER_IMAGE'
        s.file_format = 'OPEN_EXR_MULTILAYER'; s.color_depth = '32'; s.exr_codec = 'NONE'
        rr.save_render(filepath=path, scene=sc)
    except Exception as e:
        return None, 'save: ' + repr(e)[:160]
    finally:
        for k in ('media_type', 'file_format', 'color_depth', 'exr_codec'):
            if old[k] is not None:
                try:
                    setattr(s, k, old[k])
                except Exception:
                    pass
    try:
        chans, how = read_exr(path, want=lambda n: 'IndexOB' in n)
        if not chans:
            return None, 'no IndexOB channel (%s)' % how
        idx = next(iter(chans.values()))
        return int((np.abs(idx - SKIN_PASS_INDEX) < 0.5).sum()), how
    except Exception as e:
        return None, 'read: ' + repr(e)[:160]
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


_LEVEL = {}


def dice_for_camera(sc, cam, body, head, W, H, fine=None, edge_m=0.0025, lo=2, hi=3):
    """(22:20) the pre-diced skin's Catmull-Clark render level for THIS camera: the head's base edge (2.5 mm: the export's quads on the
    face) projected to pixels at the full size W x H, level = ceil(log2(px / dicing)) clamped lo..hi (each level halves the edge: the
    face shot (fov 24, 0.99 m) ~8 px -> 3, the bust (fov 26, ~1.66 m) ~4.4 px -> 3, the full
    (fov 20, ~5.4 m) ~1.8 px -> 2: about 1 px micropolygons, as the adaptive path's dicing rate 1), unless FINE7_CYC {"level": n} fixed it. On an adaptive person
    (FINE7_CYC {"adaptive": 1}) the level is only remembered, for the ladder's pre-dice. Returns the record for the still's json."""
    import math
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector
    mod = body.modifiers.get('fine7_subd')
    if mod is None:
        return {'diced': None}
    var = (fine or {}).get('variant') or {}
    p = Vector(head); r = cam.matrix_world.to_3x3() @ Vector((1.0, 0.0, 0.0))
    a, b = world_to_camera_view(sc, cam, p), world_to_camera_view(sc, cam, p + r * edge_m)
    px = math.hypot((a.x - b.x) * W, (a.y - b.y) * H)
    dice = float(var.get('dicing', 1.0) or 1.0)
    lvl = int(var['level']) if var.get('level') is not None else int(min(hi, max(lo, math.ceil(math.log2(max(px / dice, 1.0))))))
    _LEVEL['level'] = lvl
    nf = len(body.data.polygons)
    if (fine or {}).get('diced') == 'cycles':
        return {'diced': 'cycles (adaptive)', 'edgePx': round(px, 2), 'levelIfPrediced': lvl}
    mod.render_levels = lvl
    return {'diced': 'blender', 'edgePx': round(px, 2), 'level': lvl, 'baseFaces': nf, 'facesAtLevel': nf * 4 ** lvl}


def predice(body):
    """the fallback: the fine tier's subdivision evaluated by Blender (Catmull-Clark at the camera's level, dice_for_camera; else the
    modifier's render level), so Cycles gets a finished mesh and displaces its vertices: no adaptive dicing at render time. Returns what it
    changed (None: nothing adaptive)."""
    done = []
    for m in body.modifiers:
        if m.type == 'SUBSURF':
            for nm in ('use_adaptive_subdivision', 'adaptive_subdivision'):
                if getattr(m, nm, False):
                    try:
                        setattr(m, nm, False); done.append(m.name + '.' + nm)
                    except Exception:
                        pass
    cy = getattr(body, 'cycles', None)
    if cy is not None and getattr(cy, 'use_adaptive_subdivision', False):
        try:
            cy.use_adaptive_subdivision = False; done.append('cycles.use_adaptive_subdivision')
        except Exception:
            pass
    if done and _LEVEL.get('level') and body.modifiers.get('fine7_subd') is not None:
        body.modifiers['fine7_subd'].render_levels = _LEVEL['level']; done.append('render_levels=%d' % _LEVEL['level'])
    return done or None


def verify_render(do_render, sc, body, out_dir, tag, mode='retry', expected=None, probe=None, log=print):
    """render through do_render() (it renders the still and returns its time) and make sure the skin is in it.
    expected: True / False / None (None: ask probe() -> pixel count, up to three times, when the still shows no skin).
    mode 'retry': up to two more renders, then one pre-diced render; 'record': verify and log only. Returns (render seconds of the
    kept render, the record)."""
    rec = {'mode': mode, 'attempts': []}
    tmp = os.path.join(out_dir, '_%s_vanish_check.exr' % tag)
    plan = ['first', 'same', 'same', 'predice'] if mode == 'retry' else ['first']
    tr = None
    for step in plan:
        if step == 'predice':
            rec['predice'] = predice(body)
            if not rec['predice']:
                rec['outcome'] = 'vanished (no adaptive subdivision to pre-dice)'; break
        t0 = time.time(); tr = do_render(); n, how = skin_pixels(sc, tmp)
        a = {'step': step, 'skinPx': n, 'reader': how, 'render_s': round(tr, 1), 'check_s': round(time.time() - t0 - tr, 1), 'gpu': gpu_state()}
        rec['attempts'].append(a)
        if n is None:
            rec['outcome'] = 'unchecked'; break
        if n > 0:
            rec['outcome'] = 'kept' if step == 'first' else ('kept after ' + step + ' x%d' % (len(rec['attempts']) - 1))
            break
        if expected is None and probe is not None:
            pr = []
            for _ in range(3):
                pn = probe(); pr.append(pn)
                if pn:
                    break
            rec['probe'] = pr; expected = any(pr)
        if not expected:
            rec['outcome'] = 'no skin in view'; break
        log('person_guard vanish: LOST %s (%s, attempt %d): %s' % (tag, step, len(rec['attempts']), json.dumps(a)))
        if mode != 'retry':
            rec['outcome'] = 'lost (recorded)'; break
    else:
        rec['outcome'] = 'vanished'
    log('person_guard vanish: ' + json.dumps({'tag': tag, **rec}))
    return tr, rec
