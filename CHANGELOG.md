# Changelog

## [0.1.0] — 2026-10-31

First release.

- MCP server embedding [shamela-mcp](https://github.com/alhoqbani/shamela-mcp) (pinned at
  `8b992ea`, MIT): its 34 tools plus 18 `teaching_*` tools on one server and one backend.
- Projects (lesson series / thematic research) persisted in a configurable data folder;
  last project resumed automatically.
- Verified source folder: complete page fetch, two independent checks, page wording stored with
  a permanent anchor and SHA-256 hashes; recheck with drift detection.
- Printed page ⇄ page id resolution that lists candidates instead of guessing across volumes.
- Base-text passages located in chosen commentaries (`teaching_parallels`).
- Optional translation layer: context bundles with ledger, hash binding, glossary check,
  human review; German translation guide in the skill.
- Labelled lesson units with unmarked-quotation detection; open-check list.
- Export to Markdown, HTML (print-ready, RTL) and JSON with source folder and open checks.
- Interface in Arabic (default), German and English.
- Skill `shamela-teaching` (Arabic) with references for tools, unit structure and German
  translation.
- `.mcpb` packaging for Claude Desktop, skill zip, acceptance self-test against the user's own
  Shamela installation.
