import {
  COMMITS, $, DATA, DIFF, UNCHANGED, FILES, OTHER, MANY,
} from "./model.js";
import { SPAN } from "./layout.js";
import { state, camera } from "./state.js";
import { count, COLOURED, SCALES, AREAS } from "./colour.js";
import { rebuild } from "./looks.js";

// ---- Panels ------------------------------------------------------------

export const day = (i) => new Date(COMMITS[i][1] * 1000).toISOString().slice(0, 10);
export const commitCount = (n) => n + (n === 1 ? " commit" : " commits");

export function lineText([added, deleted, modified]) {
  return added + deleted + modified
    ? `+${added} \u2212${deleted} ~${modified} lines` : "no lines changed";
}

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function lineTotals(files) {
  const total = [0, 0, 0];
  for (const f of files) {
    const n = count(f, state.t);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) total[k] += f.lines[i][k];
    }
  }
  return [["Lines added", total[0].toLocaleString()],
          ["Lines deleted", total[1].toLocaleString()],
          ["Lines modified", total[2].toLocaleString()]];
}

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function selector(item, text) {
  const b = el("button", text);
  b.addEventListener("click", () => select(item, true));
  return b;
}

export function fillBusiest(table, files) {
  table.replaceChildren();
  const ranked = files.map((f) => [f, count(f, state.t)])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [f, n] of ranked) {
    const row = table.insertRow();
    const path = row.insertCell();
    path.className = "path";
    path.append(selector(f, f.path));
    row.insertCell().append(String(n));
    row.cells[1].className = "n";
  }
}

function stats(pairs) {
  const dl = el("dl");
  dl.className = "stats";
  for (const [k, v] of pairs) dl.append(el("dt", k), el("dd", v));
  return dl;
}

export function renderDetail() {
  const box = $("detail");
  const item = state.selected;
  box.replaceChildren();
  box.style.display = item ? "block" : "none";
  if (!item) return;

  const close = el("button", "Close");
  close.id = "close";
  close.addEventListener("click", () => select(null));
  const crumbs = el("div");
  crumbs.id = "crumbs";
  const chain = [];
  for (let d = item.kind === "file" ? item.dir : item.parent; d; d = d.parent) {
    chain.unshift(d);
  }
  chain.forEach((d, i) => {
    if (i) crumbs.append(" / ");
    crumbs.append(selector(d, d.name));
  });
  box.append(close, crumbs, el("h1", item.name));

  if (item.kind === "file") {
    const n = count(item, state.t);
    const seen = item.hits.slice(0, n);
    box.append(stats([
      [`Size at ${DATA.ref}`, sizeText(item.size)],
      ...(DIFF ? [["In the diff", item.inDiff ? "yes" : "no"]] : []),
      ...(item.divider > 1 ? [["Height", `divided by ${item.divider}`]] : []),
      ["Commits", String(n)],
      ["First", n ? day(seen[0]) : "not yet"],
      ["Latest", n ? day(seen[n - 1]) : "not yet"],
      ...lineTotals([item]),
    ]));
    box.append(el("h2", "Commits, newest first"));
    for (let at = n - 1; at >= Math.max(0, n - 40); at--) {
      const i = seen[at];
      const row = el("div", COMMITS[i][2], "commit");
      row.prepend(el("small", `${day(i)}  ${COMMITS[i][0]}  ` +
                              lineText(item.lines[at])));
      box.append(row);
    }
    if (n > 40) box.append(el("div", `and ${n - 40} earlier`, "help"));
  } else {
    const live = item.all.filter((f) => count(f, state.t) > 0);
    const unique = new Set();
    let total = 0;
    for (const f of live) {
      const n = count(f, state.t);
      total += n;
      for (let i = 0; i < n; i++) unique.add(f.hits[i]);
    }
    box.append(stats([
      ["Files", live.length.toLocaleString()],
      ["Commits", unique.size.toLocaleString()],
      ["Blocks", total.toLocaleString()],
      ...lineTotals(live),
    ]));
    box.append(el("h2", "Most commits here"));
    const table = el("table");
    fillBusiest(table, item.all.filter((f) => f.inDiff));
    box.append(table);
  }
}

export function renderLegend() {
  const box = $("legend");
  box.replaceChildren();
  const add = (colour, text) => {
    const row = el("div");
    const swatch = el("span", "", "swatch");
    swatch.style.background = colour;
    row.append(swatch, text);
    box.append(row);
  };
  if (DIFF) {
    add(UNCHANGED, `earlier commits, and ${FILES.length - COLOURED.length} ` +
                   "files not in the diff");
  }
  if (state.mode === "age") {
    const ends = el("div");
    ends.className = "ends";
    ends.append(el("span", day(0)), el("span", day(state.t)));
    box.append(el("div", "", "ramp"), ends);
    return;
  }
  const list = (scale) => {
    for (const e of scale.entries) add(e.c, `${e.k} (${e.n})`);
    if (scale.rest) add(OTHER, `other ${scale.rest} (${scale.other})`);
  };
  if (state.mode !== "area") {
    list(SCALES[state.mode]);
    return;
  }
  for (const [name, scale] of AREAS) {
    if (MANY) box.append(el("h3", name));
    list(scale);
  }
}

export function renderTime() {
  const c = COMMITS[state.t];
  const live = FILES.filter((f) => count(f, state.t) > 0).length;
  $("when").textContent = `${day(state.t)}  commit ${state.t + 1}/` +
    `${COMMITS.length}  ${live} files  ${c[2]}`;
}

export function focusOn(item) {
  const size = item.kind === "file"
    ? Math.max(30, item.tops[count(item, state.t)] * 1.6)
    : Math.max(item.w, item.d) * 1.25;
  const y = item.kind === "file" ? item.y + item.tops[count(item, state.t)] / 2 : item.y;
  state.fly = { t0: camera.target.slice(), t1: [item.x, y, item.z],
          dist0: camera.dist, dist1: size };
}

export function overview() {
  state.fly = { t0: camera.target.slice(), t1: [0, 0, 0],
          dist0: camera.dist, dist1: SPAN * 1.35 };
}

export function select(item, flyThere) {
  state.selected = item;
  if (flyThere && item) focusOn(item);
  renderDetail();
  rebuild();
}

export function search(text) {
  const q = text.trim().toLowerCase();
  state.query = q;
  state.matches = q
    ? new Set(FILES.filter((f) => f.path.toLowerCase().includes(q)))
    : null;
  $("matches").textContent = q ? `${state.matches.size} matching files` : "";
  rebuild();
}
