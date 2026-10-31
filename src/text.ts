/**
 * Arabic text handling that the source checks rely on.
 *
 * Everything here is deterministic and dependency-free, so a check that uses it
 * gives the same answer on every machine and in every assistant. Nothing here
 * "corrects" a text: normalisation is only ever used to FIND a passage, and the
 * passage that is stored is always cut out of the original page text.
 */

import { createHash } from "node:crypto";

/** Arabic diacritics (tashkil), Quranic annotation marks and tatweel. */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/u;

/** Letter variants that hand-copied quotations commonly write differently. */
const LOOSE_LETTERS: Record<string, string> = {
    "أ": "ا",
    "إ": "ا",
    "آ": "ا",
    "ٱ": "ا",
    "ى": "ي",
    "ئ": "ي",
    "ؤ": "و",
    "ة": "ه",
};

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Punctuation ignored by the loose comparison (Arabic and Latin). */
const PUNCTUATION = /[\p{P}\p{S}]/u;

export type MatchLevel = "exact" | "bare" | "loose";

/** Remove inline HTML markup the way Shamela page text carries it. */
export function stripHtml(s: string): string {
    return s.replace(/<[^>]*>/g, " ");
}

/** NFC + collapse all whitespace runs to one space + trim. */
export function normalizeSpace(s: string): string {
    return s.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** The canonical form a stored text is hashed in: markup removed, spacing normalised. */
export function canonical(s: string): string {
    return normalizeSpace(stripHtml(s));
}

/** SHA-256 (hex) of the canonical form. Two texts with the same hash are the same text. */
export function textHash(s: string): string {
    return createHash("sha256").update(canonical(s), "utf8").digest("hex");
}

/** SHA-256 (hex) of an arbitrary JSON-serialisable value, keys sorted. */
export function jsonHash(value: unknown): string {
    return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

interface Folded {
    /** The folded text. */
    text: string;
    /** For every character of `text`, the index in the source string it came from. */
    origin: number[];
}

/**
 * Fold a string for searching at a given level, remembering where every kept
 * character came from so a match can be mapped back onto the original.
 */
function fold(source: string, level: MatchLevel): Folded {
    const out: string[] = [];
    const origin: number[] = [];
    let lastWasSpace = true; // suppress leading space
    const chars = Array.from(source.normalize("NFC"));
    // Array.from splits by code point; track UTF-16 offsets for slicing.
    let offset = 0;
    for (const ch of chars) {
        const at = offset;
        offset += ch.length;
        let c = ch;
        if (/\s/u.test(c)) {
            if (!lastWasSpace) {
                out.push(" ");
                origin.push(at);
                lastWasSpace = true;
            }
            continue;
        }
        if (level !== "exact" && DIACRITICS.test(c)) continue;
        if (level === "loose") {
            if (PUNCTUATION.test(c)) {
                if (!lastWasSpace) {
                    out.push(" ");
                    origin.push(at);
                    lastWasSpace = true;
                }
                continue;
            }
            c = LOOSE_LETTERS[c] ?? c;
            const ai = ARABIC_INDIC_DIGITS.indexOf(c);
            if (ai >= 0) c = String(ai);
            const pi = PERSIAN_DIGITS.indexOf(c);
            if (pi >= 0) c = String(pi);
        }
        out.push(c);
        origin.push(at);
        lastWasSpace = false;
    }
    if (out[out.length - 1] === " ") {
        out.pop();
        origin.pop();
    }
    return { text: out.join(""), origin };
}

/** Fold a string at a level (for comparisons that need no position mapping). */
export function foldText(s: string, level: MatchLevel): string {
    return fold(s, level).text;
}

export interface QuoteMatch {
    /** The strictest level at which the quote was found. */
    level: MatchLevel;
    /** The passage exactly as the source page writes it (canonical spacing). */
    original: string;
    /** UTF-16 offsets of the passage in the canonical page text. */
    start: number;
    end: number;
    /** How many times the folded quote occurs on the page at that level. */
    occurrences: number;
}

/**
 * Locate a quotation on a page and return the passage as the PAGE writes it.
 *
 * Tries the strictest comparison first. A match at "bare" means the wording is
 * the page's but diacritics differ; at "loose", hamza seats, alif maqsura, ta
 * marbuta, digits or punctuation differ as well. Either way the returned
 * `original` is cut from the page, never rebuilt from the quote.
 */
export function locateQuote(pageText: string, quote: string): QuoteMatch | null {
    const page = canonical(pageText);
    for (const level of ["exact", "bare", "loose"] as const) {
        const fp = fold(page, level);
        const fq = fold(canonical(quote), level).text;
        if (fq.length === 0) return null;
        const idx = fp.text.indexOf(fq);
        if (idx < 0) continue;
        let occurrences = 0;
        for (let i = fp.text.indexOf(fq); i >= 0; i = fp.text.indexOf(fq, i + 1)) occurrences++;
        const start = fp.origin[idx]!;
        const lastOrigin = fp.origin[idx + fq.length - 1]!;
        // Extend to the end of the last matched code point, then past any
        // diacritics that belong to it (they were skipped by the fold).
        let end = lastOrigin + (page.codePointAt(lastOrigin)! > 0xffff ? 2 : 1);
        if (level !== "exact") {
            while (end < page.length && DIACRITICS.test(page[end]!)) end++;
        }
        return { level, original: page.slice(start, end), start, end, occurrences };
    }
    return null;
}

/** Count Arabic/Latin words (whitespace-separated, punctuation-only tokens ignored). */
export function wordCount(s: string): number {
    return canonical(s)
        .split(" ")
        .filter((w) => w.length > 0 && !/^[\p{P}\p{S}]+$/u.test(w)).length;
}

/** True when the string contains Arabic letters. */
export function hasArabic(s: string): boolean {
    return /[؀-ۿݐ-ݿࢠ-ࣿ]/u.test(s);
}
