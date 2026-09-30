import { describe, expect, test } from "vitest";
import { getActiveEditorAdapters, resolveEditorFromPath } from "./editor-adapter";
import { createDefaultSettings, type MarkdownEnhancerSettings, type SettingsSource } from "./settings";
import { createDefaultEditorAdapters } from "./targeting";

describe("Default editor targeting", () => {
    test("applies live canonical hostname exclusions while preserving universal defaults", () => {
        let settings: MarkdownEnhancerSettings = createDefaultSettings();
        const source: SettingsSource = { getSettings: () => settings };
        const adapters = createDefaultEditorAdapters(source);
        const pageUrl = new URL("https://BÜCHER.Example./editor");

        expect(getActiveEditorAdapters(adapters, pageUrl)).toHaveLength(1);
        settings = { ...settings, excludedHostnames: ["xn--bcher-kva.example"] };
        expect(getActiveEditorAdapters(adapters, pageUrl)).toHaveLength(0);
        settings = { ...settings, excludedHostnames: [] };
        expect(getActiveEditorAdapters(adapters, pageUrl)).toHaveLength(1);
    });

    test("canonicalizes IP hostname forms before targeting", () => {
        const settings: MarkdownEnhancerSettings = {
            ...createDefaultSettings(),
            excludedHostnames: ["127.0.0.1", "[2001:db8::1]"]
        };
        const adapters = createDefaultEditorAdapters({ getSettings: () => settings });

        expect(getActiveEditorAdapters(adapters, new URL("https://127.1/editor"))).toHaveLength(0);
        expect(getActiveEditorAdapters(adapters, new URL("https://[2001:0DB8::1]/editor"))).toHaveLength(0);
    });

    test("applies valid live editor selectors and safely ignores invalid selectors", () => {
        let settings: MarkdownEnhancerSettings = {
            ...createDefaultSettings(),
            excludedEditorSelectors: ["[", "textarea.private"]
        };
        const adapters = createDefaultEditorAdapters({ getSettings: () => settings });
        const textArea = document.createElement("textarea");
        textArea.className = "private";

        expect(resolveEditorFromPath([textArea], adapters)).toBeNull();
        settings = { ...settings, excludedEditorSelectors: ["["] };
        expect(resolveEditorFromPath([textArea], adapters)?.textArea).toBe(textArea);
    });
});
