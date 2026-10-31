/**
 * Unit validation and the open-check list.
 *
 * Everything here is a pure function of the stored files, so the list a
 * teacher sees is reproducible: the same files give the same checks on every
 * machine and in every assistant.
 */

import type { Block, Project, Source, Translation, Unit } from "./model.js";
import { ACCEPTED, TeachingError } from "./sources.js";
import { foldText } from "./text.js";
import { isStale } from "./translation.js";

export type Severity = "blocker" | "warning" | "info";

export interface OpenCheck {
    severity: Severity;
    code: string;
    subject: { type: "project" | "book" | "source" | "translation" | "unit"; id: string };
    params: Record<string, string | number | null>;
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };

/** Words of a source that, appearing in a row in free text, count as an unmarked quotation. */
export const UNMARKED_QUOTE_WORDS = 6;

/**
 * Validate blocks submitted for a unit. Rejects references to things that do
 * not exist and summaries that do not say what they summarise — those are
 * integrity errors, not open checks.
 */
export function validateBlocks(blocks: Block[], sources: Source[], translations: Translation[]): void {
    const sourceIds = new Set(sources.map((s) => s.source_id));
    const translationIds = new Set(translations.map((t) => t.translation_id));
    blocks.forEach((b, i) => {
        const fail = (reason: string) => {
            throw new TeachingError("INVALID_BLOCK", { index: i, reason });
        };
        switch (b.kind) {
            case "quote":
                if (!sourceIds.has(b.source_id)) fail(`unknown source ${b.source_id}`);
                break;
            case "translation":
                if (!translationIds.has(b.translation_id)) fail(`unknown translation ${b.translation_id}`);
                break;
            case "summary":
                if (!b.text.trim()) fail("empty text");
                if (b.source_ids.length === 0) fail("a summary must name the sources it summarises");
                for (const id of b.source_ids) if (!sourceIds.has(id)) fail(`unknown source ${id}`);
                break;
            case "explanation":
                if (!b.text.trim()) fail("empty text");
                for (const id of b.source_ids) if (!sourceIds.has(id)) fail(`unknown source ${id}`);
                break;
            case "heading":
            case "task":
            case "note":
                if (!b.text.trim()) fail("empty text");
                break;
            default:
                fail(`unknown kind ${(b as { kind: string }).kind}`);
        }
    });
}

function shingles(text: string, n: number): string[] {
    const words = foldText(text, "bare").split(" ").filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
    return out;
}

/**
 * Free-text blocks that reproduce a run of a source's wording without marking
 * it as a quotation. Returns the first offending source per block.
 */
export function unmarkedQuotes(blocks: Block[], sources: Source[]): Array<{ index: number; kind: string; source_id: string }> {
    const index = new Map<string, string>();
    for (const s of sources) for (const sh of shingles(s.text_ar, UNMARKED_QUOTE_WORDS)) if (!index.has(sh)) index.set(sh, s.source_id);
    const out: Array<{ index: number; kind: string; source_id: string }> = [];
    blocks.forEach((b, i) => {
        if (b.kind === "quote" || b.kind === "translation") return;
        for (const sh of shingles(b.text, UNMARKED_QUOTE_WORDS)) {
            const hit = index.get(sh);
            if (hit) {
                out.push({ index: i, kind: b.kind, source_id: hit });
                return;
            }
        }
    });
    return out;
}

export function computeChecks(
    project: Project,
    sources: Source[],
    translations: Translation[],
    units: Unit[],
): OpenCheck[] {
    const out: OpenCheck[] = [];
    const add = (c: OpenCheck) => out.push(c);
    const bySource = new Map(sources.map((s) => [s.source_id, s]));
    const byTranslation = new Map(translations.map((t) => [t.translation_id, t]));

    // --- project ------------------------------------------------------------
    if (project.kind === "series" && !project.books.some((b) => b.role === "base")) {
        add({ severity: "warning", code: "NO_BASE_BOOK", subject: { type: "project", id: project.project_id }, params: {} });
    }
    for (const b of project.books) {
        if (!b.downloaded) {
            add({
                severity: "blocker",
                code: "BOOK_NOT_DOWNLOADED",
                subject: { type: "book", id: String(b.book_id) },
                params: { book_id: b.book_id, book: b.book_name },
            });
        }
    }
    if (project.translation.enabled && !project.translation.target_lang) {
        add({ severity: "warning", code: "TRANSLATION_TARGET_MISSING", subject: { type: "project", id: project.project_id }, params: {} });
    }

    // --- sources ------------------------------------------------------------
    for (const s of sources) {
        const subject = { type: "source" as const, id: s.source_id };
        const v = s.verification;
        if (v.status === "verified_local") {
            add({ severity: "warning", code: "ENGINE_CHECK_MISSING", subject, params: { id: s.source_id } });
        } else if (!ACCEPTED.has(v.status)) {
            add({ severity: "blocker", code: "SOURCE_NOT_VERIFIED", subject, params: { id: s.source_id, status: v.status } });
        } else if (v.status === "verified_normalized" && s.submitted_text) {
            add({ severity: "info", code: "SOURCE_NORMALIZED", subject, params: { id: s.source_id } });
        }
        if (!s.fetch.complete) {
            add({ severity: "blocker", code: "FETCH_INCOMPLETE", subject, params: { id: s.source_id, detail: s.fetch.problems.join("; ") || null } });
        }
        if (s.drift) add({ severity: "blocker", code: "SOURCE_DRIFT", subject, params: { id: s.source_id } });
        if (s.anchor.auto_numbered) add({ severity: "info", code: "AUTO_NUMBERED", subject, params: { id: s.source_id } });
        if (s.field !== "body") add({ severity: "info", code: "EDITOR_NOTE", subject, params: { id: s.source_id } });
        if (v.engine.ran && v.engine.field && v.engine.field !== s.field) {
            add({ severity: "warning", code: "ENGINE_FIELD_MISMATCH", subject, params: { id: s.source_id } });
        }
        if (v.local.occurrences > 1) {
            add({ severity: "info", code: "MULTIPLE_OCCURRENCES", subject, params: { id: s.source_id, n: v.local.occurrences } });
        }
    }

    // --- translations -------------------------------------------------------
    for (const t of translations) {
        const subject = { type: "translation" as const, id: t.translation_id };
        const src = bySource.get(t.source_id);
        if (isStale(t, src)) {
            add({ severity: "blocker", code: "TRANSLATION_STALE", subject, params: { id: t.translation_id, source: t.source_id } });
        }
        if (t.status === "machine_unreviewed") {
            add({ severity: "warning", code: "TRANSLATION_UNREVIEWED", subject, params: { id: t.translation_id, source: t.source_id } });
        }
        for (const g of t.glossary_missing) {
            add({ severity: "warning", code: "GLOSSARY_MISMATCH", subject, params: { id: t.translation_id, term: g.term_ar, rendering: g.rendering } });
        }
    }

    // --- units --------------------------------------------------------------
    const lang = project.translation.enabled ? project.translation.target_lang : null;
    for (const u of units) {
        const subject = { type: "unit" as const, id: u.unit_id };
        if (u.blocks.length === 0) add({ severity: "warning", code: "UNIT_EMPTY", subject, params: { unit: u.unit_id } });
        const translatedSources = new Set<string>();
        for (const b of u.blocks) {
            const refs: string[] =
                b.kind === "quote"
                    ? [b.source_id]
                    : b.kind === "summary" || b.kind === "explanation"
                      ? b.source_ids
                      : [];
            for (const r of refs) {
                if (!bySource.has(r)) add({ severity: "blocker", code: "UNIT_MISSING_REFERENCE", subject, params: { unit: u.unit_id, ref: r } });
            }
            if (b.kind === "translation") {
                const t = byTranslation.get(b.translation_id);
                if (!t) {
                    add({ severity: "blocker", code: "UNIT_MISSING_REFERENCE", subject, params: { unit: u.unit_id, ref: b.translation_id } });
                } else {
                    translatedSources.add(t.source_id);
                    if (t.status === "rejected") {
                        add({ severity: "blocker", code: "TRANSLATION_REJECTED_IN_USE", subject, params: { unit: u.unit_id, id: t.translation_id } });
                    }
                }
            }
        }
        if (lang) {
            for (const b of u.blocks) {
                if (b.kind === "quote" && !translatedSources.has(b.source_id)) {
                    add({ severity: "info", code: "TRANSLATION_MISSING", subject, params: { unit: u.unit_id, source: b.source_id, lang } });
                }
            }
        }
        for (const m of unmarkedQuotes(u.blocks, sources)) {
            add({ severity: "warning", code: "UNMARKED_QUOTE", subject, params: { unit: u.unit_id, kind: m.kind, source: m.source_id } });
        }
    }

    return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Checks relevant to one unit: its own, and those of the sources and translations it uses. */
export function checksForUnit(all: OpenCheck[], unit: Unit, translations: Translation[]): OpenCheck[] {
    const sourceIds = new Set<string>();
    const translationIds = new Set<string>();
    for (const b of unit.blocks) {
        if (b.kind === "quote") sourceIds.add(b.source_id);
        if (b.kind === "summary" || b.kind === "explanation") b.source_ids.forEach((id) => sourceIds.add(id));
        if (b.kind === "translation") {
            translationIds.add(b.translation_id);
            const t = translations.find((x) => x.translation_id === b.translation_id);
            if (t) sourceIds.add(t.source_id);
        }
    }
    return all.filter(
        (c) =>
            (c.subject.type === "unit" && c.subject.id === unit.unit_id) ||
            (c.subject.type === "source" && sourceIds.has(c.subject.id)) ||
            (c.subject.type === "translation" && translationIds.has(c.subject.id)) ||
            c.subject.type === "project" ||
            c.subject.type === "book",
    );
}
