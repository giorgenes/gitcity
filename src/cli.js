import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { assignCities, dropEmptyCommits, embed } from "./cities.js";
import { readCityfile } from "./cityfile.js";
import { fail } from "./errors.js";
import { git } from "./git.js";
import { collect, fileSizes } from "./history.js";

const TEMPLATE = new URL("../template/city.html", import.meta.url);
const PLACEHOLDER = "/*__CITY_DATA__*/null";
const USAGE = `usage: gitcity [-h] [--ref REF] [-o OUTPUT] [--cityfile CITYFILE] [repo]

Render a git repository as an interactive 3D city in one HTML file

positional arguments:
  repo                  repository to draw (default: .)

options:
  -h, --help            show this help message and exit
  --ref REF             commit to draw (default: HEAD)
  -o, --output OUTPUT   output path (default: <name>-city.html)
  --cityfile CITYFILE   config file (default: <repo>/Cityfile)`;

function readArgs(argv) {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ref: { type: "string" },
        output: { type: "string", short: "o" },
        cityfile: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (positionals.length > 1) throw new Error("too many repositories");
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
  const cities = config.city?.length
    ? config.city
    : [{ name, path: "" }];

  const { commits: every, files: everyFile } = await collect(args.repo, ref);
  const placed = assignCities(everyFile, cities, config.exclude ?? []);
  const sizes = fileSizes(args.repo, ref);
  const { commits, files, denseBytes } = dropEmptyCommits(every, placed, sizes);
  if (!commits.length) {
    fail(`no commit touches a drawn file at ${ref}`);
  }
  const filled = new Set(files.map((entry) => entry[2]));
  cities.forEach((city, index) => {
    if (!filled.has(index)) fail(`city '${city.name}' has no files at ${ref}`);
  });

  const data = {
    name,
    ref,
    generated: new Date().toISOString().slice(0, 10),
    denseBytes,
    commits,
    cities: cities.map((city) => ({ name: city.name, path: city.path })),
    files,
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
    + `most commits ${busiest[0]} at ${busiest[1].length}`);
}
