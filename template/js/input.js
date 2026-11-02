import { $, COMMITS, MANY, LAST } from "./model.js";
import { SPAN } from "./layout.js";
import { state, camera } from "./state.js";
import { count } from "./colour.js";
import { canvas, unit } from "./renderer.js";
import { rebuild } from "./looks.js";
import { basis, FOV } from "./camera.js";
import { setPlaying, setTime } from "./time.js";
import {
  select, el, day, lineText, commitCount, search, renderLegend, overview,
} from "./panels.js";
import { pick, pickedSlab } from "./picking.js";

// ---- Input -------------------------------------------------------------

let drag = null;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("dragging");
  drag = { x: e.clientX, y: e.clientY, moved: 0,
           pan: e.button === 2 || e.shiftKey };
  state.fly = null;
});
canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan) {
      const { r } = basis();
      const flat = unit([r[2], 0, -r[0]]);
      const s = camera.dist * 2 * Math.tan(FOV / 2) / innerHeight;
      camera.target = camera.target.map((v, i) =>
        v - r[i] * dx * s + flat[i] * dy * s);
    } else {
      camera.theta -= dx * 0.005;
      camera.phi = Math.min(1.5, Math.max(0.05, camera.phi - dy * 0.005));
    }
    $("tip").style.display = "none";
    state.dirty = true;
    return;
  }
  hover(e.clientX, e.clientY);
});
canvas.addEventListener("pointerup", (e) => {
  canvas.classList.remove("dragging");
  const clicked = drag && drag.moved < 5;
  drag = null;
  if (clicked) select(pick(e.clientX, e.clientY));
});
canvas.addEventListener("pointerleave", () => {
  $("tip").style.display = "none";
  if (state.hovered) { state.hovered = null; rebuild(); }
});
canvas.addEventListener("dblclick", (e) => {
  const item = pick(e.clientX, e.clientY);
  if (item) select(item, true);
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  state.fly = null;
  const k = Math.exp(e.deltaY * 0.0012);
  camera.dist = Math.min(SPAN * 4, Math.max(8, camera.dist * k));
  state.dirty = true;
}, { passive: false });

function hover(x, y) {
  const item = pick(x, y);
  if (item !== state.hovered) {
    state.hovered = item;
    rebuild();
  }
  const tip = $("tip");
  if (!item) { tip.style.display = "none"; return; }
  tip.replaceChildren();
  if (item.kind === "file") {
    const n = count(item, state.t);
    tip.append(el("b", item.path));
    if (pickedSlab) {
      const commit = COMMITS[item.hits[pickedSlab.hit]];
      tip.append(el("div", `${day(item.hits[pickedSlab.hit])}  ${commit[0]}  ` +
                           lineText(item.lines[pickedSlab.hit])),
                 el("span", commit[2]));
    } else {
      tip.append(el("span", `${commitCount(n)}, latest ${day(item.hits[n - 1])}`));
    }
  } else {
    const live = item.all.filter((f) => count(f, state.t) > 0).length;
    tip.append(el("b", item.depth === 0 && (MANY || !item.path)
                    ? item.name : item.path + "/"),
               el("span", `${live} files`));
  }
  tip.style.display = "block";
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, x + 14) + "px";
  tip.style.top = Math.min(innerHeight - h - 8, y + 14) + "px";
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("search").value = "";
    search("");
    select(null);
  }
});
$("search").addEventListener("input", (e) => search(e.target.value));
$("mode").addEventListener("change", (e) => {
  state.mode = e.target.value;
  renderLegend();
  rebuild();
});
$("time").addEventListener("input", (e) => {
  setPlaying(false);
  setTime(Number(e.target.value));
});
$("play").addEventListener("click", () => {
  if (!state.playing && state.t >= LAST) {
    // The early city is a few files: a close-up would show empty ground.
    select(null);
    overview();
    setTime(0);
  }
  setPlaying(!state.playing);
});
