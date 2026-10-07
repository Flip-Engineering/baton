"use strict";

/* Orchestra live view. Read-only. All DOM text via textContent. */

const CONTRACT_VERSION = 1;
const TRANSITION_LIMIT = 50;

const state = {
  apiBase: "",
  fixtureName: "",
  subject: "",
  cursor: "",
  generation: "",
  opened: false,
  gapHeld: false,
  gapText: "",
  players: new Map(),
  ensembles: new Map(),
  transitions: [],
  tasks: {},
  providers: {},
  selectionId: null,
  search: "",
  statusFilter: "all",
  ensembleFilter: "all",
  collapsed: new Set(),
  sse: null,
  reconnectDelay: 1000,
  connected: false,
};

const el = {
  tree: document.getElementById("tree"),
  detail: document.getElementById("detail"),
  transitions: document.getElementById("transitions"),
  snapshotLine: document.getElementById("snapshot-line"),
  connState: document.getElementById("conn-state"),
  cursorState: document.getElementById("cursor-state"),
  contractState: document.getElementById("contract-state"),
  notice: document.getElementById("notice"),
  fixtureNotice: document.getElementById("fixture-notice"),
  search: document.getElementById("search"),
  statusFilter: document.getElementById("status-filter"),
  ensembleFilter: document.getElementById("ensemble-filter"),
  treeCount: document.getElementById("tree-count"),
};

function text(parent, value) {
  parent.appendChild(document.createTextNode(value == null ? "" : String(value)));
}

function td(row, label, value, mono) {
  const dt = document.createElement("dt");
  text(dt, label);
  const dd = document.createElement("dd");
  if (mono) dd.className = "mono";
  if (value === null || value === undefined || value === "") {
    dd.className += " unknown";
    text(dd, "unknown");
  } else {
    text(dd, value);
  }
  row.appendChild(dt);
  row.appendChild(dd);
}

function deriveStatus(p) {
  const stop = p.stop || null;
  if (stop && stop.status === "stopped") return "stopped";
  const ex = p.execution || null;
  if (ex && ex.phase === "running") return "running";
  if (ex && ex.phase === "starting") return "waiting";
  if (ex && ex.phase === "exited") {
    return ex.status === "exit 0" ? "completed" : "failed";
  }
  if ((p.pendingCount || 0) > 0) return "pending";
  return "unknown";
}

function roleRank(role) {
  if (role === "principal-conductor") return 0;
  if (role === "associate-conductor") return 1;
  if (role === "operator") return 2;
  return 3;
}

function childrenOf(id) {
  const out = [];
  for (const p of state.players.values()) {
    if ((p.parent || "") === id) out.push(p);
  }
  out.sort((a, b) => roleRank(a.role) - roleRank(b.role) || (a.id < b.id ? -1 : 1));
  return out;
}

function roots() {
  const ids = new Set(state.players.keys());
  const out = [];
  for (const p of state.players.values()) {
    const parent = p.parent || "";
    if (!parent || parent === p.id || !ids.has(parent)) out.push(p);
  }
  out.sort((a, b) => roleRank(a.role) - roleRank(b.role) || (a.id < b.id ? -1 : 1));
  return out;
}

function matchesFilters(p) {
  if (state.statusFilter !== "all" && deriveStatus(p) !== state.statusFilter) return false;
  if (state.ensembleFilter !== "all") {
    const ens = state.ensembles.get(state.ensembleFilter);
    if (!ens) return false;
    const members = new Set(ens.members || []);
    for (const s of ens.sections || []) for (const m of s.members || []) members.add(m);
    if (!members.has(p.id) && p.id !== ens.owner) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    const hay = [p.id, p.model, p.observedModel, p.branch, p.workspace, p.role, p.harness];
    for (const ensId of (p.memberEnsembles || []).concat(p.ownedEnsembles || [])) {
      hay.push(ensId);
      const ens = state.ensembles.get(ensId);
      for (const s of (ens && ens.sections) || []) hay.push(s.capability);
    }
    if (!hay.some((v) => (v || "").toLowerCase().includes(q))) return false;
  }
  return true;
}

function subtreeVisible(p) {
  if (matchesFilters(p)) return true;
  return childrenOf(p.id).some(subtreeVisible);
}

function setNotice(message) {
  if (!message) {
    el.notice.hidden = true;
    el.notice.textContent = "";
    return;
  }
  el.notice.hidden = false;
  el.notice.textContent = "";
  text(el.notice, message);
}

function setConn(word) {
  el.connState.textContent = "";
  text(el.connState, word);
}

function setCursor(cursor) {
  state.cursor = cursor || "";
  el.cursorState.textContent = "";
  text(el.cursorState, state.cursor || "none");
}

function queryString() {
  const parts = [];
  if (state.subject) parts.push("subject=" + encodeURIComponent(state.subject));
  if (state.cursor) parts.push("since=" + encodeURIComponent(state.cursor));
  if (state.generation) parts.push("generation=" + encodeURIComponent(state.generation));
  return parts.length ? "?" + parts.join("&") : "";
}

function setGeneration(generation) {
  state.generation = generation || "";
  const node = document.getElementById("generation-state");
  node.textContent = "";
  text(node, state.generation || "none");
}

function holdGapNotice(message) {
  state.gapHeld = true;
  state.gapText = message;
  setNotice(message);
}

function clearGapNotice() {
  if (state.gapHeld) {
    state.gapHeld = false;
    state.gapText = "";
    setNotice("");
  }
}

function flashRow(id) {
  const row = el.tree.querySelector('[data-row="' + CSS.escape(id) + '"]');
  if (row) {
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }
}

function select(id) {
  if (!state.players.has(id)) return;
  state.selectionId = id;
  renderTree();
  renderDetail();
}

function toggleCollapse(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id);
  else state.collapsed.add(id);
  renderTree();
}

function renderTree() {
  el.tree.textContent = "";
  const list = roots().filter(subtreeVisible);
  let shown = 0;
  for (const p of list) shown += renderNode(el.tree, p, 1);
  el.treeCount.textContent = "";
  text(el.treeCount, shown + " of " + state.players.size + " actors shown");
}

function renderNode(parentUl, p, depth) {
  let count = 0;
  const visibleChildren = childrenOf(p.id).filter(subtreeVisible);
  const selfMatch = matchesFilters(p);
  const li = document.createElement("li");
  li.setAttribute("role", "treeitem");
  li.setAttribute("aria-level", String(depth));
  li.setAttribute("aria-expanded", visibleChildren.length && !state.collapsed.has(p.id) ? "true" : "false");

  const row = document.createElement("div");
  row.className = "node-row";
  row.dataset.row = p.id;
  row.setAttribute("aria-selected", state.selectionId === p.id ? "true" : "false");

  const twisty = document.createElement("button");
  twisty.className = "twisty" + (visibleChildren.length ? "" : " leaf");
  twisty.setAttribute("tabindex", "-1");
  twisty.setAttribute("aria-hidden", "true");
  text(twisty, visibleChildren.length ? (state.collapsed.has(p.id) ? "+" : "-") : ".");
  if (visibleChildren.length) {
    twisty.addEventListener("click", () => toggleCollapse(p.id));
  }
  row.appendChild(twisty);

  const dot = document.createElement("span");
  dot.className = "dot " + deriveStatus(p);
  dot.setAttribute("aria-hidden", "true");
  row.appendChild(dot);

  const tag = document.createElement("span");
  tag.className = "role-tag " + (p.role || "");
  text(tag, shortRole(p.role));
  row.appendChild(tag);

  const idBtn = document.createElement("button");
  idBtn.className = "node-id";
  text(idBtn, p.id);
  idBtn.addEventListener("click", () => select(p.id));
  row.appendChild(idBtn);

  const statusWord = document.createElement("span");
  statusWord.className = "status-word";
  text(statusWord, deriveStatus(p));
  row.appendChild(statusWord);

  if ((p.pendingCount || 0) > 0) {
    const badge = document.createElement("span");
    badge.className = "pend-badge";
    text(badge, "pending " + p.pendingCount);
    row.appendChild(badge);
  }

  const model = document.createElement("span");
  model.className = "model-note";
  text(model, (p.observedModel || p.model || "unknown") + " / " + (p.branch || "no branch"));
  row.appendChild(model);

  li.appendChild(row);

  const tags = document.createElement("div");
  tags.className = "member-tags";
  const ensIds = Array.from(new Set((p.ownedEnsembles || []).concat(p.memberEnsembles || [])));
  for (const ensId of ensIds) {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", state.ensembleFilter === ensId ? "true" : "false");
    text(b, ensId);
    b.setAttribute("title", "Filter to ensemble " + ensId);
    b.addEventListener("click", () => {
      state.ensembleFilter = state.ensembleFilter === ensId ? "all" : ensId;
      el.ensembleFilter.value = state.ensembleFilter;
      renderTree();
    });
    tags.appendChild(b);
  }
  if (ensIds.length) li.appendChild(tags);

  parentUl.appendChild(li);
  if (selfMatch) count += 1;
  if (visibleChildren.length && !state.collapsed.has(p.id)) {
    const ul = document.createElement("ul");
    ul.setAttribute("role", "group");
    for (const c of visibleChildren) count += renderNode(ul, c, depth + 1);
    li.appendChild(ul);
  }
  return count;
}

function shortRole(role) {
  if (role === "principal-conductor") return "principal";
  if (role === "associate-conductor") return "associate";
  if (role === "operator") return "operator";
  return "player";
}

function renderDetail() {
  el.detail.textContent = "";
  const p = state.players.get(state.selectionId);
  if (!p) {
    const m = document.createElement("p");
    m.className = "muted";
    text(m, "Select an actor in the hierarchy.");
    el.detail.appendChild(m);
    return;
  }
  const dl = document.createElement("dl");

  td(dl, "id", p.id, true);
  td(dl, "role", (p.role || "unknown") + " / " + (p.kind || "unknown"));
  td(dl, "status", deriveStatus(p));
  td(dl, "parent", (p.parent || "") === "" ? "(none)" : p.parent, true);

  const task = state.tasks[p.id] || null;
  if (task) {
    td(dl, "task", (task.id || "") + (task.title ? " " + task.title : ""), true);
    td(dl, "task status", [task.status, task.updatedAt].filter(Boolean).join(" / ") || "unknown");
  } else {
    td(dl, "task", null);
  }

  td(dl, "worktree", p.workspace || null, true);
  td(dl, "branch", p.branch || null, true);
  td(dl, "base", p.base || null, true);

  const reportBits = [];
  reportBits.push("pending " + (p.pendingCount || 0));
  reportBits.push("unacked " + (p.unacknowledgedCount || 0));
  if (p.latestReportId) reportBits.push("report " + p.latestReportId);
  if (p.lastTurnId) reportBits.push("turn " + p.lastTurnId);
  td(dl, "report", reportBits.join(" / "), true);

  td(dl, "configured", [p.harness, p.model, p.effort].filter(Boolean).join(" / ") || null, true);
  const observed = [p.observedHarness, p.observedModel, p.observedEffort].filter(Boolean).join(" / ");
  td(dl, "observed", observed || null, true);
  const prov = state.providers[p.id] || null;
  td(dl, "provider", prov ? (prov.name || "unnamed") + " / " + (prov.status || "unknown") : null, true);

  if (p.execution) {
    td(dl, "recorded execution", [p.execution.attempt, p.execution.mode, p.execution.phase, p.execution.status].filter(Boolean).join(" / "), true);
  } else {
    td(dl, "recorded execution", null);
  }
  td(dl, "actual process", p.actualProcess || null, true);
  td(dl, "receiver", p.liveReceiver === true ? "registered" : p.liveReceiver === false ? "none recorded" : null, true);
  td(dl, "endpoint", p.endpointRegistered === true ? "registered" : p.endpointRegistered === false ? "none recorded" : null, true);
  td(dl, "reference", p.reference === true ? "reference entry" : p.reference === false ? "not a reference" : null, true);
  if (p.stop) {
    td(dl, "stop", [p.stop.id, p.stop.status, p.stop.attempt, p.stop.reportId].filter(Boolean).join(" / "), true);
  } else {
    td(dl, "stop", "none recorded");
  }

  const ensIds = Array.from(new Set((p.ownedEnsembles || []).concat(p.memberEnsembles || [])));
  if (ensIds.length) {
    for (const ensId of ensIds) {
      const ens = state.ensembles.get(ensId);
      if (!ens) {
        td(dl, "ensemble", ensId + " (not in snapshot)", true);
        continue;
      }
      const co = (ens.members || []).filter((m) => m !== p.id);
      let line = ensId + " " + (ens.coupling || "unknown coupling");
      line += p.id === ens.owner ? " (owner)" : " (member)";
      if (co.length) line += " with " + co.join(", ");
      td(dl, "ensemble", line, true);
      for (const s of ens.sections || []) {
        if ((s.members || []).includes(p.id)) {
          td(dl, "section", ensId + "/" + s.id + " capability " + (s.capability || "unknown"), true);
        }
      }
    }
  } else {
    td(dl, "ensemble", "none recorded");
  }

  el.detail.appendChild(dl);
}

function renderTransitions() {
  el.transitions.textContent = "";
  if (!state.transitions.length) {
    const li = document.createElement("li");
    text(li, "No committed transitions in this snapshot.");
    el.transitions.appendChild(li);
    return;
  }
  for (const t of state.transitions.slice(0, TRANSITION_LIMIT)) {
    const li = document.createElement("li");
    const when = document.createElement("time");
    text(when, t.at || "time unrecorded");
    li.appendChild(when);
    const go = document.createElement("button");
    go.className = "go";
    text(go, t.session || "unknown session");
    go.addEventListener("click", () => select(t.session));
    li.appendChild(go);
    const kind = document.createElement("span");
    text(kind, " " + (t.kind || "unknown") + " ");
    li.appendChild(kind);
    const sum = document.createElement("span");
    sum.className = "muted";
    text(sum, t.summary || "");
    li.appendChild(sum);
    el.transitions.appendChild(li);
  }
}

function loadEnsembleOptions() {
  const keep = state.ensembleFilter;
  el.ensembleFilter.textContent = "";
  const all = document.createElement("option");
  all.value = "all";
  text(all, "all");
  el.ensembleFilter.appendChild(all);
  for (const id of Array.from(state.ensembles.keys()).sort()) {
    const opt = document.createElement("option");
    opt.value = id;
    text(opt, id);
    el.ensembleFilter.appendChild(opt);
  }
  el.ensembleFilter.value = state.ensembles.has(keep) ? keep : "all";
  state.ensembleFilter = el.ensembleFilter.value;
}

function applySnapshot(data, label) {
  if (!data || !Array.isArray(data.players)) {
    throw new Error("snapshot needs players[], got " + typeof data);
  }
  if (data.contractVersion !== CONTRACT_VERSION) {
    setNotice("Contract version " + data.contractVersion + " received, page requires " + CONTRACT_VERSION + ". Rendered state is shown as recorded.");
  }
  el.contractState.textContent = "";
  text(el.contractState, "want " + CONTRACT_VERSION + " / got " + data.contractVersion);
  state.players = new Map(data.players.map((p) => [p.id, p]));
  state.ensembles = new Map((data.ensembles || []).map((e) => [e.id, e]));
  state.transitions = Array.isArray(data.transitions) ? data.transitions.slice() : [];
  state.tasks = data.tasks || {};
  state.providers = data.providers || {};
  setCursor(data.cursor || "");
  el.snapshotLine.textContent = "";
  text(el.snapshotLine, label + (state.subject ? " subject " + state.subject : "") + " at " + (data.capturedAt || "time unrecorded"));
  if (data.selection && data.selection.gap === true) {
    holdGapNotice("Snapshot reports an event history gap. Shown state is authoritative as of the cursor.");
  }
  loadEnsembleOptions();
  if (state.selectionId && !state.players.has(state.selectionId)) state.selectionId = null;
  renderTree();
  renderDetail();
  renderTransitions();
}

async function loadSnapshot() {
  const name = state.fixtureName;
  const url = name
    ? "fixtures/" + name + ".json"
    : state.apiBase + "/orchestra/snapshot" + queryString();
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error("snapshot request failed: " + (e && e.message ? e.message : e));
  }
  if (!res.ok) throw new Error("snapshot request returned " + res.status);
  const data = await res.json();
  applySnapshot(data, name ? "DOM behavior fixture " + name + ", not live state" : "Live snapshot");
}

function connectEvents() {
  if (state.fixtureName) {
    setConn("off (fixture)");
    return;
  }
  if (state.sse) state.sse.close();
  state.opened = false;
  const url = state.apiBase + "/orchestra/events" + queryString();
  let es;
  try {
    es = new EventSource(url);
  } catch (e) {
    setConn("unavailable");
    setNotice("Event stream unavailable: " + (e && e.message ? e.message : e));
    return;
  }
  state.sse = es;
  setConn("connecting");

  es.addEventListener("hello", (ev) => {
    let msg = {};
    try { msg = JSON.parse(ev.data); } catch (e) { msg = {}; }
    if (msg.contractVersion !== CONTRACT_VERSION) {
      setNotice("Contract version " + msg.contractVersion + " on stream, page requires " + CONTRACT_VERSION + ".");
      return;
    }
    if (typeof msg.generation === "string" && msg.generation
        && state.generation && msg.generation !== state.generation) {
      if (state.sse) state.sse.close();
      state.sse = null;
      setConn("generation");
      setGeneration(msg.generation);
      setCursor("");
      holdGapNotice("Owner generation changed. Re-reading current state.");
      resnapshotThenResume();
      return;
    }
    if (typeof msg.generation === "string" && msg.generation) setGeneration(msg.generation);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    else if (msg.cursor) setCursor(msg.cursor);
    state.opened = true;
    state.reconnectDelay = 1000;
    setConn("live");
    if (state.gapHeld) setNotice(state.gapText);
    else setNotice("");
  });

  es.addEventListener("gap", (ev) => {
    let g = {};
    try { g = JSON.parse(ev.data); } catch (e) { g = {}; }
    if (state.sse) state.sse.close();
    state.sse = null;
    setConn("gap");
    if (typeof g.generation === "string" && g.generation) setGeneration(g.generation);
    if (g.reason === "reader-scope-changed") {
      holdGapNotice("Reader scope changed. Re-reading current state.");
    } else if (g.reason === "ensemble-removed" || g.reason === "entity-removed") {
      holdGapNotice("A tracked entry was removed. Re-reading current state.");
    } else if (g.reason === "owner-generation-changed") {
      holdGapNotice("Owner generation changed. Re-reading current state.");
    } else if (g.reason === "owner-notification-lost" || g.reason === "event-read-failed") {
      holdGapNotice("Event read failed. Re-reading current state.");
    } else {
      holdGapNotice("Event history was pruned. Re-reading current state.");
    }
    resnapshotThenResume();
  });

  es.addEventListener("cursor", (ev) => {
    let next = "";
    try {
      const data = JSON.parse(ev.data);
      if (data && typeof data.cursor === "string") next = data.cursor;
    } catch (e) { /* empty data carries the cursor in the frame id */ }
    setCursor(next || ev.lastEventId);
  });

  es.addEventListener("player", (ev) => {
    let p = null;
    try { p = JSON.parse(ev.data); } catch (e) { return; }
    if (!p || !p.id) return;
    state.players.set(p.id, p);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    renderTree();
    if (state.selectionId === p.id) renderDetail();
    flashRow(p.id);
    clearGapNotice();
  });

  es.addEventListener("ensemble", (ev) => {
    let e = null;
    try { e = JSON.parse(ev.data); } catch (err) { return; }
    if (!e || !e.id) return;
    state.ensembles.set(e.id, e);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    loadEnsembleOptions();
    renderTree();
    if (state.selectionId) renderDetail();
    clearGapNotice();
  });

  es.addEventListener("transition", (ev) => {
    let t = null;
    try { t = JSON.parse(ev.data); } catch (e) { return; }
    if (!t) return;
    state.transitions.unshift(t);
    state.transitions = state.transitions.slice(0, TRANSITION_LIMIT);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    renderTransitions();
    clearGapNotice();
  });

  es.addEventListener("pending", (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || !m.session) return;
    const p = state.players.get(m.session);
    if (p) {
      if (typeof m.pendingCount === "number") p.pendingCount = m.pendingCount;
      if (typeof m.unacknowledgedCount === "number") p.unacknowledgedCount = m.unacknowledgedCount;
      if (typeof m.lastTurnId === "string") p.lastTurnId = m.lastTurnId;
      if (typeof m.latestReportId === "string") p.latestReportId = m.latestReportId;
      renderTree();
      if (state.selectionId === m.session) renderDetail();
      flashRow(m.session);
    }
    if (ev.lastEventId) setCursor(ev.lastEventId);
  });

  es.onerror = () => {
    if (state.sse) state.sse.close();
    state.sse = null;
    if (!state.opened) {
      setConn("retrying");
      scheduleEventsRetry();
      return;
    }
    setConn("reconnecting");
    holdGapNotice("Stream lost. Re-reading current state.");
    resnapshotThenResume();
  };
}

async function resnapshotThenResume() {
  try {
    await loadSnapshot();
  } catch (e) {
    scheduleEndpointRetry(e);
    return;
  }
  connectEvents();
}

function scheduleEndpointRetry(cause) {
  const wait = state.reconnectDelay;
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, 30000);
  setConn("retrying");
  setNotice("Snapshot endpoint unreachable (" + (cause && cause.message ? cause.message : cause) + "). Retrying in " + Math.round(wait / 1000) + "s.");
  setTimeout(resnapshotThenResume, wait);
}

function scheduleEventsRetry() {
  const wait = state.reconnectDelay;
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, 30000);
  setConn("retrying");
  setNotice("Event stream unavailable before first hello. Retrying events in " + Math.round(wait / 1000) + "s.");
  setTimeout(async () => {
    if (state.opened) return;
    // A 503 native-owner-subscription-unavailable is a permanent condition of this
    // server, not a transient failure: stop retrying (no browser polling loop) until
    // the operator asks with Reconnect.
    try {
      const probe = await fetch(state.apiBase + "/orchestra/events" + queryString());
      const body = await probe.json().catch(() => ({}));
      if (probe.status === 503 && body && body.error === "native-owner-subscription-unavailable") {
        setConn("unavailable");
        setNotice("Live stream unavailable: the shared owner subscription is not installed yet (#676). The snapshot still updates on Reconnect.");
        return;
      }
      if (probe.body) probe.body.cancel();
    } catch (e) { /* endpoint unreachable: keep the retry path */ }
    connectEvents();
  }, wait);
}

function init() {
  const query = new URLSearchParams(location.search);
  state.apiBase = query.get("api") || "";
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  if (!state.apiBase && meta) state.apiBase = meta.getAttribute("content") || "";
  state.fixtureName = query.get("fixture") || "";
  state.subject = query.get("subject") || "";

  el.search.addEventListener("input", () => {
    state.search = el.search.value.trim();
    renderTree();
  });
  el.statusFilter.addEventListener("change", () => {
    state.statusFilter = el.statusFilter.value;
    renderTree();
  });
  el.ensembleFilter.addEventListener("change", () => {
    state.ensembleFilter = el.ensembleFilter.value;
    renderTree();
  });
  document.getElementById("clear-filters").addEventListener("click", () => {
    state.search = "";
    state.statusFilter = "all";
    state.ensembleFilter = "all";
    el.search.value = "";
    el.statusFilter.value = "all";
    el.ensembleFilter.value = "all";
    renderTree();
  });
  document.getElementById("reconnect").addEventListener("click", async () => {
    state.reconnectDelay = 1000;
    try {
      await loadSnapshot();
      setNotice("");
    } catch (e) {
      setNotice("Snapshot reload failed: " + (e && e.message ? e.message : e));
    }
    connectEvents();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const active = document.activeElement;
    if (!active || !active.classList || !active.classList.contains("node-id")) return;
    ev.preventDefault();
    const buttons = Array.from(el.tree.querySelectorAll(".node-id"));
    const i = buttons.indexOf(active);
    const next = ev.key === "ArrowDown" ? buttons[i + 1] : buttons[i - 1];
    if (next) next.focus();
  });

  if (state.fixtureName) {
    el.fixtureNotice.hidden = false;
    el.fixtureNotice.textContent = "";
    text(el.fixtureNotice, "DOM behavior fixture " + state.fixtureName + ", not live state. Live updates are off.");
    loadSnapshot().catch((e) => {
      el.snapshotLine.textContent = "";
      text(el.snapshotLine, "Fixture failed to load: " + (e && e.message ? e.message : e));
    });
    setConn("off (fixture)");
    return;
  }

  if (!state.apiBase) {
    el.snapshotLine.textContent = "";
    text(el.snapshotLine, "No live endpoint configured. Open with ?api=<base> or ?fixture=fixture-small for DOM review.");
    setConn("idle");
    return;
  }

  loadSnapshot().then(connectEvents).catch((e) => {
    el.snapshotLine.textContent = "";
    text(el.snapshotLine, "Snapshot failed to load: " + (e && e.message ? e.message : e));
    setConn("failed");
  });
}

init();