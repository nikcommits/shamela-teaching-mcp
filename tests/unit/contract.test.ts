/**
 * The contract with the upstream library, checked against the REAL code
 * (pinned shamela-mcp), without a Shamela installation:
 *
 *  - every upstream tool the teaching layer calls exists, and accepts every
 *    parameter name the teaching layer sends;
 *  - the assembled server (34 upstream + teaching tools) starts with no
 *    library and reports that clearly instead of failing.
 *
 * A breaking upstream change fails here before it can reach a user.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JavaHelper, resolveAll } from "shamela-mcp";
import { createSqlJsDb } from "shamela-mcp/sqljs";

import { alignUpstreamLanguage, createApp, type App } from "../../src/app.js";
import { tempDir } from "../fixtures/harness.js";

/** Upstream tools and the arguments the teaching layer passes to them (src/*.ts). */
const USED: Record<string, string[]> = {
    shamela_health: ["response_format"],
    shamela_get_book: ["book_id", "response_format"],
    shamela_get_book_parts: ["book_id", "response_format"],
    shamela_get_toc: ["book_id", "depth", "response_format"],
    shamela_get_page: ["book_id", "page_id", "body_part", "response_format"],
    shamela_get_citation: ["book_id", "page_id", "text", "style", "response_format"],
    shamela_verify_quote: ["quote", "book_id", "page_id", "scope", "limit", "response_format"],
    shamela_suggest_download: ["book_ids", "response_format"],
};

let app: App;
let client: Client;
const savedEnv = { ...process.env };

beforeAll(async () => {
    process.env.SHAMELA_INSTALL_ROOT = "/definitely/not/a/shamela/install";
    alignUpstreamLanguage(process.env, "ar");
    const require = createRequire(import.meta.url);
    const wasm = fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"));
    app = await createApp(
        {
            resolvePaths: resolveAll,
            db: createSqlJsDb(new Uint8Array(wasm)),
            createHelper: (paths) => new JavaHelper({ paths }),
            log: () => {},
        },
        { dataDir: tempDir(), dataDirSource: "setting", lang: "de" },
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await app.server.connect(a);
    client = new Client({ name: "contract", version: "0" });
    await client.connect(b);
});

afterAll(async () => {
    await client?.close();
    app?.provider.close();
    process.env = savedEnv;
});

describe("upstream contract", () => {
    it("registers the 34 upstream tools next to the teaching tools", async () => {
        const tools = (await client.listTools()).tools;
        expect(tools.filter((t) => t.name.startsWith("shamela_"))).toHaveLength(34);
        expect(tools.filter((t) => t.name.startsWith("teaching_")).length).toBeGreaterThanOrEqual(18);
    });

    it("offers every upstream tool and parameter the teaching layer uses", async () => {
        const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
        for (const [name, params] of Object.entries(USED)) {
            const tool = tools.get(name);
            expect(tool, name).toBeDefined();
            const props = Object.keys((tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
            for (const p of params) expect(props, `${name}.${p}`).toContain(p);
        }
    });

    it("starts without a library and explains what is missing", async () => {
        const r = await client.callTool({ name: "teaching_status", arguments: {} });
        expect(r.isError).toBeFalsy();
        const d = r.structuredContent as any;
        expect(d.library.status).toBe("not_started");
        expect(d.library.startup_error.code).toBe("SHAMELA_NOT_FOUND");
        expect(d.next_steps[0]).toContain("Shamila 4");
    });

    it("passes upstream errors through with their code", async () => {
        await client.callTool({ name: "teaching_project_create", arguments: { kind: "series", title: "Vertrag" } });
        const r = await client.callTool({ name: "teaching_book_set", arguments: { book_id: 1 } });
        expect(r.isError).toBe(true);
        expect((r.content as Array<{ text: string }>)[0]!.text).toMatch(/^SHAMELA_NOT_FOUND: /);
    });
});

describe("skill ↔ server", () => {
    it("names only tools the server actually offers", async () => {
        const names = new Set((await client.listTools()).tools.map((t) => t.name));
        const dir = path.resolve("skills/shamela-teaching");
        const files = [path.join(dir, "SKILL.md"), ...fs.readdirSync(path.join(dir, "references")).map((f) => path.join(dir, "references", f))];
        const mentioned = new Set<string>();
        for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/(?<![\w-])(?:teaching|shamela)_[a-z]+(?:_[a-z]+)*\b/g)) mentioned.add(m[0]);
        mentioned.delete("shamela_teaching"); // the server's own name in prose
        const unknown = [...mentioned].filter((n) => !names.has(n));
        expect(unknown).toEqual([]);
        expect(mentioned.size).toBeGreaterThan(20);
    });

    it("references only files that exist", () => {
        const dir = path.resolve("skills/shamela-teaching");
        const skill = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
        for (const m of skill.matchAll(/\]\((references\/[^)]+)\)/g)) expect(fs.existsSync(path.join(dir, m[1]!)), m[1]).toBe(true);
    });
});
