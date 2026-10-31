/**
 * The persisted data model. Every file carries `schema_version`; see
 * docs/DATA-FORMAT.md for the documented form and the migration policy.
 *
 * Design rules that the checks depend on:
 *  - A source's Arabic text is cut out of the page the server fetched itself.
 *    It is never the text an assistant typed.
 *  - Every derived text (translation, summary, explanation) points at the
 *    source(s) it is derived from, and a translation remembers the hash of the
 *    exact source text and context it was made from.
 *  - Lesson units do not contain quotation text at all, only source ids; the
 *    text is rendered from the source file at export time.
 */

export const SCHEMA_VERSION = 1 as const;

export type ProjectKind = "series" | "research";
export type BookRole = "base" | "commentary" | "reference";

export interface BookRef {
    book_id: number;
    book_name: string;
    author_name: string | null;
    author_death_hijri: number | null;
    role: BookRole;
    edition: string | null;
    editor: string | null;
    publisher: string | null;
    /** Whether the book's text was on this machine when it was selected. */
    downloaded: boolean;
    multi_volume: boolean;
    selected_at: string;
}

export interface GlossaryEntry {
    /** The Arabic term as it appears in the sources. */
    term_ar: string;
    /** The agreed rendering in the translation language. */
    rendering: string;
    lang: string;
    note: string | null;
}

export interface UnitSummary {
    unit_id: string;
    title: string;
    status: UnitStatus;
    updated_at: string;
}

export interface Project {
    schema_version: typeof SCHEMA_VERSION;
    project_id: string;
    kind: ProjectKind;
    title: string;
    created_at: string;
    updated_at: string;
    /** Who is taught (free text, e.g. "Oberstufe", "طلاب المستوى المتوسط"). */
    audience: string | null;
    /** Language the lessons are taught in. Arabic source text is kept regardless. */
    teaching_language: string;
    /** Optional translation layer. Arabic stays primary; this only adds. */
    translation: { enabled: boolean; target_lang: string | null };
    /** For research projects: the question. For series: optional framing. */
    research_question: string | null;
    /** Subject focus chosen by the teacher (e.g. "Fiqh der Reinheit"). */
    focus: string | null;
    books: BookRef[];
    glossary: GlossaryEntry[];
    units: UnitSummary[];
    notes: string | null;
    counters: { source: number; translation: number; unit: number };
}

export type PageField = "body" | "foot" | "comment";

export type VerificationStatus =
    /** Found character-for-character on the claimed page, confirmed by both checks. */
    | "verified"
    /** Found on the claimed page; diacritics or letter variants differ from what was submitted. The stored text is the page's. */
    | "verified_normalized"
    /** Found on the fetched page by our own comparison, but the engine's independent check could not run. */
    | "verified_local"
    /** The page carries the passage only with different wording. */
    | "differs"
    /** Only part of the passage is on the page. */
    | "partial"
    /** Not on the claimed page. */
    | "not_found"
    /** Nothing could be examined (book not on this machine, engine not running). */
    | "unverifiable";

export interface FetchRecord {
    /** True only when every body part was read and nothing was truncated. */
    complete: boolean;
    body_parts: number;
    truncated: boolean;
    fetched_at: string;
    problems: string[];
}

export interface Verification {
    status: VerificationStatus;
    /** Our own deterministic comparison against the fetched page text. */
    local: { level: "exact" | "bare" | "loose" | "none"; occurrences: number };
    /** The upstream engine's independent check (shamela_verify_quote), when it ran. */
    engine: {
        ran: boolean;
        status: string | null;
        checked: string | null;
        on_claimed_page: boolean;
        field: PageField | null;
        differences: string[];
        printed_page_confusion: { given: number; page_ids: number[] } | null;
        error: string | null;
    };
    checked_at: string;
    engine_version: string | null;
}

export interface SourceAnchor {
    book_id: number;
    page_id: number;
    part: string | null;
    printed_page: string | null;
    /** True when Shamela numbered the pages itself — no paper edition carries this number. */
    auto_numbered: boolean;
    /** SHA-256 of the stored passage (canonical form). */
    quote_sha256: string;
    /** SHA-256 of the page's field text at the time of the check. */
    page_sha256: string;
    /** Public page on shamela.ws, when known. */
    url: string | null;
}

export interface Source {
    source_id: string;
    added_at: string;
    book_id: number;
    book_name: string;
    author_name: string | null;
    role: BookRole;
    field: PageField;
    /** Chapter path from the book's table of contents, root first. */
    toc_path: string[];
    /** The passage exactly as the page writes it. */
    text_ar: string;
    /** What was submitted, kept only when it differed from the page. */
    submitted_text: string | null;
    anchor: SourceAnchor;
    fetch: FetchRecord;
    verification: Verification;
    citation: { shamela: string | null; full: string | null; notes: string[] };
    /** Set by a recheck when the page text no longer matches the stored hash. */
    drift: { detected_at: string; previous_page_sha256: string } | null;
    note: string | null;
}

export type TranslationStatus = "machine_unreviewed" | "reviewed" | "rejected";

export interface Translation {
    translation_id: string;
    source_id: string;
    lang: string;
    text: string;
    status: TranslationStatus;
    created_at: string;
    /** Hash of the source passage the translation was made from. */
    source_quote_sha256: string;
    /** Hash of the context bundle the translator was given. */
    context_sha256: string;
    /** Glossary terms present in the source whose agreed rendering is missing from the translation. */
    glossary_missing: Array<{ term_ar: string; rendering: string }>;
    review: { by: string; at: string; note: string | null } | null;
}

export type UnitStatus = "draft" | "final";

export type Block =
    | { kind: "heading"; text: string }
    /** An original quotation — text comes from the source, never from here. */
    | { kind: "quote"; source_id: string }
    /** A stored translation of a source. */
    | { kind: "translation"; translation_id: string }
    /** A summary of one or more sources, written by the assistant or teacher. */
    | { kind: "summary"; text: string; source_ids: string[] }
    /** The teacher's/assistant's own explanation. May refer to sources. */
    | { kind: "explanation"; text: string; source_ids: string[] }
    /** An exercise, question or activity. */
    | { kind: "task"; text: string }
    /** A free note (organisation, timing, materials). */
    | { kind: "note"; text: string };

export interface Unit {
    schema_version: typeof SCHEMA_VERSION;
    unit_id: string;
    project_id: string;
    title: string;
    status: UnitStatus;
    objectives: string[];
    blocks: Block[];
    created_at: string;
    updated_at: string;
}

export interface SourcesFile {
    schema_version: typeof SCHEMA_VERSION;
    sources: Source[];
}

export interface IssuedContext {
    context_sha256: string;
    source_id: string;
    source_quote_sha256: string;
    issued_at: string;
}

export interface TranslationsFile {
    schema_version: typeof SCHEMA_VERSION;
    translations: Translation[];
    /**
     * Every context bundle handed out by teaching_translation_context. A
     * translation is accepted only with a hash from this ledger that belongs
     * to the same source and the same source text — the technical proof that
     * the translator was given the context.
     */
    issued_contexts: IssuedContext[];
}

export interface Settings {
    schema_version: typeof SCHEMA_VERSION;
    last_project_id: string | null;
}
