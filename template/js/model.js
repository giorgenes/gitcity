export const DATA = JSON.parse(document.getElementById("city-data").textContent);
export const $ = (id) => document.getElementById(id);

// ---- Model -------------------------------------------------------------

const BLOCK_SIDE = 0.5;   // side of the block for a one-line commit
const BLOCK_RATIO = 0.75; // every block's height, as a share of its side
export const MIN_SLOT = 1.2;  // narrowest footprint a building is given
export const GAP = 1;         // space between neighbouring buildings
const COMMIT_GAP = 0.12;  // space above each block
const BYTES_PER_LINE = 40;  // a typical line of source
const BYTE_HEIGHT = DATA.byteHeight;  // building height per byte
const MIN_HEIGHT = 0.1;    // height of a very small or empty file
const MAX_HEIGHT = DATA.maxHeight;  // no building stands taller
const TAG_HEIGHT = 1.2;    // least height of a divided file: two rows of its tag
export const TAG_W = 1.2, TAG_H = 0.6;  // one repeat of the tag, in world units
// For each divider, its tag layer's letter and its colour's brightness.
const DIVISIONS = new Map([[10, { word: "d", shade: 0.7 }],
                           [100, { word: "c", shade: 0.48 }],
                           [1000, { word: "k", shade: 0.3 }]]);
export const TAGS = [...DIVISIONS.values()].map(({ word }) => word);
export const BOX = 0, PYRAMID = 1, PRISM = 2, CYLINDER = 3, ICOSAHEDRON = 4;
export const PLATE = 0.6;     // thickness of one block level
export const STREET = 48;     // space between neighbouring cities
export const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500",
               "#d55181", "#008300", "#9085e9", "#e66767"];
export const DIFF = DATA.diff;  // null unless the page shows a diff
const IN_DIFF = new Set(DIFF?.changed);
export const UNCHANGED = "#5f5f5f";  // every building outside the diff
// Beside gray buildings, the usual gray would pass for "not in the diff".
export const OTHER = DIFF ? "#f2e8cf" : "#898781";
export const COMMITS = DATA.commits;
export const LAST = COMMITS.length - 1;

export const CITIES = DATA.cities.map((city) => ({
  name: city.name, path: city.path, depth: 0, parent: null,
  dirs: new Map(), files: [] }));
export const MANY = CITIES.length > 1;
// Which kinds of line a commit has chooses its shape. A modified line is both
// a delete and an addition, so any other mix of kinds is a hexagonal prism.
function shapeOf(added, deleted, modified) {
  if (added && deleted && modified) return ICOSAHEDRON;
  if (added && !deleted && !modified) return BOX;
  if (deleted && !added && !modified) return PYRAMID;
  if (modified && !added && !deleted) return CYLINDER;
  return PRISM;
}

// One commit on one file is one block, starting at height y. Its size follows
// the commit's total lines, in fixed proportions, so it grows by the cube root.
// These are unscaled heights: the stack is then fitted to the file's size.
function blockOf(hit, lines, y) {
  const [added, deleted, modified] = lines;
  const total = added + deleted + modified;
  const side = Math.cbrt(Math.max(total, 1)) * BLOCK_SIDE;
  const top = y + side * BLOCK_RATIO;
  const slab = total
    ? { hit, shape: shapeOf(added, deleted, modified), plain: 0, y0: y,
        y1: top, side }
    : { hit, shape: BOX, plain: 1, y0: y, y1: top, side: side / 2 };
  return { top, slabs: [slab] };
}

export const FILES = DATA.files.map(([path, hits, cityIndex, lines, size, divider], fileIndex) => {
  const city = CITIES[cityIndex];
  const parts = (city.path ? path.slice(city.path.length + 1) : path)
    .split("/");
  let dir = city;
  for (const part of parts.slice(0, -1)) {
    if (!dir.dirs.has(part)) {
      dir.dirs.set(part, { name: part, depth: dir.depth + 1, parent: dir,
        path: dir.path ? dir.path + "/" + part : part,
        dirs: new Map(), files: [] });
    }
    dir = dir.dirs.get(part);
  }
  const name = parts[parts.length - 1];
  const dot = name.lastIndexOf(".");
  const area = parts.length > 1
    ? (city.path ? city.path + "/" : "") + parts[0]
    : (MANY ? city.name + " (root)" : "(root)");
  // tops[n] is the building's height once n commits have landed.
  const tops = [0];
  const slabs = hits.flatMap((hit, i) => {
    const block = blockOf(i, lines[i], tops[i]);
    tops.push(block.top + COMMIT_GAP);
    return block.slabs;
  });
  // The whole stack, gaps included, is scaled so that its top stands at the
  // height the file's size gives it. No top gap: the last block ends there.
  const stacked = tops[hits.length] - COMMIT_GAP;
  const division = DIVISIONS.get(divider);
  const height = Math.min(MAX_HEIGHT, Math.max(size * BYTE_HEIGHT / divider,
    division ? TAG_HEIGHT : MIN_HEIGHT));
  const fit = height / stacked;
  if (hits.length) {
    tops.forEach((top, i) => { tops[i] = top * fit; });
    for (const slab of slabs) {
      slab.y0 *= fit;
      slab.y1 *= fit;
    }
  }
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "(none)";
  if (division) {
    // Wide enough to read the tag, and in colour: a binary commit has no lines.
    for (const slab of slabs) {
      slab.side = Math.max(slab.side, MIN_SLOT);
      slab.plain = 0;
    }
  }
  // With no line counts, block sizes say nothing, and a file of any size would
  // be a pole. Stand it as wide as a one-commit text file of the same height.
  if (size && lines.every(([a, d, m]) => !(a + d + m))) {
    const wide = Math.cbrt(height / (BYTE_HEIGHT * BYTES_PER_LINE)) * BLOCK_SIDE;
    for (const slab of slabs) slab.side = Math.max(slab.side, wide);
  }
  const side = Math.max(0, ...slabs.map((slab) => slab.side));
  const file = { kind: "file", path, name, dir, hits, lines, size, slabs, tops,
    side, area, divider, shade: division?.shade ?? 1,
    tag: division ? TAGS.indexOf(division.word) : -1,
    cityName: city.name, ext, inDiff: !DIFF || IN_DIFF.has(fileIndex) };
  dir.files.push(file);
  return file;
});

export const FOLDERS = [];
function index(dir) {
  dir.kind = "folder";
  FOLDERS.push(dir);
  dir.all = dir.files.slice();
  dir.first = Math.min(Infinity, ...dir.files.map((f) => f.hits[0] ?? 0));
  for (const child of dir.dirs.values()) {
    index(child);
    dir.all.push(...child.all);
    dir.first = Math.min(dir.first, child.first);
  }
}
CITIES.forEach((city) => index(city));
