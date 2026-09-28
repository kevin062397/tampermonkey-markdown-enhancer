import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EditorCommand } from "./command-registry";

const ASYMMETRIC_PAIR_CASES = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"]
] as const;

const SYMMETRIC_PAIR_CASES = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"]
] as const;

const PAIR_CASES = [...ASYMMETRIC_PAIR_CASES, ...SYMMETRIC_PAIR_CASES] as const;

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

const loadEnhancerWithCommands = async (additionalCommands: readonly EditorCommand[]): Promise<void> => {
    const module = await import("./runtime");
    disposeEnhancer = module.initializeMarkdownEnhancer(additionalCommands);
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
    const isApplePlatform = /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return dispatchKey(textArea, key, isApplePlatform ? { metaKey: true } : { ctrlKey: true });
};

const setUserAgent = (userAgent: string): void => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
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

    test("leaves read-only editors unchanged", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        textArea.readOnly = true;
        await loadEnhancer();

        const shortcutEvent = dispatchShortcut(textArea, "b");
        const wrappingEvent = dispatchKey(textArea, "(");
        const tabEvent = dispatchKey(textArea, "Tab");

        expect(shortcutEvent.defaultPrevented).toBe(false);
        expect(wrappingEvent.defaultPrevented).toBe(false);
        expect(tabEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("review");
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

    test("creates every asymmetric pair at a collapsed cursor", async () => {
        const textArea = createSupportedEditor();
        await loadEnhancer();

        for (const [leading, trailing] of ASYMMETRIC_PAIR_CASES) {
            textArea.value = "";
            textArea.setSelectionRange(0, 0);
            const event = dispatchKey(textArea, leading);
            expect(event.defaultPrevented).toBe(true);
            expect(textArea.value).toBe(leading + trailing);
            expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 1]);
        }
    });

    test("wraps selected text with every supported pair", async () => {
        const textArea = createSupportedEditor();
        await loadEnhancer();

        for (const [leading, trailing] of PAIR_CASES) {
            textArea.value = "value";
            textArea.setSelectionRange(0, 5);
            const event = dispatchKey(textArea, leading);
            expect(event.defaultPrevented).toBe(true);
            expect(textArea.value).toBe(`${leading}value${trailing}`);
            expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 6]);
        }
    });

    test("skips every existing matching closer without emitting input", async () => {
        const textArea = createSupportedEditor();
        const inputEvents: InputEvent[] = [];
        textArea.addEventListener("input", (event) => inputEvents.push(event as InputEvent));
        await loadEnhancer();

        for (const [leading, trailing] of PAIR_CASES) {
            textArea.value = `${leading}value${trailing}`;
            textArea.setSelectionRange(6, 6);
            const event = dispatchKey(textArea, trailing);
            expect(event.defaultPrevented).toBe(true);
            expect(textArea.value).toBe(`${leading}value${trailing}`);
            expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([7, 7]);
        }
        expect(inputEvents).toHaveLength(0);
    });

    test("deletes every empty pair with one Backspace edit", async () => {
        const textArea = createSupportedEditor();
        const inputEvents: InputEvent[] = [];
        textArea.addEventListener("input", (event) => inputEvents.push(event as InputEvent));
        await loadEnhancer();

        for (const [leading, trailing] of PAIR_CASES) {
            textArea.value = leading + trailing;
            textArea.setSelectionRange(1, 1);
            const event = dispatchKey(textArea, "Backspace");
            expect(event.defaultPrevented).toBe(true);
            expect(textArea.value).toBe("");
            expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 0]);
        }
        expect(inputEvents).toHaveLength(PAIR_CASES.length);
    });

    test("deletes nested empty pairs from the inside out", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "([])";
        textArea.setSelectionRange(2, 2);
        await loadEnhancer();

        dispatchKey(textArea, "Backspace");
        expect(textArea.value).toBe("()");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 1]);

        dispatchKey(textArea, "Backspace");
        expect(textArea.value).toBe("");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 0]);
    });

    test("skips only the matching closer in a duplicated sequence", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "())";
        textArea.setSelectionRange(1, 1);
        await loadEnhancer();

        const matchingEvent = dispatchKey(textArea, ")");
        const unmatchedEvent = dispatchKey(textArea, ")");

        expect(matchingEvent.defaultPrevented).toBe(true);
        expect(unmatchedEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("())");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([2, 2]);
    });

    test("leaves unmatched closers and selected Backspace to the browser", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "value)";
        textArea.setSelectionRange(5, 5);
        await loadEnhancer();

        const closerEvent = dispatchKey(textArea, ")");
        expect(closerEvent.defaultPrevented).toBe(false);
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([5, 5]);

        textArea.value = "([x)]";
        textArea.setSelectionRange(3, 3);
        const crossedCloserEvent = dispatchKey(textArea, ")");
        expect(crossedCloserEvent.defaultPrevented).toBe(false);
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 3]);

        textArea.value = "()";
        textArea.setSelectionRange(0, 2);
        const backspaceEvent = dispatchKey(textArea, "Backspace");
        expect(backspaceEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("()");

        textArea.value = "\\''";
        textArea.setSelectionRange(2, 2);
        const escapedBackspaceEvent = dispatchKey(textArea, "Backspace");
        expect(escapedBackspaceEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("\\''");

        textArea.value = "()";
        textArea.setSelectionRange(1, 1);
        const modifiedBackspaceEvent = dispatchKey(textArea, "Backspace", { ctrlKey: true });
        expect(modifiedBackspaceEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("()");
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

    test("falls back to a core shortcut when an injected command declines execution", async () => {
        const executeInjectedCommand = vi.fn(() => false);
        const injectedCommand: EditorCommand = {
            id: "custom.bold",
            label: "Contextual bold",
            shortcut: { key: "b", isPrimaryModifierRequired: true },
            isAvailable: () => true,
            execute: executeInjectedCommand
        };
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancerWithCommands([injectedCommand]);

        const event = dispatchShortcut(textArea, "b");

        expect(event.defaultPrevented).toBe(true);
        expect(executeInjectedCommand).toHaveBeenCalledOnce();
        expect(textArea.value).toBe("**review**");
    });

    test("leaves unavailable formatting shortcuts to the page", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, 0);
        await loadEnhancer();

        const emptySelectionEvent = dispatchShortcut(textArea, "b");
        expect(emptySelectionEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("review");

        textArea.value = "   ";
        textArea.setSelectionRange(0, 3);
        const whitespaceEvent = dispatchShortcut(textArea, "i");
        const linkEvent = dispatchShortcut(textArea, "k");
        expect(whitespaceEvent.defaultPrevented).toBe(false);
        expect(linkEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("   ");
    });

    test("inserts and selects smart-link placeholders with the primary K shortcut", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "  docs  ";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        const labelEvent = dispatchShortcut(textArea, "k");
        expect(labelEvent.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("  [docs](url)  ");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([9, 12]);

        textArea.value = "https://example.com/path";
        textArea.setSelectionRange(0, textArea.value.length);
        const urlEvent = dispatchShortcut(textArea, "k");
        expect(urlEvent.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("[link text](https://example.com/path)");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([1, 10]);
    });

    test("uses Command as the primary modifier on Apple platforms", async () => {
        setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        const commandEvent = dispatchKey(textArea, "b", { metaKey: true });
        expect(commandEvent.defaultPrevented).toBe(true);
        expect(textArea.value).toBe("**review**");

        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        const controlEvent = dispatchKey(textArea, "b", { ctrlKey: true });
        expect(controlEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("review");
    });

    test.each([
        ["Shift", { ctrlKey: true, shiftKey: true }],
        ["Alt", { altKey: true, ctrlKey: true }],
        ["Control and Meta", { ctrlKey: true, metaKey: true }]
    ])("leaves %s modifier combinations to the page", async (_name, modifiers: KeyboardEventInit) => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        const event = dispatchKey(textArea, "b", modifiers);

        expect(event.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("review");
    });

    test("routes injected non-primary shortcuts only without modifiers", async () => {
        const executeInjectedCommand = vi.fn(() => true);
        const injectedCommand: EditorCommand = {
            id: "custom.unmodified",
            label: "Unmodified",
            shortcut: { key: "b", isPrimaryModifierRequired: false },
            isAvailable: () => true,
            execute: executeInjectedCommand
        };
        const textArea = createSupportedEditor();
        await loadEnhancerWithCommands([injectedCommand]);

        for (const modifiers of [
            { ctrlKey: true, shiftKey: true },
            { altKey: true },
            { ctrlKey: true, metaKey: true },
            { ctrlKey: true },
            { metaKey: true }
        ]) {
            const event = dispatchKey(textArea, "b", modifiers);
            expect(event.defaultPrevented).toBe(false);
        }
        expect(executeInjectedCommand).not.toHaveBeenCalled();

        const event = dispatchKey(textArea, "b");
        expect(event.defaultPrevented).toBe(true);
        expect(executeInjectedCommand).toHaveBeenCalledOnce();
    });

    test("leaves Control-modified non-primary shortcuts to the page on Apple platforms", async () => {
        setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
        const executeInjectedCommand = vi.fn(() => true);
        const injectedCommand: EditorCommand = {
            id: "custom.unmodified",
            label: "Unmodified",
            shortcut: { key: "b", isPrimaryModifierRequired: false },
            isAvailable: () => true,
            execute: executeInjectedCommand
        };
        const textArea = createSupportedEditor();
        await loadEnhancerWithCommands([injectedCommand]);

        const event = dispatchKey(textArea, "b", { ctrlKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(executeInjectedCommand).not.toHaveBeenCalled();
    });

    test("leaves modified wrapping and Tab keys to the page", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "review";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();

        for (const event of [
            dispatchKey(textArea, "[", { ctrlKey: true }),
            dispatchKey(textArea, "Tab", { metaKey: true }),
            dispatchKey(textArea, "Tab", { altKey: true })
        ]) {
            expect(event.defaultPrevented).toBe(false);
        }
        expect(textArea.value).toBe("review");
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

    test("maps a backward partial-indentation selection through outdent", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "  one\n    two\nthree";
        textArea.setSelectionRange(1, 14, "backward");
        await loadEnhancer();

        dispatchKey(textArea, "Tab", { shiftKey: true });

        expect(textArea.value).toBe("one\ntwo\nthree");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 8]);
        expect(textArea.selectionDirection).toBe("backward");
    });

    test("outdents collapsed and whitespace-only selections safely", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "    item";
        textArea.setSelectionRange(2, 2);
        await loadEnhancer();

        dispatchKey(textArea, "Tab", { shiftKey: true });
        expect(textArea.value).toBe("item");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 0]);

        textArea.value = "  \nitem";
        textArea.setSelectionRange(0, 2);
        dispatchKey(textArea, "Tab", { shiftKey: true });
        expect(textArea.value).toBe("\nitem");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([0, 0]);
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

    test("escapes Markdown-sensitive pasted links while preserving selected whitespace", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "  [docs]\\guide  ";
        textArea.setSelectionRange(0, textArea.value.length);
        await loadEnhancer();
        const expected = "  [\\[docs\\]\\\\guide](https://example.com/a_\\(b\\)%3Cc%3E)  ";

        const event = dispatchPaste(textArea, "https://example.com/a_(b)<c>");

        expect(event.defaultPrevented).toBe(true);
        expect(textArea.value).toBe(expected);
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([expected.length - 2, expected.length - 2]);
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

    test("leaves URL paste with no selection to the browser", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "documentation";
        textArea.setSelectionRange(3, 3);
        await loadEnhancer();

        const event = dispatchPaste(textArea, "https://example.com/path");

        expect(event.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("documentation");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([3, 3]);
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

    test("does not indent a line touched only by a selection ending at its start", async () => {
        const textArea = createSupportedEditor();
        textArea.value = "first\nsecond";
        textArea.setSelectionRange(0, 6, "backward");
        await loadEnhancer();

        dispatchKey(textArea, "Tab");

        expect(textArea.value).toBe("    first\nsecond");
        expect([textArea.selectionStart, textArea.selectionEnd]).toEqual([4, 10]);
        expect(textArea.selectionDirection).toBe("backward");
    });
});
