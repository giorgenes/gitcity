#!/usr/bin/env node
import { main } from "../src/cli.js";
import { CityError } from "../src/errors.js";

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof CityError)) throw error;
  console.error(`gitcity: ${error.message}`);
  process.exitCode = 1;
}
