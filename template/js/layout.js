import { MIN_SLOT, GAP, PLATE, CITIES, STREET } from "./model.js";

// ---- Layout: shelf-pack each folder's contents, children first ---------

function shelf(items, width) {
  let x = 0, z = 0, row = 0, right = 0;
  const placed = [];
  for (const item of items) {
    if (x > 0 && x + item.w > width) { x = 0; z += row; row = 0; }
    placed.push({ item, x, z });
    x += item.w;
    right = Math.max(right, x);
    row = Math.max(row, item.d);
  }
  return { placed, w: right, d: z + row };
}

function tightest(items) {
  const area = items.reduce((sum, i) => sum + i.w * i.d, 0);
  const widest = Math.max(...items.map((i) => i.w));
  let best = null, bestScore = Infinity;
  for (const k of [1, 1.1, 1.2, 1.35, 1.5, 1.75, 2]) {
    const pack = shelf(items, Math.max(widest, Math.sqrt(area) * k));
    const stretch = Math.max(pack.w / pack.d, pack.d / pack.w);
    const score = pack.w * pack.d * (1 + 0.15 * (stretch - 1));
    if (score < bestScore) { bestScore = score; best = pack; }
  }
  return best;
}

function measure(dir) {
  const pad = Math.max(1, 4 - dir.depth);
  const items = dir.files.map((file) => {
    const slot = Math.max(file.side, MIN_SLOT) + GAP;
    return { file, w: slot, d: slot };
  });
  for (const child of dir.dirs.values()) {
    measure(child);
    items.push({ dir: child, w: child.w + pad, d: child.d + pad });
  }
  items.sort((a, b) => b.d - a.d || b.w - a.w);
  const best = tightest(items);
  dir.pack = best;
  dir.pad = pad;
  dir.w = best.w + pad;
  dir.d = best.d + pad;
}

function place(dir, x0, z0) {
  dir.x = x0 + dir.w / 2;
  dir.z = z0 + dir.d / 2;
  dir.y = dir.depth * PLATE;
  const top = dir.y + PLATE;
  for (const { item, x, z } of dir.pack.placed) {
    const left = x0 + dir.pad / 2 + x, near = z0 + dir.pad / 2 + z;
    if (item.file) {
      const f = item.file;
      f.x = left + item.w / 2;
      f.z = near + item.d / 2;
      f.y = top;
    } else {
      place(item.dir, left + dir.pad / 2, near + dir.pad / 2);
    }
  }
}

// Cities stand apart, separated by much more than any street inside them.
CITIES.forEach((city) => measure(city));
const WORLD = tightest(CITIES
  .map((dir) => ({ dir, w: dir.w + STREET, d: dir.d + STREET }))
  .sort((a, b) => b.d - a.d || b.w - a.w));
const WORLD_W = WORLD.w - STREET, WORLD_D = WORLD.d - STREET;
for (const { item, x, z } of WORLD.placed) {
  place(item.dir, x - WORLD_W / 2, z - WORLD_D / 2);
}
export const SPAN = Math.max(WORLD_W, WORLD_D);
