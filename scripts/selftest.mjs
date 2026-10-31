#!/usr/bin/env node
// Acceptance self-test against YOUR Shamela installation.
//
// Starts the built server (dist/index.js) exactly as an MCP host does, picks
// books from your own library (nothing is hard-coded), and walks through the
// workflow: verify a passage, refuse a altered one, resolve pages, handle a
// missing book, build a translation context, export a unit. Writes into a
// temporary data folder unless --data <dir> is given; never writes to Shamela.
//
//   npm run build && npm run selftest
//   npm run selftest -- --shamela "/path/to/Shamela" --keep
//
// Exit code 0 = all required steps passed.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const keep = args.includes("--keep");
const dataDir = opt("--data") ?? fs.mkdtempSync(path.join(os.tmpdir(), "shamela-teaching-selftest-"));
const env = { ...process.env, TEACHING_DATA_DIR: dataDir, TEACHING_LANG: opt("--lang") ?? "de" };
if (opt("--shamela")) env.SHAMELA_INSTALL_ROOT = opt("--shamela");

const entry = path.join(root, "dist", "index.js");
if (!fs.existsSync(entry)) {
    console.error("dist/index.js fehlt — zuerst `npm run build` ausführen.");
    process.exit(2);
}

const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: "pipe" });
let serverLog = "";
transport.stderr?.on("data", (d) => (serverLog += d));
const client = new Client({ name: "selftest", version: "1" });
await client.connect(transport);

const results = [];
const step = (name, ok, detail = "", required = true) => {
    results.push({ name, ok, detail, required });
    console.log(`${ok ? "✓" : required ? "✗" : "–"} ${name}${detail ? ` — ${detail}` : ""}`);
};
async function call(name, a = {}) {
    const r = await client.callTool({ name, arguments: a }, undefined, { timeout: 240_000 });
    return { isError: Boolean(r.isError), data: r.structuredContent ?? null, text: r.content?.[0]?.text ?? "" };
}
const words = (s) => s.replace(/<[^>]*>/g, " ").split(/\s+/).filter((w) => /[؀-ۿ]{2,}/.test(w));

try {
    // 1. Library
    const st = await call("teaching_status");
    const lib = st.data?.library ?? {};
    step("Bibliothek gefunden", lib.status === "ok" || lib.status === "degraded", lib.install_root ?? lib.startup_error?.message ?? st.text.slice(0, 200));
    if (!(lib.status === "ok" || lib.status === "degraded")) throw new Error("stop");
    step("Bücher heruntergeladen", lib.downloaded_books > 0, `${lib.downloaded_books} von ${lib.catalog_books}`);
    if (!(lib.downloaded_books > 0)) throw new Error("stop");

    // 2. Pick books from this library
    const dl = await call("shamela_list_downloaded_books", { limit: 50, response_format: "json" });
    const books = (dl.data?.books ?? []).filter((b) => b.content_status === "readable");
    let single = null;
    let multi = null;
    for (const b of books.slice(0, 40)) {
        const parts = await call("shamela_get_book_parts", { book_id: b.book_id, response_format: "json" });
        if (parts.isError) continue;
        if (parts.data.is_multi_volume && !multi) multi = { ...b, parts: parts.data.parts };
        if (!parts.data.is_multi_volume && !single) single = { ...b, parts: parts.data.parts };
        if (single && multi) break;
    }
    const primary = single ?? multi;
    step("Testbuch gewählt", Boolean(primary), primary ? `${primary.book_name} [${primary.book_id}]` : "kein lesbares Buch");
    if (!primary) throw new Error("stop");

    // 3. Find a page with enough text
    let page = null;
    let pid = primary.parts[0].first_page_id;
    for (let i = 0; i < 30 && pid; i++) {
        const p = await call("shamela_get_page", { book_id: primary.book_id, page_id: pid, response_format: "json" });
        if (p.isError) break;
        if (words(p.data.body).length >= 14) {
            page = p.data;
            break;
        }
        pid = p.data.next_page_id;
    }
    step("Seite mit Text gefunden", Boolean(page), page ? `Seite ${page.page_id} (gedruckt ${page.printed_page ?? "—"})` : "");
    if (!page) throw new Error("stop");
    const w = words(page.body);
    const quote = w.slice(3, 11).join(" ");

    // 4. Project + verified source
    await call("teaching_project_create", { kind: "series", title: "Selbsttest", teaching_language: "de", translation_target: "de", audience: "Test" });
    const bs = await call("teaching_book_set", { book_id: primary.book_id, role: "base" });
    step("Grundbuch gesetzt", !bs.isError && bs.data.book.downloaded === true, bs.isError ? bs.text.slice(0, 200) : `${bs.data.toc?.length ?? 0} Kapitel oben im Inhaltsverzeichnis`);
    const add = await call("teaching_source_add", { book_id: primary.book_id, page_id: page.page_id, quote });
    const status = add.data?.source?.verification?.status;
    step("Zitat technisch belegt (beide Prüfungen)", ["verified", "verified_normalized"].includes(status), add.isError ? add.text.slice(0, 300) : `${status}; Anker ${JSON.stringify({ page_id: add.data.source.anchor.page_id, printed: add.data.source.anchor.printed_page, part: add.data.source.anchor.part })}`);
    step("Seite vollständig abgerufen", add.data?.source?.fetch?.complete === true, add.data ? `${add.data.source.fetch.body_parts} Teil(e)` : "");

    // 5. Altered quotation is refused
    const altered = [...w.slice(3, 11)];
    altered[3] = "كلمةمختلفةتماما";
    const bad = await call("teaching_source_add", { book_id: primary.book_id, page_id: page.page_id, quote: altered.join(" ") });
    step("Verändertes Zitat abgelehnt", bad.isError && /^QUOTE_NOT_VERIFIED/.test(bad.text), bad.text.split("\n")[0]);

    // 6. Printed page resolution
    if (page.printed_page && /^\d+$/.test(String(page.printed_page).split("/").pop())) {
        const printed = Number(String(page.printed_page).split("/").pop());
        const loc = await call("teaching_locate", { book_id: primary.book_id, printed_page: printed, ...(page.part ? { part: String(page.part) } : {}) });
        const hit = loc.data?.unique ? loc.data.page.page_id === page.page_id : (loc.data?.candidates ?? []).some((c) => c.page_id === page.page_id);
        step("Druckseite → Seiten-ID", !loc.isError && hit, loc.isError ? loc.text.split("\n")[0] : `gedruckt ${printed} → ${loc.data.unique ? loc.data.page.page_id : "mehrdeutig, Kandidaten angeboten"}`);
    } else {
        step("Druckseite → Seiten-ID", true, "Buch ohne Druckseitenzählung — übersprungen", false);
    }
    if (multi) {
        const p1 = multi.parts[1];
        const p = await call("shamela_get_page", { book_id: multi.book_id, page_id: p1.first_page_id, response_format: "json" });
        const printed = Number(String(p.data?.printed_page ?? "").split("/").pop());
        if (printed) {
            const loc = await call("teaching_locate", { book_id: multi.book_id, printed_page: printed });
            step("Mehrbändiges Werk: keine geratene Zuordnung", !loc.isError, loc.data?.unique === false ? `${loc.data.candidates.length} Kandidaten` : "eindeutig", false);
        }
    } else {
        step("Mehrbändiges Werk", true, "kein mehrbändiges Buch heruntergeladen — übersprungen", false);
    }

    // 7. Missing book
    let missing = null;
    for (let id = 1; id < 400 && !missing; id++) {
        const b = await call("shamela_get_book", { book_id: id, response_format: "json" });
        if (!b.isError && b.data.content_status === "not_downloaded") missing = b.data;
    }
    if (missing) {
        const m = await call("teaching_source_add", { book_id: missing.book_id, page_id: 1, quote: "نص للاختبار من كتاب غير منزل" });
        step("Fehlendes Buch verständlich gemeldet", m.isError && /^BOOK_NOT_DOWNLOADED/.test(m.text), m.text.split("\n")[0]);
    } else {
        step("Fehlendes Buch", true, "alle geprüften Bücher sind heruntergeladen — übersprungen", false);
    }

    // 8. Translation context + export
    if (add.data?.source) {
        const ctx = await call("teaching_translation_context", { source_id: add.data.source.source_id });
        step("Übersetzungskontext erstellt", !ctx.isError && /^[0-9a-f]{64}$/.test(ctx.data?.context_sha256 ?? ""), ctx.isError ? ctx.text.split("\n")[0] : `${ctx.data.context.neighbours.length} Nachbarseite(n), ${ctx.data.context.glossary.length} Glossarbegriff(e)`);
        await call("teaching_unit_save", {
            title: "Selbsttest-Einheit",
            blocks: [{ kind: "quote", source_id: add.data.source.source_id }, { kind: "explanation", text: "Erklärung zum Test.", source_ids: [] }],
        });
        const ex = await call("teaching_export", { unit_id: "U1", format: "html" });
        step("Export geschrieben", !ex.isError && fs.existsSync(ex.data.path), ex.isError ? ex.text.split("\n")[0] : ex.data.path);
    }
} catch (e) {
    if (e.message !== "stop") step("Unerwarteter Fehler", false, e.stack ?? String(e));
} finally {
    await client.close();
}

const failed = results.filter((r) => r.required && !r.ok);
console.log("");
console.log(failed.length === 0 ? "ERGEBNIS: bestanden" : `ERGEBNIS: ${failed.length} Pflichtschritt(e) fehlgeschlagen`);
console.log(`Daten: ${dataDir}${keep || opt("--data") ? "" : " (wird gelöscht)"}`);
if (failed.length) console.log(`\nServer-Log (Ende):\n${serverLog.split("\n").slice(-25).join("\n")}`);
if (!keep && !opt("--data")) fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
