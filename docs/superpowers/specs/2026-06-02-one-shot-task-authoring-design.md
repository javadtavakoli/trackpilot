# trackpilot — One-Shot Task Authoring — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pre-implementation)
**Builds on:** `2026-06-01-youtrack-cli-design.md`

## Problem

Creating one ordinary task today takes ~10 round trips and trial-and-error.
Observed while creating RC-215 ("Release"):

1. `create --field "Team=QA"` fails with `Incompatible field type: 111-73`.
   `api.createIssue` hardcodes `$type: 'SingleEnumIssueCustomField'` for every
   `--field`, so any non-single-enum field (multi-value `Team`, period
   `Estimation`, user `Assignee`) is rejected.
2. No `--assignee`. Setting it meant guessing YouTrack command syntax
   (`for javadtavakoli`, `Assignee {Javad Tavakoli}` all failed; only `for me`
   worked).
3. No tag support → a separate `command … "tag …"` call. Worse, `tag infra`
   **silently created a brand-new tag** because the real tag is `scope:infra`;
   nothing warned. RC-215 now carries a stray `infra` tag.
4. No link support → a separate `command … "relates to RC-211"` call.
5. `read`/`list` don't return tags or links, so verifying the result meant
   guessing query syntax (`relates:` returned 0; `links:` worked).
6. Errors surface YouTrack's internal field id (`111-73`), not the field name.

## Goal

A single `create` (and a symmetric `update`) sets summary, description, type,
enum/multi/period fields, assignee, tags, and links in one invocation — with
values validated and corrected ("did you mean") **before** anything is written,
and the final state returned for self-verification.

## Verified API facts (low-privilege permanent token)

These were probed against `https://rango.youtrack.cloud` with the configured
token. They define what the design may rely on.

- **Admin field config is blocked:** `/admin/projects/{id}/customFields` and
  `/admin/projects/{id}/fields` return `[]`. Schema must be obtained another way.
- **Schema-via-issue works:** reading any one issue with
  `customFields(name,value(name),projectCustomField(field(name),bundle(values(name))))`
  returns, per field, its name, its `$type` (e.g. `SingleEnumIssueCustomField`,
  `MultiEnumIssueCustomField`, period/user types), and the **full bundle of
  allowed values**. This is the schema source.
- **`/users?fields=login,name,fullName`** is readable (paginates via `$top`).
- **`/issueTags?fields=name`** is readable and lists the canonical tags
  (`scope:infra`, `unplanned`, `scope:widget`, …). There is no plain `infra`.
- **`/commands/assist`** (`POST {query, issues:[{idReadable}]}`,
  `fields=commands(description,error)`) parses a command string and returns a
  per-sub-command `error` boolean **without mutating**. It also distinguishes
  `Add tag X` (existing) from `Add new tag X` (would create one).
- **Command formatting (confirmed via assist):** one concern per command needs
  **no braces**, even for multi-word values — `RC Squad Squad 1`,
  `Type User Story`, `Priority Show-stopper`, `add tag scope:infra` all parse
  `error:false`. Braces are *wrong*: `tag {scope:infra}` is read as creating a
  literal new tag, and `Type {User Story}` errors. A combined multi-command
  string also parses, but grouped single-concern calls are preferred (below).
- `for me` resolves to login `Javadtavakoli95` (the token owner).

## Approach

**Chosen: Command-API writes with client-side validation + an `assist`
pre-flight.** (Alternative considered: typed REST `customFields` payloads —
rejected because it forces us to replicate YouTrack's per-type value coercion,
period/user value shapes are untested, and tags/links aren't custom fields
anyway, so it wouldn't unify the path.)

Every settable thing maps to one YouTrack command, one concern per command:

| Input | Command |
|---|---|
| `--assignee <user>` | `for <login>` |
| `--field "Name=Value"` (any type) | `Name Value` |
| `--field "Team=A" --field "Team=B"` | `Team A` then `Team B` |
| `--tag <name>` | `add tag <name>` |
| `--relates <ID>` | `relates to <ID>` |
| `--depends-on <ID>` | `depends on <ID>` |
| `--subtask-of <ID>` | `subtask of <ID>` |

### Flow (`create` and `update`)

1. **Resolve + validate client-side** (cached once per process run):
   - `--tag` → exact match against `/issueTags`. Miss → abort with closest
     matches (`infra` → "did you mean: scope:infra?"). This is the specific
     guard against the stray-tag bug.
   - `--assignee` and user-typed fields → match `/users` on
     login/name/fullName (case-insensitive). Miss → suggest closest. Resolve to
     the canonical **login** for the command.
   - `--field "Name=Value"` → look up `Name` in the project schema
     (schema-via-issue) and, for enum/bundle fields, validate `Value` against the
     bundle. Miss on field name or value → abort with the valid options.
   - Period (`Estimation`) and free-text fields: pass through (format validated
     by the assist step).
2. **Pre-flight** the assembled command list through `/commands/assist`. Abort if
   any sub-command reports `error:true`, or if a tag command resolves to
   "Add new tag" (unintended creation that slipped past step 1).
3. **Apply** as grouped commands — one `/commands` call per concern — so a
   failure is attributable to a specific operation rather than one opaque string.
4. **Self-verify:** return the issue via `readIssue`, which now includes `tags`
   and `links`. For `create` this is already the final step; the caller sees the
   final state with no extra query.

For `create`, ordering matters: step 1 (client-side resolve/validate) needs no
issue id, so it runs **first**. Only if all values resolve is the bare issue
(project + summary + description) created via REST; then `assist` (step 2),
apply (step 3), and read (step 4) run against the new id. This means a bad tag,
assignee, or field value is rejected with no issue created at all. A
half-configured issue is therefore only possible if an apply call fails after a
clean assist — the rare exception, reported with the issue id in step 3's error
handling.

## CLI surface changes

```
create --project <KEY> --summary "..."
       [--description "..."] [--type <Type>]
       [--assignee <user>]
       [--field "Name=Value" ...]        # any field type, repeatable
       [--tag <name> ...]                 # repeatable
       [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

update <id> [--summary ...] [--description ...] [--state ...]
       [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...]
       [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

read <id>            # output now includes tags[] and links[]
list --query "..."   # output now includes tags[] and links[]
fields <PROJECT>     # NEW: print fields + allowed values + the tag list
```

`--field` remains the generic escape hatch for any field not given a dedicated
flag. `--tag`/`--relates`/etc. are conveniences that also get validation.

## Module structure

- **`src/api.mjs`**
  - Add `tags()` → `[{name}]` from `/issueTags`.
  - Add `users()` → `[{login,name,fullName}]` from `/users` (paginated).
  - Add `projectSchema(projectKey)` → reads one issue in the project, returns
    `[{name, type, values:[...]}]` (values present only for bundle fields).
  - Add `assist(idReadable, query)` → `[{description, error}]`.
  - Extend `ISSUE_FIELDS` and `shapeIssue` with `tags(name)` →
    `tags: [name,…]` and `links(direction,linkType(name),issues(idReadable))` →
    `links: [{type, direction, id}]` (drop empty link buckets).
  - Generalize `createIssue`: create the bare issue (project/summary/description)
    and return its id; field/assignee/tag/link setting moves to the command flow.
    No more hardcoded `SingleEnumIssueCustomField`.
- **`src/resolve.mjs`** (new, pure, unit-tested): given a candidate string and a
  list of canonical names, return an exact match or a ranked "did you mean"
  list. Used for tags, users, and enum values. Case-insensitive; ranks by
  substring then edit distance.
- **`src/commands/create.mjs`, `src/commands/update.mjs`**: parse the new flags,
  run the resolve → assist → apply → read flow. Shared flow extracted into a
  small helper (e.g. `src/apply-fields.mjs`) so both commands use one code path.
- **`src/commands/fields.mjs`** (new): `fields <PROJECT>` discovery command.
- **`bin/trackpilot.mjs`**: register `fields`; update USAGE.

## Testing

- `resolve.mjs`: pure unit tests (exact match, case-insensitive, suggestion
  ranking, `infra`→`scope:infra`, empty/!found).
- Command-string builder (flags → command list): pure unit tests, incl.
  multi-value `--field` repetition and link flags.
- API shaping (`shapeIssue` with tags/links; `projectSchema` parsing): unit
  tests against captured JSON fixtures from the probes above.
- Manual end-to-end: re-create a task like RC-215 in one `create` call and
  confirm the returned object shows correct tags, link, assignee, and fields.

## Error handling

- Unknown tag/user/field-value → `{ "error": "..." }` listing close matches,
  **before** any mutation, exit 1.
- `assist` reports `error:true` → surface that sub-command's message, exit 1.
- A grouped apply call failing → report which concern failed and the issue id so
  the partial state is visible (no silent partial success).

## Out of scope (YAGNI)

- Editing/deleting global tags (the stray `infra` tag is fixed per-issue with
  `untag`, not by deleting the tag).
- Caching schema/users/tags across runs (cache is per-process only).
- A general `--link "<type>=<ID>"` flag — the three named link flags cover the
  observed link types; revisit if a fourth is needed.
- Sub-tasks/parent hierarchy beyond the `subtask of` command.
