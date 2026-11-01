/** A failure to report as one line, without a stack trace. */
export class CityError extends Error {}

export function fail(message) {
  throw new CityError(message);
}

/** Say something on stderr and carry on. */
export function warn(message) {
  console.error(`gitcity: ${message}`);
}

/** A TOML parser's error on one line; its message also quotes the source. */
export function tomlMessage(error) {
  const [summary] = error.message.split("\n");
  return `${summary} (at line ${error.line}, column ${error.column})`;
}
