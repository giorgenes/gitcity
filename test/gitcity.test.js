import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assignCities, denseCutoff, embed, excluded, globMatch } from "../src/cities.js";
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
    [0, 1, 2], 0, [[3, 0, 0], [1, 0, 1], [0, 0, 0]], 14, 0,
  ]);
  assert.deepEqual(fileNamed(data, "image.bin").slice(4), [4, 0]);
});

test("a dense file is larger than the 90th percentile of drawn files", () => {
  assert.equal(denseCutoff([]), 0);
  assert.equal(denseCutoff([5, 5, 5]), 5);
  assert.equal(denseCutoff([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);

  const repo = makeRepo();
  for (let at = 1; at <= 9; at += 1) put(repo, `f${at}.txt`, "x".repeat(at));
  put(repo, "huge.png", Buffer.alloc(5000));
  put(repo, "empty", "");
  symlinkSync("f1.txt", join(repo, "link"));
  commit(repo, "add");

  const { data } = city(repo);
  assert.deepEqual(data.files.filter((entry) => entry[5]).map((entry) => entry[0]), ["huge.png"]);
  assert.equal(fileNamed(data, "huge.png")[4], 5000);
  assert.equal(fileNamed(data, "empty")[4], 0);
});

test("a subject holding replacement patterns reaches the page unchanged", () => {
  const repo = makeRepo();
  put(repo, "a", "1\n");
  commit(repo, "cost $& $` $' </script> é");
  const { data, page } = city(repo);
  assert.equal(data.commits[0][2], "cost $& $` $' </script> é");
  assert.ok(!page.includes("cost $& $` $' </script>"));
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
