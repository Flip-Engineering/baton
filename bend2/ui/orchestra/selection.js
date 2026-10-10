/* The rail record: one seat's state, work, messages and changes, plus the
   selected finding. Reads come from the shell; buttons request them.
   The state head sticks while the record scrolls. Dot: failed red,
   stopped attention, running green, else muted; queued messages take
   no ink. An index under the head jumps to the blocks present.
   All labels arrive through textContent. */

var SEL_EVENT_LIMIT = 8;
var selEventsOpen = false;
var selMsgOpen = new Set();
var selLast = null;

function selEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function selOwed(seat) {
  if (!seat) return 0;
  if (seat.owedTotal !== null && seat.owedTotal !== undefined && seat.owedTotal !== "") {
    return Number(seat.owedTotal) || 0;
  }
  return Math.max(Number(seat.pendingCount || 0), Number(seat.unacknowledgedCount || 0));
}

function selFacts(parent, facts, cls) {
  var dl = selEl("dl", "doc-facts" + (cls ? " " + cls : ""));
  facts.forEach(function (fact) {
    dl.appendChild(selEl("dt", null, fact[0]));
    var empty = fact[1] === "" || fact[1] === null || fact[1] === undefined;
    var cls = empty ? "unknown" : (fact[2] || null);
    var dd = selEl("dd", cls, empty ? "unknown" : fact[1]);
    dl.appendChild(dd);
  });
  parent.appendChild(dl);
}

function selEventAge(at) {
  if (window.OversightDocument && typeof window.OversightDocument.ageText === "function") {
    return window.OversightDocument.ageText(at);
  }
  return at || "";
}

function selBodyBlock(parent, heading, meta, body, cls) {
  var block = selEl("div", cls || null);
  if (heading) block.appendChild(selEl("p", null, heading));
  if (meta) block.appendChild(selEl("p", "muted", meta));
  if (typeof body === "string") block.appendChild(selEl("p", "sel-body", body));
  if (block.childNodes.length) parent.appendChild(block);
}

function selEventText(ev) {
  var parts = [selEventAge(ev.at) || ev.at || "time unrecorded"];
  if (ev.kind) parts.push(ev.kind);
  if (ev.kind === "receipt" && ev.counterpart) parts.push("message from " + ev.counterpart);
  if (ev.summary) parts.push(ev.summary);
  return parts.join(" · ");
}

function selDot(status, notProgressing) {
  if (status === "failed") return "var(--failed)";
  if (notProgressing) return "var(--attention)";
  if (status === "running") return "var(--running)";
  return "var(--muted)";
}

// Timeline tone from the recorded kind: failures red, receipts and reports
// attention, promotions and shares selection, else muted.
function selEventTone(ev) {
  var kind = String((ev && ev.kind) || "").toLowerCase();
  if (kind.indexOf("fail") !== -1) return "bad";
  if (kind === "receipt" || kind.indexOf("report") !== -1) return "note";
  if (kind.indexOf("promot") !== -1 || kind.indexOf("shar") !== -1) return "info";
  return "plain";
}

var SEL_SVG = "http://www.w3.org/2000/svg";

function selSvg(tag, attrs, text) {
  var node = document.createElementNS(SEL_SVG, tag);
  if (attrs) {
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        node.setAttribute(key, attrs[key]);
      }
    }
  }
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function selShort(id, length) {
  var text = String(id || "?");
  if (text.length <= length) return text;
  return text.slice(0, length - 1) + "…";
}

// The id's tail: the trailing part that identifies it. Short ids read
// whole; the full id travels in the title.
function selTail(id) {
  var text = String(id || "");
  if (text.length <= 14) return text;
  return "…" + text.slice(-12);
}

// A served message reference, normalized to the id the read uses.
// Unparseable references read as absent.
function selMsgRef(ref) {
  var raw = selMsgRaw(ref);
  return raw.replace(/^message:/, "");
}

function selMsgRaw(ref) {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") {
    return String(ref.id || ref.reference || ref.messageId || ref.message || "");
  }
  return "";
}

// The sharing path as a node chain. Full identities stay in titles
// and in the accessible label; the author's stop carries a ring.
function selPathChain(steps, author) {
  var stops = [];
  var stopVias = [];
  steps.forEach(function (step) {
    if (!step) return;
    var from = String(step.source || "?");
    var to = String(step.destination || "?");
    var via = String(step.promotedBy || "");
    if (!stops.length) {
      stops.push(from);
      stopVias.push("");
    } else if (stops[stops.length - 1] !== from) {
      stops.push(from);
      stopVias.push("");
    }
    stops.push(to);
    stopVias.push(via);
  });
  var capped = stops.slice(0, 10);
  var cappedVias = stopVias.slice(0, 10);
  var extra = stops.length - capped.length;
  var slot = 118;
  var pad = 56;
  var width = pad * 2 + Math.max(0, capped.length - 1) * slot;
  var svg = selSvg("svg", {
    class: "sel-chain",
    viewBox: "0 0 " + width + " 42",
    role: "img",
    "aria-label": "Sharing path: " + stops.join(", then "),
  });
  svg.appendChild(selSvg("title", null, stops.join(" → ")));
  var defs = selSvg("defs", null);
  var marker = selSvg("marker", {
    id: "sel-arrow", viewBox: "0 0 8 8", refX: "7", refY: "4",
    markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
  });
  marker.appendChild(selSvg("path", { d: "M0,0 L8,4 L0,8 Z", class: "sel-arrowhead" }));
  defs.appendChild(marker);
  svg.appendChild(defs);
  capped.forEach(function (stop, i) {
    var x = pad + i * slot;
    if (i > 0) {
      var fromX = pad + (i - 1) * slot;
      svg.appendChild(selSvg("line", {
        x1: String(fromX + 6), y1: "16", x2: String(x - 6), y2: "16",
        class: "sel-edge", "marker-end": "url(#sel-arrow)",
      }));
      var via = cappedVias[i] || "";
      if (via) {
        var edge = selSvg("text", {
          x: String((fromX + x) / 2), y: "9",
          class: "sel-via", "text-anchor": "middle",
        }, selShort(via, 16));
        edge.appendChild(selSvg("title", null, "via " + via));
        svg.appendChild(edge);
      }
    }
    var node = selSvg("g", { class: "sel-stop" });
    node.appendChild(selSvg("circle", { cx: String(x), cy: "16", r: "5", class: "sel-node" }));
    if (author && stop === String(author)) {
      node.appendChild(selSvg("circle", { cx: String(x), cy: "16", r: "8.5", class: "sel-origin" }));
    }
    var label = selSvg("text", {
      x: String(x), y: "34", class: "sel-stop-label", "text-anchor": "middle",
    }, selShort(stop, 16));
    label.appendChild(selSvg("title", null, stop));
    node.appendChild(label);
    svg.appendChild(node);
  });
  if (extra > 0) {
    svg.appendChild(selSvg("text", {
      x: String(width - 8), y: "34", class: "sel-stop-label", "text-anchor": "end",
    }, "+" + extra + " more"));
  }
  return svg;
}

function renderSelection(mount, data, options) {
  if (!mount) return;
  selLast = { mount: mount, data: data, options: options };
  var focused = mount.contains(document.activeElement)
    && document.activeElement.dataset
    ? document.activeElement.dataset.selkey || "" : "";
  mount.textContent = "";
  var input = data || {};
  var seat = input.seat || null;
  var finding = input.finding || null;
  var events = Array.isArray(input.events) ? input.events : [];
  if (!seat && !finding) {
    mount.appendChild(selEl("p", "muted", "Select a row."));
    return;
  }
  if (seat) {
    var head = selEl("div", "sel-block sel-head");
    head.appendChild(selEl("h2", "doc-section", seat.id));
    var owed = selOwed(seat);
    var state = selEl("p", "sel-state");
    var dot = selEl("span", "sel-dot");
    dot.style.background = selDot(seat.status, seat.notProgressing);
    dot.setAttribute("aria-hidden", "true");
    state.appendChild(dot);
    state.appendChild(selEl("span", "sel-status", seat.status || "unknown"));
    if (owed > 0) {
      state.appendChild(selEl("span", "sel-owed", owed + " owed"));
    }
    head.appendChild(state);
    mount.appendChild(head);
    // Jumps to the blocks present, in document order. One block needs no index.
    var secEntries = [];
    if (finding) secEntries.push(["sel-sec-finding", "Finding"]);
    if (selOwed(seat) > 0 || (seat.pending && seat.pending.length)) {
      secEntries.push(["sel-sec-awaiting", "Awaiting"]);
    }
    if (seat.work) secEntries.push(["sel-sec-work", "Work"]);
    var secHasChanges = events.some(function (ev) { return ev && ev.session === seat.id; });
    if (secHasChanges) secEntries.push(["sel-sec-changes", "Changes"]);
    if (secEntries.length > 1) {
      var secNav = selEl("nav", "sel-index");
      secNav.setAttribute("aria-label", "Record sections");
      secEntries.forEach(function (entry) {
        var secLink = selEl("a", null, entry[1]);
        secLink.setAttribute("href", "#" + entry[0]);
        // The jump scrolls without writing the address, so the shell's
        // #seat=<id> hash survives the click and the reload after it.
        secLink.addEventListener("click", function (ev) {
          ev.preventDefault();
          var secTarget = document.getElementById(entry[0]);
          if (secTarget && typeof secTarget.scrollIntoView === "function") {
            secTarget.scrollIntoView();
          }
        });
        secNav.appendChild(secLink);
      });
      mount.appendChild(secNav);
    }
    var seatBlock = selEl("div", "sel-block");
    var failure = seat.failure || null;
    if (failure) {
      selBodyBlock(seatBlock,
        "Failure: " + (failure.cause || "recorded"),
        [failure.errorStatus, failure.stopReason, failure.eventType]
          .filter(Boolean).join(" · "),
        typeof failure.errorMessage === "string" && failure.errorMessage
          ? failure.errorMessage : undefined,
        "sel-warning");
    }
    selFacts(seatBlock, [
      ["role", seat.role],
      ["model", seat.model],
      ["parent", seat.parent],
      ["task", seat.taskTitle],
      ["action", seat.action],
    ], "sel-ref");
    mount.appendChild(seatBlock);
  }
  if (finding) {
    var findingBlock = selEl("div", "sel-block");
    findingBlock.id = "sel-sec-finding";
    findingBlock.appendChild(selEl("h2", "doc-section", "Finding " + (finding.id || "")));
    var facts = [];
    if (finding.kind) facts.push(["kind", finding.kind]);
    facts.push(["claim", finding.claim, "sel-claim"]);
    var evObj = finding.evidenceMessage && typeof finding.evidenceMessage === "object"
      ? finding.evidenceMessage : null;
    var evMid = evObj ? selMsgRef(evObj.id || "") : selMsgRef(finding.evidenceMessage);
    var evInline = Boolean(evObj && typeof evObj.body === "string");
    if (!evMid) facts.push(["evidence", finding.evidence]);
    facts.push(["limits", finding.limits]);
    facts.push(["author", finding.author]);
    selFacts(findingBlock, facts);
    if (evMid) {
      var evRaw = selMsgRaw(finding.evidenceMessage);
      var evOpen = selMsgOpen.has(evMid);
      var evRead = (input.messages || {})[evMid] || null;
      var evMessage = evRead && evRead.state === "ok" ? evRead.message : null;
      var evButton = selEl("button", "sel-msg");
      var evMark = selEl("span", "sel-kind");
      evMark.setAttribute("aria-hidden", "true");
      evButton.appendChild(evMark);
      evButton.appendChild(document.createTextNode(
        (evOpen ? "Hide evidence " : "Read evidence ") + selTail(evMid)));
      evButton.type = "button";
      evButton.dataset.selkey = "sel:evmsg:" + evMid;
      evButton.setAttribute("title", evRaw);
      evButton.setAttribute("aria-label",
        (evOpen ? "Hide evidence " : "Read evidence ") + evRaw);
      evButton.setAttribute("aria-expanded", String(evOpen));
      evButton.addEventListener("click", function () {
        if (selMsgOpen.has(evMid)) {
          selMsgOpen.delete(evMid);
        } else {
          selMsgOpen.add(evMid);
        }
        renderSelection(selLast.mount, selLast.data, selLast.options);
        if (!evInline && selMsgOpen.has(evMid) && (!evRead || evRead.state !== "ok")
          && options && typeof options.onReadMessage === "function") {
          options.onReadMessage(evMid);
        }
      });
      findingBlock.appendChild(evButton);
      if (evOpen) {
        if (evInline) {
          var evMeta = [];
          if (evObj.sender) evMeta.push("from " + evObj.sender);
          if (evObj.recipient) evMeta.push("to " + evObj.recipient);
          if (evMeta.length) {
            findingBlock.appendChild(selEl("p", "muted", evMeta.join(" · ")));
          }
          findingBlock.appendChild(selEl("p", "sel-body", evObj.body));
          if (evObj.body === "") {
            findingBlock.appendChild(selEl("p", "muted", "Stored body is empty."));
          }
        } else if (evMessage && typeof evMessage.body === "string") {
          findingBlock.appendChild(selEl("p", "sel-body", evMessage.body));
          if (evMessage.body === "") {
            findingBlock.appendChild(selEl("p", "muted", "Stored body is empty."));
          }
        } else if (evRead && evRead.state === "reading") {
          findingBlock.appendChild(selEl("p", "muted", "Reading message…"));
        } else {
          findingBlock.appendChild(selEl("p", "muted", "The cited message is not held."));
        }
      }
    }
    var steps = Array.isArray(finding.promotions) ? finding.promotions : [];
    if (steps.length) {
      findingBlock.appendChild(selEl("p", null, "Sharing path"));
      findingBlock.appendChild(selPathChain(steps, finding.author));
    }
    var relations = Array.isArray(finding.relations) ? finding.relations : [];
    if (relations.length) {
      findingBlock.appendChild(selEl("p", null, "Relations"));
      var rels = selEl("ul", null);
      relations.forEach(function (rel) {
        if (!rel) return;
        if (typeof rel === "string") {
          rels.appendChild(selEl("li", null, rel));
          return;
        }
        rels.appendChild(selEl("li", null,
          (rel.source || "?") + " — " + (rel.relation || "?") + " → " + (rel.target || "?")));
      });
      findingBlock.appendChild(rels);
    }
    mount.appendChild(findingBlock);
  }
  var stubs = seat && Array.isArray(seat.pending) ? seat.pending : [];
  var messages = input.messages || {};
  var pendingTotal = selOwed(seat);
  if (pendingTotal > 0 || stubs.length) {
    var waiting = selEl("div", "sel-block");
    waiting.id = "sel-sec-awaiting";
    waiting.appendChild(selEl("h2", "doc-section", "Awaiting " + pendingTotal));
    if (stubs.length < pendingTotal) {
      waiting.appendChild(selEl("p", "muted", "Showing " + stubs.length
        + " of " + pendingTotal + "."));
    }
    var groups = [];
    var groupAt = {};
    stubs.forEach(function (stub) {
      if (!stub || !stub.id) return;
      var kind = stub.kind || "message";
      if (!Object.prototype.hasOwnProperty.call(groupAt, kind)) {
        groupAt[kind] = groups.length;
        groups.push({ kind: kind, items: [] });
      }
      groups[groupAt[kind]].items.push(stub);
    });
    groups.forEach(function (group) {
      if (groups.length > 1) {
        waiting.appendChild(selEl("p", "sel-group",
          group.kind + " · " + group.items.length));
      }
      group.items.forEach(function (stub) {
      var mid = stub.id;
      var read = messages[mid] || null;
      var message = read && read.state === "ok" ? read.message : null;
      var kindWord = stub.kind || "message";
      var senderBit = message && message.sender ? " from " + message.sender : "";
      var open = selMsgOpen.has(mid);
      var button = selEl("button", "sel-msg");
      var mark = selEl("span", "sel-kind");
      mark.setAttribute("aria-hidden", "true");
      button.appendChild(mark);
      button.appendChild(document.createTextNode(
        (open ? "Hide " : "Read ") + kindWord + " " + selTail(mid) + senderBit));
      button.type = "button";
      button.dataset.selkey = "sel:msg:" + mid;
      button.setAttribute("title", kindWord + " " + mid);
      button.setAttribute("aria-label", (open ? "Hide " : "Read ")
        + (stub.kind ? stub.kind + " " : "") + mid + senderBit);
      button.setAttribute("aria-expanded", String(open));
      button.addEventListener("click", function () {
        if (selMsgOpen.has(mid)) {
          selMsgOpen.delete(mid);
        } else {
          selMsgOpen.add(mid);
        }
        renderSelection(selLast.mount, selLast.data, selLast.options);
        if (selMsgOpen.has(mid) && (!read || read.state !== "ok")
          && options && typeof options.onReadMessage === "function") {
          options.onReadMessage(mid);
        }
      });
      waiting.appendChild(button);
      if (!open) return;
      if (message && typeof message.body === "string") {
        waiting.appendChild(selEl("p", "sel-body", message.body));
        if (message.body === "") waiting.appendChild(selEl("p", "muted", "Stored body is empty."));
      } else {
        var status = read ? read.state : "unwired";
        var labels = {
          reading: "Reading message…",
          missing: "Message is not present in the store.",
          refused: "Message read refused.",
          unreadable: "Message read was invalid.",
          error: "Message read failed.",
          unwired: "Message reads require a live endpoint.",
        };
        var cause = read && (read.reason || read.status);
        waiting.appendChild(selEl("p", "muted", (labels[status] || "Message body unavailable.")
          + (cause ? " " + cause : "")));
      }
      });
    });
    mount.appendChild(waiting);
  }
  if (seat && seat.work) {
    var w = seat.work;
    var work = selEl("div", "sel-block");
    work.id = "sel-sec-work";
    work.appendChild(selEl("h2", "doc-section", "Work"));
    if (w.refused) {
      work.appendChild(selEl("p", "muted",
        "Work for this actor is outside the bound reader's scope."));
    } else if (w.error) {
      work.appendChild(selEl("p", "muted", "Work unavailable: " + w.error));
    } else {
      if (w.task) {
        selBodyBlock(work, w.task.title ? "Task: " + w.task.title : "Task",
          w.task.status || "", w.task.description || "");
      }
      if (w.input) {
        selBodyBlock(work, "Exact current input",
          [w.input.kind, w.input.sender ? "from " + w.input.sender : "", w.input.id]
            .filter(Boolean).join(" · "),
          w.input.body || "");
      }
      if (w.request) {
        selBodyBlock(work, "Open request",
          [w.request.method, w.request.event, w.request.id].filter(Boolean).join(" · "),
          w.request.reply || "");
      }
      if (w.report) {
        selBodyBlock(work, "Latest report",
          [w.report.recipient ? "to " + w.report.recipient : "", w.report.id]
            .filter(Boolean).join(" · "),
          w.report.body || "");
      }
    }
    mount.appendChild(work);
  }
  if (seat) {
    var mine = events.filter(function (ev) {
      return ev && ev.session === seat.id;
    });
    if (mine.length) {
      var eventsBlock = selEl("div", "sel-block");
      eventsBlock.id = "sel-sec-changes";
      eventsBlock.appendChild(selEl("h2", "doc-section", "Changes"));
      var ul = selEl("ul", "sel-timeline");
      var listed = selEventsOpen ? mine : mine.slice(0, SEL_EVENT_LIMIT);
      listed.forEach(function (ev) {
        var row = selEl("li", "mono", selEventText(ev));
        row.dataset.tone = selEventTone(ev);
        ul.appendChild(row);
      });
      eventsBlock.appendChild(ul);
      if (selEventsOpen || listed.length < mine.length) {
        var more = selEl("button", null,
          selEventsOpen ? "Show fewer" : "Show all " + mine.length + " changes");
        more.type = "button";
        more.dataset.selkey = "sel:events";
        more.addEventListener("click", function () {
          selEventsOpen = !selEventsOpen;
          renderSelection(selLast.mount, selLast.data, selLast.options);
        });
        eventsBlock.appendChild(more);
      }
      mount.appendChild(eventsBlock);
    } else {
      var none = selEl("div", "sel-block");
      none.appendChild(selEl("h2", "doc-section", "Changes"));
      none.appendChild(selEl("p", "muted", "No recorded changes."));
      mount.appendChild(none);
    }
  }
  if (focused) {
    var next = mount.querySelector("[data-selkey=\"" + CSS.escape(focused) + "\"]");
    if (next && typeof next.focus === "function") next.focus();
  }
}

window.renderSelection = renderSelection;
