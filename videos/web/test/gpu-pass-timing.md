# GPU pass timing

`LitRenderer` accepts `profileGpu: true` and an `onGpuProfile(sample)` callback. Each sample contains the pass name, output frame index, elapsed nanoseconds and elapsed milliseconds. Profiling is disabled by default. A renderer with profiling enabled can release query resources through `lr.gpuProfiler.dispose()`.

The profiler uses `EXT_disjoint_timer_query_webgl2`. It reads elapsed values after `QUERY_RESULT_AVAILABLE`, discards pending samples after `GPU_DISJOINT_EXT`, and limits outstanding queries to 96. Unsupported contexts execute the normal render calls. Main and mirror samples include their shadow rendering; they report the total GPU work within the corresponding Three.js render call. The profiler uses the context's elapsed-time query target and requires exclusive ownership of that target while enabled.

Enable this diagnostic in a source-pinned remote qualification workload admitted through the farm's resource policy. Preserve all render settings. Compare complete frame time and captured output with profiling disabled before using pass shares to choose a rendering change. GPU time excludes JavaScript construction, CPU preparation, screenshot transfer and encoding. Several samples per pass and scene phase are needed to assess its contribution.

CPU qualification:

```sh
cd videos/web
node --test test/gpu-timer.test.js
```

These tests use a synthetic query API. They do not validate a real GPU driver, render output or elapsed-time improvement. The timer implementation follows the [Khronos extension specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).
