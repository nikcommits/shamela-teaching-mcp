# Data format

All teaching data live under `TEACHING_DATA_DIR` as UTF-8 JSON. They are separate from the
program and from Shamela; back them up or move them like any folder.

```
<data dir>/
  settings.json                     { schema_version, last_project_id }
  projects/<project_id>/
    project.json                    settings, chosen books, glossary, unit index, counters
    sources.json                    the source folder (Quellenmappe)
    translations.json               translations + ledger of issued context bundles
    units/U1.json, U2.json, …       lesson units / research results
    exports/                        rendered files (Markdown, HTML, JSON)
```

The TypeScript definitions in [`src/model.ts`](../src/model.ts) are the authoritative schema.

## Key fields

**Source** (`sources.json → sources[]`)

| Field | Meaning |
|---|---|
| `source_id` | `S1`, `S2`, … — stable within the project |
| `text_ar` | the passage **as the page writes it** |
| `submitted_text` | what was submitted, only when it differed (diacritics, letter variants) |
| `field` | `body` (author), `foot` (editor's footnote), `comment` |
| `anchor` | `book_id`, `page_id`, `part`, `printed_page`, `auto_numbered`, `quote_sha256`, `page_sha256`, `url` |
| `fetch` | `complete`, `body_parts`, `truncated`, `problems[]` |
| `verification` | `status`, `local` (own check), `engine` (shamela_verify_quote), `checked_at`, `engine_version` |
| `citation` | `shamela` (Shamela style with text), `full`, `notes[]` |
| `drift` | set by a recheck when the page text no longer matches `page_sha256` |

Hashes are SHA-256 over the canonical form: HTML removed, Unicode NFC, whitespace collapsed.

**Translation** (`translations.json → translations[]`): `translation_id`, `source_id`, `lang`,
`text`, `status` (`machine_unreviewed` · `reviewed` · `rejected`), `source_quote_sha256`,
`context_sha256`, `glossary_missing[]`, `review`. `issued_contexts[]` is the ledger of context
bundles handed out.

**Unit** (`units/U<n>.json`): `title`, `status` (`draft` · `final`), `objectives[]`, `blocks[]` with
kinds `heading`, `quote` (`source_id`), `translation` (`translation_id`), `summary` (`text`,
`source_ids` ≥ 1), `explanation` (`text`, `source_ids`), `task`, `note`.

## Versioning and migration

- Every file carries `schema_version` (currently `1`).
- A file with a **higher** version than the program understands is refused (`SCHEMA_TOO_NEW`)
  rather than misread; the rest of the data stays usable.
- Additive changes (new optional fields) keep the version. Any change that removes, renames or
  retypes a field raises `schema_version`, and the program then migrates older files on read
  and documents the migration here.
- Writes are atomic (temporary file + rename).
