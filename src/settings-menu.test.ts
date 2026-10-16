import { beforeEach, describe, expect, test, vi } from "vitest";
import { createDefaultSettings, createSettingsStore, MAX_EDITOR_SELECTOR_COUNT, type SettingsStore } from "./settings";
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
    test("registers exactly eight uniquely identified working menu actions in order", () => {
        expect(fixture.getCommandLabels()).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(new Set(fixture.commands.keys())).toHaveLength(8);
        expect(fixture.registrations.map(({ existingCommandId }) => existingCommandId)).toEqual([
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
        expect(fixture.registrations.slice(8).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2],
            [1, 1],
            [2, 2]
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
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(registeredLabels).toEqual([
            "Disable Formatting Toolbar",
            "Set Tab Width",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(consoleError).not.toHaveBeenCalled();
    });

    test("keeps static actions available when the initial state read fails", () => {
        const registeredLabels: string[] = [];
        const store: SettingsStore = {
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
                    getPrimaryModifierLabel: () => "Command",
                    getPageUrl: () => new URL("https://example.test/editor")
                },
                store
            )
        ).not.toThrow();
        expect(registeredLabels).toEqual([
            "Set Tab Width",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
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
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
            "Toggle Editor Exclusion Selector"
        ]);
    });

    test("preserves both prior state action IDs after invalid or failed refreshes", () => {
        const registerCommand = vi.mocked(fixture.environment.registerCommand);
        registerCommand.mockClear();
        registerCommand
            .mockImplementationOnce(() => Number.POSITIVE_INFINITY)
            .mockImplementationOnce(() => {
                throw new Error("toolbar refresh unavailable");
            });

        fixture.controller.refresh();

        expect(registerCommand.mock.calls.map(([, , existingCommandId]) => existingCommandId)).toEqual([1, 2]);

        registerCommand.mockImplementation((_label, _callback, existingCommandId) => existingCommandId);
        fixture.controller.refresh();

        expect(registerCommand.mock.calls.slice(2).map(([, , existingCommandId]) => existingCommandId)).toEqual([1, 2]);
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

        expect(callbacks).toHaveLength(8);
        for (const callback of callbacks) {
            expect(callback).not.toThrow();
        }
    });

    test("rereads cross-tab settings once and refreshes only the two state action IDs", () => {
        const staticCommands = [...fixture.commands.entries()].slice(2);
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
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
            "Toggle Editor Exclusion Selector"
        ]);
        expect(fixture.registrations.slice(8).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2]
        ]);
        expect([...fixture.commands.entries()].slice(2)).toEqual(staticCommands);
    });

    test("isolates one state action refresh failure and preserves its prior ID", () => {
        vi.mocked(fixture.environment.registerCommand).mockImplementationOnce(() => {
            throw new Error("editing refresh unavailable");
        });

        expect(() => fixture.controller.refresh()).not.toThrow();
        expect(fixture.registrations.slice(8).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [2, 2]
        ]);

        fixture.controller.refresh();
        expect(fixture.registrations.slice(9).map(({ id, existingCommandId }) => [id, existingCommandId])).toEqual([
            [1, 1],
            [2, 2]
        ]);
    });

    test("isolates a settings update failure and continues refreshing both action labels", () => {
        vi.spyOn(fixture.store, "updateSettings").mockImplementationOnce(() => {
            throw new Error("storage update unavailable");
        });

        expect(() => fixture.executeCommand("Disable Markdown Editing")).not.toThrow();
        expect(fixture.getCommandLabels().slice(0, 2)).toEqual([
            "Disable Markdown Editing",
            "Disable Formatting Toolbar"
        ]);
        expect(fixture.registrations.slice(8).map(({ existingCommandId }) => existingCommandId)).toEqual([1, 2]);

        fixture.executeCommand("Disable Markdown Editing");
        expect(fixture.store.getSettings().isEnabled).toBe(false);
    });

    test("sets and resets letter and digit shortcut overrides", () => {
        fixture.inputs.push("Cmd+X", "Cmd+7", " ");
        fixture.executeCommand("Set Bold Shortcut");
        fixture.executeCommand("Set Italic Shortcut");
        expect(fixture.environment.requestInput).toHaveBeenNthCalledWith(
            1,
            "Set Bold Shortcut (Use Command+B; Default: Command+B; Leave Blank to Restore Default When Available)",
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
            "Set Bold Shortcut (Use Control+B; Default: Control+B; Leave Blank to Restore Default When Available)",
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
        fixture.executeCommand("Toggle Current Hostname Exclusion");
        expect(fixture.store.getSettings().excludedHostnames).toEqual(["xn--bcher-kva.example"]);
        fixture.executeCommand("Toggle Current Hostname Exclusion");
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
        commands.get("Toggle Current Hostname Exclusion")?.();
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
});
