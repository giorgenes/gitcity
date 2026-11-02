import { FILES, FOLDERS, PLATE } from "./model.js";
import { state } from "./state.js";
import { count } from "./colour.js";
import { unit } from "./renderer.js";
import { basis, FOV } from "./camera.js";

// ---- Picking -----------------------------------------------------------

function rayHit(o, d, min, max) {
  let lo = 0, hi = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let a = (min[i] - o[i]) * inv, b = (max[i] - o[i]) * inv;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return null;
  }
  return lo;
}

export let pickedSlab = null;  // the block the last pick landed on, if any
export function pick(px, py) {
  const { e, f, r, u } = basis();
  const k = Math.tan(FOV / 2);
  const nx = (px / innerWidth * 2 - 1) * k * innerWidth / innerHeight;
  const ny = (1 - py / innerHeight * 2) * k;
  const d = unit([f[0] + r[0] * nx + u[0] * ny,
                  f[1] + r[1] * nx + u[1] * ny,
                  f[2] + r[2] * nx + u[2] * ny]);
  let best = null, bestT = Infinity;
  pickedSlab = null;
  for (const file of FILES) {
    const n = count(file, state.t);
    if (!n) continue;
    const h = file.side / 2;
    const around = rayHit(e, d, [file.x - h, file.y, file.z - h],
                          [file.x + h, file.y + file.tops[n], file.z + h]);
    if (around === null || around >= bestT) continue;
    for (const slab of file.slabs) {
      if (slab.hit >= n) break;
      const s = slab.side / 2;
      const t = rayHit(e, d, [file.x - s, file.y + slab.y0, file.z - s],
                       [file.x + s, file.y + slab.y1, file.z + s]);
      if (t !== null && t < bestT) {
        bestT = t;
        best = file;
        pickedSlab = slab;
      }
    }
  }
  for (const dir of FOLDERS) {
    if (dir.first > state.t) continue;
    const t = rayHit(e, d, [dir.x - dir.w / 2, dir.y, dir.z - dir.d / 2],
                     [dir.x + dir.w / 2, dir.y + PLATE, dir.z + dir.d / 2]);
    if (t !== null && t < bestT - 1e-3) {
      bestT = t;
      best = dir;
      pickedSlab = null;
    }
  }
  return best;
}
