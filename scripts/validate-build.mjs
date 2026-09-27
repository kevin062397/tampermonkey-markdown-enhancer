import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, "configuration/build-validation.json"), "utf8"));
const distDirectory = resolve(root, "dist");

const fail = (message) => {
    throw new Error(`Build validation failed: ${message}`);
};

const actualArtifacts = readdirSync(distDirectory).sort();
const expectedArtifacts = [...config.artifacts].sort();
if (JSON.stringify(actualArtifacts) !== JSON.stringify(expectedArtifacts)) {
    fail(`expected artifacts ${expectedArtifacts.join(", ")}, found ${actualArtifacts.join(", ")}`);
}

const parseMetadata = (content) => {
    const endMarker = "// ==/UserScript==";
    const end = content.indexOf(endMarker);
    if (!content.startsWith("// ==UserScript==") || end < 0) {
        fail("an artifact is missing a complete userscript metadata block");
    }

    const metadata = new Map();
    const block = content.slice(0, end + endMarker.length);
    for (const match of block.matchAll(/^\/\/ @([^\s]+)\s+(.+)$/gm)) {
        const values = metadata.get(match[1]) ?? [];
        values.push(match[2].trim());
        metadata.set(match[1], values);
    }
    return { end: end + endMarker.length, metadata };
};

const userScript = readFileSync(resolve(distDirectory, "index.user.js"), "utf8");
const metadataScript = readFileSync(resolve(distDirectory, "index.meta.js"), "utf8");
const userResult = parseMetadata(userScript);
const metaResult = parseMetadata(metadataScript);

for (const [key, expectedValues] of Object.entries(config.expectedMetadata)) {
    const actualValues = userResult.metadata.get(key) ?? [];
    if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
        fail(`metadata @${key} expected ${JSON.stringify(expectedValues)}, found ${JSON.stringify(actualValues)}`);
    }
    const metaValues = metaResult.metadata.get(key) ?? [];
    if (JSON.stringify(metaValues) !== JSON.stringify(expectedValues)) {
        fail(`metadata artifact @${key} does not match the userscript`);
    }
}

for (const key of config.requiredMetadata) {
    if (!userResult.metadata.has(key) || !metaResult.metadata.has(key)) {
        fail(`required metadata @${key} is missing`);
    }
}

if (metadataScript.slice(metaResult.end).trim() !== "") {
    fail("the metadata artifact contains executable code");
}

const runtime = userScript.slice(userResult.end);
for (const marker of config.runtimeMarkers) {
    if (!runtime.includes(marker)) {
        fail(`runtime marker ${JSON.stringify(marker)} is missing`);
    }
}
if (/^\s*(?:import|export)\s/m.test(runtime)) {
    fail("the userscript contains an unresolved module import or export");
}
if (/['\"]use strict['\"]\s*\(/.test(runtime)) {
    fail("the userscript has an unsafe statement boundary after its strict-mode directive");
}

const source = readFileSync(resolve(root, config.sourceEntry), "utf8");
if (source.includes("==UserScript==")) {
    fail("the source entry still embeds repository-specific userscript metadata");
}

console.log(`Validated ${actualArtifacts.length} userscript artifacts and repository-specific metadata.`);
