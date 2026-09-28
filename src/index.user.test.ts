import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let disposeEnhancer: (() => void) | undefined;

const createSupportedEditor = (): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    document.body.append(textArea);
    return textArea;
};

const loadEnhancer = async (): Promise<void> => {
    const module = await import("./index.user");
    disposeEnhancer = module.disposeMarkdownEnhancer;
};

const dispatchKey = (textArea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...init
    });
    textArea.dispatchEvent(event);
    return event;
};

const dispatchShortcut = (textArea: HTMLTextAreaElement, key: string): KeyboardEvent => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    return dispatchKey(textArea, key, isMac ? { metaKey: true } : { ctrlKey: true });
};

const dispatchPaste = (textArea: HTMLTextAreaElement, text: string): Event => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: {
            getData: (type: string) => (type === "text" ? text : "")
        }
    });
    textArea.dispatchEvent(event);
    return event;
};

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    disposeEnhancer = undefined;
});

afterEach(() => {
    disposeEnhancer?.();
    delete (document as unknown as { execCommand?: Document["execCommand"] }).execCommand;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("Markdown Enhancer", () => {
    test("routes events from generic textarea editors", async () => {
        const first = createSupportedEditor();
        first.value = "first";
        first.setSelectionRange(0, first.value.length);
        const second = createSupportedEditor();
        second.value = "second";
        second.setSelectionRange(0, second.value.length);
        await loadEnhancer();

        dispatchKey(first, "(");
        dispatchKey(second, "[");

        expect(first.value).toBe("(first)");
        expect(second.value).toBe("[second]");
    });

    test("wraps selected text and preserves editor state", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length, "backward");
        textArea.scrollTop = 12;
        textArea.scrollLeft = 4;
        const inputEvents: InputEvent[] = [];
        textArea.addEventListener("input", (event) => inputEvents.push(event as InputEvent));
        await loadEnhancer();

        const event = dispatchKey(textArea, "(");

        expect(event.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(review)");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 7]);
        expect(textArea.selectionDirection).toBe("backward");
        expect([textArea.scrollTop, textArea.scrollLeft]).toEqual([12, 4]);
        expect(document.activeElement).toBe(textArea);
        expect(inputEvents).toHaveLength(1);
        expect(inputEvents[0].inputType).toBe("insertText");
        expect(inputEvents[0].data).toBe("(review)");
    });

    test("does not duplicate input events from a successful native transaction", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        const inputEvents: InputEvent[] = [];
        textArea.addEventListener("input", (event) => inputEvents.push(event as InputEvent));
        const executeCommand = vi.fn((command: string, isUIShown?: boolean, value = "") => {
            void isUIShown;
            const { selectionStart, selectionEnd } = textArea;
            textArea.setRangeText(value, selectionStart, selectionEnd, "select");
            textArea.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: command }));
            return true;
        });
        Object.defineProperty(document, "execCommand", { configurable: true, value: executeCommand });
        await loadEnhancer();

        dispatchKey(textArea, "(");

        expect(executeCommand).toHaveBeenCalledOnce();
        expect(inputEvents).toHaveLength(1);
        expect(textArea.value).toBe("(review)");
    });

    test("requires a selection before wrapping quotes", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(3, 3);
        await loadEnhancer();

        const event = dispatchKey(textArea, '"');

        expect(event.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("review");
    });

    test("preserves bold and italic toggle transitions", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        dispatchShortcut(textArea, "b");
        expect(textArea.value).toBe("**review**");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 8]);

        dispatchShortcut(textArea, "i");
        expect(textArea.value).toBe("***review***");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 9]);

        dispatchShortcut(textArea, "b");
        expect(textArea.value).toBe("*review*");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 7]);
    });

    test("inserts spaces up to the next four-column tab stop", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "ab";
        textArea.setSelectionRange(2, 2);
        await loadEnhancer();

        dispatchKey(textArea, "Tab");

        expect(textArea.value).toBe("ab  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([4, 4]);
    });

    test("indents and outdents every selected line", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "one\ntwo";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        dispatchKey(textArea, "Tab");
        expect(textArea.value).toBe("    one\n    two");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([4, 15]);

        dispatchKey(textArea, "Tab", { shiftKey: true });
        expect(textArea.value).toBe("one\ntwo");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 7]);
    });

    test("converts a pasted hyperlink into a Markdown link for selected text", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "documentation";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        const event = dispatchPaste(textArea, " https://example.com/path ");

        expect(event.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("[documentation](https://example.com/path)");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([41, 41]);
    });

    test("leaves non-link paste behavior to the browser", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "documentation";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        const event = dispatchPaste(textArea, "ordinary text");

        expect(event.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("documentation");
    });

    test("routes events from editors added after startup", async () => {
        await loadEnhancer();
        const textArea = createSupportedEditor();
        textArea.value = "dynamic";
        textArea.setSelectionRange(0, textArea.value.length);

        dispatchKey(textArea, "(");

        expect(textArea.value).toBe("(dynamic)");
    });

    test("registers only one delegated listener for each editor event", async () => {
        const addEventListener = vi.spyOn(document, "addEventListener");
        await loadEnhancer();

        document.body.append(document.createElement("div"));
        createSupportedEditor();

        expect(addEventListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
        expect(addEventListener.mock.calls.filter(([type]) => type === "paste")).toHaveLength(1);
    });

    test.fails("does not indent a line touched only by a selection ending at its start", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "first\nsecond";
        textArea.setSelectionRange(0, 6);
        await loadEnhancer();

        dispatchKey(textArea, "Tab");

        expect(textArea.value).toBe("    first\nsecond");
    });
});
