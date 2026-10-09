/* The run's time axis: the page spine in the pit.

   One bucket per stretch of recorded time across the window the page forwards,
   its height against the busiest stretch and its ink against the recorded kind
   that dominates it. A needle marks the reader's position and the live edge
   carries a pulse while entries keep arriving. At the axis's left end a tempo
   mark states one measured fact about the window, and the seats that moved most
   in it are chips that jump the position to that seat's newest entry. The full
   record opens behind one control.

   The time scale is linear over the window and the axis spans the mount's
   content width with no inset of its own, so the grid lines up column for
   column with the staves below it.

   Read-only. Every character of text is written through textContent, the module
   starts no request, and it renders nothing without its mount.

   options: {position, onScrub, onSelectEvent, onSelectActor, selectedId,
             onListOpen}
   data: {events} newest first, as the page holds them. */

const RIBBON_BARS_MAX = 180;
const RIBBON_LIST_ROWS = 400;
const RIBBON_PAGE_STEP = 50;
const RIBBON_CHIPS_MAX = 8;
const RIBBON_LIVE_MS = 90000;

const ribbonListOpen = new WeakMap();
const ribbonLastSeq = new WeakMap();

// One drag at a time, owned by the document rather than by the strip. The page
// redraws the whole document on every scrub report, which replaces the strip's
// nodes and any listener attached to them. These listeners and this record
// survive that redraw, so the pointer keeps owning the scrub past the first
// point.
let ribbonDragging = null;
let ribbonQueued = null;
let ribbonFrame = 0;

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

// A span in words, from two recorded times.
function ribbonSpan(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return "";
  const minutes = Math.round((toMs - fromMs) / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return minutes + (minutes === 1 ? " minute" : " minutes");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours + (hours === 1 ? " hour" : " hours");
  return Math.round(hours / 24) + " days";
}

function ribbonEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

// Recorded kind to a class: message:report -> ribbon-kind-message-report.
function ribbonKindClass(kind) {
  const slug = String(kind || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "ribbon-kind-" + (slug || "unknown");
}

function ribbonSeats(event) {
  const seats = [];
  for (const value of [event.session, event.counterpart]) {
    const id = String(value || "");
    if (id && seats.indexOf(id) === -1) seats.push(id);
  }
  return seats;
}

// The busiest recorded kinds, named as the database names them.
function ribbonKindTally(events, limit) {
  const tally = new Map();
  for (const event of events) {
    const kind = String((event || {}).kind || "unknown");
    tally.set(kind, (tally.get(kind) || 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
}

// The tempo mark at the axis's left end states one measured fact about the
// window, using the page's expression marks where their meaning is true: solo
// when one seat carries the whole stretch, tutti while the busiest stretch
// carries twelve or more entries, attacca while entries arrive. The counts the
// shell already computes are quoted, never recomputed.
function ribbonTempo(busiest, uniqueSeats, recent, shellCounts) {
  let word = "";
  let meaning = "";
  if (uniqueSeats === 1) {
    word = "solo";
    meaning = "one seat carries every entry in this window";
  } else if (busiest >= 12) {
    word = "tutti";
    meaning = "the busiest stretch carries " + busiest + " entries";
  } else if (recent) {
    word = "attacca";
    meaning = "entries keep arriving";
  }
  if (!word) return null;
  return { word: word, title: meaning + (shellCounts ? " \u00b7 " + shellCounts : "") };
}

// The counts the shell already computed, quoted in the mark's readout.
function ribbonShellCounts() {
  const node = document.getElementById("doc-counts");
  return node && node.textContent ? node.textContent.trim() : "";
}

// The measured rate, in the words the page uses for a recorded entry.
function ribbonRate(total, spanMs) {
  if (!Number.isFinite(spanMs) || spanMs <= 0 || total < 2) return "";
  const minutes = spanMs / 60000;
  if (minutes < 1) return ribbonCount(total) + " entries in under a minute";
  const per = total / minutes;
  const rounded = per >= 10 ? Math.round(per) : Math.round(per * 10) / 10;
  return ribbonCount(rounded) + " entries a minute";
}

function ribbonEventText(event, index, total) {
  if (!event) return "no recorded change at this position";
  const from = String(event.session || "");
  const to = String(event.counterpart || "");
  const where = from && to ? from + " to " + to : (from || to || "no actor recorded");
  return "change " + ribbonCount(total - index) + " of " + ribbonCount(total)
    + ", " + (event.kind || "unknown") + ", " + where
    + (event.at ? ", " + event.at : "");
}

function ribbonPositionFromClient(container, clientX) {
  const axis = container ? container.querySelector(".ribbon-axis") : null;
  if (!axis) return null;
  const box = axis.getBoundingClientRect();
  if (!box.width) return null;
  return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
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

function ribbonAt(container, clientX) {
  if (!ribbonDragging) return;
  const fraction = ribbonPositionFromClient(container, clientX);
  if (fraction === null) return;
  const mapping = ribbonDragging.map;
  const next = mapping ? mapping(fraction) : null;
  if (next !== null && next !== undefined) ribbonReport(next);
}

function ribbonMove(event) {
  if (!ribbonDragging || event.pointerId !== ribbonDragging.pointerId) return;
  ribbonAt(ribbonDragging.container, event.clientX);
}

function ribbonEndDrag(event) {
  if (!ribbonDragging) return;
  if (event && event.pointerId !== ribbonDragging.pointerId) return;
  if (ribbonFrame) {
    window.cancelAnimationFrame(ribbonFrame);
    ribbonFrame = 0;
  }
  if (event && typeof event.clientX === "number") ribbonAt(ribbonDragging.container, event.clientX);
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
    // A redraw during a drag: keep the live options so the pointer keeps
    // owning the scrub. The axis mapping is rebuilt below.
    ribbonDragging.opts = opts;
  }

  container.textContent = "";

  if (!total) {
    const empty = document.createElement("p");
    empty.className = "ribbon-readout";
    empty.textContent = "No recorded change is in this snapshot.";
    container.appendChild(empty);
    return { events: 0, position: 0 };
  }

  // The page holds events newest first; the axis runs oldest to newest.
  let position = Number(opts.position);
  if (!Number.isFinite(position) || position < 0) position = 0;
  if (position > total - 1) position = total - 1;
  const current = events[position] || events[0];

  // Recorded times, oldest first, each with the index the page knows.
  const timed = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    const at = Date.parse((events[index] || {}).at || "");
    if (Number.isFinite(at)) timed.push({ at, index });
  }
  const usable = timed.length >= 2 && timed[timed.length - 1].at > timed[0].at;
  const firstAt = usable ? timed[0].at : 0;
  const lastAt = usable ? timed[timed.length - 1].at : 0;
  const spanMs = usable ? lastAt - firstAt : 0;

  function fractionOf(index) {
    if (!usable) return total < 2 ? 1 : (total - 1 - index) / (total - 1);
    const at = Date.parse((events[index] || {}).at || "");
    if (!Number.isFinite(at)) return 1;
    return Math.min(1, Math.max(0, (at - firstAt) / spanMs));
  }

  // The inverse: a column reports the recorded change nearest that time.
  function indexAt(fraction) {
    if (!usable) return Math.round((1 - fraction) * (total - 1));
    const want = firstAt + fraction * spanMs;
    let low = 0;
    let high = timed.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (timed[mid].at < want) low = mid + 1;
      else high = mid;
    }
    const after = timed[low];
    const before = timed[Math.max(0, low - 1)];
    const pick = Math.abs(after.at - want) <= Math.abs(want - before.at) ? after : before;
    return pick.index;
  }
  if (ribbonDragging && ribbonDragging.container === container) ribbonDragging.map = indexAt;

  // Buckets over the axis: height follows the count, ink follows the recorded
  // kind that dominates the stretch.
  const bars = Math.max(1, Math.min(RIBBON_BARS_MAX, total));
  const counts = new Array(bars).fill(0);
  const kinds = new Array(bars).fill(null);
  const seats = new Array(bars).fill(null);
  const seatTally = new Map();
  const seatNewest = new Map();
  for (let index = 0; index < total; index += 1) {
    const event = events[index] || {};
    const column = Math.min(bars - 1, Math.floor(fractionOf(index) * bars));
    counts[column] += 1;
    if (!kinds[column]) kinds[column] = new Map();
    const kind = String(event.kind || "unknown");
    kinds[column].set(kind, (kinds[column].get(kind) || 0) + 1);
    if (!seats[column]) seats[column] = new Map();
    for (const id of ribbonSeats(event)) {
      seats[column].set(id, (seats[column].get(id) || 0) + 1);
      seatTally.set(id, (seatTally.get(id) || 0) + 1);
      if (!seatNewest.has(id)) seatNewest.set(id, index);
    }
  }
  let busiest = 1;
  for (const value of counts) if (value > busiest) busiest = value;
  const here = Math.min(bars - 1, Math.floor(fractionOf(position) * bars));

  // The newest recorded time drives the arrival test and the live pulse, and the
  // tempo mark reads it, so it is computed before the head is built.
  const liveMs = Date.parse((events[0] || {}).at || "");
  const live = Number.isFinite(liveMs) && (Date.now() - liveMs) < RIBBON_LIVE_MS;
  const previousSeq = ribbonLastSeq.get(container) || "";
  const newestSeq = String((events[0] || {}).seq || "");
  const arriving = Boolean(newestSeq) && Boolean(previousSeq) && newestSeq !== previousSeq;
  ribbonLastSeq.set(container, newestSeq);

  const head = document.createElement("div");
  head.className = "ribbon-head";
  if (live) head.classList.add("ribbon-live");

  const uniqueSeats = new Set([...seatTally.keys()]).size;
  const tempo = ribbonTempo(busiest, uniqueSeats, live, ribbonShellCounts());
  if (tempo) {
    const mark = document.createElement("span");
    mark.className = "ribbon-tempo";
    mark.title = tempo.title;
    mark.textContent = tempo.word;
    head.appendChild(mark);
  }
  const summary = document.createElement("span");
  summary.className = "ribbon-summary";
  const spanWord = ribbonSpan(firstAt, lastAt);
  const topKinds = ribbonKindTally(events, 3);
  const rateWord = ribbonRate(total, spanMs);
  summary.textContent = ribbonCount(total) + " recorded entries"
    + (spanWord ? " over " + spanWord : "")
    + (rateWord ? " \u00b7 " + rateWord : "")
    + (topKinds.length
      ? " \u00b7 mostly " + topKinds.map((entry) => entry[0] + " " + ribbonCount(entry[1])).join(", ")
      : "");
  head.appendChild(summary);

  const liveWord = document.createElement("span");
  liveWord.className = "ribbon-pulse";
  liveWord.setAttribute("aria-hidden", "true");
  head.appendChild(liveWord);


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

  const axis = document.createElement("div");
  axis.className = "ribbon-axis";
  for (let column = 0; column < bars; column += 1) {
    const counted = counts[column];
    const bar = document.createElement("span");
    bar.className = "ribbon-bar";
    if (!counted) {
      bar.classList.add("ribbon-empty");
    } else {
      const share = counted / busiest;
      bar.style.height = (14 + Math.round(86 * share)) + "%";
      let dominant = "unknown";
      let dominantCount = 0;
      for (const entry of kinds[column] || []) {
        if (entry[1] > dominantCount) {
          dominant = entry[0];
          dominantCount = entry[1];
        }
      }
      bar.classList.add(ribbonKindClass(dominant));
      const seatNames = [...(seats[column] || new Map()).entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
        .slice(0, 4)
        .map((entry) => entry[0]);
      bar.title = ribbonCount(counted) + (counted === 1 ? " change" : " changes")
        + " \u00b7 " + dominant
        + (seatNames.length ? " \u00b7 " + seatNames.join(", ") : "");
      const stretchKinds = [...(kinds[column] || new Map()).entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
        .slice(0, 2);
      bar.dataset.stretch = String(column);
      bar.addEventListener("pointerenter", () => {
        readout.textContent = ribbonCount(counted) + (counted === 1 ? " recorded change" : " recorded changes")
          + (stretchKinds.length
            ? " \u00b7 " + stretchKinds.map((entry) => entry[0] + " " + entry[1]).join(", ")
            : "")
          + (seatNames.length ? " \u00b7 " + seatNames.join(", ") : "");
      });
    }
    if (column === here) bar.classList.add("ribbon-here");
    if (arriving && column === bars - 1) bar.classList.add("ribbon-arrival");
    axis.appendChild(bar);
  }
  axis.addEventListener("pointerleave", () => {
    readout.textContent = readoutText();
  });

  const needle = document.createElement("span");
  needle.className = "ribbon-needle";
  needle.style.left = (fractionOf(position) * 100) + "%";
  needle.setAttribute("aria-hidden", "true");
  axis.appendChild(needle);
  slider.appendChild(axis);

  function setPosition(next) {
    if (next < 0) next = 0;
    if (next > total - 1) next = total - 1;
    if (typeof opts.onScrub === "function") opts.onScrub(next);
  }

  slider.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    ribbonDragging = { container, opts, pointerId: event.pointerId, map: indexAt };
    document.addEventListener("pointermove", ribbonMove, true);
    document.addEventListener("pointerup", ribbonEndDrag, true);
    document.addEventListener("pointercancel", ribbonEndDrag, true);
    const fraction = ribbonPositionFromClient(container, event.clientX);
    if (fraction !== null) setPosition(indexAt(fraction));
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

  const readout = document.createElement("p");
  readout.className = "ribbon-readout";
  function readoutText() {
    return ribbonEventText(current, position, total)
      + (current && current.at ? " \u00b7 " + ribbonAge(current.at) : "");
  }
  readout.textContent = readoutText();

  // The seats that moved most in this window; a chip jumps to that seat's
  // newest recorded change.
  const busiestSeats = [...seatTally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, RIBBON_CHIPS_MAX);
  const seatRow = document.createElement("div");
  seatRow.className = "ribbon-seats";
  if (busiestSeats.length) {
    const label = document.createElement("span");
    label.className = "ribbon-seats-label";
    label.textContent = "Busiest";
    seatRow.appendChild(label);
    for (const entry of busiestSeats) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ribbon-chip";
      chip.dataset.focus = "ribbon-seat:" + entry[0];
      chip.dataset.seat = entry[0];
      chip.title = entry[0] + ", " + ribbonCount(entry[1]) + " recorded entries in this window";
      const id = document.createElement("span");
      id.className = "ribbon-chip-id";
      id.textContent = ribbonShort(entry[0]);
      chip.appendChild(id);
      const value = document.createElement("span");
      value.className = "ribbon-chip-count";
      value.textContent = ribbonCount(entry[1]);
      chip.appendChild(value);
      const at = seatNewest.get(entry[0]);
      // The spine navigates: a chip opens the seat through the shell when the
      // shell passes that callback, and otherwise moves the needle to the seat's
      // newest recorded entry.
      const opensSeat = typeof opts.onSelectActor === "function";
      if (String(opts.selectedId || "") === entry[0]) chip.setAttribute("aria-current", "true");
      chip.addEventListener("click", () => {
        if (opensSeat) opts.onSelectActor(entry[0]);
        else if (typeof opts.onSelectEvent === "function") opts.onSelectEvent(at);
      });
      seatRow.appendChild(chip);
    }
  }

  const actions = document.createElement("div");
  actions.className = "ribbon-actions";
  const now = document.createElement("button");
  now.type = "button";
  now.className = "ribbon-button";
  now.dataset.focus = "ribbon-now";
  now.textContent = position === 0 ? "At the newest change" : "Back to the newest change";
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

  const legend = document.createElement("p");
  legend.className = "ribbon-legend";
  const legendKinds = ribbonKindTally(events, 6);
  legend.textContent = legendKinds.length
    ? "Bar height follows the busiest stretch; the ink is the recorded kind that dominates it: "
      + legendKinds.map((entry) => entry[0]).join(", ") + "."
    : "Bar height follows the busiest stretch.";

  container.appendChild(head);
  container.appendChild(slider);
  container.appendChild(readout);
  container.appendChild(seatRow);
  container.appendChild(actions);
  container.appendChild(legend);

  if (listOpen) {
    const list = document.createElement("ol");
    list.className = "ribbon-list";
    const start = Math.max(0, position - Math.floor(RIBBON_LIST_ROWS / 2));
    const end = Math.min(total, start + RIBBON_LIST_ROWS);
    for (let index = start; index < end; index += 1) {
      const event = events[index] || {};
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
        + " of " + ribbonCount(total) + ". Scrub the axis to read another stretch.";
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
