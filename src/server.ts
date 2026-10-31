/**
 * The teaching tools, registered on an MCP server.
 *
 * Tool descriptions are English (model-facing, like the upstream project's);
 * titles, messages and exports follow the interface language, Arabic first.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { computeChecks, checksForUnit, validateBlocks, type OpenCheck } from "./checks.js";
import type { TeachingConfig, UiLang } from "./config.js";
import { renderHtml, renderJson, renderMarkdown, type ExportFormat } from "./export.js";
import type { ShamelaGateway } from "./gateway.js";
import { checkText, errorText, messages } from "./i18n/index.js";
import {
    SCHEMA_VERSION,
    type Block,
    type BookRef,
    type BookRole,
    type Project,
    type Unit,
} from "./model.js";
import {
    getBook,
    isReadable,
    mainAuthor,
    type UpstreamBookParts,
    type UpstreamHealth,
    type UpstreamPage,
    type UpstreamSuggest,
    type UpstreamToc,
} from "./shamela.js";
import { addSource, findParallels, recheckSource, resolvePage, TeachingError } from "./sources.js";
import { newProjectId, nowIso, Store, StoreError } from "./store.js";
import { buildContext, issueContext, saveTranslation } from "./translation.js";
import { TEACHING_VERSION } from "./version.js";

export interface TeachingContext {
    gateway: ShamelaGateway;
    store: Store;
    config: TeachingConfig;
}

type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
};

/** Text a host may cut; keep exports returned inline below this. */
const INLINE_EXPORT_LIMIT = 60_000;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

function ok(data: Record<string, unknown>): ToolResult {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function fail(lang: UiLang, e: unknown): ToolResult {
    let code = "INTERNAL";
    let data: Record<string, unknown> = {};
    if (e instanceof TeachingError) {
        code = e.code;
        data = e.data;
    } else if (e instanceof StoreError) {
        code = e.code;
        data = { id: e.message, detail: e.message };
    } else {
        data = { detail: e instanceof Error ? e.message : String(e) };
    }
    const message = errorText(lang, code, data as Record<string, string | number | null>);
    const extra = Object.keys(data).length ? `\n${JSON.stringify(data, null, 2)}` : "";
    return { isError: true, content: [{ type: "text", text: `${code}: ${message}${extra}` }] };
}

function localizeChecks(lang: UiLang, checks: OpenCheck[]) {
    return checks.map((c) => ({ ...c, message: checkText(lang, c.code, c.params) }));
}

function tally(checks: OpenCheck[]) {
    return {
        blocker: checks.filter((c) => c.severity === "blocker").length,
        warning: checks.filter((c) => c.severity === "warning").length,
        info: checks.filter((c) => c.severity === "info").length,
    };
}

const projectIdArg = z
    .string()
    .optional()
    .describe("Project id. Omit to use the project used last (it is remembered between sessions).");

const blockSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("heading"), text: z.string() }).strict(),
    z.object({ kind: z.literal("quote"), source_id: z.string().describe("A source id from the source folder, e.g. S3. The Arabic text is taken from the source; never type it here.") }).strict(),
    z.object({ kind: z.literal("translation"), translation_id: z.string().describe("A saved translation id, e.g. T2.") }).strict(),
    z.object({ kind: z.literal("summary"), text: z.string(), source_ids: z.array(z.string()).min(1).describe("Sources this summarises (required).") }).strict(),
    z.object({ kind: z.literal("explanation"), text: z.string(), source_ids: z.array(z.string()).default([]).describe("Sources this explanation refers to, if any.") }).strict(),
    z.object({ kind: z.literal("task"), text: z.string() }).strict(),
    z.object({ kind: z.literal("note"), text: z.string() }).strict(),
]);

export const SERVER_INSTRUCTIONS = `Source-verified lesson preparation and research on a local al-Maktaba al-Shamila 4 library.

This server offers the 34 upstream shamela_* tools (search, read, cite) plus teaching_* tools that keep a verified source folder per project.
Rules:
- Start with teaching_status. Reuse the remembered project instead of re-asking the setup.
- Only teaching_source_add makes a passage citable: it fetches the page itself, checks the passage twice (own comparison + shamela_verify_quote) and stores the page's own wording. Never present Arabic text as a quotation unless it is a stored source.
- In lesson units, quotations are referenced by source id only; summaries must name their sources; your own explanations are labelled as such.
- Translation is optional and secondary to the Arabic. Get the context with teaching_translation_context, translate, then save with its context_sha256. Translations stay "machine_unreviewed" until the user reviews them.
- Never claim a check passed that the tools did not report. Show teaching_open_checks to the user before calling a unit finished.
If the shamela-teaching skill is available, follow it.`;

export function registerTeachingTools(server: McpServer, ctx: TeachingContext): void {
    const { gateway: gw, store, config } = ctx;
    const lang = config.lang;
    const T = messages(lang).titles;

    const loadAll = (p: Project) => {
        const sources = store.sources(p.project_id);
        const translations = store.translations(p.project_id);
        const units = store.listUnits(p.project_id);
        return { sources, translations, units };
    };

    const checksOf = (p: Project) => {
        const { sources, translations, units } = loadAll(p);
        return computeChecks(p, sources.sources, translations.translations, units);
    };

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_status",
        {
            title: T.teaching_status,
            description:
                "Step 1 of every session. Reports whether the Shamela library was found and how many books are downloaded, where teaching data is stored, the interface language, and the saved projects (the last one used first). Works without a library: then it explains what to configure. Call this before anything else; resume the last project instead of repeating the setup.",
            inputSchema: {},
            annotations: READ,
        },
        async () => {
            try {
                const health = await gw.call<UpstreamHealth>("shamela_health", { response_format: "json" });
                const library = health.ok
                    ? {
                          status: health.data.status,
                          install_root: health.data.install_root,
                          catalog_books: health.data.catalog_books,
                          downloaded_books: health.data.downloaded_books,
                          startup_error: health.data.startup_error ?? null,
                          notes: health.data.notes,
                      }
                    : { status: "error", error: `${health.code}: ${health.message}` };
                const projects = store.listProjects().map((p) => ({
                    project_id: p.project_id,
                    title: p.title,
                    kind: p.kind,
                    updated_at: p.updated_at,
                    books: p.books.map((b) => ({ book_id: b.book_id, book_name: b.book_name, role: b.role })),
                    units: p.units.length,
                    translation: p.translation,
                }));
                const last = store.settings().last_project_id;
                const next_steps: string[] = [];
                const libOk = health.ok && health.data.status !== "not_started";
                if (!libOk) {
                    next_steps.push(errorText(lang, health.ok ? health.data.startup_error?.code ?? "SHAMELA_NOT_FOUND" : health.code));
                } else if (health.data.downloaded_books === 0) {
                    next_steps.push("library_empty: ask the user to download at least one book in the Shamela app; catalogue search (shamela_search_books) still works.");
                }
                if (projects.length === 0) next_steps.push("no_projects: ask whether to start a lesson series (book-based) or a thematic research, then teaching_project_create.");
                else if (last) next_steps.push(`resume: offer to continue project ${last}.`);
                return ok({
                    versions: { teaching: TEACHING_VERSION, engine: gw.engineVersion, data_schema: SCHEMA_VERSION },
                    config: { data_dir: config.dataDir, data_dir_source: config.dataDirSource, interface_language: lang },
                    library,
                    projects,
                    last_project_id: last,
                    unreadable_projects: store.unreadableProjects(),
                    next_steps,
                });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_project_create",
        {
            title: T.teaching_project_create,
            description:
                "Create a teaching project: a book-based lesson series (kind 'series') or a thematic research (kind 'research'). Ask the user for title, audience, language of instruction and whether a translation layer is wanted; do not invent them. Arabic sources stay Arabic whatever the languages chosen. The new project becomes the remembered one.",
            inputSchema: {
                kind: z.enum(["series", "research"]),
                title: z.string().min(1),
                audience: z.string().optional().describe("Who is taught, in the user's words."),
                teaching_language: z.string().default("ar").describe("Language of instruction (BCP-47, e.g. 'ar', 'de')."),
                translation_target: z.string().optional().describe("Enable the translation layer into this language (e.g. 'de'). Omit for Arabic only."),
                research_question: z.string().optional(),
                focus: z.string().optional().describe("Subject focus chosen by the user."),
                notes: z.string().optional(),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const now = nowIso();
                const p: Project = {
                    schema_version: SCHEMA_VERSION,
                    project_id: newProjectId(a.title),
                    kind: a.kind,
                    title: a.title.trim(),
                    created_at: now,
                    updated_at: now,
                    audience: a.audience?.trim() || null,
                    teaching_language: a.teaching_language,
                    translation: { enabled: Boolean(a.translation_target), target_lang: a.translation_target ?? null },
                    research_question: a.research_question?.trim() || null,
                    focus: a.focus?.trim() || null,
                    books: [],
                    glossary: [],
                    units: [],
                    notes: a.notes ?? null,
                    counters: { source: 0, translation: 0, unit: 0 },
                };
                store.saveProject(p);
                return ok({ project: p, open_checks: localizeChecks(lang, checksOf(p)) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_project_get",
        {
            title: T.teaching_project_get,
            description:
                "Show a project: settings, chosen books, glossary, units, the source folder in brief and the open-check tally. Use it to resume work.",
            inputSchema: { project_id: projectIdArg },
            annotations: READ,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                store.rememberProject(p.project_id);
                const { sources, translations, units } = loadAll(p);
                const checks = computeChecks(p, sources.sources, translations.translations, units);
                return ok({
                    project: p,
                    sources: sources.sources.map((s) => ({
                        source_id: s.source_id,
                        book_name: s.book_name,
                        part: s.anchor.part,
                        printed_page: s.anchor.printed_page,
                        status: s.verification.status,
                        text_ar: s.text_ar,
                    })),
                    translations: translations.translations.map((t) => ({ translation_id: t.translation_id, source_id: t.source_id, lang: t.lang, status: t.status })),
                    open_checks: tally(checks),
                });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_project_update",
        {
            title: T.teaching_project_update,
            description:
                "Change project settings and the glossary. The glossary fixes how Arabic terms are rendered in the translation language; translations are checked against it. Only change what the user asked to change.",
            inputSchema: {
                project_id: projectIdArg,
                title: z.string().min(1).optional(),
                audience: z.string().nullable().optional(),
                teaching_language: z.string().optional(),
                translation: z.object({ enabled: z.boolean(), target_lang: z.string().nullable() }).strict().optional(),
                research_question: z.string().nullable().optional(),
                focus: z.string().nullable().optional(),
                notes: z.string().nullable().optional(),
                glossary_set: z
                    .array(z.object({ term_ar: z.string().min(1), rendering: z.string().min(1), note: z.string().optional() }).strict())
                    .optional()
                    .describe("Add or replace glossary entries for the project's translation language."),
                glossary_remove: z.array(z.string()).optional().describe("Arabic terms to remove from the glossary."),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                if (a.title !== undefined) p.title = a.title.trim();
                if (a.audience !== undefined) p.audience = a.audience;
                if (a.teaching_language !== undefined) p.teaching_language = a.teaching_language;
                if (a.translation !== undefined) p.translation = a.translation;
                if (a.research_question !== undefined) p.research_question = a.research_question;
                if (a.focus !== undefined) p.focus = a.focus;
                if (a.notes !== undefined) p.notes = a.notes;
                const glang = p.translation.target_lang ?? p.teaching_language;
                for (const term of a.glossary_remove ?? []) {
                    p.glossary = p.glossary.filter((g) => !(g.term_ar === term && g.lang === glang));
                }
                for (const g of a.glossary_set ?? []) {
                    p.glossary = p.glossary.filter((x) => !(x.term_ar === g.term_ar && x.lang === glang));
                    p.glossary.push({ term_ar: g.term_ar.trim(), rendering: g.rendering.trim(), lang: glang, note: g.note ?? null });
                }
                store.saveProject(p);
                return ok({ project: p, open_checks: tally(checksOf(p)) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_book_set",
        {
            title: T.teaching_book_set,
            description:
                "Choose a book for the project as its base text ('base', one per project), a commentary/explanation ('commentary') or another reference ('reference'); or remove it. Find the book id first with shamela_resolve or shamela_search_books — never guess an id. Returns the book's metadata, volumes and top-level table of contents so the relevant sections can be identified. A book that is not downloaded is recorded with an open check and a download hint.",
            inputSchema: {
                project_id: projectIdArg,
                book_id: z.number().int().positive(),
                role: z.enum(["base", "commentary", "reference"]).default("base"),
                remove: z.boolean().default(false),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                if (a.remove) {
                    p.books = p.books.filter((b) => b.book_id !== a.book_id);
                    store.saveProject(p);
                    return ok({ project: p });
                }
                const b = await getBook(gw, a.book_id);
                if (!b.ok) throw new TeachingError(b.code, { book_id: a.book_id, detail: b.message });
                const readable = isReadable(b.data);
                const [parts, toc, suggest] = await Promise.all([
                    readable ? gw.call<UpstreamBookParts>("shamela_get_book_parts", { book_id: a.book_id, response_format: "json" }) : null,
                    readable ? gw.call<UpstreamToc>("shamela_get_toc", { book_id: a.book_id, depth: 1, response_format: "json" }) : null,
                    readable ? null : gw.call<UpstreamSuggest>("shamela_suggest_download", { book_ids: [a.book_id], response_format: "json" }),
                ]);
                const author = mainAuthor(b.data);
                const ref: BookRef = {
                    book_id: a.book_id,
                    book_name: b.data.book_name,
                    author_name: author.name,
                    author_death_hijri: author.death,
                    role: a.role as BookRole,
                    edition: b.data.edition,
                    editor: b.data.editor,
                    publisher: b.data.publisher,
                    downloaded: readable,
                    multi_volume: parts?.ok ? parts.data.is_multi_volume : false,
                    selected_at: nowIso(),
                };
                p.books = p.books.filter((x) => x.book_id !== a.book_id && !(a.role === "base" && x.role === "base"));
                p.books.push(ref);
                store.saveProject(p);
                return ok({
                    book: ref,
                    category: b.data.category,
                    content_status: b.data.content_status,
                    volumes: parts?.ok ? parts.data.parts : null,
                    toc: toc?.ok ? toc.data.titles.map((t) => ({ title_id: t.title_id, title: t.title_text, page_id: t.page_id, has_children: t.has_children })) : null,
                    download: suggest?.ok ? { candidate: suggest.data.results[0] ?? null, next_steps: suggest.data.next_steps } : null,
                    upstream_notes: b.data.notes,
                    open_checks: localizeChecks(lang, checksOf(p)),
                });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_locate",
        {
            title: T.teaching_locate,
            description:
                "Map a page reference to an exact page: either a page_id, or a PRINTED page number (with the volume for multi-volume works). A printed number that occurs in several volumes returns all candidates instead of guessing. Returns page id, volume, printed page, chapter path, neighbours and whether the numbering is Shamela's automatic count.",
            inputSchema: {
                book_id: z.number().int().positive(),
                page_id: z.number().int().positive().optional(),
                printed_page: z.number().int().positive().optional(),
                part: z.string().optional().describe("Volume as Shamela names it (e.g. '2')."),
            },
            annotations: READ,
        },
        async (a) => {
            const describe = async (pageId: number) => {
                const r = await gw.call<UpstreamPage>("shamela_get_page", { book_id: a.book_id, page_id: pageId, response_format: "json" });
                if (!r.ok) throw new TeachingError(r.code, { book_id: a.book_id, page_id: pageId, detail: r.message });
                const d = r.data;
                return {
                    page_id: d.page_id,
                    part: d.part,
                    printed_page: d.printed_page,
                    auto_numbered: d.citation_auto_numbered,
                    toc_path: d.containing_titles.map((t) => t.title_text),
                    prev_page_id: d.prev_page_id,
                    next_page_id: d.next_page_id,
                    body_parts: d.body_total_parts,
                    preview: d.body.slice(0, 280),
                };
            };
            try {
                try {
                    const pageId = await resolvePage(gw, a.book_id, a);
                    return ok({ book_id: a.book_id, unique: true, page: await describe(pageId) });
                } catch (e) {
                    if (e instanceof TeachingError && e.code === "PRINTED_PAGE_AMBIGUOUS") {
                        const ids = (e.data.candidate_page_ids as number[]).slice(0, 12);
                        const candidates = [];
                        for (const id of ids) candidates.push(await describe(id));
                        return ok({ book_id: a.book_id, unique: false, message: errorText(lang, e.code, e.data as never), candidates });
                    }
                    throw e;
                }
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_parallels",
        {
            title: T.teaching_parallels,
            description:
                "Find where a passage (typically from the base text) appears in the project's commentaries or other chosen books, so the base text can be read together with its explanations. Defaults to the project's downloaded commentary and reference books. Read the hits with shamela_get_page before using them; add them as sources with teaching_source_add.",
            inputSchema: {
                project_id: projectIdArg,
                text: z.string().min(4),
                book_ids: z.array(z.number().int().positive()).optional(),
                limit: z.number().int().min(1).max(20).default(10),
            },
            annotations: READ,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const ids =
                    a.book_ids ??
                    p.books.filter((b) => b.downloaded && b.role !== "base").map((b) => b.book_id);
                return ok({ searched_book_ids: ids, ...(await findParallels(gw, a.text, ids, a.limit)) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_source_add",
        {
            title: T.teaching_source_add,
            description:
                "Add a passage to the project's source folder — the only way a text becomes citable. The server fetches the whole page itself, locates the passage (exact, then ignoring diacritics, then ignoring letter variants), confirms it independently with shamela_verify_quote on that page, and stores the PAGE's own wording with a permanent anchor (book, page id, volume, printed page, text hashes) and citations. Give the page as page_id, or as printed_page (+ part). A passage not attested on the page is refused unless keep_unverified is true, in which case it is stored with a blocking open check. The passage must lie on one page; split longer passages.",
            inputSchema: {
                project_id: projectIdArg,
                book_id: z.number().int().positive(),
                page_id: z.number().int().positive().optional(),
                printed_page: z.number().int().positive().optional(),
                part: z.string().optional(),
                quote: z.string().min(4).describe("The passage as found on the page (copy it from shamela_get_page)."),
                role: z.enum(["base", "commentary", "reference"]).optional().describe("Defaults to the book's role in the project."),
                note: z.string().optional(),
                keep_unverified: z.boolean().default(false),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const file = store.sources(p.project_id);
                const r = await addSource(gw, p, file.sources, a);
                if (!r.duplicate) {
                    file.sources.push(r.source);
                    store.saveSources(p.project_id, file);
                    store.saveProject(p);
                }
                const checks = checksOf(p).filter((c) => c.subject.type === "source" && c.subject.id === r.source.source_id);
                return ok({
                    duplicate: r.duplicate,
                    source: r.source,
                    status_text: messages(lang).status[r.source.verification.status],
                    open_checks: localizeChecks(lang, checks),
                });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_source_list",
        {
            title: T.teaching_source_list,
            description: "List the project's source folder with each passage, its anchor, check status and citation.",
            inputSchema: { project_id: projectIdArg },
            annotations: READ,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const sources = store.sources(p.project_id).sources;
                return ok({
                    project_id: p.project_id,
                    sources: sources.map((s) => ({ ...s, status_text: messages(lang).status[s.verification.status] })),
                });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_source_recheck",
        {
            title: T.teaching_source_recheck,
            description:
                "Run both checks again on one source or on all of them: refetch the page completely, compare, re-run shamela_verify_quote. Detects a page that changed since it was saved (e.g. after a Shamela update) and records it as an open check; the stored passage is never silently replaced. Use after a library update and before exporting a final version.",
            inputSchema: { project_id: projectIdArg, source_id: z.string().optional() },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const file = store.sources(p.project_id);
                const targets = a.source_id ? file.sources.filter((s) => s.source_id === a.source_id) : file.sources;
                if (a.source_id && targets.length === 0) throw new TeachingError("SOURCE_NOT_FOUND", { id: a.source_id });
                const results = [];
                for (const s of targets) {
                    try {
                        const updated = await recheckSource(gw, s);
                        file.sources[file.sources.indexOf(s)] = updated;
                        results.push({ source_id: s.source_id, before: s.verification.status, after: updated.verification.status, drift: Boolean(updated.drift), fetch_complete: updated.fetch.complete });
                    } catch (e) {
                        results.push({ source_id: s.source_id, before: s.verification.status, after: null, error: e instanceof TeachingError ? e.code : String(e) });
                    }
                }
                store.saveSources(p.project_id, file);
                return ok({ results, open_checks: localizeChecks(lang, checksOf(p)) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_source_remove",
        {
            title: T.teaching_source_remove,
            description:
                "Remove a source from the folder. Refused while a unit or a translation still uses it, unless force is true (then the references become open checks). Only on the user's request.",
            inputSchema: { project_id: projectIdArg, source_id: z.string(), force: z.boolean().default(false) },
            annotations: DELETE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const { sources, translations, units } = loadAll(p);
                if (!sources.sources.some((s) => s.source_id === a.source_id)) throw new TeachingError("SOURCE_NOT_FOUND", { id: a.source_id });
                const usedBy = [
                    ...units
                        .filter((u) =>
                            u.blocks.some(
                                (b) =>
                                    (b.kind === "quote" && b.source_id === a.source_id) ||
                                    ((b.kind === "summary" || b.kind === "explanation") && b.source_ids.includes(a.source_id)),
                            ),
                        )
                        .map((u) => u.unit_id),
                    ...translations.translations.filter((t) => t.source_id === a.source_id).map((t) => t.translation_id),
                ];
                if (usedBy.length && !a.force) {
                    return ok({ removed: false, used_by: usedBy, hint: "Pass force: true only if the user confirms." });
                }
                sources.sources = sources.sources.filter((s) => s.source_id !== a.source_id);
                store.saveSources(p.project_id, sources);
                return ok({ removed: true, used_by: usedBy, open_checks: tally(checksOf(p)) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_translation_context",
        {
            title: T.teaching_translation_context,
            description:
                "Get everything needed to translate one source accurately: the passage, the whole page (author's text and editor's notes kept apart), neighbouring pages, chapter path, author and era, the matching glossary entries, the audience, and translation rules. Translate ONLY source.text_ar, following the rules, then call teaching_translation_save with the returned context_sha256. Requires the project's translation layer to be enabled.",
            inputSchema: {
                project_id: projectIdArg,
                source_id: z.string(),
                neighbour_pages: z.number().int().min(0).max(2).default(1),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const src = store.sources(p.project_id).sources.find((s) => s.source_id === a.source_id);
                if (!src) throw new TeachingError("SOURCE_NOT_FOUND", { id: a.source_id });
                const bundle = await buildContext(gw, p, src, a.neighbour_pages);
                const file = store.translations(p.project_id);
                const issued = issueContext(file, src, bundle);
                store.saveTranslations(p.project_id, file);
                return ok({ context_sha256: issued.context_sha256, context: bundle as unknown as Record<string, unknown> });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_translation_save",
        {
            title: T.teaching_translation_save,
            description:
                "Save a translation of a source. Accepted only with a context_sha256 issued by teaching_translation_context for the same source and the same source text. The translation is bound to the source's text hash, checked against the glossary, and starts as 'machine_unreviewed'.",
            inputSchema: {
                project_id: projectIdArg,
                source_id: z.string(),
                text: z.string().min(1),
                context_sha256: z.string().length(64),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const src = store.sources(p.project_id).sources.find((s) => s.source_id === a.source_id);
                if (!src) throw new TeachingError("SOURCE_NOT_FOUND", { id: a.source_id });
                const file = store.translations(p.project_id);
                const t = saveTranslation(p, file, src, a);
                store.saveTranslations(p.project_id, file);
                store.saveProject(p);
                const checks = checksOf(p).filter((c) => c.subject.type === "translation" && c.subject.id === t.translation_id);
                return ok({ translation: t, open_checks: localizeChecks(lang, checks) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_translation_review",
        {
            title: T.teaching_translation_review,
            description:
                "Record a PERSON's review decision on a translation. Call this ONLY when the user has explicitly said they reviewed the translation and approve or reject it, and pass their name as reviewer. Never call it on your own judgement — a model's opinion is not a review.",
            inputSchema: {
                project_id: projectIdArg,
                translation_id: z.string(),
                decision: z.enum(["approve", "reject"]),
                reviewer: z.string().min(1),
                note: z.string().optional(),
                corrected_text: z.string().optional().describe("The reviewer's corrected wording, if they gave one."),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const file = store.translations(p.project_id);
                const t = file.translations.find((x) => x.translation_id === a.translation_id);
                if (!t) throw new TeachingError("TRANSLATION_NOT_FOUND", { id: a.translation_id });
                if (a.corrected_text?.trim()) t.text = a.corrected_text.trim();
                t.status = a.decision === "approve" ? "reviewed" : "rejected";
                t.review = { by: a.reviewer.trim(), at: nowIso(), note: a.note ?? null };
                store.saveTranslations(p.project_id, file);
                return ok({ translation: t, open_checks: tally(checksOf(p)) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_unit_save",
        {
            title: T.teaching_unit_save,
            description:
                "Create or replace a lesson unit (or a research result). Content is a list of labelled blocks: 'quote' (source id only — the verified Arabic is inserted from the source folder), 'translation' (translation id), 'summary' (must list its source_ids), 'explanation' (own explanation, may list source_ids), 'task', 'note', 'heading'. References to unknown sources are rejected. Free text that reproduces six or more consecutive words of a source is flagged as an unmarked quotation.",
            inputSchema: {
                project_id: projectIdArg,
                unit_id: z.string().optional().describe("Omit to create a new unit."),
                title: z.string().min(1),
                objectives: z.array(z.string()).default([]),
                blocks: z.array(blockSchema),
                status: z.enum(["draft", "final"]).default("draft"),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const { sources, translations } = loadAll(p);
                const blocks = a.blocks as Block[];
                validateBlocks(blocks, sources.sources, translations.translations);
                let unit: Unit;
                if (a.unit_id) {
                    unit = store.getUnit(p.project_id, a.unit_id);
                    unit.title = a.title;
                    unit.objectives = a.objectives;
                    unit.blocks = blocks;
                    unit.status = a.status;
                } else {
                    p.counters.unit += 1;
                    const now = nowIso();
                    unit = {
                        schema_version: SCHEMA_VERSION,
                        unit_id: `U${p.counters.unit}`,
                        project_id: p.project_id,
                        title: a.title,
                        status: a.status,
                        objectives: a.objectives,
                        blocks,
                        created_at: now,
                        updated_at: now,
                    };
                }
                store.saveUnit(unit);
                p.units = [
                    ...p.units.filter((u) => u.unit_id !== unit.unit_id),
                    { unit_id: unit.unit_id, title: unit.title, status: unit.status, updated_at: unit.updated_at },
                ].sort((x, y) => Number(x.unit_id.slice(1)) - Number(y.unit_id.slice(1)));
                store.saveProject(p);
                const checks = checksForUnit(checksOf(p), unit, translations.translations);
                return ok({ unit, open_checks: localizeChecks(lang, checks), tally: tally(checks) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_unit_get",
        {
            title: T.teaching_unit_get,
            description: "Show a unit with its blocks resolved (quotation text from the source folder, translation text) and its open checks.",
            inputSchema: { project_id: projectIdArg, unit_id: z.string() },
            annotations: READ,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const unit = store.getUnit(p.project_id, a.unit_id);
                const { sources, translations } = loadAll(p);
                const bySource = new Map(sources.sources.map((s) => [s.source_id, s]));
                const byT = new Map(translations.translations.map((t) => [t.translation_id, t]));
                const resolved = unit.blocks.map((b) =>
                    b.kind === "quote"
                        ? { ...b, text_ar: bySource.get(b.source_id)?.text_ar ?? null, status: bySource.get(b.source_id)?.verification.status ?? null }
                        : b.kind === "translation"
                          ? { ...b, text: byT.get(b.translation_id)?.text ?? null, status: byT.get(b.translation_id)?.status ?? null }
                          : b,
                );
                const checks = checksForUnit(checksOf(p), unit, translations.translations);
                return ok({ unit: { ...unit, blocks: resolved }, open_checks: localizeChecks(lang, checks) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_open_checks",
        {
            title: T.teaching_open_checks,
            description:
                "List what is not (yet) verified in a project or one unit: unverified or incomplete sources, changed pages, editor's-note sources, automatic page numbers, unreviewed or stale translations, glossary mismatches, unmarked quotations, broken references. Show this to the user before treating a unit as finished; do not summarise blockers away.",
            inputSchema: { project_id: projectIdArg, unit_id: z.string().optional() },
            annotations: READ,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                let checks = checksOf(p);
                if (a.unit_id) checks = checksForUnit(checks, store.getUnit(p.project_id, a.unit_id), store.translations(p.project_id).translations);
                return ok({ project_id: p.project_id, unit_id: a.unit_id ?? null, tally: tally(checks), checks: localizeChecks(lang, checks) });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );

    // ----------------------------------------------------------------------
    server.registerTool(
        "teaching_export",
        {
            title: T.teaching_export,
            description:
                "Export a unit (or, without unit_id, the whole source folder with translations) as Markdown, HTML (print-ready, right-to-left Arabic) or JSON. Every block is labelled; the source folder and the open checks are appended. The file is written to the project's exports folder; its path is returned. Only on the user's request.",
            inputSchema: {
                project_id: projectIdArg,
                unit_id: z.string().optional(),
                format: z.enum(["markdown", "html", "json"]).default("markdown"),
            },
            annotations: WRITE,
        },
        async (a) => {
            try {
                const p = store.resolveProject(a.project_id);
                const { sources, translations } = loadAll(p);
                const unit = a.unit_id ? store.getUnit(p.project_id, a.unit_id) : null;
                const all = checksOf(p);
                const checks = unit ? checksForUnit(all, unit, translations.translations) : all;
                const generatedAt = nowIso();
                const input = {
                    project: p,
                    unit,
                    sources: sources.sources,
                    translations: translations.translations,
                    checks,
                    lang,
                    generatedAt,
                    versions: { teaching: TEACHING_VERSION, engine: gw.engineVersion },
                };
                const fmt = a.format as ExportFormat;
                const content = fmt === "html" ? renderHtml(input) : fmt === "json" ? renderJson(input) : renderMarkdown(input);
                const ext = fmt === "html" ? "html" : fmt === "json" ? "json" : "md";
                const stamp = generatedAt.replace(/[:.]/g, "-");
                const file = store.writeExport(p.project_id, `${unit ? unit.unit_id : "sources"}-${stamp}.${ext}`, content);
                return ok({
                    path: file,
                    format: fmt,
                    tally: tally(checks),
                    content: content.length <= INLINE_EXPORT_LIMIT ? content : null,
                    content_omitted: content.length > INLINE_EXPORT_LIMIT ? `${content.length} characters; open the file` : null,
                });
            } catch (e) {
                return fail(lang, e);
            }
        },
    );
}
