# Versioning

The version (`MAJOR.MINOR.PATCH`) is written in `package.json`, `manifest.json`,
`src/version.ts`, the skill's `metadata.version` and the top of `CHANGELOG.md`;
`npm run check:versions` fails when they disagree.

What counts as the interface: tool names, input parameters, `structuredContent` fields of the
`teaching_*` tools, error codes, open-check codes, and the stored data format.

| Bump | When |
|---|---|
| MAJOR | a tool removed or renamed; a parameter removed or made required; an output field removed or retyped; a check that now passes/fails differently on the same data; a data change that needs migration |
| MINOR | a new tool, optional parameter, output field, check code, export format or interface language |
| PATCH | fixes that make a tool do what its description already says; wording of messages; docs; tests; build |

While the version is `0.x`, MINOR releases may still contain breaking changes; they are listed
under **Breaking** in the changelog.

The upstream dependency is pinned to an exact commit. Moving the pin is a deliberate change:
re-run `npm test` (the contract test checks every upstream tool and parameter used), compare
the helper jar's Java sources, update checksums in `scripts/fetch-helper.mjs`, and record it
in the changelog.
