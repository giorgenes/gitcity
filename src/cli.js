import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { assignCities, BYTE_HEIGHT, dropEmptyCommits, embed } from "./cities.js";
import { checkMaxHeight, readCityfile } from "./cityfile.js";
import { fail } from "./errors.js";
import { git } from "./git.js";
import { changedFiles, snapshotWorkingTree } from "./diff.js";
import { collect, fileSizes } from "./history.js";

const TEMPLATE = new URL("../template/city.html", import.meta.url);
const PLACEHOLDER = "/*__CITY_DATA__*/null";
const DEFAULT_MAX_HEIGHT = 100;
const USAGE = `usage: gitcity [-h] [--ref REF] [-o OUTPUT] [--cityfile CITYFILE]
              [--max-height UNITS] [--diff BASE | --diff-local] [repo]

Render a git repository as an interactive 3D city in one HTML file

positional arguments:
  repo                  repository to draw (default: .)

options:
  -h, --help            show this help message and exit
  --ref REF             commit to draw (default: HEAD)
  -o, --output OUTPUT   output path (default: <name>-city.html)
  --cityfile CITYFILE   config file (default: <repo>/Cityfile)
  --max-height UNITS    tallest building, at 800 bytes per unit (default: ${DEFAULT_MAX_HEIGHT})
  --diff BASE           colour only the files changed since REF split from BASE
  --diff-local          draw the working tree, colouring only uncommitted changes`;

function readArgs(argv) {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ref: { type: "string" },
        output: { type: "string", short: "o" },
        cityfile: { type: "string" },
        "max-height": { type: "string" },
        diff: { type: "string" },
        "diff-local": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (positionals.length > 1) throw new Error("too many repositories");
    if (values["diff-local"] && values.diff !== undefined) {
      throw new Error("--diff and --diff-local cannot be combined");
    }
    if (values["diff-local"] && values.ref !== undefined) {
      throw new Error("--diff-local always draws the working tree, not --ref");
    }
    return { ...values, repo: positionals[0] ?? "." };
  } catch (error) {
    console.error(`${USAGE}\ngitcity: ${error.message}`);
    process.exit(2);
  }
}

/** Write the city for the repository named on the command line. */
export async function main(argv) {
  const args = readArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const top = git(args.repo, ["rev-parse", "--show-toplevel"]).trim();
  const config = readCityfile(args.cityfile ?? join(top, "Cityfile"), {
    required: args.cityfile !== undefined,
  });
  const name = config.name || basename(top);
  const ref = args.ref ?? (config.ref || "HEAD");
  const output = args.output ?? (config.output || `${name}-city.html`);
  const maxHeight = args["max-height"] === undefined
    ? config.max_height ?? DEFAULT_MAX_HEIGHT
    : checkMaxHeight(Number(args["max-height"]), "--max-height");
  const cities = config.city?.length
    ? config.city
    : [{ name, path: "" }];

  const settings = { name, ref, output, maxHeight, cities, exclude: config.exclude ?? [] };
  if (!args["diff-local"]) {
    await render(args.repo, settings, args.diff === undefined ? null : {
      base: args.diff,
      changed: changedFiles(top, `${args.diff}...${ref}`),
    });
    return;
  }
  const snapshot = snapshotWorkingTree(top);
  try {
    await render(args.repo, { ...settings, ref: snapshot.commit, label: "working tree" }, {
      base: "HEAD",
      changed: changedFiles(top, `HEAD..${snapshot.commit}`),
    });
  } finally {
    snapshot.remove();
  }
}

/** Build the page; `diff` names the changed paths, or is null outside diff mode. */
async function render(repo, { name, ref, label = ref, output, maxHeight, cities, exclude }, diff) {
  const { commits: every, files: everyFile } = await collect(repo, ref);
  const placed = assignCities(everyFile, cities, exclude);
  const sizes = fileSizes(repo, ref);
  const { commits, files } = dropEmptyCommits(every, placed, sizes, maxHeight);
  if (!commits.length) {
    fail(`no commit touches a drawn file at ${label}`);
  }
  const filled = new Set(files.map((entry) => entry[2]));
  cities.forEach((city, index) => {
    if (!filled.has(index)) fail(`city '${city.name}' has no files at ${label}`);
  });

  const changed = diff && files.flatMap(
    ([path], index) => (diff.changed.has(path) ? [index] : []),
  );
  if (diff && !changed.length) fail(`no drawn file differs from ${diff.base} at ${label}`);

  const data = {
    name,
    ref: label,
    generated: new Date().toISOString().slice(0, 10),
    byteHeight: BYTE_HEIGHT,
    maxHeight,
    commits,
    cities: cities.map((city) => ({ name: city.name, path: city.path })),
    files,
    diff: diff && { base: diff.base, changed },
  };
  const page = readFileSync(TEMPLATE, "utf8");
  if (!page.includes(PLACEHOLDER)) fail("the template has no data placeholder");
  // A replacer function, because the data may hold `$&` and the like.
  writeFileSync(output, page.replaceAll(PLACEHOLDER, () => embed(data)));

  const busiest = files.reduce(
    (best, entry) => (entry[1].length > best[1].length ? entry : best),
  );
  console.log(`${output}: cities ${cities.length}, ${files.length} files, `
    + `${commits.length} commits touching them, `
    + `most commits ${busiest[0]} at ${busiest[1].length}`
    + (diff ? `, ${changed.length} in the diff from ${diff.base}` : ""));
}
