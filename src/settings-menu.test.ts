import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    createDefaultSettings,
    createSettingsStore,
    MAX_EDITOR_SELECTOR_COUNT,
    MAX_EDITOR_SELECTOR_LENGTH,
    type SettingsStore
} from "./settings";
import { registerSettingsMenu, type SettingsMenuEnvironment } from "./settings-menu";

const createFixture = (pageUrl = "https://BÜCHER.Example./editor", initialSettings = createDefaultSettings()) => {
    const commands = new Map<number, { readonly label: string; readonly callback: () => void }>();
    const registrations: Array<{ readonly id: number; readonly label: string; readonly existingCommandId?: number }> =
        [];
    const inputs: Array<string | null> = [];
    let nextCommandId = 1;
    const environment: SettingsMenuEnvironment = {
        registerCommand: vi.fn((label, callback, existingCommandId) => {
            const commandId = existingCommandId ?? nextCommandId++;
            commands.set(commandId, { label, callback });
            registrations.push({ id: commandId, label, existingCommandId });
            return commandId;
        }),
        requestInput: vi.fn(() => inputs.shift() ?? null),
        reportStatus: vi.fn(),
        getPrimaryModifierLabel: () => "Command",
        getPageUrl: () => new URL(pageUrl)
    };
    let storedSettings = initialSettings;
    const readValue = vi.fn(() => storedSettings);
    const store = createSettingsStore({
        readValue,
        writeValue: (_key, settings) => {
            storedSettings = settings;
        }
    });
    const controller = registerSettingsMenu(environment, store);
    const executeCommand = (label: string): void => {
        const command = [...commands.values()].find((candidate) => candidate.label === label);
        if (!command) {
            throw new Error(`Missing menu command: ${label}`);
        }
        command.callback();
    };
    const getCommandLabels = (): string[] => [...commands.values()].map(({ label }) => label);
    const setStoredSettings = (settings: typeof storedSettings): void => {
        storedSettings = settings;
    };
    return {
        commands,
        controller,
        environment,
        executeCommand,
        getCommandLabels,
        inputs,
        readValue,
        registrations,
        setStoredSettings,
        store
    };
};

let fixture: ReturnType<typeof createFixture>;

beforeEach(() => {
    fixture = createFixture();
});

describe("Settings menu", () => {
    test("registers exactly nine uniquely identified working menu actions in order", () => {
        expect(fixture.getCommandLabels()).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(new Set(fixture.commands.keys())).toHaveLength(9);
        expect(fixture.registrations.map(({ existingCommandId }) => existingCommandId)).toEqual([
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        ]);
    });

    test("uses enable action labels when both features start disabled", () => {
        fixture = createFixture("https://example.test/editor", {
            ...createDefaultSettings(),
            isEnabled: false,
            isToolbarEnabled: false
        });

        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Enable Markdown Editing",
            "Enable Formatting Toolbar"
        ]);
    });

    test("applies repeated editing toggles and refreshes both state actions in place", () => {
        fixture.executeCommand("Disable Markdown Editing");
        expect(fixture.store.getSettings().isEnabled).toBe(false);
        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Enable Markdown Editing",
            "Disable Formatting Toolbar"
        ]);

        fixture.executeCommand("Enable Markdown Editing");
        expect(fixture.store.getSettings().isEnabled).toBe(true);
        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar"
        ]);
        expect(fixture.registrations.slice(9).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2],
            [8, 8],
            [1, 1],
            [2, 2],
            [8, 8]
        ]);
    });

    test("applies repeated formatting toolbar toggles and refreshes both state actions in place", () => {
        fixture.executeCommand("Disable Formatting Toolbar");
        expect(fixture.store.getSettings().isToolbarEnabled).toBe(false);
        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Disable Markdown Editing",
            "Enable Formatting Toolbar"
        ]);

        fixture.executeCommand("Enable Formatting Toolbar");
        expect(fixture.store.getSettings().isToolbarEnabled).toBe(true);
        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar"
        ]);
    });

    test("sets valid tab widths and leaves canceled or invalid values unchanged", () => {
        fixture.inputs.push("8", "0", null);
        fixture.executeCommand("Set Tab Width");
        expect(fixture.store.getSettings().tabWidth).toBe(8);

        fixture.executeCommand("Set Tab Width");
        fixture.executeCommand("Set Tab Width");
        expect(fixture.store.getSettings().tabWidth).toBe(8);
    });

    test("isolates initial action registration failures and continues in order", () => {
        const attemptedLabels: string[] = [];
        const registeredLabels: string[] = [];
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        let nextCommandId = 1;
        const store = createSettingsStore({
            readValue: () => createDefaultSettings(),
            writeValue: vi.fn()
        });

        expect(() =>
            registerSettingsMenu(
                {
                    registerCommand: (label) => {
                        attemptedLabels.push(label);
                        if (label === "Disable Markdown Editing" || label === "Set Bold Shortcut") {
                            throw new Error("registration unavailable");
                        }
                        registeredLabels.push(label);
                        return nextCommandId++;
                    },
                    requestInput: () => null,
                    reportStatus: () => undefined,
                    getPrimaryModifierLabel: () => "Command",
                    getPageUrl: () => new URL("https://example.test/editor")
                },
                store
            )
        ).not.toThrow();
        expect(attemptedLabels).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(registeredLabels).toEqual([
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    test("keeps all actions in canonical order when the initial state read fails", () => {
        const registeredLabels: string[] = [];
        const store: SettingsStore = {
            canUpdateSettings: () => {
                throw new Error("settings unavailable");
            },
            getSettings: () => {
                throw new Error("settings unavailable");
            },
            subscribeSettings: () => () => undefined,
            updateSettings: () => {
                throw new Error("settings unavailable");
            }
        };

        expect(() =>
            registerSettingsMenu(
                {
                    registerCommand: (label) => {
                        registeredLabels.push(label);
                        return registeredLabels.length;
                    },
                    requestInput: () => null,
                    reportStatus: () => undefined,
                    getPrimaryModifierLabel: () => "Command",
                    getPageUrl: () => new URL("https://example.test/editor")
                },
                store
            )
        ).not.toThrow();
        expect(registeredLabels).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);
    });

    test("does not retry state actions whose initial registrations return invalid IDs", () => {
        const attemptedLabels: string[] = [];
        const returnedIds: unknown[] = [Number.NaN, "2", 3, 4, 5, 6, 7, 8];
        const store = createSettingsStore({
            readValue: () => createDefaultSettings(),
            writeValue: vi.fn()
        });
        const controller = registerSettingsMenu(
            {
                registerCommand: (label) => {
                    attemptedLabels.push(label);
                    return returnedIds.shift();
                },
                requestInput: () => null,
                reportStatus: () => undefined,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        controller.refresh();
        controller.refresh();

        expect(attemptedLabels).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector",
            "Exclude This Hostname",
            "Exclude This Hostname"
        ]);
    });

    test("preserves all prior dynamic action IDs after invalid or failed refreshes", () => {
        const registerCommand = vi.mocked(fixture.environment.registerCommand);
        registerCommand.mockClear();
        registerCommand
            .mockImplementationOnce(() => Number.POSITIVE_INFINITY)
            .mockImplementationOnce(() => {
                throw new Error("toolbar refresh unavailable");
            });

        fixture.controller.refresh();

        expect(registerCommand.mock.calls.map(([, , existingCommandId]) => existingCommandId)).toEqual([1, 2, 8]);

        registerCommand.mockImplementation((_label, _callback, existingCommandId) => existingCommandId);
        fixture.controller.refresh();

        expect(registerCommand.mock.calls.slice(3).map(([, , existingCommandId]) => existingCommandId)).toEqual([
            1, 2, 8
        ]);
    });

    test("contains every registered callback independently", () => {
        const callbacks = [...fixture.commands.values()].map(({ callback }) => callback);
        vi.spyOn(fixture.store, "getSettings").mockImplementation(() => {
            throw new Error("settings read unavailable");
        });
        vi.spyOn(fixture.store, "updateSettings").mockImplementation(() => {
            throw new Error("settings update unavailable");
        });
        vi.mocked(fixture.environment.requestInput).mockImplementation(() => {
            throw new Error("input unavailable");
        });
        vi.spyOn(fixture.environment, "getPrimaryModifierLabel").mockImplementation(() => {
            throw new Error("platform unavailable");
        });
        vi.spyOn(fixture.environment, "getPageUrl").mockImplementation(() => {
            throw new Error("page URL unavailable");
        });

        expect(callbacks).toHaveLength(9);
        for (const callback of callbacks) {
            expect(callback).not.toThrow();
        }
    });

    test("rereads cross-tab settings once and refreshes all three dynamic action IDs", () => {
        const staticCommands = [...fixture.commands.entries()].filter(([id]) => id !== 1 && id !== 2 && id !== 8);
        fixture.setStoredSettings({
            ...createDefaultSettings(),
            isEnabled: false,
            isToolbarEnabled: false,
            tabWidth: 8
        });
        fixture.readValue.mockClear();

        fixture.controller.refresh();

        expect(fixture.readValue).toHaveBeenCalledOnce();
        expect(fixture.getCommandLabels()).toEqual([
            "Enable Markdown Editing",
            "Enable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(fixture.registrations.slice(9).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2],
            [8, 8]
        ]);
        expect([...fixture.commands.entries()].filter(([id]) => id !== 1 && id !== 2 && id !== 8)).toEqual(
            staticCommands
        );
    });

    test("isolates one state action refresh failure and preserves its prior ID", () => {
        vi.mocked(fixture.environment.registerCommand).mockImplementationOnce(() => {
            throw new Error("editing refresh unavailable");
        });

        expect(() => fixture.controller.refresh()).not.toThrow();
        expect(fixture.registrations.slice(9).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [2, 2],
            [8, 8]
        ]);

        fixture.controller.refresh();
        expect(fixture.registrations.slice(11).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2],
            [8, 8]
        ]);
    });

    test("isolates a settings update failure and continues refreshing both action labels", () => {
        vi.spyOn(fixture.store, "updateSettingsWithOutcome").mockImplementationOnce(() => {
            throw new Error("storage update unavailable");
        });

        expect(() => fixture.executeCommand("Disable Markdown Editing")).not.toThrow();
        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar"
        ]);
        expect(fixture.registrations.slice(9).map(({ existingCommandId }) => existingCommandId)).toEqual([1, 2, 8]);

        fixture.executeCommand("Disable Markdown Editing");
        expect(fixture.store.getSettings().isEnabled).toBe(false);
    });

    test("sets and resets letter and digit shortcut overrides", () => {
        fixture.inputs.push("Cmd+X", "Cmd+7", " ");
        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Set Italic Shortcut");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            1,
            "Bold Shortcut (Use Command+B; Default: Command+B; Leave Blank to Restore Default When Available)",
            "Command+B"
        );
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            bold: { key: "x", isPrimaryModifierRequired: true },
            italic: { key: "7", isPrimaryModifierRequired: true }
        });

        fixture.executeCommand("Set Bold Shortcut");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            italic: { key: "7", isPrimaryModifierRequired: true }
        });
    });

    test("accepts familiar platform modifier names", () => {
        fixture.inputs.push("Command+X", "mod+Y");
        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Set Italic Shortcut");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            bold: { key: "x", isPrimaryModifierRequired: true },
            italic: { key: "y", isPrimaryModifierRequired: true }
        });

        fixture = createFixture();
        Object.defineProperty(fixture.environment, "getPrimaryModifierLabel", {
            configurable: true,
            value: () => "Control"
        });
        fixture.inputs.push("Ctrl+7", "Control+K", "mod+Y");
        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Set Link Shortcut");
        fixture.executeCommand("Set Italic Shortcut");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            1,
            "Bold Shortcut (Use Control+B; Default: Control+B; Leave Blank to Restore Default When Available)",
            "Control+B"
        );
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            bold: { key: "7", isPrimaryModifierRequired: true },
            italic: { key: "y", isPrimaryModifierRequired: true },
            link: { key: "k", isPrimaryModifierRequired: true }
        });

        fixture.inputs.push("Cmd+X", "Command+X");
        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Set Italic Shortcut");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            bold: { key: "7", isPrimaryModifierRequired: true },
            italic: { key: "y", isPrimaryModifierRequired: true },
            link: { key: "k", isPrimaryModifierRequired: true }
        });
    });

    test.each(["mod+x+y", "mod+shift", "mod+?", "shift+z", "Ctrl+x", "Control+x", "b", "ab", "⇧", null])(
        "leaves shortcut overrides unchanged for input %j",
        (input) => {
            fixture.inputs.push(input);
            fixture.executeCommand("Set Link Shortcut");
            expect(fixture.store.getSettings().shortcutOverrides).toEqual({});
        }
    );

    test("rejects default and existing shortcut collisions without changing prior overrides", () => {
        fixture.inputs.push("mod+i", "Cmd+J", "Cmd+J", "mod+x", "mod+x");
        fixture.executeCommand("Set Bold Shortcut");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({});

        fixture.executeCommand("Set Italic Shortcut");
        fixture.executeCommand("Set Bold Shortcut");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            italic: { key: "j", isPrimaryModifierRequired: true }
        });

        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Set Link Shortcut");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            bold: { key: "x", isPrimaryModifierRequired: true },
            italic: { key: "j", isPrimaryModifierRequired: true }
        });
    });

    test("toggles the canonical current hostname exclusion", () => {
        fixture.executeCommand("Exclude This Hostname");
        expect(fixture.store.getSettings().excludedHostnames).toEqual(["xn--bcher-kva.example"]);
        fixture.executeCommand("Include This Hostname");
        expect(fixture.store.getSettings().excludedHostnames).toEqual([]);
    });

    test("toggles one validated selector while retaining CSS selector-list commas", () => {
        fixture.inputs.push(" textarea.private, #editor ", "textarea[data-label='a,b']", "textarea.private, #editor");
        fixture.executeCommand("Toggle Editor Exclusion Selector");
        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual([
            "textarea.private, #editor",
            "textarea[data-label='a,b']"
        ]);

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual(["textarea[data-label='a,b']"]);
    });

    test.each([null, "", "   ", "[", ".first\n.second", "x".repeat(257)])(
        "leaves selectors unchanged for input %j",
        (input) => {
            fixture.inputs.push(input);
            fixture.executeCommand("Toggle Editor Exclusion Selector");
            expect(fixture.store.getSettings().excludedEditorSelectors).toEqual([]);
        }
    );

    test("leaves a full selector list unchanged when adding and still permits removal", () => {
        const selectors = Array.from({ length: MAX_EDITOR_SELECTOR_COUNT }, (_, index) => `.selector-${index}`);
        fixture.store.updateSettings({ excludedEditorSelectors: selectors });
        fixture.inputs.push(".selector-extra", ".selector-0");

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual(selectors);

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual(selectors.slice(1));
    });

    test("rejects a reset when the restored default is already assigned", () => {
        fixture.store.updateSettings({
            shortcutOverrides: {
                bold: { key: "x", isPrimaryModifierRequired: true },
                italic: { key: "b", isPrimaryModifierRequired: true }
            }
        });
        const settingsBeforeReset = fixture.store.getSettings();
        fixture.inputs.push("");

        fixture.executeCommand("Set Bold Shortcut");

        expect(fixture.store.getSettings()).toBe(settingsBeforeReset);
    });

    test("merges menu changes with concurrent stored settings", () => {
        let storedSettings = createDefaultSettings();
        const commands = new Map<string, () => void>();
        const inputs = ["Cmd+7", ".new-selector"];
        const store = createSettingsStore({
            readValue: () => storedSettings,
            writeValue: (_key, settings) => {
                storedSettings = settings;
            }
        });
        registerSettingsMenu(
            {
                registerCommand: (label, callback) => {
                    commands.set(label, callback);
                    return commands.size;
                },
                requestInput: () => inputs.shift() ?? null,
                reportStatus: () => undefined,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://current.example/editor")
            },
            store
        );
        storedSettings = {
            ...storedSettings,
            tabWidth: 8,
            shortcutOverrides: { italic: { key: "x", isPrimaryModifierRequired: true } },
            excludedHostnames: ["existing.example"],
            excludedEditorSelectors: [".existing-selector"]
        };

        commands.get("Set Bold Shortcut")?.();
        commands.get("Exclude This Hostname")?.();
        commands.get("Toggle Editor Exclusion Selector")?.();

        expect(storedSettings).toMatchObject({
            tabWidth: 8,
            shortcutOverrides: {
                bold: { key: "7", isPrimaryModifierRequired: true },
                italic: { key: "x", isPrimaryModifierRequired: true }
            },
            excludedHostnames: ["existing.example", "current.example"],
            excludedEditorSelectors: [".existing-selector", ".new-selector"]
        });
    });

    test("reports tab-width outcomes and keeps canceled prompts silent", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push("8", "0", null);

        fixture.executeCommand("Set Tab Width");
        expect(reportStatus).toHaveBeenLastCalledWith("Tab width set to 8.");

        fixture.executeCommand("Set Tab Width");
        expect(reportStatus).toHaveBeenLastCalledWith("Enter a whole-number tab width from 1 through 16.");
        reportStatus.mockClear();

        fixture.executeCommand("Set Tab Width");
        expect(reportStatus).not.toHaveBeenCalled();
        expect(fixture.store.getSettings().tabWidth).toBe(8);
    });

    test("sets and restores the bullet style with current and default values in the prompt", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push("+", "");

        fixture.executeCommand("Set Bullet Style");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            1,
            "Bullet Style (-, *, or +; Default: -; Leave Blank to Restore Default)",
            "-"
        );
        expect(fixture.store.getSettings().bulletStyle).toBe("+");
        expect(reportStatus).toHaveBeenLastCalledWith("Bullet style set to +.");

        fixture.executeCommand("Set Bullet Style");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            2,
            "Bullet Style (-, *, or +; Default: -; Leave Blank to Restore Default)",
            "+"
        );
        expect(fixture.store.getSettings().bulletStyle).toBe("-");
        expect(reportStatus).toHaveBeenLastCalledWith("Bullet style restored to -.");
    });

    test("rejects invalid bullet styles and keeps cancellation silent", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push("x", null);

        fixture.executeCommand("Set Bullet Style");
        expect(reportStatus).toHaveBeenLastCalledWith("Enter -, *, or + for the bullet style.");
        reportStatus.mockClear();

        fixture.executeCommand("Set Bullet Style");
        expect(reportStatus).not.toHaveBeenCalled();
        expect(fixture.store.getSettings().bulletStyle).toBe("-");
    });

    test("reports shortcut updates, resets, malformed input, and collisions", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push("Cmd+X", "", "Shift+X", "Cmd+I");

        fixture.executeCommand("Set Bold Shortcut");
        expect(reportStatus).toHaveBeenLastCalledWith("Bold shortcut set to Command+X.");

        fixture.executeCommand("Set Bold Shortcut");
        expect(reportStatus).toHaveBeenLastCalledWith("Bold shortcut restored to Command+B.");

        fixture.executeCommand("Set Bold Shortcut");
        expect(reportStatus).toHaveBeenLastCalledWith(
            "Enter the Bold shortcut as Command plus one letter or digit, for example Command+B."
        );

        fixture.executeCommand("Set Bold Shortcut");
        expect(reportStatus).toHaveBeenLastCalledWith("Command+I is already assigned to Italic.");
        expect(fixture.store.getSettings().shortcutOverrides).toEqual({});
    });

    test("flips the hostname action label in place and reports exclusion outcomes", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        const initialEntry = [...fixture.commands.entries()].find(
            ([, command]) => command.label === "Exclude This Hostname"
        );
        expect(initialEntry?.[0]).toBe(8);

        fixture.executeCommand("Exclude This Hostname");
        expect(reportStatus).toHaveBeenLastCalledWith("xn--bcher-kva.example is now excluded.");
        expect(fixture.commands.get(8)?.label).toBe("Include This Hostname");

        fixture.executeCommand("Include This Hostname");
        expect(reportStatus).toHaveBeenLastCalledWith("xn--bcher-kva.example is now included.");
        expect(fixture.commands.get(8)?.label).toBe("Exclude This Hostname");
    });

    test("keeps the hostname action available when the page URL cannot be read", () => {
        fixture = createFixture("not a URL");
        const reportStatus = vi.mocked(fixture.environment.reportStatus);

        fixture.executeCommand("Exclude This Hostname");

        expect(reportStatus).toHaveBeenCalledWith("The current hostname is unavailable.");
        expect(fixture.store.getSettings().excludedHostnames).toEqual([]);
    });

    test("shows current selectors and reports whether one is added or removed", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push(".private", ".private");

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            1,
            "Editor Exclusion Selector\nEnter an existing selector to remove it, or another valid selector to add it.\nCurrent Selectors:\n(none configured)",
            ""
        );
        expect(reportStatus).toHaveBeenLastCalledWith("Editor exclusion selector added: .private");

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            2,
            "Editor Exclusion Selector\nEnter an existing selector to remove it, or another valid selector to add it.\nCurrent Selectors:\n.private",
            ""
        );
        expect(reportStatus).toHaveBeenLastCalledWith("Editor exclusion selector removed: .private");
    });

    test("explains invalid, overlong, multiline, and capacity-limited selectors", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push("[", "x".repeat(MAX_EDITOR_SELECTOR_LENGTH + 1), ".first\n.second");

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(reportStatus).toHaveBeenLastCalledWith("Enter a valid CSS selector for the editor exclusion.");

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(reportStatus).toHaveBeenLastCalledWith(
            `Enter a nonempty selector containing at most ${MAX_EDITOR_SELECTOR_LENGTH} characters.`
        );

        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(reportStatus).toHaveBeenLastCalledWith("Enter one editor exclusion selector at a time.");

        const selectors = Array.from({ length: MAX_EDITOR_SELECTOR_COUNT }, (_, index) => `.selector-${index}`);
        fixture.store.updateSettings({ excludedEditorSelectors: selectors });
        fixture.inputs.push(".extra");
        fixture.executeCommand("Toggle Editor Exclusion Selector");
        expect(reportStatus).toHaveBeenLastCalledWith(
            `Remove an existing selector before adding more than ${MAX_EDITOR_SELECTOR_COUNT}.`
        );
    });

    test("keeps future-schema settings read-only and explains the stored version", () => {
        const futureSettings = { ...createDefaultSettings(), version: 2, futureValue: "preserve" };
        const writeValue = vi.fn();
        const store = createSettingsStore({ readValue: () => futureSettings, writeValue });
        const commands = new Map<string, () => void>();
        const reportStatus = vi.fn();
        registerSettingsMenu(
            {
                registerCommand: (label, callback) => {
                    commands.set(label, callback);
                    return commands.size;
                },
                requestInput: vi.fn(() => "+"),
                reportStatus,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        commands.get("Set Bullet Style")?.();

        expect(writeValue).not.toHaveBeenCalled();
        expect(reportStatus).toHaveBeenCalledWith(
            "Settings are read-only because they were created by a newer Markdown Enhancer version."
        );
    });

    test("reports unavailable reads before prompting", () => {
        const store: SettingsStore = {
            canUpdateSettings: () => {
                throw new Error("storage read failed");
            },
            getSettings: () => createDefaultSettings(),
            subscribeSettings: () => () => undefined,
            updateSettings: () => createDefaultSettings()
        };
        const commands = new Map<string, () => void>();
        const requestInput = vi.fn(() => "8");
        const reportStatus = vi.fn();
        registerSettingsMenu(
            {
                registerCommand: (label, callback) => {
                    commands.set(label, callback);
                    return commands.size;
                },
                requestInput,
                reportStatus,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        commands.get("Set Tab Width")?.();

        expect(requestInput).not.toHaveBeenCalled();
        expect(reportStatus).toHaveBeenCalledWith("Settings are unavailable. Try again after reloading the page.");
    });

    test("reports unavailable writes without claiming success", () => {
        const store = createSettingsStore({
            readValue: () => createDefaultSettings(),
            writeValue: () => {
                throw new Error("storage write failed");
            }
        });
        const commands = new Map<string, () => void>();
        const reportStatus = vi.fn();
        registerSettingsMenu(
            {
                registerCommand: (label, callback) => {
                    commands.set(label, callback);
                    return commands.size;
                },
                requestInput: () => "8",
                reportStatus,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        commands.get("Set Tab Width")?.();

        expect(reportStatus).toHaveBeenCalledTimes(1);
        expect(reportStatus).toHaveBeenCalledWith("Settings could not be saved. Try again after reloading the page.");
        expect(store.getSettings().tabWidth).toBe(4);
    });

    test("keeps every canceled prompt silent", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        fixture.inputs.push(null, null, null, null);

        fixture.executeCommand("Set Tab Width");
        fixture.executeCommand("Set Bullet Style");
        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Toggle Editor Exclusion Selector");

        expect(reportStatus).not.toHaveBeenCalled();
    });

    test("contains unavailable status presentation", () => {
        vi.mocked(fixture.environment.reportStatus).mockImplementation(() => {
            throw new Error("dialog unavailable");
        });
        fixture.inputs.push("0");

        expect(() => fixture.executeCommand("Set Tab Width")).not.toThrow();
    });

    test("merges shortcut changes made while the prompt is open", () => {
        vi.mocked(fixture.environment.requestInput).mockImplementationOnce(() => {
            fixture.setStoredSettings({
                ...createDefaultSettings(),
                shortcutOverrides: { italic: { key: "x", isPrimaryModifierRequired: true } }
            });
            return "Cmd+7";
        });

        fixture.executeCommand("Set Bold Shortcut");

        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            bold: { key: "7", isPrimaryModifierRequired: true },
            italic: { key: "x", isPrimaryModifierRequired: true }
        });
    });

    test("reports a shortcut collision introduced while the prompt is open", () => {
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        vi.mocked(fixture.environment.requestInput).mockImplementationOnce(() => {
            fixture.setStoredSettings({
                ...createDefaultSettings(),
                shortcutOverrides: { italic: { key: "x", isPrimaryModifierRequired: true } }
            });
            return "Cmd+X";
        });

        fixture.executeCommand("Set Bold Shortcut");

        expect(fixture.store.getSettings().shortcutOverrides).toEqual({
            italic: { key: "x", isPrimaryModifierRequired: true }
        });
        expect(reportStatus).toHaveBeenCalledWith("Command+X is already assigned to Italic.");
    });

    test("merges selector changes made while the prompt is open", () => {
        vi.mocked(fixture.environment.requestInput).mockImplementationOnce(() => {
            fixture.setStoredSettings({
                ...createDefaultSettings(),
                excludedEditorSelectors: [".concurrent"]
            });
            return ".submitted";
        });

        fixture.executeCommand("Toggle Editor Exclusion Selector");

        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual([".concurrent", ".submitted"]);
        expect(fixture.environment.reportStatus).toHaveBeenCalledWith("Editor exclusion selector added: .submitted");
    });

    test("does not report success when storage becomes read-only during an update", () => {
        const defaultSettings = createDefaultSettings();
        const updateSettingsWithOutcome = vi.fn((update: Parameters<SettingsStore["updateSettings"]>[0]) => {
            if (typeof update === "function") {
                update(defaultSettings);
            }
            return { settings: defaultSettings, outcome: "read-only" as const };
        });
        const store: SettingsStore = {
            canUpdateSettings: () => true,
            getSettings: () => defaultSettings,
            subscribeSettings: () => () => undefined,
            updateSettings: () => defaultSettings,
            updateSettingsWithOutcome
        };
        const commands = new Map<string, () => void>();
        const reportStatus = vi.fn();
        registerSettingsMenu(
            {
                registerCommand: (label, callback) => {
                    commands.set(label, callback);
                    return commands.size;
                },
                requestInput: () => "8",
                reportStatus,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        commands.get("Set Tab Width")?.();

        expect(updateSettingsWithOutcome).toHaveBeenCalledOnce();
        expect(reportStatus).toHaveBeenCalledTimes(1);
        expect(reportStatus).toHaveBeenCalledWith(
            "Settings are read-only because they were created by a newer Markdown Enhancer version."
        );
    });

    test("merges hostname changes introduced during invocation", () => {
        fixture.setStoredSettings({
            ...createDefaultSettings(),
            excludedHostnames: ["existing.example"]
        });
        const canUpdateSettings = vi.spyOn(fixture.store, "canUpdateSettings");
        const checkCanUpdateSettings = canUpdateSettings.getMockImplementation();
        let availabilityCheckCount = 0;
        canUpdateSettings.mockImplementation(() => {
            availabilityCheckCount += 1;
            if (availabilityCheckCount === 2) {
                fixture.setStoredSettings({
                    ...createDefaultSettings(),
                    excludedHostnames: ["existing.example", "concurrent.example"]
                });
            }
            return checkCanUpdateSettings?.() ?? true;
        });

        fixture.executeCommand("Exclude This Hostname");

        expect(fixture.store.getSettings().excludedHostnames).toEqual([
            "existing.example",
            "concurrent.example",
            "xn--bcher-kva.example"
        ]);
    });

    test("rechecks selector capacity when the list fills while the prompt is open", () => {
        const selectors = Array.from({ length: MAX_EDITOR_SELECTOR_COUNT }, (_, index) => `.selector-${index}`);
        const reportStatus = vi.mocked(fixture.environment.reportStatus);
        vi.mocked(fixture.environment.requestInput).mockImplementationOnce(() => {
            fixture.setStoredSettings({
                ...createDefaultSettings(),
                excludedEditorSelectors: selectors
            });
            return ".submitted";
        });

        fixture.executeCommand("Toggle Editor Exclusion Selector");

        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual(selectors);
        expect(reportStatus).toHaveBeenCalledWith(
            `Remove an existing selector before adding more than ${MAX_EDITOR_SELECTOR_COUNT}.`
        );
    });

    test("applies the operation shown by stale editing, toolbar, and hostname labels", () => {
        const disableEditing = fixture.commands.get(1)?.callback;
        const disableToolbar = fixture.commands.get(2)?.callback;
        const excludeHostname = fixture.commands.get(8)?.callback;
        fixture.setStoredSettings({
            ...createDefaultSettings(),
            isEnabled: false,
            isToolbarEnabled: false,
            excludedHostnames: ["xn--bcher-kva.example"]
        });

        disableEditing?.();
        disableToolbar?.();
        excludeHostname?.();

        expect(fixture.store.getSettings()).toMatchObject({
            isEnabled: false,
            isToolbarEnabled: false,
            excludedHostnames: ["xn--bcher-kva.example"]
        });
    });

    test("preserves selector add intent when another tab adds the same selector", () => {
        vi.mocked(fixture.environment.requestInput).mockImplementationOnce(() => {
            fixture.setStoredSettings({
                ...createDefaultSettings(),
                excludedEditorSelectors: [".submitted"]
            });
            return ".submitted";
        });

        fixture.executeCommand("Toggle Editor Exclusion Selector");

        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual([".submitted"]);
        expect(fixture.environment.reportStatus).toHaveBeenCalledWith("Editor exclusion selector added: .submitted");
    });

    test("preserves selector remove intent when another tab removes the same selector", () => {
        fixture = createFixture("https://example.test/editor", {
            ...createDefaultSettings(),
            excludedEditorSelectors: [".submitted"]
        });
        vi.mocked(fixture.environment.requestInput).mockImplementationOnce(() => {
            fixture.setStoredSettings(createDefaultSettings());
            return ".submitted";
        });

        fixture.executeCommand("Toggle Editor Exclusion Selector");

        expect(fixture.store.getSettings().excludedEditorSelectors).toEqual([]);
        expect(fixture.environment.reportStatus).toHaveBeenCalledWith("Editor exclusion selector removed: .submitted");
    });

    test("refreshes fallback dynamic actions in place after storage recovers", () => {
        const recoveredSettings = {
            ...createDefaultSettings(),
            isEnabled: false,
            isToolbarEnabled: false,
            excludedHostnames: ["example.test"]
        };
        const getSettings = vi
            .fn<() => ReturnType<typeof createDefaultSettings>>()
            .mockImplementationOnce(() => {
                throw new Error("storage unavailable");
            })
            .mockImplementationOnce(() => {
                throw new Error("storage unavailable");
            })
            .mockReturnValue(recoveredSettings);
        const store: SettingsStore = {
            canUpdateSettings: () => true,
            getSettings,
            subscribeSettings: () => () => undefined,
            updateSettings: () => recoveredSettings
        };
        const commands = new Map<number, { readonly label: string; readonly callback: () => void }>();
        const registrations: Array<{ readonly id: number; readonly existingCommandId?: number }> = [];
        let nextCommandId = 1;
        const controller = registerSettingsMenu(
            {
                registerCommand: (label, callback, existingCommandId) => {
                    const id = existingCommandId ?? nextCommandId++;
                    commands.set(id, { label, callback });
                    registrations.push({ id, existingCommandId });
                    return id;
                },
                requestInput: () => null,
                reportStatus: () => undefined,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        expect([...commands.values()].map(({ label }) => label)).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Exclude This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);

        controller.refresh();

        expect([...commands.values()].map(({ label }) => label)).toEqual([
            "Enable Markdown Editing",
            "Enable Formatting Toolbar",
            "Set Tab Width",
            "Set Bullet Style",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Include This Hostname",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(registrations.slice(9).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2],
            [8, 8]
        ]);
    });

    test("reports only the terminal conflict when a retry also observes a shortcut collision", () => {
        const defaultSettings = createDefaultSettings();
        const updateSettingsWithOutcome = vi.fn((update: Parameters<SettingsStore["updateSettings"]>[0]) => {
            if (typeof update === "function") {
                update(defaultSettings);
                update({
                    ...defaultSettings,
                    shortcutOverrides: { italic: { key: "x", isPrimaryModifierRequired: true } }
                });
            }
            return { settings: defaultSettings, outcome: "conflict" as const };
        });
        const store: SettingsStore = {
            canUpdateSettings: () => true,
            getSettings: () => defaultSettings,
            subscribeSettings: () => () => undefined,
            updateSettings: () => defaultSettings,
            updateSettingsWithOutcome
        };
        const commands = new Map<string, () => void>();
        const reportStatus = vi.fn();
        registerSettingsMenu(
            {
                registerCommand: (label, callback) => {
                    commands.set(label, callback);
                    return commands.size;
                },
                requestInput: () => "Cmd+X",
                reportStatus,
                getPrimaryModifierLabel: () => "Command",
                getPageUrl: () => new URL("https://example.test/editor")
            },
            store
        );

        commands.get("Set Bold Shortcut")?.();

        expect(reportStatus).toHaveBeenCalledTimes(1);
        expect(reportStatus).toHaveBeenCalledWith("Settings changed repeatedly in another tab. Try the action again.");
    });
});
