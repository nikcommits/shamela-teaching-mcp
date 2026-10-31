/**
 * How the teaching tools reach Shamela.
 *
 * The teaching layer never reads Shamela files itself. It calls the upstream
 * shamela-mcp tools through their public MCP contract — the same calls and the
 * same structured results any assistant would see — so a change in Shamela's
 * storage is absorbed upstream and the checks here stay valid. The upstream
 * project versions that contract by semver (see its CLAUDE.md), which is what
 * makes relying on it safe.
 *
 * Tests substitute a `ShamelaGateway` backed by an in-memory library.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { BackendProvider } from "shamela-mcp";
import { createServer } from "shamela-mcp";

export type GatewayResult<T> =
    | { ok: true; data: T }
    | { ok: false; code: string; message: string };

export interface ShamelaGateway {
    /** Call an upstream tool and return its structured result, or its error code. */
    call<T = Record<string, unknown>>(tool: string, args: Record<string, unknown>): Promise<GatewayResult<T>>;
    /**
     * Page ids whose printed page number is `page` (optionally within volume
     * `part`). A printed number repeats across volumes, so more than one id is
     * a legitimate answer and must be disambiguated, never guessed.
     */
    pageIdsForPrinted(bookId: number, page: number, part: string | null): Promise<GatewayResult<number[]>>;
    /** Version of the upstream library, recorded with every check. */
    readonly engineVersion: string;
}

/** Upstream errors arrive as text "CODE: message". */
export function parseToolError(text: string): { code: string; message: string } {
    const m = /^([A-Z][A-Z_]+):\s*([\s\S]*)$/.exec(text.trim());
    return m ? { code: m[1]!, message: m[2]!.trim() } : { code: "INTERNAL", message: text.trim() };
}

/** Upper bound for one upstream call; the first one may include a JVM cold start. */
const CALL_TIMEOUT_MS = 180_000;

export class McpGateway implements ShamelaGateway {
    private constructor(
        private readonly client: Client,
        private readonly provider: BackendProvider,
        public readonly engineVersion: string,
    ) {}

    /**
     * Build a private upstream server that shares the given backend (one JVM,
     * one set of open files) and connect a client to it in memory.
     */
    static async connect(provider: BackendProvider, engineVersion: string): Promise<McpGateway> {
        const internal = createServer(
            () => provider.get(),
            (e) => provider.partial(e),
        );
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await internal.connect(serverSide);
        const client = new Client({ name: "shamela-teaching-internal", version: engineVersion });
        await client.connect(clientSide);
        return new McpGateway(client, provider, engineVersion);
    }

    async call<T>(tool: string, args: Record<string, unknown>): Promise<GatewayResult<T>> {
        try {
            const r = await this.client.callTool({ name: tool, arguments: args }, undefined, {
                timeout: CALL_TIMEOUT_MS,
                resetTimeoutOnProgress: true,
            });
            const text = Array.isArray(r.content)
                ? (r.content as Array<{ type: string; text?: string }>)
                      .filter((c) => c.type === "text")
                      .map((c) => c.text ?? "")
                      .join("\n")
                : "";
            if (r.isError) return { ok: false, ...parseToolError(text) };
            if (r.structuredContent && typeof r.structuredContent === "object") {
                return { ok: true, data: r.structuredContent as T };
            }
            // Every upstream tool returns structured content; a missing one is a contract break.
            return { ok: false, code: "CONTRACT", message: `${tool} returned no structured content` };
        } catch (e) {
            return { ok: false, code: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
        }
    }

    async pageIdsForPrinted(bookId: number, page: number, part: string | null): Promise<GatewayResult<number[]>> {
        try {
            const b = await this.provider.get();
            if (!(await b.pages.hasBook(bookId))) {
                return { ok: false, code: "BOOK_NOT_DOWNLOADED", message: String(bookId) };
            }
            const ids = await b.pages.pageIdsForPrintedPage(bookId, page);
            if (part === null) return { ok: true, data: ids };
            const rows = await b.pages.getPagesRows(bookId, ids);
            const wanted = part.trim();
            return {
                ok: true,
                data: ids.filter((_, i) => (rows[i]?.part ?? "").trim() === wanted),
            };
        } catch (e) {
            const code = (e as { code?: string }).code ?? "INTERNAL";
            return { ok: false, code, message: e instanceof Error ? e.message : String(e) };
        }
    }
}
