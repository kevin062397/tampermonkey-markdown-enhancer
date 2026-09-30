import { createGenericEditorAdapter } from "./adapters/generic-editor-adapter";
import type { EditorAdapter } from "./editor-adapter";
import { canonicalizeHostname, createDefaultSettings, type SettingsSource } from "./settings";

const defaultSettingsSource: SettingsSource = { getSettings: createDefaultSettings };

const doesEditorMatchSelector = (editor: HTMLTextAreaElement, selector: string): boolean => {
    try {
        return editor.matches(selector);
    } catch {
        return false;
    }
};

export const createDefaultEditorAdapters = (
    settingsSource: SettingsSource = defaultSettingsSource
): readonly EditorAdapter[] => [
    createGenericEditorAdapter({
        isPageExcluded: (url) => {
            const hostname = canonicalizeHostname(url.hostname);
            return hostname !== undefined && settingsSource.getSettings().excludedHostnames.indexOf(hostname) >= 0;
        },
        isEditorExcluded: (editor) =>
            settingsSource
                .getSettings()
                .excludedEditorSelectors.some((selector) => doesEditorMatchSelector(editor, selector))
    })
];
