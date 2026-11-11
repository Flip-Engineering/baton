// AT REST c20, take b (scenes/atrest.plan.js TAKES): the same scene with the tail failing on take b's beat. The plan reads the take when it loads.
globalThis.ATREST_TAKE = 'b';
await import('./atrest.js');
