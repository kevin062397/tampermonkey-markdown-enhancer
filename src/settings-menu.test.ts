import { beforeEach, describe, expect, test, vi } from "vitest";
import { createDefaultSettings, createSettingsStore, MAX_EDITOR_SELECTOR_COUNT } from "./settings";
import { registerSettingsMenu, type SettingsMenuEnvironment } from "./settings-menu";

const createFixture = (pageUrl = "https://BÜCHER.Example./editor") => {
    const commands = new Map<string, () => void>();
    const inputs: Array<string | null> = [];
    const environment: SettingsMenuEnvironment = {
        registerCommand: vi.fn((label, callback) => commands.set(label, callback)),
        requestInput: vi.fn(() => inputs.shift() ?? null),
        getPrimaryModifierLabel: () => "Command",
        getPageUrl: () => new URL(pageUrl)
    };
    let storedSettings = createDefaultSettings();
    const store = createSettingsStore({
        readValue: () => storedSettings,
        writeValue: (_key, settings) => {
            storedSettings = settings;
        }
    });
    registerSettingsMenu(environment, store);
    const executeCommand = (label: string): void => {
        const command = commands.get(label);
        if (!command) {
            throw new Error(`Missing menu command: ${label}`);
        }
        command();
    };
    return { commands, environment, executeCommand, inputs, store };
};

let fixture: ReturnType<typeof createFixture>;

beforeEach(() => {
    fixture = createFixture();
});

describe("Settings menu", () => {
    test("registers exactly eight working menu actions", () => {
        expect([...fixture.commands.keys()]).toEqual([
            "Toggle Markdown Editing",
            "Toggle Formatting Toolbar",
            "Set Tab Width",
            "Set Bold Shortcut",
            "Set Italic Shortcut",
            "Set Link Shortcut",
            "Toggle Current Hostname Exclusion",
            "Toggle Editor Exclusion Selector"
        ]);
    });

    test("applies the editing toggle live", () => {
        fixture.executeCommand("Toggle Markdown Editing");
        expect(fixture.store.getSettings().isEnabled).toBe(false);
        fixture.executeCommand("Toggle Markdown Editing");
        expect(fixture.store.getSettings().isEnabled).toBe(true);
    });

    test("applies the formatting toolbar toggle live", () => {
        fixture.executeCommand("Toggle Formatting Toolbar");
        expect(fixture.store.getSettings().isToolbarEnabled).toBe(false);
        fixture.executeCommand("Toggle Formatting Toolbar");
        expect(fixture.store.getSettings().isToolbarEnabled).toBe(true);
    });

    test("sets valid tab widths and leaves canceled or invalid values unchanged", () => {
        fixture.inputs.push("8", "0", null);
        fixture.executeCommand("Set Tab Width");
        expect(fixture.store.getSettings().tabWidth).toBe(8);

        fixture.executeCommand("Set Tab Width");
        fixture.executeCommand("Set Tab Width");
        expect(fixture.store.getSettings().tabWidth).toBe(8);
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
                registerCommand: (label, callback) => commands.set(label, callback),
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
