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
        expect(adapter.toolbarPlacement).toBe("after-editor");
    });

    test("supports nested textareas without field-specific selectors", () => {
        const adapter = createGenericEditorAdapter();
        const container = document.createElement("article");
        const textArea = document.createElement("textarea");
        container.append(textArea);

        expect(resolveEditorFromPath([textArea, container], [adapter])?.textArea).toBe(textArea);
    });

    test("honors editor exclusions", () => {
        const isEditorExcluded = vi.fn((editor: HTMLTextAreaElement) => editor.matches(".excluded"));
        const adapter = createGenericEditorAdapter({ isEditorExcluded });
        const included = document.createElement("textarea");
        const excluded = document.createElement("textarea");
        excluded.className = "excluded";

        expect(resolveEditorFromPath([included], [adapter])?.textArea).toBe(included);
        expect(resolveEditorFromPath([excluded], [adapter])).toBeNull();
        expect(isEditorExcluded).toHaveBeenCalledTimes(2);
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
