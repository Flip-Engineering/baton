# LIGHT5 (round 5, judge c10 step 5): Cycles fixes for our people, each OPT-IN from render_person.py (without the flags every call
# renders as before).
#   thickness_sss(parts, ref_mm=None, smin=0.12)  --sss-thick [ref mm | auto]: subsurface radius scaled by the local THICKNESS of the
#       skin (a ray from each body vertex inward along -normal to the next surface of the body or the eye globes; 2 smoothing passes):
#       scale x clamp(t / ref, smin, 1). auto ref = 3 x the red radius x the person's sss (3.6 mm at rev-4 skin's 0.6): a lower lid over
#       the globe (1-2 mm) keeps 0.28-0.55 of its radius, an ear's rim (3-5 mm) most of it, a cheek all of it. Why: FACE4's thin raised
#       lower lid lit by a high key glowed orange under the random walk (red's 1.2 mm radius spread over the whole fold: judge c10).
#   quality(scene, preset)  --quality still | farm: 'still' = 64-128 spp on this CPU (adaptive threshold 0.015 from 24 samples, OIDN
#       high quality with albedo + normal and the accurate prefilter, path guiding on surfaces (CPU only), a 1.2 px filter for crisper
#       1:1 detail); 'farm' = >= 256 spp full size on the farm's GPU job type (threshold 0.005 from 64, OIDN on the GPU, no guiding:
#       Cycles guides on the CPU only). Indirect clamp stays Cycles' 10.
import math
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _world_mesh(obs):
    dg = bpy.context.evaluated_depsgraph_get(); V, F = [], []
    for ob in obs:
        if ob is None or ob.type != 'MESH':
            continue
        ev = ob.evaluated_get(dg); m = ev.to_mesh(); M = ob.matrix_world; o = len(V)
        V += [M @ v.co for v in m.vertices]; F += [[o + i for i in p.vertices] for p in m.polygons]
        ev.to_mesh_clear()
    return V, F


def skin_thickness(parts, max_d=0.02, start=0.0001, smooth=2):
    """per body vertex: the distance (m) inward along -normal to the next surface (the body itself, or an eye globe), capped at max_d"""
    body = parts['body']; me = body.data; n = len(me.vertices)
    V, F = _world_mesh([body] + [o for o in (parts.get('eyes') or []) if getattr(o, 'type', None) == 'MESH'])
    bvh = BVHTree.FromPolygons(V, F, epsilon=0.0)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3, np.float32); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    M = body.matrix_world; R = M.to_3x3()
    t = np.full(n, max_d, np.float32)
    for i in range(n):
        d = -(R @ Vector(nr[i])).normalized(); o = M @ Vector(co[i]) + d * start
        hit = bvh.ray_cast(o, d, max_d)
        if hit[0] is not None:
            t[i] = max(hit[3] + start, 0.0002)
    if smooth:   # average over the edge neighbours (min with self: a lone far hit through a gap must not thicken a thin lid)
        e = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
        for _ in range(smooth):
            s = t.copy(); c = np.ones(n, np.float32)
            np.add.at(s, e[:, 0], t[e[:, 1]]); np.add.at(s, e[:, 1], t[e[:, 0]]); np.add.at(c, e[:, 0], 1); np.add.at(c, e[:, 1], 1)
            t = np.minimum(t, s / c) * 0.5 + (s / c) * 0.5
    return t


def thickness_sss(parts, ref_mm=None, smin=0.12, sss=0.6):
    """write the thickness as the body's point attribute 'l5_thick' and scale every skin material's Subsurface Scale by
    clamp(t / ref, smin, 1). Returns stats for the run's json."""
    t = skin_thickness(parts)
    me = parts['body'].data
    a = me.attributes.get('l5_thick') or me.attributes.new('l5_thick', 'FLOAT', 'POINT'); a.data.foreach_set('value', t)
    ref = (ref_mm / 1000.0) if ref_mm else 3 * 0.002 * sss
    n_mat = 0
    for m in me.materials:
        nt = m.node_tree if m and m.use_nodes else None
        if nt is None:
            continue
        for p in [x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED' and getattr(x, 'subsurface_method', '') in ('RANDOM_WALK_SKIN', 'RANDOM_WALK')]:
            s0 = p.inputs['Subsurface Scale'].default_value
            at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_type = 'GEOMETRY'; at.attribute_name = 'l5_thick'
            dv = nt.nodes.new('ShaderNodeMath'); dv.operation = 'DIVIDE'; dv.inputs[1].default_value = ref
            mn = nt.nodes.new('ShaderNodeMath'); mn.operation = 'MINIMUM'; mn.inputs[1].default_value = 1.0
            mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'; mx.inputs[1].default_value = smin
            ml = nt.nodes.new('ShaderNodeMath'); ml.operation = 'MULTIPLY'; ml.inputs[1].default_value = s0
            nt.links.new(at.outputs['Fac'], dv.inputs[0]); nt.links.new(dv.outputs[0], mn.inputs[0]); nt.links.new(mn.outputs[0], mx.inputs[0])
            nt.links.new(mx.outputs[0], ml.inputs[0]); nt.links.new(ml.outputs[0], p.inputs['Subsurface Scale']); n_mat += 1
    q = np.percentile(t, [1, 5, 50]) * 1000
    return dict(ref_mm=round(ref * 1000, 2), smin=smin, materials=n_mat, thin_share=round(float((t < ref).mean()), 4),
                p1_p5_p50_mm=[round(float(x), 2) for x in q])


def quality(sc, preset, samples=None):
    cy = sc.cycles
    cy.use_denoising = True
    try:
        cy.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'
    if hasattr(cy, 'denoising_quality'):
        cy.denoising_quality = 'HIGH'
    cy.use_adaptive_sampling = True
    if preset == 'still':
        cy.adaptive_threshold = 0.015; cy.adaptive_min_samples = 24
        if hasattr(cy, 'use_guiding'):
            cy.use_guiding = True; cy.use_surface_guiding = True; cy.use_volume_guiding = False
        sc.render.filter_size = 1.2
    elif preset == 'farm':
        cy.adaptive_threshold = 0.005; cy.adaptive_min_samples = 64
        if hasattr(cy, 'denoising_use_gpu'):
            cy.denoising_use_gpu = True
        if hasattr(cy, 'use_guiding'):
            cy.use_guiding = False
        sc.render.filter_size = 1.2
        if samples is not None and cy.samples < 256:
            cy.samples = 256
    return dict(preset=preset, threshold=cy.adaptive_threshold, min=cy.adaptive_min_samples, guiding=bool(getattr(cy, 'use_guiding', False)), filter=sc.render.filter_size)
