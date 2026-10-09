/* Orchestra live view. Read-only. All DOM text via textContent. */

const CONTRACT_VERSION = 1;
const ARRIVAL_THROTTLE_MS = 1000;
const AGE_REFRESH_MS = 30000;

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
  pendingOpen: null,
  search: "",
  statusFilter: "running",
  ensembleFilter: "all",
  collapsed: new Set(),
  arrivalAt: new Map(),
  structure: "",
  snapshotLabel: "",
  sse: null,
  connected: false,
  knowledge: null,
  fixtureKnowledge: null,
  knowledgeNotice: "",
  knowledgeActor: null,
  knowledgeActorId: "",
  knowledgeActorRequest: null,
  work: null,
  workRequest: null,
  workActorId: "",
  knowledgeOpen: false,
  includeUnshared: false,
  knowledgeSearch: "",
  findingId: null,
  graphRecord: null,
  graphRecordRequest: null,
  knowledgeLiveOnly: false,
  knowledgeSeatEmpty: "",
  view: "now",
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
  knowledgePromotions: document.getElementById("knowledge-promotions"),
  knowledgeEmpty: document.getElementById("knowledge-empty"),
  knowledgeCount: document.getElementById("knowledge-count"),
  includeUnshared: document.getElementById("include-unshared"),
  knowledgeSearch: document.getElementById("knowledge-search"),
  knowledgeSurface: document.getElementById("knowledge-surface"),
  liveOnly: document.getElementById("live-only"),
  attention: document.getElementById("attention-lane"),
  board: document.getElementById("ensemble-board"),
  graph: document.getElementById("knowledge-graph"),
  viewNow: document.getElementById("view-now"),
  viewKnowledge: document.getElementById("view-knowledge"),
  viewActors: document.getElementById("view-actors"),
  viewNowBtn: document.getElementById("view-now-btn"),
  viewKnowledgeBtn: document.getElementById("view-knowledge-btn"),
  viewActorsBtn: document.getElementById("view-actors-btn"),
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

/* --- recorded state ------------------------------------------------------- */

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

// An ended turn that still owes a reply reads as waiting on input, which is a
// different state from a session that is working now.
function awaitingInput(p) {
  const ex = p.execution || null;
  return Boolean(ex && ex.phase === "exited" && (p.pendingCount || 0) > 0);
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
    const members = ensembleMemberSet(state.ensembleFilter);
    if (!members.has(p.id)) return false;
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

// Every stored member of one ensemble: its members, its sections' members and its
// owner. The ensemble filter and the tag both read this one set.
function ensembleMemberSet(ensId) {
  const ens = state.ensembles.get(ensId);
  const members = new Set();
  if (!ens) return members;
  for (const id of ens.members || []) members.add(id);
  for (const section of ens.sections || []) for (const id of section.members || []) members.add(id);
  if (ens.owner) members.add(ens.owner);
  return members;
}

// The activity rail class for one recorded change kind. Kind values carry ":" and
// "-", so the class is the kind with every other character replaced by "-".
function kindClass(kind) {
  const slug = String(kind || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "t-" + (slug || "unknown");
}

function ageText(at) {
  if (!at) return "";
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.round(hours / 24) + "d ago";
}

function lastTransitionFor(id) {
  for (const t of state.transitions) {
    if (t.session === id) return t;
  }
  return null;
}

// What the actor is doing now when the database records it, otherwise the last
// committed transition, marked stale. Nothing here invents work.
function actionFor(p) {
  const current = p.currentAction || null;
  const label = current && current.label ? current.label : "";
  const last = lastTransitionFor(p.id);
  if (label && label.toLowerCase() !== deriveStatus(p)) {
    return { label, at: current.at || "", stale: false };
  }
  // A bare phase word repeats the recorded status beside it, so the slot
  // falls back to the actor's latest recorded transition instead.
  if (last) return { label: last.summary || last.kind || "", at: last.at || "", stale: true };
  if (label) return { label, at: current.at || "", stale: false };
  return null;
}

function pendingItems(p) {
  return Array.isArray(p.pendingSample) ? p.pendingSample : [];
}

/* --- notices and transport ------------------------------------------------ */

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

// The visible header line carries the transport facts a reader may want while the
// full block stays in the Connection details.
function renderHeaderLine() {
  const parts = [state.snapshotLabel || "No snapshot loaded."];
  parts.push("cursor " + (state.cursor || "none"));
  parts.push("gen " + (state.generation || "none"));
  parts.push("contract " + CONTRACT_VERSION);
  el.snapshotLine.textContent = "";
  text(el.snapshotLine, parts.join(" · "));
}

function setCursor(cursor) {
  state.cursor = cursor || "";
  el.cursorState.textContent = "";
  text(el.cursorState, state.cursor || "none");
  renderHeaderLine();
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
  renderHeaderLine();
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

// One arrival mark per row per second; a later event inside the window wins the
// data and skips the second animation.
function markArrival(id) {
  if (!id || !state.players.has(id)) return;
  const now = Date.now();
  const previous = state.arrivalAt.get(id) || 0;
  if (now - previous < ARRIVAL_THROTTLE_MS) return;
  state.arrivalAt.set(id, now);
  const row = rowElement(id);
  if (row) {
    row.classList.remove("arrival");
    void row.offsetWidth;
    row.classList.add("arrival");
  }
}

function rowElement(id) {
  return el.tree.querySelector('[data-row="' + CSS.escape(id) + '"]');
}

/* --- membership tags and the message connector ----------------------------- */

// Ensemble membership cross-cuts parentage, so it is a column device: a rule with
// the group label, repeated per member row. Consecutive member rows read as one
// column, and no row is regrouped or duplicated.
function ensMetaRow(ensId) {
  const ens = state.ensembles.get(ensId) || {};
  const meta = document.createElement("span");
  meta.className = "ens-meta";
  const owner = document.createElement("span");
  text(owner, ens.owner || "unknown");
  meta.appendChild(owner);
  if (ens.coupling) {
    const coupling = document.createElement("span");
    text(coupling, ens.coupling);
    meta.appendChild(coupling);
  }
  const count = document.createElement("span");
  text(count, ensembleMemberSet(ensId).size + " members");
  meta.appendChild(count);
  return meta;
}

function ensFilterButton(ensId, actorId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ens-id";
  button.dataset.focus = "ensemble:" + ensId + ":" + actorId;
  button.setAttribute("aria-pressed", state.ensembleFilter === ensId ? "true" : "false");
  button.setAttribute("title", "Filter to ensemble " + ensId);
  text(button, ensId);
  button.addEventListener("click", () => {
    state.ensembleFilter = state.ensembleFilter === ensId ? "all" : ensId;
    el.ensembleFilter.value = state.ensembleFilter;
    renderTree();
  });
  return button;
}

// One transient hairline for a message that moved between two rows, positioned in
// the tree's own content coordinates because the tree is the scroll container.
function messageConnector(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const from = rowElement(fromId);
  const to = rowElement(toId);
  if (!from || !to) return;
  const host = document.createElement("li");
  host.className = "connector-host";
  host.setAttribute("role", "presentation");
  const line = document.createElement("div");
  line.className = "connector";
  line.setAttribute("aria-hidden", "true");
  const base = el.tree.getBoundingClientRect().top - el.tree.scrollTop;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const top = Math.min(a.top, b.top) - base;
  const bottom = Math.max(a.bottom, b.bottom) - base;
  line.style.top = Math.round(top) + "px";
  line.style.height = Math.round(bottom - top) + "px";
  host.appendChild(line);
  el.tree.appendChild(host);
  setTimeout(() => host.remove(), 500);
}

// The line the tree pane shows when membership changed.
function setTreeNotice(message) {
  const node = document.getElementById("tree-notice");
  if (!node) return;
  node.hidden = !message;
  node.textContent = "";
  if (message) text(node, message);
}

/* --- rendering ------------------------------------------------------------ */

function structureSignature() {
  const ids = [...state.players.keys()].sort();
  const parents = ids.map((id) => id + "<" + ((state.players.get(id) || {}).parent || ""));
  return [
    ids.join(","),
    parents.join(","),
    [...state.collapsed].sort().join(","),
    state.search,
    state.statusFilter,
    state.ensembleFilter,
    state.selectionId || "",
    state.pendingOpen || "",
    [...state.ensembles.keys()].sort().join(","),
  ].join("|");
}

function select(id) {
  if (!state.players.has(id)) return;
  state.selectionId = id;
  state.knowledgeOpen = false;
  state.findingId = null;
  // The dossier lives in the Actors view, so every selection reveals it;
  // selections made inside that view render unchanged.
  setView("actors");
  renderTree();
  renderDetail();
  void loadActorKnowledge(id);
  void loadActorWork(id);
  // Keyboard users land on the selected row instead of back at the top:
  // the view switch hides the chip they came from.
  const target = el.tree.querySelector("[data-focus=\"" + CSS.escape(focusKey("id", id)) + "\"]");
  if (target && typeof target.focus === "function") target.focus();
}

function toggleCollapse(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id);
  else state.collapsed.add(id);
  renderTree();
}

function setAllCollapsed(collapsed) {
  state.collapsed = new Set();
  if (collapsed) {
    for (const p of state.players.values()) {
      if (childrenOf(p.id).length) state.collapsed.add(p.id);
    }
  }
  renderTree();
}

function togglePending(id) {
  state.pendingOpen = state.pendingOpen === id ? null : id;
  renderTree();
}

function focusKey(kind, id) {
  return kind + ":" + id;
}

function restoreFocus(key) {
  if (!key) return;
  const next = el.tree.querySelector('[data-focus="' + CSS.escape(key) + '"]');
  if (next && typeof next.focus === "function") next.focus();
}

function renderTree() {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.focus || "" : "";
  el.tree.textContent = "";
  const list = roots().filter(subtreeVisible);
  let shown = 0;
  for (const p of list) shown += renderNode(el.tree, p, 1);
  el.treeCount.textContent = "";
  text(el.treeCount, shown + " of " + state.players.size + " actors shown");
  state.structure = structureSignature();
  restoreFocus(key);
  renderAttentionState();
  renderBoardState();
  refreshKnowledgeSeats();
}

function renderAction(row, p) {
  const action = actionFor(p);
  let slot = row.querySelector(".node-action");
  if (!action) {
    if (slot) slot.remove();
    return;
  }
  if (!slot) {
    slot = document.createElement("span");
    row.appendChild(slot);
  }
  slot.className = "node-action" + (action.stale ? " stale" : "");
  slot.dataset.row = p.id;
  slot.textContent = "";
  const when = ageText(action.at);
  text(slot, action.label + (when ? " · " + when : ""));
}

function buildRow(p, hasChildren) {
  const status = deriveStatus(p);
  const row = document.createElement("div");
  row.className = "node-row";
  row.dataset.row = p.id;
  row.setAttribute("aria-selected", state.selectionId === p.id ? "true" : "false");

  // A row with children carries the real expand control, named for assistive
  // technology; a leaf carries a mark with no control behind it.
  let twisty;
  if (hasChildren) {
    twisty = document.createElement("button");
    twisty.type = "button";
    twisty.className = "twisty";
    twisty.dataset.focus = focusKey("twisty", p.id);
    twisty.setAttribute("aria-label", (state.collapsed.has(p.id) ? "Expand " : "Collapse ") + p.id);
    text(twisty, state.collapsed.has(p.id) ? "+" : "-");
    twisty.addEventListener("click", () => toggleCollapse(p.id));
  } else {
    twisty = document.createElement("span");
    twisty.className = "twisty leaf";
    twisty.setAttribute("aria-hidden", "true");
    text(twisty, ".");
  }
  row.appendChild(twisty);

  const dot = document.createElement("span");
  dot.className = "dot " + status;
  dot.setAttribute("aria-hidden", "true");
  row.appendChild(dot);

  const tag = document.createElement("span");
  tag.className = "role-tag " + (p.role || "");
  text(tag, shortRole(p.role));
  row.appendChild(tag);

  const idBtn = document.createElement("button");
  idBtn.className = "node-id";
  idBtn.type = "button";
  idBtn.dataset.focus = focusKey("id", p.id);
  text(idBtn, p.id.length > 24 ? p.id.slice(0, 23) + "…" : p.id);
  idBtn.title = p.id;
  idBtn.addEventListener("click", () => select(p.id));
  row.appendChild(idBtn);

  const statusWord = document.createElement("span");
  statusWord.className = "status-word";
  text(statusWord, status);
  row.appendChild(statusWord);

  if (awaitingInput(p)) {
    const owed = document.createElement("span");
    owed.className = "status-word";
    text(owed, "awaiting input");
    row.appendChild(owed);
  }

  if ((p.pendingCount || 0) > 0) {
    const badge = document.createElement("button");
    badge.className = "pend-badge";
    badge.type = "button";
    badge.dataset.focus = focusKey("pending", p.id);
    badge.setAttribute("aria-expanded", state.pendingOpen === p.id ? "true" : "false");
    badge.setAttribute("aria-label",
      p.pendingCount + " messages awaiting acknowledgement for " + p.id);
    text(badge, "pending " + p.pendingCount);
    badge.addEventListener("click", () => togglePending(p.id));
    row.appendChild(badge);
  }

  const model = document.createElement("span");
  model.className = "model-note";
  text(model, (p.observedModel || p.model || "unknown") + " / " + (p.branch || "no branch"));
  row.appendChild(model);

  renderAction(row, p);

  return row;
}

function renderNode(parentUl, p, depth) {
  let count = 0;
  const visibleChildren = childrenOf(p.id).filter(subtreeVisible);
  const selfMatch = matchesFilters(p);
  const li = document.createElement("li");
  li.setAttribute("role", "treeitem");
  li.setAttribute("aria-level", String(depth));
  li.setAttribute("aria-expanded", visibleChildren.length && !state.collapsed.has(p.id) ? "true" : "false");

  const row = buildRow(p, visibleChildren.length > 0);


  li.appendChild(row);

  if (state.pendingOpen === p.id) {
    li.appendChild(renderPendingList(p));
  }

  // Membership is a labeled column tag per member row, never regrouped.
  const ensIds = Array.from(new Set((p.ownedEnsembles || []).concat(p.memberEnsembles || [])));
  if (ensIds.length) {
    const tags = document.createElement("div");
    tags.className = "member-tags";
    for (const ensId of ensIds) {
      const ens = document.createElement("span");
      ens.className = "ens";
      ens.appendChild(ensFilterButton(ensId, p.id));
      ens.appendChild(ensMetaRow(ensId));
      tags.appendChild(ens);
    }
    li.appendChild(tags);
  }

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


// A committed player event re-renders the full changed row: status, awaiting marker,
// pending badge, model and branch, and the current-action slot all follow the event.
// Filter membership and an open pending list follow too; focus stays on its row.
function updateRow(p) {
  const row = rowElement(p.id);
  if (!row || !matchesFilters(p)) { renderTree(); return; }
  const focused = row.contains(document.activeElement) && document.activeElement.dataset
    ? document.activeElement.dataset.focus : null;
  const fresh = buildRow(p, childrenOf(p.id).filter(subtreeVisible).length > 0);
  row.replaceWith(fresh);
  if (focused) restoreFocus(focused);
  const li = fresh.parentElement;
  if (li && state.pendingOpen === p.id) {
    const oldList = li.querySelector(":scope > .pending-list");
    if (oldList) oldList.replaceWith(renderPendingList(p));
    else fresh.after(renderPendingList(p));
  }
  renderAttentionState();
  renderBoardState();
  refreshKnowledgeSeats();
}

// The header switch shows one view at a time. Switching to Knowledge
// re-renders the seats, whose layout reads zero while hidden.
function setView(name) {
  state.view = name;
  const views = [["now", el.viewNowBtn, el.viewNow],
    ["knowledge", el.viewKnowledgeBtn, el.viewKnowledge],
    ["actors", el.viewActorsBtn, el.viewActors]];
  for (const [n, button, section] of views) {
    if (button) button.setAttribute("aria-pressed", n === name ? "true" : "false");
    if (section) section.hidden = n !== name;
  }
  if (name === "knowledge") renderKnowledge();
}

// The attention lane mirrors recorded actor state with running actors first.
// It renders from the same snapshot the tree reads and selects through it.
function renderAttentionState() {
  const mount = el.attention;
  if (!mount || typeof renderAttention !== "function") return;
  const players = [];
  for (const p of state.players.values()) {
    players.push({
      id: p.id,
      status: deriveStatus(p),
      awaitingInput: awaitingInput(p),
      pendingCount: p.pendingCount || 0,
      action: (actionFor(p) || {}).label || "",
    });
  }
  renderAttention(mount, players, {
    selectedId: state.selectionId,
    onSelect: (id) => select(id),
  });
}

// The ensemble board reads the same snapshot as the tree: recorded
// membership, derived status and the current action label per actor.
function boardData() {
  const actors = [];
  for (const p of state.players.values()) {
    const action = actionFor(p) || {};
    const ensembles = [];
    for (const id of (p.ownedEnsembles || []).concat(p.memberEnsembles || [])) {
      if (id && !ensembles.includes(id)) ensembles.push(id);
    }
    actors.push({
      id: p.id,
      status: deriveStatus(p),
      awaitingInput: awaitingInput(p),
      pendingCount: p.pendingCount || 0,
      action: action.label || "",
      stale: !!action.stale,
      task: (state.tasks[p.id] || {}).title || "",
      ensembles,
    });
  }
  const ensembles = [];
  for (const e of state.ensembles.values()) {
    ensembles.push({ id: e.id, owner: e.owner || "", coupling: e.coupling || "", members: e.members || [] });
  }
  return { actors, ensembles };
}

function renderBoardState() {
  const mount = el.board;
  if (!mount || typeof renderEnsembleBoard !== "function") return;
  renderEnsembleBoard(mount, boardData(), {
    selectedId: state.selectionId,
    onSelect: (id) => select(id),
  });
}
// Every stored message the badge counts, newest first, named by id and kind. The
// count is the stored count; this list is the sample behind it.
function renderPendingList(p) {
  const ul = document.createElement("ul");
  ul.className = "pending-list";
  const items = pendingItems(p);
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    text(li, "No stored sample in this snapshot for the " + (p.pendingCount || 0) + " awaiting messages.");
    ul.appendChild(li);
    return ul;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "mono";
    const when = ageText(item.at);
    text(li, (item.kind || "message") + " · " + (item.id || "unrecorded id") + (when ? " · " + when : ""));
    ul.appendChild(li);
  }
  return ul;
}

function shortRole(role) {
  if (role === "principal-conductor") return "principal";
  if (role === "associate-conductor") return "associate";
  if (role === "operator") return "operator";
  return "player";
}

// Complete recorded work for the selected actor, read on demand from the
// work route: the full task body, the exact current input, the open native
// request, and the latest report. Nothing is truncated; rows appear only
// for records the route returns.
function renderWorkBlock(dl, p) {
  if (!knowledgeWired()) return;
  const data = state.workActorId === p.id ? state.work : null;
  if (!data) {
    td(dl, "work", "Reading recorded work.");
    return;
  }
  if (data.refused) {
    td(dl, "work", "Work for this actor is outside the bound reader's scope.");
    return;
  }
  if (data.error) {
    td(dl, "work", "Work unavailable: " + data.error);
    return;
  }
  let shown = false;
  const task = data.task || null;
  if (task && task.description) {
    td(dl, "task description", task.description);
    shown = true;
  }
  const input = data.input || null;
  if (input) {
    td(dl, "current input", (input.kind || "message") + " from " + (input.sender || "unknown"));
    if (input.body) td(dl, "input text", input.body);
    shown = true;
  }
  const request = data.request || null;
  if (request) {
    td(dl, "open request", (request.method || "native") + " " + (request.event || "")
      + (request.reply ? " response written" : " awaiting response")
      + (request.closed ? " (closed)" : ""));
    shown = true;
  }
  const report = data.report || null;
  if (report) {
    td(dl, "latest report", (report.id || "") + " to " + (report.recipient || "unknown"));
    if (report.body) td(dl, "report text", report.body);
    shown = true;
  }
  if (!shown) td(dl, "work", "No recorded task, input, request, or report.");
}

async function loadActorWork(id) {
  const request = {};
  state.workRequest = request;
  state.work = null;
  state.workActorId = id || "";
  if (!knowledgeWired() || !id) {
    renderDetail();
    return;
  }
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/work?subject=" + encodeURIComponent(id));
    if (res.status === 403) data = { refused: true };
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = await res.json();
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.workRequest !== request || state.selectionId !== id) return;
  state.work = data;
  renderDetail();
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
  td(dl, "recorded status", deriveStatus(p) + (awaitingInput(p) ? " (awaiting input)" : ""));

  const action = actionFor(p);
  if (action) {
    const when = ageText(action.at);
    td(dl, "current activity", action.label
      + (action.stale ? " (last transition)" : "")
      + (when ? " · " + when : ""), true);
  } else {
    td(dl, "current activity", null);
  }

  td(dl, "parent", (p.parent || "") === "" ? "(none)" : p.parent, true);

  const task = state.tasks[p.id] || null;
  if (task) {
    td(dl, "task", (task.id || "") + (task.title ? " " + task.title : ""), true);
    td(dl, "task status", [task.status, task.updatedAt].filter(Boolean).join(" / ") || "unknown");
  } else {
    td(dl, "task", null);
  }
  renderWorkBlock(dl, p);

  td(dl, "worktree", p.workspace || null, true);
  td(dl, "branch", p.branch || null, true);
  td(dl, "base", p.base || null, true);

  // Both counts are stored-message counts; the row badge shows the first.
  td(dl, "messages awaiting acknowledgement",
    String(p.pendingCount || 0) + " (actionable task, guidance or recovery)", true);
  td(dl, "unacknowledged messages",
    String(p.unacknowledgedCount || 0) + " (includes stopped sessions)", true);
  if (p.latestReportId) td(dl, "latest report", p.latestReportId, true);
  if (p.lastTurnId) td(dl, "last turn", p.lastTurnId, true);
  const sample = pendingItems(p);
  if (sample.length) {
    td(dl, "awaiting messages", sample.map((item) => (item.kind || "message") + " " + item.id).join(" / "), true);
  }

  td(dl, "recorded execution", p.execution
    ? [p.execution.attempt, p.execution.mode, p.execution.phase, p.execution.status].filter(Boolean).join(" / ")
    : null, true);
  td(dl, "observed process", p.actualProcess || null, true);

  const observed = [p.observedHarness, p.observedModel, p.observedEffort].filter(Boolean).join(" / ");
  td(dl, "observed harness", observed || null, true);
  const prov = state.providers[p.id] || null;
  td(dl, "provider", prov ? (prov.name || "unnamed") + " / " + (prov.status || "unknown") : null, true);
  td(dl, "configured", [p.harness, p.model, p.effort].filter(Boolean).join(" / ") || null, true);

  td(dl, "receiver", p.liveReceiver === true ? "registered" : p.liveReceiver === false ? "none recorded" : null, true);
  td(dl, "endpoint", p.endpointRegistered === true ? "registered" : p.endpointRegistered === false ? "none recorded" : null, true);
  td(dl, "reference", p.reference === true ? "reference entry" : p.reference === false ? "not a reference" : null, true);
  td(dl, "input read", (p.inputRead || []).join(" / ") || null, true);
  td(dl, "stop", p.stop
    ? [p.stop.id, p.stop.status, p.stop.attempt, p.stop.reportId].filter(Boolean).join(" / ")
    : "none recorded", true);

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
  renderKnowledgeBlock(el.detail, p);
}

const TRANSITION_LIMIT = 50;

function transitionRow(t) {
  const li = document.createElement("li");
  li.className = kindClass(t.kind) + (t.arrival ? " arrival" : "");
  const when = document.createElement("time");
  text(when, t.at || "time unrecorded");
  li.appendChild(when);
  if (t.session) {
    const go = document.createElement("button");
    go.className = "go";
    go.type = "button";
    text(go, t.session);
    go.addEventListener("click", () => select(t.session));
    li.appendChild(go);
  }
  const kind = document.createElement("span");
  text(kind, " " + (t.kind || "unknown") + " ");
  li.appendChild(kind);
  const sum = document.createElement("span");
  sum.className = "muted";
  const receipt = t.entity === "message" && t.kind === "receipt" && t.counterpart
    ? " message from " + t.counterpart : "";
  text(sum, (t.summary || "") + receipt);
  li.appendChild(sum);
  t.arrival = false;
  return li;
}

// History stays available on demand: the rail opens with the newest batch
// and a control reads the rest. Row shape and order are unchanged.
function renderTransitions() {
  el.transitions.textContent = "";
  if (!state.transitions.length) {
    const li = document.createElement("li");
    text(li, "No committed transitions in this snapshot.");
    el.transitions.appendChild(li);
    return;
  }
  const expanded = state.showAllTransitions === true;
  const shown = expanded ? state.transitions : state.transitions.slice(0, TRANSITION_LIMIT);
  for (const t of shown) el.transitions.appendChild(transitionRow(t));
  if (!expanded && state.transitions.length > shown.length) {
    const more = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    text(button, "Show all " + state.transitions.length + " transitions");
    button.addEventListener("click", () => {
      state.showAllTransitions = true;
      renderTransitions();
    });
    more.appendChild(button);
    el.transitions.appendChild(more);
  }
}

/* --- knowledge (on demand, read-only) ------------------------------------- */

// Read finding and promotion summaries on demand; actor details include evidence
// and limits. The recorded hierarchy determines display order.

function knowledgeWired() {
  return !state.fixtureName && Boolean(state.apiBase);
}

// A fixture may carry a knowledge block so the band and the list render without
// the live endpoint. The records are synthetic and the screen is labeled as a
// fixture; the shapes match the overview and actor routes.
function fixtureActorKnowledge(id) {
  const source = state.fixtureKnowledge || {};
  const findings = source.findings || [];
  const promotions = source.promotions || [];
  const authored = findings.filter((f) => String(f.author || "") === id);
  const promoted = new Set(promotions.map((p) => p.finding).filter(Boolean));
  const received = promotions.filter((p) => String(p.destination || "") === id).map((p) => {
    const finding = findings.find((f) => f.id === p.finding) || {};
    return { id: p.id, finding: p.finding, author: p.author, source: p.source,
      destination: p.destination, promotedBy: p.promotedBy, claim: finding.claim,
      evidence: finding.evidence, limits: finding.limits };
  });
  const unshared = authored.filter((f) => !promoted.has(f.id)).length;
  return { contractVersion: CONTRACT_VERSION, actor: id, authored, received,
    counts: { authored: authored.length, received: received.length, unshared },
    empty: authored.length === 0 && received.length === 0 };
}

async function loadKnowledgeOverview() {
  if (state.fixtureName) {
    state.knowledge = state.fixtureKnowledge || null;
    state.knowledgeNotice = state.fixtureKnowledge ? "" : "A fixture carries no knowledge records.";
    renderKnowledge();
    return;
  }
  if (!knowledgeWired()) {
    state.knowledge = null;
    state.knowledgeNotice = "No live endpoint is configured.";
    renderKnowledge();
    return;
  }
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge/overview");
    if (!res.ok) throw new Error("the endpoint answered " + res.status);
    state.knowledge = await res.json();
    state.knowledgeNotice = "";
  } catch (e) {
    state.knowledge = null;
    state.knowledgeNotice = "Knowledge unavailable: " + (e && e.message ? e.message : e);
  }
  renderKnowledge();
}

async function loadActorKnowledge(id) {
  const request = {};
  state.knowledgeActorRequest = request;
  state.knowledgeActor = null;
  state.knowledgeActorId = id || "";
  if (state.fixtureName) {
    if (state.fixtureKnowledge && id) state.knowledgeActor = fixtureActorKnowledge(id);
    renderDetail();
    return;
  }
  if (!knowledgeWired() || !id) {
    renderDetail();
    return;
  }
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge?actor=" + encodeURIComponent(id));
    if (res.status === 403) data = { refused: true };
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = await res.json();
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.knowledgeActorRequest !== request || state.selectionId !== id) return;
  state.knowledgeActor = data;
  renderDetail();
}

// The actor view carries the full record; an overview expansion lists what the
// overview endpoint actually returned (claim, author, sharing path) so a field the
// endpoint does not carry is never shown as recorded `unknown`.
function findingDetail(promotion, finding, full = true) {
  const ul = document.createElement("ul");
  ul.className = "knowledge-list";
  const fields = full ? [
    ["claim", finding && finding.claim],
    ["evidence", finding && finding.evidence],
    ["limits", finding && finding.limits],
    ["author", (finding && finding.author) || promotion.author],
    ["sharing path", (promotion.source || "unknown") + " \u2192 " + (promotion.destination || "unknown")
      + (promotion.promotedBy ? " via " + promotion.promotedBy : "")],
  ] : [
    ["claim", finding && finding.claim],
    ["author", (finding && finding.author) || promotion.author],
    ["sharing path", (promotion.source || "unknown") + " \u2192 " + (promotion.destination || "unknown")
      + (promotion.promotedBy ? " via " + promotion.promotedBy : "")],
  ];
  for (const [label, value] of fields) {
    const li = document.createElement("li");
    const key = document.createElement("span");
    key.className = "finding-meta";
    text(key, label + ": ");
    li.appendChild(key);
    const body = document.createElement("span");
    const empty = value === null || value === undefined || value === "";
    if (empty) {
      body.className = "unknown";
      text(body, "unknown");
    } else if (label === "evidence" || label === "limits") {
      appendEvidenceRefs(body, String(value), li);
    } else {
      text(body, value);
    }
    li.appendChild(body);
    ul.appendChild(li);
  }
  return ul;
}

// Evidence and limits cite supporting records as message: references. Each
// reference is a button that reads the complete stored message inline,
// so the supporting record is inspectable without leaving the graph.
function appendEvidenceRefs(body, value, li) {
  const parts = String(value).split(/(message:[^\s,;]+)/g);
  if (parts.length < 2) {
    text(body, value);
    return;
  }
  const record = document.createElement("div");
  record.className = "msg-record";
  record.setAttribute("aria-live", "polite");
  for (const part of parts) {
    if (/^message:[^\s,;]+$/.test(part)) {
      const ref = document.createElement("button");
      ref.type = "button";
      ref.className = "msg-ref";
      text(ref, part);
      ref.setAttribute("aria-label", "Supporting record " + part);
      ref.addEventListener("click", () => showMessageRecord(record, part));
      body.appendChild(ref);
    } else if (part) {
      const span = document.createElement("span");
      text(span, part);
      body.appendChild(span);
    }
  }
  li.appendChild(record);
}

function showMessageRecord(record, token) {
  record.textContent = "";
  record.dataset.token = token;
  const id = token.slice("message:".length);
  const head = document.createElement("span");
  head.className = "finding-meta";
  text(head, token + ": ");
  record.appendChild(head);
  // The transition summary appears beside the complete message body below.
  const hit = state.transitions.find((t) => t.entity === "message" && String(t.entityId) === id);
  const detail = document.createElement("span");
  if (hit) {
    text(detail, "recorded transition summary · " + (hit.kind || "unknown") + " · "
      + (hit.session || "unknown") + " · " + (hit.at || "unknown time")
      + (hit.summary ? " · " + hit.summary : ""));
  } else {
    detail.className = "unknown";
    text(detail, "no recorded transition carries this reference in the current snapshot");
  }
  record.appendChild(detail);
  if (hit && hit.session) {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "go";
    text(go, "open " + hit.session);
    go.addEventListener("click", () => select(hit.session));
    record.appendChild(go);
  }
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "msg-body";
  text(bodyWrap, "reading full record…");
  record.appendChild(bodyWrap);
  void readMessageBody(record, bodyWrap, id);
}

// The complete supporting message body is read on demand through the public
// message route, so older references outside the snapshot resolve too.
async function readMessageBody(record, bodyWrap, id) {
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/message?id=" + encodeURIComponent(id));
    const responseBody = await res.text();
    try {
      data = JSON.parse(responseBody);
    } catch {
      data = { error: responseBody || "the endpoint answered " + res.status };
    }
    if (!res.ok && (!data || !data.error)) {
      data = { error: responseBody || "the endpoint answered " + res.status };
    }
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (record.dataset.token !== "message:" + id) return;
  bodyWrap.textContent = "";
  // An empty stored body displays its sender header.
  if (!data || data.error || !data.message) {
    bodyWrap.className = "msg-body unknown";
    text(bodyWrap, data && data.message === null
      ? "no stored message carries this reference"
      : "full record unavailable"
        + (data && data.error ? ": " + data.error : " for this reference")
        + (data && data.cause ? ": " + data.cause : ""));
    return;
  }
  const message = data.message;
  const who = document.createElement("div");
  who.className = "finding-meta";
  text(who, "recorded message"
    + (message.sender ? " from " + message.sender : "")
    + (message.recipient ? " to " + message.recipient : "")
    + (message.kind ? " · " + message.kind : ""));
  bodyWrap.appendChild(who);
  const full = document.createElement("div");
  text(full, typeof message.body === "string" ? message.body : "");
  bodyWrap.appendChild(full);
}

// Showing the findings no recorded promotion carries. One place owns the state
// and its control's pressed state.
function setIncludeUnshared(on) {
  state.includeUnshared = Boolean(on);
  if (el.includeUnshared) {
    el.includeUnshared.setAttribute("aria-pressed", state.includeUnshared ? "true" : "false");
  }
}

// A graph re-render recreates its nodes and drops keyboard focus with the
// removed node. When focus was lost to the remount, restore it to the same
// finding node if still present and visible. Focus the user placed elsewhere
// is never moved.
function restoreGraphFocus(findingId) {
  if (!findingId || !el.graph || !el.viewKnowledge || el.viewKnowledge.hidden) return;
  if (document.activeElement !== document.body) return;
  const node = [...el.graph.querySelectorAll(".knode")]
    .find((n) => n.getAttribute("aria-label") === findingId);
  if (node && typeof node.focus === "function") node.focus();
}

// A finding selection opens the complete record inline beside the graph:
// the readout expansion carries the full claim, evidence and limits, so the
// relationship context stays visible while reading. The selection never
// leaves the Knowledge view. Focus restore lives in the shared graph render
// wrapper, which keeps the actual focused node across every redraw.
function toggleFinding(id) {
  if (!id) return;
  state.findingId = state.findingId === id ? null : id;
  if (state.findingId) {
    // A finding selected from the seats opens its recorded content. A finding no
    // recorded promotion carries has no row until the unshared rows are shown,
    // and the detail pane holds the record only while the block is open.
    const promotions = (state.knowledge && state.knowledge.promotions) || [];
    if (!promotions.some((p) => (p.finding || p.id) === id)) setIncludeUnshared(true);
    state.knowledgeOpen = true;
    // The overview carries no evidence or limits, so the selected record is
    // read through the existing on-demand author knowledge endpoint.
    void loadGraphRecord(graphFindingAuthor(state.findingId), state.findingId);
  }
  renderKnowledge();
  renderDetail();
}

// The recorded author behind a finding: the current actor read first, then
// the overview findings, then the promotion source. Only recorded identities.
function graphFindingAuthor(id) {
  const data = state.knowledgeActor;
  if (data && state.knowledgeActorId === state.selectionId && state.selectionId) {
    for (const f of data.authored || []) if (f && f.id === id) return state.selectionId;
    for (const r of data.received || []) if (r && (r.finding || r.id) === id) return state.selectionId;
  }
  const overview = state.knowledge || {};
  const record = (overview.findings || []).find((f) => f && f.id === id) || {};
  if (record.author) return record.author;
  const edge = (overview.promotions || []).find((p) => p && (p.finding || p.id) === id) || {};
  return edge.source || edge.author || "";
}

// The selected inline record, read through the existing on-demand actor
// knowledge endpoint without touching the dossier slot. The request guard
// keeps a late earlier finding response from replacing the newly selected
// record. Only selected records read full bodies; overview frames stay
// excerpted.
async function loadGraphRecord(actor, findingId) {
  const request = {};
  state.graphRecordRequest = request;
  state.graphRecord = { actor: actor || "", data: null };
  const current = state.knowledgeActor;
  if (actor && current && state.knowledgeActorId === actor && !current.refused && !current.error) {
    state.graphRecord = { actor, data: current };
    renderKnowledge();
    return;
  }
  if (state.fixtureName) {
    if (state.fixtureKnowledge && actor) state.graphRecord = { actor, data: fixtureActorKnowledge(actor) };
    renderKnowledge();
    return;
  }
  if (!knowledgeWired() || !actor) {
    renderKnowledge();
    return;
  }
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge?actor=" + encodeURIComponent(actor));
    if (res.status === 403) data = { refused: true };
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = await res.json();
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.graphRecordRequest !== request || state.findingId !== findingId) return;
  state.graphRecord = { actor, data };
  renderKnowledge();
}

// The complete recorded fields for the selected finding from its author
// read, shaped like the dossier expansion. Null until that read arrives.
function graphRecordFinding(id) {
  const rec = state.graphRecord;
  const data = rec && rec.data;
  if (!data || data.refused || data.error) return null;
  for (const f of data.authored || []) {
    if (f && f.id === id) return {
      promo: { author: f.author, source: f.author, destination: "" },
      finding: f,
    };
  }
  for (const r of data.received || []) {
    if (r && (r.finding || r.id) === id) return { promo: r, finding: r };
  }
  return null;
}

// The selected record expansion: the complete recorded fields once the
// on-demand author read arrives; meanwhile only what the overview carries,
// plus the actual read state. Evidence and limits are never guessed.
function findingRecordExpansion(parent, findingId, promo, finding) {
  const full = graphRecordFinding(findingId);
  if (full) {
    parent.appendChild(findingDetail(full.promo, full.finding));
    return;
  }
  parent.appendChild(findingDetail(promo, finding, false));
  const rec = state.graphRecord;
  if (!rec || !rec.actor) return;
  const data = rec.data;
  const note = document.createElement("p");
  note.className = "muted";
  if (data && data.refused) text(note, "Findings for this actor are outside the bound reader's scope.");
  else if (data && data.error) text(note, "Knowledge unavailable: " + data.error);
  else text(note, "Reading recorded evidence.");
  parent.appendChild(note);
}

// One row per finding: the claim once, its author, how many recorded
// promotions carry it, and every recorded sharing path. Promotion rows
// repeated the claim per edge; the group shows the finding and its
// relationships together.
function findingGroupRow(findingId, group, findings) {
  const li = document.createElement("li");
  li.className = "t-promotion";
  const finding = findings.get(findingId);
  const id = document.createElement("button");
  id.type = "button";
  id.className = "finding-id mono";
  text(id, findingId || "unrecorded finding");
  id.addEventListener("click", () => toggleFinding(findingId || ""));
  li.appendChild(id);
  const meta = document.createElement("span");
  meta.className = "finding-meta";
  const author = (finding && finding.author) || (group[0] && group[0].author) || "unknown";
  text(meta, " author " + author + " · shared " + group.length
    + (group.length === 1 ? " time" : " times"));
  li.appendChild(meta);
  const path = document.createElement("span");
  path.className = "share-path";
  text(path, group.map((p) => (p.source || "unknown") + " → " + (p.destination || "unknown")
    + (p.promotedBy ? " via " + p.promotedBy : "")).join(" / "));
  li.appendChild(path);
  if (finding && finding.claim) {
    const claim = document.createElement("span");
    claim.className = "muted";
    text(claim, " " + finding.claim);
    li.appendChild(claim);
  }
  if (state.findingId && state.findingId === findingId) {
    findingRecordExpansion(li, findingId, group[0], finding || {});
  }
  return li;
}

// The knowledge band renders the read as seats: every actor that holds a recorded
// finding sits at its recorded distance from the podium, and each recorded
// promotion is a line between two seats. A page without the mount, or without the
// module, keeps the promotion list only.
function snapshotPlayers() {
  const out = [];
  for (const p of state.players.values()) {
    out.push({
      id: p.id,
      parent: p.parent || "",
      role: p.role || "",
      model: p.observedModel || p.model || "",
      status: deriveStatus(p),
    });
  }
  return out;
}

function renderKnowledgeSeats(overview, emptyText) {
  const mount = el.knowledgeSurface;
  if (!mount || !window.KnowledgeSurface) return;
  state.knowledgeSeatEmpty = emptyText || "";
  window.KnowledgeSurface.render(mount, overview, {
    players: snapshotPlayers(),
    liveOnly: state.knowledgeLiveOnly,
    query: state.knowledgeSearch,
    selectedId: state.selectionId,
    notice: state.knowledgeNotice || (!overview ? "No knowledge read yet." : (emptyText || "")),
    onSelectActor: (id) => select(id),
    onSelectFinding: (id) => toggleFinding(id),
  });
}

// The seats read the same recorded state as the tree - each seat's liveness, its
// place in the hierarchy and the selected actor - so a tree refresh refreshes the
// seats with it. The promotion list is unchanged by that state and stays as it is.
function refreshKnowledgeSeats() {
  if (!el.knowledgeSurface || !window.KnowledgeSurface) return;
  renderKnowledgeSeats(state.knowledge, state.knowledgeSeatEmpty);
}

// The knowledge graph draws the same overview behind the readout. A page
// without the graph mount, or without kgraph.js, keeps the readout only.
function renderKnowledgeGraphState(overview, emptyText) {
  const mount = el.graph;
  if (!mount || typeof renderKnowledgeGraph !== "function") return;
  // The render recreates every node, so capture the actual focused finding
  // first; the wrapper restores that exact identity afterwards.
  const focusedId = mount.contains(document.activeElement)
    ? document.activeElement.getAttribute("aria-label") || "" : "";
  const roles = {};
  for (const p of state.players.values()) roles[p.id] = p.role || "";
  renderKnowledgeGraph(mount, overview, {
    query: state.knowledgeSearch,
    includeUnshared: state.includeUnshared,
    selectedId: state.findingId,
    notice: state.knowledgeNotice || (!overview ? "No knowledge read yet." : (emptyText || "")),
    roles,
    onSelect: (id) => toggleFinding(id),
  });
  restoreGraphFocus(focusedId);
}

function renderKnowledge() {
  const list = el.knowledgePromotions;
  const empty = el.knowledgeEmpty;
  if (!list || !empty) return; // a page without the knowledge section renders nothing
  // These three nodes persist across renders, and text() appends, so each one is
  // cleared before this render writes to it.
  list.textContent = "";
  empty.textContent = "";
  el.knowledgeCount.textContent = "";
  empty.hidden = true;
  const overview = state.knowledge;
  if (state.knowledgeNotice) {
    empty.hidden = false;
    text(empty, state.knowledgeNotice);
    renderKnowledgeSeats(overview);
    renderKnowledgeGraphState(overview);
    return;
  }
  if (!overview) {
    empty.hidden = false;
    text(empty, "No knowledge read yet.");
    renderKnowledgeSeats(overview);
    renderKnowledgeGraphState(overview);
    return;
  }
  const findings = new Map((overview.findings || []).map((f) => [f.id, f]));
  const query = state.knowledgeSearch.trim().toLowerCase();
  const matches = (id, claim, author) => !query
    || String(id || "").toLowerCase().includes(query)
    || String(claim || "").toLowerCase().includes(query)
    || String(author || "").toLowerCase().includes(query);
  const promotions = (overview.promotions || []).filter((p) => matches(p.finding || p.id,
    (findings.get(p.finding) || {}).claim, p.author));
  const unshared = [];
  if (state.includeUnshared) {
    const promoted = new Set((overview.promotions || []).map((p) => p.finding));
    for (const f of overview.findings || []) {
      if (!promoted.has(f.id) && matches(f.id, f.claim, f.author)) unshared.push(f);
    }
  }
  const parts = [promotions.length + " promotion" + (promotions.length === 1 ? "" : "s")];
  const findingCount = (overview.findings || []).length;
  parts.push(findingCount + " finding" + (findingCount === 1 ? "" : "s"));
  if (state.includeUnshared) parts.push(unshared.length + " not yet shared");
  text(el.knowledgeCount, parts.join(" \u00b7 "));
  if (!promotions.length && !unshared.length) {
    empty.hidden = false;
    text(empty, query
      ? "No findings match."
      : (overview.empty ? "No recorded findings." : "No recorded promotions."));
    renderKnowledgeSeats(overview, empty.textContent);
    renderKnowledgeGraphState(overview, empty.textContent);
    return;
  }
  const groups = new Map();
  for (const promotion of promotions) {
    const key = promotion.finding || promotion.id || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(promotion);
  }
  for (const [findingId, group] of groups) {
    list.appendChild(findingGroupRow(findingId, group, findings));
  }
  for (const finding of unshared) {
    const li = document.createElement("li");
    li.className = "t-promotion finding-unshared";
    const id = document.createElement("button");
    id.type = "button";
    id.className = "finding-id mono";
    text(id, finding.id);
    id.addEventListener("click", () => toggleFinding(finding.id));
    li.appendChild(id);
    const meta = document.createElement("span");
    meta.className = "finding-meta";
    text(meta, " author " + (finding.author || "unknown") + " \u00b7 not yet shared");
    li.appendChild(meta);
    const claim = document.createElement("span");
    claim.className = "muted";
    text(claim, " " + (finding.claim || ""));
    li.appendChild(claim);
    if (state.findingId === finding.id) {
      findingRecordExpansion(li, finding.id,
        { author: finding.author, source: finding.author, destination: "" }, finding);
    }
    list.appendChild(li);
  }
  renderKnowledgeSeats(overview);
  renderKnowledgeGraphState(overview);
}

// The dossier block: authored, received and never-shared counts with the stored
// findings behind them. A refused actor keeps the reason visible.
function renderKnowledgeBlock(container, p) {
  const block = document.createElement("div");
  block.className = "knowledge";
  const heading = document.createElement("h3");
  text(heading, "Knowledge");
  block.appendChild(heading);
  const data = state.knowledgeActor;
  const note = (message) => {
    const m = document.createElement("p");
    m.className = "muted";
    text(m, message);
    block.appendChild(m);
    container.appendChild(block);
  };
  if (state.knowledgeActorId !== p.id) return note("Reading recorded findings.");
  if (!data) return note(knowledgeWired() ? "No knowledge read." : "A fixture carries no knowledge records.");
  if (data.refused) return note("Findings for this actor are outside the bound reader's scope.");
  if (data.error) return note("Knowledge unavailable: " + data.error);
  const counts = data.counts || { authored: 0, received: 0, unshared: 0 };
  const line = document.createElement("p");
  text(line, counts.authored + " authored / " + counts.received + " received / "
    + counts.unshared + " not yet shared");
  block.appendChild(line);
  const button = document.createElement("button");
  button.type = "button";
  button.id = "show-findings";
  button.setAttribute("aria-expanded", state.knowledgeOpen ? "true" : "false");
  text(button, "Show findings");
  button.addEventListener("click", () => {
    state.knowledgeOpen = !state.knowledgeOpen;
    renderDetail();
  });
  block.appendChild(button);
  if (state.knowledgeOpen) {
    const ul = document.createElement("ul");
    ul.className = "knowledge-list";
    const authored = data.authored || [];
    const received = data.received || [];
    if (!authored.length && !received.length) {
      const li = document.createElement("li");
      li.className = "muted";
      text(li, "No authored findings. No received findings.");
      ul.appendChild(li);
    }
    for (const f of authored) {
      const li = document.createElement("li");
      li.className = "finding";
      const id = document.createElement("button");
      id.type = "button";
      id.className = "finding-id mono";
      text(id, f.id);
      id.addEventListener("click", () => toggleFinding(f.id));
      li.appendChild(id);
      const meta = document.createElement("span");
      meta.className = "finding-meta";
      text(meta, " authored");
      li.appendChild(meta);
      const claim = document.createElement("span");
      claim.className = "muted";
      text(claim, " " + (f.claim || ""));
      li.appendChild(claim);
      if (state.findingId === f.id) {
        li.appendChild(findingDetail({ author: f.author, source: f.author, destination: "" }, f));
      }
      ul.appendChild(li);
    }
    for (const promotion of received) {
      const li = document.createElement("li");
      li.className = "finding";
      const id = document.createElement("button");
      id.type = "button";
      id.className = "finding-id mono";
      text(id, promotion.finding || promotion.id);
      id.addEventListener("click", () => toggleFinding(promotion.finding || ""));
      li.appendChild(id);
      const meta = document.createElement("span");
      meta.className = "finding-meta";
      text(meta, " received from " + (promotion.source || "unknown")
        + (promotion.promotedBy ? " via " + promotion.promotedBy : ""));
      li.appendChild(meta);
      const claim = document.createElement("span");
      claim.className = "muted";
      text(claim, " " + (promotion.claim || ""));
      li.appendChild(claim);
      if (state.findingId === (promotion.finding || "")) {
        li.appendChild(findingDetail(promotion, promotion));
      }
      ul.appendChild(li);
    }
    block.appendChild(ul);
  }
  container.appendChild(block);
}

function renderAges() {
  for (const slot of el.tree.querySelectorAll(".node-action")) {
    const p = state.players.get(slot.dataset.row || "");
    if (!p) continue;
    const action = actionFor(p);
    if (!action) continue;
    const when = ageText(action.at);
    slot.textContent = "";
    text(slot, action.label + (when ? " · " + when : ""));
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

/* --- snapshot and stream -------------------------------------------------- */

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
  state.fixtureKnowledge = data.knowledge || null;
  state.snapshotLabel = label + (state.subject ? " subject " + state.subject : "")
    + " at " + (data.capturedAt || "time unrecorded");
  setCursor(data.cursor || "");
  if (data.selection && data.selection.gap === true) {
    holdGapNotice("Snapshot reports an event history gap. Shown state is authoritative as of the cursor.");
  }
  loadEnsembleOptions();
  if (state.selectionId && !state.players.has(state.selectionId)) state.selectionId = null;
  if (state.pendingOpen && !state.players.has(state.pendingOpen)) state.pendingOpen = null;
  renderTree();
  renderDetail();
  renderTransitions();
  // Knowledge reads are on demand: refresh them with every authoritative snapshot.
  void loadKnowledgeOverview();
  if (state.selectionId) void loadActorKnowledge(state.selectionId);
  // The selected work read refreshes with the snapshot the same way.
  if (state.selectionId) void loadActorWork(state.selectionId);
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
    const known = state.players.has(p.id);
    state.players.set(p.id, p);
    // Player frames carry the concise task record; the selected read loads
    // the complete work. A frame without one deletes the stored record so
    // stale work metadata never persists. A frame for the selected actor
    // refreshes the selected read, guarded like every on-demand read.
    if (p.task) state.tasks[p.id] = p.task;
    else delete state.tasks[p.id];
    if (p.id === state.selectionId) void loadActorWork(p.id);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    // A new actor or a reparent restructures the tree; an attribute change is
    // patched in place so focus, selection and filters stay where they are.
    if (!known || structureSignature() !== state.structure) renderTree();
    else {
      updateRow(p);
      renderDetail();
    }
    markArrival(p.id);
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
    t.arrival = true;
    state.transitions.unshift(t);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    renderTransitions();
    const actor = state.players.get(t.session);
    if (actor) {
      const row = rowElement(actor.id);
      if (row) renderAction(row, actor);
      // A transition on the selected actor can carry a new report, input,
      // or receipt, so the selected read refreshes with it.
      if (state.selectionId === actor.id) {
        renderDetail();
        void loadActorWork(actor.id);
      }
    }
    // Message admission goes to the recipient; its acknowledgement returns to
    // the sender.
    if (t.entity === "message" && t.counterpart) {
      if (t.kind === "receipt") {
        markArrival(t.counterpart);
        messageConnector(t.session, t.counterpart);
      } else if (t.operation === "insert") {
        markArrival(t.counterpart);
        messageConnector(t.counterpart, t.session);
      }
    }
    // A membership or ensemble change is a structural change: the tree re-renders
    // and the pane names what changed.
    if (t.entity === "membership" || t.entity === "section-membership"
        || t.entity === "ensemble" || t.entity === "section") {
      setTreeNotice((t.kind || t.entity) + ": " + (t.summary || t.entityId || "recorded change"));
    }
    // A recorded knowledge change refreshes the open knowledge reads.
    if (t.entity === "knowledge" || t.entity === "promotion") {
      void loadKnowledgeOverview();
      if (state.selectionId) void loadActorKnowledge(state.selectionId);
    }
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
  const wait = 1000;
  setConn("retrying");
  setNotice("Snapshot endpoint unreachable (" + (cause && cause.message ? cause.message : cause) + "). Retrying in " + Math.round(wait / 1000) + "s.");
  setTimeout(resnapshotThenResume, wait);
}

function scheduleEventsRetry() {
  const wait = 1000;
  setConn("retrying");
  setNotice("Event stream unavailable before first hello. Retrying events in " + Math.round(wait / 1000) + "s.");
  setTimeout(async () => {
    if (state.opened) return;
    // Response headers identify an available stream. A 503 carries its JSON
    // refusal. The probe body is cancelled before connectEvents opens the stream.
    try {
      const probe = await fetch(state.apiBase + "/orchestra/events" + queryString());
      if (probe.status === 503) {
        const body = await probe.json().catch(() => ({}));
        if (body && body.error === "native-owner-subscription-unavailable") {
          setConn("unavailable");
          setNotice("Live stream unavailable: the shared owner subscription is not installed yet (#676). The client continues checking for the owner subscription.");
          scheduleEventsRetry();
          return;
        }
      }
      if (probe.body) await probe.body.cancel().catch(() => {});
    } catch (e) { /* A failed request resumes the event connection. */ }
    connectEvents();
  }, wait);
}

/* --- controls ------------------------------------------------------------- */

function focusedRowId() {
  const active = document.activeElement;
  if (!active || !active.closest) return "";
  const row = active.closest(".node-row");
  return row && row.dataset ? row.dataset.row || "" : "";
}

function clearFilters() {
  state.search = "";
  state.statusFilter = "all";
  state.ensembleFilter = "all";
  el.search.value = "";
  el.statusFilter.value = "all";
  el.ensembleFilter.value = "all";
  renderTree();
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
  document.getElementById("clear-filters").addEventListener("click", clearFilters);
  if (el.includeUnshared) {
    el.includeUnshared.addEventListener("click", () => {
      setIncludeUnshared(!state.includeUnshared);
      renderKnowledge();
    });
  }
  if (el.liveOnly) {
    el.liveOnly.addEventListener("click", () => {
      state.knowledgeLiveOnly = !state.knowledgeLiveOnly;
      el.liveOnly.setAttribute("aria-pressed", state.knowledgeLiveOnly ? "true" : "false");
      renderKnowledge();
    });
  }
  for (const [name, button] of [["now", el.viewNowBtn],
      ["knowledge", el.viewKnowledgeBtn], ["actors", el.viewActorsBtn]]) {
    if (!button) continue;
    button.addEventListener("click", () => setView(name));
  }
  if (el.knowledgeSearch) {
    el.knowledgeSearch.addEventListener("input", () => {
      state.knowledgeSearch = el.knowledgeSearch.value;
      renderKnowledge();
    });
  }
  document.getElementById("collapse-all").addEventListener("click", () => setAllCollapsed(true));
  document.getElementById("expand-all").addEventListener("click", () => setAllCollapsed(false));
  document.getElementById("reconnect").addEventListener("click", async () => {
    try {
      await loadSnapshot();
      setNotice("");
    } catch (e) {
      scheduleEndpointRetry(e);
      return;
    }
    connectEvents();
  });

  document.addEventListener("keydown", (ev) => {
    const active = document.activeElement;
    const inField = active && (active.tagName === "INPUT" || active.tagName === "SELECT");

    if (ev.key === "/" && !inField) {
      ev.preventDefault();
      el.search.focus();
      return;
    }
    if (ev.key === "Escape") {
      if (inField) {
        ev.preventDefault();
        active.blur();
        if (active === el.knowledgeSearch) {
          active.value = "";
          state.knowledgeSearch = "";
          renderKnowledge();
        } else if (active === el.search) {
          active.value = "";
          state.search = "";
          renderTree();
        } else if (active === el.statusFilter) {
          active.value = "all";
          state.statusFilter = "all";
          renderTree();
        } else if (active === el.ensembleFilter) {
          active.value = "all";
          state.ensembleFilter = "all";
          renderTree();
        }
        return;
      }
      if (state.pendingOpen) {
        state.pendingOpen = null;
        renderTree();
        return;
      }
      clearFilters();
      return;
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const id = focusedRowId();
      if (!id || !childrenOf(id).length) return;
      ev.preventDefault();
      const wantCollapsed = ev.key === "ArrowLeft";
      if (state.collapsed.has(id) !== wantCollapsed) toggleCollapse(id);
      return;
    }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    if (!active || !active.classList || !active.classList.contains("node-id")) return;
    ev.preventDefault();
    const buttons = Array.from(el.tree.querySelectorAll(".node-id"));
    const i = buttons.indexOf(active);
    const next = ev.key === "ArrowDown" ? buttons[i + 1] : buttons[i - 1];
    if (next) next.focus();
  });

  setInterval(renderAges, AGE_REFRESH_MS);

  if (state.fixtureName) {
    el.fixtureNotice.hidden = false;
    el.fixtureNotice.textContent = "";
    text(el.fixtureNotice, "DOM behavior fixture " + state.fixtureName + ", not live state. Live updates are off.");
    loadSnapshot().catch((e) => {
      state.snapshotLabel = "Fixture failed to load: " + (e && e.message ? e.message : e);
      renderHeaderLine();
    });
    setConn("off (fixture)");
    return;
  }

  if (!state.apiBase) {
    state.snapshotLabel = "No live endpoint configured. Open with ?api=<base> or ?fixture=fixture-small for DOM review.";
    renderHeaderLine();
    setConn("idle");
    return;
  }

  loadSnapshot().then(connectEvents).catch((e) => {
    state.snapshotLabel = "Snapshot failed to load: " + (e && e.message ? e.message : e);
    renderHeaderLine();
    // A failed initial snapshot uses the existing endpoint retry path.
    scheduleEndpointRetry(e);
  });
}

init();
