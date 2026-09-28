import { describe, expect, test } from "vitest";
import type { EditOperation, EditorSelectionDirection, EditorState } from "./editor-state";
import { toggleLinePrefix, type LinePrefixKind } from "./line-prefixes";

const createEditorState = (
    value: string,
    selectionStart = 0,
    selectionEnd = value.length,
    selectionDirection: EditorSelectionDirection = "none"
): EditorState => ({ value, selectionStart, selectionEnd, selectionDirection });

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

const executeToggle = (state: EditorState, kind: LinePrefixKind): EditorState =>
    applyOperation(state, toggleLinePrefix(state, kind));

describe("Line prefixes", () => {
    test("toggles every heading level without separate implementations", () => {
        const headingKinds = ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6"] as const;

        headingKinds.forEach((kind, index) => {
            const marker = "#".repeat(index + 1);
            const original = createEditorState("title", 2, 2);
            const added = executeToggle(original, kind);
            expect(added.value).toBe(`${marker} title`);
            expect([added.selectionStart, added.selectionEnd]).toEqual([index + 4, index + 4]);
            const removed = executeToggle(added, kind);
            expect(removed).toEqual(original);
        });
    });

    test("converts heading levels while preserving indentation", () => {
        const state = createEditorState("  ## title", 5, 7, "backward");
        const result = executeToggle(state, "heading4");

        expect(result.value).toBe("  #### title");
        expect([result.selectionStart, result.selectionEnd]).toEqual([7, 9]);
        expect(result.selectionDirection).toBe("backward");
    });

    test("toggles blockquotes for a collapsed cursor", () => {
        const original = createEditorState("quoted", 3, 3);
        const added = executeToggle(original, "blockquote");
        expect(added).toMatchObject({ value: "> quoted", selectionStart: 5, selectionEnd: 5 });
        expect(executeToggle(added, "blockquote")).toEqual(original);
    });

    test("converts competing list markers to each requested list type", () => {
        const original = createEditorState("  12) one\n- [x] two\nplain");

        expect(executeToggle(original, "bulletList").value).toBe("  - one\n- two\n- plain");
        expect(executeToggle(original, "numberedList").value).toBe("  12) one\n1. two\n1. plain");
        expect(executeToggle(original, "taskList").value).toBe("  - [ ] one\n- [x] two\n- [ ] plain");
    });

    test("normalizes mixed bullet selections before toggling all markers off", () => {
        const original = createEditorState("- one\ntwo\n\n  * three");
        const normalized = executeToggle(original, "bulletList");
        expect(normalized.value).toBe("- one\n- two\n\n  * three");

        const removed = executeToggle(normalized, "bulletList");
        expect(removed.value).toBe("one\ntwo\n\n  three");
    });

    test("leaves blank lines unchanged inside multiline selections", () => {
        const original = createEditorState("one\n\n  two");
        const result = executeToggle(original, "taskList");

        expect(result.value).toBe("- [ ] one\n\n  - [ ] two");
        expect(executeToggle(createEditorState("   ", 1, 1), "bulletList")).toEqual(createEditorState("   ", 1, 1));
    });

    test("excludes a trailing line touched only at column zero", () => {
        const original = createEditorState("one\ntwo", 0, 4, "backward");
        const result = executeToggle(original, "blockquote");

        expect(result.value).toBe("> one\ntwo");
        expect([result.selectionStart, result.selectionEnd]).toEqual([2, 6]);
        expect(result.selectionDirection).toBe("backward");
    });

    test("maps backward selections through different list-marker lengths", () => {
        const value = "  12) one\n- [x] two";
        const original = createEditorState(value, 0, value.length, "backward");
        const result = executeToggle(original, "bulletList");

        expect(result.value).toBe("  - one\n- two");
        expect([result.selectionStart, result.selectionEnd]).toEqual([0, result.value.length]);
        expect(result.selectionDirection).toBe("backward");
    });
});
