/**
 * An in-memory stand-in for the upstream shamela-mcp tools.
 *
 * The texts are written for these tests (no book content is shipped). Three
 * different book structures plus a missing book cover what the teaching layer
 * has to handle:
 *
 *   1001  single volume, printed page numbers, diacritised page, a footnote
 *   2002  two volumes whose printed page numbers repeat; a page long enough to
 *         be delivered in two body parts; contains base-text quotations
 *   3003  single volume numbered automatically by Shamela (no print edition)
 *   9999  in the catalogue but not downloaded
 *
 * The fake follows the upstream result shapes for the fields the teaching
 * layer reads. Whether those shapes match the real engine is checked by
 * tests/unit/contract.test.ts (names and parameters) and by the live test
 * against a real installation (tests/live).
 */

import type { GatewayResult, ShamelaGateway } from "../../src/gateway.js";
import { canonical, foldText, locateQuote } from "../../src/text.js";

export interface FakePage {
    id: number;
    part: string | null;
    printed: number | null;
    /** Body parts as the engine would deliver them (1 element for a short page). */
    body: string[];
    foot?: string;
    titles: string[];
}

export interface FakeBook {
    id: number;
    name: string;
    author: string;
    death: number | null;
    downloaded: boolean;
    autoNumbered: boolean;
    pages: FakePage[];
}

export function makeLibrary(): FakeBook[] {
    return [
        {
            id: 1001,
            name: "مختصر المثال في الطهارة",
            author: "المؤلف الأول",
            death: 620,
            downloaded: true,
            autoNumbered: false,
            pages: [
                {
                    id: 1,
                    part: null,
                    printed: 5,
                    body: ["كتاب الطهارة. الطهارة في اللغة النظافة، وفي الاصطلاح رفع الحدث وزوال الخبث بالماء الطهور."],
                    titles: ["كتاب الطهارة"],
                },
                {
                    id: 2,
                    part: null,
                    printed: 6,
                    body: ["فصل في المياه. المياه ثلاثة أقسام: طهور وطاهر ونجس، فالطهور يرفع الحدث ويزيل النجس."],
                    titles: ["كتاب الطهارة", "فصل في المياه"],
                },
                {
                    id: 3,
                    part: null,
                    printed: 7,
                    body: ["فصل في الآنية. يباح اتخاذ كل إناء طاهر واستعماله إلا آنية الذهب والفضة."],
                    foot: "في نسخة أخرى: إلا آنية الذهب وحدها، والمثبت من الأصل المخطوط.",
                    titles: ["كتاب الطهارة", "فصل في الآنية"],
                },
                {
                    id: 4,
                    part: null,
                    printed: 8,
                    body: ["بَابُ الوُضُوءِ. الوُضُوءُ شَرْطٌ لِصِحَّةِ الصَّلَاةِ، وَفُرُوضُهُ سِتَّةٌ عِنْدَ أَكْثَرِ أَهْلِ العِلْمِ."],
                    titles: ["كتاب الطهارة", "باب الوضوء"],
                },
            ],
        },
        {
            id: 2002,
            name: "شرح المثال",
            author: "الشارح الثاني",
            death: 790,
            downloaded: true,
            autoNumbered: false,
            pages: [
                { id: 1, part: "1", printed: 1, body: ["مقدمة الشارح. الحمد لله الذي جعل الطهارة شطر الإيمان."], titles: ["المقدمة"] },
                {
                    id: 2,
                    part: "1",
                    printed: 2,
                    body: ["قال المصنف: المياه ثلاثة أقسام: طهور وطاهر ونجس. قال الشارح: هذا تقسيم مشهور عند الفقهاء، وبعضهم جعلها قسمين."],
                    titles: ["كتاب الطهارة", "المياه"],
                },
                { id: 3, part: "1", printed: 3, body: ["تتمة في أحكام المياه المستعملة في رفع الحدث."], titles: ["كتاب الطهارة", "المياه"] },
                {
                    id: 4,
                    part: "2",
                    printed: 1,
                    body: ["قال المصنف: يباح اتخاذ كل إناء طاهر واستعماله إلا آنية الذهب والفضة. قال الشارح: والعلة في ذلك الخيلاء."],
                    titles: ["كتاب الطهارة", "الآنية"],
                },
                {
                    id: 5,
                    part: "2",
                    printed: 2,
                    body: [
                        "مسألة في تطهير الآنية. اختلف أهل العلم في كيفية تطهير الإناء إذا ولغ فيه الكلب.",
                        "والصحيح أن الإناء يغسل سبع مرات إحداهن بالتراب، وهذا قول جمهور الفقهاء من أهل الحديث.",
                    ],
                    titles: ["كتاب الطهارة", "الآنية", "تطهير الآنية"],
                },
                { id: 6, part: "2", printed: 3, body: ["فصل في جلود الميتة وما يطهر منها بالدباغ."], titles: ["كتاب الطهارة", "الجلود"] },
            ],
        },
        {
            id: 3003,
            name: "رسالة في آداب طالب العلم",
            author: "مؤلف الرسالة",
            death: null,
            downloaded: true,
            autoNumbered: true,
            pages: [
                { id: 1, part: null, printed: 1, body: ["ينبغي لطالب العلم أن يخلص النية ويصبر على طول الطلب ويحفظ وقته."], titles: ["آداب الطالب"] },
                { id: 2, part: null, printed: 2, body: ["ومن آدابه أن يوقر شيخه ويحسن السؤال ويقلل الكلام فيما لا يعنيه."], titles: ["آداب الطالب"] },
            ],
        },
        {
            id: 9999,
            name: "كتاب غير منزل",
            author: "مؤلف غائب",
            death: 500,
            downloaded: false,
            autoNumbered: false,
            pages: [],
        },
    ];
}

type Json = Record<string, unknown>;

export interface FakeOptions {
    /** Simulate the search engine being unavailable for shamela_verify_quote. */
    engineDown?: boolean;
    /** Book/page pairs whose get_page responses come back truncated. */
    truncate?: Array<[number, number]>;
}

export class FakeGateway implements ShamelaGateway {
    readonly engineVersion = "fake-1.3.0";
    readonly calls: Array<{ tool: string; args: Json }> = [];
    constructor(
        public books: FakeBook[] = makeLibrary(),
        public opts: FakeOptions = {},
    ) {}

    private book(id: number): FakeBook | undefined {
        return this.books.find((b) => b.id === id);
    }

    /** Change a page's body (simulates a library update). */
    editPage(bookId: number, pageId: number, body: string): void {
        const p = this.book(bookId)!.pages.find((x) => x.id === pageId)!;
        p.body = [body];
    }

    private err(code: string, message = code): GatewayResult<never> {
        return { ok: false, code, message };
    }

    private printed(b: FakeBook, p: FakePage): string | null {
        if (p.printed === null) return null;
        return p.part ? `${p.part}/${p.printed}` : String(p.printed);
    }

    async pageIdsForPrinted(bookId: number, page: number, part: string | null): Promise<GatewayResult<number[]>> {
        const b = this.book(bookId);
        if (!b) return this.err("BOOK_NOT_FOUND");
        if (!b.downloaded) return this.err("BOOK_NOT_DOWNLOADED");
        return { ok: true, data: b.pages.filter((p) => p.printed === page && (part === null || p.part === part)).map((p) => p.id) };
    }

    async call<T>(tool: string, args: Json): Promise<GatewayResult<T>> {
        this.calls.push({ tool, args });
        const r = this.dispatch(tool, args);
        return r as GatewayResult<T>;
    }

    private dispatch(tool: string, a: Json): GatewayResult<unknown> {
        switch (tool) {
            case "shamela_health":
                return {
                    ok: true,
                    data: {
                        server_version: this.engineVersion,
                        status: "ok",
                        install_root: "/fake/shamela",
                        catalog_books: this.books.length,
                        downloaded_books: this.books.filter((b) => b.downloaded).length,
                        notes: [],
                    },
                };
            case "shamela_get_book": {
                const b = this.book(a.book_id as number);
                if (!b) return this.err("BOOK_NOT_FOUND");
                return {
                    ok: true,
                    data: {
                        book_id: b.id,
                        book_name: b.name,
                        category: "الفقه",
                        available: true,
                        downloaded: b.downloaded,
                        content_status: b.downloaded ? "readable" : "not_downloaded",
                        authors: [{ author_id: b.id * 10, author_name: b.author, death_year: b.death, role: "main" }],
                        edition: null,
                        editor: null,
                        publisher: null,
                        notes: [],
                    },
                };
            }
            case "shamela_get_book_parts": {
                const b = this.book(a.book_id as number);
                if (!b) return this.err("BOOK_NOT_FOUND");
                const parts = [...new Set(b.pages.map((p) => p.part ?? "1"))];
                return {
                    ok: true,
                    data: {
                        book_id: b.id,
                        is_multi_volume: parts.length > 1,
                        total_pages: b.pages.length,
                        parts: parts.map((part) => {
                            const ps = b.pages.filter((p) => (p.part ?? "1") === part);
                            return { part, page_count: ps.length, first_page_id: ps[0]!.id, last_page_id: ps[ps.length - 1]!.id };
                        }),
                    },
                };
            }
            case "shamela_get_toc": {
                const b = this.book(a.book_id as number);
                if (!b) return this.err("BOOK_NOT_FOUND");
                const tops = [...new Set(b.pages.map((p) => p.titles[0]!))];
                return {
                    ok: true,
                    data: { titles: tops.map((t, i) => ({ title_id: i + 1, title_text: t, page_id: b.pages.find((p) => p.titles[0] === t)!.id, has_children: true })) },
                };
            }
            case "shamela_suggest_download": {
                const ids = (a.book_ids as number[]) ?? [];
                return {
                    ok: true,
                    data: {
                        results: ids.map((id) => {
                            const b = this.book(id);
                            return { book_id: id, book_name: b?.name ?? "?", author_name: b?.author ?? null, status: b?.downloaded ? "downloaded" : "available", link: `https://shamela.ws/book/${id}` };
                        }),
                        next_steps: ["Open the Shamela app and download the book."],
                    },
                };
            }
            case "shamela_get_page": {
                const b = this.book(a.book_id as number);
                if (!b) return this.err("BOOK_NOT_FOUND");
                if (!b.downloaded) return this.err("BOOK_NOT_DOWNLOADED");
                const idx = b.pages.findIndex((p) => p.id === a.page_id);
                if (idx < 0) return this.err("PAGE_NOT_FOUND");
                const p = b.pages[idx]!;
                const total = p.body.length;
                const part = Math.min(Math.max(1, (a.body_part as number) ?? 1), total);
                const truncated = (this.opts.truncate ?? []).some(([bb, pp]) => bb === b.id && pp === p.id);
                return {
                    ok: true,
                    data: {
                        book_id: b.id,
                        book_name: b.name,
                        author_name: b.author,
                        page_id: p.id,
                        printed_page: this.printed(b, p),
                        part: p.part,
                        body: p.body[part - 1],
                        foot: part === 1 ? p.foot ?? "" : "",
                        comment: "",
                        body_part: part,
                        body_total_parts: total,
                        body_has_more: part < total,
                        prev_page_id: b.pages[idx - 1]?.id ?? null,
                        next_page_id: b.pages[idx + 1]?.id ?? null,
                        containing_titles: p.titles.map((t, i) => ({ title_id: i + 1, title_text: t, page_id: p.id })),
                        citation: `«${b.name}» (${this.printed(b, p)})`,
                        citation_auto_numbered: b.autoNumbered,
                        ...(truncated ? { truncated: true, truncation_message: "simulated" } : {}),
                    },
                };
            }
            case "shamela_get_citation": {
                const b = this.book(a.book_id as number);
                if (!b) return this.err("BOOK_NOT_FOUND");
                const p = b.pages.find((x) => x.id === a.page_id);
                const ref = p ? this.printed(b, p) : null;
                const formatted =
                    a.style === "full"
                        ? `${b.author} (ت ${b.death ?? "؟"}هـ)، ${b.name}${ref ? `، ${ref}` : ""}`
                        : `«${b.name}» (${ref ?? ""})${a.text ? `:\n«${a.text as string}»` : ""}`;
                return {
                    ok: true,
                    data: {
                        formatted,
                        style: a.style,
                        components: { source_url: p ? `https://shamela.ws/book/${b.id}/${p.id}` : `https://shamela.ws/book/${b.id}`, source_url_is_book_level: !p },
                        notes: a.style === "full" ? ["publisher not in master.db"] : [],
                    },
                };
            }
            case "shamela_verify_quote":
                return this.verify(a);
            default:
                return this.err("INTERNAL", `fake does not implement ${tool}`);
        }
    }

    private verify(a: Json): GatewayResult<unknown> {
        if (this.opts.engineDown) return this.err("HELPER_DIED", "simulated engine failure");
        const quote = a.quote as string;
        const candidates: Array<{ b: FakeBook; p: FakePage }> = [];
        let checked = "library";
        if (typeof a.book_id === "number") {
            const b = this.book(a.book_id);
            if (!b) return this.err("BOOK_NOT_FOUND");
            if (!b.downloaded) {
                return { ok: true, data: { quote, checked: "nothing", status: "unverifiable", locations: [], notes: [] } };
            }
            checked = typeof a.page_id === "number" ? "claimed_page" : "claimed_book";
            for (const p of b.pages) if (typeof a.page_id !== "number" || p.id === a.page_id) candidates.push({ b, p });
        } else {
            const ids = ((a.scope as Json | undefined)?.book_ids as number[] | undefined) ?? this.books.map((b) => b.id);
            for (const id of ids) {
                const b = this.book(id);
                if (b?.downloaded) for (const p of b.pages) candidates.push({ b, p });
            }
        }
        const locations = [];
        let best: "verbatim" | "differs" | "not_found" = "not_found";
        for (const { b, p } of candidates) {
            for (const [field, text] of [["body", p.body.join("\n")], ["foot", p.foot ?? ""]] as const) {
                const m = locateQuote(text, quote);
                if (!m) continue;
                const match = m.level === "exact" ? "verbatim" : "differs";
                if (match === "verbatim") best = "verbatim";
                else if (best === "not_found") best = "differs";
                locations.push({
                    book_id: b.id,
                    book_name: b.name,
                    author_name: b.author,
                    page_id: p.id,
                    printed_page: this.printed(b, p),
                    auto_numbered: b.autoNumbered,
                    field,
                    match,
                    differences: match === "verbatim" ? [] : ["diacritics"],
                    matched_words: foldText(quote, "bare").split(" ").length,
                    quote_words: foldText(quote, "bare").split(" ").length,
                    snippet: canonical(text).slice(0, 120),
                    source_url: `https://shamela.ws/book/${b.id}/${p.id}`,
                    readable: true,
                });
            }
        }
        const data: Json = { quote, checked, status: best, locations: locations.slice(0, (a.limit as number) ?? 5), notes: [] };
        // The commonest hand-citation error: a printed page given as page id.
        if (best === "not_found" && typeof a.book_id === "number" && typeof a.page_id === "number") {
            const b = this.book(a.book_id)!;
            const ids = b.pages.filter((p) => p.printed === a.page_id && locateQuote(p.body.join("\n"), quote)).map((p) => p.id);
            if (ids.length) data.printed_page_confusion = { given: a.page_id, page_ids: ids };
        }
        return { ok: true, data };
    }
}
