/**
 * The whole teaching workflow through the MCP interface: project → books →
 * sources → translation → unit → checks → export → resume in a new session.
 */

import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { harness, type Harness } from "../fixtures/harness.js";

let h: Harness;
afterEach(async () => h?.close());

async function setup(lang: "ar" | "de" = "de") {
    h = await harness({ lang });
    const p = await h.call("teaching_project_create", {
        kind: "series",
        title: "Fiqh der Reinheit",
        audience: "Erwachsene Anfänger",
        teaching_language: "de",
        translation_target: "de",
    });
    await h.call("teaching_book_set", { book_id: 1001, role: "base" });
    await h.call("teaching_book_set", { book_id: 2002, role: "commentary" });
    await h.call("teaching_project_update", { glossary_set: [{ term_ar: "طهور", rendering: "rein und reinigend" }] });
    const s1 = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
    const s2 = await h.call("teaching_source_add", { book_id: 2002, page_id: 2, quote: "هذا تقسيم مشهور عند الفقهاء" });
    expect(s1.isError || s2.isError).toBe(false);
    return p.data.project.project_id as string;
}

describe("translation layer", () => {
    it("hands out a context bundle with page, neighbours, glossary and rules", async () => {
        await setup();
        const r = await h.call("teaching_translation_context", { source_id: "S1" });
        expect(r.isError).toBe(false);
        const c = r.data.context;
        expect(r.data.context_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(c.source.text_ar).toBe("المياه ثلاثة أقسام: طهور وطاهر ونجس");
        expect(c.source.author_death_hijri).toBe(620);
        expect(c.neighbours.map((n: any) => n.position)).toEqual(["before", "after"]);
        expect(c.glossary).toEqual([expect.objectContaining({ term_ar: "طهور", rendering: "rein und reinigend" })]);
        expect(c.rules.join(" ")).toContain("DMG");
        expect(c.project.audience).toBe("Erwachsene Anfänger");
    });

    it("accepts a translation only with a context issued for that source", async () => {
        await setup();
        const bad = await h.call("teaching_translation_save", { source_id: "S1", text: "Das Wasser hat drei Arten.", context_sha256: "0".repeat(64) });
        expect(bad.text).toMatch(/^CONTEXT_NOT_ISSUED/);
        const c2 = await h.call("teaching_translation_context", { source_id: "S2" });
        const wrong = await h.call("teaching_translation_save", { source_id: "S1", text: "x", context_sha256: c2.data.context_sha256 });
        expect(wrong.text).toMatch(/^CONTEXT_NOT_ISSUED/);
    });

    it("binds the translation to the source text, checks the glossary and starts unreviewed", async () => {
        await setup();
        const c = await h.call("teaching_translation_context", { source_id: "S1" });
        const t = await h.call("teaching_translation_save", {
            source_id: "S1",
            text: "Das Wasser ist von dreierlei Art: ṭahūr, rein und unrein.",
            context_sha256: c.data.context_sha256,
        });
        expect(t.isError).toBe(false);
        expect(t.data.translation).toMatchObject({ translation_id: "T1", status: "machine_unreviewed", lang: "de" });
        expect(t.data.translation.glossary_missing).toEqual([{ term_ar: "طهور", rendering: "rein und reinigend" }]);
        expect((t.data.open_checks as any[]).map((x) => x.code).sort()).toEqual(["GLOSSARY_MISMATCH", "TRANSLATION_UNREVIEWED"]);

        const c2 = await h.call("teaching_translation_context", { source_id: "S1" });
        const ok = await h.call("teaching_translation_save", {
            source_id: "S1",
            text: "Das Wasser ist von dreierlei Art: rein und reinigend (ṭahūr), rein (ṭāhir) und unrein (naǧis).",
            context_sha256: c2.data.context_sha256,
        });
        expect(ok.data.translation.glossary_missing).toEqual([]);
        const rev = await h.call("teaching_translation_review", { translation_id: "T2", decision: "approve", reviewer: "Lehrkraft" });
        expect(rev.data.translation).toMatchObject({ status: "reviewed", review: { by: "Lehrkraft" } });
    });

    it("refuses translation when the project has no translation layer", async () => {
        h = await harness();
        await h.call("teaching_project_create", { kind: "research", title: "Nur Arabisch" });
        await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        const r = await h.call("teaching_translation_context", { source_id: "S1" });
        expect(r.text).toMatch(/^TRANSLATION_DISABLED/);
    });
});

describe("units, checks and export", () => {
    it("rejects broken references and summaries without sources", async () => {
        await setup();
        const unknown = await h.call("teaching_unit_save", { title: "Stunde 1", blocks: [{ kind: "quote", source_id: "S9" }] });
        expect(unknown.text).toMatch(/^INVALID_BLOCK/);
        const noSrc = await h.call("teaching_unit_save", { title: "Stunde 1", blocks: [{ kind: "summary", text: "Kurz gesagt", source_ids: [] }] });
        expect(noSrc.isError).toBe(true);
    });

    it("flags source wording pasted into free text as an unmarked quotation", async () => {
        await setup();
        const r = await h.call("teaching_unit_save", {
            title: "Stunde 1",
            blocks: [{ kind: "explanation", text: "Der Autor sagt: المياه ثلاثة أقسام: طهور وطاهر ونجس — das ist zentral.", source_ids: ["S1"] }],
        });
        expect(r.isError).toBe(false);
        expect((r.data.open_checks as any[]).map((c) => c.code)).toContain("UNMARKED_QUOTE");
    });

    it("exports a labelled unit with verified text from the source folder and the open checks", async () => {
        await setup("de");
        const c = await h.call("teaching_translation_context", { source_id: "S1" });
        await h.call("teaching_translation_save", {
            source_id: "S1",
            text: "Das Wasser ist von dreierlei Art: rein und reinigend (ṭahūr), rein (ṭāhir) und unrein (naǧis).",
            context_sha256: c.data.context_sha256,
        });
        const u = await h.call("teaching_unit_save", {
            title: "Stunde 1: Die Arten des Wassers",
            objectives: ["Die drei Wasserarten benennen"],
            blocks: [
                { kind: "heading", text: "Grundtext" },
                { kind: "quote", source_id: "S1" },
                { kind: "translation", translation_id: "T1" },
                { kind: "quote", source_id: "S2" },
                { kind: "summary", text: "Der Kommentar nennt die Einteilung verbreitet.", source_ids: ["S2"] },
                { kind: "explanation", text: "Wir vergleichen die Einteilung mit der Zweiteilung.", source_ids: [] },
                { kind: "task", text: "Ordnet Beispiele den drei Arten zu." },
            ],
        });
        expect(u.data.unit.unit_id).toBe("U1");

        const md = await h.call("teaching_export", { unit_id: "U1", format: "markdown" });
        expect(md.isError).toBe(false);
        const text: string = md.data.content;
        expect(fs.existsSync(md.data.path)).toBe(true);
        expect(text).toContain("**[Originaltext · S1]**");
        expect(text).toContain('<div dir="rtl" lang="ar">');
        expect(text).toContain("المياه ثلاثة أقسام: طهور وطاهر ونجس");
        expect(text).toContain("maschinelle Übersetzung, ungeprüft");
        expect(text).toContain("**[Zusammenfassung · S2]**");
        expect(text).toContain("**[Eigene Erklärung]**");
        expect(text).toContain("## Quellenmappe");
        expect(text).toContain("## Offene Prüfungen");
        expect(text).toMatch(/Für Quelle S2 gibt es keine Übersetzung/);

        const html = await h.call("teaching_export", { unit_id: "U1", format: "html" });
        expect(html.data.content).toContain('<blockquote dir="rtl" lang="ar">');
        expect(html.data.content).toContain('<html lang="de" dir="ltr">');
    });

    it("prints exports in Arabic by default", async () => {
        await setup("ar");
        await h.call("teaching_unit_save", { title: "الدرس الأول", blocks: [{ kind: "quote", source_id: "S1" }] });
        const md = await h.call("teaching_export", { unit_id: "U1" });
        expect(md.data.content).toContain("**[نص أصلي · S1]**");
        expect(md.data.content).toContain("## ملف المصادر");
        const html = await h.call("teaching_export", { unit_id: "U1", format: "html" });
        expect(html.data.content).toContain('<html lang="ar" dir="rtl">');
    });

    it("prints a quotation from the source folder even if the unit file is edited by hand", async () => {
        const pid = await setup();
        await h.call("teaching_unit_save", { title: "Stunde", blocks: [{ kind: "quote", source_id: "S1" }] });
        const unit = h.store.getUnit(pid, "U1");
        (unit.blocks[0] as any).text_ar = "نص مزور";
        h.store.saveUnit(unit);
        const md = await h.call("teaching_export", { unit_id: "U1" });
        expect(md.data.content).not.toContain("نص مزور");
        expect(md.data.content).toContain("المياه ثلاثة أقسام");
    });
});

describe("resuming in a new session", () => {
    it("remembers the last project and its settings", async () => {
        const pid = await setup();
        const dataDir = h.dataDir;
        await h.close();
        h = await harness({ dataDir });
        const st = await h.call("teaching_status");
        expect(st.data.last_project_id).toBe(pid);
        expect(st.data.library.downloaded_books).toBe(3);
        expect(st.data.next_steps.join(" ")).toContain(`resume`);
        const p = await h.call("teaching_project_get", {});
        expect(p.data.project.project_id).toBe(pid);
        expect(p.data.project.books.map((b: any) => b.role)).toEqual(["base", "commentary"]);
        expect(p.data.sources).toHaveLength(2);
    });

    it("asks for a project when none exists", async () => {
        h = await harness();
        const r = await h.call("teaching_project_get", {});
        expect(r.text).toMatch(/^NO_PROJECT/);
        const st = await h.call("teaching_status");
        expect(st.data.projects).toEqual([]);
        expect(st.data.next_steps.join(" ")).toContain("no_projects");
    });
});
