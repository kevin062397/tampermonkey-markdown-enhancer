import { describe, expect, test } from "vitest";
import {
    ACTIVE_BLOCK_STYLES,
    CONCRETE_BLOCK_STYLES,
    getActiveBlockStyle,
    type ActiveBlockStyle,
    type ConcreteBlockStyle
} from "./block-styles";
import type { EditorSelectionDirection, EditorState } from "./editor-state";

const createEditorState = (
    value: string,
    selectionStart = 0,
    selectionEnd = selectionStart,
    selectionDirection: EditorSelectionDirection = "none"
): EditorState => ({ value, selectionStart, selectionEnd, selectionDirection });

const getStyle = (
    value: string,
    selectionStart = 0,
    selectionEnd = selectionStart,
    selectionDirection: EditorSelectionDirection = "none"
): ActiveBlockStyle => getActiveBlockStyle(createEditorState(value, selectionStart, selectionEnd, selectionDirection));

describe("Block styles", () => {
    test("exports the canonical style values in display order", () => {
        const concreteStyles: readonly ConcreteBlockStyle[] = CONCRETE_BLOCK_STYLES;
        const activeStyles: readonly ActiveBlockStyle[] = ACTIVE_BLOCK_STYLES;

        expect(concreteStyles).toEqual([
            "text",
            "heading1",
            "heading2",
            "heading3",
            "heading4",
            "heading5",
            "heading6",
            "blockquote",
            "codeBlock",
            "bulletList",
            "numberedList",
            "taskList"
        ]);
        expect(activeStyles).toEqual([...concreteStyles, "mixed"]);
    });

    test.each([
        ["# title", "heading1"],
        ["##\ttitle", "heading2"],
        ["### title", "heading3"],
        ["####", "heading4"],
        ["  ##### title", "heading5"],
        ["\t###### title", "heading6"],
        [">quote", "blockquote"],
        ["> quote", "blockquote"],
        [">> nested quote", "blockquote"],
        ["  >\tquote", "blockquote"],
        ["- item", "bulletList"],
        ["+\titem", "bulletList"],
        ["*", "bulletList"],
        ["1. item", "numberedList"],
        ["42)\titem", "numberedList"],
        ["9007199254740993.", "numberedList"],
        ["- [ ] task", "taskList"],
        ["+ [x]\tdone", "taskList"],
        ["*\t[X]", "taskList"],
        ["plain text", "text"]
    ] as const)("classifies %s as %s", (value, expected) => {
        expect(getStyle(value)).toBe(expected);
    });

    test.each([
        "#heading",
        "####### heading",
        "-item",
        "+item",
        "*item",
        "1.item",
        "2)item",
        ". item",
        ") item",
        "[ ] task",
        "-[] task",
        "word > quote",
        "word - item"
    ])("does not classify marker-like text %s", (value) => {
        expect(getStyle(value)).toBe("text");
    });

    test.each(["---", "- - -", "-  -  -", "***", "* * *", "*\t*\t*", "___", "_ _ _"])(
        "classifies thematic break %s as text",
        (value) => {
            expect(getStyle(value)).toBe("text");
        }
    );

    test.each(["- -", "* *", "- - text", "* * text"])("classifies non-thematic marker line %s as a bullet", (value) => {
        expect(getStyle(value)).toBe("bulletList");
    });

    test("classifies task markers before their bullet prefix", () => {
        expect(getStyle("- [ ] task")).toBe("taskList");
        expect(getStyle("- [x] task")).toBe("taskList");
        expect(getStyle("- [ ]task")).toBe("bulletList");
        expect(getStyle("- [y] task")).toBe("bulletList");
    });

    test("classifies arbitrary-length numbered markers", () => {
        expect(getStyle(`${"9".repeat(1_000)}. item`)).toBe("numberedList");
    });

    test.each([
        ["   - item", "bulletList"],
        ["\t\t12) item", "numberedList"],
        [" > - item", "blockquote"],
        ["  - > quote", "bulletList"],
        ["  1. - item", "numberedList"],
        ["\t- [ ] > quote", "taskList"],
        ["  ## - title", "heading2"]
    ] as const)("uses the outermost marker for %s", (value, expected) => {
        expect(getStyle(value)).toBe(expected);
    });

    test("aggregates matching nonblank lines and ignores blank lines", () => {
        const value = "- one\n\n  \t\n* two";

        expect(getStyle(value, 0, value.length)).toBe("bulletList");
    });

    test("returns text for an all-blank line range", () => {
        const value = "\n \n\t\n";

        expect(getStyle(value, 0, value.length)).toBe("text");
    });

    test("returns mixed when nonblank line styles differ", () => {
        const value = "# title\n\n> quote\nplain";

        expect(getStyle(value, 0, value.length)).toBe("mixed");
    });

    test("classifies collapsed cursors on their exact lines", () => {
        const value = "# title\n- item\nplain";

        expect(getStyle(value, 2)).toBe("heading1");
        expect(getStyle(value, 7)).toBe("heading1");
        expect(getStyle(value, 8)).toBe("bulletList");
        expect(getStyle(value, value.length)).toBe("text");
    });

    test("uses every line intersected by partial forward and backward selections", () => {
        const value = "prefix # text\n- item\n* item\nsuffix";
        const bulletStart = value.indexOf("- item") + 2;
        const bulletEnd = value.indexOf("* item") + 3;

        expect(getStyle(value, bulletStart, bulletEnd, "forward")).toBe("bulletList");
        expect(getStyle(value, bulletStart, bulletEnd, "backward")).toBe("bulletList");
        expect(getStyle(value, 3, bulletStart, "forward")).toBe("mixed");
    });

    test("excludes a trailing line touched only at column zero", () => {
        const value = "# title\nplain";
        const plainStart = value.indexOf("plain");

        expect(getStyle(value, 0, plainStart, "backward")).toBe("heading1");
        expect(getStyle(value, 0, plainStart + 1)).toBe("mixed");
    });

    test("handles LF and CRLF line positions without changing classification", () => {
        const lf = "text\n12) item\n# title";
        const crlf = "text\r\n12) item\r\n# title";

        expect(getStyle(lf, lf.indexOf("item"))).toBe("numberedList");
        expect(getStyle(crlf, crlf.indexOf("item"))).toBe("numberedList");
        expect(getStyle(crlf, crlf.indexOf("12)"), crlf.indexOf("#"))).toBe("numberedList");
        expect(getStyle(crlf, crlf.indexOf("12)"), crlf.indexOf("#") + 1)).toBe("mixed");
    });
});

describe("Fenced block styles", () => {
    test.each([
        ["```\ncode\n```", 0],
        ["```typescript\ncode\n```", 4],
        ["~~~ info ` allowed\ncode\n~~~", 5],
        ["   ```` info\ncode\n   `````", 10],
        ["~~~\n\n~~~", 4]
    ] as const)("classifies a line inside closed fence %s", (value, cursor) => {
        expect(getStyle(value, cursor)).toBe("codeBlock");
    });

    test("includes opening, content, blank, and closing lines in a fenced block", () => {
        const value = "before\n```js\ncode\n\n```\nafter";

        expect(getStyle(value, value.indexOf("```js"))).toBe("codeBlock");
        expect(getStyle(value, value.indexOf("code"))).toBe("codeBlock");
        expect(getStyle(value, value.indexOf("\n\n") + 1)).toBe("codeBlock");
        expect(getStyle(value, value.lastIndexOf("```"))).toBe("codeBlock");
        expect(getStyle(value, value.indexOf("```js"), value.indexOf("after"))).toBe("codeBlock");
    });

    test("ignores blank lines outside one fenced block during aggregation", () => {
        const value = "\n \t\n```\n\ncode\n```\n\t \n";

        expect(getStyle(value, 0, value.length)).toBe("codeBlock");
    });

    test("accepts matching closers at least as long as the opener with trailing horizontal whitespace", () => {
        const backticks = "````lang\r\n# code\r\n  ````` \t\r\n";
        const tildes = " ~~~~~\n- code\n   ~~~~~~~\t ";

        expect(getStyle(backticks, backticks.indexOf("# code"))).toBe("codeBlock");
        expect(getStyle(tildes, tildes.indexOf("- code"))).toBe("codeBlock");
    });

    test("treats marker-like content and opposite fence characters as code", () => {
        const value = "```\n# heading\n~~~\n- [ ] task\n```";

        expect(getStyle(value, value.indexOf("#"), value.indexOf("- [ ]") + 2)).toBe("codeBlock");
    });

    test.each([
        "    ```\ncode\n    ```",
        "\t```\ncode\n```",
        "``\ncode\n``",
        "```has`tick\ncode\n```",
        "```\ncode\n~~~",
        "````\ncode\n```",
        "```\ncode\n``` trailing",
        "~~~\ncode"
    ])("does not form a block from an invalid or unclosed fence in %s", (value) => {
        expect(getStyle(value, value.indexOf("code"))).toBe("text");
    });

    test("recognizes a later valid fence after an unclosed incompatible opener", () => {
        const value = "```\nunclosed\n~~~\nvalid\n~~~";

        expect(getStyle(value, value.indexOf("unclosed"))).toBe("text");
        expect(getStyle(value, value.indexOf("valid"))).toBe("codeBlock");
    });

    test("returns mixed when a line range crosses a fenced block boundary", () => {
        const value = "plain\n```\ncode\n```\nplain";
        const opening = value.indexOf("```");
        const after = value.lastIndexOf("plain");

        expect(getStyle(value, 0, opening + 1)).toBe("mixed");
        expect(getStyle(value, opening, after + 1)).toBe("mixed");
    });

    test("distinguishes fenced block identities while ignoring outside blanks", () => {
        const value = "```\none\n```\n\n~~~\ntwo\n~~~";

        expect(getStyle(value, 0, value.length)).toBe("mixed");
        expect(getStyle(value, 0, value.indexOf("~~~"))).toBe("codeBlock");
    });

    test("classifies each of multiple fenced blocks independently", () => {
        const value = "```\none\n```\nplain\n~~~\ntwo\n~~~";

        expect(getStyle(value, value.indexOf("one"))).toBe("codeBlock");
        expect(getStyle(value, value.indexOf("plain"))).toBe("text");
        expect(getStyle(value, value.indexOf("two"))).toBe("codeBlock");
    });

    test("preserves CRLF selection boundaries around fenced blocks", () => {
        const value = "before\r\n```ts\r\n# code\r\n```\r\nafter";
        const opening = value.indexOf("```ts");
        const after = value.indexOf("after");

        expect(getStyle(value, opening, after)).toBe("codeBlock");
        expect(getStyle(value, opening, after + 1)).toBe("mixed");
    });
});

describe("Block style purity", () => {
    test("does not mutate editor state and returns the same result repeatedly", () => {
        const state = Object.freeze(createEditorState("# title\n\n# second", 1, 17, "backward"));
        const snapshot = { ...state };

        expect(getActiveBlockStyle(state)).toBe("heading1");
        expect(getActiveBlockStyle(state)).toBe("heading1");
        expect(state).toEqual(snapshot);
    });
});
