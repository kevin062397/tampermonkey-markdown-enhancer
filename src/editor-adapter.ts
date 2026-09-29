import type { EditorCommand } from "./command-registry";

export interface EditorAdapterCapabilities {
    readonly isNativePreviewAvailable: boolean;
}

export type EditorToolbarPlacement = "before-editor" | "after-editor";

export interface EditorAdapter {
    readonly id: string;
    readonly capabilities: EditorAdapterCapabilities;
    readonly commands?: readonly EditorCommand[];
    readonly toolbarPlacement?: EditorToolbarPlacement;
    readonly shouldDispatchChangeEventAfterEdit?: boolean;
    readonly isPageSupported: (url: URL) => boolean;
    readonly isEditor: (element: Element) => element is HTMLTextAreaElement;
}

export interface ResolvedEditor {
    readonly adapter: EditorAdapter;
    readonly textArea: HTMLTextAreaElement;
}

export const getActiveEditorAdapters = (adapters: readonly EditorAdapter[], url: URL): readonly EditorAdapter[] =>
    adapters.filter((adapter) => adapter.isPageSupported(url));

export const getAdapterCommands = (adapters: readonly EditorAdapter[]): readonly EditorCommand[] =>
    adapters.flatMap((adapter) => adapter.commands ?? []);

export const getEventPath = (event: Event): readonly EventTarget[] => {
    const path = event.composedPath();
    if (path.length > 0) {
        return path;
    }
    return event.target ? [event.target] : [];
};

export const resolveEditorFromPath = (
    path: readonly EventTarget[],
    adapters: readonly EditorAdapter[]
): ResolvedEditor | null => {
    for (const target of path) {
        if (!(target instanceof Element)) {
            continue;
        }
        for (const adapter of adapters) {
            if (adapter.isEditor(target) && !target.readOnly && !target.disabled) {
                return { adapter, textArea: target };
            }
        }
    }
    return null;
};

export const resolveEditorFromEvent = (event: Event, adapters: readonly EditorAdapter[]): ResolvedEditor | null =>
    resolveEditorFromPath(getEventPath(event), adapters);
