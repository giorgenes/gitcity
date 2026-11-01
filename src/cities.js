const LITERAL = /[\^$\\.*+?()[\]{}|/]/g;
const IN_SET = /[\\\]\[^-]/g;
const compiled = new Map();

/** Translate a glob's `[...]`, whose contents exclude the brackets. */
function setToRegex(body) {
  const negated = body[0] === "!";
  const chars = negated ? body.slice(1) : body;
  let parts = "";
  for (let at = 0; at < chars.length; at += 1) {
    const low = chars[at];
    if (chars[at + 1] === "-" && at + 2 < chars.length) {
      const high = chars[at + 2];
      if (low.codePointAt(0) <= high.codePointAt(0)) {
        parts += `${low.replace(IN_SET, "\\$&")}-${high.replace(IN_SET, "\\$&")}`;
      }
      at += 2;
    } else {
      parts += low.replace(IN_SET, "\\$&");
    }
  }
  if (!parts) return negated ? "." : "(?!)";
  return `[${negated ? "^" : ""}${parts}]`;
}

/** Translate a glob in which `*` also crosses `/`. */
function globToRegex(pattern) {
  const chars = Array.from(pattern);
  let source = "";
  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at];
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else if (char === "[") {
      let close = at + 1;
      if (chars[close] === "!") close += 1;
      if (chars[close] === "]") close += 1;
      while (close < chars.length && chars[close] !== "]") close += 1;
      if (close >= chars.length) {
        source += "\\[";
      } else {
        source += setToRegex(chars.slice(at + 1, close));
        at = close;
      }
    } else {
      source += char.replace(LITERAL, "\\$&");
    }
  }
  return new RegExp(`^(?:${source})$`, "su");
}

export function globMatch(path, pattern) {
  if (!compiled.has(pattern)) compiled.set(pattern, globToRegex(pattern));
  return compiled.get(pattern).test(path);
}

/** True when a file is under an excluded path or matches a pattern. */
export function excluded(path, patterns) {
  return patterns.some((pattern) => {
    const clean = pattern.replace(/\/+$/, "");
    return path === clean || path.startsWith(`${clean}/`)
      || globMatch(path, clean);
  });
}

/** True when a file sits inside a folder; "" is the repository root. */
function under(path, folder) {
  return !folder || path.startsWith(`${folder}/`);
}

/**
 * Give each file to its city, as [path, history, city index]. A file under
 * several city paths belongs to the longest one.
 */
export function assignCities(files, cities, sharedExclude) {
  const longestFirst = cities
    .map((city, index) => ({ city, index }))
    .sort((a, b) => b.city.path.length - a.city.path.length);
  const placed = [];
  for (const [name, hits] of files) {
    if (excluded(name, sharedExclude)) continue;
    const home = longestFirst.find(({ city }) => under(name, city.path));
    if (home && !excluded(name, home.city.exclude ?? [])) {
      placed.push([name, hits, home.index]);
    }
  }
  return placed;
}

/**
 * Keep only commits touching a drawn file, and renumber references. Each file
 * becomes [path, commit indexes, city index, line counts per commit, lines].
 */
export function dropEmptyCommits(commits, placed, sizes) {
  const seen = new Set();
  for (const [, hits] of placed) for (const [hit] of hits) seen.add(hit);
  const used = [...seen].sort((a, b) => a - b);
  const renumber = new Map(used.map((old, index) => [old, index]));
  return {
    commits: used.map((old) => commits[old]),
    files: placed.map(([name, hits, city]) => [
      name,
      hits.map(([hit]) => renumber.get(hit)),
      city,
      hits.map(([, counts]) => counts),
      sizes.get(name) ?? 0,
    ]),
  };
}

/** Serialise data so that it cannot close the script tag holding it. */
export function embed(data) {
  return JSON.stringify(data)
    .replaceAll("</", "<\\/")
    .replaceAll("<!--", "<\\!--");
}
