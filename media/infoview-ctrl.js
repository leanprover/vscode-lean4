// @ts-check

'use strict';

(function () {
const CLASS_MESSAGE = 'message';
const ID_DEBUG = 'debug';
const ID_GOAL = 'goal';
const ID_MESSAGES = 'messages';
const ID_MARKER = 'marker';

function debug(s) {
  const dbg = document.getElementById(ID_DEBUG);
  dbg.innerHTML = s + "<br>" + dbg.innerHTML;
}

function setupMarker() {
  const marker = document.createElement("span");
  marker.setAttribute("id", ID_MARKER);
  document.body.appendChild(marker);
}

function setMarker(y, t) {
  const m = document.getElementById(ID_MARKER);
  if (!m) return;
  m.innerText = t;
  const r = m.getBoundingClientRect();
  let d = r ? r.height / 2 : 0;
  m.style.visibility = "visible";
  m.style.top = y.toString() - d + "px";
}

function hideMarker(y, t) {
  const m = document.getElementById(ID_MARKER);
  if (!m) return;
  m.style.visibility = "hidden";
}

// TODO: implement throttling, see Markdown plugin
function revealMessageElement(elem) {
  debug("reveal");
  const rel = elem.getBoundingClientRect();
  const w = window;
  const start = w.scrollY;
  const height = w.innerHeight;
  const stop = start + height;
  debug("st " + start + ", sp: " + stop + ", tp: " + rel.top + ", bt: " + rel.bottom);
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
    line: elem.getAttribute("data-line"),
    column: elem.getAttribute("data-column"),
  }
}

function isEqual(p1, p2) {
  return p1.line == p2.line && p1.column == p2.column;
}

function isBefore(p1, p2) {
  return p1.line < p2.line || (p1.line == p2.line && p1.column < p2.column); 
}

function onPosition(rpos) {
  debug("position " + rpos.line + ":" + rpos.column);
  const elems = document.getElementsByClassName(CLASS_MESSAGE);
  let state   = 'before';
  let reveal  = null;
  let before  = null;
  for (var i = 0; i < elems.length; i++) {
    let elem = elems[i];
    let pos = getPosition(elem);
    if (!pos) continue;
    let classes = elem.classList;

    if (isBefore(pos, rpos))
    {
      before = elem;
    } else if (isEqual(pos, rpos)) {
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
    setMarker(reveal.getBoundingClientRect().top, "⯈");
  } else if (before) {
    revealMessageElement(before);
    setMarker(before.getBoundingClientRect().bottom, "▹");
  } else if (elems.length > 0) {
    document.getElementById(ID_MESSAGES).scrollTop = 0;
    setMarker(0, "▹");
  } else {
    hideMarker();
  }
}

window.addEventListener('message', (event => {
  if (event.data.command == 'position') {
    onPosition({line: event.data.line, column: event.data.column});
  }
}), false);

function onLoad() {
  setupMarker();
  onPosition(getPosition(document.body)); // current editor position is stored in body element
  debug("body " + document.body.className);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', onLoad);
} else {
	onLoad();
}

})()
