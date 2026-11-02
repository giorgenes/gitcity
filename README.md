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
| `--max-height UNITS` | tallest building, at 800 bytes per unit | `100` |
| `--diff BASE` | colour only the files changed since `--ref` split from `BASE` | off |
| `--diff-local` | draw the working tree, colouring only uncommitted changes | off |

Requires Node.js 20 or newer and `git`.

## Reading the city

Each tracked file is a building, one block per commit that touched it. Each
folder is a block, with its subfolders as sub-blocks inside it.

A building's height is proportional to the file's size in bytes at the drawn
commit, however many commits it has. An empty file is drawn at a minimum height.

One unit of height is 800 bytes. A file that would stand taller than the height
limit (100 units, or 80 KB, unless `--max-height` or `max_height` changes it) is
divided by the smallest divider that brings it within the limit. Its block
colour darkens at each level, and a letter is repeated around its walls:

| Divider | Letter | Example at the default limit |
| --- | --- | --- |
| 10x | `d` | over 80 KB, up to 800 KB |
| 100x | `c` | over 800 KB, up to 8 MB |
| 1000x | `k` | over 8 MB |

A divided file is at least tall enough to read its letter, up to the limit. A
file too large even at 1000x stands at the limit.

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

A non-empty file none of whose commits has any lines, such as a binary, is as
wide as a one-commit text file of the same height, rather than a thin pole.

A file's history follows renames, so a moved file keeps its blocks. Merge
commits with no diff of their own add no block.

## Diff mode

Diff mode draws the whole city as usual, but only the top block of each file in
the diff keeps its colour. Everything else is gray: the lower blocks of those
files and every other building. Moving through history, the colour stays on
whichever block is on top at that point. The legend and the "Most commits" list
cover only the files in the diff.

```sh
gitcity --diff main              # what this branch changes, as a pull request would
gitcity --diff main --ref topic  # the same for another branch
gitcity --diff-local             # uncommitted changes, staged or not
```

`--diff BASE` compares `--ref` with its merge base with `BASE`. A file deleted
in the diff has no building, because it is gone from the drawn commit.

`--diff-local` draws the working tree instead of a commit, so it ignores `ref`
from the `Cityfile` and cannot be combined with `--ref`. Your uncommitted changes
appear as one last commit: new files, including untracked ones that are not
ignored, get a building, and deleted files lose theirs. Nothing is written to the
repository.

If no drawn file is in the diff, generation fails with a message instead of
writing an all-gray page.

## Cityfile

Generation reads a TOML file named `Cityfile` at the repository root, or the one
given with `--cityfile`. Every key is optional; a command-line flag beats the
file.

```toml
name = "my-project"          # page title (default: repository folder)
ref = "origin/main"          # commit to draw (default: HEAD)
output = "my-project.html"   # relative to the working directory
max_height = 100             # tallest building, at 800 bytes per unit
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

## License

GPL-3.0. See [LICENSE](LICENSE).
