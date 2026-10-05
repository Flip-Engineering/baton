// Type-stripping drift fixture: Node removes the type annotations when
// loading, so the loaded bytes legitimately differ from the disk bytes. The
// drift record must compare against the transformed representation.
const stripped: number = 41;
const next: number = stripped + 1;
setTimeout(() => {
  console.log(`stripped ${next}`);
}, 20);
