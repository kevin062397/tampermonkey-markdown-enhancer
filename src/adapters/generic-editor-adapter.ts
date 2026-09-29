import type { EditorAdapter } from "../editor-adapter";

export interface GenericEditorAdapterOptions {
    readonly isPageExcluded?: (url: URL) => boolean;
}

export const createGenericEditorAdapter = (options: GenericEditorAdapterOptions = {}): EditorAdapter => ({
    id: "generic-textarea",
    capabilities: { isNativePreviewAvailable: false },
    toolbarPlacement: "after-editor",
    isPageSupported: (url) => !options.isPageExcluded?.(url),
    isEditor: (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
});
