import { describe, expect, test } from "vitest";
import { toggleFencedCodeBlock, toggleInlineCode } from "./code-formatting";
import type { EditOperation, EditorState } from "./editor-state";

const createEditorState = (value: string, selectionStart = 0, selectionEnd = value.length): EditorState => ({
    value,
    selectionStart,
    selectionEnd,
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

describe("Code formatting", () => {
    test("round-trips a simple inline code span", () => {
        const original = createEditorState("code");
        const added = applyOperation(original, toggleInlineCode(original));
        expect(added).toMatchObject({ value: "`code`", selectionStart: 1, selectionEnd: 5 });
        expect(applyOperation(added, toggleInlineCode(added))).toEqual(original);
    });

    test("uses a delimiter longer than embedded backtick runs", () => {
        const original = createEditorState("a ` b and `` c");
        const added = applyOperation(original, toggleInlineCode(original));

        expect(added.value).toBe("```a ` b and `` c```");
        expect(added.value.slice(added.selectionStart, added.selectionEnd)).toBe(original.value);

        const nestedMarkdown = createEditorState("**call(`x`)**");
        expect(applyOperation(nestedMarkdown, toggleInlineCode(nestedMarkdown)).value).toBe("``**call(`x`)**``");
    });

    test("adds reversible padding when inline content touches backticks", () => {
        const original = createEditorState("`code");
        const added = applyOperation(original, toggleInlineCode(original));
        expect(added).toMatchObject({ value: "`` `code ``", selectionStart: 3, selectionEnd: 8 });
        expect(applyOperation(added, toggleInlineCode(added))).toEqual(original);

        const inclusive = createEditorState(added.value);
        expect(applyOperation(inclusive, toggleInlineCode(inclusive)).value).toBe(original.value);
    });

    test("does not mistake literal or conflicting backticks for existing spans", () => {
        for (const literal of ["`", "``", "```"]) {
            const original = createEditorState(literal);
            const added = applyOperation(original, toggleInlineCode(original));
            const delimiter = "`".repeat(literal.length + 1);
            expect(added.value).toBe(`${delimiter} ${literal} ${delimiter}`);
        }

        const conflicting = createEditorState("`a`b`");
        expect(applyOperation(conflicting, toggleInlineCode(conflicting)).value).toBe("`` `a`b` ``");

        const leftAdjacent = createEditorState("`code", 1, 5);
        expect(applyOperation(leftAdjacent, toggleInlineCode(leftAdjacent)).value).toBe("`` `code ``");
        const rightAdjacent = createEditorState("code`", 0, 4);
        expect(applyOperation(rightAdjacent, toggleInlineCode(rightAdjacent)).value).toBe("`` code` ``");

        expect(toggleInlineCode(createEditorState("`foobar`", 1, 4))).toBeNull();
    });

    test("preserves whitespace outside inline code markers", () => {
        const original = createEditorState("  code  ");
        const added = applyOperation(original, toggleInlineCode(original));
        expect(added).toMatchObject({ value: "  `code`  ", selectionStart: 3, selectionEnd: 7 });
        expect(applyOperation(added, toggleInlineCode(added))).toEqual(createEditorState("  code  ", 2, 6));
    });

    test("round-trips fenced content with indentation and trailing newlines exactly", () => {
        const original = createEditorState("  one\n\ntwo\n");
        const added = applyOperation(original, toggleFencedCodeBlock(original));

        expect(added.value).toBe("```language\n  one\n\ntwo\n\n```");
        expect(added.value.slice(added.selectionStart, added.selectionEnd)).toBe("language");
        const removed = applyOperation(added, toggleFencedCodeBlock(added));
        expect(removed).toEqual(createEditorState(original.value, 0, original.value.length));
    });

    test("round-trips partial-line fenced selections with valid boundaries", () => {
        const original = createEditorState("prefix code suffix", 7, 11);
        const added = applyOperation(original, toggleFencedCodeBlock(original));

        expect(added.value).toBe("```language\nprefix code suffix\n```");
        expect(applyOperation(added, toggleFencedCodeBlock(added))).toEqual(
            createEditorState(original.value, 0, original.value.length)
        );
    });

    test("uses a fence longer than every content backtick run", () => {
        const original = createEditorState("before\n````\nafter");
        const added = applyOperation(original, toggleFencedCodeBlock(original));

        expect(added.value.startsWith("`````language\n")).toBe(true);
        expect(added.value.endsWith("\n`````")).toBe(true);
        expect(applyOperation(added, toggleFencedCodeBlock(added)).value).toBe(original.value);
    });

    test("preserves CRLF and removes existing language fences", () => {
        const original = createEditorState("one\r\ntwo\r\n");
        const added = applyOperation(original, toggleFencedCodeBlock(original));
        expect(added.value).toBe("```language\r\none\r\ntwo\r\n\r\n```");
        expect(applyOperation(added, toggleFencedCodeBlock(added)).value).toBe(original.value);

        const singleLine = createEditorState("before\r\ncode\r\nafter", 8, 12);
        const singleLineAdded = applyOperation(singleLine, toggleFencedCodeBlock(singleLine));
        expect(singleLineAdded.value).toBe("before\r\n```language\r\ncode\r\n```\r\nafter");
        expect(applyOperation(singleLineAdded, toggleFencedCodeBlock(singleLineAdded))).toEqual(singleLine);

        const existing = createEditorState("```ts\ncode\n\n```");
        expect(applyOperation(existing, toggleFencedCodeBlock(existing))).toEqual(createEditorState("code\n", 0, 5));

        const surrounded = "before\n```ts\ncode\n```\nafter";
        const infoStart = surrounded.indexOf("ts");
        const existingInfo = createEditorState(surrounded, infoStart, infoStart + 2);
        expect(applyOperation(existingInfo, toggleFencedCodeBlock(existingInfo)).value).toBe("before\ncode\nafter");
    });

    test("recognizes valid fences without removing malformed or nested Markdown", () => {
        const indented = createEditorState("  ```ts\ncode\n   ````");
        expect(applyOperation(indented, toggleFencedCodeBlock(indented)).value).toBe("code");

        const malformed = createEditorState("```ts`bad\ncode\n```");
        expect(applyOperation(malformed, toggleFencedCodeBlock(malformed)).value).not.toBe("code");

        const completeFence = "```ts\ncode\n```\nafter";
        const completeFenceEnd = completeFence.indexOf("after");
        const completeFenceState = createEditorState(completeFence, 0, completeFenceEnd);
        expect(applyOperation(completeFenceState, toggleFencedCodeBlock(completeFenceState)).value).toBe("code\nafter");

        const tilde = "~~~text\n```js\ncode\n```\n~~~";
        const tildeSelectionStart = tilde.indexOf("code");
        expect(
            toggleFencedCodeBlock(createEditorState(tilde, tildeSelectionStart, tildeSelectionStart + "code".length))
        ).toBeNull();
        expect(toggleFencedCodeBlock(createEditorState(tilde, 0, tildeSelectionStart + 4))).toBeNull();
        expect(toggleFencedCodeBlock(createEditorState(`${tilde}\nafter`, 0, tilde.length + 1))).toBeNull();

        const unclosed = "before\n```text\ncode\nafter";
        const partialUnclosedEnd = unclosed.indexOf("\nafter");
        expect(toggleFencedCodeBlock(createEditorState(unclosed, 0, partialUnclosedEnd))).toBeNull();

        const outer = "````outer\n```\ninner\n```\nafter\n````";
        const selectionStart = outer.indexOf("after");
        const nested = createEditorState(outer, selectionStart, selectionStart + "after".length);
        expect(applyOperation(nested, toggleFencedCodeBlock(nested)).value).toBe("```\ninner\n```\nafter");
    });

    test("does not create code formatting for an empty selection", () => {
        expect(toggleInlineCode(createEditorState("code", 2, 2))).toBeNull();
        expect(toggleFencedCodeBlock(createEditorState("code", 2, 2))).toBeNull();
    });
});
