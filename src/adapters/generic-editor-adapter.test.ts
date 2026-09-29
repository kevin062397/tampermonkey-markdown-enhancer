import { describe, expect, test, vi } from "vitest";
import { getActiveEditorAdapters, resolveEditorFromPath } from "../editor-adapter";
import { createGenericEditorAdapter } from "./generic-editor-adapter";

describe("Generic editor adapter", () => {
    test("supports writable textareas on arbitrary pages", () => {
        const adapter = createGenericEditorAdapter();
        const textArea = document.createElement("textarea");

        expect(getActiveEditorAdapters([adapter], new URL("https://example.test/path"))).toEqual([adapter]);
        expect(getActiveEditorAdapters([adapter], new URL("http://localhost/editor"))).toEqual([adapter]);
        expect(resolveEditorFromPath([textArea], [adapter])?.textArea).toBe(textArea);
        expect(adapter.capabilities.isNativePreviewAvailable).toBe(false);
        expect(adapter.toolbarPlacement).toBe("after-editor");
    });

    test("honors page exclusions and ignores unsupported elements", () => {
        const isPageExcluded = vi.fn((url: URL) => url.hostname === "excluded.example");
        const adapter = createGenericEditorAdapter({ isPageExcluded });
        const input = document.createElement("input");

        expect(getActiveEditorAdapters([adapter], new URL("https://excluded.example/path"))).toEqual([]);
        expect(getActiveEditorAdapters([adapter], new URL("https://included.example/path"))).toEqual([adapter]);
        expect(resolveEditorFromPath([input], [adapter])).toBeNull();
        expect(isPageExcluded).toHaveBeenCalledTimes(2);
    });
});
