import { git, gitLines } from "./git.js";

const FIELD = "\x02";
const RECORD = "\x01";
const LOG_FORMAT = `${RECORD}%h${FIELD}%at${FIELD}%s`;
const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const TREE_ENTRY = /^\S+ \S+ \S+\s+(\S+)\t([\s\S]*)$/;

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
 * Yield {short, stamp, subject, changes}, newest commit first.
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
      const [short, stamp, ...subject] = header.split(FIELD);
      commit = {
        short,
        stamp: Number(stamp),
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

/**
 * Read the file list and per-file commit history at `ref`.
 *
 * A file's history is a list of [commit index, [added, deleted, modified]].
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
  const history = new Map([...live].map((name) => [name, []]));
  const aliases = new Map();
  for await (const { short, stamp, subject, changes } of parseLog(log)) {
    const index = commits.length;
    commits.push([short, stamp, subject]);
    for (const [name, counts] of touchedFiles(changes, live, aliases)) {
      history.get(name).push([index, counts]);
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
 * Map each file at `ref` to its size in bytes.
 *
 * Each record is `<mode> <type> <id> <size>\t<path>`, and a path may hold a
 * newline. A submodule's size is `-`, which counts as 0.
 */
export function fileSizes(repo, ref) {
  const listing = git(repo, ["ls-tree", "-r", "-l", "-z", ref]);
  const sizes = new Map();
  for (const entry of listing.split("\0")) {
    const found = TREE_ENTRY.exec(entry);
    if (found) sizes.set(found[2], Number(found[1]) || 0);
  }
  return sizes;
}
