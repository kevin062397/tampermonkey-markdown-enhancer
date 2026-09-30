import { describe, expect, test, vi } from "vitest";
import {
    canonicalizeHostname,
    createDefaultSettings,
    createSettingsStore,
    DEFAULT_SHORTCUTS,
    doesShortcutOverrideCollide,
    MAX_EDITOR_SELECTOR_COUNT,
    MAX_EDITOR_SELECTOR_LENGTH,
    normalizeCommandShortcut,
    normalizeEditorSelectors,
    normalizeSettings,
    SETTINGS_STORAGE_KEY,
    type MarkdownEnhancerSettings
} from "./settings";

const createStorage = (value: unknown) => {
    let storedValue = value;
    const readValue = vi.fn(() => storedValue);
    const writeValue = vi.fn((_key: string, settings: MarkdownEnhancerSettings) => {
        storedValue = settings;
    });
    return {
        readValue,
        writeValue,
        getStoredValue: () => storedValue,
        setStoredValue: (nextValue: unknown) => {
            storedValue = nextValue;
        }
    };
};

describe("Settings", () => {
    test("uses versioned defaults and canonical shortcuts for missing settings", () => {
        expect(normalizeSettings(undefined)).toEqual(createDefaultSettings());
        expect(DEFAULT_SHORTCUTS).toEqual({
            bold: { key: "b", isPrimaryModifierRequired: true },
            italic: { key: "i", isPrimaryModifierRequired: true },
            link: { key: "k", isPrimaryModifierRequired: true }
        });
    });

    test("normalizes malformed current settings", () => {
        const settings = normalizeSettings({
            version: 1,
            isEnabled: false,
            isToolbarEnabled: "yes",
            isCommandPaletteEnabled: true,
            isPreviewEnabled: null,
            tabWidth: 17,
            bulletStyle: "•",
            shortcutOverrides: {
                bold: { key: " B ", isPrimaryModifierRequired: true },
                italic: { key: "bad key", isPrimaryModifierRequired: true },
                link: { key: "l", isPrimaryModifierRequired: "yes" },
                unknown: { key: "x", isPrimaryModifierRequired: true }
            },
            excludedHostnames: [" Example.COM. ", "example.com", "", 3],
            excludedEditorSelectors: [" textarea.special ", "textarea.special", "[", 3]
        });

        expect(settings).toEqual({
            ...createDefaultSettings(),
            isEnabled: false,
            shortcutOverrides: { bold: { key: "b", isPrimaryModifierRequired: true } },
            excludedHostnames: ["example.com"],
            excludedEditorSelectors: ["textarea.special"]
        });
    });

    test.each([
        [
            { key: "a", isPrimaryModifierRequired: true },
            { key: "a", isPrimaryModifierRequired: true }
        ],
        [
            { key: " Z ", isPrimaryModifierRequired: true },
            { key: "z", isPrimaryModifierRequired: true }
        ],
        [
            { key: "9", isPrimaryModifierRequired: true },
            { key: "9", isPrimaryModifierRequired: true }
        ]
    ])("accepts a primary-modified ASCII letter or digit shortcut key %#", (value, expected) => {
        expect(normalizeCommandShortcut(value)).toEqual(expected);
    });

    test("repairs an unmodified stored shortcut override", () => {
        expect(normalizeCommandShortcut({ key: "b", isPrimaryModifierRequired: false })).toBeUndefined();
    });

    test.each(["Shift", "Control", "Alt", "Meta", "mod", "ab", "é", "?", "+", "⇧", "shift+z", " "])(
        "rejects unsupported shortcut key %j",
        (key) => {
            expect(normalizeCommandShortcut({ key, isPrimaryModifierRequired: true })).toBeUndefined();
        }
    );

    test("preserves valid simultaneous shortcut moves and repairs duplicate effective groups deterministically", () => {
        const movedShortcuts = {
            bold: { key: "i", isPrimaryModifierRequired: true },
            italic: { key: "b", isPrimaryModifierRequired: true }
        };
        expect(
            normalizeSettings({
                ...createDefaultSettings(),
                shortcutOverrides: movedShortcuts
            }).shortcutOverrides
        ).toEqual(movedShortcuts);
        expect(
            normalizeSettings({
                ...createDefaultSettings(),
                shortcutOverrides: {
                    italic: movedShortcuts.italic,
                    bold: movedShortcuts.bold
                }
            }).shortcutOverrides
        ).toEqual(movedShortcuts);

        const duplicateShortcuts = {
            bold: { key: "x", isPrimaryModifierRequired: true },
            italic: { key: "x", isPrimaryModifierRequired: true },
            link: { key: "i", isPrimaryModifierRequired: true }
        };
        expect(
            normalizeSettings({
                ...createDefaultSettings(),
                shortcutOverrides: duplicateShortcuts
            }).shortcutOverrides
        ).toEqual({ bold: { key: "x", isPrimaryModifierRequired: true } });
        expect(
            normalizeSettings({
                ...createDefaultSettings(),
                shortcutOverrides: {
                    link: duplicateShortcuts.link,
                    italic: duplicateShortcuts.italic,
                    bold: duplicateShortcuts.bold
                }
            }).shortcutOverrides
        ).toEqual({ bold: { key: "x", isPrimaryModifierRequired: true } });
    });

    test("detects proposed collisions against complete effective shortcuts", () => {
        const existingOverrides = {
            bold: { key: "x", isPrimaryModifierRequired: true },
            italic: { key: "j", isPrimaryModifierRequired: true }
        } as const;

        expect(
            doesShortcutOverrideCollide(existingOverrides, "link", {
                key: "x",
                isPrimaryModifierRequired: true
            })
        ).toBe(true);
        expect(
            doesShortcutOverrideCollide({ bold: { key: "x", isPrimaryModifierRequired: true } }, "bold", {
                key: "i",
                isPrimaryModifierRequired: true
            })
        ).toBe(true);
        expect(
            doesShortcutOverrideCollide(existingOverrides, "bold", {
                key: "j",
                isPrimaryModifierRequired: true
            })
        ).toBe(true);
        expect(
            doesShortcutOverrideCollide(existingOverrides, "bold", {
                key: "i",
                isPrimaryModifierRequired: true
            })
        ).toBe(false);
        expect(existingOverrides).toEqual({
            bold: { key: "x", isPrimaryModifierRequired: true },
            italic: { key: "j", isPrimaryModifierRequired: true }
        });
    });

    test("migrates legacy settings and useful exclusions", () => {
        expect(
            normalizeSettings({
                enabled: false,
                toolbarEnabled: false,
                commandPaletteEnabled: false,
                previewEnabled: false,
                tabSize: 8,
                bulletCharacter: "+",
                excludedHostnames: [" Docs.Example "],
                excludedEditorSelectors: ["#legacy-editor"]
            })
        ).toEqual({
            version: 1,
            isEnabled: false,
            isToolbarEnabled: false,
            isCommandPaletteEnabled: false,
            isPreviewEnabled: false,
            tabWidth: 8,
            bulletStyle: "+",
            shortcutOverrides: {},
            excludedHostnames: ["docs.example"],
            excludedEditorSelectors: ["#legacy-editor"]
        });
    });

    test("uses defaults in memory without overwriting unsupported stored schemas", () => {
        const futurePayload = { version: 2, isEnabled: false, futureValue: { mode: "new" } };
        const storage = createStorage(futurePayload);
        const store = createSettingsStore(storage);

        expect(store.getSettings()).toEqual(createDefaultSettings());
        expect(storage.writeValue).not.toHaveBeenCalled();
        expect(futurePayload).toEqual({ version: 2, isEnabled: false, futureValue: { mode: "new" } });
    });

    test("keeps future schemas read-only when an update is requested", () => {
        const futurePayload = { version: 2, isEnabled: false, futureValue: { mode: "new" } };
        const storage = createStorage(futurePayload);
        const store = createSettingsStore(storage);
        const createChanges = vi.fn(() => ({ tabWidth: 8 }));

        expect(store.updateSettings(createChanges)).toEqual(createDefaultSettings());
        expect(createChanges).not.toHaveBeenCalled();
        expect(storage.getStoredValue()).toBe(futurePayload);
        expect(storage.writeValue).not.toHaveBeenCalled();
    });

    test("merges each update with the latest stored settings across stale stores", () => {
        const storage = createStorage(createDefaultSettings());
        const firstStore = createSettingsStore(storage);
        const secondStore = createSettingsStore(storage);

        firstStore.updateSettings({ tabWidth: 2 });
        expect(secondStore.getSettings()).toMatchObject({ tabWidth: 2, isEnabled: true });
        secondStore.updateSettings((settings) => ({
            isEnabled: !settings.isEnabled
        }));

        expect(secondStore.getSettings()).toMatchObject({ tabWidth: 2, isEnabled: false });
        expect(storage.getStoredValue()).toMatchObject({ tabWidth: 2, isEnabled: false });
        expect(storage.readValue).toHaveBeenCalledTimes(6);
        expect(storage.writeValue).toHaveBeenCalledTimes(2);
    });

    test.each([
        ["legacy", { enabled: false, tabSize: 8 }, { isEnabled: false, tabWidth: 8 }],
        ["malformed", { version: "1", isEnabled: false, tabWidth: 8 }, { isEnabled: true, tabWidth: 4 }]
    ] as const)("re-reads and repairs latest %s settings before applying updates", (_name, latestValue, expected) => {
        const storage = createStorage(createDefaultSettings());
        const store = createSettingsStore(storage);
        storage.setStoredValue(latestValue);

        store.updateSettings({ isPreviewEnabled: false });

        expect(storage.getStoredValue()).toEqual({
            ...createDefaultSettings(),
            ...expected,
            isPreviewEnabled: false
        });
    });

    test("persists repaired settings under one stable key", () => {
        const storage = createStorage({ version: 1, tabWidth: 0 });
        const store = createSettingsStore(storage);

        expect(storage.readValue).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY);
        expect(storage.writeValue).toHaveBeenCalledOnce();
        expect(storage.writeValue).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, store.getSettings());
        expect(store.getSettings().tabWidth).toBe(4);
    });

    test("does not rewrite canonical settings", () => {
        const settings = createDefaultSettings();
        const storage = createStorage(settings);
        createSettingsStore(storage);

        expect(storage.writeValue).not.toHaveBeenCalled();
    });

    test("applies updates live and persists only changes", () => {
        const storage = createStorage(createDefaultSettings());
        const store = createSettingsStore(storage);

        const updated = store.updateSettings((settings) => ({
            isEnabled: !settings.isEnabled,
            tabWidth: 2,
            excludedHostnames: [" Example.COM. ", "example.com"]
        }));
        store.updateSettings({ tabWidth: 2 });

        expect(updated).toMatchObject({ isEnabled: false, tabWidth: 2, excludedHostnames: ["example.com"] });
        expect(store.getSettings()).toBe(updated);
        expect(storage.writeValue).toHaveBeenCalledOnce();
    });

    test("normalizes one valid editor selector per line while preserving selector-list commas", () => {
        expect(
            normalizeEditorSelectors([
                " textarea.private, #editor\n[ ",
                "textarea.private, #editor",
                "textarea[data-label='a,b']"
            ])
        ).toEqual(["textarea.private, #editor", "textarea[data-label='a,b']"]);
    });

    test("repairs malformed schema version markers", () => {
        const storage = createStorage({ version: "1", isEnabled: false });
        const store = createSettingsStore(storage);

        expect(store.getSettings()).toEqual(createDefaultSettings());
        expect(storage.writeValue).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, createDefaultSettings());
    });

    test("enforces editor selector count and length limits after validation and deduplication", () => {
        const selectors = [
            "[",
            "#duplicate",
            "#duplicate",
            "x".repeat(MAX_EDITOR_SELECTOR_LENGTH + 1),
            ...Array.from({ length: MAX_EDITOR_SELECTOR_COUNT + 2 }, (_, index) => `.selector-${index}`)
        ];
        const normalizedSelectors = normalizeEditorSelectors(selectors);

        expect(normalizedSelectors).toHaveLength(MAX_EDITOR_SELECTOR_COUNT);
        expect(normalizedSelectors[0]).toBe("#duplicate");
        expect(normalizedSelectors.at(-1)).toBe(`.selector-${MAX_EDITOR_SELECTOR_COUNT - 2}`);
        expect(normalizeEditorSelectors(["x".repeat(MAX_EDITOR_SELECTOR_LENGTH)])).toHaveLength(1);
    });

    test.each([
        ["Example.COM.", "example.com"],
        ["BÜCHER.Example", "xn--bcher-kva.example"],
        ["xn--bcher-kva.EXAMPLE.", "xn--bcher-kva.example"],
        ["127.1", "127.0.0.1"],
        ["[2001:0DB8::1]", "[2001:db8::1]"],
        ["2001:db8::1", "[2001:db8::1]"]
    ])("canonicalizes hostname %j", (value, expected) => {
        expect(canonicalizeHostname(value)).toBe(expected);
    });

    test.each([
        "",
        "https://example.com",
        "example.com/path",
        "example.com:443",
        "example..com",
        "example.com..",
        "-example.com",
        "example-.com",
        "[::gg]"
    ])("rejects malformed hostname %j", (value) => {
        expect(canonicalizeHostname(value)).toBeUndefined();
    });

    test("deduplicates equivalent Unicode, punycode, root-dot, and IP hostname forms", () => {
        expect(
            normalizeSettings({
                ...createDefaultSettings(),
                excludedHostnames: ["BÜCHER.example.", "xn--bcher-kva.EXAMPLE", "127.1", "127.0.0.1", "not a host"]
            }).excludedHostnames
        ).toEqual(["xn--bcher-kva.example", "127.0.0.1"]);
    });
});
