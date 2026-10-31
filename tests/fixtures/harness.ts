import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { UiLang } from "../../src/config.js";
import { registerTeachingTools } from "../../src/server.js";
import { Store } from "../../src/store.js";
import { FakeGateway } from "./fakeLibrary.js";

export function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "shamela-teaching-test-"));
}

export interface Harness {
    gw: FakeGateway;
    store: Store;
    dataDir: string;
    call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; data: any; text: string }>;
    close: () => Promise<void>;
}

/** A teaching server on a fake library, reached through a real MCP client. */
export async function harness(opts: { gw?: FakeGateway; dataDir?: string; lang?: UiLang } = {}): Promise<Harness> {
    const gw = opts.gw ?? new FakeGateway();
    const dataDir = opts.dataDir ?? tempDir();
    const store = new Store(dataDir);
    const server = new McpServer({ name: "test", version: "0" }, { capabilities: { tools: {} } });
    registerTeachingTools(server, { gateway: gw, store, config: { dataDir, dataDirSource: "setting", lang: opts.lang ?? "ar" } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test-client", version: "0" });
    await client.connect(b);
    return {
        gw,
        store,
        dataDir,
        call: async (name, args = {}) => {
            const r = await client.callTool({ name, arguments: args });
            const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
            return { isError: Boolean(r.isError), data: r.structuredContent ?? null, text };
        },
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}
