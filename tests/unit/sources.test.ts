import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decideStatus } from "../../src/sources.js";
import type { Verification } from "../../src/model.js";
import { FakeGateway } from "../fixtures/fakeLibrary.js";
import { harness, type Harness } from "../fixtures/harness.js";

let h: Harness;

async function project(kind: "series" | "research" = "series", extra: Record<string, unknown> = {}) {
    const r = await h.call("teaching_project_create", { kind, title: "Reihe Reinheit", ...extra });
    expect(r.isError).toBe(false);
    return r.data.project.project_id as string;
}

const codes = (r: { data: any }) => (r.data.open_checks as Array<{ code: string }>).map((c) => c.code);

describe("teaching_source_add — structure 1: single volume, printed numbering", () => {
    beforeEach(async () => {
        h = await harness();
        await project();
    });
    afterEach(async () => h.close());

    it("stores an exact passage as verified by both checks, with anchor and citation", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        expect(r.isError).toBe(false);
        const s = r.data.source;
        expect(s.source_id).toBe("S1");
        expect(s.verification.status).toBe("verified");
        expect(s.verification.local.level).toBe("exact");
        expect(s.verification.engine.on_claimed_page).toBe(true);
        expect(s.anchor).toMatchObject({ book_id: 1001, page_id: 2, printed_page: "6", auto_numbered: false });
        expect(s.anchor.quote_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(s.anchor.url).toBe("https://shamela.ws/book/1001/2");
        expect(s.toc_path).toEqual(["كتاب الطهارة", "فصل في المياه"]);
        expect(s.fetch.complete).toBe(true);
        expect(s.citation.shamela).toContain("مختصر المثال");
        expect(codes(r)).toEqual([]);
    });

    it("stores the page's diacritised wording when the quotation was typed without diacritics", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 4, quote: "الوضوء شرط لصحة الصلاة" });
        expect(r.isError).toBe(false);
        expect(r.data.source.verification.status).toBe("verified_normalized");
        expect(r.data.source.text_ar).toBe("الوُضُوءُ شَرْطٌ لِصِحَّةِ الصَّلَاةِ");
        expect(r.data.source.submitted_text).toBe("الوضوء شرط لصحة الصلاة");
        expect(codes(r)).toContain("SOURCE_NORMALIZED");
    });

    it("refuses a passage that is not on the page and stores nothing", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "الماء المستعمل لا يرفع الحدث عند أكثرهم" });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/^QUOTE_NOT_VERIFIED/);
        expect(h.store.sources(h.store.listProjects()[0]!.project_id).sources).toHaveLength(0);
    });

    it("can keep an unverified passage, but only as a blocking open check", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "الماء المستعمل لا يرفع الحدث عند أكثرهم", keep_unverified: true });
        expect(r.isError).toBe(false);
        expect(r.data.source.verification.status).toBe("not_found");
        expect(codes(r)).toContain("SOURCE_NOT_VERIFIED");
    });

    it("maps a printed page number to its page id", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, printed_page: 7, quote: "يباح اتخاذ كل إناء طاهر واستعماله" });
        expect(r.isError).toBe(false);
        expect(r.data.source.anchor).toMatchObject({ page_id: 3, printed_page: "7" });
    });

    it("marks passages from the editor's footnote", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 3, quote: "والمثبت من الأصل المخطوط" });
        expect(r.isError).toBe(false);
        expect(r.data.source.field).toBe("foot");
        expect(codes(r)).toContain("EDITOR_NOTE");
    });

    it("returns the existing source for a duplicate", async () => {
        await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        expect(r.data.duplicate).toBe(true);
        expect(r.data.source.source_id).toBe("S1");
    });

    it("rejects passages too short to check", async () => {
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة" });
        expect(r.text).toMatch(/^QUOTE_TOO_SHORT/);
    });
});

describe("teaching_source_add — structure 2: volumes with repeating printed pages", () => {
    beforeEach(async () => {
        h = await harness();
        await project();
    });
    afterEach(async () => h.close());

    it("refuses to guess when a printed page occurs in several volumes", async () => {
        const r = await h.call("teaching_source_add", { book_id: 2002, printed_page: 1, quote: "يباح اتخاذ كل إناء طاهر واستعماله" });
        expect(r.text).toMatch(/^PRINTED_PAGE_AMBIGUOUS/);
        const loc = await h.call("teaching_locate", { book_id: 2002, printed_page: 1 });
        expect(loc.data.unique).toBe(false);
        expect(loc.data.candidates.map((c: any) => c.part)).toEqual(["1", "2"]);
    });

    it("resolves printed page + volume to the right page", async () => {
        const r = await h.call("teaching_source_add", { book_id: 2002, printed_page: 1, part: "2", quote: "والعلة في ذلك الخيلاء" });
        expect(r.isError).toBe(false);
        expect(r.data.source.anchor).toMatchObject({ page_id: 4, part: "2", printed_page: "2/1" });
    });

    it("reports a printed page given as page id (the commonest citation error)", async () => {
        // The passage is on printed page 1 of volume 2 (page id 4); page id 1 is another page.
        const r = await h.call("teaching_source_add", { book_id: 2002, page_id: 1, quote: "والعلة في ذلك الخيلاء" });
        expect(r.text).toMatch(/^QUOTE_NOT_VERIFIED/);
        expect(r.text).toContain('"printed_page_confusion"');
        expect(r.text).toMatch(/"page_ids": \[\s*4\s*\]/);
    });

    it("reads every body part of a long page before checking", async () => {
        const r = await h.call("teaching_source_add", { book_id: 2002, page_id: 5, quote: "يغسل سبع مرات إحداهن بالتراب" });
        expect(r.isError).toBe(false);
        expect(r.data.source.fetch).toMatchObject({ complete: true, body_parts: 2 });
        expect(h.gw.calls.filter((c) => c.tool === "shamela_get_page" && c.args.page_id === 5).map((c) => c.args.body_part)).toEqual([1, 2]);
    });

    it("finds the base text inside the commentary", async () => {
        await h.call("teaching_book_set", { book_id: 1001, role: "base" });
        await h.call("teaching_book_set", { book_id: 2002, role: "commentary" });
        const r = await h.call("teaching_parallels", { text: "يباح اتخاذ كل إناء طاهر واستعماله" });
        expect(r.isError).toBe(false);
        expect(r.data.searched_book_ids).toEqual([2002]);
        expect(r.data.locations[0]).toMatchObject({ book_id: 2002, page_id: 4 });
    });
});

describe("teaching_source_add — structure 3 and failure modes", () => {
    afterEach(async () => h.close());

    it("flags Shamela's automatic page numbering", async () => {
        h = await harness();
        await project("research", { research_question: "Adab des Lernenden" });
        const r = await h.call("teaching_source_add", { book_id: 3003, page_id: 2, quote: "أن يوقر شيخه ويحسن السؤال" });
        expect(r.data.source.anchor.auto_numbered).toBe(true);
        expect(codes(r)).toContain("AUTO_NUMBERED");
    });

    it("explains a book that is not downloaded, with the download hint", async () => {
        h = await harness();
        await project();
        const r = await h.call("teaching_source_add", { book_id: 9999, page_id: 1, quote: "أي نص من هذا الكتاب" });
        expect(r.text).toMatch(/^BOOK_NOT_DOWNLOADED/);
        expect(r.text).toContain("https://shamela.ws/book/9999");
        const b = await h.call("teaching_book_set", { book_id: 9999, role: "base" });
        expect(b.isError).toBe(false);
        expect(b.data.book.downloaded).toBe(false);
        expect(b.data.download.candidate.link).toBe("https://shamela.ws/book/9999");
        expect(codes(b)).toContain("BOOK_NOT_DOWNLOADED");
    });

    it("reports an unknown book id", async () => {
        h = await harness();
        await project();
        const r = await h.call("teaching_source_add", { book_id: 4242, page_id: 1, quote: "نص لا وجود لكتابه" });
        expect(r.text).toMatch(/^BOOK_NOT_FOUND/);
    });

    it("never reports 'verified' when the engine check could not run", async () => {
        h = await harness({ gw: new FakeGateway(undefined, { engineDown: true }) });
        await project();
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        expect(r.data.source.verification.status).toBe("verified_local");
        expect(r.data.source.verification.engine.error).toContain("HELPER_DIED");
        expect(codes(r)).toContain("ENGINE_CHECK_MISSING");
    });

    it("records a truncated page fetch as a blocking check", async () => {
        h = await harness({ gw: new FakeGateway(undefined, { truncate: [[1001, 2]] }) });
        await project();
        const r = await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        expect(r.data.source.fetch.complete).toBe(false);
        expect(codes(r)).toContain("FETCH_INCOMPLETE");
    });

    it("detects a page that changed after saving, without replacing the stored text", async () => {
        h = await harness();
        await project();
        await h.call("teaching_source_add", { book_id: 1001, page_id: 2, quote: "المياه ثلاثة أقسام: طهور وطاهر ونجس" });
        h.gw.editPage(1001, 2, "فصل في المياه. المياه قسمان: طهور ونجس.");
        const r = await h.call("teaching_source_recheck", {});
        expect(r.data.results[0]).toMatchObject({ source_id: "S1", before: "verified", after: "not_found", drift: true });
        expect((r.data.open_checks as any[]).map((c) => c.code)).toEqual(expect.arrayContaining(["SOURCE_DRIFT", "SOURCE_NOT_VERIFIED"]));
        const list = await h.call("teaching_source_list", {});
        expect(list.data.sources[0].text_ar).toBe("المياه ثلاثة أقسام: طهور وطاهر ونجس");
    });
});

describe("decideStatus", () => {
    const engine = (o: Partial<Verification["engine"]>): Verification["engine"] => ({
        ran: true,
        status: "verbatim",
        checked: "claimed_page",
        on_claimed_page: true,
        field: "body",
        differences: [],
        printed_page_confusion: null,
        error: null,
        ...o,
    });
    const local = (level: "exact" | "bare" | "loose") =>
        ({ field: "body", match: { level, original: "x", start: 0, end: 1, occurrences: 1 } }) as const;

    it("needs both checks for 'verified'", () => {
        expect(decideStatus(local("exact"), engine({}))).toBe("verified");
        expect(decideStatus(local("bare"), engine({}))).toBe("verified_normalized");
        expect(decideStatus(local("exact"), engine({ ran: false, status: null }))).toBe("verified_local");
    });

    it("never resolves a disagreement in favour of 'found'", () => {
        expect(decideStatus(local("exact"), engine({ status: "not_found", on_claimed_page: false }))).toBe("not_found");
        expect(decideStatus(local("exact"), engine({ status: "verbatim", on_claimed_page: false }))).toBe("not_found");
        expect(decideStatus(null, engine({ status: "verbatim", on_claimed_page: false }))).toBe("not_found");
        expect(decideStatus(null, engine({ status: "differs" }))).toBe("differs");
        expect(decideStatus(null, engine({ ran: false, status: null }))).toBe("unverifiable");
    });
});
