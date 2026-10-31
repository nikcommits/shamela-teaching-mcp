/**
 * stdio entry point — what Claude Desktop (via the .mcpb bundle) or any other
 * MCP host launches. Bundled by esbuild into dist/index.js; the sql.js
 * WebAssembly binary is inlined so the bundle needs nothing but Node.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JavaHelper, logInfo, resolveAll } from "shamela-mcp";
import { createSqlJsDb } from "shamela-mcp/sqljs";

import { alignUpstreamLanguage, createApp } from "./app.js";
import { loadConfig, scrubUnfilledSettings } from "./config.js";
import { TEACHING_VERSION } from "./version.js";

// @ts-expect-error — esbuild `--loader:.wasm=binary` inlines this as a Uint8Array.
import sqlWasm from "sql.js/dist/sql-wasm.wasm";

async function main(): Promise<void> {
    scrubUnfilledSettings(process.env);
    const config = loadConfig(process.env);
    alignUpstreamLanguage(process.env, config.lang);

    const app = await createApp(
        {
            resolvePaths: resolveAll,
            db: createSqlJsDb(sqlWasm as Uint8Array),
            createHelper: (paths) => new JavaHelper({ paths }),
            log: logInfo,
        },
        config,
    );
    await app.server.connect(new StdioServerTransport());
    logInfo(`shamela-teaching-mcp v${TEACHING_VERSION} ready — data: ${config.dataDir} — language: ${config.lang}`);

    // Warm the backend in the background so the first tool call does not pay
    // the JVM start; a missing library is reported by teaching_status, not here.
    app.provider.get().catch((e) => logInfo(`backend not ready: ${e instanceof Error ? e.message : String(e)}`));

    const shutdown = () => {
        app.provider.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.stdin.on("close", shutdown);
}

main().catch((e) => {
    process.stderr.write(`[shamela-teaching] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
});
