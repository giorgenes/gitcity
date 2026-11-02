import { FOLDERS, FILES } from "./model.js";
import { state } from "./state.js";
import { colourOf } from "./colour.js";
import { looks, gl, ITEMS_W, ITEMS_H } from "./renderer.js";

// ---- Item looks --------------------------------------------------------

function inFocus(file) {
  if (state.matches && !state.matches.has(file)) return false;
  const sel = state.selected;
  if (sel && sel.kind === "folder") {
    for (let d = file.dir; d; d = d.parent) if (d === sel) return true;
    return false;
  }
  return true;
}

function emphasis(file) {
  if (file === state.selected || file === state.hovered) return 2;
  return inFocus(file) ? 1 : 0;
}

function setLook(item, c, emphasised) {
  looks.set([c[0] * 255, c[1] * 255, c[2] * 255, emphasised * 127.5], item * 4);
}

export function rebuild() {
  FOLDERS.forEach((dir, item) => {
    const shade = 0.17 + 0.035 * Math.min(dir.depth, 6);
    const bright = dir === state.hovered ? 0.1 : 0;
    setLook(item, [shade + bright, shade + bright, shade * 0.97 + bright], 1);
  });
  FILES.forEach((file, i) => {
    setLook(FOLDERS.length + i, colourOf(file, state.t), emphasis(file));
  });
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ITEMS_W, ITEMS_H, gl.RGBA,
                   gl.UNSIGNED_BYTE, looks);
  state.dirty = true;
}
