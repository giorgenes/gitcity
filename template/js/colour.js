import {
  FILES, SLOTS, CITIES, UNCHANGED, LAST, COMMITS, OTHER,
} from "./model.js";
import { state } from "./state.js";

// ---- Colour ------------------------------------------------------------

export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// Hues follow the entity and are fixed at load, never by current rank.
function categories(key, files = FILES) {
  const counts = new Map();
  for (const f of files) counts.set(f[key], (counts.get(f[key]) || 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const named = ranked.length > 8 ? ranked.slice(0, 7) : ranked;
  const colour = new Map(named.map(([k], i) => [k, SLOTS[i]]));
  const rest = ranked.length - named.length;
  return { colour, rest,
    entries: named.map(([k, n], i) => ({ k, n, c: SLOTS[i] })),
    other: ranked.slice(named.length).reduce((s, [, n]) => s + n, 0) };
}
const KEYS = { area: "area", lang: "ext", city: "cityName" };
// Only coloured buildings compete for the palette.
export const COLOURED = FILES.filter((f) => f.inDiff);
export const SCALES = { lang: categories("ext", COLOURED),
                 city: categories("cityName", COLOURED) };
// Each city ranks its own folders, so every city gets the full palette.
export const AREAS = new Map(CITIES.map((city) => [city.name, categories("area",
  COLOURED.filter((f) => f.cityName === city.name))]));
const scaleFor = (file) =>
  state.mode === "area" ? AREAS.get(file.cityName) : SCALES[state.mode];
const RAMP = [[0, "#184f95"], [0.5, "#3987e5"], [1, "#cde2fb"]].map(
  ([t, c]) => [t, rgb(c)]);

function rampAt(t) {
  const i = t < 0.5 ? 0 : 1;
  const a = RAMP[i], b = RAMP[i + 1];
  const u = (t - a[0]) / (b[0] - a[0]);
  return a[1].map((v, j) => v + (b[1][j] - v) * u);
}

export function count(file, t) {
  let lo = 0, hi = file.hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (file.hits[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function hueOf(file, t) {
  if (!file.inDiff) return rgb(UNCHANGED);
  if (state.mode === "age") {
    const n = count(file, t);
    if (!n || LAST < 1) return rampAt(1);
    const span = Math.max(1, COMMITS[t][1] - COMMITS[0][1]);
    const when = COMMITS[file.hits[n - 1]][1] - COMMITS[0][1];
    return rampAt(Math.min(1, when / span));
  }
  const key = file[KEYS[state.mode]];
  return rgb(scaleFor(file).colour.get(key) || OTHER);
}

export function colourOf(file, t) {
  return hueOf(file, t).map((v) => v * file.shade);
}
