import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assignCities, dividerFor, embed, excluded, globMatch } from "../src/cities.js";
import { normalPath } from "../src/cityfile.js";
import { CityError } from "../src/errors.js";
import { hunkLines, parseLog } from "../src/history.js";

const BIN = fileURLToPath(new URL("../bin/gitcity.js", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "gitcity-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let repos = 0;
function makeRepo() {
  const repo = join(scratch, `repo${(repos += 1)}`);
  mkdirSync(repo);
  run(repo, "init", "-q", "-b", "main");
  run(repo, "config", "user.name", "Test");
  run(repo, "config", "user.email", "test@example.com");
  return repo;
}

function run(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function put(repo, path, content) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

function commit(repo, subject, date = "2024-01-15T12:00:00Z") {
  run(repo, "add", "-A");
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", subject], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

/** Run the command in a repository; `data` is what the page embeds. */
function city(repo, ...args) {
  const output = join(scratch, `out${(repos += 1)}.html`);
  const done = spawnSync(process.execPath, [BIN, repo, "-o", output, ...args], {
    encoding: "utf8",
  });
  if (done.status !== 0) return { ...done, data: null };
  const page = readFileSync(output, "utf8");
  const json = page.match(/<script id="city-data"[^>]*>(.*?)<\/script>/s)[1];
  return { ...done, page, data: JSON.parse(json) };
}

const fileNamed = (data, name) => data.files.find((entry) => entry[0] === name);
const changedNames = (data) => data.diff.changed.map((at) => data.files[at][0]);

test("hunkLines counts the overlap as modified", () => {
  assert.deepEqual(hunkLines(2, 5), [3, 0, 2]);
  assert.deepEqual(hunkLines(5, 2), [0, 3, 2]);
});

test("parseLog reads headers, raw lines and hunks, with omitted counts as 1", async () => {
  const lines = [
    "\x01abc\x021700000000\x02sub\x02ject\n",
    ":100644 100644 aaa bbb M\ta.txt\n",
    ":100644 100644 aaa bbb R090\told.txt\tnew.txt\n",
    "diff --git a/a.txt b/a.txt\n",
    "@@ -1,2 +1 @@\n",
    "-@@ -9,9 +9,9 @@ not a hunk\n",
    "diff --git a/old.txt b/new.txt\n",
    "@@ -0,0 +1,3 @@\n",
  ].map((line) => Buffer.from(line));
  const commits = [];
  for await (const entry of parseLog(lines)) commits.push(entry);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, "sub\x02ject");
  assert.equal(commits[0].stamp, 1700000000);
  assert.deepEqual(commits[0].changes, [
    { fields: ["M", "a.txt"], counts: [0, 1, 1] },
    { fields: ["R090", "old.txt", "new.txt"], counts: [3, 0, 0] },
  ]);
});

test("globMatch follows fnmatch, with * crossing /", () => {
  assert.ok(globMatch("a/b/c.lock", "*.lock"));
  assert.ok(globMatch("a.c", "?.[a-c]"));
  assert.ok(globMatch("a.d", "a.[!a-c]"));
  assert.ok(globMatch("]", "[]]"));
  assert.ok(globMatch("[x", "[x"));
  assert.ok(globMatch("a+b(c)", "a+b(c)"));
  assert.ok(!globMatch("a.lock.txt", "*.lock"));
  assert.ok(!globMatch("A.LOCK", "*.lock"));
  assert.ok(excluded("docs/vendor/x.js", ["docs/vendor/"]));
  assert.ok(!excluded("docs/vendors/x.js", ["docs/vendor"]));
});

test("normalPath reduces to repository-relative form", () => {
  assert.equal(normalPath(" ./a/b/ ", "x"), "a/b");
  assert.equal(normalPath(".", "x"), "");
  assert.equal(normalPath("/", "x"), "");
  assert.throws(() => normalPath("a/../..", "x"), CityError);
});

test("a file goes to the longest matching city, whose exclude then applies", () => {
  const cities = [
    { name: "all", path: "" },
    { name: "api", path: "api", exclude: ["*.lock"] },
  ];
  const files = [["api/a.go", []], ["api/x.lock", []], ["b.md", []], ["v/c", []]];
  assert.deepEqual(
    assignCities(files, cities, ["v"]).map(([name, , index]) => [name, index]),
    [["api/a.go", 1], ["b.md", 0]],
  );
});

test("embed cannot close the script tag", () => {
  assert.equal(embed(["</script><!--"]), '["<\\/script><\\!--"]');
});

test("buildings carry commits, line kinds and current bytes, across renames", () => {
  const repo = makeRepo();
  put(repo, "src/a.txt", "1\n2\n3\n");
  put(repo, "image.bin", Buffer.from([0, 1, 2, 0]));
  commit(repo, "add");
  put(repo, "src/a.txt", "1\nchanged\n3\n4\n");
  commit(repo, "edit");
  renameSync(join(repo, "src/a.txt"), join(repo, "src/b.txt"));
  commit(repo, "move");

  const { data, status } = city(repo);
  assert.equal(status, 0);
  assert.deepEqual(data.commits.map((entry) => entry[2]), ["add", "edit", "move"]);
  assert.deepEqual(data.files.map((entry) => entry[0]), ["image.bin", "src/b.txt"]);
  assert.deepEqual(fileNamed(data, "src/b.txt").slice(1), [
    [0, 1, 2], 0, [[3, 0, 0], [1, 0, 1], [0, 0, 0]], 14, 1,
  ]);
  assert.deepEqual(fileNamed(data, "image.bin").slice(4), [4, 1]);
});

test("a file takes the smallest divider that keeps it within the limit", () => {
  // At 800 bytes per unit, a limit of 100 units is 80 KB.
  assert.equal(dividerFor(0, 100), 1);
  assert.equal(dividerFor(80_000, 100), 1);
  assert.equal(dividerFor(80_001, 100), 10);
  assert.equal(dividerFor(800_000, 100), 10);
  assert.equal(dividerFor(800_001, 100), 100);
  assert.equal(dividerFor(8_000_001, 100), 1000);
  assert.equal(dividerFor(1e12, 100), 1000);

  const repo = makeRepo();
  put(repo, "small.txt", "x".repeat(800));
  put(repo, "tenfold.png", Buffer.alloc(801));
  put(repo, "hundredfold.png", Buffer.alloc(8001));
  put(repo, "empty", "");
  symlinkSync("small.txt", join(repo, "link"));
  commit(repo, "add");

  const { data } = city(repo, "--max-height", "1");
  assert.equal(data.maxHeight, 1);
  assert.equal(fileNamed(data, "small.txt")[5], 1);
  assert.equal(fileNamed(data, "tenfold.png")[5], 10);
  assert.equal(fileNamed(data, "hundredfold.png")[5], 100);
  assert.deepEqual(fileNamed(data, "empty").slice(4), [0, 1]);
});

test("the height limit defaults, comes from the Cityfile, and a flag beats it", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "add");
  assert.equal(city(repo).data.maxHeight, 100);

  put(repo, "Cityfile", "max_height = 2.5\n");
  assert.equal(city(repo).data.maxHeight, 2.5);
  assert.equal(city(repo, "--max-height", "7").data.maxHeight, 7);

  assert.match(city(repo, "--max-height", "tall").stderr, /--max-height must be a positive number/);
  put(repo, "Cityfile", "max_height = 0\n");
  assert.match(city(repo).stderr, /max_height must be a positive number/);
});

test("a subject holding replacement patterns reaches the page unchanged", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "cost $& $` $' </script> é");
  const { data, page } = city(repo);
  assert.equal(data.commits[0][2], "cost $& $` $' </script> é");
  assert.ok(!page.includes("cost $& $` $' </script>"));
});

test("the page is one file, with the viewer's styles and script inline", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "add a");
  const { page } = city(repo);
  assert.ok(page.includes("#fatal"));  // from city.css
  assert.ok(page.includes("window.repoCity"));  // from js/start.js
  assert.equal(page.match(/<script/g).length, 2);  // the data, and the code
  assert.ok(!/<link|<script[^>]* src=/.test(page));  // nothing left to fetch
});

test("a Cityfile sets cities and excludes, and a flag beats it", () => {
  const repo = makeRepo();
  put(repo, "api/a.go", "1\n");
  put(repo, "web/b.js", "1\n");
  put(repo, "web/c.lock", "1\n");
  put(repo, "other", "1\n");
  put(repo, "Cityfile", `name = "shop"\nref = "main"\nexclude = ["*.lock"]\n`
    + `[[city]]\nname = "API"\npath = "./api/"\n`
    + `[[city]]\nname = "Web"\npath = "web"\n`);
  commit(repo, "first");
  put(repo, "api/a.go", "1\n2\n");
  commit(repo, "second");

  const { data } = city(repo);
  assert.equal(data.name, "shop");
  assert.deepEqual(data.cities, [
    { name: "API", path: "api" }, { name: "Web", path: "web" },
  ]);
  assert.deepEqual(data.files.map((entry) => entry[0]), ["api/a.go", "web/b.js"]);

  const older = city(repo, "--ref", "HEAD~1");
  assert.equal(older.data.ref, "HEAD~1");
  assert.equal(fileNamed(older.data, "api/a.go")[4], 2);
});

test("mistakes end with a message and exit 1", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "first");
  const cityfile = join(scratch, "bad.toml");

  const cases = [
    ['nmae = "x"\n', /unknown key nmae/],
    ['[city]\nname = "x"\n', /use \[\[city\]\], not \[city\]/],
    ['[[city]]\nname = "x"\n', /path is required/],
    ['[[city]]\nname = "x"\npath = "../y"\n', /must stay inside/],
    ['[[city]]\nname = "x"\npath = "missing"\n[[city]]\nname = "y"\npath = "."\n', /city 'x' has no files/],
    ["= broken\n", /^gitcity: \S+ .*line 1, column \d+\)\n$/],
    ["exclude = 1\n", /exclude must be a list/],
  ];
  for (const [content, message] of cases) {
    writeFileSync(cityfile, content);
    const done = city(repo, "--cityfile", cityfile);
    assert.equal(done.status, 1, content);
    assert.match(done.stderr, message);
    assert.match(done.stderr, /^gitcity: /);
  }
  assert.match(city(repo, "--cityfile", join(scratch, "none")).stderr, /no such Cityfile/);
  assert.match(city(repo, "--ref", "nope").stderr, /^gitcity: git /);
  assert.equal(city(repo, "--nope").status, 2);
});

test("without a diff flag the page has no diff", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "first");
  assert.equal(city(repo).data.diff, null);
});

test("--diff marks what the branch changed since it split from the base", () => {
  const repo = makeRepo();
  put(repo, "same", "1\n");
  put(repo, "edited", "1\n");
  put(repo, "doomed", "1\n");
  put(repo, "moved", "1\n2\n3\n4\n5\n");
  commit(repo, "base");
  run(repo, "checkout", "-q", "-b", "topic");
  put(repo, "edited", "2\n");
  put(repo, "added", "1\n");
  rmSync(join(repo, "doomed"));
  renameSync(join(repo, "moved"), join(repo, "renamed"));
  commit(repo, "work");
  // A later change on the base is not part of the branch's diff.
  run(repo, "checkout", "-q", "main");
  put(repo, "same", "2\n");
  commit(repo, "elsewhere");
  run(repo, "checkout", "-q", "topic");

  const { data, stdout } = city(repo, "--diff", "main");
  assert.equal(data.diff.base, "main");
  assert.deepEqual(changedNames(data), ["added", "edited", "renamed"]);
  assert.ok(fileNamed(data, "same"));
  assert.ok(!fileNamed(data, "doomed"));
  assert.match(stdout, /3 in the diff from main/);

  run(repo, "checkout", "-q", "main");
  const other = city(repo, "--diff", "main", "--ref", "topic").data;
  assert.deepEqual(changedNames(other), ["added", "edited", "renamed"]);
});

test("--diff-local draws the working tree and leaves the repository alone", () => {
  const repo = makeRepo();
  put(repo, ".gitignore", "ignored\n");
  put(repo, "same", "1\n");
  put(repo, "edited", "1\n");
  put(repo, "staged", "1\n");
  put(repo, "doomed", "1\n");
  commit(repo, "base");
  put(repo, "edited", "1\n2\n");
  put(repo, "staged", "2\n");
  run(repo, "add", "staged");
  put(repo, "untracked", "1\n2\n3\n");
  put(repo, "ignored", "1\n");
  rmSync(join(repo, "doomed"));

  const status = run(repo, "status", "--porcelain");
  const objects = run(repo, "count-objects");
  const { data } = city(repo, "--diff-local");

  assert.equal(data.ref, "working tree");
  assert.deepEqual(changedNames(data), ["edited", "staged", "untracked"]);
  assert.ok(!fileNamed(data, "doomed"));
  assert.ok(!fileNamed(data, "ignored"));
  assert.equal(fileNamed(data, "untracked")[4], 6);
  assert.deepEqual(data.commits.at(-1).slice(2), ["Uncommitted changes"]);
  assert.deepEqual(fileNamed(data, "edited")[3], [[1, 0, 0], [1, 0, 0]]);

  assert.equal(run(repo, "status", "--porcelain"), status);
  assert.equal(run(repo, "count-objects"), objects);
  assert.equal(run(repo, "log", "--format=%s"), "base\n");
});

test("diff mode fails rather than drawing an all-gray city", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "first");
  const clean = city(repo, "--diff-local");
  assert.equal(clean.status, 1);
  assert.match(clean.stderr, /^gitcity: no drawn file differs from HEAD at working tree/);
  assert.match(city(repo, "--diff", "main").stderr, /no drawn file differs from main/);
  assert.match(city(repo, "--diff", "nope").stderr, /^gitcity: git diff/);
  assert.equal(city(repo, "--diff", "main", "--diff-local").status, 2);
  assert.equal(city(repo, "--diff-local", "--ref", "HEAD").status, 2);
});
