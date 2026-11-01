# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`gitcity` is an `npx`-runnable CLI that turns a git repository into one self-contained interactive 3D HTML page. See `README.md` for user-facing behaviour: block shapes and the `Cityfile`.

## Commands

```sh
npm install
npm test                                  # all tests (node:test), no build step
node --test --test-name-pattern="Cityfile" # tests whose name matches
node bin/gitcity.js <repo> -o out.html    # run locally
```

There is no linter or bundler. The code is plain ESM JavaScript, and `smol-toml` is the only runtime dependency.

## Architecture

The pipeline runs from `main` in `src/cli.js`: read the `Cityfile`, collect history, assign files to cities, drop unused commits, then inject JSON into the page.

- `src/history.js` streams `git log --raw -p -U0` and folds it into per-file history. It walks newest to oldest, using an alias map to carry a live file's identity back through renames.
- `src/cities.js` assigns files to cities and renumbers commits. It also holds the glob matcher.
- `src/cityfile.js` validates config and rejects unknown keys.
- `template/city.html` is the whole viewer: markup, styles and script, with no external assets. `src/cli.js` replaces its `/*__CITY_DATA__*/null` placeholder with the data.

The JSON embedded in the page is the contract between the CLI and the template, and changing it means changing both:

```
{name, ref, generated, commits: [[short, stamp, subject]], cities: [{name, path}],
 files: [[path, [commit index], city index, [[added, deleted, modified]], bytes, dense (0|1)]]}
```

`commits` runs oldest first, and each file's two lists are parallel.

## Things that break easily

- Diff output holds arbitrary bytes. `gitLines` splits Buffers on `\n` only, and `parseLog` decodes only the lines it recognises by first byte. Don't decode whole diffs or split on `\r`.
- Log records use `\x01` and `\x02` as separators, and the nth `diff --git` section is matched to the nth raw line of the same commit.
- Substitute into the template with a replacer function: commit subjects can contain `$&`. Data goes through `embed` so it cannot close the `<script>` tag.
- User-facing failures throw `CityError` via `fail()`, which `bin/gitcity.js` prints as one `gitcity: ...` line with exit 1.
