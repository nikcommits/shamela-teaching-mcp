import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { defaultDataDir, expandHome, loadConfig, resolveUiLang, scrubUnfilledSettings } from "../../src/config.js";

describe("configuration", () => {
    it("uses each platform's conventional data folder", () => {
        expect(defaultDataDir("darwin", {}, "/Users/x")).toBe(path.join("/Users/x", "Library", "Application Support", "shamela-teaching"));
        expect(defaultDataDir("win32", { APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "C:\\Users\\x")).toBe(
            path.join("C:\\Users\\x\\AppData\\Roaming", "shamela-teaching"),
        );
        expect(defaultDataDir("linux", {}, "/home/x")).toBe(path.join("/home/x", ".local", "share", "shamela-teaching"));
        expect(defaultDataDir("linux", { XDG_DATA_HOME: "/data" }, "/home/x")).toBe(path.join("/data", "shamela-teaching"));
    });

    it("defaults to Arabic and reads language tags leniently", () => {
        expect(resolveUiLang(undefined)).toBe("ar");
        expect(resolveUiLang("de-DE")).toBe("de");
        expect(resolveUiLang("EN")).toBe("en");
        expect(resolveUiLang("deu")).toBe("de");
        expect(resolveUiLang("fr")).toBe("ar");
    });

    it("treats an unfilled host placeholder as unset", () => {
        const c = loadConfig({ TEACHING_DATA_DIR: "${user_config.data_folder}" });
        expect(c.dataDirSource).toBe("default");
        const env: NodeJS.ProcessEnv = { SHAMELA_INSTALL_ROOT: "${user_config.shamela_install_folder}", TEACHING_LANG: " " };
        scrubUnfilledSettings(env);
        expect(env.SHAMELA_INSTALL_ROOT).toBeUndefined();
        expect(env.TEACHING_LANG).toBeUndefined();
    });

    it("expands a leading tilde", () => {
        expect(expandHome("~/Teaching", "/home/x")).toBe(path.join("/home/x", "Teaching"));
        expect(loadConfig({ TEACHING_DATA_DIR: "/abs/dir" }).dataDir).toBe(path.resolve("/abs/dir"));
    });
});
