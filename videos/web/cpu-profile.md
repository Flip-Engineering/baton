# Chromium CPU profiles

The renderer supports opt-in CPU profiles to the Chromium page already used by `videos/web/render.mjs`. Profiling starts before scene navigation and continues through `sceneReady`, the frame loop, and render finalization. The report describes page main-thread JavaScript. It excludes the Chromium compositor, GPU execution, Node, and FFmpeg.

The default remains disabled. A selected future render can enable it with `ACP_CPU_PROFILE=1`. The renderer adds a `cpuProfile` property to `homelab-<GPU label>-renderer.json` in `videos/out/` after each completed profile window and at normal shutdown. If the file does not exist, it creates a profile-only receipt with the same filename pattern consumed by the farm archive. The most recent completed-window report is also written during synchronous process exit handling. Each update uses a temporary file and rename; output write errors are logged and do not change render status.

The configuration variables are:

| Variable | Default | Meaning |
|---|---:|---|
| `ACP_CPU_PROFILE` | unset | Set to `1` to enable profiling |
| `ACP_CPU_PROFILE_INTERVAL_US` | `20000` | CDP sampling interval in microseconds |
| `ACP_CPU_PROFILE_WINDOW_MS` | `15000` | Requested interval before each profile is summarized and restarted |
| `ACP_CPU_PROFILE_REPORT_BUDGET_BYTES` | `262144` | Retained summary budget; also derives the approximate sample allowance per temporary CDP profile |

The profiler aggregates each window into weighted Space-Saving summaries and discards the full CDP profile tree before starting the next window. The cross-window retained function summary is bounded by the configured report budget. Per-window summarization temporarily builds a function map and sorted array whose size scales with the number of unique sampled functions; this is not a strict memory bound. The report contains sample counts, phase totals, top function/source rows, and an error estimate for rows replaced from the bounded summary. Window length is derived from the sample interval and report budget. The `cpuProfile` object is trimmed to the configured byte budget. This budget controls retained profile report state; it is not a Chromium heap limit. The transient CDP tree can exceed its estimated sample allowance because V8 profile node count varies by workload.

The implementation creates a separate page CDP session only when profiling is enabled. It calls `Profiler.enable`, sets the sampling interval before recording, then repeats `Profiler.start` and `Profiler.stop` on that owned session. A CDP command timeout disables profiling, detaches only that session, and prevents further profiler commands. The renderer's screenshot session and browser process remain available for render cleanup. Render failures still run profiler, browser, and HTTP-server cleanup. The original render error remains the reported error when cleanup also fails. The protocol documents the interval in microseconds: [Chrome DevTools Protocol Profiler domain](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/).

## Source and runtime integration

The renderer change was based on `videos/web/render.mjs` at repository commit `8b99adc55faa0f52645fc760914f2ae324a3a02c`. Its source SHA-256 is `6e7abbf8a0ea48e7c60d944538b1eef41da0b7dd12df6e75750cde4bbd54396b`, matching the Git blob recorded at that commit. The profiler is disabled by default and has not been qualified on a farm worker.

The helper is adjacent to `render.mjs`, so a repository commit pins both files together. Before farm activation, the changed renderer and helper must be included in the prepared source manifest and worker source attestation. A renderer hash change is expected and must be recorded. The existing farm Docker environment allowlist must pass `ACP_CPU_PROFILE=1` only for the selected natural render. The runtime must include the renderer receipt in that render's evidence.

The current GPU farm launches its adapted hardware renderer, while this upstream `render.mjs` launches Chromium with SwiftShader arguments. For farm profiling: the renderer must be integrated into the source-attested hardware path while preserving its GPU selection and hardware-renderer checks. Farm launch and collection integration requires a separate source-attested change.

Profiler overhead has not been measured. The selected job should use normal admission and output validation. These CPU-only tests verify option derivation, sample summaries, bounded aggregation, repeated windows, profile receipt writing, timeout detachment, error isolation, and cleanup after injected render-stage failures. No browser, scene, Canvas, WebGL, GPU, or software-rendering test was run.
