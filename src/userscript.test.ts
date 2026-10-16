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
    vi.unstubAllGlobals();
});

describe("Userscript", () => {
    test.each([
        ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Command"],
        ["Mozilla/5.0 (X11; Linux x86_64)", "Control"]
    ] as const)("uses the platform modifier label for %s", (userAgent, expectedLabel) => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

        expect(createDefaultUserscriptEnvironment().getPrimaryModifierLabel()).toBe(expectedLabel);
    });

    test("reuses numeric Tampermonkey menu command IDs", () => {
        const registerMenuCommand = vi.fn(() => 41);
        vi.stubGlobal("GM_registerMenuCommand", registerMenuCommand);
        const environment = createDefaultUserscriptEnvironment();
        const callback = vi.fn();

        expect(environment.registerCommand("Initial", callback)).toBe(41);
        expect(environment.registerCommand("Refreshed", callback, 41)).toBe(41);
        expect(registerMenuCommand).toHaveBeenNthCalledWith(1, "Initial", callback);
        expect(registerMenuCommand).toHaveBeenNthCalledWith(2, "Refreshed", callback, { id: 41 });
    });

    test("composes storage, static menus, live targeting, and runtime", () => {
        let storedValue: unknown;
        const commands = new Map<number, { readonly label: string; readonly callback: () => void }>();
        const inputs = ["2"];
        let nextCommandId = 1;
        const executeCommand = (label: string): void => {
            const command = [...commands.values()].find((candidate) => candidate.label === label);
            if (!command) {
                throw new Error(`Missing menu command: ${label}`);
            }
            command.callback();
        };
        const writeValue = vi.fn((key: string, value: MarkdownEnhancerSettings) => {
            expect(key).toBe(SETTINGS_STORAGE_KEY);
            storedValue = value;
        });
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => storedValue),
            writeValue,
            registerCommand: vi.fn((label, callback, existingCommandId) => {
                const commandId = existingCommandId ?? nextCommandId++;
                commands.set(commandId, { label, callback });
                return commandId;
            }),
            requestInput: vi.fn(() => inputs.shift() ?? null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };
        disposeUserscript = initializeUserscript(environment);
        const textArea = document.createElement("textarea");
        document.body.append(textArea);

        expect(commands).toHaveLength(8);
        expect(writeValue).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, createDefaultSettings());

        textArea.value = "a";
        textArea.setSelectionRange(1, 1);
        executeCommand("Set Tab Width");
        expect(dispatchKey(textArea, "Tab").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("a ");

        executeCommand("Disable Markdown Editing");
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("value");

        executeCommand("Enable Markdown Editing");
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(value)");
        expect(document.querySelector("[data-tampermonkey-markdown-enhancer-formatting-toolbar]")).not.toBeNull();

        executeCommand("Disable Formatting Toolbar");
        expect(document.querySelector("[data-tampermonkey-markdown-enhancer-formatting-toolbar]")).toBeNull();
        executeCommand("Enable Formatting Toolbar");
        textArea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(document.querySelector("[data-tampermonkey-markdown-enhancer-formatting-toolbar]")).not.toBeNull();
    });

    test("contains menu callback failures without breaking the runtime", () => {
        let isFailureEnabled = false;
        let nextCommandId = 1;
        const commands = new Map<number, () => void>();
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => {
                if (isFailureEnabled) {
                    throw new Error("settings unavailable");
                }
                return createDefaultSettings();
            }),
            writeValue: vi.fn(),
            registerCommand: vi.fn((_label, callback, existingCommandId) => {
                const commandId = existingCommandId ?? nextCommandId++;
                commands.set(commandId, callback);
                return commandId;
            }),
            requestInput: vi.fn(() => {
                throw new Error("input unavailable");
            }),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => {
                if (isFailureEnabled) {
                    throw new Error("page URL unavailable");
                }
                return new URL("https://example.test/editor");
            },
            isTopFrame: true
        };
        disposeUserscript = initializeUserscript(environment);
        const callbacks = [...commands.values()];
        isFailureEnabled = true;

        expect(callbacks).toHaveLength(8);
        for (const callback of callbacks) {
            expect(callback).not.toThrow();
        }

        isFailureEnabled = false;
        const textArea = document.createElement("textarea");
        document.body.append(textArea);
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(value)");
    });

    test("refreshes top-frame state labels from storage on focus and removes the listener on disposal", () => {
        let storedSettings = createDefaultSettings();
        let nextCommandId = 1;
        const commands = new Map<number, { readonly label: string; readonly callback: () => void }>();
        const registrations: Array<{ readonly id: number; readonly existingCommandId?: number }> = [];
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => storedSettings),
            writeValue: vi.fn((_key, settings) => {
                storedSettings = settings;
            }),
            registerCommand: vi.fn((label, callback, existingCommandId) => {
                const commandId = existingCommandId ?? nextCommandId++;
                commands.set(commandId, { label, callback });
                registrations.push({ id: commandId, existingCommandId });
                return commandId;
            }),
            requestInput: vi.fn(() => null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };
        disposeUserscript = initializeUserscript(environment);
        const focusListener = addEventListener.mock.calls.find(([eventType]) => String(eventType) === "focus")?.[1];
        storedSettings = {
            ...createDefaultSettings(),
            isEnabled: false,
            isToolbarEnabled: false
        };

        window.dispatchEvent(new Event("focus"));

        expect([...commands.values()].map(({ label }) => label).slice(0, 2)).toEqual([
            "Enable Markdown Editing",
            "Enable Formatting Toolbar"
        ]);
        expect(registrations.slice(8)).toEqual([
            { id: 1, existingCommandId: 1 },
            { id: 2, existingCommandId: 2 }
        ]);
        expect(focusListener).toBeTypeOf("function");

        disposeUserscript();
        disposeUserscript = undefined;
        expect(removeEventListener).toHaveBeenCalledWith("focus", focusListener);
    });

    test("removes the focus listener when runtime initialization fails", () => {
        let readCount = 0;
        let nextCommandId = 1;
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => {
                readCount += 1;
                if (readCount === 3) {
                    throw new Error("runtime initialization unavailable");
                }
                return createDefaultSettings();
            }),
            writeValue: vi.fn(),
            registerCommand: vi.fn((_label, _callback, existingCommandId) => existingCommandId ?? nextCommandId++),
            requestInput: vi.fn(() => null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };

        expect(() => initializeUserscript(environment)).toThrow("runtime initialization unavailable");

        const focusListener = addEventListener.mock.calls.find(([eventType]) => String(eventType) === "focus")?.[1];
        expect(focusListener).toBeTypeOf("function");
        expect(removeEventListener).toHaveBeenCalledWith("focus", focusListener);
    });

    test("keeps the runtime active and cleans up when top-frame menu listener setup fails", () => {
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const addEventListener = vi.spyOn(window, "addEventListener").mockImplementation(() => {
            throw new Error("focus listener unavailable");
        });
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => createDefaultSettings()),
            writeValue: vi.fn(),
            registerCommand: vi.fn(() => {
                throw new Error("menu registration unavailable");
            }),
            requestInput: vi.fn(() => null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };

        disposeUserscript = initializeUserscript(environment);
        const focusListener = addEventListener.mock.calls.find(([eventType]) => String(eventType) === "focus")?.[1];
        const textArea = document.createElement("textarea");
        document.body.append(textArea);
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);

        expect(removeEventListener).toHaveBeenCalledWith("focus", focusListener);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(value)");
    });

    test("removes the focus listener when runtime disposal fails", () => {
        let nextCommandId = 1;
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => createDefaultSettings()),
            writeValue: vi.fn(),
            registerCommand: vi.fn((_label, _callback, existingCommandId) => existingCommandId ?? nextCommandId++),
            requestInput: vi.fn(() => null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };
        disposeUserscript = initializeUserscript(environment);
        const focusListener = addEventListener.mock.calls.find(([eventType]) => String(eventType) === "focus")?.[1];
        const removeDocumentEventListener = vi.spyOn(document, "removeEventListener").mockImplementation(() => {
            throw new Error("runtime disposal unavailable");
        });

        expect(() => disposeUserscript?.()).not.toThrow();
        expect(removeEventListener).toHaveBeenCalledWith("focus", focusListener);

        removeDocumentEventListener.mockRestore();
        disposeUserscript();
        disposeUserscript = undefined;
    });

    test("disposes the runtime when focus listener removal fails", () => {
        const removeWindowEventListener = window.removeEventListener.bind(window);
        const addEventListener = vi.spyOn(window, "addEventListener");
        const environment: UserscriptEnvironment = {
            readValue: vi.fn(() => createDefaultSettings()),
            writeValue: vi.fn(),
            registerCommand: vi.fn((_label, _callback, existingCommandId) => existingCommandId ?? 1),
            requestInput: vi.fn(() => null),
            getPrimaryModifierLabel: () => "Command",
            getPageUrl: () => new URL("https://example.test/editor"),
            isTopFrame: true
        };
        disposeUserscript = initializeUserscript(environment);
        const focusListener = addEventListener.mock.calls.find(([eventType]) => String(eventType) === "focus")?.[1];
        vi.spyOn(window, "removeEventListener").mockImplementation(() => {
            throw new Error("focus listener removal unavailable");
        });
        const textArea = document.createElement("textarea");
        document.body.append(textArea);
        textArea.value = "value";
        textArea.setSelectionRange(0, 5);

        disposeUserscript();
        disposeUserscript = undefined;

        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(false);
        expect(textArea.value).toBe("value");
        removeWindowEventListener("focus", focusListener as unknown as EventListener);
    });

    test("keeps the runtime active without registering menus in child frames", () => {
        const addEventListener = vi.spyOn(window, "addEventListener");
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
        expect(addEventListener.mock.calls.filter(([eventType]) => String(eventType) === "focus")).toHaveLength(0);
        expect(dispatchKey(textArea, "(").defaultPrevented).toBe(true);
        expect(textArea.value).toBe("(value)");
    });
});
