import { afterEach, describe, expect, test, vi } from "vitest";
import { createDefaultSettings, SETTINGS_STORAGE_KEY, type MarkdownEnhancerSettings } from "./settings";
import { createDefaultUserscriptEnvironment, initializeUserscript, type UserscriptEnvironment } from "./userscript";

let disposeUserscript: (() => void) | undefined;

const dispatchKey = (textArea: HTMLTextAreaElement, key: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
    textArea.dispatchEvent(event);
    return event;
};

afterEach(() => {
    disposeUserscript?.();
    disposeUserscript = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("Userscript", () => {
    test.each([
        ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Command"],
        ["Mozilla/5.0 (X11; Linux x86_64)", "Control"]
    ] as const)("uses the platform modifier label for %s", (userAgent, expectedLabel) => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

        expect(createDefaultUserscriptEnvironment().getPrimaryModifierLabel()).toBe(expectedLabel);
    });

    test("composes storage, static menus, live targeting, and runtime", () => {
        let storedValue: unknown;
        const commands = new Map<string, () => void>();
        const inputs = ["2"];
        const writeValue = vi.fn((key: string, value: MarkdownEnhancerSettings) => {
            expect(key).toBe(SETTINGS_STORAGE_KEY);
            storedValue = value;
        });
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => storedValue),
            writeValue,
            registerCommand: vi.fn((label, callback) => commands.set(label, callback)),
            requestInput: vi.fn(() => inputs.shift() ?? null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };
        disposeUserscript = initializeUserscript(environment);
        const textArea = document.createElement("textarea");
        document.body.append(textArea);

        expect(commands).toHaveLength(7);
        expect(writeValue).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, createDefaultSettings());

        textArea.value = "a";
        textArea.setSelectionRange(1, 1);
        commands.get("Set Tab Width")?.();
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("a ");

        commands.get("Toggle Markdown Editing")?.();
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("value");

        commands.get("Toggle Markdown Editing")?.();
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(value)");
    });

    test("keeps the runtime active without registering menus in child frames", () => {
        const registerCommand = vi.fn();
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => createDefaultSettings()),
            writeValue: vi.fn(),
            registerCommand,
            requestInput: vi.fn(() => null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/embedded-editor"),
            isTopFrame: false
        };
        disposeUserscript = initializeUserscript(environment);
        const textArea = document.createElement("textarea");
        document.body.append(textArea);
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);

        expect(registerCommand).not.toHaveBeenCalled();
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(value)");
    });
});
