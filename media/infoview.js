'use strict';

(function () {
const CLASS_HIGHLIGHT = 'highlight';
const CLASS_HIGHLIGHT_SEP = 'highlight-sep';
const CLASS_MESSAGE = 'message';
const ID_DEBUG = 'debug';
const ID_GOAL = 'goal';

function debug(s) {
  // document.getElementById(ID_DEBUG).innerHTML += s + "<br>";
}

function goalHeight() {
  const goal = document.getElementById(ID_GOAL);
  if (goal === undefined) {
    return 0;
  }
  else {
    return goal.getBoundingClientRect().height;
  }
}

// TODO: implement throttling, see Markdown plugin
function scrollToRevealElement(elem) {
  debug("reveal " + elem);
  const h = goalHeight();
  debug ("goal height: " + h);
  const t = elem.getBoundingClientRect().top;
  debug("elem top " + t);
  window.scrollTo(0, t - h);
}

function parsePosition(title) {
  const c = title.lastIndexOf(":");
  const l = title.substring(0, c).lastIndexOf(":");
  return {
    filename: title.substring(0, l),
    line:     Number.parseInt(title.substring(l + 1, c)),
    column:   Number.parseInt(title.substring(c + 1, title.length))
  }
}

function onReveal(line, column) {
  debug("reveal " + line.toString() + ":" + column.toString());
  const elems   = document.getElementsByTagName("h1");
  let state     = 'before';
  for (var i = 0; i < elems.length; i++) {
    let elem = elems[i];
    let classes = elem.parentElement.classList;
    if (elem.title == "") continue;
    let pos = parsePosition(elem.title);
    debug("pos: " + elem.title + " -> " + pos.filename + ", " + pos.line + ", " + pos.column);
    if (pos.line < line || (pos.line == line && pos.column < column))
    {
      debug("before");
      // before
      classes.remove(CLASS_HIGHLIGHT);
    } else if (pos.line == line && pos.column == column) {
      debug("at");
      // at position
      if (state == 'before') {
        if (!classes.contains(CLASS_HIGHLIGHT)) {
          classes.add(CLASS_HIGHLIGHT);
          scrollToRevealElement(parent);
        }
        state = 'at';
      }
      classes.add(CLASS_HIGHLIGHT);
    } else {
      debug("after " + classes);
      // after
      classes.remove(CLASS_HIGHLIGHT);
      if (state == `before` && !classes.contains(CLASS_HIGHLIGHT_SEP)) {
        classes.add(CLASS_HIGHLIGHT_SEP);
        scrollToRevealElement(elem);
      }
      state = 'after';
    }
  }
}

function fixFirstMessageMargin() {
  debug("fix top");
  // this part fixes the margin of the message list, otherwise parts of it will be hidden below the
  // goal state
  const messages = document.getElementsByClassName(CLASS_MESSAGE);

  if (messages.length > 0) {
    const h = goalHeight();
    debug("set to " + h);
    messages[0].style.marginTop = h.toString() + "px";
    debug("updated");
  }
}

function onGoal(basename, line, column, state) {
  debug("on goal " + basename + ":" + line.toString() + ":" + column.toString());
  const goal = document.getElementById(ID_GOAL);
  if (goal === undefined) return;
  const h1 = goal.getElementsByTagName("h1")[0];
  const pre = goal.getElementsByTagName("pre")[0];
  h1.textContent = "Current Goal at " + basename + ":" + line.toString() + ":" + column.toString();
  pre.textContent = state;
  fixFirstMessageMargin();
  onReveal(line, column);
}

function onClearGoal() {
  debug("on clear-goal");
  const goal = document.getElementById(ID_GOAL);
  if (goal === undefined) return;
  const h1 = goal.getElementsByTagName("h1")[0];
  const pre = goal.getElementsByTagName("pre")[0];
  h1.textContent = "No current goal";
  pre.textContent = "";
}

window.addEventListener('message', (event => {
  if (event.data.command == 'reveal') {
    onClearGoal();
    onReveal(event.data.line, event.data.column);
  }
  else if (event.data.command == 'goal') {
    onGoal(event.data.basename, event.data.line, event.data.column, event.data.state);
  }
}), false);

function onLoad() {
  debug("loaded");
  fixFirstMessageMargin();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', onLoad);
} else {
	onLoad();
}

})()
