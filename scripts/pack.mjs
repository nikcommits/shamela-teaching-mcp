// Build the installable Claude Desktop extension: shamela-teaching-<version>.mcpb
//
//   npm run build && npm run pack:mcpb
//
// 1. refreshes the tool list in manifest.json from the built server itself
//    (so the manifest can never list a tool that does not exist),
// 2. stages exactly what the bundle needs (no node_modules: dist/index.js is
//    self-contained), 3. packs and validates with the official mcpb CLI.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCPB = "@anthropic-ai/mcpb@2.1.2";
const run = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
};

for (const f of ["dist/index.js", "helper/shamela-helper.jar"]) {
    if (!fs.existsSync(path.join(root, f))) throw new Error(`${f} missing — run \`npm run build\` first`);
}

// 1. Tool list from the real server (no Shamela needed; Arabic titles).
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "shamela-teaching-pack-"));
const t = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "dist/index.js")],
    env: { ...process.env, TEACHING_DATA_DIR: tmpData, TEACHING_LANG: "ar", SHAMELA_LANG: "ar", SHAMELA_INSTALL_ROOT: path.join(tmpData, "none") },
    stderr: "ignore",
});
const c = new Client({ name: "pack", version: "1" });
await c.connect(t);
const tools = (await c.listTools()).tools.map((x) => ({ name: x.name, description: x.title ?? x.name }));
await c.close();
fs.rmSync(tmpData, { recursive: true, force: true });

const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.tools = tools;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json: ${tools.length} tools`);

// 2. Stage.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "shamela-teaching-stage-"));
for (const f of ["manifest.json", "dist/index.js", "helper/shamela-helper.jar", "LICENSE", "THIRD_PARTY_NOTICES.md", "README.md", "icon.png"]) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) {
        if (f === "icon.png") continue;
        throw new Error(`${f} missing`);
    }
    fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
    fs.copyFileSync(src, path.join(stage, f));
}
for (const f of fs.readdirSync(path.join(root, "dist"))) {
    if (f.endsWith(".LEGAL.txt")) fs.copyFileSync(path.join(root, "dist", f), path.join(stage, "dist", f));
}

// 3. Validate + pack.
run("npx", ["--yes", MCPB, "validate", path.join(stage, "manifest.json")]);
const out = path.join(root, `shamela-teaching-${manifest.version}.mcpb`);
fs.rmSync(out, { force: true });
run("npx", ["--yes", MCPB, "pack", stage, out]);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`\n${out}`);
