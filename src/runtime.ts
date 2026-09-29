import { createCommandRegistry, type EditorCommand, type EditorCommandRegistry } from "./command-registry";
import { getActiveEditorAdapters, resolveEditorFromEvent, type EditorAdapter } from "./editor-adapter";
import { attachEditorEventRouter, type RoutedEditor } from "./event-router";
import { createDefaultEditorAdapters } from "./targeting";

export type PageUrlSource = URL | (() => URL);

const getCurrentPageUrl = (): URL => new URL(window.location.href);

export const initializeMarkdownEnhancer = (
    additionalCommands: readonly EditorCommand[] = [],
    adapters: readonly EditorAdapter[] = createDefaultEditorAdapters(),
    pageUrlSource: PageUrlSource = getCurrentPageUrl
): (() => void) => {
    const commandRegistries = new Map<EditorAdapter, EditorCommandRegistry>(
        adapters.map((adapter) => [
            adapter,
            createCommandRegistry([...additionalCommands, ...(adapter.commands ?? [])])
        ])
    );
    if (adapters.length === 0) {
        createCommandRegistry(additionalCommands);
    }
    const getPageUrl = (): URL => (pageUrlSource instanceof URL ? pageUrlSource : pageUrlSource());
    const resolveEditor = (event: Event): RoutedEditor | null => {
        const activeAdapters = getActiveEditorAdapters(adapters, getPageUrl());
        const editor = resolveEditorFromEvent(event, activeAdapters);
        return editor
            ? {
                  textArea: editor.textArea,
                  commandRegistry: commandRegistries.get(editor.adapter)!
              }
            : null;
    };
    return attachEditorEventRouter(resolveEditor);
};
