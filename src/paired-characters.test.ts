import { describe, expect, test } from "vitest";
import type { EditorState } from "./editor-state";
import {
    isCharacterEscaped,
    isClosingPairCharacter,
    isClosingPairMatched,
    isEmptyCharacterPair,
    PAIRED_CHARACTERS
} from "./paired-characters";
import { deleteEmptyPair, skipClosingPair } from "./transformations";

const createEditorState = (value: string, cursor: number): EditorState => ({
    value,
    selectionStart: cursor,
    selectionEnd: cursor,
    selectionDirection: "none"
});

describe("Paired characters", () => {
    test("defines every supported pair and its selection requirement", () => {
        expect(PAIRED_CHARACTERS).toEqual({
            "(": { leading: "(", trailing: ")", isSelectionRequired: false },
            "[": { leading: "[", trailing: "]", isSelectionRequired: false },
            "{": { leading: "{", trailing: "}", isSelectionRequired: false },
            "<": { leading: "<", trailing: ">", isSelectionRequired: false },
            '"': { leading: '"', trailing: '"', isSelectionRequired: true },
            "'": { leading: "'", trailing: "'", isSelectionRequired: true },
            "`": { leading: "`", trailing: "`", isSelectionRequired: true }
        });
    });

    test("recognizes closing characters and empty pairs", () => {
        for (const { leading, trailing } of Object.values(PAIRED_CHARACTERS)) {
            expect(isClosingPairCharacter(trailing)).toBe(true);
            expect(isEmptyCharacterPair(leading, trailing)).toBe(true);
        }
        expect(isClosingPairCharacter("x")).toBe(false);
        expect(isEmptyCharacterPair("(", "]")).toBe(false);
    });

    test("derives escape-aware symmetric closer context without pair history", () => {
        expect(isCharacterEscaped(String.raw`\"`, 1)).toBe(true);
        expect(isCharacterEscaped(String.raw`\\"`, 2)).toBe(false);
        expect(isClosingPairMatched('"value"', 6, '"')).toBe(true);
        expect(isClosingPairMatched(String.raw`\"value"`, 7, '"')).toBe(false);
        expect(isClosingPairMatched(String.raw`\\"value"`, 8, '"')).toBe(true);
        expect(isClosingPairMatched(String.raw`"value\"`, 7, '"')).toBe(false);
    });

    test("ignores apostrophes within words when matching quote pairs", () => {
        expect(isClosingPairMatched("don't 'value'", 12, "'")).toBe(true);
        expect(isClosingPairMatched("don't value'", 11, "'")).toBe(false);
        expect(isClosingPairMatched("l'école 'x'", 10, "'")).toBe(true);
        expect(isClosingPairMatched("l'école x'", 9, "'")).toBe(false);
        expect(isClosingPairMatched("𐐀'𐐁 'x'", 8, "'")).toBe(true);
        expect(isClosingPairMatched("é'é 'x'", 8, "'")).toBe(true);
    });

    test("enforces asymmetric nesting order", () => {
        expect(isClosingPairMatched("([x])", 3, "]")).toBe(true);
        expect(isClosingPairMatched("([x])", 4, ")")).toBe(true);
        expect(isClosingPairMatched("([x)]", 3, ")")).toBe(false);
        expect(isClosingPairMatched("value)", 5, ")")).toBe(false);
    });

    test("creates selection-only skips and text-replacement deletions", () => {
        const skipOperation = skipClosingPair(createEditorState("(value)", 6), ")");
        expect(skipOperation).toMatchObject({
            isTextReplacementRequired: false,
            selectionStart: 7,
            selectionEnd: 7
        });

        const deleteOperation = deleteEmptyPair(createEditorState("[]", 1));
        expect(deleteOperation).toMatchObject({
            isTextReplacementRequired: true,
            replaceStart: 0,
            replaceEnd: 2,
            text: "",
            selectionStart: 0,
            selectionEnd: 0
        });
    });
});
