// The version is written in five places; they must agree.
import * as fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");
const found = {
    "package.json": JSON.parse(read("package.json")).version,
    "manifest.json": JSON.parse(read("manifest.json")).version,
    "src/version.ts": /TEACHING_VERSION = "([^"]+)"/.exec(read("src/version.ts"))?.[1],
    "skills/shamela-teaching/SKILL.md": /version: "([^"]+)"/.exec(read("skills/shamela-teaching/SKILL.md"))?.[1],
    "CHANGELOG.md": /^## \[?v?(\d+\.\d+\.\d+)/m.exec(read("CHANGELOG.md"))?.[1],
};
const versions = new Set(Object.values(found));
for (const [f, v] of Object.entries(found)) console.log(`${v ?? "MISSING"}  ${f}`);
if (versions.size !== 1 || versions.has(undefined)) {
    console.error("versions disagree");
    process.exit(1);
}
