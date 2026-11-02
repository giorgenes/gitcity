import { $, COMMITS, LAST } from "./model.js";
import { state } from "./state.js";
import { COLOURED } from "./colour.js";
import { rebuild } from "./looks.js";
import {
  renderTime, renderDetail, renderLegend, fillBusiest,
} from "./panels.js";

// ---- Time --------------------------------------------------------------

export function setTime(t) {
  state.t = t;
  $("time").value = t;
  renderTime();
  rebuild();
  renderDetail();
  if (state.mode === "age") renderLegend();
  fillBusiest($("busiest"), COLOURED);
}

let playAnchor = null;
export function stepPlayback(now) {
  // A full replay takes about 25 seconds, whatever the repository's size.
  if (playAnchor === null) playAnchor = { now, t: state.t };
  const t = Math.floor(playAnchor.t +
    (now - playAnchor.now) / 25000 * COMMITS.length);
  if (t >= LAST) {
    setPlaying(false);
    setTime(LAST);
  } else if (t !== state.t) {
    setTime(t);
  }
}

export function setPlaying(on) {
  state.playing = on;
  playAnchor = null;
  $("play").textContent = on ? "Pause" : "Play";
}
