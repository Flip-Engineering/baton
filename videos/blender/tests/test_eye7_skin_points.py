import ast, pathlib, numpy as np, bpy
from mathutils import Matrix
source=(pathlib.Path(__file__).resolve().parents[1] / 'eye7_cycles.py').read_text()
fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='skin_points')
ns={'np':np};exec(compile(ast.Module(body=[fn],type_ignores=[]),'skin_points','exec'),ns)
sample=ns['skin_points']
vertices=[(-.005,-.005,.002),(.005,-.005,.002),(.005,.005,.002),(-.005,.005,.002),(0,.009,.002)]
cases={'triangle':[(0,1,2)],'quad':[(0,1,2,3)],'ngon':[(0,1,2,4,3)],'mixed':[(0,1,2,3),(2,4,3)],'three_quads':[(0,1,2,3)]*3}
for name,faces in cases.items():
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    body=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(body)
    points=sample(body,np.eye(4),np.zeros(3),k=2)
    expected_triangles=sum(len(f)-2 for f in faces)
    assert points.shape==(expected_triangles*6,3),(name,points.shape)
    assert np.isfinite(points).all() and np.allclose(points[:,2],2)
    assert (points[:,:2]>=-5.0001).all() and (points[:,:2]<=9.0001).all()
    assert len(mesh.polygons)==len(faces)
    before=points.copy()
    body.matrix_world=Matrix.Translation((.1,.2,.3))
    moved=sample(body,np.linalg.inv(np.array(body.matrix_world)),np.zeros(3),k=2)
    assert np.allclose(before,moved,atol=.0001),name
    empty=sample(body,np.eye(4),np.zeros(3),k=2)
    assert empty.shape==(0,3)
    print('PASS',name,expected_triangles,'triangles',len(points),'samples')
print('PASS mixed topology, unchanged polygons, transforms and empty neighborhood')
