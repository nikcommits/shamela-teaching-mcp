// Fetch the upstream search helper (a small Java jar compiled from
// alhoqbani/shamela-mcp, MIT) from its official release, verify both
// checksums, and place it at helper/shamela-helper.jar.
//
// Why not compile it here: compiling needs two jars from a Shamela install,
// which cannot be shipped. The release jar contains only the upstream
// project's own classes (ws/shamela/mcp/*), compiled for Java 21, and runs on
// the Java runtime that Shamela itself ships.
//
// The Java sources have not changed between upstream v1.3.0 and the pinned
// library commit (see docs/ARCHITECTURE.md), so this jar matches the library.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const RELEASE_URL = "https://github.com/alhoqbani/shamela-mcp/releases/download/v1.3.0/shamela-mcp-1.3.0.mcpb";
const BUNDLE_SHA256 = "24bcc1bed56e1f5ed22e59f1ed9840e682eef74b17845d288bb858e3e85e6c27";
const JAR_SHA256 = "a5f3e6caff34f208dd80ec16395f075e0c3c99840fc067e3b65b5eb7aba7a3ab";
const ENTRY = "helper/shamela-helper.jar";
const OUT = "helper/shamela-helper.jar";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (existsSync(OUT) && sha256(readFileSync(OUT)) === JAR_SHA256) {
    console.log(`${OUT} present and verified`);
    process.exit(0);
}

const local = process.argv[2];
let bundle;
if (local) {
    bundle = readFileSync(local);
} else {
    console.log(`downloading ${RELEASE_URL}`);
    const res = await fetch(RELEASE_URL);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    bundle = Buffer.from(await res.arrayBuffer());
}
if (sha256(bundle) !== BUNDLE_SHA256) throw new Error("release bundle checksum mismatch — refusing to use it");

// Minimal ZIP reader: find the entry via the central directory.
const eocd = bundle.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) throw new Error("not a zip file");
const cdCount = bundle.readUInt16LE(eocd + 10);
let p = bundle.readUInt32LE(eocd + 16);
let jar = null;
for (let i = 0; i < cdCount; i++) {
    const method = bundle.readUInt16LE(p + 10);
    const csize = bundle.readUInt32LE(p + 20);
    const nlen = bundle.readUInt16LE(p + 28);
    const elen = bundle.readUInt16LE(p + 30);
    const clen = bundle.readUInt16LE(p + 32);
    const lho = bundle.readUInt32LE(p + 42);
    const name = bundle.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (name === ENTRY) {
        const lnlen = bundle.readUInt16LE(lho + 26);
        const lelen = bundle.readUInt16LE(lho + 28);
        const data = bundle.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
        jar = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
        if (!jar) throw new Error(`unsupported compression method ${method}`);
        break;
    }
    p += 46 + nlen + elen + clen;
}
if (!jar) throw new Error(`${ENTRY} not found in the release bundle`);
if (sha256(jar) !== JAR_SHA256) throw new Error("helper jar checksum mismatch — refusing to use it");
mkdirSync("helper", { recursive: true });
writeFileSync(OUT, jar);
console.log(`${OUT} written and verified (${jar.length} bytes)`);
