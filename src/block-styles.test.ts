import { describe, expect, test } from "vitest";
import {
    ACTIVE_BLOCK_STYLES,
    applyBlockStyle,
    CONCRETE_BLOCK_STYLES,
    getActiveBlockStyle,
    type ActiveBlockStyle,
    type ConcreteBlockStyle
} from "./block-styles";
import type { EditOperation, EditorSelectionDirection, EditorState } from "./editor-state";

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

const executeStyle = (
    state: EditorState,
    targetStyle: ConcreteBlockStyle,
    bulletStyle: "-" | "*" | "+" = "-"
): EditorState => applyOperation(state, applyBlockStyle(state, targetStyle, bulletStyle));

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

describe("Block style transformations", () => {
    test.each([
        ["plain", "text"],
        ["# title", "heading1"],
        ["## title", "heading2"],
        ["### title", "heading3"],
        ["#### title", "heading4"],
        ["##### title", "heading5"],
        ["###### title", "heading6"],
        ["> quote", "blockquote"],
        ["```\ncode\n```", "codeBlock"],
        ["- item", "bulletList"],
        ["1. item", "numberedList"],
        ["- [ ] item", "taskList"]
    ] as const)("returns no operation when %s already has active style %s", (value, style) => {
        const state = createEditorState(value, Math.min(1, value.length), Math.min(1, value.length));

        expect(applyBlockStyle(state, style)).toBeNull();
    });

    test("removes only the outermost marker when applying Text", () => {
        expect(executeStyle(createEditorState("  ## > nested"), "text").value).toBe("  > nested");
        expect(executeStyle(createEditorState("\t> - item"), "text").value).toBe("\t- item");
        expect(executeStyle(createEditorState("- [x] 1. task"), "text").value).toBe("1. task");
    });

    test("replaces outermost markers while preserving nested markers and indentation", () => {
        const state = createEditorState("  ## > title\n\t- [x] 1. task\nplain", 0, 34, "backward");
        const result = executeStyle(state, "blockquote");

        expect(result.value).toBe("  > > title\n\t> 1. task\n> plain");
        expect(result.selectionDirection).toBe("backward");
    });

    test.each([
        ["heading1", "# value"],
        ["heading2", "## value"],
        ["heading3", "### value"],
        ["heading4", "#### value"],
        ["heading5", "##### value"],
        ["heading6", "###### value"],
        ["blockquote", "> value"],
        ["bulletList", "- value"],
        ["numberedList", "1. value"],
        ["taskList", "- [ ] value"]
    ] as const)("uses the canonical prefix for %s", (style, expected) => {
        expect(executeStyle(createEditorState("value", 2, 2), style).value).toBe(expected);
    });

    test("uses the configured bullet for bullets and tasks while normalizing numbered markers to one", () => {
        expect(executeStyle(createEditorState("plain"), "bulletList", "+").value).toBe("+ plain");
        expect(executeStyle(createEditorState("plain"), "taskList", "*").value).toBe("* [ ] plain");
        expect(executeStyle(createEditorState("42) value"), "numberedList", "+").value).toBe("42) value");
        expect(executeStyle(createEditorState("- value"), "numberedList", "+").value).toBe("1. value");
    });

    test("styles every selected nonblank line and preserves blank lines", () => {
        const state = createEditorState("one\n\n \t\n  two", 1, 13);
        const result = executeStyle(state, "taskList", "+");

        expect(result.value).toBe("+ [ ] one\n\n \t\n  + [ ] two");
    });

    test("adds a marker for a collapsed cursor on empty and whitespace-only lines", () => {
        const empty = executeStyle(createEditorState("before\n\nafter", 7, 7), "heading2");
        expect(empty.value).toBe("before\n## \nafter");
        expect([empty.selectionStart, empty.selectionEnd]).toEqual([10, 10]);

        const whitespace = executeStyle(createEditorState("  \t", 1, 1), "heading2");
        expect(whitespace.value).toBe("  \t## ");
        expect([whitespace.selectionStart, whitespace.selectionEnd]).toEqual([6, 6]);
    });

    test("preserves thematic-break content during conversions", () => {
        expect(applyBlockStyle(createEditorState("---"), "text")).toBeNull();
        const heading = executeStyle(createEditorState("---"), "heading1");
        expect(heading.value).toBe("# ---");
        expect(executeStyle(heading, "text").value).toBe("---");
    });

    test("maps partial backward selections through marker replacements with CRLF intact", () => {
        const value = "  12) one\r\n- [x] two";
        const state = createEditorState(value, value.indexOf("one"), value.length, "backward");
        const result = executeStyle(state, "bulletList", "*");

        expect(result.value).toBe("  * one\r\n* two");
        expect([result.selectionStart, result.selectionEnd]).toEqual([
            result.value.indexOf("one"),
            result.value.length
        ]);
        expect(result.selectionDirection).toBe("backward");
    });

    test("excludes a trailing line selected only at column zero", () => {
        const state = createEditorState("one\ntwo", 0, 4, "forward");
        const result = executeStyle(state, "heading1");

        expect(result.value).toBe("# one\ntwo");
        expect([result.selectionStart, result.selectionEnd]).toEqual([2, 6]);
    });
});

describe("Fenced block style transformations", () => {
    test("wraps the current line without a language placeholder and keeps a collapsed cursor in content", () => {
        const state = createEditorState("before\ncode\nafter", 9, 9);
        const result = executeStyle(state, "codeBlock");

        expect(result.value).toBe("before\n```\ncode\n```\nafter");
        expect([result.selectionStart, result.selectionEnd]).toEqual([13, 13]);
    });

    test("places a collapsed cursor inside an empty fence", () => {
        const result = executeStyle(createEditorState("", 0, 0), "codeBlock");

        expect(result.value).toBe("```\n\n```");
        expect([result.selectionStart, result.selectionEnd]).toEqual([4, 4]);
    });

    test("wraps every intersected selected line and maps a backward partial selection", () => {
        const value = "before\none\ntwo\nafter";
        const state = createEditorState(value, value.indexOf("one") + 1, value.indexOf("two") + 2, "backward");
        const result = executeStyle(state, "codeBlock");

        expect(result.value).toBe("before\n```\none\ntwo\n```\nafter");
        expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("ne\ntw");
        expect(result.selectionDirection).toBe("backward");
    });

    test("uses a fence longer than internal backtick runs", () => {
        const result = executeStyle(createEditorState("before\n`````\nafter", 0, 18), "codeBlock");

        expect(result.value).toBe("``````\nbefore\n`````\nafter\n``````");
    });

    test("preserves CRLF when creating a fence", () => {
        const value = "before\r\ncode\r\nafter";
        const state = createEditorState(value, value.indexOf("code"), value.indexOf("code") + 4);

        expect(executeStyle(state, "codeBlock").value).toBe("before\r\n```\r\ncode\r\n```\r\nafter");
    });

    test.each(["```js\ncode\n```", "~~~ info\ncode\n~~~~"])(
        "returns no operation anywhere inside one active fence: %s",
        (value) => {
            const cursor = value.indexOf("code") + 2;
            expect(applyBlockStyle(createEditorState(value, cursor, cursor), "codeBlock")).toBeNull();
        }
    );

    test("unwraps a complete tilde fence and applies the target to every nonblank content line", () => {
        const value = "before\n~~~lang\n# one\n\n- [x] two\n~~~\nafter";
        const cursor = value.indexOf("one") + 2;
        const result = executeStyle(createEditorState(value, cursor, cursor), "blockquote");

        expect(result.value).toBe("before\n> one\n\n> two\nafter");
        expect(result.value[result.selectionStart]).toBe("e");
        expect(result.selectionStart).toBe(result.value.indexOf("one") + 2);
    });

    test("unwraps a backtick fence when the selection touches its opener or closer", () => {
        const value = "before\n```ts\n> nested\n```\nafter";
        const opening = value.indexOf("```ts");
        const closingEnd = value.lastIndexOf("```") + 3;
        const result = executeStyle(createEditorState(value, opening, closingEnd), "text");

        expect(result.value).toBe("before\n> nested\nafter");
        expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("> nested\n");
    });

    test("preserves CRLF while unwrapping and converting a fence", () => {
        const value = "before\r\n```\r\n- one\r\n\r\nplain\r\n```\r\nafter";
        const cursor = value.indexOf("plain") + 2;
        const result = executeStyle(createEditorState(value, cursor, cursor), "numberedList");

        expect(result.value).toBe("before\r\n1. one\r\n\r\n1. plain\r\nafter");
        expect(result.selectionStart).toBe(result.value.indexOf("plain") + 2);
    });

    test("converts a mixed selection deterministically without leaving partial fences", () => {
        const value = "plain\n```js\n# code\n```\n> final";
        const state = createEditorState(value, 2, value.indexOf("final") + 3, "forward");
        const first = executeStyle(state, "numberedList");
        const second = executeStyle(state, "numberedList");

        expect(first).toEqual(second);
        expect(first.value).toBe("1. plain\n1. code\n1. final");
        expect(first.value).not.toContain("```");
    });

    test("expands a mixed code selection to complete fences before wrapping once", () => {
        const value = "plain\n```\ncode\n```\nafter";
        const state = createEditorState(value, 2, value.indexOf("code") + 2);
        const result = executeStyle(state, "codeBlock");

        expect(result.value).toBe("````\nplain\n```\ncode\n```\n````\nafter");
        expect(getActiveBlockStyle(createEditorState(result.value, 0, result.value.indexOf("after")))).toBe(
            "codeBlock"
        );
    });

    test("does not mutate the source state while transforming", () => {
        const state = Object.freeze(createEditorState("  > item\r\nplain", 3, 15, "backward"));
        const snapshot = { ...state };

        expect(executeStyle(state, "taskList", "+").value).toBe("  + [ ] item\r\n+ [ ] plain");
        expect(state).toEqual(snapshot);
    });
});

describe("Block style edge cases", () => {
    test("Text unwraps a containing fence without interpreting literal code markers", () => {
        const value = "```ts\n> nested\n```";
        const result = executeStyle(createEditorState(value, value.indexOf("nested") + 2), "text");

        expect(result.value).toBe("> nested\n");
        expect(result.value[result.selectionStart]).toBe("s");
    });

    test("non-code styles unwrap a containing fence before replacing outer content markers", () => {
        const value = "```ts\n> nested\n```";
        const result = executeStyle(createEditorState(value, value.indexOf("nested") + 2), "heading2");

        expect(result.value).toBe("## nested\n");
        expect(result.value[result.selectionStart]).toBe("s");
    });

    test.each([
        ["```\n```", 1, "heading1", "# ", 2],
        ["```\n```", 5, "bulletList", "- ", 2],
        ["```\n```", 4, "blockquote", "> ", 2],
        ["```\n\n```", 1, "heading1", "# \n", 2],
        ["```\n\n```", 6, "bulletList", "- \n", 2],
        ["```\n\n```", 5, "blockquote", "> \n", 2]
    ] as const)(
        "converts collapsed empty fence %j to %s with the cursor after its marker",
        (value, cursor, style, expectedValue, expectedCursor) => {
            const result = executeStyle(createEditorState(value, cursor), style);

            expect(result.value).toBe(expectedValue);
            expect([result.selectionStart, result.selectionEnd]).toEqual([expectedCursor, expectedCursor]);
        }
    );

    test.each([
        ["```\n\n\n```", 5, "\n> \n", 3],
        ["```\n\n\n\n```", 4, "> \n\n\n", 2],
        ["```\n\n\n\n```", 5, "\n> \n\n", 3],
        ["```\n\n\n\n```", 6, "\n\n> \n", 4]
    ] as const)(
        "targets collapsed blank fence content at cursor %i",
        (value, cursor, expectedValue, expectedCursor) => {
            const result = executeStyle(createEditorState(value, cursor), "blockquote");

            expect(result.value).toBe(expectedValue);
            expect([result.selectionStart, result.selectionEnd]).toEqual([expectedCursor, expectedCursor]);
        }
    );

    test.each([
        [0, 1],
        [4, 5]
    ])("unwraps a selected empty fence without inserting the target marker", (selectionStart, selectionEnd) => {
        const result = executeStyle(createEditorState("```\n```", selectionStart, selectionEnd), "heading1");

        expect(result.value).toBe("");
        expect([result.selectionStart, result.selectionEnd]).toEqual([0, 0]);
    });

    test("keeps a converted empty fence marker separate from the following line", () => {
        const value = "before\n```\n```\r\nafter";
        const result = executeStyle(createEditorState(value, value.indexOf("```") + 1), "blockquote");

        expect(result.value).toBe("before\n> \r\nafter");
        expect([result.selectionStart, result.selectionEnd]).toEqual([9, 9]);
    });

    test("wraps two selected fenced blocks in one atomic outer code block", () => {
        const value = "```\none\n```\n~~~\ntwo\n~~~";
        const result = executeStyle(createEditorState(value, 0, value.length), "codeBlock");

        expect(result.value).toBe(`\`\`\`\`\n${value}\n\`\`\`\``);
        expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(value);
    });

    test("wraps selected all-blank lines in one atomic outer code block", () => {
        const value = "\n \t\n";
        const result = executeStyle(createEditorState(value, 0, value.length), "codeBlock");

        expect(result.value).toBe("```\n\n \t\n```\n");
        expect(result.value.match(/^```$/gm)).toHaveLength(2);
    });

    test("maps an LF next-line-start endpoint to the selected code content", () => {
        const result = executeStyle(createEditorState("one\ntwo", 0, 4), "codeBlock");

        expect(result.value).toBe("```\none\n```\ntwo");
        expect([result.selectionStart, result.selectionEnd]).toEqual([4, 7]);
        expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("one");
    });

    test.each([3, 4, 5])("maps split CRLF endpoint %i to an ordered in-bounds code selection", (selectionEnd) => {
        const result = executeStyle(createEditorState("one\r\ntwo", 0, selectionEnd, "backward"), "codeBlock");

        expect(result.value).toBe("```\r\none\r\n```\r\ntwo");
        expect([result.selectionStart, result.selectionEnd]).toEqual([5, 8]);
        expect(result.selectionStart).toBeGreaterThanOrEqual(0);
        expect(result.selectionStart).toBeLessThanOrEqual(result.selectionEnd);
        expect(result.selectionEnd).toBeLessThanOrEqual(result.value.length);
        expect(result.selectionDirection).toBe("backward");
    });

    test("retains content line endings and removes the closer line ending during fence conversion", () => {
        const value = "x\n```\na\n```\r\ny";
        const result = executeStyle(createEditorState(value, value.indexOf("a")), "blockquote");

        expect(result.value).toBe("x\n> a\ny");
    });

    test.each([
        ["```\na\n```", "blockquote", "> a\n"],
        ["```\n```", "text", ""],
        ["```\n\n```", "text", "\n"]
    ] as const)("handles EOF and empty fence conversion for %j", (value, style, expected) => {
        expect(executeStyle(createEditorState(value, value.indexOf("```", 1)), style).value).toBe(expected);
    });

    test.each([0, 1, 3])("styles a collapsed whitespace-only line after indentation from column %i", (cursor) => {
        const result = executeStyle(createEditorState("  \t", cursor), "blockquote");

        expect(result.value).toBe("  \t> ");
        expect([result.selectionStart, result.selectionEnd]).toEqual([5, 5]);
    });

    test.each([
        [">     code", "    code"],
        ["###   title", "  title"],
        ["-   item", "  item"],
        ["42)\t\titem", "\titem"],
        ["- \t[ ]   task", "  task"]
    ])("Text consumes only the minimum trailing separator in %j", (value, expected) => {
        expect(executeStyle(createEditorState(value), "text").value).toBe(expected);
    });

    test.each([
        [">     code", "bulletList", "+", "+     code"],
        ["##   > nested", "taskList", "*", "* [ ]   > nested"],
        ["-   1. nested", "heading1", "-", "#   1. nested"]
    ] as const)(
        "keeps the configured prefix and nested content when converting ambiguous syntax %j",
        (value, style, bulletStyle, expected) => {
            expect(executeStyle(createEditorState(value), style, bulletStyle).value).toBe(expected);
        }
    );
});
