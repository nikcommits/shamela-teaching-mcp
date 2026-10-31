/**
 * User-facing text: check messages, errors, export labels.
 *
 * Arabic is the primary language and the default. German and English are
 * additional interface languages. Model-facing text (tool descriptions,
 * translation rules) stays in English, as in the upstream project, because it
 * is read by the assistant, not by the teacher. Source texts are never
 * translated by this catalogue — they are always printed in Arabic.
 */

import type { UiLang } from "../config.js";
import { ar } from "./ar.js";
import { de } from "./de.js";
import { en } from "./en.js";

export type P = Record<string, string | number | null | undefined>;

export interface Messages {
    dir: "rtl" | "ltr";
    labels: {
        quote: string;
        translation: string;
        summary: string;
        explanation: string;
        task: string;
        note: string;
        objectives: string;
        sourceFolder: string;
        openChecks: string;
        noOpenChecks: string;
        reviewDisclaimer: string;
        project: string;
        kindSeries: string;
        kindResearch: string;
        researchQuestion: string;
        focus: string;
        baseBook: string;
        commentaries: string;
        references: string;
        audience: string;
        teachingLanguage: string;
        generated: string;
        sources: string;
        source: string;
        book: string;
        location: string;
        verification: string;
        link: string;
        volume: string;
        page: string;
        autoNumbered: string;
        editorNote: string;
        machineUnreviewed: string;
        reviewedBy: string;
        rejected: string;
        unverifiedWarning: string;
        submittedDiffers: string;
    };
    status: Record<string, string>;
    severity: { blocker: string; warning: string; info: string };
    checks: Record<string, (p: P) => string>;
    errors: Record<string, (p: P) => string>;
    titles: Record<string, string>;
}

const CATALOGUES: Record<UiLang, Messages> = { ar, de, en };

export function messages(lang: UiLang): Messages {
    return CATALOGUES[lang];
}

/** Error text for a code, falling back to the code itself. */
export function errorText(lang: UiLang, code: string, p: P = {}): string {
    const f = CATALOGUES[lang].errors[code] ?? CATALOGUES[lang].errors._default!;
    return f({ code, ...p });
}

export function checkText(lang: UiLang, code: string, p: P = {}): string {
    const f = CATALOGUES[lang].checks[code];
    return f ? f(p) : code;
}
