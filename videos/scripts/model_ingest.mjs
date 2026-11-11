// MODELING c1: ingest a downloaded CC0 kitbash part (see web/lib/fx/modeling/ingest.mjs).
//   node videos/scripts/model_ingest.mjs polyhaven barrel_03 --tris 1500
// GRAPHICS 4.C (8 Oct): fetch, roles and kits (the header of web/lib/fx/modeling/ingest.mjs has the details).
//   node videos/scripts/model_ingest.mjs fetch polyhaven bench_vice_01 --res 2k
//   node videos/scripts/model_ingest.mjs polyhaven bench_vice_01 --roles hero,mid,far [--pieces] [--count]
//   node videos/scripts/model_ingest.mjs kit shop [--fetch] [--prune] [--count]
await import('../web/lib/fx/modeling/ingest.mjs');
