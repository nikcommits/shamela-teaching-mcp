/**
 * The optional translation layer.
 *
 * The server does not translate — the assistant's model does. What the server
 * guarantees is that a translation is made WITH its context and stays bound to
 * the exact Arabic it renders:
 *
 *   - teaching_translation_context hands out a context bundle (the passage,
 *     the whole page with the editor's notes kept apart, neighbouring pages,
 *     chapter path, author and era, the project's glossary and audience) and
 *     records its hash in a ledger;
 *   - teaching_translation_save accepts a translation only with a hash from
 *     that ledger issued for the same source and the same source text;
 *   - glossary terms present in the source must appear in their agreed
 *     rendering, otherwise the translation carries an open check;
 *   - every translation starts as "machine_unreviewed" and only a person can
 *     mark it reviewed.
 */

import type { ShamelaGateway } from "./gateway.js";
import type { GlossaryEntry, IssuedContext, Project, Source, Translation, TranslationsFile } from "./model.js";
import { fetchFullPage } from "./shamela.js";
import { TeachingError } from "./sources.js";
import { nowIso } from "./store.js";
import { canonical, foldText, jsonHash, textHash } from "./text.js";

/** Model-facing translation rules. Kept in English like all tool descriptions. */
export const TRANSLATION_RULES: Record<string, string[]> = {
    _all: [
        "Translate only the passage in `source.text_ar`; the page and neighbouring pages are context, not text to translate.",
        "Do not add content that is not in the Arabic. Put any necessary explanation in square brackets [ ] so it is visibly not part of the translation.",
        "Keep the distinction between the author's text (matn/body) and the editor's footnotes (foot); `source.field` says which one the passage is.",
        "Use the glossary renderings exactly for every glossary term that occurs in the passage.",
        "Mark Qur'anic verses and hadith wording that occur inside the passage as such; do not paraphrase them silently.",
        "Where the Arabic is ambiguous, translate the most likely reading and name the alternative in a bracketed note instead of hiding the ambiguity.",
        "Render honorific formulas faithfully (e.g. ṣallā llāhu ʿalayhi wa-sallam) or with an agreed abbreviation from the glossary.",
        "Preserve proper names; on first occurrence give a transliteration.",
    ],
    de: [
        "Zielsprache Deutsch: sachlich-genaues Deutsch, keine freie Nachdichtung; Satzbau darf geglättet werden, Inhalt nicht.",
        "Transliteration nach DMG (z. B. ʿilm, ḥadīṯ, fiqh, iǧmāʿ). Fachbegriffe beim ersten Vorkommen: deutsche Wiedergabe + Umschrift in Klammern, sofern das Glossar nichts anderes festlegt.",
        "Koranverse: Sure:Vers angeben; vorhandene deutsche Koranübersetzungen nur nennen, wenn der Nutzer eine festgelegt hat — sonst eigene, wörtliche Übersetzung, als solche gekennzeichnet.",
        "Anredeformeln und Eulogien nicht weglassen; Abkürzungen nur nach Glossar.",
        "Zielgruppe (`project.audience`) beeinflusst nur Erläuterungen in [ ], nie den übersetzten Inhalt.",
    ],
};

export interface ContextBundle {
    source: {
        source_id: string;
        text_ar: string;
        field: Source["field"];
        book_id: number;
        book_name: string;
        author_name: string | null;
        author_death_hijri: number | null;
        part: string | null;
        printed_page: string | null;
        toc_path: string[];
        role: Source["role"];
    };
    page: { body: string; foot: string; comment: string; complete: boolean };
    neighbours: Array<{ page_id: number; position: "before" | "after"; body: string; complete: boolean }>;
    glossary: GlossaryEntry[];
    project: {
        audience: string | null;
        focus: string | null;
        teaching_language: string;
        target_lang: string;
    };
    rules: string[];
}

/** Glossary entries for the target language whose Arabic term occurs in the text. */
export function glossaryHits(glossary: GlossaryEntry[], textAr: string, lang: string): GlossaryEntry[] {
    const hay = foldText(textAr, "loose");
    return glossary.filter((g) => g.lang === lang && hay.includes(foldText(g.term_ar, "loose")));
}

/** Glossary terms present in the source whose rendering does not appear in the translation. */
export function glossaryMissing(
    glossary: GlossaryEntry[],
    textAr: string,
    translation: string,
    lang: string,
): Array<{ term_ar: string; rendering: string }> {
    const t = translation.normalize("NFC").toLocaleLowerCase();
    return glossaryHits(glossary, textAr, lang)
        .filter((g) => !t.includes(g.rendering.normalize("NFC").toLocaleLowerCase()))
        .map((g) => ({ term_ar: g.term_ar, rendering: g.rendering }));
}

export async function buildContext(
    gw: ShamelaGateway,
    project: Project,
    source: Source,
    neighbourPages: number,
): Promise<ContextBundle> {
    const lang = project.translation.target_lang;
    if (!project.translation.enabled || !lang) throw new TeachingError("TRANSLATION_DISABLED");

    const fp = await fetchFullPage(gw, source.book_id, source.anchor.page_id);
    if (!fp.ok) throw new TeachingError(fp.code, { detail: fp.message });
    const page = fp.data;

    const neighbours: ContextBundle["neighbours"] = [];
    let before = page.page.prev_page_id;
    let after = page.page.next_page_id;
    for (let i = 0; i < neighbourPages; i++) {
        if (before !== null) {
            const r = await fetchFullPage(gw, source.book_id, before);
            if (r.ok) {
                neighbours.unshift({ page_id: before, position: "before", body: canonical(r.data.body), complete: r.data.complete });
                before = r.data.page.prev_page_id;
            } else before = null;
        }
        if (after !== null) {
            const r = await fetchFullPage(gw, source.book_id, after);
            if (r.ok) {
                neighbours.push({ page_id: after, position: "after", body: canonical(r.data.body), complete: r.data.complete });
                after = r.data.page.next_page_id;
            } else after = null;
        }
    }

    const bookRef = project.books.find((b) => b.book_id === source.book_id);
    return {
        source: {
            source_id: source.source_id,
            text_ar: source.text_ar,
            field: source.field,
            book_id: source.book_id,
            book_name: source.book_name,
            author_name: source.author_name,
            author_death_hijri: bookRef?.author_death_hijri ?? null,
            part: source.anchor.part,
            printed_page: source.anchor.printed_page,
            toc_path: source.toc_path,
            role: source.role,
        },
        page: {
            body: canonical(page.body),
            foot: canonical(page.page.foot ?? ""),
            comment: canonical(page.page.comment ?? ""),
            complete: page.complete,
        },
        neighbours,
        glossary: glossaryHits(project.glossary, `${source.text_ar} ${page.body}`, lang),
        project: {
            audience: project.audience,
            focus: project.focus,
            teaching_language: project.teaching_language,
            target_lang: lang,
        },
        rules: [...(TRANSLATION_RULES._all ?? []), ...(TRANSLATION_RULES[lang] ?? [])],
    };
}

export function issueContext(file: TranslationsFile, source: Source, bundle: ContextBundle): IssuedContext {
    const entry: IssuedContext = {
        context_sha256: jsonHash(bundle),
        source_id: source.source_id,
        source_quote_sha256: source.anchor.quote_sha256,
        issued_at: nowIso(),
    };
    if (!file.issued_contexts.some((c) => c.context_sha256 === entry.context_sha256)) {
        file.issued_contexts.push(entry);
    }
    return entry;
}

export function saveTranslation(
    project: Project,
    file: TranslationsFile,
    source: Source,
    input: { text: string; context_sha256: string },
): Translation {
    const lang = project.translation.target_lang;
    if (!project.translation.enabled || !lang) throw new TeachingError("TRANSLATION_DISABLED");
    const issued = file.issued_contexts.find((c) => c.context_sha256 === input.context_sha256);
    if (!issued || issued.source_id !== source.source_id) {
        throw new TeachingError("CONTEXT_NOT_ISSUED", { source_id: source.source_id });
    }
    if (issued.source_quote_sha256 !== source.anchor.quote_sha256) {
        throw new TeachingError("CONTEXT_STALE", { source_id: source.source_id });
    }
    const text = input.text.trim();
    if (!text) throw new TeachingError("EMPTY_TEXT");

    project.counters.translation += 1;
    const t: Translation = {
        translation_id: `T${project.counters.translation}`,
        source_id: source.source_id,
        lang,
        text,
        status: "machine_unreviewed",
        created_at: nowIso(),
        source_quote_sha256: source.anchor.quote_sha256,
        context_sha256: input.context_sha256,
        glossary_missing: glossaryMissing(project.glossary, source.text_ar, text, lang),
        review: null,
    };
    file.translations.push(t);
    return t;
}

/** A translation no longer matches its source when the stored passage changed. */
export function isStale(t: Translation, source: Source | undefined): boolean {
    return !source || source.anchor.quote_sha256 !== t.source_quote_sha256 || textHash(source.text_ar) !== t.source_quote_sha256;
}
