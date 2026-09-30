import {
    createCommandRegistry,
    createCommandSnapshots,
    type CommandRegistryOptions,
    type EditorCommand,
    type EditorCommandRegistry
} from "./command-registry";
import { getActiveEditorAdapters, resolveEditorFromEvent, type EditorAdapter } from "./editor-adapter";
import { attachEditorEventRouter, type RoutedEditor } from "./event-router";
import { createDefaultSettings, type MarkdownEnhancerSettings, type SettingsSource } from "./settings";
import { createDefaultEditorAdapters } from "./targeting";

export type PageUrlSource = URL | (() => URL);

const getCurrentPageUrl = (): URL => new URL(window.location.href);
const defaultSettingsSource: SettingsSource = { getSettings: createDefaultSettings };

const createRegistryOptions = (settings: MarkdownEnhancerSettings): CommandRegistryOptions => ({
    bulletStyle: settings.bulletStyle,
    shortcutOverrides: settings.shortcutOverrides
});

const createAdapterSnapshot = (adapter: EditorAdapter): EditorAdapter => {
    const capabilities = adapter.capabilities;
    const commands = adapter.commands;
    const isPageSupported = adapter.isPageSupported;
    const isEditor = adapter.isEditor;
    return Object.freeze({
        id: adapter.id,
        capabilities: Object.freeze({
            isNativePreviewAvailable: capabilities.isNativePreviewAvailable
        }),
        commands: commands ? createCommandSnapshots(commands) : undefined,
        toolbarPlacement: adapter.toolbarPlacement,
        shouldDispatchChangeEventAfterEdit: adapter.shouldDispatchChangeEventAfterEdit,
        isPageSupported: isPageSupported.bind(adapter),
        isEditor: isEditor.bind(adapter)
    });
};

export const initializeMarkdownEnhancer = (
    additionalCommands: readonly EditorCommand[] = [],
    adapters: readonly EditorAdapter[] | undefined = undefined,
    pageUrlSource: PageUrlSource = getCurrentPageUrl,
    settingsSource: SettingsSource = defaultSettingsSource
): (() => void) => {
    const configuredAdditionalCommands = createCommandSnapshots(additionalCommands);
    const adapterInputs = Array.from(adapters ?? createDefaultEditorAdapters(settingsSource));
    const configuredAdapters = Object.freeze(adapterInputs.map(createAdapterSnapshot));
    const initialRegistryOptions = createRegistryOptions(settingsSource.getSettings());
    for (const adapter of configuredAdapters) {
        createCommandRegistry([...configuredAdditionalCommands, ...(adapter.commands ?? [])], initialRegistryOptions);
    }
    if (configuredAdapters.length === 0) {
        createCommandRegistry(configuredAdditionalCommands, initialRegistryOptions);
    }

    const getPageUrl = (): URL => (typeof pageUrlSource === "function" ? pageUrlSource() : pageUrlSource);
    const resolveEditor = (event: Event): RoutedEditor | null => {
        const settings = settingsSource.getSettings();
        if (!settings.isEnabled) {
            return null;
        }
        const activeAdapters = getActiveEditorAdapters(configuredAdapters, getPageUrl());
        const editor = resolveEditorFromEvent(event, activeAdapters);
        if (!editor) {
            return null;
        }
        const commandRegistry: EditorCommandRegistry = createCommandRegistry(
            [...configuredAdditionalCommands, ...(editor.adapter.commands ?? [])],
            createRegistryOptions(settings)
        );
        return {
            textArea: editor.textArea,
            commandRegistry,
            shouldDispatchChangeEventAfterEdit: editor.adapter.shouldDispatchChangeEventAfterEdit ?? false,
            tabWidth: settings.tabWidth
        };
    };
    return attachEditorEventRouter(resolveEditor);
};
