import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git } from "./git.js";

const SNAPSHOT_SUBJECT = "Uncommitted changes";
const IDENTITY = {
  GIT_AUTHOR_NAME: "gitcity",
  GIT_AUTHOR_EMAIL: "gitcity@localhost",
  GIT_COMMITTER_NAME: "gitcity",
  GIT_COMMITTER_EMAIL: "gitcity@localhost",
};

/** The paths that differ across a revision range, under their newer names. */
export function changedFiles(top, range) {
  const listing = git(top, [
    "diff", "--name-only", "-z", "-M", "--no-relative", "--no-ext-diff", range,
  ]);
  return new Set(listing.split("\0").filter(Boolean));
}

/**
 * Commit the working tree, tracked or not, on top of HEAD, so that the rest of
 * the pipeline can read it like any other commit.
 *
 * The objects go to a scratch directory and the staging is done on a copy of
 * the index, so the repository is not written to. Later git commands reach the
 * commit through the environment until `remove` is called.
 */
export function snapshotWorkingTree(top) {
  const gitPath = (name) =>
    resolve(top, git(top, ["rev-parse", "--git-path", name]).trim());
  const objects = gitPath("objects");
  const index = gitPath("index");
  const scratch = mkdtempSync(join(tmpdir(), "gitcity-"));
  const saved = new Map();
  const setEnv = (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (!saved.has(key)) saved.set(key, process.env[key]);
      process.env[key] = value;
    }
  };
  const remove = () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  };

  try {
    const stagedIndex = join(scratch, "index");
    if (existsSync(index)) copyFileSync(index, stagedIndex);
    // Git refuses to run if the object directory it is pointed at is missing.
    mkdirSync(join(scratch, "objects"));
    setEnv({
      GIT_OBJECT_DIRECTORY: join(scratch, "objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: objects,
      GIT_INDEX_FILE: stagedIndex,
      ...IDENTITY,
    });
    git(top, ["add", "-A", "--", ":/"]);
    const tree = git(top, ["write-tree"]).trim();
    const commit = git(top, [
      "commit-tree", tree, "-p", "HEAD", "-m", SNAPSHOT_SUBJECT,
    ]).trim();
    return { commit, remove };
  } catch (error) {
    remove();
    throw error;
  }
}
