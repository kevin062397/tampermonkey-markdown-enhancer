import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const NativeMutationObserver = globalThis.MutationObserver;
const activeObservers: MutationObserver[] = [];

const createSupportedEditor = (): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    document.body.append(textArea);
    return textArea;
};

const loadEnhancer = async (): Promise<void> => {
    await import("./index.user");
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

const flushMutations = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    activeObservers.length = 0;

    class TrackedMutationObserver extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
            super(callback);
            activeObservers.push(this);
        }
    }

    vi.stubGlobal("MutationObserver", TrackedMutationObserver);
});

afterEach(() => {
    for (const observer of activeObservers) {
        observer.disconnect();
    }
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

describe("Markdown Enhancer", () => {
    test("attaches to generic textarea editors", async () => {
        const first = createSupportedEditor();
        const second = createSupportedEditor();

        await loadEnhancer();

        expect(first.dataset.markdownEnhancerAttached).toBe("true");
        expect(second.dataset.markdownEnhancerAttached).toBe("true");
    });

    test("wraps selected text and preserves the inner selection", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        const event = dispatchKey(textArea, "(");

        expect(event.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(review)");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 7]);
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

    test("attaches to editors added after startup", async () => {
        await loadEnhancer();

        const textArea = createSupportedEditor();
        await flushMutations();

        expect(textArea.dataset.markdownEnhancerAttached).toBe("true");
    });

    test("does not attach duplicate listeners after later DOM mutations", async () => {
        const textArea = createSupportedEditor();
        const addEventListener = vi.spyOn(textArea, "addEventListener");
        await loadEnhancer();

        document.body.append(document.createElement("div"));
        await flushMutations();

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
