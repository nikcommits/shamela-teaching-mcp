/**
 * Runtime configuration — read from the environment only.
 *
 * Nothing in here is personal: there are no built-in book ids, no built-in
 * paths beyond each platform's conventional per-user application-data folder,
 * and every value can be overridden. Claude Desktop fills these variables from
 * the extension's settings dialog (see manifest.json → user_config); any other
 * MCP host sets them in its own server configuration.
 *
 *   SHAMELA_INSTALL_ROOT  Shamela 4 install folder (auto-detected when empty)
 *   SHAMELA_JRE           Java runtime (default: the one Shamela ships)
 *   SHAMELA_HELPER_JAR    search helper jar (default: next to this program)
 *   TEACHING_DATA_DIR     where teaching projects are stored
 *   TEACHING_LANG         interface language: ar (default) | de | en
 */

import * as os from "node:os";
import * as path from "node:path";

export const UI_LANGS = ["ar", "de", "en"] as const;
export type UiLang = (typeof UI_LANGS)[number];

export interface TeachingConfig {
    dataDir: string;
    /** Where the data dir came from — reported by teaching_status. */
    dataDirSource: "setting" | "default";
    lang: UiLang;
}

/** Read a language tag leniently; anything unknown means Arabic, the primary language. */
export function resolveUiLang(raw: string | undefined | null): UiLang {
    if (!raw) return "ar";
    const tag = raw.trim().toLowerCase().replace(/_/g, "-").split("-")[0] ?? "";
    if ((UI_LANGS as readonly string[]).includes(tag)) return tag as UiLang;
    if (tag === "ara") return "ar";
    if (tag === "deu" || tag === "ger") return "de";
    if (tag === "eng") return "en";
    return "ar";
}

/** The conventional per-user data folder for this platform. */
export function defaultDataDir(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
): string {
    const name = "shamela-teaching";
    if (platform === "darwin") return path.join(home, "Library", "Application Support", name);
    if (platform === "win32") {
        const appData = env.APPDATA?.trim() || path.join(home, "AppData", "Roaming");
        return path.join(appData, name);
    }
    const xdg = env.XDG_DATA_HOME?.trim();
    return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".local", "share"), name);
}

/**
 * Expand a leading "~" — settings dialogs and hand-written configs both
 * produce it, and Node does not expand it.
 */
export function expandHome(p: string, home: string = os.homedir()): string {
    if (p === "~") return home;
    if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
    return p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TeachingConfig {
    const raw = env.TEACHING_DATA_DIR?.trim();
    // Claude Desktop substitutes an empty optional setting as the literal
    // "${user_config.x}" on some versions; treat that as unset.
    const usable = raw && !raw.startsWith("${") ? raw : "";
    return {
        dataDir: usable ? path.resolve(expandHome(usable)) : defaultDataDir(process.platform, env),
        dataDirSource: usable ? "setting" : "default",
        lang: resolveUiLang(env.TEACHING_LANG),
    };
}

/**
 * Clear settings a host passed through unfilled ("${user_config.x}") so the
 * upstream library falls back to auto-detection instead of probing a path
 * literally named "${user_config.shamela_install_folder}".
 */
export function scrubUnfilledSettings(env: NodeJS.ProcessEnv = process.env): void {
    for (const key of ["SHAMELA_INSTALL_ROOT", "SHAMELA_JRE", "SHAMELA_HELPER_JAR", "TEACHING_DATA_DIR", "TEACHING_LANG"]) {
        const v = env[key];
        if (v !== undefined && (v.trim() === "" || v.trim().startsWith("${"))) delete env[key];
        else if (v !== undefined && key !== "TEACHING_LANG") env[key] = expandHome(v.trim());
    }
}
