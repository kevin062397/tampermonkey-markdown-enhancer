import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, "configuration/build-validation.json"), "utf8"));
const distDirectory = resolve(root, "dist");
const pngPrefix = "data:image/png;base64,";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const fail = (message) => {
    throw new Error(`Build validation failed: ${message}`);
};

const isEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const parseMetadata = (content) => {
    const startMarker = "// ==UserScript==";
    const endMarker = "// ==/UserScript==";
    const end = content.indexOf(endMarker);
    if (!content.startsWith(startMarker) || end < 0) {
        fail("an artifact is missing a complete userscript metadata block");
    }

    const block = content.slice(0, end + endMarker.length);
    const lines = block.split(/\r?\n/);
    if (lines[0] !== startMarker || lines.at(-1) !== endMarker) {
        fail("an artifact has content outside the userscript metadata comment format");
    }

    const metadata = new Map();
    for (const line of lines.slice(1, -1)) {
        const match = line.match(/^\/\/ @([^\s]+)(?:\s+(.*))?$/);
        if (!match) {
            fail("an artifact contains non-metadata content in its userscript preamble");
        }
        const values = metadata.get(match[1]) ?? [];
        values.push((match[2] ?? "").trim());
        metadata.set(match[1], values);
    }
    return { end: end + endMarker.length, metadata };
};

const userScript = readFileSync(resolve(distDirectory, "index.user.js"), "utf8");
const metadataScript = readFileSync(resolve(distDirectory, "index.meta.js"), "utf8");
const userResult = parseMetadata(userScript);
const metaResult = parseMetadata(metadataScript);
const allowedMetadataKeys = [...Object.keys(config.expectedMetadata), ...config.requiredMetadata].sort();

for (const [artifactName, result] of [
    ["userscript", userResult],
    ["metadata artifact", metaResult]
]) {
    const actualKeys = [...result.metadata.keys()].sort();
    if (!isEqual(actualKeys, allowedMetadataKeys)) {
        fail(
            `${artifactName} metadata keys expected ${allowedMetadataKeys.join(", ")}, found ${actualKeys.join(", ")}`
        );
    }
}

for (const [key, expectedValues] of Object.entries(config.expectedMetadata)) {
    const userValues = userResult.metadata.get(key) ?? [];
    if (!isEqual(userValues, expectedValues)) {
        fail(`metadata @${key} expected ${JSON.stringify(expectedValues)}, found ${JSON.stringify(userValues)}`);
    }
    const metadataValues = metaResult.metadata.get(key) ?? [];
    if (!isEqual(metadataValues, expectedValues)) {
        fail(
            `metadata artifact @${key} expected ${JSON.stringify(expectedValues)}, found ${JSON.stringify(metadataValues)}`
        );
    }
}

for (const key of config.requiredMetadata) {
    const values = userResult.metadata.get(key) ?? [];
    if (values.length !== 1 || !isEqual(metaResult.metadata.get(key) ?? [], values)) {
        fail(`required metadata @${key} must occur once and match in both artifacts`);
    }

    const value = values[0];
    const payload = value.startsWith(pngPrefix) ? value.slice(pngPrefix.length) : "";
    const bytes = Buffer.from(payload, "base64");
    if (
        payload.length === 0 ||
        bytes.toString("base64") !== payload ||
        !bytes.subarray(0, pngSignature.length).equals(pngSignature)
    ) {
        fail(`required metadata @${key} must contain an inline PNG image`);
    }
}

if (metadataScript.slice(metaResult.end).trim() !== "") {
    fail("the metadata artifact contains executable code");
}

const runtime = userScript.slice(userResult.end);
const runtimeSource = ts.createSourceFile("index.user.js", runtime, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
if (runtimeSource.statements.length === 0) {
    fail("the userscript runtime is empty");
}
try {
    new Script(runtime, { filename: "index.user.js" });
} catch {
    fail("the userscript runtime is not valid classic JavaScript");
}

console.log("Validated userscript artifacts and repository-specific metadata.");
