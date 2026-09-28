import { describe, expect, test } from "vitest";
import type { EditOperation, EditorState } from "./editor-state";
import { continueMarkdownLine, indentMarkdownLine, parseMarkdownLine } from "./markdown-lines";

const createEditorState = (value: string, cursor = value.length): EditorState => ({
    value,
    selectionStart: cursor,
    selectionEnd: cursor,
    selectionDirection: "none"
});

const applyOperation = (state: EditorState, operation: EditOperation | null): EditorState => {
    if (!operation) {
        return state;
    }
    return {
        value: state.value.slice(0, operation.replaceStart) + operation.text + state.value.slice(operation.replaceEnd),
        selectionStart: operation.selectionStart,
        selectionEnd: operation.selectionEnd,
        selectionDirection: operation.selectionDirection
    };
};

describe("Markdown lines", () => {
    test.each([
        ["- item", "- item\n- "],
        ["* item", "* item\n* "],
        ["9) item", "9) item\n10) "],
        ["- [x] done", "- [x] done\n- [ ] "],
        ["> > quote", "> > quote\n> > "],
        [">> quote", ">> quote\n>> "],
        ["    indented", "    indented\n    "],
        ["    - nested", "    - nested\n    - "]
    ])("continues structured line %s", (value, expected) => {
        const state = createEditorState(value);
        const operation = continueMarkdownLine(state);

        expect(operation).not.toBeNull();
        expect(applyOperation(state, operation).value).toBe(expected);
    });

    test("preserves the current line style in mixed-newline documents", () => {
        const value = "head\r\n- item\ntail";
        const state = createEditorState(value, 12);
        const result = applyOperation(state, continueMarkdownLine(state));

        expect(result.value).toBe("head\r\n- item\n- \ntail");
    });

    test("increments unsafe and arbitrarily large ordered markers exactly", () => {
        const unsafeValue = "9007199254740993) item";
        const unsafeState = createEditorState(unsafeValue);
        expect(applyOperation(unsafeState, continueMarkdownLine(unsafeState)).value).toBe(
            "9007199254740993) item\n9007199254740994) "
        );

        const marker = "9".repeat(400);
        const largeValue = `${marker}. item`;
        const largeState = createEditorState(largeValue);
        expect(applyOperation(largeState, continueMarkdownLine(largeState)).value).toBe(
            `${largeValue}\n1${"0".repeat(400)}. `
        );
    });

    test("preserves CRLF and increments only the current ordered marker", () => {
        const value = "1. one\r\n9) two";
        const state = createEditorState(value);
        const result = applyOperation(state, continueMarkdownLine(state));

        expect(result.value).toBe("1. one\r\n9) two\r\n10) ");
        expect([result.selectionStart, result.selectionEnd]).toEqual([result.value.length, result.value.length]);
    });

    test.each([
        ["- ", ""],
        ["1. ", ""],
        ["- [x] ", ""],
        ["> ", ""],
        ["    ", ""],
        ["item\n  - ", "item\n  "]
    ])("exits empty structure %s", (value, expected) => {
        const state = createEditorState(value);
        const result = applyOperation(state, continueMarkdownLine(state));

        expect(result.value).toBe(expected);
        expect([result.selectionStart, result.selectionEnd]).toEqual([expected.length, expected.length]);
    });

    test("returns no Enter edit outside supported collapsed-cursor contexts", () => {
        expect(continueMarkdownLine(createEditorState("plain"))).toBeNull();
        expect(
            continueMarkdownLine({
                value: "- selected",
                selectionStart: 2,
                selectionEnd: 10,
                selectionDirection: "forward"
            })
        ).toBeNull();
        expect(continueMarkdownLine(createEditorState("- item", 1))).toBeNull();
    });

    test("parses current structures and nests only Markdown markers", () => {
        const listState = createEditorState("before\n  - item");
        expect(parseMarkdownLine(listState)).toMatchObject({
            kind: "bullet",
            indentation: "  ",
            marker: "- ",
            content: "item"
        });
        const nested = applyOperation(listState, indentMarkdownLine(listState, 4));
        expect(nested.value).toBe("before\n      - item");
        expect(indentMarkdownLine(createEditorState("    indented"), 4)).toBeNull();
        expect(indentMarkdownLine(createEditorState("plain"), 4)).toBeNull();
    });
});
