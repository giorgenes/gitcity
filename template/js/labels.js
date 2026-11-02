import { FOLDERS, MANY, $, PLATE } from "./model.js";
import { state } from "./state.js";
import { project } from "./camera.js";

// ---- Folder labels -----------------------------------------------------

const labelled = FOLDERS.filter((d) => MANY || d.depth > 0)
  .sort((a, b) => a.depth - b.depth || b.all.length - a.all.length)
  .slice(0, 160)
  .map((dir) => {
    const el = document.createElement("div");
    el.className = "label" + (dir.depth === 0 ? " city" :
                              dir.depth === 1 ? " top" : "");
    el.textContent = dir.name;
    el.style.display = "none";
    $("labels").append(el);
    return { dir, el, w: 0 };
  });

export function drawLabels(m) {
  const taken = [];
  for (const entry of labelled) {
    const { dir, el } = entry;
    let show = dir.first <= state.t;
    let at = null;
    if (show) {
      const top = dir.y + PLATE;
      const a = project([dir.x - dir.w / 2, top, dir.z], m);
      const b = project([dir.x + dir.w / 2, top, dir.z], m);
      at = project([dir.x, top, dir.z + dir.d / 2], m);
      const size = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      show = !!at && size > (dir.depth <= 1 ? 24 : 70);
    }
    if (show) {
      if (!entry.w) {
        el.style.display = "block";
        entry.w = el.offsetWidth;
      }
      const box = { l: at.x - entry.w / 2, r: at.x + entry.w / 2,
                    t: at.y - 9, b: at.y + 9 };
      show = !taken.some((o) => box.l < o.r && box.r > o.l &&
                                box.t < o.b && box.b > o.t);
      if (show) {
        taken.push(box);
        el.style.transform = `translate(${box.l}px,${box.t}px)`;
      }
    }
    el.style.display = show ? "block" : "none";
  }
}
