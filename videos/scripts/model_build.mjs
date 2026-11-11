// MODELING c1: build a catalogued asset. Shim: the real script is web/lib/fx/modeling/build.mjs (it needs web/node_modules).
//   node videos/scripts/model_build.mjs cobot_wrist        node videos/scripts/model_build.mjs --list
await import('../web/lib/fx/modeling/build.mjs');
