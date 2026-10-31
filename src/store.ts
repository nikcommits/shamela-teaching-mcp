/**
 * File-based storage for teaching projects.
 *
 *   <dataDir>/
 *     settings.json
 *     projects/<project_id>/
 *       project.json
 *       sources.json        the source folder (Quellenmappe)
 *       translations.json
 *       units/<unit_id>.json
 *       exports/            rendered lesson units
 *
 * Plain JSON so a teacher can back it up, read it, or move it to another
 * machine without this program. Writes are atomic (temp file + rename) so an
 * interrupted write never leaves a half file behind.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
    SCHEMA_VERSION,
    type Project,
    type Settings,
    type SourcesFile,
    type TranslationsFile,
    type Unit,
} from "./model.js";

export class StoreError extends Error {
    constructor(
        public code: "PROJECT_NOT_FOUND" | "UNIT_NOT_FOUND" | "SCHEMA_TOO_NEW" | "CORRUPT_FILE" | "NO_PROJECT",
        message: string,
    ) {
        super(message);
        this.name = "StoreError";
    }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;

export function nowIso(): string {
    return new Date().toISOString();
}

/** A readable, filesystem-safe project id: date + latin slug of the title + random suffix. */
export function newProjectId(title: string, date: Date = new Date()): string {
    const slug = title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    const day = date.toISOString().slice(0, 10).replace(/-/g, "");
    return `${day}-${slug || "project"}-${randomBytes(2).toString("hex")}`;
}

export class Store {
    constructor(public readonly root: string) {}

    // --- low level ----------------------------------------------------------

    private projectDir(projectId: string): string {
        if (!ID_RE.test(projectId)) {
            throw new StoreError("PROJECT_NOT_FOUND", projectId);
        }
        return path.join(this.root, "projects", projectId);
    }

    private readJson<T extends { schema_version: number }>(file: string): T | null {
        let raw: string;
        try {
            raw = fs.readFileSync(file, "utf8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw e;
        }
        let parsed: T;
        try {
            parsed = JSON.parse(raw) as T;
        } catch {
            throw new StoreError("CORRUPT_FILE", file);
        }
        if (typeof parsed.schema_version !== "number") throw new StoreError("CORRUPT_FILE", file);
        if (parsed.schema_version > SCHEMA_VERSION) throw new StoreError("SCHEMA_TOO_NEW", file);
        return parsed;
    }

    private writeJson(file: string, value: unknown): void {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        fs.renameSync(tmp, file);
    }

    // --- settings -----------------------------------------------------------

    settings(): Settings {
        return (
            this.readJson<Settings>(path.join(this.root, "settings.json")) ?? {
                schema_version: SCHEMA_VERSION,
                last_project_id: null,
            }
        );
    }

    saveSettings(s: Settings): void {
        this.writeJson(path.join(this.root, "settings.json"), s);
    }

    rememberProject(projectId: string): void {
        const s = this.settings();
        if (s.last_project_id !== projectId) this.saveSettings({ ...s, last_project_id: projectId });
    }

    // --- projects -----------------------------------------------------------

    listProjects(): Project[] {
        const dir = path.join(this.root, "projects");
        let names: string[];
        try {
            names = fs.readdirSync(dir);
        } catch {
            return [];
        }
        const out: Project[] = [];
        for (const n of names) {
            if (!ID_RE.test(n)) continue;
            try {
                const p = this.readJson<Project>(path.join(dir, n, "project.json"));
                if (p) out.push(p);
            } catch {
                // A corrupt project must not hide the others; teaching_status reports it.
            }
        }
        return out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    }

    /** Ids of project folders whose project.json cannot be read. */
    unreadableProjects(): string[] {
        const dir = path.join(this.root, "projects");
        let names: string[];
        try {
            names = fs.readdirSync(dir);
        } catch {
            return [];
        }
        const bad: string[] = [];
        for (const n of names) {
            if (!ID_RE.test(n)) continue;
            try {
                if (!this.readJson<Project>(path.join(dir, n, "project.json"))) bad.push(n);
            } catch {
                bad.push(n);
            }
        }
        return bad;
    }

    getProject(projectId: string): Project {
        const p = this.readJson<Project>(path.join(this.projectDir(projectId), "project.json"));
        if (!p) throw new StoreError("PROJECT_NOT_FOUND", projectId);
        return p;
    }

    /** The given project, or the last one used. */
    resolveProject(projectId: string | undefined): Project {
        if (projectId) return this.getProject(projectId);
        const last = this.settings().last_project_id;
        if (last) {
            try {
                return this.getProject(last);
            } catch {
                // fall through
            }
        }
        throw new StoreError("NO_PROJECT", "");
    }

    saveProject(p: Project): void {
        p.updated_at = nowIso();
        this.writeJson(path.join(this.projectDir(p.project_id), "project.json"), p);
        this.rememberProject(p.project_id);
    }

    // --- sources ------------------------------------------------------------

    sources(projectId: string): SourcesFile {
        return (
            this.readJson<SourcesFile>(path.join(this.projectDir(projectId), "sources.json")) ?? {
                schema_version: SCHEMA_VERSION,
                sources: [],
            }
        );
    }

    saveSources(projectId: string, f: SourcesFile): void {
        this.writeJson(path.join(this.projectDir(projectId), "sources.json"), f);
    }

    // --- translations -------------------------------------------------------

    translations(projectId: string): TranslationsFile {
        return (
            this.readJson<TranslationsFile>(path.join(this.projectDir(projectId), "translations.json")) ?? {
                schema_version: SCHEMA_VERSION,
                translations: [],
                issued_contexts: [],
            }
        );
    }

    saveTranslations(projectId: string, f: TranslationsFile): void {
        this.writeJson(path.join(this.projectDir(projectId), "translations.json"), f);
    }

    // --- units --------------------------------------------------------------

    getUnit(projectId: string, unitId: string): Unit {
        if (!/^U\d+$/.test(unitId)) throw new StoreError("UNIT_NOT_FOUND", unitId);
        const u = this.readJson<Unit>(path.join(this.projectDir(projectId), "units", `${unitId}.json`));
        if (!u) throw new StoreError("UNIT_NOT_FOUND", unitId);
        return u;
    }

    listUnits(projectId: string): Unit[] {
        const dir = path.join(this.projectDir(projectId), "units");
        let names: string[];
        try {
            names = fs.readdirSync(dir);
        } catch {
            return [];
        }
        return names
            .filter((n) => /^U\d+\.json$/.test(n))
            .map((n) => this.getUnit(projectId, n.replace(/\.json$/, "")))
            .sort((a, b) => Number(a.unit_id.slice(1)) - Number(b.unit_id.slice(1)));
    }

    saveUnit(u: Unit): void {
        u.updated_at = nowIso();
        this.writeJson(path.join(this.projectDir(u.project_id), "units", `${u.unit_id}.json`), u);
    }

    // --- exports ------------------------------------------------------------

    writeExport(projectId: string, fileName: string, content: string): string {
        const dir = path.join(this.projectDir(projectId), "exports");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, fileName);
        fs.writeFileSync(file, content, "utf8");
        return file;
    }
}
