# gitcity

Render a git repository as an interactive 3D city in one HTML file. The page has
no dependencies and works opened straight from disk.

```sh
npx github:giorgenes/gitcity ~/work/my-project --ref origin/main -o my-project.html
```

| Argument | Meaning | Default |
| --- | --- | --- |
| `repo` | repository to draw | `.` |
| `--ref REF` | commit to draw | `HEAD` |
| `-o`, `--output PATH` | output file | `<name>-city.html` |
| `--cityfile PATH` | config file | `<repo>/Cityfile` |

Requires Node.js 20 or newer and `git`.

## Reading the city

Each tracked file is a building, one block per commit that touched it. Each
folder is a block, with its subfolders as sub-blocks inside it.

A building's height is proportional to the file's lines at the drawn commit,
however many commits it has. A binary or empty file has zero lines and is drawn
at a minimum height.

A block's size follows the commit's total lines, in fixed proportions, before
the stack is scaled vertically to the building's height. Git records only
additions and deletions, so within each zero-context diff hunk
`min(deleted, added)` lines count as modified, and the remainder as deleted or
added. A block's shape follows which of those kinds the commit has:

| Lines in the commit | Shape |
| --- | --- |
| added only | cube |
| deleted only | pyramid |
| modified only | cylinder |
| added, deleted and modified | icosahedron |
| any other mix | hexagonal prism |
| no lines | small plain box |

A file's history follows renames, so a moved file keeps its blocks. Merge
commits with no diff of their own add no block.

## Cityfile

Generation reads a TOML file named `Cityfile` at the repository root, or the one
given with `--cityfile`. Every key is optional; a command-line flag beats the
file.

```toml
name = "my-project"          # page title (default: repository folder)
ref = "origin/main"          # commit to draw (default: HEAD)
output = "my-project.html"   # relative to the working directory
exclude = ["docs/vendor"]    # dropped from every city

[[city]]
name = "API"
path = "go-api"

[[city]]
name = "Everything else"
path = "."                   # the whole repository
exclude = ["*.lock"]         # dropped from this city only
```

- With no `[[city]]`, the whole repository is one city.
- With any `[[city]]`, a file outside every city's path is not drawn.
- A file under several city paths belongs to the longest one.
- An exclude is a folder or file path, or a glob (`*`, `?`, `[seq]`, `[!seq]`)
  in which `*` also crosses `/`. It is always relative to the repository root.

## Marking a file as refactored

A TOML file in `bin/hotspot-marks/` at the drawn commit marks a file as
refactored, so its older churn stops counting:

```toml
path = "src/billing.go"
date = 2024-06-01            # optional
```

A marked file has blocks only for commits newer than the commit that added the
mark, or, when the mark has a `date`, for commits after that day. A marked file
with no such commit has no building. A repository with no such folder has no
marks.

## License

GPL-3.0. See [LICENSE](LICENSE).
