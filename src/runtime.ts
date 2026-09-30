import {
    createCommandRegistry,
    createCommandSnapshots,
    type CommandRegistryOptions,
    type EditorCommand,
    type EditorCommandRegistry
} from "./command-registry";
import { getActiveEditorAdapters, getEventPath, resolveEditorFromPath, type EditorAdapter } from "./editor-adapter";
import { attachEditorEventRouter, type RoutedEditor } from "./event-router";
import { attachFormattingToolbar, type FormattingToolbarEditor } from "./formatting-toolbar";
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
    const resolveConfiguredEditor = (
        path: readonly EventTarget[],
        shouldRequireToolbar: boolean
    ): (RoutedEditor & FormattingToolbarEditor) | null => {
        const settings = settingsSource.getSettings();
        if (!settings.isEnabled || (shouldRequireToolbar && !settings.isToolbarEnabled)) {
            return null;
        }
        const activeAdapters = getActiveEditorAdapters(configuredAdapters, getPageUrl());
        const editor = resolveEditorFromPath(path, activeAdapters);
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
            toolbarPlacement: editor.adapter.toolbarPlacement ?? "after-editor",
            shouldDispatchChangeEventAfterEdit: editor.adapter.shouldDispatchChangeEventAfterEdit ?? false,
            tabWidth: settings.tabWidth
        };
    };
    const resolveRoutedEditor = (event: Event): RoutedEditor | null =>
        resolveConfiguredEditor(getEventPath(event), false);
    const resolveToolbarEditor = (event: Event): FormattingToolbarEditor | null =>
        resolveConfiguredEditor(getEventPath(event), true);
    const resolveToolbarEditorFromTextArea = (textArea: HTMLTextAreaElement): FormattingToolbarEditor | null =>
        resolveConfiguredEditor([textArea], true);

    const toolbarKeydownListeners = new Set<(event: KeyboardEvent) => void>();
    const notifyToolbarKeydown = (event: KeyboardEvent): void => {
        for (const listener of toolbarKeydownListeners) {
            listener(event);
        }
    };
    const disposeEventRouter = attachEditorEventRouter(resolveRoutedEditor, notifyToolbarKeydown);
    const disposeFormattingToolbar = attachFormattingToolbar({
        resolveEditor: resolveToolbarEditor,
        resolveEditorFromTextArea: resolveToolbarEditorFromTextArea,
        subscribeKeydown: (listener) => {
            toolbarKeydownListeners.add(listener);
            return () => toolbarKeydownListeners.delete(listener);
        },
        subscribeSettings: settingsSource.subscribeSettings
            ? (listener) => settingsSource.subscribeSettings?.(listener) ?? (() => undefined)
            : undefined
    });

    return () => {
        disposeFormattingToolbar();
        disposeEventRouter();
    };
};
