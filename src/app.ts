/**
 * Assemble the server: the 34 upstream tools and the teaching tools on one
 * MCP server, sharing one Shamela backend (one JVM, one set of open files).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools, VERSION as ENGINE_VERSION, type BackendProvider, type ShamelaDeps } from "shamela-mcp";

import type { TeachingConfig } from "./config.js";
import { McpGateway } from "./gateway.js";
import { registerTeachingTools, SERVER_INSTRUCTIONS } from "./server.js";
import { Store } from "./store.js";
import { TEACHING_VERSION } from "./version.js";

export interface App {
    server: McpServer;
    provider: BackendProvider;
    gateway: McpGateway;
    store: Store;
}

export async function createApp(deps: ShamelaDeps, config: TeachingConfig): Promise<App> {
    const server = new McpServer(
        { name: "shamela-teaching", version: TEACHING_VERSION },
        { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    const provider = registerAllTools(server, deps);
    const gateway = await McpGateway.connect(provider, ENGINE_VERSION);
    const store = new Store(config.dataDir);
    registerTeachingTools(server, { gateway, store, config });
    return { server, provider, gateway, store };
}

/**
 * The upstream interface language follows ours where it can: it has Arabic
 * and English. German falls back to Arabic, the primary language — the
 * upstream tool output is library text and labels, the teaching layer
 * provides the German interface.
 */
export function alignUpstreamLanguage(env: NodeJS.ProcessEnv, lang: TeachingConfig["lang"]): void {
    if (env.SHAMELA_LANG && env.SHAMELA_LANG.trim() && !env.SHAMELA_LANG.startsWith("${")) return;
    env.SHAMELA_LANG = lang === "en" ? "en" : "ar";
}
