import { parse, TomlError } from "smol-toml";
import { tomlMessage, warn } from "./errors.js";
import { git, gitLines } from "./git.js";

const FIELD = "\x02";
const RECORD = "\x01";
const LOG_FORMAT = `${RECORD}%h${FIELD}%at${FIELD}%cs${FIELD}%s`;
const MARKS_DIR = "bin/hotspot-marks/";
const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const RECORD_COUNT = /([\s\S]*?)\0(\d+)\n/g;

const BYTE_RECORD = 0x01;
const BYTE_COLON = 0x3a;
const BYTE_D = 0x64;
const BYTE_AT = 0x40;

/** Order strings by code point, which UTF-16 code units do not. */
export function byCodePoint(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** Split one hunk's line counts into [added, deleted, modified]. */
export function hunkLines(deleted, added) {
  const modified = Math.min(deleted, added);
  return [added - modified, deleted - modified, modified];
}

/**
 * Yield {short, stamp, day, subject, changes}, newest commit first.
 *
 * A change is {fields: [status, ...paths], counts: [added, deleted, modified]}.
 * Raw lines and diff sections come in the same order, so the nth `diff --git`
 * belongs to the nth raw line. Diff content always starts with one of `+-\`,
 * so it cannot be mistaken for any line matched here.
 */
export async function* parseLog(lines) {
  let commit = null;
  let section = -1;
  for await (const line of lines) {
    const first = line[0];
    if (first === BYTE_RECORD) {
      if (commit) yield commit;
      const header = line.subarray(1).toString().replace(/\n+$/, "");
      const [short, stamp, day, ...subject] = header.split(FIELD);
      commit = {
        short,
        stamp: Number(stamp),
        day,
        subject: subject.join(FIELD),
        changes: [],
      };
      section = -1;
    } else if (first === BYTE_COLON) {
      const fields = line.toString().replace(/\n+$/, "").split("\t");
      const status = fields[0].trim().split(/\s+/).at(-1);
      commit.changes.push({
        fields: [status, ...fields.slice(1)],
        counts: [0, 0, 0],
      });
    } else if (first === BYTE_D) {
      if (line.toString("latin1", 0, 11) === "diff --git ") section += 1;
    } else if (first === BYTE_AT && line.toString("latin1", 0, 4) === "@@ -") {
      const found = HUNK.exec(line.toString("latin1", 0, 80));
      const deleted = found[1] === undefined ? 1 : Number(found[1]);
      const added = found[2] === undefined ? 1 : Number(found[2]);
      const { counts } = commit.changes.at(section);
      hunkLines(deleted, added).forEach((value, at) => {
        counts[at] += value;
      });
    }
  }
  if (commit) yield commit;
}

/**
 * Map one commit's changes onto the files alive at the tip.
 *
 * Walking newest to oldest, `aliases` holds each older path a live file was
 * renamed from. Returns each touched live path's line counts.
 */
export function touchedFiles(changes, live, aliases) {
  const touched = new Map();
  for (const { fields, counts } of changes) {
    const path = fields.at(-1);
    const current = aliases.get(path) ?? path;
    if (live.has(current)) {
      if (!touched.has(current)) touched.set(current, [0, 0, 0]);
      const total = touched.get(current);
      counts.forEach((value, at) => {
        total[at] += value;
      });
    }
    if (fields[0].startsWith("R")) {
      aliases.delete(path);
      const old = fields[1];
      if (live.has(current) && !live.has(old)) aliases.set(old, current);
    }
  }
  return touched;
}

/** A mark's date as text, whichever TOML type it was written in. */
function dateText(value) {
  if (value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Map each mark file at `ref` to the {path, date} it holds. */
function readMarks(repo, ref) {
  const listing = git(repo, [
    "ls-tree", "-z", "--full-tree", "--name-only", ref, "--", MARKS_DIR,
  ]);
  const marks = new Map();
  for (const mark of listing.split("\0")) {
    if (!mark.endsWith(".toml")) continue;
    let data;
    try {
      data = parse(git(repo, ["show", `${ref}:${mark}`]));
    } catch (error) {
      if (!(error instanceof TomlError)) throw error;
      warn(`${mark} is ignored: ${tomlMessage(error)}`);
      continue;
    }
    if (typeof data.path !== "string") {
      warn(`${mark} is ignored: it names no path`);
      continue;
    }
    marks.set(mark, { path: data.path, date: dateText(data.date) });
  }
  return marks;
}

/** Take from `unplaced` each mark whose file this commit added or moved. */
function broughtIn(changes, unplaced) {
  const placing = [];
  for (const { fields } of changes) {
    const path = fields.at(-1);
    if ("AR".includes(fields[0][0]) && unplaced.has(path)) {
      placing.push(unplaced.get(path));
      unplaced.delete(path);
    }
  }
  return placing;
}

/**
 * True when a commit is newer than every mark on its file.
 *
 * A cut is {at: index of the commit that added the mark, date}. A date replaces
 * the commit as the start point; indexes grow from newest to oldest.
 */
function counted(index, day, cuts) {
  return cuts.every(({ at, date }) => (date ? day > date : index < at));
}

/**
 * Read the file list and per-file commit history at `ref`.
 *
 * A file's history is a list of [commit index, [added, deleted, modified]],
 * without the commits its marks rule out.
 */
export async function collect(repo, ref) {
  const listing = git(repo, ["ls-tree", "-r", "-z", "--name-only", ref]);
  const live = new Set(listing.split("\0").filter(Boolean));
  const log = gitLines(repo, [
    "log", ref, `--format=${LOG_FORMAT}`, "--raw", "-p", "-U0",
    "--inter-hunk-context=0", "-M", "--no-color", "--no-ext-diff",
    "--no-textconv", "--submodule=short",
  ]);

  const commits = [];
  const days = [];
  const history = new Map([...live].map((name) => [name, []]));
  const aliases = new Map();
  const unplaced = readMarks(repo, ref);
  const cuts = new Map();
  for await (const { short, stamp, day, subject, changes } of parseLog(log)) {
    const index = commits.length;
    commits.push([short, stamp, subject]);
    days.push(day);
    const placing = broughtIn(changes, unplaced);
    // A mark may use the name from either side of its own commit's rename,
    // and touchedFiles forgets the newer side.
    const newer = placing.map(({ path }) => aliases.get(path));
    for (const [name, counts] of touchedFiles(changes, live, aliases)) {
      history.get(name).push([index, counts]);
    }
    placing.forEach(({ path, date }, at) => {
      const current = newer[at] ?? aliases.get(path) ?? path;
      if (!live.has(current)) warn(`a mark names ${path}, not a live file`);
      if (!cuts.has(current)) cuts.set(current, []);
      cuts.get(current).push({ at: index, date });
    });
  }
  for (const mark of unplaced.keys()) {
    warn(`${mark} is ignored: no commit with a diff added it`);
  }
  for (const [name, marked] of cuts) {
    if (live.has(name)) {
      history.set(name, history.get(name).filter(
        ([index]) => counted(index, days[index], marked),
      ));
    }
  }

  // Indexes were assigned newest first; the page counts from the oldest.
  const last = commits.length - 1;
  commits.reverse();
  const files = [...live].sort(byCodePoint).map((name) => [
    name,
    history.get(name)
      .map(([index, counts]) => [last - index, counts])
      .sort((a, b) => a[0] - b[0]),
  ]);
  return { commits, files };
}

/**
 * Map each file at `ref` with lines to its count.
 *
 * A binary or empty file is absent. Each record is `<ref>:<path>\0<count>\n`
 * and a path may hold a newline. Git grep exits 1 when no file matches.
 */
export function lineCounts(repo, ref) {
  const output = git(repo, ["grep", "-I", "-z", "-c", "-e", "", ref, "--"], {
    allowed: [0, 1],
  });
  const skip = ref.length + 1;
  const sizes = new Map();
  for (const match of output.matchAll(RECORD_COUNT)) {
    sizes.set(match[1].slice(skip), Number(match[2]));
  }
  return sizes;
}
