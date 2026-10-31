import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { newProjectId, Store, StoreError } from "../../src/store.js";
import { tempDir } from "../fixtures/harness.js";

describe("store", () => {
    it("makes readable, safe project ids", () => {
        const id = newProjectId("Fiqh der Reinheit!", new Date("2026-10-31T00:00:00Z"));
        expect(id).toMatch(/^20261031-fiqh-der-reinheit-[0-9a-f]{4}$/);
        expect(newProjectId("سلسلة الطهارة")).toMatch(/^\d{8}-project-[0-9a-f]{4}$/);
    });

    it("refuses path tricks in ids", () => {
        const s = new Store(tempDir());
        expect(() => s.getProject("../../etc")).toThrow(StoreError);
        expect(() => s.getUnit("20261031-x-abcd", "../U1")).toThrow(StoreError);
    });

    it("refuses data written by a newer version and isolates corrupt projects", () => {
        const root = tempDir();
        const s = new Store(root);
        const dir = path.join(root, "projects", "20261031-newer-abcd");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ schema_version: 99 }));
        const bad = path.join(root, "projects", "20261031-broken-abcd");
        fs.mkdirSync(bad, { recursive: true });
        fs.writeFileSync(path.join(bad, "project.json"), "{not json");
        expect(() => s.getProject("20261031-newer-abcd")).toThrow(/SCHEMA_TOO_NEW|newer/);
        expect(s.listProjects()).toEqual([]);
        expect(s.unreadableProjects().sort()).toEqual(["20261031-broken-abcd", "20261031-newer-abcd"]);
    });

    it("leaves no temporary files behind", () => {
        const root = tempDir();
        const s = new Store(root);
        s.saveSettings({ schema_version: 1, last_project_id: null });
        expect(fs.readdirSync(root)).toEqual(["settings.json"]);
    });
});
