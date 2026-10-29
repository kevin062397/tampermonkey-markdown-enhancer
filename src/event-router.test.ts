import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createCommandRegistry } from "./command-registry";
import { attachEditorEventRouter, type EditorEventResolver } from "./event-router";

let disposeRouter: (() => void) | undefined;

const createTextArea = (): HTMLTextAreaElement => {
    const textArea = document.createElement("textarea");
    document.body.append(textArea);
    return textArea;
};

const createResolver =
    (textAreas: readonly HTMLTextAreaElement[]): EditorEventResolver =>
    (event) => {
        const textArea = event.composedPath().find((target) => textAreas.includes(target as HTMLTextAreaElement));
        return textArea instanceof HTMLTextAreaElement
            ? {
                  textArea,
                  commandRegistry: createCommandRegistry(),
                  tabWidth: 4,
                  shouldDispatchChangeEventAfterEdit: false
              }
            : null;
    };

const dispatchKey = (textArea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        ...init
    });
    textArea.dispatchEvent(event);
    return event;
};

const dispatchKeyup = (textArea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        ...init
    });
    textArea.dispatchEvent(event);
    return event;
};

const resetTextArea = (textArea: HTMLTextAreaElement, value = "plain"): void => {
    textArea.value = value;
    textArea.setSelectionRange(value.length, value.length);
};

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    disposeRouter?.();
    disposeRouter = undefined;
    delete (document as unknown as { execCommand?: Document["execCommand"] }).execCommand;
    document.body.innerHTML = "";
});

describe("Editor event router focus exit", () => {
    test("allows one native Tab or Shift+Tab after Escape", () => {
        const textArea = createTextArea();
        disposeRouter = attachEditorEventRouter(createResolver([textArea]));

        resetTextArea(textArea);
        expect(dispatchKey(textArea, "Escape").defaultPrevented).toBe(false);
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("plain");
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("plain   ");

        resetTextArea(textArea, "    plain");
        expect(dispatchKey(textArea, "Escape").defaultPrevented).toBe(false);
        expect(dispatchKey(textArea, "Shift", { shiftKey: true }).defaultPrevented).toBe(false);
        expect(dispatchKey(textArea, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
        dispatchKeyup(textArea, "Shift");
        expect(textArea.value).toBe("    plain");
        expect(dispatchKey(textArea, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
        expect(textArea.value).toBe("plain");
    });

    test("allows native Shift+Tab when no outdent exists", () => {
        const textArea = createTextArea();
        resetTextArea(textArea);
        disposeRouter = attachEditorEventRouter(createResolver([textArea]));

        const event = dispatchKey(textArea, "Tab", { shiftKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("plain");
    });

    test("clears focus exit for intervening editor events", () => {
        const textArea = createTextArea();
        const outside = document.createElement("button");
        document.body.append(outside);
        disposeRouter = attachEditorEventRouter(createResolver([textArea]));
        const cases: readonly (readonly [string, () => void])[] = [
            ["another key", () => void dispatchKey(textArea, "ArrowLeft")],
            ["input", () => textArea.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }))],
            ["paste", () => textArea.dispatchEvent(new Event("paste", { bubbles: true, composed: true }))],
            [
                "focus departure",
                () =>
                    textArea.dispatchEvent(
                        new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: outside })
                    )
            ],
            [
                "composition start",
                () =>
                    textArea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, composed: true }))
            ],
            [
                "composition end",
                () => textArea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, composed: true }))
            ]
        ];

        for (const [caseName, dispatchInterveningEvent] of cases) {
            resetTextArea(textArea);
            dispatchKey(textArea, "Escape");
            dispatchInterveningEvent();
            const tabEvent = dispatchKey(textArea, "Tab");
            expect(tabEvent.defaultPrevented, caseName).toBe(true);
        }
    });

    test("keeps focus exit local to one editor and one router", () => {
        const first = createTextArea();
        const second = createTextArea();
        resetTextArea(first, "first");
        resetTextArea(second, "second");
        disposeRouter = attachEditorEventRouter(createResolver([first, second]));

        dispatchKey(first, "Escape");
        expect(dispatchKey(second, "Tab").defaultPrevented).toBe(true);
        expect(second.value).toBe("second  ");
        expect(dispatchKey(first, "Tab").defaultPrevented).toBe(true);
        expect(first.value).toBe("first   ");

        dispatchKey(first, "Escape");
        disposeRouter();
        disposeRouter = undefined;
        expect(dispatchKey(first, "Tab").defaultPrevented).toBe(false);
    });

    test("supports focus exit inside an open ShadowRoot", () => {
        const host = document.createElement("div");
        const root = host.attachShadow({ mode: "open" });
        const textArea = document.createElement("textarea");
        root.append(textArea);
        document.body.append(host);
        resetTextArea(textArea);
        disposeRouter = attachEditorEventRouter(createResolver([textArea]));

        dispatchKey(textArea, "Escape");
        const tabEvent = dispatchKey(textArea, "Tab");

        expect(tabEvent.defaultPrevented).toBe(false);
        expect(textArea.value).toBe("plain");
    });

    test("requires an unmodified Escape followed by an unmodified Tab", () => {
        const textArea = createTextArea();
        disposeRouter = attachEditorEventRouter(createResolver([textArea]));

        for (const escapeModifiers of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
            resetTextArea(textArea);
            dispatchKey(textArea, "Escape", escapeModifiers);
            expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);
        }

        resetTextArea(textArea);
        dispatchKey(textArea, "Escape");
        expect(dispatchKey(textArea, "Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);

        resetTextArea(textArea);
        textArea.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
        expect(dispatchKey(textArea, "Escape").defaultPrevented).toBe(true);
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);

        resetTextArea(textArea);
        dispatchKey(textArea, "Escape");
        dispatchKey(textArea, "Shift", { shiftKey: true });
        dispatchKeyup(textArea, "Shift");
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);

        resetTextArea(textArea);
        dispatchKey(textArea, "Escape", { isComposing: true });
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);
    });
});
