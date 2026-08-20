# Final Flip visual validation command set

From a fresh checkout of the implementation head, run from `impl/`:

```bash
npm ci
node --test test/visual-model.test.mjs test/visual-renderer.test.mjs test/baton-top.test.mjs test/mcp-visualization.test.mjs
npm test
npm run test:contracts:validate
npm run test:surfaces
npm run test:unified-surfaces
npm run test:production-convergence
npm run test:contracts
npm run test:package
```

The implementation head passed this gate before the documentary evidence commits were appended. The evidence commits contain Markdown only.
