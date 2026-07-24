<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AX Report — baton fleet &amp; driver surface (dynamic-workflow-2026-07-24)</title>
<style>
  :root{
    --bg:#ffffff; --panel:#f7f7f8; --panel-2:#eef0f3; --ink:#1b1f24; --muted:#5b6573; --rule:#d8dde4;
    --link:#1d4ed8; --code-bg:#eef1f5;
    --high:#dc2626; --high-bg:#fee2e2; --med:#b45309; --med-bg:#fef3c7;
    --A:#7c3aed; --B:#0d9488; --C:#db2777; --D:#ea580c; --E:#2563eb;
    --ok:#15803d; --warn:#b45309; --bad:#b91c1c;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#0d1117; --panel:#161b22; --panel-2:#1c2330; --ink:#e6edf3; --muted:#9aa6b2; --rule:#2a313c;
      --link:#79c0ff; --code-bg:#161b22;
      --high:#f87171; --high-bg:#3a1414; --med:#fbbf24; --med-bg:#3a2c0a;
      --A:#a78bfa; --B:#2dd4bf; --C:#f472b6; --D:#fb923c; --E:#60a5fa;
      --ok:#4ade80; --warn:#fbbf24; --bad:#f87171;
    }
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1040px;margin:0 auto;padding:0 24px 96px}
  header.hero{padding:52px 24px 30px;border-bottom:1px solid var(--rule)}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
  h1{font-size:33px;line-height:1.16;margin:10px 0 8px;letter-spacing:-.01em;max-width:22ch}
  .lede{font-size:18px;color:var(--muted);max-width:64ch;margin:0}
  .meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;font-size:13px;color:var(--muted)}
  .meta b{color:var(--ink);font-weight:600}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0 6px}
  .kpi{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:15px 17px}
  .kpi .n{font-size:29px;font-weight:700;letter-spacing:-.02em}
  .kpi .l{font-size:12.5px;color:var(--muted);margin-top:2px}
  .high{color:var(--high)} .med{color:var(--med)}
  section{margin-top:42px}
  h2{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  h2 .s{color:var(--muted);font-weight:500;font-size:14.5px}
  p.intro{color:var(--muted);max-width:74ch;margin:0 0 16px}
  table.matrix{width:100%;border-collapse:collapse;font-size:13.5px;border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  .matrix th,.matrix td{border:1px solid var(--rule);padding:9px 11px;text-align:left;vertical-align:top}
  .matrix thead th{background:var(--panel);font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .matrix tbody tr:hover td{background:var(--panel-2)}
  .axid{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.03em}
  .b-high{background:var(--high-bg);color:var(--high)} .b-med{background:var(--med-bg);color:var(--med)}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle}
  .yes{color:var(--ok);font-weight:600} .no{color:var(--bad);font-weight:600} .partial{color:var(--warn);font-weight:600}
  code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code-bg);padding:1px 5px;border-radius:5px}
  .group{border:1px solid var(--rule);border-radius:14px;padding:6px 22px 16px;margin-top:22px}
  .gtag{font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
  .group h3{font-size:18.5px;margin:4px 0 2px;letter-spacing:-.005em}
  .gthread{font-size:13.5px;color:var(--muted);border-left:3px solid var(--rule);padding:7px 0 7px 13px;margin:13px 0 2px}
  .friction{display:grid;grid-template-columns:58px 1fr;gap:5px 14px;padding:13px 0;border-top:1px dashed var(--rule)}
  .friction:first-of-type{border-top:0}
  .fid{color:var(--muted);font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;padding-top:2px}
  .ftitle{font-weight:650}
  .fev{font-size:13px;color:var(--muted);margin-top:5px}
  .recs{display:grid;gap:11px}
  .rec{display:grid;grid-template-columns:26px 1fr;gap:11px;background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:13px 15px}
  .rec .rn{font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
  .rec b{display:block;margin-bottom:2px}
  .rec .tags{margin-top:6px;font-size:12px;color:var(--muted)}
  ul.evlist{margin:6px 0 0;padding-left:18px;font-size:13.5px;color:var(--muted)}
  ul.evlist li{margin:3px 0}
  .excl{font-size:13px;color:var(--muted);background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:11px 14px;margin-top:14px}
  footer{margin-top:50px;padding-top:16px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--muted)}
  @media(max-width:720px){.kpis{grid-template-columns:repeat(2,1fr)} .friction{grid-template-columns:1fr} table.matrix{font-size:12px}}
</style>
</head>
<body>
<header class="hero">
  <div class="eyebrow">Agentic-Experience (AX) Report</div>
  <h1>The harness can see a runaway seat — but not stop, explain, or cheaply recover one.</h1>
  <p class="lede">Nine grounded frictions across the baton fleet &amp; driver surface: <em>detection</em> is wired up, <em>action</em> is not, and the records that certify &ldquo;it works&rdquo; decay faster than the code beneath them.</p>
  <div class="meta">
    <span><b>Seat</b> DRAFTER (glm)</span>
    <span><b>Critic</b> sonnet</span>
    <span><b>Workflow</b> dynamic-workflow-2026-07-24</span>
    <span><b>Method</b> read-only mining of committed evidence</span>
    <span><b>Sources</b> <code>docs/reference/evidence/**</code>, <code>reviews/*.md</code></span>
    <span><b>No</b> <code>gh</code> calls (no auth)</span>
  </div>
</header>
<div class="wrap">
  <div class="kpis">
    <div class="kpi"><div class="n">9</div><div class="l">grounded AX frictions</div></div>
    <div class="kpi"><div class="n">5</div><div class="l">failure-locus groups (A&ndash;E)</div></div>
    <div class="kpi"><div class="n high">5</div><div class="l">high &mdash; AX-0,3,4,5,6</div></div>
    <div class="kpi"><div class="n med">4</div><div class="l">medium &mdash; AX-1,2,7,8</div></div>
  </div>

  <section id="matrix">
    <h2>Severity &amp; the detection&rarr;action split <span class="s">&mdash; the audit&rsquo;s table of record</span></h2>
    <p class="intro">Every friction is a case where the surface can <em>observe</em> trouble. The split that matters is whether anything <em>acts</em> on that observation. High-severity items (red) are the ones where a stuck or runaway seat runs until a human intervenes.</p>
    <table class="matrix">
      <thead><tr><th>ID</th><th>Friction</th><th>Group</th><th>Severity</th><th>Detection</th><th>Control action</th></tr></thead>
      <tbody>
        <tr><td class="axid">AX-0</td><td>Implementer stalls to watchdog with no artifact</td><td><span class="dot" style="background:var(--A)"></span>A</td><td><span class="badge b-high">HIGH</span></td><td><span class="yes">wall-clock watchdog</span></td><td><span class="no">kill only</span></td></tr>
        <tr><td class="axid">AX-1</td><td>Pause reason stringified as <code>[object Object]</code></td><td><span class="dot" style="background:var(--A)"></span>A</td><td><span class="badge b-med">MED</span></td><td><span class="yes">sees paused</span></td><td><span class="no">triage blocked</span></td></tr>
        <tr><td class="axid">AX-2</td><td>Concurrent controllers re-do finished work</td><td><span class="dot" style="background:var(--B)"></span>B</td><td><span class="badge b-med">MED</span></td><td><span class="partial">note after the fact</span></td><td><span class="no">no claim / lock</span></td></tr>
        <tr><td class="axid">AX-3</td><td>Credentials expire mid-run; thinking gates unprovable</td><td><span class="dot" style="background:var(--C)"></span>C</td><td><span class="badge b-high">HIGH</span></td><td><span class="partial">seat de-scoped</span></td><td><span class="no">reactive swap</span></td></tr>
        <tr><td class="axid">AX-4</td><td>Budget telemetry logged, never enforced</td><td><span class="dot" style="background:var(--D)"></span>D</td><td><span class="badge b-high">HIGH</span></td><td><span class="yes">usage logged</span></td><td><span class="no">no threshold / stop</span></td></tr>
        <tr><td class="axid">AX-5</td><td>Watchdog signals computed, never consumed</td><td><span class="dot" style="background:var(--D)"></span>D</td><td><span class="badge b-high">HIGH</span></td><td><span class="yes">signals computed</span></td><td><span class="no">not driven</span></td></tr>
        <tr><td class="axid">AX-6</td><td>No general worker resume / fork path</td><td><span class="dot" style="background:var(--D)"></span>D</td><td><span class="badge b-high">HIGH</span></td><td><span class="yes">crash / stall seen</span></td><td><span class="no">full respawn</span></td></tr>
        <tr><td class="axid">AX-7</td><td>Validation counts &amp; reviews overstate closed gaps</td><td><span class="dot" style="background:var(--E)"></span>E</td><td><span class="badge b-med">MED</span></td><td><span class="partial">manual re-ground</span></td><td><span class="no">manual rewrite</span></td></tr>
        <tr><td class="axid">AX-8</td><td>Model slots silently lost to a concurrent seat</td><td><span class="dot" style="background:var(--B)"></span>B</td><td><span class="badge b-med">MED</span></td><td><span class="yes">seat no-ops</span></td><td><span class="no">no arbitration</span></td></tr>
      </tbody>
    </table>
  </section>

  <section id="groups">
    <h2>The five failure loci <span class="s">&mdash; groups A&ndash;E</span></h2>

    <div class="group">
      <div class="gtag" style="color:var(--A)">Group A &middot; Wave / driver execution</div>
      <h3>The driver reports <em>that</em> a seat is stuck &mdash; never <em>why</em>.</h3>
      <div class="friction">
        <div class="fid">AX-0</div>
        <div><span class="ftitle">Implementer stalls to the watchdog with no artifact.</span>
          <div class="fev"><code>docs/reference/evidence/grammar-2026-07-24/m1-wave.log</code> closes with <code>outcome grammar-m1-implementer: phase=running sha=none</code> after a ~6600&nbsp;s watchdog (<code>progress 6609s &hellip; =running</code>, then <code>watchdog</code>). The long run produced <b>no commit</b> (<code>sha=none</code>); the wave&rsquo;s only failure signal is the timeout itself &mdash; there is no mid-run &ldquo;produced-nothing-after-N-minutes&rdquo; health check distinct from the wall-clock kill.</div></div>
      </div>
      <div class="friction">
        <div class="fid">AX-1</div>
        <div><span class="ftitle">Pause reason is opaque in telemetry.</span>
          <div class="fev"><code>m0-wave-attempt4.log</code> repeatedly emits <code>progress 5906s grammar-m0-implementer=paused[[object Object]]</code>. The pause payload is stringified as <code>[object Object]</code>, so the one field that would triage the stall is unrendered. The same log also ends <code>phase=paused sha=none</code>.</div></div>
      </div>
      <div class="gthread"><b>AX thread:</b> both reduce to &ldquo;read the log until the watchdog fires.&rdquo; A missing-artifact run (AX-0) and an unexplained pause (AX-1) are the same operator experience: the seat is alive-or-stuck, but you cannot tell what it is doing or why it blocked.</div>
    </div>

    <div class="group">
      <div class="gtag" style="color:var(--B)">Group B &middot; Fleet scheduling &amp; seat contention</div>
      <h3>Concurrency produces duplicate work and silent no-ops &mdash; discovered only post-hoc.</h3>
      <div class="friction">
        <div class="fid">AX-2</div>
        <div><span class="ftitle">Concurrent controllers re-do already-finished work.</span>
          <div class="fev"><code>FOLD-STATUS.md</code> records the seat committing <code>fa71aea</code> (<code>run-revise-wave.mjs</code>, an opus fold wave) targeting the docs/35 fold that was <b>already at v2 FINAL</b> (<code>0c5c970</code>); the standing controller had to leave a coordination note pleading &ldquo;Please do not land a second competing v2 of docs/35; amend by follow-up findings instead.&rdquo; No seat-lock / claim on the artifact prevents the redundant wave from launching.</div></div>
      </div>
      <div class="friction">
        <div class="fid">AX-8</div>
        <div><span class="ftitle">Model slots are silently lost to a concurrent seat.</span>
          <div class="fev">Driver commit <code>e790825</code> records the M3 GLM seat being dropped because the &ldquo;GLM slot occupied by the concurrent #46 seat.&rdquo; A scheduled model seat loses its infra slot to another concurrent seat with <b>no arbitration surfaced to the operator</b> &mdash; the seat just does not run.</div></div>
      </div>
      <div class="gthread"><b>AX thread:</b> the fleet has no claim / arbitration layer over <em>artifacts</em> (AX-2) or <em>infrastructure slots</em> (AX-8), so concurrency produces duplicate work and silent no-ops that are discovered only post-hoc.</div>
    </div>

    <div class="group">
      <div class="gtag" style="color:var(--C)">Group C &middot; Per-vendor credential &amp; capability gating</div>
      <h3>A model seat can be lost to auth expiry or an unprovable gate &mdash; not to a fault in the work.</h3>
      <div class="friction">
        <div class="fid">AX-3</div>
        <div><span class="ftitle">Credentials expire mid-run; thinking gating is unprovable per vendor.</span>
          <div class="fev">Driver commits record the failures: <code>7de3a36</code> (&ldquo;grok token expired 28min post-login&rdquo;, &ldquo;kimi thinking unprovable&rdquo;); <code>29769c1</code> (&ldquo;kimi@low &hellip; @high fails: auth/thinking gating unproven at high&rdquo;); <code>e790825</code> (&ldquo;kimi thinking-proof down at every effort&rdquo;). A seat is thus lost to (a) a short credential window expiring inside the run or (b) a thinking/effort gate the harness cannot prove open, and is de-scoped rather than driven.</div></div>
      </div>
      <div class="gthread"><b>AX thread:</b> vendor readiness is the dominant AX risk for a heterogeneous fleet &mdash; credential lifetime and per-vendor capability proof are first-class operational concerns, not setup details. (This is what forced the documented <code>kimi&rarr;opus</code> M3 substitution.)</div>
    </div>

    <div class="group">
      <div class="gtag" style="color:var(--D)">Group D &middot; Resource governance</div>
      <h3>Observe-but-don&rsquo;t-act &mdash; the control plane sees misbehavior and does nothing.</h3>
      <div class="friction">
        <div class="fid">AX-4</div>
        <div><span class="ftitle">Budget enforcement is observation-only.</span>
          <div class="fev"><code>reviews/dogfood/codex-capability-gap-review.md</code> (grounded in <code>capability-matrix.json</code>) records that token telemetry is logged but <code>handle.budgetUsed</code> stays <b>zero</b>, <code>resource.budget_threshold</code> is <b>never emitted</b>, and the <code>wallMin</code>-derived session timeout is <b>ignored</b>. A live worker can consume time/quota until a human intervenes.</div></div>
      </div>
      <div class="friction">
        <div class="fid">AX-5</div>
        <div><span class="ftitle">Watchdog signals are computed but never drive a control action.</span>
          <div class="fev">The same review records <code>story.signal()</code> computing stalled / looping / over-budget / out-of-scope attention that <b>the coordinator does not consume</b> to interrupt or stop, plus producer/consumer mismatches: digest-health and budget event kinds are &ldquo;listened for but not emitted.&rdquo; Detection exists; action does not.</div></div>
      </div>
      <div class="friction">
        <div class="fid">AX-6</div>
        <div><span class="ftitle">No general worker resume / fork path.</span>
          <div class="fev">The same review records <b>cold-spawn cost on every task</b>, <b>no mid-run worker crash recovery</b>, and <b>no fork-and-explore workflow</b>, even though native resume / fork / load exists across Claude / Codex / Grok &mdash; the coordinator exposes no general resume/fork command. Every task pays full spawn cost; a crashed mid-run worker cannot be resumed.</div></div>
      </div>
      <div class="gthread"><b>AX thread:</b> the three form one governance-debt cluster &mdash; <em>budget</em> (AX-4), <em>watchdog action</em> (AX-5), and <em>session continuity</em> (AX-6) &mdash; all &ldquo;UNSHIPPED-DEBT, high priority&rdquo; in the matrix, collectively the blocker for unattended workers.</div>
    </div>

    <div class="group">
      <div class="gtag" style="color:var(--E)">Group E &middot; Validation &amp; review records</div>
      <h3>The records that certify &ldquo;it works&rdquo; decay &mdash; and stale accepted findings actively mislead.</h3>
      <div class="friction">
        <div class="fid">AX-7</div>
        <div><span class="ftitle">Counts freeze and prior reviews overstate gaps the repo has since closed.</span>
          <div class="fev"><code>reviews/dogfood/claude-validation-review.md</code> shows <code>impl/VALIDATION.md</code> suite counts frozen at <b>372/372</b> while the live suite is <b>427/427</b>, and lists twelve claims that must be retired / upgraded / rewritten (the record &ldquo;must be rewritten, not appended&rdquo;). <code>reviews/dogfood/codex-ck9-crash-window-review.md</code> documents a previously <b>accepted</b> review that &ldquo;materially overstated gaps that the repository now contradicts&rdquo; and must be reclassified <code>major&rarr;no finding</code>; it separately warns against relying on unevidenced suite-count rhetoric (&ldquo;567 tests&rdquo;).</div></div>
      </div>
      <div class="gthread"><b>AX thread:</b> the AX surface includes the <em>meta</em>-record &mdash; validation docs and red-team verdicts decay, and stale accepted findings actively mislead unless re-grounded against current seams.</div>
    </div>
  </section>

  <section id="recommendations">
    <h2>What to ship first <span class="s">&mdash; six recommendations, mapped to the AX ids they retire</span></h2>
    <div class="recs">
      <div class="rec"><div class="rn">1</div><div><b>Close the detection&rarr;action loop.</b> Emit <code>resource.budget_threshold</code> and let <code>story.signal()</code> (stall / loop / over-budget / out-of-scope) actually interrupt or stop the coordinator &mdash; turn observations into control. <span class="tags">[AX-4, AX-5]</span></div></div>
      <div class="rec"><div class="rn">2</div><div><b>Make stalls self-explaining.</b> Add a mid-run &ldquo;produced-nothing-after-N-minutes&rdquo; health check distinct from the wall-clock kill, and render pause payloads as structured JSON instead of <code>[object Object]</code>. <span class="tags">[AX-0, AX-1]</span></div></div>
      <div class="rec"><div class="rn">3</div><div><b>Add a claim / arbitration layer.</b> Seat-locks on artifacts (the fold / file) and infra-slot arbitration surfaced to the operator, so concurrency can neither silently double-work nor no-op a scheduled seat. <span class="tags">[AX-2, AX-8]</span></div></div>
      <div class="rec"><div class="rn">4</div><div><b>Treat vendor readiness as first-class.</b> Credential-lifetime budgets (fail <em>before</em> expiry, not 28 min after) and a per-vendor capability-proof preflight that de-scopes early and loudly. <span class="tags">[AX-3]</span></div></div>
      <div class="rec"><div class="rn">5</div><div><b>Make recovery cheap.</b> Expose resume / fork / load from the native primitives that already exist across Claude / Codex / Grok; stop paying full cold-spawn cost on every task and every crash. <span class="tags">[AX-6]</span></div></div>
      <div class="rec"><div class="rn">6</div><div><b>Keep records live.</b> Gate validation-doc counts from the live suite, and auto-retract stale accepted findings when the repository contradicts them. <span class="tags">[AX-7]</span></div></div>
    </div>
  </section>

  <section id="evidence">
    <h2>Evidence index <span class="s">&mdash; every friction grounded in a committed path or commit</span></h2>
    <ul class="evlist">
      <li><code>docs/reference/evidence/grammar-2026-07-24/m1-wave.log</code> &mdash; AX-0</li>
      <li><code>docs/reference/evidence/grammar-2026-07-24/m0-wave-attempt4.log</code> &mdash; AX-1</li>
      <li><code>docs/reference/evidence/grammar-2026-07-24/FOLD-STATUS.md</code>, <code>fold-ledger.md</code> &mdash; AX-2</li>
      <li><code>reviews/dogfood/codex-capability-gap-review.md</code> &mdash; AX-4, AX-5, AX-6</li>
      <li><code>reviews/dogfood/claude-validation-review.md</code> &mdash; AX-7</li>
      <li><code>reviews/dogfood/codex-ck9-crash-window-review.md</code> &mdash; AX-7</li>
      <li>Driver commits <code>7de3a36</code>, <code>29769c1</code>, <code>e790825</code> &mdash; AX-3, AX-8</li>
    </ul>
    <div class="excl"><b>Deliberately excluded:</b> spec-level red-team findings (R-CX / R-KM / R-OP in <code>grammar-2026-07-24/redteam-*.md</code>, all folded in <code>fold-ledger.md</code>) were reviewed but are document-correctness findings against docs/35, not agent-experience frictions, and are kept out of the AX set.</div>
  </section>

  <footer>
    Provenance: drafted by the glm seat; critique by sonnet. Every friction above is grounded in a committed file path, fold-ledger entry, or driver commit &mdash; no <code>gh</code> calls were made (no auth in this seat). Headline framings follow the researcher&rsquo;s cross-cutting note: the detection/action split of AX-4/AX-5 and the stuck-but-silent driver of AX-0/AX-1. Generated 2026-07-24.
  </footer>
</div>
</body>
</html>
