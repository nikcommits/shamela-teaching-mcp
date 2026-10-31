/**
 * Rendering a unit (or a research result) for use outside the assistant.
 *
 * Quotation text is taken from the source folder at render time — the unit
 * file holds only source ids — so an export can only print what the checks
 * verified. Every block carries its label (original text, translation,
 * summary, own explanation …), and the source folder and the open checks are
 * appended so the reader sees what is and is not verified.
 */

import type { UiLang } from "./config.js";
import type { Block, Project, Source, Translation, Unit } from "./model.js";
import type { OpenCheck } from "./checks.js";
import { checkText, messages, type Messages } from "./i18n/index.js";
import { ACCEPTED } from "./sources.js";

export type ExportFormat = "markdown" | "html" | "json";

export interface ExportInput {
    project: Project;
    unit: Unit | null;
    sources: Source[];
    translations: Translation[];
    checks: OpenCheck[];
    lang: UiLang;
    generatedAt: string;
    versions: { teaching: string; engine: string };
}

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function location(s: Source, L: Messages): string {
    const parts: string[] = [];
    if (s.anchor.part) parts.push(`${L.labels.volume} ${s.anchor.part}`);
    if (s.anchor.printed_page) parts.push(`${L.labels.page} ${s.anchor.printed_page}`);
    const loc = parts.join(" / ") || `#${s.anchor.page_id}`;
    return s.anchor.auto_numbered ? `${loc} (${L.labels.autoNumbered})` : loc;
}

function statusMark(s: Source, L: Messages): string {
    const ok = ACCEPTED.has(s.verification.status) && s.fetch.complete && !s.drift;
    return `${ok ? "✓" : "⚠"} ${L.status[s.verification.status] ?? s.verification.status}`;
}

function translationLabel(t: Translation, L: Messages): string {
    if (t.status === "reviewed" && t.review) return `${L.labels.translation} (${t.lang}) — ${L.labels.reviewedBy} ${t.review.by}`;
    if (t.status === "rejected") return `${L.labels.translation} (${t.lang}) — ${L.labels.rejected}`;
    return `${L.labels.translation} (${t.lang}) — ${L.labels.machineUnreviewed}`;
}

/** Blocks to render: the unit's, or for a project-level export every source in order. */
function blocksOf(input: ExportInput): Block[] {
    if (input.unit) return input.unit.blocks;
    const out: Block[] = [];
    for (const s of input.sources) {
        out.push({ kind: "quote", source_id: s.source_id });
        for (const t of input.translations.filter((x) => x.source_id === s.source_id && x.status !== "rejected")) {
            out.push({ kind: "translation", translation_id: t.translation_id });
        }
    }
    return out;
}

function booksLine(p: Project, role: string): string {
    return p.books
        .filter((b) => b.role === role)
        .map((b) => `${b.book_name}${b.author_name ? ` — ${b.author_name}` : ""} [${b.book_id}]`)
        .join("; ");
}

// --- Markdown ----------------------------------------------------------------

export function renderMarkdown(input: ExportInput): string {
    const L = messages(input.lang);
    const { project: p, unit } = input;
    const bySource = new Map(input.sources.map((s) => [s.source_id, s]));
    const byTranslation = new Map(input.translations.map((t) => [t.translation_id, t]));
    const used = new Set<string>();
    const out: string[] = [];
    const rtl = (text: string) => `<div dir="rtl" lang="ar">\n\n${text}\n\n</div>`;

    out.push(`# ${unit ? unit.title : p.title}`, "");
    const meta: Array<[string, string]> = [[L.labels.project, `${p.title} (${p.kind === "series" ? L.labels.kindSeries : L.labels.kindResearch})`]];
    if (p.research_question) meta.push([L.labels.researchQuestion, p.research_question]);
    if (p.focus) meta.push([L.labels.focus, p.focus]);
    const base = booksLine(p, "base");
    if (base) meta.push([L.labels.baseBook, base]);
    const comm = booksLine(p, "commentary");
    if (comm) meta.push([L.labels.commentaries, comm]);
    if (p.audience) meta.push([L.labels.audience, p.audience]);
    meta.push([L.labels.teachingLanguage, p.teaching_language]);
    meta.push([L.labels.generated, input.generatedAt]);
    for (const [k, v] of meta) out.push(`- **${k}:** ${v}`);
    out.push("");

    if (unit && unit.objectives.length) {
        out.push(`## ${L.labels.objectives}`, "", ...unit.objectives.map((o) => `- ${o}`), "");
    }

    for (const b of blocksOf(input)) {
        switch (b.kind) {
            case "heading":
                out.push(`## ${b.text}`, "");
                break;
            case "quote": {
                const s = bySource.get(b.source_id);
                if (!s) break;
                used.add(s.source_id);
                const warn = ACCEPTED.has(s.verification.status) ? "" : ` — **${L.labels.unverifiedWarning}**`;
                const field = s.field !== "body" ? ` — ${L.labels.editorNote}` : "";
                out.push(`**[${L.labels.quote} · ${s.source_id}]**${field}${warn}`, "");
                out.push(rtl(s.text_ar));
                out.push(`— ${s.book_name}, ${location(s, L)} [^${s.source_id}]`, "");
                break;
            }
            case "translation": {
                const t = byTranslation.get(b.translation_id);
                if (!t) break;
                used.add(t.source_id);
                out.push(`**[${translationLabel(t, L)} · ${t.source_id}]**`, "", `> ${t.text.replace(/\n/g, "\n> ")}`, "");
                break;
            }
            case "summary":
                b.source_ids.forEach((id) => used.add(id));
                out.push(`**[${L.labels.summary} · ${b.source_ids.join(", ")}]**`, "", b.text, "");
                break;
            case "explanation":
                b.source_ids.forEach((id) => used.add(id));
                out.push(`**[${L.labels.explanation}${b.source_ids.length ? ` · ${b.source_ids.join(", ")}` : ""}]**`, "", b.text, "");
                break;
            case "task":
                out.push(`**[${L.labels.task}]**`, "", b.text, "");
                break;
            case "note":
                out.push(`**[${L.labels.note}]**`, "", b.text, "");
                break;
        }
    }

    // Source folder for every source the document uses.
    const usedSources = input.sources.filter((s) => used.has(s.source_id));
    if (usedSources.length) {
        out.push(`## ${L.labels.sourceFolder}`, "");
        out.push(`| ${L.labels.source} | ${L.labels.book} | ${L.labels.location} | ${L.labels.verification} | ${L.labels.link} |`);
        out.push("|---|---|---|---|---|");
        for (const s of usedSources) {
            out.push(
                `| ${s.source_id} | ${s.book_name}${s.author_name ? ` — ${s.author_name}` : ""} | ${location(s, L)} | ${statusMark(s, L)} | ${s.anchor.url ?? "—"} |`,
            );
        }
        out.push("");
        for (const s of usedSources) {
            out.push(`[^${s.source_id}]: ${(s.citation.full ?? s.citation.shamela ?? s.book_name).replace(/\n+/g, " ")}`);
        }
        out.push("");
    }

    out.push(`## ${L.labels.openChecks}`, "");
    if (input.checks.length === 0) out.push(L.labels.noOpenChecks);
    for (const c of input.checks) out.push(`- **${L.severity[c.severity]}** — ${checkText(input.lang, c.code, c.params)}`);
    out.push("", `*${L.labels.reviewDisclaimer}*`, "");
    out.push(`<sub>shamela-teaching-mcp ${input.versions.teaching} · shamela-mcp ${input.versions.engine}</sub>`, "");
    return out.join("\n");
}

// --- HTML ----------------------------------------------------------------------

export function renderHtml(input: ExportInput): string {
    const L = messages(input.lang);
    const { project: p, unit } = input;
    const bySource = new Map(input.sources.map((s) => [s.source_id, s]));
    const byTranslation = new Map(input.translations.map((t) => [t.translation_id, t]));
    const used = new Set<string>();
    const body: string[] = [];
    const para = (t: string) => t.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`).join("");
    const label = (t: string, cls: string) => `<div class="label ${cls}">${esc(t)}</div>`;

    body.push(`<h1>${esc(unit ? unit.title : p.title)}</h1>`);
    const meta: Array<[string, string]> = [[L.labels.project, `${p.title} (${p.kind === "series" ? L.labels.kindSeries : L.labels.kindResearch})`]];
    if (p.research_question) meta.push([L.labels.researchQuestion, p.research_question]);
    if (p.focus) meta.push([L.labels.focus, p.focus]);
    const base = booksLine(p, "base");
    if (base) meta.push([L.labels.baseBook, base]);
    const comm = booksLine(p, "commentary");
    if (comm) meta.push([L.labels.commentaries, comm]);
    if (p.audience) meta.push([L.labels.audience, p.audience]);
    meta.push([L.labels.teachingLanguage, p.teaching_language]);
    meta.push([L.labels.generated, input.generatedAt]);
    body.push(`<dl class="meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd dir="auto">${esc(v)}</dd>`).join("")}</dl>`);
    if (unit && unit.objectives.length) {
        body.push(`<h2>${esc(L.labels.objectives)}</h2><ul>${unit.objectives.map((o) => `<li dir="auto">${esc(o)}</li>`).join("")}</ul>`);
    }

    for (const b of blocksOf(input)) {
        switch (b.kind) {
            case "heading":
                body.push(`<h2 dir="auto">${esc(b.text)}</h2>`);
                break;
            case "quote": {
                const s = bySource.get(b.source_id);
                if (!s) break;
                used.add(s.source_id);
                const ok = ACCEPTED.has(s.verification.status);
                const extra = [s.field !== "body" ? L.labels.editorNote : "", ok ? "" : L.labels.unverifiedWarning].filter(Boolean).join(" — ");
                body.push(
                    `<section class="block quote${ok ? "" : " unverified"}">${label(`${L.labels.quote} · ${s.source_id}${extra ? ` — ${extra}` : ""}`, "l-quote")}` +
                        `<blockquote dir="rtl" lang="ar">${para(s.text_ar)}</blockquote>` +
                        `<div class="cite" dir="auto">— ${esc(s.book_name)}, ${esc(location(s, L))} <a href="#src-${esc(s.source_id)}">[${esc(s.source_id)}]</a></div></section>`,
                );
                break;
            }
            case "translation": {
                const t = byTranslation.get(b.translation_id);
                if (!t) break;
                used.add(t.source_id);
                body.push(
                    `<section class="block translation ${t.status}">${label(`${translationLabel(t, L)} · ${t.source_id}`, "l-translation")}<div lang="${esc(t.lang)}" dir="auto">${para(t.text)}</div></section>`,
                );
                break;
            }
            case "summary":
                b.source_ids.forEach((id) => used.add(id));
                body.push(`<section class="block summary">${label(`${L.labels.summary} · ${b.source_ids.join(", ")}`, "l-summary")}<div dir="auto">${para(b.text)}</div></section>`);
                break;
            case "explanation":
                b.source_ids.forEach((id) => used.add(id));
                body.push(
                    `<section class="block explanation">${label(`${L.labels.explanation}${b.source_ids.length ? ` · ${b.source_ids.join(", ")}` : ""}`, "l-explanation")}<div dir="auto">${para(b.text)}</div></section>`,
                );
                break;
            case "task":
                body.push(`<section class="block task">${label(L.labels.task, "l-task")}<div dir="auto">${para(b.text)}</div></section>`);
                break;
            case "note":
                body.push(`<section class="block note">${label(L.labels.note, "l-note")}<div dir="auto">${para(b.text)}</div></section>`);
                break;
        }
    }

    const usedSources = input.sources.filter((s) => used.has(s.source_id));
    if (usedSources.length) {
        body.push(`<h2>${esc(L.labels.sourceFolder)}</h2><table><thead><tr><th>${esc(L.labels.source)}</th><th>${esc(L.labels.book)}</th><th>${esc(L.labels.location)}</th><th>${esc(L.labels.verification)}</th></tr></thead><tbody>`);
        for (const s of usedSources) {
            const link = s.anchor.url ? ` <a href="${esc(s.anchor.url)}">↗</a>` : "";
            body.push(
                `<tr id="src-${esc(s.source_id)}"><td>${esc(s.source_id)}</td><td dir="auto">${esc(s.book_name)}${s.author_name ? ` — ${esc(s.author_name)}` : ""}${link}<div class="full" dir="auto">${esc((s.citation.full ?? "").replace(/\n+/g, " "))}</div></td><td dir="auto">${esc(location(s, L))}</td><td>${esc(statusMark(s, L))}</td></tr>`,
            );
        }
        body.push("</tbody></table>");
    }
    body.push(`<h2>${esc(L.labels.openChecks)}</h2>`);
    if (input.checks.length === 0) body.push(`<p>${esc(L.labels.noOpenChecks)}</p>`);
    else {
        body.push(
            `<ul class="checks">${input.checks.map((c) => `<li class="${c.severity}"><strong>${esc(L.severity[c.severity])}</strong> — ${esc(checkText(input.lang, c.code, c.params))}</li>`).join("")}</ul>`,
        );
    }
    body.push(`<p class="disclaimer">${esc(L.labels.reviewDisclaimer)}</p>`);
    body.push(`<footer>shamela-teaching-mcp ${esc(input.versions.teaching)} · shamela-mcp ${esc(input.versions.engine)}</footer>`);

    return `<!doctype html>
<html lang="${input.lang}" dir="${L.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(unit ? unit.title : p.title)}</title>
<style>
:root { --fg:#1d1d1f; --muted:#5f6368; --line:#d9d9de; --bg:#fff; --ok:#1e7d32; --warn:#b26a00; --bad:#b3261e; }
body { font-family: "Amiri", "Noto Naskh Arabic", "Geeza Pro", system-ui, sans-serif; color:var(--fg); background:var(--bg); max-width:52rem; margin:2rem auto; padding:0 1rem; line-height:1.6; }
h1 { font-size:1.6rem; } h2 { font-size:1.25rem; margin-top:2rem; border-bottom:1px solid var(--line); }
.meta { display:grid; grid-template-columns:max-content 1fr; gap:.2rem 1rem; color:var(--muted); }
.meta dt { font-weight:600; }
.block { margin:1.2rem 0; padding:.6rem .9rem; border-inline-start:4px solid var(--line); }
.block.quote { border-color:var(--ok); } .block.quote.unverified { border-color:var(--bad); }
.block.translation { border-color:#3367d6; } .block.translation.machine_unreviewed { border-style:dashed; }
.block.summary { border-color:#8e44ad; } .block.explanation { border-color:#7f8c8d; }
.label { font-size:.8rem; font-weight:600; color:var(--muted); text-transform:none; margin-bottom:.3rem; }
blockquote { margin:0; font-size:1.25rem; line-height:2; }
.cite { font-size:.85rem; color:var(--muted); }
table { border-collapse:collapse; width:100%; font-size:.9rem; } th, td { border:1px solid var(--line); padding:.35rem .5rem; vertical-align:top; text-align:start; }
.full { font-size:.8rem; color:var(--muted); }
.checks .blocker { color:var(--bad); } .checks .warning { color:var(--warn); }
.disclaimer, footer { font-size:.8rem; color:var(--muted); }
@media print { body { margin:0; max-width:none; } a { color:inherit; } }
</style>
</head>
<body>
${body.join("\n")}
</body>
</html>
`;
}

// --- JSON ----------------------------------------------------------------------

export function renderJson(input: ExportInput): string {
    return `${JSON.stringify(
        {
            generated_at: input.generatedAt,
            versions: input.versions,
            project: input.project,
            unit: input.unit,
            sources: input.sources,
            translations: input.translations,
            open_checks: input.checks,
        },
        null,
        2,
    )}\n`;
}
