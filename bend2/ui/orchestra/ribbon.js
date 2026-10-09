/* History ribbon. Read-only. All text via textContent.

   One mark per committed event, oldest at the left, newest at the right. The
   position names the event the reader is looking at; the readout states it in
   words, and the full recorded list opens on demand so the history holds no
   region of the page while the operator is not reading it.

   The recorded data carries each event's kind, time, actor and far side. It
   does not carry the state of every actor before each event, so a position is
   a reading position in the recorded history, and the page can mark the actor
   an event touched. Selecting a row reports the event to the page.

   options: {position, onScrub, onSelectEvent, onListOpen}
   data: {events} newest first, as the page holds them.

   Starts no request. */

const RIBBON_BUCKETS_MAX = 900;
const RIBBON_LIST_ROWS = 400;
const RIBBON_PAGE_STEP = 50;

const ribbonListOpen = new WeakMap();

function ribbonCount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function ribbonShort(id) {
  const full = String(id);
  return full.length > 26 ? full.slice(0, 25) + "\u2026" : full;
}

function ribbonAge(at) {
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

function ribbonEventText(event, index, total) {
  if (!event) return "no event at this position";
  const from = String(event.session || "");
  const to = String(event.counterpart || "");
  const where = from && to ? from + " to " + to : (from || to || "no actor recorded");
  return "event " + ribbonCount(total - index) + " of " + ribbonCount(total)
    + ", " + (event.kind || "unknown") + ", " + where
    + (event.at ? ", " + event.at : "");
}

// One drag at a time, owned by the document rather than by the strip. The page
// redraws the whole document on every scrub report, which replaces the strip's
// nodes and any listener attached to them. These listeners and this record
// survive that redraw, so the pointer keeps owning the scrub past the first
// point.
let ribbonDragging = null;
let ribbonQueued = null;
let ribbonFrame = 0;

function ribbonEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

// Recorded kind to a class: message:report -> ribbon-kind-message-report.
function ribbonKindClass(kind) {
  const slug = String(kind || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "ribbon-kind-" + (slug || "unknown");
}

function ribbonPositionFromClient(container, clientX, total) {
  const strip = container ? container.querySelector(".ribbon-strip") : null;
  if (!strip) return null;
  const box = strip.getBoundingClientRect();
  if (!box.width || total < 2) return 0;
  const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  // Oldest at the left, newest at the right.
  return Math.round((1 - fraction) * (total - 1));
}

function ribbonFlush() {
  const pending = ribbonQueued;
  ribbonQueued = null;
  if (pending === null || !ribbonDragging) return;
  const opts = ribbonDragging.opts || {};
  if (typeof opts.onScrub === "function") opts.onScrub(pending);
}

// One report per frame: each report redraws the document.
function ribbonReport(index) {
  ribbonQueued = index;
  if (ribbonFrame) return;
  ribbonFrame = window.requestAnimationFrame(() => {
    ribbonFrame = 0;
    ribbonFlush();
  });
}

function ribbonMove(event) {
  if (!ribbonDragging || event.pointerId !== ribbonDragging.pointerId) return;
  const next = ribbonPositionFromClient(ribbonDragging.container, event.clientX, ribbonDragging.total);
  if (next !== null) ribbonReport(next);
}

function ribbonEndDrag(event) {
  if (!ribbonDragging) return;
  if (event && event.pointerId !== ribbonDragging.pointerId) return;
  if (ribbonFrame) {
    window.cancelAnimationFrame(ribbonFrame);
    ribbonFrame = 0;
  }
  if (event && typeof event.clientX === "number") {
    const at = ribbonPositionFromClient(ribbonDragging.container, event.clientX, ribbonDragging.total);
    if (at !== null) ribbonQueued = at;
  }
  ribbonFlush();
  document.removeEventListener("pointermove", ribbonMove, true);
  document.removeEventListener("pointerup", ribbonEndDrag, true);
  document.removeEventListener("pointercancel", ribbonEndDrag, true);
  ribbonDragging = null;
}

function renderRibbon(container, data, options) {
  const opts = options || {};
  if (!container) return { events: 0, position: 0 };
  const events = Array.isArray((data || {}).events) ? data.events : [];
  const total = events.length;

  // Captured before the mount is cleared, because the page redraws this ribbon
  // on every scrub and on every frame it renders. Reading it after the rebuild
  // reads the body and loses the reader's place.
  const active = document.activeElement;
  const focusKey = active && container.contains(active) && active.dataset
    ? (active.dataset.focus || "") : "";

  if (ribbonDragging && ribbonDragging.container === container) {
    // A redraw during a drag: keep the live options and the window length so
    // the pointer keeps owning the scrub.
    ribbonDragging.opts = opts;
    ribbonDragging.total = total;
  }

  container.textContent = "";
  const strip = document.createElement("div");
  strip.className = "ribbon-strip";
  const readout = document.createElement("p");
  readout.className = "ribbon-readout";

  if (!total) {
    readout.textContent = "No committed event is recorded in this snapshot.";
    container.appendChild(readout);
    return { events: 0, position: 0 };
  }

  // The page holds events newest first; the ribbon draws oldest first.
  let position = Number(opts.position);
  if (!Number.isFinite(position) || position < 0) position = 0;
  if (position > total - 1) position = total - 1;
  const current = events[position] || events[0];

  const buckets = Math.min(total, RIBBON_BUCKETS_MAX);
  const perBucket = total / buckets;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    // The page holds events newest first, so the oldest indices are drawn at
    // the left, matching the position the strip maps from a pointer column.
    const toEnd = Math.floor((bucket + 1) * perBucket);
    const fromEnd = Math.floor(bucket * perBucket);
    const last = Math.max(0, total - fromEnd);
    const first = Math.max(0, total - toEnd);
    const mark = document.createElement("span");
    mark.className = "ribbon-mark";
    const counts = new Map();
    for (let index = first; index < last; index += 1) {
      const kind = String((events[index] || {}).kind || "unknown");
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    let dominant = "unknown";
    let dominantCount = 0;
    for (const entry of counts) {
      if (entry[1] > dominantCount) {
        dominant = entry[0];
        dominantCount = entry[1];
      }
    }
    const counted = Math.max(1, last - first);
    mark.classList.add(ribbonKindClass(dominant));
    mark.title = ribbonCount(counted) + (counted === 1 ? " event" : " events")
      + (counts.size > 1 ? ", mostly " + dominant : ", " + dominant);
    if (counted > 1) mark.classList.add("ribbon-many");
    if (position >= first && position < last) mark.classList.add("ribbon-here");
    strip.appendChild(mark);
  }

  const slider = document.createElement("div");
  slider.className = "ribbon-slider";
  slider.dataset.focus = "ribbon-slider";
  slider.tabIndex = 0;
  slider.setAttribute("role", "slider");
  slider.setAttribute("aria-label", "Position in the recorded history");
  slider.setAttribute("aria-valuemin", "1");
  slider.setAttribute("aria-valuemax", String(total));
  slider.setAttribute("aria-valuenow", String(total - position));
  slider.setAttribute("aria-valuetext", ribbonEventText(current, position, total));
  slider.appendChild(strip);

  function setPosition(next) {
    if (next < 0) next = 0;
    if (next > total - 1) next = total - 1;
    if (typeof opts.onScrub === "function") opts.onScrub(next);
  }

  slider.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const at = ribbonPositionFromClient(container, event.clientX, total);
    ribbonDragging = { container, opts, total, pointerId: event.pointerId };
    document.addEventListener("pointermove", ribbonMove, true);
    document.addEventListener("pointerup", ribbonEndDrag, true);
    document.addEventListener("pointercancel", ribbonEndDrag, true);
    if (at !== null) setPosition(at);
    if (typeof slider.focus === "function") slider.focus({ preventScroll: true });
  });
  slider.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
    if (keys.indexOf(event.key) === -1) return;
    event.preventDefault();
    if (event.key === "Home") setPosition(total - 1);
    else if (event.key === "End") setPosition(0);
    else if (event.key === "PageUp") setPosition(position + RIBBON_PAGE_STEP);
    else if (event.key === "PageDown") setPosition(position - RIBBON_PAGE_STEP);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") setPosition(position + 1);
    else setPosition(position - 1);
  });

  readout.textContent = ribbonEventText(current, position, total)
    + (current && current.at ? " \u00b7 " + ribbonAge(current.at) : "");

  const actions = document.createElement("div");
  actions.className = "ribbon-actions";
  const now = document.createElement("button");
  now.type = "button";
  now.className = "ribbon-button";
  now.dataset.focus = "ribbon-now";
  now.textContent = position === 0 ? "At the newest event" : "Back to the newest event";
  now.disabled = position === 0;
  now.addEventListener("click", () => setPosition(0));
  actions.appendChild(now);

  const listOpen = ribbonListOpen.get(container) === true;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ribbon-button";
  toggle.dataset.focus = "ribbon-list";
  toggle.setAttribute("aria-expanded", listOpen ? "true" : "false");
  toggle.textContent = listOpen
    ? "Hide the full record"
    : "Show the full record (" + ribbonCount(total) + ")";
  toggle.addEventListener("click", () => {
    ribbonListOpen.set(container, !listOpen);
    if (typeof opts.onListOpen === "function") opts.onListOpen(!listOpen);
    renderRibbon(container, data, opts);
  });
  actions.appendChild(toggle);

  container.appendChild(slider);
  container.appendChild(readout);
  container.appendChild(actions);

  if (listOpen) {
    const list = document.createElement("ol");
    list.className = "ribbon-list";
    const start = Math.max(0, position - Math.floor(RIBBON_LIST_ROWS / 2));
    const end = Math.min(total, start + RIBBON_LIST_ROWS);
    for (let index = start; index < end; index += 1) {
      const event = events[index];
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ribbon-row";
      button.dataset.focus = "ribbon-row:" + index;
      if (index === position) button.setAttribute("aria-current", "true");
      const when = document.createElement("time");
      when.textContent = event.at || "time unrecorded";
      button.appendChild(when);
      const kind = document.createElement("span");
      kind.className = "ribbon-row-kind";
      kind.textContent = event.kind || "unknown";
      button.appendChild(kind);
      const who = document.createElement("span");
      who.className = "ribbon-row-who";
      who.textContent = ribbonShort(event.session || event.counterpart || "");
      button.appendChild(who);
      const far = document.createElement("span");
      far.className = "ribbon-row-far";
      far.textContent = event.counterpart ? "with " + ribbonShort(event.counterpart) : "";
      button.appendChild(far);
      button.addEventListener("click", () => {
        if (typeof opts.onSelectEvent === "function") opts.onSelectEvent(index);
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    if (start > 0 || end < total) {
      const note = document.createElement("li");
      note.className = "ribbon-row-note";
      note.textContent = "Showing " + ribbonCount(start + 1) + " to " + ribbonCount(end)
        + " of " + ribbonCount(total) + ". Scrub the ribbon to read another stretch.";
      list.appendChild(note);
    }
    container.appendChild(list);
  }

  if (focusKey) {
    const next = container.querySelector('[data-focus="' + ribbonEscape(focusKey) + '"]');
    if (next && typeof next.focus === "function") next.focus();
  }

  return { events: total, position };
}
