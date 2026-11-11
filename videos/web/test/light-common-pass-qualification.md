# LIGHT common pass qualification

This browser fixture compares the candidate LIGHT pipeline with the pre-change renderer at commit `3162adf0547a01da9513b556143ba9e7e7be5117`. It checks exact RGBA8 output, pass counts, option merging, debug and overlay behavior, and state recovery after alternating effect settings. The scene uses a box, a curved sphere, and a bright emissive sphere.

From the repository root, create a temporary baseline module:

```sh
git show 3162adf0547a01da9513b556143ba9e7e7be5117:videos/web/lib/fx/light/pipeline.js > videos/web/lib/fx/light/pipeline.baseline.js
```

Serve the repository to the test browser with `videos/web/node_modules/three` version `0.170.0` mapped to `/three/`. Open `/videos/web/test/light-common-pass-qualification.html`. The page sets `window.__farmPassReport.status` to `passed` or `failed` and stores browser, WebGL device, draw-count, pixel, and elapsed-time results in `window.__farmPassReport`.

The default run uses 48 by 48 targets for quick exact-output and call-order checks. To run an optional local full-size timing sample, open:

```text
/videos/web/test/light-common-pass-qualification.html?benchmark=1&width=1080&height=1920
```

That run warms both renderers once per scenario, then performs seven measured K=12 pairs in alternating baseline-first and candidate-first order. It checks every pair's RGBA8 pixels and records a hash and elapsed time after a blocking `readPixels`. It measures this small procedural scene on the browser's WebGL device. Its timing does not predict farm throughput for production scenes.

Delete the temporary `pipeline.baseline.js` before staging the change. Do not use this local browser result as NVIDIA farm qualification.
