import { spawn, spawnSync } from "node:child_process";
import { fail } from "./errors.js";

function command(repo, args) {
  return ["-C", repo, "-c", "core.quotePath=false", ...args];
}

/** Run one git command in the repository and return its stdout. */
export function git(repo, args, { allowed = [0] } = {}) {
  const done = spawnSync("git", command(repo, args), {
    maxBuffer: Infinity,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (done.error) fail(`git ${args[0]}: ${done.error.message}`);
  if (!allowed.includes(done.status)) {
    fail(`git ${args[0]}: ${done.stderr.toString().trim()}`);
  }
  return done.stdout.toString();
}

/**
 * Yield one git command's stdout as Buffers, split only on newlines.
 *
 * A diff holds arbitrary file content, so it is neither held in memory nor
 * decoded, and a carriage return in it does not start a line.
 */
export async function* gitLines(repo, args) {
  const child = spawn("git", command(repo, args), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const closed = new Promise((resolve) => {
    child.on("error", (error) => resolve({ error }));
    child.on("close", (code) => resolve({ code }));
  });

  let pieces = [];
  for await (const chunk of child.stdout) {
    let start = 0;
    let newline;
    while ((newline = chunk.indexOf(10, start)) !== -1) {
      const end = chunk.subarray(start, newline + 1);
      if (pieces.length) {
        yield Buffer.concat([...pieces, end]);
        pieces = [];
      } else {
        yield end;
      }
      start = newline + 1;
    }
    if (start < chunk.length) pieces.push(chunk.subarray(start));
  }
  if (pieces.length) yield Buffer.concat(pieces);

  const { error, code } = await closed;
  if (error) fail(`git ${args[0]}: ${error.message}`);
  if (code !== 0) {
    fail(`git ${args[0]}: ${Buffer.concat(errors).toString().trim()}`);
  }
}
