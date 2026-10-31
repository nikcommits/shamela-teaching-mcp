import { describe, expect, it } from "vitest";

import { canonical, foldText, hasArabic, jsonHash, locateQuote, textHash, wordCount } from "../../src/text.js";

const PAGE = "بَابُ الوُضُوءِ. الوُضُوءُ شَرْطٌ لِصِحَّةِ الصَّلَاةِ، وَفُرُوضُهُ سِتَّةٌ.";

describe("locateQuote", () => {
    it("finds an exact quotation and returns it unchanged", () => {
        const m = locateQuote("فصل في المياه. المياه ثلاثة أقسام: طهور وطاهر ونجس.", "المياه ثلاثة أقسام");
        expect(m?.level).toBe("exact");
        expect(m?.original).toBe("المياه ثلاثة أقسام");
    });

    it("finds an undiacritised quotation on a diacritised page and returns the page's wording", () => {
        const m = locateQuote(PAGE, "الوضوء شرط لصحة الصلاة");
        expect(m?.level).toBe("bare");
        expect(m?.original).toBe("الوُضُوءُ شَرْطٌ لِصِحَّةِ الصَّلَاةِ");
    });

    it("tolerates hamza seats, alif maqsura, ta marbuta and digits only at the loose level", () => {
        const m = locateQuote("قال: إن الصلاة على النبي واجبة في ٣ مواضع", "ان الصلاه علي النبي واجبه في 3 مواضع");
        expect(m?.level).toBe("loose");
        expect(m?.original).toBe("إن الصلاة على النبي واجبة في ٣ مواضع");
    });

    it("does not find different wording", () => {
        expect(locateQuote(PAGE, "الوضوء ركن من أركان الصلاة")).toBeNull();
    });

    it("counts repeated occurrences", () => {
        expect(locateQuote("قال الشيخ كذا. ثم قال الشيخ كذا.", "قال الشيخ كذا")?.occurrences).toBe(2);
    });

    it("ignores markup and whitespace differences", () => {
        const m = locateQuote("<span data-type='title'>باب</span>\n\nالمياه   ثلاثة\nأقسام", "المياه ثلاثة أقسام");
        expect(m?.level).toBe("exact");
    });
});

describe("hashes and helpers", () => {
    it("hashes the canonical form", () => {
        expect(textHash("المياه  ثلاثة\nأقسام")).toBe(textHash("المياه ثلاثة أقسام"));
        expect(textHash("المياه ثلاثة أقسام")).not.toBe(textHash("المياهُ ثلاثة أقسام"));
    });

    it("hashes JSON independent of key order", () => {
        expect(jsonHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(jsonHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
    });

    it("folds and counts", () => {
        expect(foldText("الصَّلَاةُ", "bare")).toBe("الصلاة");
        expect(foldText("إلى الصلاة", "loose")).toBe("الي الصلاه");
        expect(wordCount("قال : المياه ثلاثة")).toBe(3);
        expect(canonical(" a \n b ")).toBe("a b");
        expect(hasArabic("Text mit عربي")).toBe(true);
        expect(hasArabic("only latin")).toBe(false);
    });
});
