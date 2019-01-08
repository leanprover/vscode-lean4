'use strict';

const infoViewModule = (function () {
const CLASS_MESSAGE = 'message';
const ID_GOAL = 'goal';
const ID_MESSAGES = 'messages';
const ID_MARKER = 'marker';

/*
const ID_DEBUG = 'debug';
function debug(s) {
  const dbg = document.getElementById(ID_DEBUG);
  dbg.innerHTML = s + "<br>" + dbg.innerHTML;
}
*/

function setMarker(parent, atTop, t) {
  const old_m = document.getElementById(ID_MARKER);
  if (old_m) old_m.remove();

  const m = document.createElement("span");
  m.setAttribute("id", ID_MARKER);
  m.innerText = t;
  if (atTop) {
    m.style.top = "0px";
  } else {
    m.style.bottom = "0px";
  }
  parent.appendChild(m);
}

function hideMarker(y, t) {
  const m = document.getElementById(ID_MARKER);
  if (!m) return;
  m.style.visibility = "hidden";
}

// TODO: implement throttling, see Markdown plugin
function revealMessageElement(elem) {
  const rel = elem.getBoundingClientRect();
  const w = window;
  const start = w.scrollY;
  const height = w.innerHeight;
  const stop = start + height;
  if (rel.top < 0 || height < rel.top) {
    // head of element is not visible
    if (height < rel.height) {
      w.scrollTo(0, w.scrollY + rel.top);
    } else {
      // center the element
      w.scrollTo(0, w.scrollY + (rel.bottom + rel.top - height) / 2);
    }
  } else if (rel.bottom > height) {
    // head is visible but bottom is not
    if (height < rel.height) {
      w.scrollTo(0, w.scrollY + rel.top);
    } else {
      // center the element
      w.scrollTo(0, w.scrollY + (rel.bottom + rel.top - height) / 2);
    }
  }
}

function getPosition(elem) {
  if (!elem.hasAttribute("data-line") || !elem.hasAttribute("data-column")) return null;
  return {
    line: Number.parseInt(elem.getAttribute("data-line")),
    column: Number.parseInt(elem.getAttribute("data-column"))
  };
}

function isEqual(p1, p2) {
  return p1.line == p2.line && p1.column == p2.column;
}

function isBefore(p1, p2) {
  return p1.line < p2.line || (p1.line == p2.line && p1.column < p2.column);
}

function onPosition(rpos) {
  const elems = document.getElementsByClassName(CLASS_MESSAGE);
  let state   = 'before';
  let reveal  = null;
  let before  = null;
  for (var i = 0; i < elems.length; i++) {
    let elem = elems[i];
    let pos = getPosition(elem);
    if (!pos) continue;
    let classes = elem.classList;
    classes.remove("marked");
    classes.remove("next-marked");

    if (isBefore(pos, rpos))
    {
      before = elem;
    } else if (isEqual(pos, rpos)) {
      classes.add("marked");
      if (state == 'before') {
        reveal = elem;
        state = 'exact';
      }
    } else {
      state = 'after';
    }
  }
  if (reveal) {
    revealMessageElement(reveal);
    setMarker(reveal, true, "⯈");
  } else if (before) {
    before.classList.add("next-marked");
    revealMessageElement(before);
    setMarker(before, false, "▹");
  } else if (elems.length > 0) {
    document.getElementById(ID_MESSAGES).scrollTop = 0;
    setMarker(elems[0], true, "▹");
  } else {
    hideMarker();
  }
}

function onPause() {
  document.getElementById("state-pause").classList.add("disabled");
  document.getElementById("state-continue").classList.remove("disabled");
}

function onContinue() {
  document.getElementById("state-pause").classList.remove("disabled");
  document.getElementById("state-continue").classList.add("disabled");
}

window.addEventListener('message', (event => {
  if (event.data.command == 'position') {
    onPosition({line: event.data.line, column: event.data.column});
    onContinue();
  } else if (event.data.command == 'pause') {
    onPause();
  } else if (event.data.command == 'continue') {
    onContinue();
  }
}), false);

function setupHover() {
  const msgs = document.getElementsByClassName("message");
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    m.addEventListener("mouseenter", event => {
      const data = [document.body.getAttribute('data-uri'),
        Number.parseInt(m.getAttribute('data-line')),
        Number.parseInt(m.getAttribute('data-column')),
        Number.parseInt(m.getAttribute('data-end-line')),
        Number.parseInt(m.getAttribute('data-end-column'))];
          vscode.postMessage({
            command: "hoverPosition",
            data: data
          });
    });
    m.addEventListener("mouseleave", event => {
      vscode.postMessage({ command: "stopHover" });
    });
  }
}

function onLoad() {
  if (document.body.hasAttribute("data-messages")) {
    onPosition(getPosition(document.body)); // current editor position is stored in body element
  }
  document.getElementById("state-continue").classList.add("disabled");
  setupHover();
  /* document.getElementById(ID_DEBUG).style.visibility = "visible"; */
}

function selectFilter(value) {
  vscode.postMessage({command: 'selectFilter', filterId: parseInt(value)});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', onLoad);
} else {
	onLoad();
}

const vscode = acquireVsCodeApi();

return ({selectFilter});
})();
