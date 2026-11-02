import {
  DATA, $, FILES, COMMITS, DIFF, LAST, MANY, CITIES, FOLDERS,
} from "./model.js";
import { state, camera } from "./state.js";
import { COLOURED, count } from "./colour.js";
import { SLAB_COUNT } from "./renderer.js";
import { resize } from "./camera.js";
import { setTime } from "./time.js";
import {
  el, select, overview, selector, renderLegend, focusOn,
} from "./panels.js";
import { frame } from "./frame.js";
import { pick } from "./picking.js";
import "./input.js";

// ---- Start -------------------------------------------------------------

document.title = `${DATA.name} city`;
$("title").textContent = DATA.name;
$("summary").textContent =
  `${FILES.length.toLocaleString()} files, ` +
  `${COMMITS.length.toLocaleString()} commits touching them at ` +
  `${DATA.ref}, ` +
  `generated ${DATA.generated}`;
if (DIFF) {
  $("summary").textContent = `${COLOURED.length.toLocaleString()} changed ` +
    `since ${DIFF.base}, ` + $("summary").textContent;
}
$("time").max = LAST;
if (MANY) {
  $("summary").textContent = `${CITIES.length} cities, ` +
    $("summary").textContent;
  $("mode").append(new Option("City", "city"));
  const table = el("table");
  const all = el("button", "All cities");
  all.addEventListener("click", () => { select(null); overview(); });
  table.insertRow().insertCell().append(all);
  for (const city of CITIES) {
    const row = table.insertRow();
    row.insertCell().append(selector(city, city.name));
    row.insertCell().append(city.all.length.toLocaleString());
    row.cells[1].className = "n";
  }
  $("cities").append(el("h2", "Cities"), table);
}
resize();
renderLegend();
setTime(LAST);
requestAnimationFrame(frame);

// Read-only view of the model, for checking a generated page by script.
window.repoCity = { FILES, FOLDERS, state, camera, count, pick, select,
                    SLAB_COUNT, focusOn };
