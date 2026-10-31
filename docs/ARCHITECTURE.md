# Architecture

## One server, two layers

```
MCP host (Claude Desktop, Claude Code, …)
        │ stdio
        ▼
┌───────────────────────────── shamela-teaching (dist/index.js) ─────────────────────────────┐
│  teaching_* tools (src/server.ts)          shamela_* tools (34, registered by upstream)   │
│        │                                              ▲                                    │
│        ▼                                              │                                    │
│  ShamelaGateway (src/gateway.ts) ── in-memory MCP client ──► private upstream server       │
│        │                                              │                                    │
│        └──────────────── one shared BackendProvider ──┘                                    │
│                         (sql.js reads of the Shamela databases, one Java helper process)   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        │ read-only                                   │ read/write
        ▼                                             ▼
  user's Shamela 4 install                     TEACHING_DATA_DIR (JSON files)
```

- The upstream project [alhoqbani/shamela-mcp](https://github.com/alhoqbani/shamela-mcp) is a
  **library dependency**, pinned to a commit (`package.json`). Its `registerAllTools()` puts the
  34 tools on our server; `createServer()` builds a second, private server on the **same**
  backend, which the teaching layer calls through an in-memory MCP client.
- **Why call through MCP instead of importing functions?** The upstream package exports its
  registration API and types, not the tool functions. Its MCP contract (tool names, parameters,
  `structuredContent`) is what it versions under semver (see its `CLAUDE.md`), so building on
  it is building on the stable surface. `tests/unit/contract.test.ts` checks every tool and
  parameter the teaching layer uses against the real upstream code.
- The only direct backend access is `PageStore.pageIdsForPrintedPage` / `getPagesRows`
  (exported classes) for printed-page → page-id resolution, which no upstream tool offers.

## The search helper jar

Page text and the search indexes live in Shamela's Lucene indexes, read by a small Java helper
from the upstream project. Compiling it requires two jars from a Shamela install, which cannot
be redistributed. `scripts/fetch-helper.mjs` therefore takes the jar **unmodified** from the
official upstream release v1.3.0 and verifies two SHA-256 checksums. The Java sources are
identical between v1.3.0 and the pinned library commit (`git diff v1.3.0 8b992ea -- src/java`
is empty), so the jar matches. When the upstream pin moves, re-check this and update the
checksums. At runtime the jar runs on the Java that Shamela ships, with Lucene and AlKhalil
from the user's own install on the class path.

## Verification design

`teaching_source_add` (src/sources.ts):

1. `shamela_get_book` — exists? text readable on this machine? (else `BOOK_NOT_DOWNLOADED` with
   the download hint from `shamela_suggest_download`).
2. Page reference: `page_id`, or printed page + volume → page id. Several candidates are an
   error that lists them; nothing is guessed.
3. **Complete fetch:** every body part of `shamela_get_page`; any `truncated` flag or part
   mismatch marks the fetch incomplete (blocking open check).
4. **Check 1 (own):** locate the passage in body, then footnote, then comment — exact, then
   ignoring diacritics, then also ignoring hamza seats / alif maqsura / ta marbuta / digits /
   punctuation. The stored text is cut **from the page**, never rebuilt from the input.
5. **Check 2 (engine):** `shamela_verify_quote` on the claimed page with the page's wording.
6. Status: `verified` only when both agree on the claimed page; `verified_local` when the
   engine could not run; any disagreement is never resolved as "found".
7. Anchor: book, page id, volume, printed page, auto-numbering flag, SHA-256 of passage and of
   the page field, public URL; citations from `shamela_get_citation`.

`teaching_source_recheck` repeats 3–6 and records **drift** when the page hash changed; the
stored passage is never replaced silently.

## Translation design

The server cannot translate (the assistant's model does), but it binds translations to their
evidence: `teaching_translation_context` issues a context bundle and records its hash in a
ledger; `teaching_translation_save` accepts only a ledger hash issued for the same source and
the same source-text hash; glossary terms present in the source must appear in their agreed
rendering; status starts `machine_unreviewed`; only `teaching_translation_review`, on a person's
explicit decision, changes it.

## Units and labels

Units store block references, not quotation text: `quote` holds a source id and the text is
rendered from the source folder at export time, so an edited unit file cannot smuggle text into
an export. Summaries must name sources. Free text containing six or more consecutive words of a
source is flagged as an unmarked quotation.

## Languages

- Arabic is the default interface language (`TEACHING_LANG`, default `ar`); `de` and `en` are
  additional. User-facing strings live in `src/i18n/`.
- Tool descriptions and translation rules are English, as upstream: they are read by the
  model, not by the teacher, and English descriptions work across assistants.
- The upstream tools follow `SHAMELA_LANG`; it is aligned to `en` when the interface is English
  and to Arabic otherwise (upstream has no German catalogue).
- Source texts are never translated by the interface.

## Portability

- No book ids, authors, series or personal paths are built in. Paths come from settings or
  platform conventions (`src/config.ts`), with `~` expanded and unfilled host placeholders
  (`${user_config.x}`) treated as unset.
- `dist/index.js` is self-contained (Node ≥ 20, sql.js WebAssembly inlined); the `.mcpb` bundle
  contains it, the helper jar, license and notices — no `node_modules`.
- Teaching data are plain JSON files (see DATA-FORMAT.md) that can be backed up or moved.
