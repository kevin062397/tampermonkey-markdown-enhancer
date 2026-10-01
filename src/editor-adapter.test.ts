import { describe, expect, test, vi } from "vitest";
import type { EditorCommand } from "./command-registry";
import {
    getActiveEditorAdapters,
    getAdapterCommands,
    resolveEditorFromPath,
    type EditorAdapter
} from "./editor-adapter";

const createAdapter = (
    id: string,
    isPageSupported: boolean,
    commands: readonly EditorCommand[] = []
): EditorAdapter => ({
    id,
    commands,
    isPageSupported: () => isPageSupported,
    isEditor: (element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement
});

describe("Editor adapters", () => {
    test("activates only page-matching adapters and exposes their commands", () => {
        const executeCommand = vi.fn(() => true);
        const command: EditorCommand = {
            id: "adapter.command",
            label: "Adapter command",
            isAvailable: () => true,
            execute: executeCommand
        };
        const activeAdapter = createAdapter("active", true, [command]);
        const inactiveAdapter = createAdapter("inactive", false);
        const activeAdapters = getActiveEditorAdapters(
            [inactiveAdapter, activeAdapter],
            new URL("https://example.test/editor")
        );

        expect(activeAdapters).toEqual([activeAdapter]);
        expect(getAdapterCommands(activeAdapters)).toEqual([command]);
    });

    test("resolves the first writable editor in composed-path order", () => {
        const firstAdapter = createAdapter("first", true);
        const secondAdapter: EditorAdapter = {
            ...createAdapter("second", true),
            isEditor: (element): element is HTMLTextAreaElement =>
                element instanceof HTMLTextAreaElement && element.dataset.adapter === "second"
        };
        const textArea = document.createElement("textarea");
        textArea.dataset.adapter = "second";

        expect(resolveEditorFromPath([textArea, document.body], [firstAdapter, secondAdapter])?.adapter).toBe(
            firstAdapter
        );
        textArea.readOnly = true;
        expect(resolveEditorFromPath([textArea], [firstAdapter, secondAdapter])).toBeNull();
        textArea.readOnly = false;
        textArea.disabled = true;
        expect(resolveEditorFromPath([textArea], [firstAdapter, secondAdapter])).toBeNull();
        expect(resolveEditorFromPath([document.body], [firstAdapter])).toBeNull();
    });
});
