/**
 * The source folder: adding a passage, checking it, re-checking it.
 *
 * A passage is accepted only after two independent technical checks:
 *   1. our own comparison against the page text we fetched completely, and
 *   2. the upstream engine's shamela_verify_quote on the claimed page.
 * The text that is stored is cut out of the page, so a later export can only
 * ever print what the book says. No assistant statement can stand in for
 * either check; when a check cannot run, the status says so and the gap is
 * listed as an open check.
 */

import type { ShamelaGateway } from "./gateway.js";
import type { BookRole, PageField, Project, Source, Verification, VerificationStatus } from "./model.js";
import {
    fetchFullPage,
    fieldText,
    getBook,
    isReadable,
    type FullPage,
    type UpstreamCitation,
    type UpstreamSuggest,
    type UpstreamVerify,
} from "./shamela.js";
import { canonical, locateQuote, textHash, wordCount, type QuoteMatch } from "./text.js";
import { nowIso } from "./store.js";

export class TeachingError extends Error {
    constructor(
        public code: string,
        public data: Record<string, unknown> = {},
    ) {
        super(code);
        this.name = "TeachingError";
    }
}

export const MIN_QUOTE_WORDS = 3;

export interface AddSourceInput {
    book_id: number;
    page_id?: number;
    printed_page?: number;
    part?: string;
    quote: string;
    role?: BookRole;
    note?: string;
    keep_unverified?: boolean;
}

export interface AddSourceResult {
    source: Source;
    duplicate: boolean;
}

/** Resolve a page reference given either as a page id or as a printed page (+ volume). */
export async function resolvePage(
    gw: ShamelaGateway,
    bookId: number,
    ref: { page_id?: number; printed_page?: number; part?: string },
): Promise<number> {
    if (ref.page_id !== undefined) return ref.page_id;
    if (ref.printed_page === undefined) throw new TeachingError("PAGE_REQUIRED");
    const r = await gw.pageIdsForPrinted(bookId, ref.printed_page, ref.part ?? null);
    if (!r.ok) throw new TeachingError(r.code, { book_id: bookId, detail: r.message });
    if (r.data.length === 0) {
        throw new TeachingError("PRINTED_PAGE_NOT_FOUND", {
            book_id: bookId,
            printed_page: ref.printed_page,
            part: ref.part ?? null,
        });
    }
    if (r.data.length > 1) {
        // A printed number repeats across volumes. Guessing would attach the
        // quotation to the wrong paper page, so the caller must choose.
        throw new TeachingError("PRINTED_PAGE_AMBIGUOUS", {
            book_id: bookId,
            printed_page: ref.printed_page,
            candidate_page_ids: r.data,
        });
    }
    return r.data[0]!;
}

/** Explain why a book cannot be read here, with the upstream download hint. */
async function notReadableError(gw: ShamelaGateway, bookId: number, status: string): Promise<TeachingError> {
    const s = await gw.call<UpstreamSuggest>("shamela_suggest_download", { book_ids: [bookId], response_format: "json" });
    return new TeachingError("BOOK_NOT_DOWNLOADED", {
        book_id: bookId,
        content_status: status,
        download: s.ok ? s.data.results[0] ?? null : null,
        next_steps: s.ok ? s.data.next_steps : [],
    });
}

interface Located {
    field: PageField;
    match: QuoteMatch;
}

/** Find the passage on the page, preferring the author's text over the editor's notes. */
export function locateOnPage(page: FullPage, quote: string): Located | null {
    for (const field of ["body", "foot", "comment"] as const) {
        const m = locateQuote(fieldText(page, field), quote);
        if (m) return { field, match: m };
    }
    return null;
}

async function engineCheck(
    gw: ShamelaGateway,
    quote: string,
    bookId: number,
    pageId: number,
): Promise<Verification["engine"]> {
    const r = await gw.call<UpstreamVerify>("shamela_verify_quote", {
        quote,
        book_id: bookId,
        page_id: pageId,
        limit: 5,
        response_format: "json",
    });
    if (!r.ok) {
        return {
            ran: false,
            status: null,
            checked: null,
            on_claimed_page: false,
            field: null,
            differences: [],
            printed_page_confusion: null,
            error: `${r.code}: ${r.message}`,
        };
    }
    const d = r.data;
    const here = d.locations.find((l) => l.book_id === bookId && l.page_id === pageId);
    return {
        ran: d.status !== "unverifiable",
        status: d.status,
        checked: d.checked,
        on_claimed_page: Boolean(here),
        field: here?.field ?? null,
        differences: here?.differences ?? [],
        printed_page_confusion: d.printed_page_confusion ?? null,
        error: d.status === "unverifiable" ? "engine reported the book as unverifiable" : null,
    };
}

/**
 * Decide the status from the two checks. "verified" needs both; anything less
 * is named for what is missing so the open-check list can say it.
 */
export function decideStatus(
    local: Located | null,
    engine: Verification["engine"],
): VerificationStatus {
    const engineVerbatimHere = engine.ran && engine.status === "verbatim" && engine.on_claimed_page;
    if (local) {
        if (!engine.ran) return "verified_local";
        if (engineVerbatimHere) return local.match.level === "exact" ? "verified" : "verified_normalized";
        // Our comparison found it but the engine did not confirm it on this
        // page: the two disagree, which is never resolved in favour of "found".
        if (engine.status === "differs" || engine.status === "partial") return engine.status;
        return "not_found";
    }
    if (!engine.ran) return "unverifiable";
    if (engine.on_claimed_page && (engine.status === "differs" || engine.status === "partial")) return engine.status;
    return "not_found";
}

export interface CheckedPassage {
    page: FullPage;
    located: Located | null;
    verification: Verification;
    /** Text to store: the page's own wording when located, else the submitted text. */
    text: string;
}

/** Fetch, locate and verify a passage on a page. Does not store anything. */
export async function checkPassage(
    gw: ShamelaGateway,
    bookId: number,
    pageId: number,
    quote: string,
): Promise<CheckedPassage> {
    const fp = await fetchFullPage(gw, bookId, pageId);
    if (!fp.ok) throw new TeachingError(fp.code, { book_id: bookId, page_id: pageId, detail: fp.message });
    const page = fp.data;
    const located = locateOnPage(page, quote);
    // Check the page's own wording when we found it (confirms what we store),
    // otherwise the submitted wording (lets the engine name the differences
    // and spot a printed-page/page-id mix-up).
    const engine = await engineCheck(gw, located ? located.match.original : canonical(quote), bookId, pageId);
    const status = decideStatus(located, engine);
    return {
        page,
        located,
        text: located ? located.match.original : canonical(quote),
        verification: {
            status,
            local: located
                ? { level: located.match.level, occurrences: located.match.occurrences }
                : { level: "none", occurrences: 0 },
            engine,
            checked_at: nowIso(),
            engine_version: gw.engineVersion,
        },
    };
}

export const ACCEPTED: ReadonlySet<VerificationStatus> = new Set(["verified", "verified_normalized", "verified_local"]);

export async function addSource(
    gw: ShamelaGateway,
    project: Project,
    existing: Source[],
    input: AddSourceInput,
): Promise<AddSourceResult> {
    if (wordCount(input.quote) < MIN_QUOTE_WORDS) {
        throw new TeachingError("QUOTE_TOO_SHORT", { min_words: MIN_QUOTE_WORDS });
    }
    const book = await getBook(gw, input.book_id);
    if (!book.ok) throw new TeachingError(book.code, { book_id: input.book_id, detail: book.message });
    if (!isReadable(book.data)) throw await notReadableError(gw, input.book_id, book.data.content_status);

    const pageId = await resolvePage(gw, input.book_id, input);
    const checked = await checkPassage(gw, input.book_id, pageId, input.quote);

    if (!ACCEPTED.has(checked.verification.status) && !input.keep_unverified) {
        throw new TeachingError("QUOTE_NOT_VERIFIED", {
            book_id: input.book_id,
            page_id: pageId,
            status: checked.verification.status,
            engine: checked.verification.engine,
            fetch_complete: checked.page.complete,
        });
    }

    const field = checked.located?.field ?? "body";
    const quoteHash = textHash(checked.text);
    const dup = existing.find(
        (s) => s.book_id === input.book_id && s.anchor.page_id === pageId && s.anchor.quote_sha256 === quoteHash,
    );
    if (dup) return { source: dup, duplicate: true };

    const [cite, full] = await Promise.all([
        gw.call<UpstreamCitation>("shamela_get_citation", {
            book_id: input.book_id,
            page_id: pageId,
            text: checked.text,
            style: "shamela",
            response_format: "json",
        }),
        gw.call<UpstreamCitation>("shamela_get_citation", {
            book_id: input.book_id,
            page_id: pageId,
            style: "full",
            response_format: "json",
        }),
    ]);

    const role: BookRole =
        input.role ?? project.books.find((b) => b.book_id === input.book_id)?.role ?? "reference";
    const p = checked.page.page;
    const url =
        (cite.ok && cite.data.components.source_url_is_book_level === false
            ? (cite.data.components.source_url as string | undefined)
            : undefined) ?? null;

    project.counters.source += 1;
    const source: Source = {
        source_id: `S${project.counters.source}`,
        added_at: nowIso(),
        book_id: input.book_id,
        book_name: p.book_name,
        author_name: p.author_name,
        role,
        field,
        toc_path: p.containing_titles.map((t) => t.title_text).filter(Boolean),
        text_ar: checked.text,
        submitted_text:
            checked.located && checked.located.match.level !== "exact" ? canonical(input.quote) : null,
        anchor: {
            book_id: input.book_id,
            page_id: pageId,
            part: p.part,
            printed_page: p.printed_page,
            auto_numbered: p.citation_auto_numbered,
            quote_sha256: quoteHash,
            page_sha256: textHash(fieldText(checked.page, field)),
            url,
        },
        fetch: {
            complete: checked.page.complete,
            body_parts: checked.page.parts,
            truncated: checked.page.truncated,
            fetched_at: checked.verification.checked_at,
            problems: checked.page.problems,
        },
        verification: checked.verification,
        citation: {
            shamela: cite.ok ? cite.data.formatted : p.citation ?? null,
            full: full.ok ? full.data.formatted : null,
            notes: [...(cite.ok ? cite.data.notes : []), ...(full.ok ? full.data.notes : [])],
        },
        drift: null,
        note: input.note ?? null,
    };
    return { source, duplicate: false };
}

/**
 * Re-run both checks on a stored source. Detects when the page text changed
 * (a Shamela update re-edited the book) and records it; the stored passage is
 * never silently replaced.
 */
export async function recheckSource(gw: ShamelaGateway, source: Source): Promise<Source> {
    const checked = await checkPassage(gw, source.book_id, source.anchor.page_id, source.text_ar);
    const pageHashNow = textHash(fieldText(checked.page, source.field));
    const drifted = pageHashNow !== source.anchor.page_sha256;
    const stillExact = checked.located?.match.level === "exact" && checked.located.field === source.field;
    // Found, but no longer character-for-character in the same field: the
    // book changed under the stored text. Never report that as "verified".
    let status: VerificationStatus = checked.verification.status;
    if (status === "verified" && !stillExact) status = "verified_normalized";
    return {
        ...source,
        verification: { ...checked.verification, status },
        fetch: {
            complete: checked.page.complete,
            body_parts: checked.page.parts,
            truncated: checked.page.truncated,
            fetched_at: checked.verification.checked_at,
            problems: checked.page.problems,
        },
        drift: drifted
            ? { detected_at: nowIso(), previous_page_sha256: source.anchor.page_sha256 }
            : source.drift,
    };
}

export interface Parallel {
    book_id: number;
    book_name: string;
    page_id: number;
    printed_page: string | null;
    field: PageField;
    match: string;
    snippet: string;
}

/**
 * Where else a passage appears among the project's chosen books — typically
 * the base text quoted inside its commentaries. Uses the engine's library
 * search restricted to those books.
 */
export async function findParallels(
    gw: ShamelaGateway,
    text: string,
    bookIds: number[],
    limit: number,
): Promise<{ status: string; locations: Parallel[]; notes: string[] }> {
    if (bookIds.length === 0) throw new TeachingError("NO_BOOKS_SELECTED");
    const r = await gw.call<UpstreamVerify>("shamela_verify_quote", {
        quote: canonical(text),
        scope: { book_ids: bookIds },
        limit,
        response_format: "json",
    });
    if (!r.ok) throw new TeachingError(r.code, { detail: r.message });
    return {
        status: r.data.status,
        locations: r.data.locations.map((l) => ({
            book_id: l.book_id,
            book_name: l.book_name,
            page_id: l.page_id,
            printed_page: l.printed_page,
            field: l.field,
            match: l.match,
            snippet: l.snippet,
        })),
        notes: r.data.notes,
    };
}
