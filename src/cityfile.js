import { readFileSync, statSync } from "node:fs";
import { parse, TomlError } from "smol-toml";
import { fail, tomlMessage } from "./errors.js";

const TOP_KEYS = new Set(["name", "ref", "output", "exclude", "city"]);
const CITY_KEYS = new Set(["name", "path", "exclude"]);

/** Reject a misspelt key, which would otherwise be silently ignored. */
function checkKeys(table, allowed, where) {
  const unknown = Object.keys(table).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) fail(`${where}: unknown key ${unknown.join(", ")}`);
}

function checkExclude(table, where) {
  const patterns = table.exclude ?? [];
  const valid = Array.isArray(patterns)
    && patterns.every((item) => typeof item === "string");
  if (!valid) fail(`${where}: exclude must be a list of strings`);
}

/** Return a table's string value, or undefined when the key is absent. */
function checkText(table, key, where) {
  const value = table[key];
  if (value !== undefined && typeof value !== "string") {
    fail(`${where}: ${key} must be a string`);
  }
  return value;
}

/** Reduce a city path to repository-relative form, with "" as the root. */
export function normalPath(raw, where) {
  let path = raw.trim().replace(/^\/+|\/+$/g, "");
  while (path.startsWith("./")) path = path.slice(2);
  if (path === ".") path = "";
  if (path.split("/").includes("..")) {
    fail(`${where}: path must stay inside the repository`);
  }
  return path;
}

/** Load and validate a Cityfile; an absent optional one is empty. */
export function readCityfile(path, { required }) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    if (required) fail(`no such Cityfile: ${path}`);
    return {};
  }
  let config;
  try {
    config = parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    fail(`${path}: ${tomlMessage(error)}`);
  }

  checkKeys(config, TOP_KEYS, path);
  for (const key of ["name", "ref", "output"]) checkText(config, key, path);
  checkExclude(config, path);

  const cities = config.city ?? [];
  if (!Array.isArray(cities)) fail(`${path}: use [[city]], not [city]`);
  const names = new Set();
  const paths = new Set();
  cities.forEach((city, at) => {
    const where = `${path}: city ${at + 1}`;
    if (city === null || typeof city !== "object" || Array.isArray(city)) {
      fail(`${path}: use [[city]] tables`);
    }
    checkKeys(city, CITY_KEYS, where);
    checkExclude(city, where);
    for (const key of ["name", "path"]) {
      if (!checkText(city, key, where)) fail(`${where}: ${key} is required`);
    }
    city.path = normalPath(city.path, where);
    if (names.has(city.name)) {
      fail(`${where}: name '${city.name}' is already used`);
    }
    if (paths.has(city.path)) {
      fail(`${where}: path '${city.path || "."}' is already used`);
    }
    names.add(city.name);
    paths.add(city.path);
  });
  return config;
}
