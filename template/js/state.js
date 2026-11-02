import { LAST } from "./model.js";
import { SPAN } from "./layout.js";

// ---- State -------------------------------------------------------------

export const state = { t: LAST, mode: "area", query: "", selected: null,
                hovered: null, matches: null, playing: false,
                fly: null, dirty: true };
export const camera = { target: [0, 0, 0], theta: 0.78, phi: 0.92,
                 dist: SPAN * 1.35 };
