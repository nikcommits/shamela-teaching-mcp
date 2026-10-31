/**
 * Thin, typed wrappers around the upstream tools the teaching layer needs.
 *
 * Only the fields used here are declared, so an additive upstream change
 * (a new field) never breaks this layer; a removed or retyped field is a
 * MAJOR upstream release under its own semver rules.
 */

import type { GatewayResult, ShamelaGateway } from "./gateway.js";
import type { PageField } from "./model.js";

export interface UpstreamBook {
    book_id: number;
    book_name: string;
    category: string | null;
    available: boolean;
    downloaded: boolean;
    content_status: "readable" | "downloaded_no_pages" | "flagged_file_missing" | "not_downloaded";
    authors: Array<{ author_id: number; author_name: string; death_year: number | null; role: "main" | "co" }>;
    edition: string | null;
    editor: string | null;
    publisher: string | null;
    notes: string[];
}

export interface UpstreamPage {
    book_id: number;
    book_name: string;
    author_name: string | null;
    page_id: number;
    printed_page: string | null;
    part: string | null;
    body: string;
    foot: string;
    comment: string;
    body_part: number;
    body_total_parts: number;
    body_has_more: boolean;
    prev_page_id: number | null;
    next_page_id: number | null;
    containing_titles: Array<{ title_id: number; title_text: string; page_id: number }>;
    citation: string;
    citation_auto_numbered: boolean;
    truncated?: boolean;
}

export interface UpstreamVerify {
    quote: string;
    checked: "claimed_page" | "claimed_book" | "library" | "nothing";
    status: "verbatim" | "differs" | "partial" | "not_found" | "unverifiable";
    printed_page_confusion?: { given: number; page_ids: number[] };
    locations: Array<{
        book_id: number;
        book_name: string;
        author_name: string | null;
        page_id: number;
        printed_page: string | null;
        auto_numbered: boolean;
        field: PageField;
        match: "verbatim" | "differs" | "partial";
        differences: string[];
        matched_words: number;
        quote_words: number;
        snippet: string;
        source_url: string;
        readable: boolean;
    }>;
    notes: string[];
    truncated?: boolean;
}

export interface UpstreamCitation {
    formatted: string;
    style: "shamela" | "short" | "full";
    components: { source_url?: string; source_url_is_book_level?: boolean } & Record<string, unknown>;
    notes: string[];
}

export interface UpstreamBookParts {
    book_id: number;
    is_multi_volume: boolean;
    total_pages: number;
    parts: Array<{ part: string; page_count: number; first_page_id: number; last_page_id: number }>;
}

export interface UpstreamToc {
    titles: Array<{ title_id: number; title_text: string; page_id: number; has_children: boolean }>;
}

export interface UpstreamHealth {
    server_version: string;
    status: "ok" | "degraded" | "not_started";
    startup_error?: { code: string; message: string; install_root: string | null };
    install_root: string | null;
    catalog_books: number;
    downloaded_books: number;
    notes: string[];
}

export interface UpstreamSuggest {
    results: Array<{ book_id: number; book_name: string; author_name: string | null; status: string; link: string }>;
    next_steps: string[];
}

export interface FullPage {
    page: UpstreamPage;
    /** All body parts joined. */
    body: string;
    complete: boolean;
    parts: number;
    truncated: boolean;
    problems: string[];
}

/** Hard stop for a pathological page; a real page has a handful of parts. */
const MAX_BODY_PARTS = 60;

/**
 * Read a page completely: every body part, and a record of whether anything
 * was cut. A quotation checked against an incomplete page is not checked.
 */
export async function fetchFullPage(
    gw: ShamelaGateway,
    bookId: number,
    pageId: number,
): Promise<GatewayResult<FullPage>> {
    const bodies: string[] = [];
    let first: UpstreamPage | null = null;
    let truncated = false;
    const problems: string[] = [];
    let complete = true;
    for (let part = 1; part <= MAX_BODY_PARTS; part++) {
        const r = await gw.call<UpstreamPage>("shamela_get_page", {
            book_id: bookId,
            page_id: pageId,
            body_part: part,
            response_format: "json",
        });
        if (!r.ok) {
            if (part === 1) return r;
            complete = false;
            problems.push(`body part ${part}: ${r.code}`);
            break;
        }
        const d = r.data;
        if (d.truncated) truncated = true;
        if (part === 1) first = d;
        else if (d.body_part !== part) {
            // The server clamps an out-of-range part to the last one; seeing
            // that means our count and its count disagree.
            complete = false;
            problems.push(`asked for body part ${part}, got ${d.body_part}`);
            break;
        }
        bodies.push(d.body ?? "");
        if (!d.body_has_more) break;
        if (part === MAX_BODY_PARTS) {
            complete = false;
            problems.push(`more than ${MAX_BODY_PARTS} body parts`);
        }
    }
    if (truncated) {
        complete = false;
        problems.push("response truncated by the server");
    }
    const page = first!;
    if (page.body_total_parts !== bodies.length && complete) {
        complete = false;
        problems.push(`expected ${page.body_total_parts} body parts, read ${bodies.length}`);
    }
    return {
        ok: true,
        data: { page, body: bodies.join("\n"), complete, parts: bodies.length, truncated, problems },
    };
}

export function fieldText(p: FullPage, field: PageField): string {
    if (field === "body") return p.body;
    if (field === "foot") return p.page.foot ?? "";
    return p.page.comment ?? "";
}

export async function getBook(gw: ShamelaGateway, bookId: number): Promise<GatewayResult<UpstreamBook>> {
    return gw.call<UpstreamBook>("shamela_get_book", { book_id: bookId, response_format: "json" });
}

/** True when the book's text can actually be read on this machine. */
export function isReadable(b: UpstreamBook): boolean {
    return b.content_status === "readable";
}

export function mainAuthor(b: UpstreamBook): { name: string | null; death: number | null } {
    const a = b.authors.find((x) => x.role === "main") ?? b.authors[0];
    return { name: a?.author_name ?? null, death: a?.death_year ?? null };
}
