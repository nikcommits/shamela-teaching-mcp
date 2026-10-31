# shamela-teaching-mcp — notes for contributors and coding assistants

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Commands

```bash
npm install          # .npmrc sets legacy-peer-deps (npm bug with the git dependency otherwise)
npm test             # all unit + contract tests; no Shamela needed
npm run typecheck
npm run build        # fetch-helper (checksummed) + esbuild bundle + THIRD_PARTY_NOTICES.md
npm run selftest     # against a real Shamela install (maintainer machine)
npm run pack:mcpb && npm run pack:skill
npm run check:versions
```

## Rules

1. **Never write to the Shamela install.** All Shamela access goes through the upstream library.
2. **No Shamela content in the repository or in tests.** Fixtures are texts written for the
   tests (`tests/fixtures/fakeLibrary.ts`). Never hard-code a real book id as a test
   expectation; the self-test picks books from the user's library at run time.
3. **A check that did not run is never reported as passed.** New statuses or checks must keep
   "verified" meaning both checks agreed on the claimed page.
4. **Quotation text comes from the page.** Never store or export Arabic that was typed by the
   assistant as a quotation.
5. **Arabic first.** New user-facing strings go into all three catalogues in `src/i18n/`
   (Arabic is the default); tool descriptions stay English.
6. **No code without tests**; run `npm test` before committing. Every upstream tool or
   parameter newly used must be added to `USED` in `tests/unit/contract.test.ts`.
7. Interface or data changes follow [docs/VERSIONING.md](docs/VERSIONING.md) and
   [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md); update `CHANGELOG.md`.
8. Releases (GitHub release, publishing the `.mcpb`) only on the maintainer's explicit request.
