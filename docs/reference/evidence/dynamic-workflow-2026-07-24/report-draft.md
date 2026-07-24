<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AX Report — Baton agentic-experience frictions (top 5 by cost)</title>
<style>
  :root{
    --bg:#0b0f14; --panel:#121821; --panel2:#0f141c; --ink:#e6edf3; --dim:#9aa7b4;
    --line:#22303d; --accent:#5bc8ff; --crit:#ff6b6b; --high:#ffb454; --med:#ffd66b; --ok:#7ee787;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:920px;margin:0 auto;padding:32px 22px 60px}
  header{border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px}
  .eyebrow{color:var(--accent);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
  h1{font-size:27px;line-height:1.2;margin:10px 0 8px}
  h1 em{color:var(--crit);font-style:normal}
  .meta{color:var(--dim);font-size:12.5px}
  .meta b{color:var(--ink)}
  .lede{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:22px}
  .lede p{margin:0}
  .lede .two{display:flex;gap:16px;margin-top:12px;flex-wrap:wrap}
  .lede .pill{flex:1;min-width:240px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13.5px}
  .lede .pill b{color:var(--accent)}
  .scale{display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 22px}
  .leg{font-size:11.5px;color:var(--dim);display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block}
  .card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:15px 17px;margin-bottom:14px}
  .card.crit{border-left-color:var(--crit)} .card.high{border-left-color:var(--high)} .card.med{border-left-color:var(--med)}
  .row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .id{font-family:var(--mono);font-weight:700;font-size:13px;color:var(--accent)}
  .card h2{font-size:16px;margin:0;font-weight:600}
  .sev{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:20px;text-transform:uppercase}
  .sev.crit{background:rgba(255,107,107,.16);color:var(--crit)}
  .sev.high{background:rgba(255,180,84,.16);color:var(--high)}
  .sev.med{background:rgba(255,214,107,.16);color:var(--med)}
  .ev{font-family:var(--mono);font-size:12px;color:var(--dim);margin:9px 0 6px;word-break:break-word}
  .ev code{color:var(--ink);background:var(--panel2);padding:1px 5px;border-radius:4px}
  .card p{margin:6px 0;color:var(--ink)}
  .fix{margin-top:8px;font-size:13px;color:var(--ok)}
  .fix::before{content:"Fix direction: ";font-weight:700}
  footer{border-top:1px solid var(--line);margin-top:24px;padding-top:14px;color:var(--dim);font-size:12px}
  footer ul{margin:6px 0;padding-left:18px}
  footer code{font-family:var(--mono);color:var(--ink)}
  .note{color:var(--dim);font-style:italic;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">Agentic-Experience (AX) Report &middot; Draft</div>
    <h1>The harness can <em>watch</em> a runaway worker &mdash; but it cannot <em>stop</em> one.</h1>
    <div class="meta"><b>Workflow:</b> dynamic-workflow-2026-07-24 &middot; <b>Drafter:</b> glm (kimi seat) &middot; <b>Method:</b> read-only mining of committed evidence &middot; <b>Scope:</b> top 5 of 9 grounded AX frictions, ranked by cost.</div>
  </header>

  <div class="lede">
    <p>Two threads dominate the baton agent experience. In <b>governance</b> the control plane <i>sees</i> misbehavior but does not <i>act</i> on it (AX-4 / AX-5 / AX-6 &mdash; flagged &ldquo;UNSHIPPED-DEBT, high priority,&rdquo; the blocker for unattended workers). In <b>driver telemetry</b> it reports <i>that</i> a seat is stuck, never <i>why</i> (AX-0 / AX-1). Every item below is grounded in a committed file path or commit.</p>
    <div class="two">
      <div class="pill"><b>Observe-but-cannot-stop</b> &mdash; budget, watchdog, and resume gaps mean a worker runs until a human intervenes.</div>
      <div class="pill"><b>That-but-not-why</b> &mdash; a ~6600&nbsp;s stall ends with <code>sha=none</code> and a pause rendered as <code>[object Object]</code>.</div>
    </div>
  </div>

  <div class="scale">
    <span class="leg"><span class="sw" style="background:var(--crit)"></span>Critical &mdash; unbounded until human</span>
    <span class="leg"><span class="sw" style="background:var(--high)"></span>High &mdash; recurring / unrecoverable</span>
    <span class="leg"><span class="sw" style="background:var(--med)"></span>Medium &mdash; blocks triage</span>
  </div>

  <div class="card crit">
    <div class="row"><span class="id">AX-4</span><h2>Budget enforcement is observation-only</h2><span class="sev crit">Critical</span></div>
    <div class="ev">evidence: <code>reviews/dogfood/codex-capability-gap-review.md</code> (grounded in <code>capability-matrix.json</code>) &mdash; <code>handle.budgetUsed</code> stays <b>zero</b>; <code>resource.budget_threshold</code> <b>never emitted</b>; <code>wallMin</code> session timeout <b>ignored</b>.</div>
    <p>Token telemetry is logged, but no threshold alarm, hard stop, or wall-clock bound fires. A live worker can consume time and quota until a human intervenes.</p>
    <div class="fix">wire <code>budget_threshold</code> + the <code>wallMin</code> timeout into an <b>enforced stop</b>, not just a telemetry field.</div>
  </div>

  <div class="card crit">
    <div class="row"><span class="id">AX-5</span><h2>Watchdog signals are computed but never drive a control action</h2><span class="sev crit">Critical</span></div>
    <div class="ev">evidence: same review &mdash; <code>story.signals()</code> computes stalled / looping / over-budget / out-of-scope attention the coordinator <b>does not consume</b>; digest-health and budget event kinds are &ldquo;listened for but not emitted.&rdquo;</div>
    <p>The diagnosis is literally &ldquo;signals without a control loop.&rdquo; Detection exists; action does not.</p>
    <div class="fix">route <code>story.signals()</code> into an interrupt / stop <b>actuator</b> on the coordinator.</div>
  </div>

  <div class="card high">
    <div class="row"><span class="id">AX-6</span><h2>No general worker resume / fork path</h2><span class="sev high">High</span></div>
    <div class="ev">evidence: same review &mdash; cold-spawn cost on every task; no mid-run worker crash recovery; no fork-and-explore workflow. Native resume / fork / load exists across Claude / Codex / Grok but the coordinator exposes no general command.</div>
    <p>Every task pays full spawn cost, and a crashed mid-run worker cannot be resumed &mdash; the practical blocker for unattended runs.</p>
    <div class="fix">expose one general <b>resume / fork</b> command over the existing native primitives.</div>
  </div>

  <div class="card high">
    <div class="row"><span class="id">AX-0</span><h2>Implementer stalls to the watchdog with no artifact</h2><span class="sev high">High</span></div>
    <div class="ev">evidence: <code>docs/reference/evidence/grammar-2026-07-24/m1-wave.log</code> &mdash; closes <code>outcome grammar-m1-implementer: phase=running sha=none</code> after a ~6600&nbsp;s watchdog (<code>progress 6609s &hellip; =running</code>, then <code>watchdog</code>).</div>
    <p>A long run produced <b>no commit</b> (<code>sha=none</code>); the wave&rsquo;s only failure signal is the wall-clock kill itself. There is no mid-run &ldquo;produced-nothing-after-N-minutes&rdquo; health check distinct from the kill.</p>
    <div class="fix">a produced-artifact health check that <b>fails fast</b> on <code>sha=none</code> past a threshold, before the watchdog fires.</div>
  </div>

  <div class="card med">
    <div class="row"><span class="id">AX-1</span><h2>Pause reason is opaque in telemetry</h2><span class="sev med">Medium</span></div>
    <div class="ev">evidence: <code>docs/reference/evidence/grammar-2026-07-24/m0-wave-attempt4.log</code> &mdash; <code>progress 5906s grammar-m0-implementer=paused[[object Object]]</code>; log ends <code>phase=paused sha=none</code>.</div>
    <p>The pause payload stringifies as <code>[object Object]</code>, so the single field that would triage the stall is unrendered.</p>
    <div class="fix">serialize pause payloads as JSON &mdash; never the default object-to-string.</div>
  </div>

  <footer>
    <div><b>Selection:</b> 5 of 9 frictions by cost. Group D governance gaps (AX-4 / AX-5 / AX-6) are the explicitly-flagged &ldquo;UNSHIPPED-DEBT, high priority&rdquo; cluster and the blocker for unattended workers; Group A (AX-0 / AX-1) is the other strongest headline thread. Held back as lower immediate cost: AX-2 / AX-8 (concurrency coordination), AX-3 (vendor readiness), AX-7 (stale records) &mdash; all documented in <code>research-notes.md</code>.</div>
    <div style="margin-top:8px"><b>Evidence index (read this turn):</b></div>
    <ul>
      <li><code>docs/reference/evidence/grammar-2026-07-24/m1-wave.log</code> &mdash; AX-0</li>
      <li><code>docs/reference/evidence/grammar-2026-07-24/m0-wave-attempt4.log</code> &mdash; AX-1</li>
      <li><code>reviews/dogfood/codex-capability-gap-review.md</code> (grounded in <code>capability-matrix.json</code>) &mdash; AX-4, AX-5, AX-6</li>
    </ul>
    <p class="note">Spec-level red-team findings (R-CX / R-KM / R-OP in <code>grammar-2026-07-24/redteam-*.md</code>) are document-correctness findings against docs/35, not agent-experience frictions, and are deliberately excluded.</p>
  </footer>
</div>
</body>
</html>
